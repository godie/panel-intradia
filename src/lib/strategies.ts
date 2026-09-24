/**
 * Strategy system — predefined trading strategies that evaluate the current
 * technical analysis signals and produce a combined recommendation (BUY,
 * HOLD, SHORT, or WAIT) with a confidence score and a breakdown of which
 * signals fired.
 *
 * All `description` fields in signals are i18n keys (prefixed `strategy.sig.`).
 * The StrategySelector component translates them with `t()`.
 */

import type { AnalysisResponse } from "./types";

export type StrategyAction = "BUY" | "HOLD" | "SHORT" | "WAIT";

export type StrategySignal = {
  name: string;
  fired: boolean;
  description: string;
  /** Numeric value to interpolate into description's `{val}` placeholder, if any. */
  descValue?: string;
  direction?: "bullish" | "bearish" | "neutral";
};

export type StrategyResult = {
  strategyId: string;
  strategyName: string;
  action: StrategyAction;
  confidence: number;
  signals: StrategySignal[];
  summaryKey: string;
  summaryParams: { conf: number; fired: number; total: number };
};

export type Strategy = {
  id: string;
  name: string;
  description: string;
  targetAction: StrategyAction;
  evaluate: (data: AnalysisResponse) => StrategySignal[];
};

function countFired(signals: StrategySignal[]): number {
  return signals.filter((s) => s.fired).length;
}

function confidence(signals: StrategySignal[]): number {
  if (signals.length === 0) return 0;
  return Math.round((countFired(signals) / signals.length) * 100);
}

function buildSummary(
  action: StrategyAction,
  conf: number,
  signals: StrategySignal[],
): { key: string; params: { conf: number; fired: number; total: number } } {
  const fired = countFired(signals);
  const total = signals.length;
  const key =
    action === "BUY"
      ? "strategy.summaryBuy"
      : action === "SHORT"
        ? "strategy.summaryShort"
        : action === "HOLD"
          ? "strategy.summaryHold"
          : "strategy.summaryWait";
  return { key, params: { conf, fired, total } };
}

export function evaluateStrategy(
  strategy: Strategy,
  data: AnalysisResponse,
): StrategyResult {
  const signals = strategy.evaluate(data);
  const conf = confidence(signals);
  const action: StrategyAction = conf >= 60 ? strategy.targetAction : "WAIT";
  const summary = buildSummary(action, conf, signals);
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    action,
    confidence: conf,
    signals,
    summaryKey: summary.key,
    summaryParams: summary.params,
  };
}

// ============================================================
// PREDEFINED STRATEGIES — descriptions are i18n keys
// ============================================================

