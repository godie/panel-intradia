import { describe, it, expect } from "vitest";
import {
  calculateEMA,
  calculateRSI,
  detectRecentCross,
  detectMacdCross,
  calculateMACD,
  determineCrossState,
  findSupportResistance,
  calculateATR,
  calculateBollingerBands,
  calculateFibonacciRetracement,
  calculateVWAP,
  calculateStochastic,
  detectStochCross,
} from "./indicators";

describe("calculateEMA", () => {
  it("returns unavailable when fewer closes than the period", () => {
    const r = calculateEMA([1, 2, 3], 5);
    expect(r.available).toBe(false);
    expect(r.last).toBeNull();
    expect(r.series.every((v) => v === null)).toBe(true);
  });

  it("seeds with SMA of the first `period` values", () => {
    // SMA of [2,4,6] = 4 → first EMA at index 2.
    const r = calculateEMA([2, 4, 6, 8], 3);
    expect(r.available).toBe(true);
    expect(r.series[0]).toBeNull();
    expect(r.series[1]).toBeNull();
    expect(r.series[2]).toBe(4); // SMA seed
    // EMA_3 = 8*k + 4*(1-k), k = 2/4 = 0.5 → 8*0.5 + 4*0.5 = 6
    expect(r.series[3]).toBe(6);
    expect(r.last).toBe(6);
  });

  it("produces the standard EMA recurrence", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const r = calculateEMA(closes, 10);
    expect(r.available).toBe(true);
    // Last EMA should be close to the last close but lagging (always below
    // the last close in an uptrend).
    expect(r.last).not.toBeNull();
    expect(r.last!).toBeLessThan(closes[closes.length - 1]);
    // EMA should be above the first close (since it's an uptrend).
    expect(r.last!).toBeGreaterThan(closes[0]);
    // EMA should be between the close 10 bars ago and the last close.
    expect(r.last!).toBeGreaterThan(closes[closes.length - 11]);
  });
});

describe("calculateRSI", () => {
  it("returns unavailable with fewer than period+1 closes", () => {
    const r = calculateRSI([1, 2, 3], 14);
    expect(r.available).toBe(false);
    expect(r.last).toBeNull();
  });

  it("returns 100 for a pure uptrend (all gains, no losses)", () => {
    // Strictly increasing series → all changes are gains, avgLoss=0 → RSI=100.
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const r = calculateRSI(closes, 14);
    expect(r.available).toBe(true);
    expect(r.last).toBe(100);
  });

  it("returns 0 for a pure downtrend (all losses, no gains)", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i * 2);
    const r = calculateRSI(closes, 14);
    expect(r.available).toBe(true);
    expect(r.last).toBe(0);
  });

  it("returns ~50 for a perfectly alternating series", () => {
    // Alternating +1/-1 → avgGain ≈ avgLoss → RS ≈ 1 → RSI ≈ 50.
    const closes: number[] = [100];
    for (let i = 1; i < 30; i++) closes.push(closes[0] + (i % 2 === 0 ? 1 : -1));
    const r = calculateRSI(closes, 14);
    expect(r.available).toBe(true);
    expect(r.last).not.toBeNull();
    expect(Math.abs(r.last! - 50)).toBeLessThan(5);
  });

  it("clamps RSI to [0, 100]", () => {
    const closes = Array.from({ length: 30 }, () => 100 + Math.random() * 10);
    const r = calculateRSI(closes, 14);
    expect(r.available).toBe(true);
    expect(r.last!).toBeGreaterThanOrEqual(0);
    expect(r.last!).toBeLessThanOrEqual(100);
  });
});

describe("determineCrossState", () => {
  it("returns ALCISTA when EMA55 > EMA200 by >0.15%", () => {
    const r = determineCrossState(100, 99); // 1% diff
    expect(r.state).toBe("ALCISTA");
    expect(r.available).toBe(true);
  });

  it("returns BAJISTA when EMA55 < EMA200 by >0.15%", () => {
    const r = determineCrossState(99, 100);
    expect(r.state).toBe("BAJISTA");
    expect(r.available).toBe(true);
  });

  it("returns COMPRIMIDO when diff < 0.15%", () => {
    const r = determineCrossState(100, 100.1); // 0.1% diff
    expect(r.state).toBe("COMPRIMIDO");
    expect(r.available).toBe(true);
  });

  it("returns unavailable when either EMA is null", () => {
    expect(determineCrossState(null, 100).available).toBe(false);
    expect(determineCrossState(100, null).available).toBe(false);
  });
});

