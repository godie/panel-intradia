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

/**
 * calculateRSI — Relative Strength Index (Wilder's smoothing).
 *
 * Standard RSI over `period` closes (default 14). Uses Wilder's smoothing:
 *   - First avgGain / avgLoss = simple average of gains/losses over the first
 *     `period` changes.
 *   - Then avgGain_t = (avgGain_{t-1} * (period-1) + gain_t) / period
 *   - RS  = avgGain / avgLoss
 *   - RSI = 100 - 100 / (1 + RS)
 *
 * Returns the last RSI value + the full series (aligned to closes, null until
 * index `period`). `available: false` when fewer than `period + 1` closes.
 *
 * Edge case: if avgLoss is 0 and avgGain > 0 → RSI = 100 (pure uptrend).
 *            if avgGain is 0 and avgLoss > 0 → RSI = 0.
 */
export function calculateRSI(
  closes: number[],
  period = 14,
): { series: (number | null)[]; last: number | null; available: boolean } {
  const n = closes.length;
  if (period <= 0 || n < period + 1) {
    return { series: Array(n).fill(null), last: null, available: false };
  }

  const series: (number | null)[] = Array(n).fill(null);

  // Seed: average gain / loss over the first `period` changes.
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  // First RSI at index `period`.
  const rsiAt = (ag: number, al: number): number => {
    if (al === 0) return ag === 0 ? 50 : 100;
    const rs = ag / al;
    return 100 - 100 / (1 + rs);
  };
  series[period] = rsiAt(avgGain, avgLoss);

  // Wilder smoothing for the rest.
  for (let i = period + 1; i < n; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    series[i] = rsiAt(avgGain, avgLoss);
  }

  return { series, last: series[n - 1], available: true };
}

export type CrossInfo = {
  /** Whether a cross (EMA55 crossing EMA200) occurred within the last `window` candles. */
  happened: boolean;
  /** Candles elapsed since the most recent cross (null if none found in the scanned range). */
  candles_since_cross: number | null;
  /** Direction of the most recent cross: "bullish" (EMA55 crossed above) or "bearish" (below). */
  direction: "bullish" | "bearish" | null;
  /** Scan window in candles (default 30). */
  window: number;
};

/**
 * detectRecentCross — find the most recent EMA55/EMA200 crossover.
 *
 * Walks backwards from the latest candle looking for the index where the
 * sign of (ema55 - ema200) flips. A "bullish" cross is ema55 going from
 * below to above ema200; "bearish" is the opposite.
 *
 * Only scans the last `window` candles (default 30 ≈ 5 days on 4h) to keep
 * the signal relevant to intraday/short-swing trading.
 *
 * Returns `happened: true` when the cross is within `window` candles AND
 * `candles_since_cross <= recentThreshold` (default 10). The two flags let
 * the UI distinguish "any recent cross" from "fresh cross".
 */
export function detectRecentCross(
  ema55Series: (number | null)[],
  ema200Series: (number | null)[],
  opts: { window?: number; recentThreshold?: number } = {},
): CrossInfo {
  const window = opts.window ?? 30;
  const recentThreshold = opts.recentThreshold ?? 10;
  const n = ema55Series.length;

  const validAt = (i: number): boolean => {
    const a = ema55Series[i];
    const b = ema200Series[i];
    return a != null && b != null && Number.isFinite(a) && Number.isFinite(b);
  };

  // Find the last index where both EMAs are defined.
  let lastValid = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (validAt(i)) {
      lastValid = i;
      break;
    }
  }
  if (lastValid < 1) {
    return { happened: false, candles_since_cross: null, direction: null, window };
  }

  const scanStart = Math.max(1, lastValid - window + 1);

  // Walk backwards looking for a sign flip of (ema55 - ema200).
  let crossIdx = -1;
  let crossDir: "bullish" | "bearish" | null = null;
  for (let i = lastValid; i > scanStart; i--) {
    if (!validAt(i) || !validAt(i - 1)) continue;
    const diffNow = (ema55Series[i] as number) - (ema200Series[i] as number);
    const diffPrev = (ema55Series[i - 1] as number) - (ema200Series[i - 1] as number);
    if (diffNow === 0 || diffPrev === 0) continue;
    if ((diffNow > 0) !== (diffPrev > 0)) {
      crossIdx = i;
      crossDir = diffNow > 0 ? "bullish" : "bearish";
      break;
    }
  }

  if (crossIdx === -1) {
    return { happened: false, candles_since_cross: null, direction: null, window };
  }

  const candlesSince = lastValid - crossIdx + 1;
  return {
    happened: candlesSince <= recentThreshold,
    candles_since_cross: candlesSince,
    direction: crossDir,
    window,
  };
}