export const TREND_BUY: Strategy = {
  id: "trend_buy",
  name: "strategy.trendBuy",
  description: "strategy.trendBuyDesc",
  targetAction: "BUY",
  evaluate: (data) => [
    {
      name: "EMA55 > EMA200",
      fired: data.cross_state === "ALCISTA",
      description: data.cross_state === "ALCISTA"
        ? "strategy.sig.emaBullish"
        : data.cross_state === "BAJISTA"
          ? "strategy.sig.emaBearish"
          : "strategy.sig.emaCompressed",
      direction: data.cross_state === "ALCISTA" ? "bullish" : "bearish",
    },
    {
      name: "RSI < 70",
      fired: data.rsi_14 != null && data.rsi_14 < 70,
      description:
        data.rsi_14 != null
          ? data.rsi_14 >= 70
            ? "strategy.sig.rsiOverbought"
            : data.rsi_14 <= 30
              ? "strategy.sig.rsiOversoldOpp"
              : "strategy.sig.rsiNeutral"
          : "strategy.sig.rsiNA",
      descValue: data.rsi_14 != null ? data.rsi_14.toFixed(1) : undefined,
      direction: data.rsi_14 != null && data.rsi_14 < 70 ? "bullish" : "bearish",
    },
    {
      name: "Price > EMA55",
      fired: data.spot_price != null && data.ema55 != null && data.spot_price > data.ema55,
      description:
        data.spot_price != null && data.ema55 != null
          ? data.spot_price > data.ema55
            ? "strategy.sig.priceAboveEma"
            : "strategy.sig.priceBelowEma"
          : "strategy.sig.dataInsufficient",
      direction: data.spot_price != null && data.ema55 != null && data.spot_price > data.ema55 ? "bullish" : "bearish",
    },
    {
      name: "MACD bullish cross or positive histogram",
      fired:
        (data.macd_cross?.happened === true && data.macd_cross.direction === "bullish") ||
        (data.macd.histogram != null && data.macd.histogram > 0),
      description:
        data.macd_cross?.happened === true && data.macd_cross.direction === "bullish"
          ? "strategy.sig.macdBullCross"
          : data.macd.histogram != null && data.macd.histogram > 0
            ? "strategy.sig.macdPositive"
            : "strategy.sig.macdNoBullConfirm",
      direction: "bullish",
    },
    {
      name: "Stochastic not overbought or fresh bullish cross",
      fired:
        (data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish") ||
        (data.stochastic.k != null && data.stochastic.k < 80),
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish"
          ? "strategy.sig.stochBullCross"
          : data.stochastic.k != null && data.stochastic.k < 80
            ? "strategy.sig.stochNotOverbought"
            : "strategy.sig.stochOverbought",
      descValue:
        !(data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish") &&
        data.stochastic.k != null && data.stochastic.k < 80
          ? data.stochastic.k.toFixed(1)
          : undefined,
      direction: "bullish",
    },
  ],
};

export const MEAN_REVERSION_BUY: Strategy = {
  id: "mean_reversion_buy",
  name: "strategy.meanRevBuy",
  description: "strategy.meanRevBuyDesc",
  targetAction: "BUY",
  evaluate: (data) => [
    {
      name: "RSI < 35 (oversold)",
      fired: data.rsi_14 != null && data.rsi_14 < 35,
      description:
        data.rsi_14 != null
          ? data.rsi_14 < 35
            ? "strategy.sig.rsiOversoldBuy"
            : "strategy.sig.rsiNotOversold"
          : "strategy.sig.rsiNA",
      descValue: data.rsi_14 != null ? data.rsi_14.toFixed(1) : undefined,
      direction: data.rsi_14 != null && data.rsi_14 < 35 ? "bullish" : "neutral",
    },
    {
      name: "Stochastic %K < 25",
      fired: data.stochastic.k != null && data.stochastic.k < 25,
      description:
        data.stochastic.k != null
          ? data.stochastic.k < 25
            ? "strategy.sig.stochOversoldBuy"
            : "strategy.sig.stochNotOversoldBuy"
          : "strategy.sig.stochNA",
      descValue: data.stochastic.k != null ? data.stochastic.k.toFixed(1) : undefined,
      direction: data.stochastic.k != null && data.stochastic.k < 25 ? "bullish" : "neutral",
    },
    {
      name: "Stochastic fresh bullish cross",
      fired: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish",
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish"
          ? "strategy.sig.stochBullConfirmed"
          : "strategy.sig.stochNoBullCross",
      direction: "bullish",
    },
    {
      name: "Price near support (< 2% above)",
      fired:
        data.spot_price != null && data.support != null && data.spot_price <= data.support * 1.02,
      description:
        data.spot_price != null && data.support != null
          ? "strategy.sig.priceNearSupport"
          : "strategy.sig.supportNA",
      descValue:
        data.spot_price != null && data.support != null
          ? (((data.spot_price - data.support) / data.support) * 100).toFixed(1)
          : undefined,
      direction: "bullish",
    },
    {
      name: "Not in squeeze (normal volatility)",
      fired: data.bollinger_squeeze?.is_squeezed !== true,
      description:
        data.bollinger_squeeze?.is_squeezed === true
          ? "strategy.sig.squeezeActive"
          : "strategy.sig.volatilityNormal",
      direction: "neutral",
    },
  ],
};

export const TREND_SHORT: Strategy = {
  id: "trend_short",
  name: "strategy.trendShort",
  description: "strategy.trendShortDesc",
  targetAction: "SHORT",
  evaluate: (data) => [
    {
      name: "EMA55 < EMA200",
      fired: data.cross_state === "BAJISTA",
      description: data.cross_state === "BAJISTA"
        ? "strategy.sig.emaBearishShort"
        : "strategy.sig.emaNoBearish",
      direction: data.cross_state === "BAJISTA" ? "bearish" : "bullish",
    },
    {
      name: "RSI > 30 (not oversold)",
      fired: data.rsi_14 != null && data.rsi_14 > 30,
      description:
        data.rsi_14 != null
          ? data.rsi_14 <= 30
            ? "strategy.sig.rsiOversoldShort"
            : "strategy.sig.rsiNotOversold"
          : "strategy.sig.rsiNA",
      descValue: data.rsi_14 != null ? data.rsi_14.toFixed(1) : undefined,
      direction: data.rsi_14 != null && data.rsi_14 > 30 ? "bearish" : "bullish",
    },
    {
      name: "Price < EMA55",
      fired: data.spot_price != null && data.ema55 != null && data.spot_price < data.ema55,
      description:
        data.spot_price != null && data.ema55 != null
          ? data.spot_price < data.ema55
            ? "strategy.sig.priceBelowEma"
            : "strategy.sig.priceAboveEma"
          : "strategy.sig.dataInsufficient",
      direction: data.spot_price != null && data.ema55 != null && data.spot_price < data.ema55 ? "bearish" : "bullish",
    },
    {
      name: "MACD bearish cross or negative histogram",
      fired:
        (data.macd_cross?.happened === true && data.macd_cross.direction === "bearish") ||
        (data.macd.histogram != null && data.macd.histogram < 0),
      description:
        data.macd_cross?.happened === true && data.macd_cross.direction === "bearish"
          ? "strategy.sig.macdBearCross"
          : data.macd.histogram != null && data.macd.histogram < 0
            ? "strategy.sig.macdNegative"
            : "strategy.sig.macdNoBearConfirm",
      direction: "bearish",
    },
    {
      name: "Stochastic not oversold or fresh bearish cross",
      fired:
        (data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish") ||
        (data.stochastic.k != null && data.stochastic.k > 20),
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish"
          ? "strategy.sig.stochBearCross"
          : data.stochastic.k != null && data.stochastic.k > 20
            ? "strategy.sig.stochNotOversold"
            : "strategy.sig.stochOversold",
      descValue:
        !(data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish") &&
        data.stochastic.k != null && data.stochastic.k > 20
          ? data.stochastic.k.toFixed(1)
          : undefined,
      direction: "bearish",
    },
  ],
};

export const BREAKOUT_BUY: Strategy = {
  id: "breakout_buy",
  name: "strategy.breakoutBuy",
  description: "strategy.breakoutBuyDesc",
  targetAction: "BUY",
  evaluate: (data) => [
    {
      name: "Bullish volatility breakout",
      fired:
        data.squeeze_breakout?.happened === true &&
        data.squeeze_breakout.direction === "bullish",
      description:
        data.squeeze_breakout?.happened === true &&
        data.squeeze_breakout.direction === "bullish"
          ? "strategy.sig.breakoutBull"
          : "strategy.sig.noBreakoutBull",
      direction: "bullish",
    },
    {
      name: "Price > upper Bollinger band",
      fired:
        data.spot_price != null &&
        data.bollinger.upper != null &&
        data.spot_price > data.bollinger.upper,
      description:
        data.spot_price != null && data.bollinger.upper != null
          ? data.spot_price > data.bollinger.upper
            ? "strategy.sig.priceAboveUpperBand"
            : "strategy.sig.priceNotAboveUpperBand"
          : "strategy.sig.dataInsufficient",
      direction: "bullish",
    },
    {
      name: "MACD bullish cross or positive histogram",
      fired:
        (data.macd_cross?.happened === true && data.macd_cross.direction === "bullish") ||
        (data.macd.histogram != null && data.macd.histogram > 0),
      description:
        data.macd_cross?.happened === true && data.macd_cross.direction === "bullish"
          ? "strategy.sig.macdBullCross"
          : data.macd.histogram != null && data.macd.histogram > 0
            ? "strategy.sig.macdPositive"
            : "strategy.sig.macdNoBullConfirm",
      direction: "bullish",
    },
    {
      name: "EMA55 > EMA200",
      fired: data.cross_state === "ALCISTA",
      description:
        data.cross_state === "ALCISTA"
          ? "strategy.sig.emaBullish"
          : data.cross_state === "BAJISTA"
            ? "strategy.sig.emaBearish"
            : "strategy.sig.emaCompressed",
      direction: data.cross_state === "ALCISTA" ? "bullish" : "bearish",
    },
    {
      name: "Stochastic not overbought or fresh bullish cross",
      fired:
        (data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish") ||
        (data.stochastic.k != null && data.stochastic.k < 80),
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish"
          ? "strategy.sig.stochBullCross"
          : data.stochastic.k != null && data.stochastic.k < 80
            ? "strategy.sig.stochNotOverbought"
            : "strategy.sig.stochOverbought",
      direction: "bullish",
    },
  ],
};

export const MEAN_REVERSION_SHORT: Strategy = {
  id: "mean_reversion_short",
  name: "strategy.meanRevShort",
  description: "strategy.meanRevShortDesc",
  targetAction: "SHORT",
  evaluate: (data) => [
    {
      name: "RSI > 65 (overbought)",
      fired: data.rsi_14 != null && data.rsi_14 > 65,
      description:
        data.rsi_14 != null
          ? data.rsi_14 > 65
            ? "strategy.sig.rsiOverbought"
            : "strategy.sig.rsiNotOverbought"
          : "strategy.sig.rsiNA",
      descValue: data.rsi_14 != null ? data.rsi_14.toFixed(1) : undefined,
      direction: data.rsi_14 != null && data.rsi_14 > 65 ? "bearish" : "neutral",
    },
    {
      name: "Stochastic %K > 75",
      fired: data.stochastic.k != null && data.stochastic.k > 75,
      description:
        data.stochastic.k != null
          ? data.stochastic.k > 75
            ? "strategy.sig.stochOverbought"
            : "strategy.sig.stochNotOverbought"
          : "strategy.sig.stochNA",
      descValue: data.stochastic.k != null ? data.stochastic.k.toFixed(1) : undefined,
      direction: data.stochastic.k != null && data.stochastic.k > 75 ? "bearish" : "neutral",
    },
    {
      name: "Stochastic fresh bearish cross",
      fired: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish",
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish"
          ? "strategy.sig.stochBearCross"
          : "strategy.sig.stochNoBearCross",
      direction: "bearish",
    },
    {
      name: "Price near resistance (< 2% below)",
      fired:
        data.spot_price != null &&
        data.resistance != null &&
        data.spot_price >= data.resistance * 0.98,
      description:
        data.spot_price != null && data.resistance != null
          ? "strategy.sig.priceNearResistance"
          : "strategy.sig.resistanceNA",
      descValue:
        data.spot_price != null && data.resistance != null
          ? (((data.resistance - data.spot_price) / data.resistance) * 100).toFixed(1)
          : undefined,
      direction: "bearish",
    },
    {
      name: "Not in squeeze (normal volatility)",
      fired: data.bollinger_squeeze?.is_squeezed !== true,
      description:
        data.bollinger_squeeze?.is_squeezed === true
          ? "strategy.sig.squeezeActive"
          : "strategy.sig.volatilityNormal",
      direction: "neutral",
    },
  ],
};

export const BREAKOUT_SHORT: Strategy = {
  id: "breakout_short",
  name: "strategy.breakoutShort",
  description: "strategy.breakoutShortDesc",
  targetAction: "SHORT",
  evaluate: (data) => [
    {
      name: "Bearish volatility breakout",
      fired:
        data.squeeze_breakout?.happened === true &&
        data.squeeze_breakout.direction === "bearish",
      description:
        data.squeeze_breakout?.happened === true &&
        data.squeeze_breakout.direction === "bearish"
          ? "strategy.sig.breakoutBear"
          : "strategy.sig.noBreakoutBear",
      direction: "bearish",
    },
    {
      name: "Price < lower Bollinger band",
      fired:
        data.spot_price != null &&
        data.bollinger.lower != null &&
        data.spot_price < data.bollinger.lower,
      description:
        data.spot_price != null && data.bollinger.lower != null
          ? data.spot_price < data.bollinger.lower
            ? "strategy.sig.priceBelowLowerBand"
            : "strategy.sig.priceNotBelowLowerBand"
          : "strategy.sig.dataInsufficient",
      direction: "bearish",
    },
    {
      name: "MACD bearish cross or negative histogram",
      fired:
        (data.macd_cross?.happened === true && data.macd_cross.direction === "bearish") ||
        (data.macd.histogram != null && data.macd.histogram < 0),
      description:
        data.macd_cross?.happened === true && data.macd_cross.direction === "bearish"
          ? "strategy.sig.macdBearCross"
          : data.macd.histogram != null && data.macd.histogram < 0
            ? "strategy.sig.macdNegative"
            : "strategy.sig.macdNoBearConfirm",
      direction: "bearish",
    },
    {
      name: "EMA55 < EMA200",
      fired: data.cross_state === "BAJISTA",
      description:
        data.cross_state === "BAJISTA"
          ? "strategy.sig.emaBearishShort"
          : "strategy.sig.emaNoBearish",
      direction: data.cross_state === "BAJISTA" ? "bearish" : "bullish",
    },
    {
      name: "Stochastic not oversold or fresh bearish cross",
      fired:
        (data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish") ||
        (data.stochastic.k != null && data.stochastic.k > 20),
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish"
          ? "strategy.sig.stochBearCross"
          : data.stochastic.k != null && data.stochastic.k > 20
            ? "strategy.sig.stochNotOversold"
            : "strategy.sig.stochOversold",
      direction: "bearish",
    },
  ],
};

export const HOLD: Strategy = {
  id: "hold",
  name: "strategy.holdName",
  description: "strategy.holdDesc",
  targetAction: "HOLD",
  evaluate: (data) => [
    {
      name: "EMAs compressed or mixed",
      fired: data.cross_state === "COMPRIMIDO",
      description:
        data.cross_state === "COMPRIMIDO"
          ? "strategy.sig.emaCompressedHold"
          : "strategy.sig.emaNotCompressed",
      direction: "neutral",
    },
    {
      name: "Bollinger squeeze active",
      fired: data.bollinger_squeeze?.is_squeezed === true,
      description:
        data.bollinger_squeeze?.is_squeezed === true
          ? "strategy.sig.squeezeActiveHold"
          : "strategy.sig.noSqueeze",
      descValue:
        data.bollinger_squeeze?.is_squeezed === true
          ? data.bollinger_squeeze.bandwidth?.toFixed(2)
          : undefined,
      direction: "neutral",
    },
    {
      name: "RSI in neutral zone (35-65)",
      fired: data.rsi_14 != null && data.rsi_14 >= 35 && data.rsi_14 <= 65,
      description:
        data.rsi_14 != null
          ? data.rsi_14 >= 35 && data.rsi_14 <= 65
            ? "strategy.sig.rsiNeutralZone"
            : "strategy.sig.rsiExtreme"
          : "strategy.sig.rsiNA",
      descValue: data.rsi_14 != null ? data.rsi_14.toFixed(1) : undefined,
      direction: "neutral",
    },
    {
      name: "No fresh EMA/MACD crosses",
      fired:
        data.cross_info?.happened !== true && data.macd_cross?.happened !== true,
      description:
        data.cross_info?.happened === true || data.macd_cross?.happened === true
          ? "strategy.sig.freshCrosses"
          : "strategy.sig.noFreshCrosses",
      direction: "neutral",
    },
  ],
};

export const STRATEGIES: Record<string, Strategy> = {
  trend_buy: TREND_BUY,
  mean_reversion_buy: MEAN_REVERSION_BUY,
  breakout_buy: BREAKOUT_BUY,
  trend_short: TREND_SHORT,
  mean_reversion_short: MEAN_REVERSION_SHORT,
  breakout_short: BREAKOUT_SHORT,
  hold: HOLD,
};

export const STRATEGY_LIST: Strategy[] = [
  TREND_BUY,
  MEAN_REVERSION_BUY,
  BREAKOUT_BUY,
  TREND_SHORT,
  MEAN_REVERSION_SHORT,
  BREAKOUT_SHORT,
  HOLD,
];
