import { describe, it, expect } from "vitest";
import {
  calculatePositionSizePct,
  computeTradePnl,
  computeStats,
  computeDurationBuckets,
  emptyStats,
  type BacktestTrade,
} from "./backtest";

function trade(pnl: number, pnlPct: number, positionSizePct = 100): BacktestTrade {
  return {
    entryIndex: 0,
    exitIndex: 5,
    entryPrice: 100,
    exitPrice: 100 + pnlPct,
    entryTime: 0,
    exitTime: 5,
    pnl,
    pnlPct,
    holdCandles: 5,
    exitReason: "signal_exit",
    action: "BUY",
    positionSizePct,
    feesPaid: 0,
  };
}

/** A trade whose only meaningful field is its hold duration. */
function tradeHold(holdCandles: number): BacktestTrade {
  return { ...trade(1, 1), holdCandles };
}

/** Build an equity curve from a list of equity values (one point per candle). */
function equityCurve(equities: number[]): { candleIndex: number; time: number; equity: number; inPosition: boolean }[] {
  return equities.map((equity, i) => ({ candleIndex: i, time: i, equity, inPosition: false }));
}

describe("calculatePositionSizePct", () => {
  it("returns 100 for 'full' regardless of trade history", () => {
    expect(calculatePositionSizePct("full", [], 25)).toBe(100);
    expect(calculatePositionSizePct("full", [trade(10, 10)], 25)).toBe(100);
  });

  it("returns the configured percent for fixed_fractional", () => {
    expect(calculatePositionSizePct("fixed_fractional", [], 25)).toBe(25);
  });

  it("clamps fixed_fractional to the 1-100 range", () => {
    expect(calculatePositionSizePct("fixed_fractional", [], 150)).toBe(100);
    expect(calculatePositionSizePct("fixed_fractional", [], 0)).toBe(1);
    expect(calculatePositionSizePct("fixed_fractional", [], -10)).toBe(1);
  });

  it("falls back to 100% during kelly warmup (fewer than 5 closed trades)", () => {
    const four = [trade(10, 10), trade(-5, -5), trade(10, 10), trade(-5, -5)];
    expect(calculatePositionSizePct("kelly", four, 25)).toBe(100);
    expect(calculatePositionSizePct("half_kelly", four, 25)).toBe(100);
  });

  it("sizes kelly proportionally to a positive edge", () => {
    // 3 wins of +10%, 2 losses of -5% → p=0.6, avgWin=10, avgLoss=5,
    // payoff=2 → f* = (0.6*2 - 0.4)/2 = 0.4 → 40%.
    const trades = [trade(10, 10), trade(10, 10), trade(10, 10), trade(-5, -5), trade(-5, -5)];
    expect(calculatePositionSizePct("kelly", trades, 25)).toBeCloseTo(40, 5);
  });

  it("uses half the kelly fraction for half_kelly", () => {
    const trades = [trade(10, 10), trade(10, 10), trade(10, 10), trade(-5, -5), trade(-5, -5)];
    expect(calculatePositionSizePct("half_kelly", trades, 25)).toBeCloseTo(20, 5);
  });

  it("floors at 1% when the edge is negative", () => {
    // 2 wins of +2%, 3 losses of -5% → p=0.4, avgWin=2, avgLoss=5,
    // payoff=0.4 → f* = (0.4*0.4 - 0.6)/0.4 = -1.1 → floor at 1%.
    const trades = [trade(2, 2), trade(2, 2), trade(-5, -5), trade(-5, -5), trade(-5, -5)];
    expect(calculatePositionSizePct("kelly", trades, 25)).toBe(1);
    expect(calculatePositionSizePct("half_kelly", trades, 25)).toBe(1);
  });

  it("returns 100 when there are no losses (guard)", () => {
    const allWins = [trade(10, 10), trade(10, 10), trade(10, 10), trade(10, 10), trade(10, 10)];
    expect(calculatePositionSizePct("kelly", allWins, 25)).toBe(100);
  });

  it("returns 100 when there are no wins (guard)", () => {
    const allLosses = [trade(-5, -5), trade(-5, -5), trade(-5, -5), trade(-5, -5), trade(-5, -5)];
    expect(calculatePositionSizePct("kelly", allLosses, 25)).toBe(100);
  });
});

