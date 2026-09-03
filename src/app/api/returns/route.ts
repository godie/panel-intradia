import { NextRequest, NextResponse } from "next/server";
import { providerRouter } from "@/lib/providers/router";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SYMBOLS = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "BNBUSDT",
]);
const ALLOWED_INTERVALS = new Set(["1h", "4h", "1d"]);
const ALLOWED_LIMITS = new Set([100, 500, 1000]);
const CACHE_TTL_MS = 120_000;

/**
 * Compute Pearson correlation + linear regression between two return arrays.
 */
function analyze(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
    sab += a[i] * b[i];
  }
  const meanA = sa / n;
  const meanB = sb / n;
  const varA = saa - n * meanA * meanA;
  const varB = sbb - n * meanB * meanB;
  const cov = sab - n * meanA * meanB;
  if (varA === 0 || varB === 0) return null;
  const r = cov / Math.sqrt(varA * varB);
  // Linear regression: y = slope * x + intercept, where y = b, x = a.
  const slope = cov / varA;
  const intercept = meanB - slope * meanA;
  const rSquared = r * r;
  return { r, rSquared, slope, intercept, meanA, meanB, n };
}

/**
 * GET /api/returns?symbolA=BTCUSDT&symbolB=ETHUSDT&interval=4h&limit=500
 *
 * Returns the paired percentage returns for two symbols + correlation stats
 * + linear regression coefficients. Used by the ScatterPlotModal to render
 * a scatter plot with a regression line and R².
 *
 * Response:
 *  {
 *    symbolA, symbolB, interval, limit,
 *    returnsA: number[],    // percentage returns for symbol A
 *    returnsB: number[],    // paired returns for symbol B (same indices)
 *    stats: { r, rSquared, slope, intercept, meanA, meanB, n } | null,
 *    updated_at: string
 *  }
 *
 * Cached 120s per (A, B, interval, limit) combo.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbolA = (searchParams.get("symbolA") ?? "").toUpperCase().trim();
  const symbolB = (searchParams.get("symbolB") ?? "").toUpperCase().trim();
  const interval = searchParams.get("interval") ?? "4h";
  const limitRaw = Number(searchParams.get("limit") ?? "500");

  if (!symbolA || !ALLOWED_SYMBOLS.has(symbolA)) {
    return NextResponse.json(
      { error: `symbolA inválido. Permitidos: ${[...ALLOWED_SYMBOLS].join(", ")}` },
      { status: 400 },
    );
  }
  if (!symbolB || !ALLOWED_SYMBOLS.has(symbolB)) {
    return NextResponse.json(
      { error: `symbolB inválido. Permitidos: ${[...ALLOWED_SYMBOLS].join(", ")}` },
      { status: 400 },
    );
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json(
      { error: `Interval inválido. Permitidos: ${[...ALLOWED_INTERVALS].join(", ")}` },
      { status: 400 },
    );
  }
  const limit = ALLOWED_LIMITS.has(limitRaw) ? limitRaw : 500;

  // Cache key is order-independent (A,B == B,A) since the scatter is symmetric.
  const pair = [symbolA, symbolB].sort().join(":");
  const cacheKey = `returns:${pair}:${interval}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "HIT", "cache-control": "no-store" },
    });
  }

  try {
    const [kA, kB] = await Promise.all([
      providerRouter.getKlines(symbolA, interval, limit).then((r) => r.klines),
      providerRouter.getKlines(symbolB, interval, limit).then((r) => r.klines),
    ]);

    // Convert to returns, paired by index (align lengths).
    const toReturns = (closes: number[]) => {
      const r: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        const prev = closes[i - 1];
        if (prev === 0) continue;
        r.push(((closes[i] - prev) / prev) * 100);
      }
      return r;
    };
    const returnsA = toReturns(kA.map((k) => k.close));
    const returnsB = toReturns(kB.map((k) => k.close));
    const n = Math.min(returnsA.length, returnsB.length);
    const pairedA = returnsA.slice(0, n);
    const pairedB = returnsB.slice(0, n);

    const stats = analyze(pairedA, pairedB);

    const payload = {
      symbolA,
      symbolB,
      interval,
      limit,
      returnsA: pairedA,
      returnsB: pairedB,
      stats,
      updated_at: new Date().toISOString(),
    };
    setCached(cacheKey, payload, CACHE_TTL_MS);

    return NextResponse.json(payload, {
      headers: { "x-cache": "MISS", "cache-control": "no-store" },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error obteniendo returns";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