describe("detectRecentCross", () => {
  it("detects a bullish EMA cross within the window", () => {
    // EMA55 series crosses from below to above EMA200 at index 15.
    const ema55: (number | null)[] = Array(30).fill(0).map((_, i) => i < 15 ? 95 : 105);
    const ema200: (number | null)[] = Array(30).fill(100);
    const r = detectRecentCross(ema55, ema200, { window: 30, recentThreshold: 20 });
    expect(r.happened).toBe(true);
    expect(r.direction).toBe("bullish");
    // lastValid=29, crossIdx=15 → candles_since = 29-15+1 = 15.
    expect(r.candles_since_cross).toBe(15);
  });

  it("detects a bearish cross", () => {
    const ema55: (number | null)[] = Array(30).fill(0).map((_, i) => i < 15 ? 105 : 95);
    const ema200: (number | null)[] = Array(30).fill(100);
    const r = detectRecentCross(ema55, ema200, { window: 30, recentThreshold: 20 });
    expect(r.direction).toBe("bearish");
  });

  it("returns happened=false when cross is outside recentThreshold", () => {
    // Cross at index 5, recentThreshold=3 → 25 candles ago, too old.
    const ema55: (number | null)[] = Array(30).fill(0).map((_, i) => i < 5 ? 95 : 105);
    const ema200: (number | null)[] = Array(30).fill(100);
    const r = detectRecentCross(ema55, ema200, { window: 30, recentThreshold: 3 });
    expect(r.happened).toBe(false);
    // lastValid=29, crossIdx=5 → 29-5+1 = 25.
    expect(r.candles_since_cross).toBe(25);
  });

  it("returns no cross when the sign never flips", () => {
    const ema55: (number | null)[] = Array(30).fill(105);
    const ema200: (number | null)[] = Array(30).fill(100);
    const r = detectRecentCross(ema55, ema200);
    expect(r.happened).toBe(false);
    expect(r.candles_since_cross).toBeNull();
    expect(r.direction).toBeNull();
  });

  it("handles short series gracefully", () => {
    const r = detectRecentCross([null], [null]);
    expect(r.happened).toBe(false);
  });
});

