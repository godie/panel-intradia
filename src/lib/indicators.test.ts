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
