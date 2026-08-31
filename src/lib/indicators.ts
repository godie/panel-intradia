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

export type MACDResult = {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
  lastMacd: number | null;
  lastSignal: number | null;
  lastHistogram: number | null;
  available: boolean;
};

/**
 * calculateMACD — Moving Average Convergence Divergence.
 *
 *  - MACD line   = EMA(fast) - EMA(slow)
 *  - Signal line = EMA(signal) of the MACD line
 *  - Histogram   = MACD line - Signal line
 *
 * The standard params are fast=12, slow=26, signal=9 (Gerald Appel defaults).
 *
 * Because the EMA helper returns `null` for the first `period-1` entries,
 * the MACD line is `null` until both EMAs are defined (i.e. index >= slow-1).
 * The signal line is `null` until the MACD line has `signal` valid entries
 * (so index >= slow-1 + signal-1 = slow+signal-2). The histogram follows the
 * signal line's availability.
 *
 * Returns `available: false` when there are fewer than `slow + signal` closes
 * — that's the minimum needed for the signal line to produce at least one
 * value.
 */
export function calculateMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDResult {
  const n = closes.length;
  const empty: MACDResult = {
    macdLine: Array(n).fill(null),
    signalLine: Array(n).fill(null),
    histogram: Array(n).fill(null),
    lastMacd: null,
    lastSignal: null,
    lastHistogram: null,
    available: false,
  };
  if (
    n < slow + signal ||
    fast <= 0 ||
    slow <= 0 ||
    signal <= 0 ||
    fast >= slow
  ) {
    return empty;
  }

  // EMA(fast) and EMA(slow) over the full closes array.
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);

  const macdLine: (number | null)[] = Array(n).fill(null);
  // Build the MACD line wherever both EMAs are defined.
  for (let i = 0; i < n; i++) {
    const f = emaFast.series[i];
    const s = emaSlow.series[i];
    if (f != null && s != null && Number.isFinite(f) && Number.isFinite(s)) {
      macdLine[i] = f - s;
    }
  }

  // The signal line is an EMA of the MACD line, but `calculateEMA`
  // expects a number[] and uses SMA seeding. We feed it only the contiguous
  // non-null MACD values (which start at index slow-1) so the SMA seed and
  // recurrence align correctly. We then map the result back onto the full
  // timeline starting at the index where the signal first becomes valid.
  const firstMacdIdx = macdLine.findIndex((v) => v != null);
  const signalLine: (number | null)[] = Array(n).fill(null);
  let lastSignalVal: number | null = null;
  if (firstMacdIdx >= 0) {
    const macdSlice = macdLine
      .slice(firstMacdIdx)
      .map((v) => (v == null ? 0 : v)) as number[];
    // If we have at least `signal` MACD values, the EMA can be computed.
    if (macdSlice.length >= signal) {
      const sig = calculateEMA(macdSlice, signal);
      for (let i = 0; i < sig.series.length; i++) {
        const v = sig.series[i];
        if (v != null && Number.isFinite(v)) {
          signalLine[firstMacdIdx + i] = v;
        }
      }
      lastSignalVal = sig.last;
    }
  }

  // Histogram = MACD - Signal wherever both are defined.
  const histogram: (number | null)[] = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = macdLine[i];
    const s = signalLine[i];
    if (m != null && s != null && Number.isFinite(m) && Number.isFinite(s)) {
      histogram[i] = m - s;
    }
  }

  // Find last valid MACD value (skip trailing nulls).
  let lastMacd: number | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (macdLine[i] != null) {
      lastMacd = macdLine[i];
      break;
    }
  }

  let lastHistogram: number | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (histogram[i] != null) {
      lastHistogram = histogram[i];
      break;
    }
  }

  return {
    macdLine,
    signalLine,
    histogram,
    lastMacd,
    lastSignal: lastSignalVal,
    lastHistogram,
    available: lastMacd != null,
  };
}

/**
 * Detect the most recent MACD/signal crossover.
 *
 * A "bullish" MACD cross = MACD line crosses above the signal line.
 * A "bearish" MACD cross = MACD line crosses below the signal line.
 *
 * Walks backwards from the latest valid bar looking for the index where the
 * sign of (macd - signal) flips. Scans the last `window` bars (default 20).
 *
 * `happened` is true when the cross is within `recentThreshold` bars
 * (default 6) — this is the "fresh cross" signal the UI flashes.
 *
 * Also detects **histogram sign flip** (momentum shift) — when the histogram
 * itself crosses zero, which is a leading indicator of a MACD cross.
 */
export type MacdCrossInfo = {
  /** Fresh MACD/signal cross within `recentThreshold` bars. */
  happened: boolean;
  candles_since_cross: number | null;
  direction: "bullish" | "bearish" | null;
  /** Histogram sign flip within `recentThreshold` bars (momentum shift). */
  momentum_flip: boolean;
  momentum_flip_direction: "bullish" | "bearish" | null;
  candles_since_flip: number | null;
  window: number;
};

