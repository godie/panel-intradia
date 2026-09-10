import { describe, it, expect } from "vitest";
import {
  calculatePositionSizePct,
  computeTradePnl,
  computeStats,
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
    );
    expect(stats.totalTrades).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(50);
    expect(stats.totalFees).toBe(25);
    expect(stats.avgPositionSizePct).toBe(75);
  });

  it("returns empty stats when there are no trades", () => {
    const stats = computeStats([], 10000, 10000, 0, 0);
    expect(stats.totalTrades).toBe(0);
    expect(stats.totalFees).toBe(0);
    expect(stats.avgPositionSizePct).toBe(0);
    expect(stats.finalEquity).toBe(10000);
  });

  it("rounds avgPositionSizePct to one decimal", () => {
    const stats = computeStats([trade(10, 10, 33.33), trade(-5, -5, 66.66)], 10050, 10000, 1, 0);
    expect(stats.avgPositionSizePct).toBeCloseTo(50, 0);
  });

  it("keeps profitFactor and best/worst trade aggregation intact", () => {
    const stats = computeStats(
      [trade(100, 10), trade(-20, -2), trade(30, 3)],
      10110,
      10000,
      0.5,
      0,
    );
    expect(stats.profitFactor).toBeCloseTo(130 / 20, 5);
    expect(stats.bestTradePct).toBe(10);
    expect(stats.worstTradePct).toBe(-2);
    expect(stats.avgHoldCandles).toBe(5);
  });
});