describe("computeTradePnl", () => {
  it("returns gross = net when fees are disabled", () => {
    const r = computeTradePnl({
      entryPrice: 100,
      exitPrice: 110,
      positionDirection: 1,
      entryNotional: 10000,
      feePerSide: 0,
    });
    expect(r.grossPnl).toBe(1000);
    expect(r.netPnl).toBe(1000);
    expect(r.netPnlPct).toBe(10);
    expect(r.feesPaid).toBe(0);
  });

  it("charges fees on both entry and exit notional", () => {
    // 10 bp per side: entry fee = 10000*0.001 = 10, exit fee = 11000*0.001 = 11.
    const r = computeTradePnl({
      entryPrice: 100,
      exitPrice: 110,
      positionDirection: 1,
      entryNotional: 10000,
      feePerSide: 0.001,
    });
    expect(r.feesPaid).toBeCloseTo(21, 5);
    expect(r.netPnl).toBeCloseTo(979, 5);
    expect(r.netPnlPct).toBeCloseTo(9.79, 5);
  });

  it("is symmetric for short positions (loses on an up move)", () => {
    const r = computeTradePnl({
      entryPrice: 100,
      exitPrice: 110,
      positionDirection: -1,
      entryNotional: 10000,
      feePerSide: 0.001,
    });
    expect(r.grossPnl).toBe(-1000);
    expect(r.netPnl).toBeCloseTo(-1021, 5);
  });

  it("computes losses net of fees on a losing long", () => {
    const r = computeTradePnl({
      entryPrice: 100,
      exitPrice: 90,
      positionDirection: 1,
      entryNotional: 10000,
      feePerSide: 0.001,
    });
    expect(r.grossPnl).toBe(-1000);
    expect(r.feesPaid).toBeCloseTo(19, 5); // 10 entry + 9 exit
    expect(r.netPnl).toBeCloseTo(-1019, 5);
    expect(r.netPnlPct).toBeCloseTo(-10.19, 5);
  });
});