export function detectMacdCross(
  macdLine: (number | null)[],
  signalLine: (number | null)[],
  histogram: (number | null)[],
  opts: { window?: number; recentThreshold?: number } = {},
): MacdCrossInfo {
  const window = opts.window ?? 20;
  const recentThreshold = opts.recentThreshold ?? 6;
  const n = macdLine.length;

  const validAt = (i: number) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m != null && s != null && Number.isFinite(m) && Number.isFinite(s);
  };

  // Find the last index where both MACD and signal are defined.
  let lastValid = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (validAt(i)) {
      lastValid = i;
      break;
    }
  }

  const base: MacdCrossInfo = {
    happened: false,
    candles_since_cross: null,
    direction: null,
    momentum_flip: false,
    momentum_flip_direction: null,
    candles_since_flip: null,
    window,
  };
  if (lastValid < 1) return base;

  const scanStart = Math.max(1, lastValid - window + 1);

  // 1. MACD/signal crossover detection.
  let crossIdx = -1;
  let crossDir: "bullish" | "bearish" | null = null;
  for (let i = lastValid; i > scanStart; i--) {
    if (!validAt(i) || !validAt(i - 1)) continue;
    const diffNow = (macdLine[i] as number) - (signalLine[i] as number);
    const diffPrev = (macdLine[i - 1] as number) - (signalLine[i - 1] as number);
    if (diffNow === 0 || diffPrev === 0) continue;
    if ((diffNow > 0) !== (diffPrev > 0)) {
      crossIdx = i;
      crossDir = diffNow > 0 ? "bullish" : "bearish";
      break;
    }
  }

  // 2. Histogram momentum flip (sign change of histogram, leading signal).
  let flipIdx = -1;
  let flipDir: "bullish" | "bearish" | null = null;
  for (let i = lastValid; i > scanStart; i--) {
    const hNow = histogram[i];
    const hPrev = histogram[i - 1];
    if (hNow == null || hPrev == null) continue;
    if (!Number.isFinite(hNow) || !Number.isFinite(hPrev)) continue;
    if (hNow === 0 || hPrev === 0) continue;
    if ((hNow > 0) !== (hPrev > 0)) {
      flipIdx = i;
      flipDir = hNow > 0 ? "bullish" : "bearish";
      break;
    }
  }

  const candlesSinceCross = crossIdx === -1 ? null : lastValid - crossIdx + 1;
  const candlesSinceFlip = flipIdx === -1 ? null : lastValid - flipIdx + 1;

  return {
    happened:
      candlesSinceCross != null && candlesSinceCross <= recentThreshold,
    candles_since_cross: candlesSinceCross,
    direction: crossDir,
    momentum_flip:
      candlesSinceFlip != null && candlesSinceFlip <= recentThreshold,
    momentum_flip_direction: flipDir,
    candles_since_flip: candlesSinceFlip,
    window,
  };
}

/**
 * calculateATR — Average True Range (Wilder's smoothing).
 *
 * True Range for a candle is the greatest of:
 *   - |high - low|
 *   - |high - prevClose|
 *   - |low - prevClose|
 *
 * ATR uses Wilder's smoothing (same as RSI): the first ATR is the SMA of the
 * first `period` TRs, then `ATR_t = (ATR_{t-1} * (period-1) + TR_t) / period`.
 *
 * Returns the last ATR value + the full series (null for the first `period`
 * entries). `available: false` when fewer than `period + 1` candles (need a
 * previous close for the first TR).
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): { series: (number | null)[]; last: number | null; available: boolean } {
  const n = highs.length;
  if (period <= 0 || n < period + 1 || lows.length !== n || closes.length !== n) {
    return { series: Array(n).fill(null), last: null, available: false };
  }

  // Compute True Range for each candle (needs prev close).
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
    } else {
      const prevClose = closes[i - 1];
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - prevClose);
      const lc = Math.abs(lows[i] - prevClose);
      tr.push(Math.max(hl, hc, lc));
    }
  }

  const series: (number | null)[] = Array(n).fill(null);

  // Seed: SMA of the first `period` TR values (indices 1..period).
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i];
  seed /= period;
  series[period] = seed;

  // Wilder smoothing for the rest.
  let prev = seed;
  for (let i = period + 1; i < n; i++) {
    const atr = (prev * (period - 1) + tr[i]) / period;
    series[i] = atr;
    prev = atr;
  }

  return { series, last: prev, available: true };
}

/**
 * calculateBollingerBands — Bollinger Bands (SMA ± k * stddev).
 *
 * Middle band = SMA(period) of closes.
 * Upper band = middle + k * stddev.
 * Lower band = middle - k * stddev.
 *
 * Standard params: period=20, k=2 (2 standard deviations).
 *
 * Returns the last values + the full series for the middle/upper/lower bands
 * (null for the first `period - 1` entries). `available: false` when fewer
 * than `period` closes. The bandwidth (% distance between upper and lower
 * relative to middle) is also returned for a squeeze-detection UI.
 */
