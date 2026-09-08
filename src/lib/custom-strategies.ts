/**
 * Custom strategy builder — lets users create personalized strategies by
 * combining predefined conditions. Strategies are persisted in localStorage
 * and evaluated alongside the predefined ones.
 *
 * Available condition types:
 *  - ema_cross_bullish: EMA55 > EMA200
 *  - ema_cross_bearish: EMA55 < EMA200
 *  - rsi_below: RSI < threshold (user-configurable, default 30)
 *  - rsi_above: RSI > threshold (default 70)
 *  - macd_bullish: MACD cross bullish or histogram > 0
 *  - macd_bearish: MACD cross bearish or histogram < 0
 *  - stoch_bullish: Stochastic cross bullish
 *  - stoch_bearish: Stochastic cross bearish
 *  - price_above_vwap: Spot price > VWAP
 *  - price_below_vwap: Spot price < VWAP
 *  - bollinger_squeeze: Bollinger squeeze active
 *  - ichimoku_above: Price above Ichimoku cloud
 *  - ichimoku_below: Price below Ichimoku cloud
 */

import type { AnalysisResponse } from "./types";
import {
  type Strategy,
  type StrategySignal,
  type StrategyAction,
  evaluateStrategy,
} from "./strategies";

export type ConditionType =
  | "ema_cross_bullish"
  | "ema_cross_bearish"
  | "rsi_below"
  | "rsi_above"
  | "macd_bullish"
  | "macd_bearish"
  | "stoch_bullish"
  | "stoch_bearish"
  | "price_above_vwap"
  | "price_below_vwap"
  | "bollinger_squeeze"
  | "ichimoku_above"
  | "ichimoku_below";

export type CustomCondition = {
  type: ConditionType;
  /** Optional threshold for rsi_below/rsi_above (default 30/70). */
  threshold?: number;
};

export type CustomStrategy = {
  id: string;
  name: string;
  action: StrategyAction;
  conditions: CustomCondition[];
  createdAt: number;
};

const STORAGE_KEY = "panel:custom-strategies";

export const CONDITION_OPTIONS: {
  type: ConditionType;
  labelKey: string;
  hasThreshold?: boolean;
  defaultThreshold?: number;
}[] = [
  { type: "ema_cross_bullish", labelKey: "custom.emaBull" },
  { type: "ema_cross_bearish", labelKey: "custom.emaBear" },
  { type: "rsi_below", labelKey: "custom.rsiBelow", hasThreshold: true, defaultThreshold: 30 },
  { type: "rsi_above", labelKey: "custom.rsiAbove", hasThreshold: true, defaultThreshold: 70 },
  { type: "macd_bullish", labelKey: "custom.macdBull" },
  { type: "macd_bearish", labelKey: "custom.macdBear" },
  { type: "stoch_bullish", labelKey: "custom.stochBull" },
  { type: "stoch_bearish", labelKey: "custom.stochBear" },
  { type: "price_above_vwap", labelKey: "custom.priceAboveVwap" },
  { type: "price_below_vwap", labelKey: "custom.priceBelowVwap" },
  { type: "bollinger_squeeze", labelKey: "custom.bollingerSqueeze" },
  { type: "ichimoku_above", labelKey: "custom.ichimokuAbove" },
  { type: "ichimoku_below", labelKey: "custom.ichimokuBelow" },
];

export function loadCustomStrategies(): CustomStrategy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomStrategy[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomStrategies(strategies: CustomStrategy[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies));
  } catch {
    // ignore quota errors
  }
}

export function customStrategyToStrategy(custom: CustomStrategy): Strategy {
  return {
    id: custom.id,
    name: custom.name,
    description: "custom.customStrategy",
    targetAction: custom.action,
    evaluate: (data: AnalysisResponse): StrategySignal[] => {
      return custom.conditions.map((cond) => {
        const signal = evaluateCondition(cond, data);
        return signal;
      });
    },
  };
}