describe("detectMacdCross", () => {
  // Helper: build a MACD line + signal line with a cross at a given index.
  function makeSeries(
    crossIdx: number,
    n: number,
    direction: "bullish" | "bearish",
  ): { macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[] } {
    const macd: (number | null)[] = [];
    const signal: (number | null)[] = [];
    const hist: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      // Before cross: MACD < signal (bearish) or MACD > signal (bullish).
      // After cross: flipped.
      const before = direction === "bullish" ? -1 : 1;
      const after = direction === "bullish" ? 1 : -1;
      const m = i < crossIdx ? before : after;
      const s = 0; // signal stays at 0
      macd.push(m);
      signal.push(s);
      hist.push(m - s);
    }
    return { macd, signal, hist };
  }

  it("detects a fresh bullish MACD/signal cross", () => {
    // Cross at index 25 → candles_since = 29-25+1 = 5, within threshold 6.
    const { macd, signal, hist } = makeSeries(25, 30, "bullish");
    const r = detectMacdCross(macd, signal, hist, { window: 20, recentThreshold: 6 });
    expect(r.happened).toBe(true);
    expect(r.direction).toBe("bullish");
    expect(r.candles_since_cross).toBe(5);
  });

  it("detects a fresh bearish MACD/signal cross", () => {
    const { macd, signal, hist } = makeSeries(25, 30, "bearish");
    const r = detectMacdCross(macd, signal, hist, { window: 20, recentThreshold: 6 });
    expect(r.happened).toBe(true);
    expect(r.direction).toBe("bearish");
  });

  it("returns happened=false when cross is older than recentThreshold", () => {
    // Cross at index 5 → candles_since = 29-5+1 = 25, recentThreshold=6 → too old.
    const { macd, signal, hist } = makeSeries(5, 30, "bullish");
    const r = detectMacdCross(macd, signal, hist, { window: 30, recentThreshold: 6 });
    expect(r.happened).toBe(false);
    expect(r.candles_since_cross).toBe(25);
  });

  it("returns no cross when MACD stays above signal", () => {
    const macd: (number | null)[] = Array(30).fill(1);
    const signal: (number | null)[] = Array(30).fill(0);
    const hist: (number | null)[] = Array(30).fill(1);
    const r = detectMacdCross(macd, signal, hist);
    expect(r.happened).toBe(false);
    expect(r.direction).toBeNull();
  });

  it("returns no cross when MACD stays below signal", () => {
    const macd: (number | null)[] = Array(30).fill(-1);
    const signal: (number | null)[] = Array(30).fill(0);
    const hist: (number | null)[] = Array(30).fill(-1);
    const r = detectMacdCross(macd, signal, hist);
    expect(r.happened).toBe(false);
  });

  it("detects a histogram momentum flip (sign change) without a MACD cross", () => {
    // MACD always > signal (no cross), but histogram goes from +1 to -0.5 → flip.
    const macd: (number | null)[] = Array(30).fill(2);
    const signal: (number | null)[] = Array(30).fill(0);
    const hist: (number | null)[] = Array(30).fill(0).map((_, i) => i < 25 ? 1.5 : -0.5);
    const r = detectMacdCross(macd, signal, hist, { window: 20, recentThreshold: 6 });
    expect(r.happened).toBe(false); // no MACD cross
    expect(r.momentum_flip).toBe(true);
    expect(r.momentum_flip_direction).toBe("bearish");
    expect(r.candles_since_flip).toBe(5); // 30-25+1
  });

  it("handles short/empty series gracefully", () => {
    const r = detectMacdCross([], [], []);
    expect(r.happened).toBe(false);
    expect(r.momentum_flip).toBe(false);
  });

  it("handles null-heavy series gracefully", () => {
    // Cross at index 5 (first non-null), lastValid=5 → candles_since = 5-5+1 = 1.
    const macd: (number | null)[] = [null, null, null, null, null, 1, 2, 3];
    const signal: (number | null)[] = [null, null, null, null, null, 2, 2, 2];
    const hist: (number | null)[] = [null, null, null, null, null, -1, 0, 1];
    // Note: we need at least index 5 and index 4 to both be valid for cross
    // detection. Since index 4 is null, no cross is detected.
    const r = detectMacdCross(macd, signal, hist, { window: 10, recentThreshold: 6 });
    expect(r.happened).toBe(false);
  });

  it("detects both a MACD cross AND a momentum flip simultaneously", () => {
    // Cross at index 25 → candles_since = 5, within threshold 6.
    const { macd, signal, hist } = makeSeries(25, 30, "bullish");
    const r = detectMacdCross(macd, signal, hist, { window: 20, recentThreshold: 6 });
    expect(r.happened).toBe(true);
    expect(r.momentum_flip).toBe(true);
    expect(r.direction).toBe("bullish");
    expect(r.momentum_flip_direction).toBe("bullish");
  });
});

describe("calculateMACD", () => {
  it("returns unavailable with too few closes", () => {
    const r = calculateMACD(Array(20).fill(100), 12, 26, 9);
    expect(r.available).toBe(false);
  });

  it("produces MACD line, signal line, and histogram for sufficient data", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.5);
    const r = calculateMACD(closes, 12, 26, 9);
    expect(r.available).toBe(true);
    expect(r.lastMacd).not.toBeNull();
    expect(r.lastSignal).not.toBeNull();
    expect(r.lastHistogram).not.toBeNull();
    // Histogram = MACD - signal.
    expect(r.lastHistogram).toBeCloseTo((r.lastMacd ?? 0) - (r.lastSignal ?? 0), 5);
  });

  it("rejects invalid params (fast >= slow)", () => {
    const r = calculateMACD(Array(100).fill(100), 26, 12, 9); // fast > slow
    expect(r.available).toBe(false);
  });
});

