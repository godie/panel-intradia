import { NextRequest, NextResponse } from "next/server";
import { providerRouter } from "@/lib/providers/router";
import { getCached, setCached } from "@/lib/cache";
import { SYMBOLS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Default set of symbols used when no `symbols` query param is provided. */
const DEFAULT_SYMBOLS: string[] = [...SYMBOLS];
const CACHE_TTL_MS = 120_000; // 2 min — correlation doesn't need to be as fresh

/**
 * Validate that a symbol string is a plausible Binance USDT spot pair.
 * Uppercase letters, ends with "USDT", 6-16 chars total, base 2-12 letters.
 */
export function isValidSymbolFormat(symbol: string): boolean {
  if (!symbol) return false;
  if (!/^[A-Z]{2,12}USDT$/.test(symbol)) return false;
  if (symbol.length < 6 || symbol.length > 16) return false;
  return true;
}

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
 * GET /api/correlation?interval=4h&limit=500&symbols=BTCUSDT,ETHUSDT,...
 *
 * Returns a Pearson correlation matrix between the requested symbols, based
 * on close-to-close percentage returns over the last `limit` candles of the
 * given `interval`. A symmetric matrix of {symbols[], matrix[][]} where
 * matrix[i][j] is the correlation between symbols[i] and symbols[j] (1.0
 * on the diagonal).
 *
 * Params:
 *  - interval: "1h" | "4h" | "1d" (default "4h")
 *  - limit: 100 | 500 | 1000 (default 500)
 *  - symbols: optional comma-separated list of USDT pairs. When omitted,
 *    the default 5 symbols (BTC/ETH/XRP/SOL/BNB) are used. At least 2
 *    symbols are required.
 *
 * Cached for 120s per (symbols+interval+limit) combo — correlation is
 * compute-heavy (N Binance fetches) and doesn't need sub-minute freshness.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const interval = searchParams.get("interval") ?? "4h";
  const limitRaw = Number(searchParams.get("limit") ?? "500");
  const symbolsParam = searchParams.get("symbols") ?? "";

  // Validate interval.
  if (!INTERVALS[interval]) {
    return NextResponse.json(
      { error: `Interval inválido. Permitidos: ${Object.keys(INTERVALS).join(", ")}` },
      { status: 400 },
    );
  }
  // Validate limit.
  const limit = ALLOWED_LIMITS.has(limitRaw) ? limitRaw : 500;

  // Resolve the requested symbol list.
  let symbols: string[];
  if (symbolsParam.trim()) {
    const parsed = symbolsParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    // Deduplicate while preserving order.
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const s of parsed) {
      if (!seen.has(s)) {
        seen.add(s);
        unique.push(s);
      }
    }
    // Validate every requested symbol.
    const invalid = unique.filter((s) => !isValidSymbolFormat(s));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Símbolos inválidos: ${invalid.join(", ")}. Deben ser pares USDT válidos.` },
        { status: 400 },
      );
    }
    if (unique.length < 2) {
      return NextResponse.json(
        { error: "Se requieren al menos 2 símbolos para calcular correlación." },
        { status: 400 },
      );
    }
    symbols = unique;
  } else {
    symbols = DEFAULT_SYMBOLS;
  }

  const cacheKey = `correlation:${symbols.join(",")}:${interval}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "HIT", "cache-control": "no-store" },
    });
  }

  try {
    // Fetch klines for all symbols in parallel.
    const results = await Promise.all(
      symbols.map(async (s) => {
        try {
          const klines = await providerRouter.getKlines(s, interval, limit).then((r) => r.klines);
          return { symbol: s, returns: toReturns(klines.map((k) => k.close)) };
        } catch {
          return { symbol: s, returns: [] };
        }
      }),
    );

    // Build the symmetric correlation matrix.
    const matrix: (number | null)[][] = symbols.map((_, i) =>
      symbols.map((_, j) => {
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
      symbols,
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