function evaluateCondition(
  cond: CustomCondition,
  data: AnalysisResponse,
): StrategySignal {
  switch (cond.type) {
    case "ema_cross_bullish":
      return {
        name: "EMA55 > EMA200",
        fired: data.cross_state === "ALCISTA",
        description: data.cross_state === "ALCISTA"
          ? "strategy.sig.emaBullish"
          : "strategy.sig.emaBearish",
        direction: data.cross_state === "ALCISTA" ? "bullish" : "bearish",
      };
    case "ema_cross_bearish":
      return {
        name: "EMA55 < EMA200",
        fired: data.cross_state === "BAJISTA",
        description: data.cross_state === "BAJISTA"
          ? "strategy.sig.emaBearishShort"
          : "strategy.sig.emaNoBearish",
        direction: data.cross_state === "BAJISTA" ? "bearish" : "bullish",
      };
    case "rsi_below": {
      const threshold = cond.threshold ?? 30;
      const fired = data.rsi_14_4h != null && data.rsi_14_4h < threshold;
      return {
        name: `RSI < ${threshold}`,
        fired,
        description: fired ? "strategy.sig.rsiOversoldBuy" : "strategy.sig.rsiNotOversold",
        descValue: data.rsi_14_4h?.toFixed(1),
        direction: fired ? "bullish" : "neutral",
      };
    }
    case "rsi_above": {
      const threshold = cond.threshold ?? 70;
      const fired = data.rsi_14_4h != null && data.rsi_14_4h > threshold;
      return {
        name: `RSI > ${threshold}`,
        fired,
        description: fired ? "strategy.sig.rsiOverbought" : "strategy.sig.rsiNeutral",
        descValue: data.rsi_14_4h?.toFixed(1),
        direction: fired ? "bearish" : "neutral",
      };
    }
    case "macd_bullish":
      return {
        name: "MACD bullish",
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
      };
    case "macd_bearish":
      return {
        name: "MACD bearish",
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
      };
    case "stoch_bullish":
      return {
        name: "Stochastic bullish cross",
        fired: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish",
        description: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish"
          ? "strategy.sig.stochBullConfirmed"
          : "strategy.sig.stochNoBullCross",
        direction: "bullish",
      };
    case "stoch_bearish":
      return {
        name: "Stochastic bearish cross",
        fired: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish",
        description: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish"
          ? "strategy.sig.stochBearCross"
          : "strategy.sig.stochNoBullCross",
        direction: "bearish",
      };
    case "price_above_vwap": {
      const fired = data.vwap_20_4h != null && data.spot_price != null && data.spot_price > data.vwap_20_4h;
      return {
        name: "Price > VWAP",
        fired,
        description: fired ? "card.vwapAbove" : "card.vwapBelow",
        direction: fired ? "bullish" : "bearish",
      };
    }
    case "price_below_vwap": {
      const fired = data.vwap_20_4h != null && data.spot_price != null && data.spot_price < data.vwap_20_4h;
      return {
        name: "Price < VWAP",
        fired,
        description: fired ? "card.vwapBelow" : "card.vwapAbove",
        direction: fired ? "bearish" : "bullish",
      };
    }
    case "bollinger_squeeze":
      return {
        name: "Bollinger squeeze",
        fired: data.bollinger_squeeze?.is_squeezed === true,
        description: data.bollinger_squeeze?.is_squeezed === true
          ? "strategy.sig.squeezeActive"
          : "strategy.sig.noSqueeze",
        direction: "neutral",
      };
    case "ichimoku_above":
      return {
        name: "Price > Ichimoku cloud",
        fired: data.ichimoku?.price_vs_cloud === "above",
        description: data.ichimoku?.price_vs_cloud === "above"
          ? "card.ichimokuAbove"
          : "card.ichimokuBelow",
        direction: data.ichimoku?.price_vs_cloud === "above" ? "bullish" : "bearish",
      };
    case "ichimoku_below":
      return {
        name: "Price < Ichimoku cloud",
        fired: data.ichimoku?.price_vs_cloud === "below",
        description: data.ichimoku?.price_vs_cloud === "below"
          ? "card.ichimokuBelow"
          : "card.ichimokuAbove",
        direction: data.ichimoku?.price_vs_cloud === "below" ? "bearish" : "bullish",
      };
    default:
      return {
        name: "Unknown",
        fired: false,
        description: "strategy.sig.dataInsufficient",
        direction: "neutral",
      };
  }
}

export function evaluateCustomStrategy(
  custom: CustomStrategy,
  data: AnalysisResponse,
) {
  const strategy = customStrategyToStrategy(custom);
  return evaluateStrategy(strategy, data);
}