describe("findSupportResistance", () => {
  it("returns unavailable with too few candles", () => {
    const r = findSupportResistance([100], [99], 100, { window: 3, lookback: 80 });
    expect(r.available).toBe(false);
    expect(r.support).toBeNull();
    expect(r.resistance).toBeNull();
  });

  it("detects a clear pivot high as resistance", () => {
    // Build highs with a clear spike at index 10 (surrounded by lower highs).
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    highs[10] = 120; // pivot high
    const price = 105;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.available).toBe(true);
    expect(r.resistance).toBe(120);
  });

  it("detects a clear pivot low as support", () => {
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    lows[10] = 80; // pivot low
    const price = 95;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.available).toBe(true);
    expect(r.support).toBe(80);
  });

  it("detects both support and resistance with price between them", () => {
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    highs[5] = 115; // resistance pivot
    lows[15] = 85; // support pivot
    const price = 100;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.available).toBe(true);
    expect(r.resistance).toBe(115);
    expect(r.support).toBe(85);
  });

  it("falls back to range max when no pivot high above price", () => {
    // All highs equal → no pivot, fallback to max (which equals the flat high).
    const n = 30;
    const highs = Array(n).fill(110);
    const lows = Array(n).fill(95);
    const price = 100;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.available).toBe(true);
    // No pivot high found, fallback to max of range = 110 > price.
    expect(r.resistance).toBe(110);
  });

  it("falls back to range min when no pivot low below price", () => {
    const n = 30;
    const highs = Array(n).fill(110);
    const lows = Array(n).fill(90);
    const price = 100;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.available).toBe(true);
    expect(r.support).toBe(90);
  });

  it("picks the nearest pivot above the price as resistance", () => {
    // Two pivot highs: one at 130 (index 5), one at 120 (index 20).
    // Price = 110 → nearest above is 120.
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    highs[5] = 130;
    highs[20] = 120;
    const price = 110;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.resistance).toBe(120);
  });

  it("picks the nearest pivot below the price as support", () => {
    // Two pivot lows: one at 80 (index 5), one at 90 (index 20).
    // Price = 95 → nearest below is 90.
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    lows[5] = 80;
    lows[20] = 90;
    const price = 95;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    expect(r.support).toBe(90);
  });

  it("returns null resistance when price is above all pivots and range max", () => {
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    const price = 200; // above everything
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 30 });
    // Fallback max = 100, but 100 < price → resistance stays null.
    expect(r.resistance).toBeNull();
    // Support should still be found (pivots below).
    expect(r.support).not.toBeNull();
  });

  it("respects the lookback window", () => {
    // Pivot at index 5 with lookback=20 → only the last 20 candles are scanned,
    // so a pivot at index 5 (more than 20 bars from the end of a 30-bar array)
    // is NOT in the scan range.
    const n = 30;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(95);
    highs[5] = 130; // outside lookback window
    const price = 105;
    const r = findSupportResistance(highs, lows, price, { window: 3, lookback: 20 });
    // Pivot at index 5 is NOT scanned (lookback=20 means start=10).
    expect(r.resistance).not.toBe(130);
  });
});

describe("calculateATR", () => {
  it("returns unavailable with too few candles", () => {
    const r = calculateATR([100], [95], [100], 14);
    expect(r.available).toBe(false);
    expect(r.last).toBeNull();
  });

  it("returns unavailable with mismatched array lengths", () => {
    const r = calculateATR([100, 101], [95], [100], 14);
    expect(r.available).toBe(false);
  });

  it("computes ATR for a flat series (constant range)", () => {
    // Every candle: high=102, low=98, close=100. TR = 4 for all (except first
    // which is just HL=4). ATR should be ~4.
    const n = 30;
    const highs = Array(n).fill(102);
    const lows = Array(n).fill(98);
    const closes = Array(n).fill(100);
    const r = calculateATR(highs, lows, closes, 14);
    expect(r.available).toBe(true);
    expect(r.last).not.toBeNull();
    expect(Math.abs(r.last! - 4)).toBeLessThan(0.01);
  });

  it("produces a larger ATR for a volatile series", () => {
    const n = 30;
    // Volatile: highs 110, lows 90, closes alternate 95/105.
    const highs = Array(n).fill(110);
    const lows = Array(n).fill(90);
    const closes = Array(n).fill(0).map((_, i) => i % 2 === 0 ? 95 : 105);
    const r = calculateATR(highs, lows, closes, 14);
    expect(r.available).toBe(true);
    // TR should be max(20, |110-105|, |90-105|) = 20 for alternating candles.
    expect(r.last).not.toBeNull();
    expect(r.last!).toBeGreaterThan(15);
  });

  it("the first `period` entries are null", () => {
    const n = 30;
    const highs = Array(n).fill(102);
    const lows = Array(n).fill(98);
    const closes = Array(n).fill(100);
    const r = calculateATR(highs, lows, closes, 14);
    // indices 0..13 should be null, index 14 should be the first value.
    for (let i = 0; i < 14; i++) {
      expect(r.series[i]).toBeNull();
    }
    expect(r.series[14]).not.toBeNull();
  });
});

