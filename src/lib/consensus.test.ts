import { describe, expect, it } from "vitest";
import { computeConsensus } from "@/lib/consensus";
import type { AnalysisResponse } from "@/lib/types";

/**
 * Fixture with every field an indicator-based strategy reads. Overrides let
 * each test describe only the market condition it cares about.
 *
 * With the seven built-in strategies (3 BUY / 3 SHORT / 1 HOLD) every
 * consensus level is reachable, so each test below pins one of them.
 */
function makeAnalysis(overrides: Partial<AnalysisResponse> = {}): AnalysisResponse {
  return {
    symbol: "BTCUSDT",
    timeframe: "4h",
    spot_price: 100,
    change_24h_pct: null,
    ema55: 90,
    ema200: 80,
    cross_state: "ALCISTA",
    cross_info: null,
    resistance: null,
    support: 100,
    rsi_14: 50,
    volume_24h_usd: null,
    trades_24h: null,
    high_24h: null,
    low_24h: null,
    macd: { line: 1, signal: 0.5, histogram: 1 },
    macd_cross: null,
    atr_14: null,
    bollinger: { upper: null, middle: null, lower: null, bandwidth: null },
    bollinger_squeeze: { is_squeezed: false, threshold_pct: 3, bandwidth: null },
    squeeze_breakout: {
      happened: false,
      direction: null,
      candles_since_breakout: null,
      bandwidth_before: null,
      bandwidth_after: null,
    },
    stop_loss_suggestion: null,
    fibonacci: null,
    vwap_20: null,
    stochastic: { k: 50, d: 50 },
    stoch_cross: {
      happened: true,
      candles_since_cross: 0,
      direction: "bullish",
      k_at_cross: 50,
    },
    ichimoku: {
      tenkan: null,
      kijun: null,
      senkou_a: null,
      senkou_b: null,
      chikou: null,
      cloud_color: "neutral",
      price_vs_cloud: "unknown",
    },
    structure_text: "",
    no_disponible: {
      spot_price: false,
      change_24h_pct: true,
      ema55: false,
      ema200: false,
      cross_state: false,
      cross_info: true,
      resistance: true,
      support: false,
      rsi_14: false,
      volume_24h_usd: true,
      high_24h: true,
      low_24h: true,
      macd: false,
      macd_cross: true,
      atr_14: true,
      bollinger: true,
      bollinger_squeeze: false,
      squeeze_breakout: true,
      stop_loss_suggestion: true,
      fibonacci: true,
      vwap_20: true,
      stochastic: false,
      stoch_cross: false,
      ichimoku: true,
      source: false,
    },
    series: {
      closes: [],
      ema55: [],
      ema200: [],
      rsi: [],
      macd_histogram: [],
      bollinger_upper: [],
      bollinger_lower: [],
      vwap: [],
      ichimoku_senkou_a: [],
      ichimoku_senkou_b: [],
      ichimoku_tenkan: [],
      ichimoku_kijun: [],
    },
    updated_at: "2026-01-01T00:00:00.000Z",
    source: "binance",
    ...overrides,
  };
}

/** No bearish cross fired — used by the short-side fixtures. */
const NO_CROSS = {
  happened: false,
  candles_since_cross: null,
  direction: null,
  k_at_cross: null,
} as const;

/** A payload where nothing is available — every strategy should abstain. */
function makeEmptyAnalysis(): AnalysisResponse {
  return makeAnalysis({
    spot_price: null,
    ema55: null,
    ema200: null,
    cross_state: null,
    support: null,
    rsi_14: null,
    macd: { line: null, signal: null, histogram: null },
    stochastic: { k: null, d: null },
    stoch_cross: { ...NO_CROSS },
  });
}