describe("computeStats", () => {
  it("aggregates totalFees and avgPositionSizePct", () => {
    const stats = computeStats(
      [trade(100, 10, 50), trade(-50, -5, 100)],
      10500,
      10000,
      2,
      25,
      [],
      "4h",
    );
    expect(stats.totalTrades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(50);
    expect(stats.totalFees).toBe(25);
    expect(stats.avgPositionSizePct).toBe(75);
  });

  it("returns empty stats when there are no trades", () => {
    const stats = computeStats([], 10000, 10000, 0, 0, [], "4h");
    expect(stats.totalTrades).toBe(0);
    expect(stats.totalFees).toBe(0);
    expect(stats.avgPositionSizePct).toBe(0);
    expect(stats.finalEquity).toBe(10000);
  });

  it("rounds avgPositionSizePct to one decimal", () => {
    const stats = computeStats([trade(10, 10, 33.33), trade(-5, -5, 66.66)], 10050, 10000, 1, 0, [], "4h");
    expect(stats.avgPositionSizePct).toBeCloseTo(50, 0);
  });

  it("keeps profitFactor and best/worst trade aggregation intact", () => {
    const stats = computeStats(
      [trade(100, 10), trade(-20, -2), trade(30, 3)],
      10110,
      10000,
      0.5,
      0,
      [],
      "4h",
    );
    expect(stats.profitFactor).toBeCloseTo(130 / 20, 5);
    expect(stats.bestTradePct).toBe(10);
    expect(stats.worstTradePct).toBe(-2);
    expect(stats.avgHoldCandles).toBe(5);
  });
});

describe("emptyStats", () => {
  it("uses the unavailable contract for ratios and zeroes for counters", () => {
    const stats = emptyStats(10000);
    expect(Number.isNaN(stats.sharpeRatio)).toBe(true);
    expect(Number.isNaN(stats.sortinoRatio)).toBe(true);
    expect(Number.isNaN(stats.calmarRatio)).toBe(true);
    expect(stats.maxWinStreak).toBe(0);
    expect(stats.maxLossStreak).toBe(0);
    expect(stats.avgWinPct).toBe(0);
    expect(stats.avgLossPct).toBe(0);
    expect(stats.expectancyPct).toBe(0);
    expect(stats.finalEquity).toBe(10000);
  });
});

describe("computeStats — risk metrics", () => {
  // 100 → 110 → 132 → 118.8 gives per-candle returns of +0.1, +0.2, -0.1.
  const curve = equityCurve([100, 110, 132, 118.8]);

  it("annualizes Sharpe/Sortino from per-candle equity returns", () => {
    const stats = computeStats([trade(10, 10)], 118.8, 100, 5, 0, curve, "1d");
    expect(stats.sharpeRatio).toBeCloseTo(10.21, 2);
    expect(stats.sortinoRatio).toBeCloseTo(22.06, 2);
  });

  it("scales Sharpe with the interval's candles-per-year", () => {
    const daily = computeStats([trade(10, 10)], 118.8, 100, 5, 0, curve, "1d");
    const hourly = computeStats([trade(10, 10)], 118.8, 100, 5, 0, curve, "1h");
    // sqrt(8760 / 365) = sqrt(24)
    expect(hourly.sharpeRatio).toBeCloseTo(daily.sharpeRatio * Math.sqrt(24), 1);
  });

  it("falls back to the 1d annualization for unknown intervals", () => {
    const daily = computeStats([trade(10, 10)], 118.8, 100, 5, 0, curve, "1d");
    const unknown = computeStats([trade(10, 10)], 118.8, 100, 5, 0, curve, "7m");
    expect(unknown.sharpeRatio).toBe(daily.sharpeRatio);
  });

  it("leaves Sharpe/Sortino undefined for a flat or constant-return series", () => {
    const flat = computeStats([trade(10, 10)], 100, 100, 0, 0, equityCurve([100, 100, 100]), "1d");
    expect(Number.isNaN(flat.sharpeRatio)).toBe(true);
    expect(Number.isNaN(flat.sortinoRatio)).toBe(true);
    expect(Number.isNaN(flat.calmarRatio)).toBe(true); // maxDrawdown 0

    // Doubling every candle gives bit-identical returns (+1), so stddev is 0.
    const constant = computeStats([trade(10, 10)], 800, 100, 0, 0, equityCurve([100, 200, 400, 800]), "1d");
    expect(Number.isNaN(constant.sharpeRatio)).toBe(true); // stddev 0
    expect(Number.isNaN(constant.sortinoRatio)).toBe(true); // no downside returns
  });

  it("computes Calmar as total return over max drawdown", () => {
    const stats = computeStats([trade(1250, 12.5)], 11250, 10000, 4, 0, equityCurve([100, 100]), "1d");
    expect(stats.calmarRatio).toBeCloseTo(3.13, 2); // 12.5 / 4
  });

  it("returns a negative Calmar when the strategy loses money", () => {
    const stats = computeStats([trade(-1000, -10)], 9000, 10000, 10, 0, equityCurve([100, 100]), "1d");
    expect(stats.calmarRatio).toBeCloseTo(-1, 2);
  });

  it("tracks the longest win/loss streaks in trade order", () => {
    const stats = computeStats(
      [trade(1, 1), trade(1, 1), trade(1, 1), trade(-1, -1), trade(-1, -1), trade(1, 1)],
      10000,
      10000,
      5,
      0,
      equityCurve([100, 100]),
      "1d",
    );
    expect(stats.maxWinStreak).toBe(3);
    expect(stats.maxLossStreak).toBe(2);
  });

  it("computes average win/loss percent and expectancy", () => {
    const stats = computeStats(
      [trade(100, 10), trade(200, 20), trade(300, 30), trade(-50, -10)],
      10000,
      10000,
      5,
      0,
      equityCurve([100, 100]),
      "1d",
    );
    expect(stats.avgWinPct).toBe(20);
    expect(stats.avgLossPct).toBe(-10);
    expect(stats.expectancyPct).toBeCloseTo(12.5, 2); // 20 * 0.75 - 10 * 0.25
  });
});

describe("computeDurationBuckets", () => {
  it("returns the five labeled buckets, all empty by default", () => {
    const buckets = computeDurationBuckets([]);
    expect(buckets.map((b) => b.label)).toEqual(["1-5", "6-10", "11-20", "21-50", "50+"]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("counts each trade in the bucket containing its hold time", () => {
    const holds = [1, 3, 5, 6, 10, 11, 20, 21, 50, 51, 200];
    const buckets = computeDurationBuckets(holds.map(tradeHold));
    const counts = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    expect(counts).toEqual({ "1-5": 3, "6-10": 2, "11-20": 2, "21-50": 2, "50+": 2 });
    // Every trade is counted exactly once — no orphan hold times.
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(holds.length);
  });

  it("includes each bucket's upper bound (5, 10, 20, 50 are not orphaned)", () => {
    const buckets = computeDurationBuckets([5, 10, 20, 50].map(tradeHold));
    const counts = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    expect(counts).toEqual({ "1-5": 1, "6-10": 1, "11-20": 1, "21-50": 1, "50+": 0 });
  });

  it("puts every long hold in the overflow bucket", () => {
    const buckets = computeDurationBuckets([51, 500, 9999].map(tradeHold));
    expect(buckets[4].count).toBe(3);
    expect(buckets.slice(0, 4).every((b) => b.count === 0)).toBe(true);
  });
});