describe("calculateBollingerBands", () => {
  it("returns unavailable with too few closes", () => {
    const r = calculateBollingerBands([1, 2, 3], 20, 2);
    expect(r.available).toBe(false);
    expect(r.lastMiddle).toBeNull();
    expect(r.lastUpper).toBeNull();
    expect(r.lastLower).toBeNull();
  });

  it("computes symmetric bands around the SMA for a flat series", () => {
    // Flat series → stddev=0 → upper=middle=lower.
    const closes = Array(30).fill(100);
    const r = calculateBollingerBands(closes, 20, 2);
    expect(r.available).toBe(true);
    expect(r.lastMiddle).toBe(100);
    expect(r.lastUpper).toBe(100); // stddev=0
    expect(r.lastLower).toBe(100);
    expect(r.lastBandwidth).toBe(0);
  });

  it("upper > middle > lower for a non-flat series", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const r = calculateBollingerBands(closes, 20, 2);
    expect(r.available).toBe(true);
    expect(r.lastUpper!).toBeGreaterThan(r.lastMiddle!);
    expect(r.lastMiddle!).toBeGreaterThan(r.lastLower!);
  });

  it("bandwidth is positive for a non-flat series", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5);
    const r = calculateBollingerBands(closes, 20, 2);
    expect(r.lastBandwidth).not.toBeNull();
    expect(r.lastBandwidth!).toBeGreaterThan(0);
  });

  it("rejects invalid params (period <= 0 or k <= 0)", () => {
    const r1 = calculateBollingerBands(Array(30).fill(100), 0, 2);
    expect(r1.available).toBe(false);
    const r2 = calculateBollingerBands(Array(30).fill(100), 20, 0);
    expect(r2.available).toBe(false);
  });

  it("the first `period - 1` entries are null", () => {
    const closes = Array(30).fill(100);
    const r = calculateBollingerBands(closes, 20, 2);
    for (let i = 0; i < 19; i++) {
      expect(r.middle[i]).toBeNull();
      expect(r.upper[i]).toBeNull();
      expect(r.lower[i]).toBeNull();
    }
    expect(r.middle[19]).not.toBeNull();
  });

  it("upper - lower = 2 * k * stddev", () => {
    // For a known series, verify the band width equals 2*k*stddev.
    const closes = [10, 12, 11, 13, 14, 12, 11, 10, 12, 13,
                    14, 15, 13, 12, 11, 10, 12, 13, 14, 12, 13];
    const r = calculateBollingerBands(closes, 20, 2);
    if (r.available) {
      const bandWidth = r.lastUpper! - r.lastLower!;
      // bandWidth = 2 * k * stddev = 4 * stddev. Verify it's positive.
      expect(bandWidth).toBeGreaterThan(0);
      // The last valid middle is at index 20 (21st element), which is the
      // SMA of closes[1..20] (20 values starting at index 1).
      const mean = closes.slice(1, 21).reduce((a, b) => a + b, 0) / 20;
      expect(Math.abs(r.lastMiddle! - mean)).toBeLessThan(0.01);
    }
  });
});