/** All three SHORT strategies fire; no BUY strategy clears the threshold. */
function makeStrongShortAnalysis(): AnalysisResponse {
  return makeAnalysis({
    cross_state: "BAJISTA",
    ema55: 120,
    ema200: 130,
    macd: { line: -1, signal: -1, histogram: -1 },
    rsi_14: 70,
    stochastic: { k: 80, d: 80 },
    stoch_cross: {
      happened: true,
      candles_since_cross: 0,
      direction: "bearish",
      k_at_cross: 80,
    },
    resistance: 100,
    bollinger: { upper: null, middle: null, lower: 110, bandwidth: null },
    squeeze_breakout: {
      happened: true,
      direction: "bearish",
      candles_since_breakout: 1,
      bandwidth_before: 2.5,
      bandwidth_after: 3.4,
    },
  });
}

describe("computeConsensus", () => {
  it("returns all seven strategies, in STRATEGY_LIST order", () => {
    const { results } = computeConsensus(makeAnalysis());
    expect(results.map((r) => r.strategyId)).toEqual([
      "trend_buy",
      "mean_reversion_buy",
      "breakout_buy",
      "trend_short",
      "mean_reversion_short",
      "breakout_short",
      "hold",
    ]);
    expect(results.every((r) => r.strategy != null)).toBe(true);
  });

  it("reports strong_buy when all three buy strategies clear the threshold", () => {
    const c = computeConsensus(makeAnalysis());

    expect(c.level).toBe("strong_buy");
    expect(c.votes).toEqual({ BUY: 3, SHORT: 0, HOLD: 0, WAIT: 4 });
    expect(c.avgConfidence).toBe(50);
    expect(c.scorePct).toBe(31);
  });

  it("reports strong_short when all three short strategies fire", () => {
    const c = computeConsensus(makeStrongShortAnalysis());

    expect(c.level).toBe("strong_short");
    expect(c.votes).toEqual({ BUY: 0, SHORT: 3, HOLD: 0, WAIT: 4 });
    expect(c.avgConfidence).toBe(52);
    expect(c.scorePct).toBe(-43);
  });

  it("reports short when only two short strategies fire", () => {
    const c = computeConsensus(
      makeAnalysis({
        cross_state: "BAJISTA",
        ema55: 120,
        ema200: 130,
        macd: { line: -1, signal: -0.5, histogram: -1 },
        stoch_cross: { ...NO_CROSS },
      }),
    );

    expect(c.level).toBe("short");
    expect(c.votes).toEqual({ BUY: 0, SHORT: 2, HOLD: 0, WAIT: 5 });
    expect(c.avgConfidence).toBe(47);
    expect(c.scorePct).toBe(-23);
  });

  it("reports buy when two buy strategies fire and none short", () => {
    const c = computeConsensus(
      makeAnalysis({
        cross_state: "COMPRIMIDO",
      }),
    );

    expect(c.level).toBe("buy");
    expect(c.votes).toEqual({ BUY: 2, SHORT: 0, HOLD: 1, WAIT: 4 });
    expect(c.avgConfidence).toBe(48);
    expect(c.scorePct).toBe(20);
  });

  it("abstains (mixed, zero score) when no indicator is available", () => {
    const c = computeConsensus(makeEmptyAnalysis());

    expect(c.level).toBe("mixed");
    expect(c.votes).toEqual({ BUY: 0, SHORT: 0, HOLD: 0, WAIT: 7 });
    expect(c.avgConfidence).toBe(9);
    expect(c.scorePct).toBe(0);
  });

  it("keeps scorePct inside the -100..100 range", () => {
    for (const data of [
      makeAnalysis(),
      makeStrongShortAnalysis(),
      makeEmptyAnalysis(),
    ]) {
      const { scorePct } = computeConsensus(data);
      expect(scorePct).toBeGreaterThanOrEqual(-100);
      expect(scorePct).toBeLessThanOrEqual(100);
    }
  });

  it("makes the score sign follow the dominant side", () => {
    expect(computeConsensus(makeAnalysis()).scorePct).toBeGreaterThan(0);
    expect(computeConsensus(makeStrongShortAnalysis()).scorePct).toBeLessThan(0);
  });
});