export type BollingerResult = {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  lastMiddle: number | null;
  lastUpper: number | null;
  lastLower: number | null;
  lastBandwidth: number | null; // (upper - lower) / middle * 100
  available: boolean;
};

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  k = 2,
): BollingerResult {
  const n = closes.length;
  const empty: BollingerResult = {
    middle: Array(n).fill(null),
    upper: Array(n).fill(null),
    lower: Array(n).fill(null),
    lastMiddle: null,
    lastUpper: null,
    lastLower: null,
    lastBandwidth: null,
    available: false,
  };
  if (period <= 0 || n < period || k <= 0) return empty;

  const middle: (number | null)[] = Array(n).fill(null);
  const upper: (number | null)[] = Array(n).fill(null);
  const lower: (number | null)[] = Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    // SMA of closes[i-period+1 .. i]
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const sma = sum / period;
    middle[i] = sma;

    // Standard deviation of the same window (population stddev).
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += (closes[j] - sma) ** 2;
    }
    const stddev = Math.sqrt(sqSum / period);

    upper[i] = sma + k * stddev;
    lower[i] = sma - k * stddev;
  }

  // Find last valid values.
  let lastMiddle: number | null = null;
  let lastUpper: number | null = null;
  let lastLower: number | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (middle[i] != null) {
      lastMiddle = middle[i];
      lastUpper = upper[i];
      lastLower = lower[i];
      break;
    }
  }

  const lastBandwidth =
    lastMiddle != null && lastUpper != null && lastLower != null && lastMiddle !== 0
      ? ((lastUpper - lastLower) / lastMiddle) * 100
      : null;

  return {
    middle,
    upper,
    lower,
    lastMiddle,
    lastUpper,
    lastLower,
    lastBandwidth,
    available: lastMiddle != null,
  };
}

/**
 * FibonacciRetracement — classic retracement levels over the last swing.
 *
 * Finds the most significant swing high and swing low in the last `lookback`
 * candles (default 100), then computes the standard Fib levels between them:
 *   - 0%   = swing high (in an uptrend) / swing low (in a downtrend)
 *   - 23.6%, 38.2%, 50%, 61.8%, 78.6%
 *   - 100% = the other extreme
 *
 * Direction: if the swing low is more recent than the swing high, we're in
 * an uptrend (expecting retracement DOWN from high → levels go high→low).
 * If the swing high is more recent, downtrend (retracement UP from low).
 *
 * Returns the 5 retracement levels + the swing extremes. `available: false`
 * when there aren't enough candles or the swing range is zero.
 */
export type FibLevel = {
  /** Retracement ratio (0.236, 0.382, 0.5, 0.618, 0.786). */
  ratio: number;
  /** Price at this retracement level. */
  price: number;
  /** Human-readable label, e.g. "38.2%". */
  label: string;
};

export type FibonacciResult = {
  swingHigh: number;
  swingLow: number;
  /** "up" if swing low is more recent (expecting pullback down from high). */
  direction: "up" | "down";
  levels: FibLevel[];
  available: boolean;
};

export function calculateFibonacciRetracement(
  highs: number[],
  lows: number[],
  opts: { lookback?: number } = {},
): FibonacciResult {
  const lookback = opts.lookback ?? 100;
  const n = highs.length;
  if (n < 2 || lookback < 2) {
    return {
      swingHigh: 0,
      swingLow: 0,
      direction: "up",
      levels: [],
      available: false,
    };
  }

  const start = Math.max(0, n - lookback);
  let swingHigh = -Infinity;
  let swingHighIdx = start;
  let swingLow = Infinity;
  let swingLowIdx = start;

  for (let i = start; i < n; i++) {
    if (highs[i] > swingHigh) {
      swingHigh = highs[i];
      swingHighIdx = i;
    }
    if (lows[i] < swingLow) {
      swingLow = lows[i];
      swingLowIdx = i;
    }
  }

  if (swingHigh === swingLow || !Number.isFinite(swingHigh) || !Number.isFinite(swingLow)) {
    return {
      swingHigh,
      swingLow,
      direction: "up",
      levels: [],
      available: false,
    };
  }

  // Direction: if the low came after the high (swingLowIdx > swingHighIdx),
  // the trend is UP (we retraced down from the high to find a higher low).
  // If the high came after the low, trend is DOWN.
  const direction: "up" | "down" = swingLowIdx >= swingHighIdx ? "up" : "down";

  const range = swingHigh - swingLow;
  const ratios = [
    { ratio: 0.236, label: "23.6%" },
    { ratio: 0.382, label: "38.2%" },
    { ratio: 0.5, label: "50.0%" },
    { ratio: 0.618, label: "61.8%" },
    { ratio: 0.786, label: "78.6%" },
  ];

  // In an uptrend: 0% = swingHigh, 100% = swingLow. Retracement = high - ratio*range.
  // In a downtrend: 0% = swingLow, 100% = swingHigh. Retracement = low + ratio*range.
  const levels: FibLevel[] = ratios.map((r) => ({
    ratio: r.ratio,
    price:
      direction === "up"
        ? swingHigh - r.ratio * range
        : swingLow + r.ratio * range,
    label: r.label,
  }));

  return {
    swingHigh,
    swingLow,
    direction,
    levels,
    available: true,
  };
}