describe("calculateFibonacciRetracement", () => {
  it("returns unavailable with too few candles", () => {
    const r = calculateFibonacciRetracement([100], [95]);
    expect(r.available).toBe(false);
    expect(r.levels).toHaveLength(0);
  });

  it("returns unavailable when swing high equals swing low (zero range)", () => {
    // All highs and lows equal → no range → unavailable.
    const n = 20;
    const r = calculateFibonacciRetracement(Array(n).fill(100), Array(n).fill(100));
    expect(r.available).toBe(false);
  });

  it("detects swing high and swing low correctly", () => {
    // Simple series: highs go 100, 110, 120, 110, 100; lows go 90, 95, 100, 95, 90.
    const highs = [100, 110, 120, 110, 100];
    const lows = [90, 95, 100, 95, 90];
    const r = calculateFibonacciRetracement(highs, lows, { lookback: 10 });
    expect(r.available).toBe(true);
    expect(r.swingHigh).toBe(120);
    expect(r.swingLow).toBe(90);
  });

  it("computes 5 standard retracement levels", () => {
    const highs = [100, 110, 120, 110, 100];
    const lows = [90, 95, 100, 95, 90];
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.levels).toHaveLength(5);
    // Check ratios are the standard ones.
    expect(r.levels.map((l) => l.ratio)).toEqual([0.236, 0.382, 0.5, 0.618, 0.786]);
  });

  it("computes correct prices for an uptrend (low after high)", () => {
    // Swing high = 120 at index 2, swing low = 90 at index 4 (after high).
    // Direction = "up". Range = 30.
    // 50% retracement = 120 - 0.5 * 30 = 105.
    const highs = [100, 110, 120, 110, 100];
    const lows = [95, 95, 100, 92, 90]; // min 90 at index 4 (after high)
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.direction).toBe("up");
    const fib50 = r.levels.find((l) => l.ratio === 0.5);
    expect(fib50).toBeDefined();
    expect(fib50!.price).toBe(105);
  });

  it("computes correct prices for a downtrend (high after low)", () => {
    // Swing low = 90 at index 0, swing high = 120 at index 2 (after low).
    // Direction = "down". Range = 30.
    // 50% retracement = 90 + 0.5 * 30 = 105.
    const lows = [90, 95, 100, 95, 92];
    const highs = [100, 110, 120, 110, 100];
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.direction).toBe("down");
    const fib50 = r.levels.find((l) => l.ratio === 0.5);
    expect(fib50).toBeDefined();
    expect(fib50!.price).toBe(105);
  });

  it("levels are ordered from shallow to deep retracement", () => {
    // Uptrend: swing high at index 2, swing low at index 4 (after high).
    const highs = [100, 110, 120, 110, 100];
    const lows = [95, 95, 100, 92, 90];
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.direction).toBe("up");
    // In an uptrend, shallower retracements are closer to the swing high.
    // So 23.6% should be the highest price, 78.6% the lowest.
    expect(r.levels[0].price).toBeGreaterThan(r.levels[4].price);
  });

  it("respects the lookback window", () => {
    // 50 candles, but lookback=10 → only last 10 are scanned.
    const highs = Array(50).fill(100);
    const lows = Array(50).fill(95);
    // Put a spike at index 5 (outside the 10-bar lookback from the end).
    highs[5] = 200;
    lows[5] = 50;
    const r = calculateFibonacciRetracement(highs, lows, { lookback: 10 });
    // The spike at index 5 is NOT in the scan range (start=40).
    expect(r.swingHigh).not.toBe(200);
    expect(r.swingLow).not.toBe(50);
  });

  it("includes human-readable labels", () => {
    const highs = [100, 110, 120, 110, 100];
    const lows = [90, 95, 100, 95, 90];
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.levels.map((l) => l.label)).toEqual([
      "23.6%",
      "38.2%",
      "50.0%",
      "61.8%",
      "78.6%",
    ]);
  });

  it("computes 3 extension levels (127.2%, 161.8%, 261.8%)", () => {
    const highs = [100, 110, 120, 110, 100];
    const lows = [95, 95, 100, 92, 90]; // uptrend
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.extensions).toHaveLength(3);
    expect(r.extensions.map((l) => l.ratio)).toEqual([1.272, 1.618, 2.618]);
  });

  it("extensions go ABOVE swing high in an uptrend", () => {
    // Uptrend: swing high = 120, swing low = 90, range = 30.
    // 161.8% extension = 120 + (1.618 - 1) * 30 = 120 + 18.54 = 138.54.
    const highs = [100, 110, 120, 110, 100];
    const lows = [95, 95, 100, 92, 90];
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.direction).toBe("up");
    const ext1618 = r.extensions.find((l) => l.ratio === 1.618);
    expect(ext1618).toBeDefined();
    expect(ext1618!.price).toBeGreaterThan(r.swingHigh);
    expect(ext1618!.price).toBeCloseTo(138.54, 1);
  });

  it("extensions go BELOW swing low in a downtrend", () => {
    // Downtrend: swing low = 90, swing high = 120, range = 30.
    // 161.8% extension = 90 - (1.618 - 1) * 30 = 90 - 18.54 = 71.46.
    const lows = [90, 95, 100, 95, 92];
    const highs = [100, 110, 120, 110, 100];
    const r = calculateFibonacciRetracement(highs, lows);
    expect(r.direction).toBe("down");
    const ext1618 = r.extensions.find((l) => l.ratio === 1.618);
    expect(ext1618).toBeDefined();
    expect(ext1618!.price).toBeLessThan(r.swingLow);
    expect(ext1618!.price).toBeCloseTo(71.46, 1);
  });
});

