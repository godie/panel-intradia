import { NextRequest, NextResponse } from "next/server";
import { providerRouter } from "@/lib/providers/router";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "BNBUSDT"];
const CACHE_TTL_MS = 120_000; // 2 min — correlation doesn't need to be as fresh

/** Allowed intervals with human-readable labels for the UI. */
const INTERVALS: Record<string, { label: string; daysPerCandle: number }> = {
  "1h": { label: "1h", daysPerCandle: 1 / 24 },
  "4h": { label: "4h", daysPerCandle: 1 / 6 },
  "1d": { label: "1d", daysPerCandle: 1 },
};

const ALLOWED_LIMITS = new Set([100, 500, 1000]);

/**
 * Compute Pearson correlation coefficient between two arrays of equal length.
 * Returns null if the arrays are too short or have zero variance.
 */
function pearson(a: number[], b: number[]): number | null {
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
  const varA = n * saa - sa * sa;
  const varB = n * sbb - sb * sb;
  if (varA === 0 || varB === 0) return null;
  return (n * sab - sa * sb) / Math.sqrt(varA * varB);
}

/**
 * Convert kline closes into an array of percentage returns.
 * returns[i] = (close[i] - close[i-1]) / close[i-1] * 100
 */
function toReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev === 0) continue;
    r.push(((closes[i] - prev) / prev) * 100);
  }
  return r;
}

/**
 * GET /api/correlation?interval=4h&limit=500
 *
 * Returns a Pearson correlation matrix between all supported symbols, based
 * on close-to-close percentage returns over the last `limit` candles of the
 * given `interval`. A symmetric matrix of {symbols[], matrix[][]} where
 * matrix[i][j] is the correlation between symbols[i] and symbols[j] (1.0
 * on the diagonal).
 *
 * Params:
 *  - interval: "1h" | "4h" | "1d" (default "4h")
 *  - limit: 100 | 500 | 1000 (default 500)
 *
 * Cached for 120s per (interval+limit) combo — correlation is compute-heavy
 * (5 Binance fetches) and doesn't need sub-minute freshness.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const interval = searchParams.get("interval") ?? "4h";
  const limitRaw = Number(searchParams.get("limit") ?? "500");

  // Validate interval.
  if (!INTERVALS[interval]) {
    return NextResponse.json(
      { error: `Interval inválido. Permitidos: ${Object.keys(INTERVALS).join(", ")}` },
      { status: 400 },
    );
  }
  // Validate limit.
  const limit = ALLOWED_LIMITS.has(limitRaw) ? limitRaw : 500;

  const cacheKey = `correlation:${interval}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "HIT", "cache-control": "no-store" },
    });
  }

  try {
    // Fetch klines for all symbols in parallel.
    const results = await Promise.all(
      SYMBOLS.map(async (s) => {
        try {
          const klines = await providerRouter.getKlines(s, interval, limit).then((r) => r.klines);
          return { symbol: s, returns: toReturns(klines.map((k) => k.close)) };
        } catch {
          return { symbol: s, returns: [] };
        }
      }),
    );

    // Build the symmetric correlation matrix.
    const matrix: (number | null)[][] = SYMBOLS.map((_, i) =>
      SYMBOLS.map((_, j) => {
        if (i === j) return 1.0;
        const a = results[i].returns;
        const b = results[j].returns;
        return pearson(a, b);
      }),
    );

    const meta = INTERVALS[interval];
    const approxDays = Math.round(limit * meta.daysPerCandle);
    const window = `${meta.label} · ${limit} velas (~${approxDays} días)`;

    const payload = {
      symbols: SYMBOLS,
      matrix,
      interval,
      limit,
      window,
      updated_at: new Date().toISOString(),
    };
    setCached(cacheKey, payload, CACHE_TTL_MS);

    return NextResponse.json(payload, {
      headers: { "x-cache": "MISS", "cache-control": "no-store" },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error calculando correlaciones";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
