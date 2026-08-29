import { NextResponse } from "next/server";
import { fetchKlines } from "@/lib/binance";
import { getCached, setCached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "BNBUSDT"];
const CACHE_TTL_MS = 120_000; // 2 min — correlation doesn't need to be as fresh

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
 * GET /api/correlation
 *
 * Returns a Pearson correlation matrix between all supported symbols, based
 * on 4h close-to-close percentage returns over the last 500 candles. A
 * symmetric matrix of {symbols[], matrix[][]} where matrix[i][j] is the
 * correlation between symbols[i] and symbols[j] (1.0 on the diagonal).
 *
 * Cached for 120s — correlation is compute-heavy (5 Binance fetches) and
 * doesn't need sub-minute freshness.
 */
export async function GET() {
  const cacheKey = "correlation:all";
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
          const klines = await fetchKlines(s, "4h", 500);
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

    const payload = {
      symbols: SYMBOLS,
      matrix,
      window: "4h · 500 velas (~83 días)",
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