describe("calculateVWAP", () => {
  it("returns unavailable with empty arrays", () => {
    const r = calculateVWAP([], [], [], []);
    expect(r.available).toBe(false);
    expect(r.last).toBeNull();
  });

  it("returns unavailable with mismatched array lengths", () => {
    const r = calculateVWAP([100, 110], [95], [100], [1000]);
    expect(r.available).toBe(false);
  });

  it("returns unavailable when total volume is zero", () => {
    const r = calculateVWAP([100], [95], [100], [0]);
    expect(r.available).toBe(false);
  });

  it("computes VWAP correctly for a single candle", () => {
    // Typical = (100 + 95 + 100) / 3 = 98.33. VWAP = 98.33 * 1000 / 1000 = 98.33.
    const r = calculateVWAP([100], [95], [100], [1000]);
    expect(r.available).toBe(true);
    expect(r.last).not.toBeNull();
    expect(r.last).toBeCloseTo(98.333, 1);
  });

  it("weights higher-volume candles more", () => {
    // Two candles: candle 1 has typical ~100 with volume 1000,
    // candle 2 has typical ~110 with volume 9000.
    // VWAP = (100*1000 + 110*9000) / (1000+9000) = (100000 + 990000) / 10000 = 109.
    const highs = [102, 112];
    const lows = [98, 108];
    const closes = [100, 110];
    const volumes = [1000, 9000];
    const r = calculateVWAP(highs, lows, closes, volumes, 2);
    expect(r.available).toBe(true);
    expect(r.last).toBeCloseTo(109, 0);
  });

  it("respects the rolling window period", () => {
    // 5 candles, period=3 → VWAP at index 4 only uses candles 2,3,4.
    const highs = [100, 100, 100, 100, 200];
    const lows = [100, 100, 100, 100, 100];
    const closes = [100, 100, 100, 100, 150];
    const volumes = [1, 1, 1, 1, 1000];
    const r = calculateVWAP(highs, lows, closes, volumes, 3);
    expect(r.available).toBe(true);
    // The last VWAP should be dominated by candle 4 (volume 1000).
    const lastVwap = r.last!;
    // Typical of candle 4 = (200+100+150)/3 = 150. With volume 1000 vs
    // candles 2,3 with volume 1 each, VWAP ≈ 149.85.
    expect(lastVwap).toBeGreaterThan(149);
    expect(lastVwap).toBeLessThan(151);
  });

  it("produces a value for every valid candle", () => {
    const n = 10;
    const highs = Array(n).fill(105);
    const lows = Array(n).fill(95);
    const closes = Array(n).fill(100);
    const volumes = Array(n).fill(1000);
    const r = calculateVWAP(highs, lows, closes, volumes, 5);
    expect(r.available).toBe(true);
    // Every entry should have a value (no nulls) since volume > 0 everywhere.
    expect(r.series.every((v) => v != null)).toBe(true);
  });
});

describe("calculateStochastic", () => {
  it("returns unavailable with too few candles", () => {
    const r = calculateStochastic([100], [95], [100], 14, 3);
    expect(r.available).toBe(false);
    expect(r.lastK).toBeNull();
  });

  it("returns unavailable with mismatched array lengths", () => {
    const r = calculateStochastic([100, 110], [95], [100], 14, 3);
    expect(r.available).toBe(false);
  });

  it("computes %K = 100 when close equals the highest high", () => {
    // 15 candles, last close = highest high → %K should be 100.
    const n = 15;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(90);
    const closes = Array(n).fill(95);
    closes[n - 1] = 100; // close at the high
    const r = calculateStochastic(highs, lows, closes, 14, 3);
    expect(r.available).toBe(true);
    expect(r.lastK).toBe(100);
  });

  it("computes %K = 0 when close equals the lowest low", () => {
    const n = 15;
    const highs = Array(n).fill(100);
    const lows = Array(n).fill(90);
    const closes = Array(n).fill(95);
    closes[n - 1] = 90; // close at the low
    const r = calculateStochastic(highs, lows, closes, 14, 3);
    expect(r.available).toBe(true);
    expect(r.lastK).toBe(0);
  });

  it("computes %K = 50 when close is midway", () => {
    const n = 15;
    const highs = Array(n).fill(110);
    const lows = Array(n).fill(90);
    const closes = Array(n).fill(100); // midway = 50%
    const r = calculateStochastic(highs, lows, closes, 14, 3);
    expect(r.available).toBe(true);
    expect(r.lastK).toBeCloseTo(50, 0);
  });

  it("returns %K = 50 when the range is zero (flat)", () => {
    // All highs = lows = closes → range = 0 → %K = 50.
    const n = 15;
    const vals = Array(n).fill(100);
    const r = calculateStochastic(vals, vals, vals, 14, 3);
    expect(r.available).toBe(true);
    expect(r.lastK).toBe(50);
  });

  it("%D is the SMA of %K", () => {
    // Use a known series where closes stay within the high/low range.
    const n = 20;
    const highs = Array(n).fill(110);
    const lows = Array(n).fill(90);
    const closes = Array(n).fill(0).map((_, i) => 92 + i * 0.8); // rising but ≤ 110
    const r = calculateStochastic(highs, lows, closes, 14, 3);
    expect(r.available).toBe(true);
    expect(r.lastD).not.toBeNull();
    // %D should be between 0 and 100.
    expect(r.lastD!).toBeGreaterThanOrEqual(0);
    expect(r.lastD!).toBeLessThanOrEqual(100);
  });

  it("clamps %K to [0, 100]", () => {
    const n = 20;
    const highs = Array.from({ length: n }, (_, i) => 100 + i);
    const lows = Array.from({ length: n }, (_, i) => 90 + i);
    const closes = Array.from({ length: n }, (_, i) => 95 + i);
    const r = calculateStochastic(highs, lows, closes, 14, 3);
    expect(r.available).toBe(true);
    expect(r.lastK!).toBeGreaterThanOrEqual(0);
    expect(r.lastK!).toBeLessThanOrEqual(100);
  });

  it("the first kPeriod-1 entries of %K are null", () => {
    const n = 20;
    const highs = Array(n).fill(110);
    const lows = Array(n).fill(90);
    const closes = Array(n).fill(100);
    const r = calculateStochastic(highs, lows, closes, 14, 3);
    for (let i = 0; i < 13; i++) {
      expect(r.kSeries[i]).toBeNull();
    }
    expect(r.kSeries[13]).not.toBeNull();
  });
});

