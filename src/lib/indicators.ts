/**
 * Technical indicators — EMA and pivot-based support/resistance.
 *
 * Everything here is pure & synchronous so it is trivially testable.
 * No network access, no side effects. The API route orchestrates the
 * network calls and delegates the math to these functions.
 */

/**
 * calculateEMA — standard exponential moving average.
 *
 * Seed = SMA of the first `period` closes.
 * Recurrence: EMA_t = close_t * k + EMA_{t-1} * (1 - k),  k = 2 / (period + 1)
 *
 * Returns the full EMA series aligned with the input array (the first
 * `period - 1` entries are null because the EMA is not yet defined).
 *
 * If there are fewer than `period` closes, returns a "not available"
 * signal via the `available` flag rather than producing garbage.
 */
export function calculateEMA(
  closes: number[],
  period: number,
): { series: (number | null)[]; last: number | null; available: boolean } {
  const n = closes.length;
  if (period <= 0 || n < period) {
    return { series: Array(n).fill(null), last: null, available: false };
  }

  const k = 2 / (period + 1);
  const series: (number | null)[] = Array(n).fill(null);

  // SMA seed over the first `period` closes.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  seed /= period;
  series[period - 1] = seed;

  // Recurrence for the remainder.
  let prev = seed;
  for (let i = period; i < n; i++) {
    const ema = closes[i] * k + prev * (1 - k);
    series[i] = ema;
    prev = ema;
  }

  return { series, last: prev, available: true };
}

type Pivot = { index: number; price: number; type: "high" | "low" };

/**
 * findSupportResistance — pivot-based levels over the most recent candles.
 *
 * A pivot high at index i requires high[i] to be strictly greater than the
 * highs of the `window` candles before AND after it (symmetric ±window).
 * Analogously for pivot lows (strictly less than).
 *
 * We scan the last `lookback` candles (default 80) and then pick:
 *   - resistance = nearest pivot high strictly ABOVE the current price
 *   - support    = nearest pivot low  strictly BELOW the current price
 *
 * Fallback when no qualifying pivot exists: the max (resistance) or min
 * (support) of the scanned range. This keeps the UI useful in trending
 * markets where price has broken beyond all recent pivots.
 *
 * Returns `available: false` when there are too few candles to even scan.
 */
export function findSupportResistance(
  highs: number[],
  lows: number[],
  currentPrice: number,
  opts: { window?: number; lookback?: number } = {},
): {
  support: number | null;
  resistance: number | null;
  available: boolean;
} {
  const window = opts.window ?? 3;
  const lookback = opts.lookback ?? 80;
  const n = highs.length;
  if (n < window * 2 + 1 || lookback < window * 2 + 1) {
    return { support: null, resistance: null, available: false };
  }

  const start = Math.max(0, n - lookback);
  const pivots: Pivot[] = [];

  for (let i = start + window; i <= n - 1 - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ index: i, price: highs[i], type: "high" });
    if (isLow) pivots.push({ index: i, price: lows[i], type: "low" });
  }

  // Nearest pivots: prefer the closest in price, then closest in time.
  const highsAbove = pivots
    .filter((p) => p.type === "high" && p.price > currentPrice)
    .sort((a, b) => {
      const da = Math.abs(a.price - currentPrice);
      const db = Math.abs(b.price - currentPrice);
      if (Math.abs(da - db) / Math.max(da, db) < 0.0001) return b.index - a.index;
      return da - db;
    });
  const lowsBelow = pivots
    .filter((p) => p.type === "low" && p.price < currentPrice)
    .sort((a, b) => {
      const da = Math.abs(a.price - currentPrice);
      const db = Math.abs(b.price - currentPrice);
      if (Math.abs(da - db) / Math.max(da, db) < 0.0001) return b.index - a.index;
      return da - db;
    });

  let resistance = highsAbove.length > 0 ? highsAbove[0].price : null;
  let support = lowsBelow.length > 0 ? lowsBelow[0].price : null;

  // Fallbacks to range extremes.
  if (resistance === null) {
    let max = -Infinity;
    for (let i = start; i < n; i++) if (highs[i] > max) max = highs[i];
    if (max > currentPrice) resistance = max;
  }
  if (support === null) {
    let min = Infinity;
    for (let i = start; i < n; i++) if (lows[i] < min) min = lows[i];
    if (min < currentPrice) support = min;
  }

  return {
    support,
    resistance,
    available: support !== null || resistance !== null,
  };
}

export type CrossState = "ALCISTA" | "BAJISTA" | "COMPRIMIDO";

/**
 * determineCrossState — classify the EMA55 vs EMA200 relationship.
 *
 *  - COMPRIMIDO when |EMA55 - EMA200| / EMA200 < 0.15%  (medias muy juntas)
 *  - ALCISTA    when EMA55 > EMA200 (and not comprimido)
 *  - BAJISTA    when EMA55 < EMA200 (and not comprimido)
 */
export function determineCrossState(
  ema55: number | null,
  ema200: number | null,
): { state: CrossState | null; available: boolean } {
  if (ema55 == null || ema200 == null || ema200 === 0) {
    return { state: null, available: false };
  }
  const diffPct = Math.abs(ema55 - ema200) / ema200;
  if (diffPct < 0.0015) return { state: "COMPRIMIDO", available: true };
  if (ema55 > ema200) return { state: "ALCISTA", available: true };
  return { state: "BAJISTA", available: true };
}