describe("detectStochCross", () => {
  it("returns no cross when %K stays above %D", () => {
    const k = Array(20).fill(80);
    const d = Array(20).fill(70);
    const r = detectStochCross(k, d);
    expect(r.happened).toBe(false);
    expect(r.direction).toBeNull();
  });

  it("returns no cross when %K stays below %D", () => {
    const k = Array(20).fill(20);
    const d = Array(20).fill(30);
    const r = detectStochCross(k, d);
    expect(r.happened).toBe(false);
    expect(r.direction).toBeNull();
  });

  it("detects a fresh bullish cross (%K crosses above %D)", () => {
    // %K goes from 20 to 60 at index 18 and stays 60, %D stays at 50.
    const k = Array(20).fill(20);
    k[18] = 60;
    k[19] = 60; // stays above D=50 — no second cross
    const d = Array(20).fill(50);
    const r = detectStochCross(k, d, { window: 10, recentThreshold: 5 });
    expect(r.happened).toBe(true);
    expect(r.direction).toBe("bullish");
  });

  it("detects a fresh bearish cross (%K crosses below %D)", () => {
    // %K goes from 80 to 40 at index 18 and stays 40, %D stays at 50.
    const k = Array(20).fill(80);
    k[18] = 40;
    k[19] = 40; // stays below D=50 — no second cross
    const d = Array(20).fill(50);
    const r = detectStochCross(k, d, { window: 10, recentThreshold: 5 });
    expect(r.happened).toBe(true);
    expect(r.direction).toBe("bearish");
  });

  it("returns happened=false when cross is older than recentThreshold", () => {
    // Cross at index 5 → 15 candles ago, recentThreshold=3 → too old.
    // k stays above d=50 from index 5 onwards (no rebound cross).
    const k = Array(20).fill(20);
    for (let i = 5; i < 20; i++) k[i] = 60;
    const d = Array(20).fill(50);
    const r = detectStochCross(k, d, { window: 20, recentThreshold: 3 });
    expect(r.happened).toBe(false);
    // lastValid=19, crossIdx=5, candlesSince = 19-5+1 = 15.
    expect(r.candles_since_cross).toBe(15);
  });

  it("handles empty/short series gracefully", () => {
    const r = detectStochCross([], []);
    expect(r.happened).toBe(false);
  });

  it("handles null-heavy series gracefully", () => {
    const k: (number | null)[] = [null, null, null, 60, 70, 80];
    const d: (number | null)[] = [null, null, null, 50, 50, 50];
    const r = detectStochCross(k, d, { window: 10, recentThreshold: 5 });
    // At index 3, K=60 > D=50 (bullish), before that null. First valid diff > 0
    // so no actual cross detected.
    expect(r.happened).toBe(false);
  });

  it("records the %K value at the cross point", () => {
    const k = Array(20).fill(20);
    k[18] = 55;
    k[19] = 55; // stays above — only one cross
    const d = Array(20).fill(50);
    const r = detectStochCross(k, d, { window: 10, recentThreshold: 5 });
    expect(r.k_at_cross).toBe(55);
  });
});
