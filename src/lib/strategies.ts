/**
 * Strategy system — predefined trading strategies that evaluate the current
 * technical analysis signals and produce a combined recommendation (BUY,
 * HOLD, SHORT, or WAIT) with a confidence score and a breakdown of which
 * signals fired.
 *
 * Each strategy defines a set of conditions (e.g., EMA55 > EMA200, RSI < 30,
 * MACD cross bullish). The evaluator checks each condition against the
 * analysis payload and returns:
 *  - action: "BUY" | "HOLD" | "SHORT" | "WAIT"
 *  - confidence: 0-100 (percentage of conditions that fired)
 *  - signals: array of {name, fired, description}
 *  - summary: human-readable text explaining the recommendation
 */

import type { AnalysisResponse } from "./types";

export type StrategyAction = "BUY" | "HOLD" | "SHORT" | "WAIT";

export type StrategySignal = {
  name: string;
  fired: boolean;
  description: string;
  /** Optional direction hint for the UI (green/red/neutral). */
  direction?: "bullish" | "bearish" | "neutral";
};

export type StrategyResult = {
  strategyId: string;
  strategyName: string;
  action: StrategyAction;
  confidence: number; // 0-100
  signals: StrategySignal[];
  summary: string;
};

export type Strategy = {
  id: string;
  name: string;
  description: string;
  /** The action the strategy targets when ALL conditions fire. */
  targetAction: StrategyAction;
  /** Returns the list of signals with their fired status. */
  evaluate: (data: AnalysisResponse) => StrategySignal[];
};

/** Helper: count how many signals fired. */
function countFired(signals: StrategySignal[]): number {
  return signals.filter((s) => s.fired).length;
}

/** Helper: compute confidence as percentage of fired signals. */
function confidence(signals: StrategySignal[]): number {
  if (signals.length === 0) return 0;
  return Math.round((countFired(signals) / signals.length) * 100);
}

/** Helper: generate summary text in Spanish. */
function buildSummary(
  action: StrategyAction,
  conf: number,
  signals: StrategySignal[],
): string {
  const fired = countFired(signals);
  const total = signals.length;
  const actionLabel =
    action === "BUY"
      ? "Comprar"
      : action === "SHORT"
        ? "Vender en corto"
        : action === "HOLD"
          ? "Mantener"
          : "Esperar";
  if (action === "WAIT") {
    return `Señales insuficientes (${fired}/${total}). ${actionLabel} — no se cumplen las condiciones de la estrategia.`;
  }
  return `${actionLabel} con ${conf}% de confianza (${fired}/${total} señales activas).`;
}

/** Evaluate a strategy and produce a result. */
export function evaluateStrategy(
  strategy: Strategy,
  data: AnalysisResponse,
): StrategyResult {
  const signals = strategy.evaluate(data);
  const conf = confidence(signals);
  // The action is the target action if confidence >= 60%, otherwise WAIT.
  const action: StrategyAction = conf >= 60 ? strategy.targetAction : "WAIT";
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    action,
    confidence: conf,
    signals,
    summary: buildSummary(action, conf, signals),
  };
}

// ============================================================
// PREDEFINED STRATEGIES
// ============================================================

/** Strategy 1: Trend-following BUY (EMA cross + RSI + MACD confirmation). */
export const TREND_BUY: Strategy = {
  id: "trend_buy",
  name: "Seguimiento de Tendencia · Compra",
  description:
    "Compra cuando la tendencia es alcista (EMA55 > EMA200), RSI no está sobrecomprado, y MACD confirma momentum alcista.",
  targetAction: "BUY",
  evaluate: (data) => [
    {
      name: "EMA55 > EMA200",
      fired: data.cross_state === "ALCISTA",
      description: data.cross_state === "ALCISTA"
        ? "Estructura de medias alcista"
        : data.cross_state === "BAJISTA"
          ? "Estructura bajista — no comprar"
          : "Medias comprimidas — dirección incierta",
      direction: data.cross_state === "ALCISTA" ? "bullish" : "bearish",
    },
    {
      name: "RSI < 70 (no sobrecomprado)",
      fired: data.rsi_14_4h != null && data.rsi_14_4h < 70,
      description:
        data.rsi_14_4h != null
          ? `RSI ${data.rsi_14_4h.toFixed(1)} ${data.rsi_14_4h >= 70 ? "sobrecomprado" : data.rsi_14_4h <= 30 ? "sobrevendido (oportunidad)" : "neutral"}`
          : "RSI no disponible",
      direction: data.rsi_14_4h != null && data.rsi_14_4h < 70 ? "bullish" : "bearish",
    },
    {
      name: "Precio sobre EMA55",
      fired: data.spot_price != null && data.ema55_4h != null && data.spot_price > data.ema55_4h,
      description:
        data.spot_price != null && data.ema55_4h != null
          ? `Precio ${data.spot_price > data.ema55_4h ? "sobre" : "bajo"} EMA55`
          : "Datos insuficientes",
      direction: data.spot_price != null && data.ema55_4h != null && data.spot_price > data.ema55_4h ? "bullish" : "bearish",
    },
    {
      name: "MACD cross alcista o histograma positivo",
      fired:
        (data.macd_cross?.happened === true && data.macd_cross.direction === "bullish") ||
        (data.macd.histogram != null && data.macd.histogram > 0),
      description:
        data.macd_cross?.happened === true && data.macd_cross.direction === "bullish"
          ? "Cruce MACD alcista fresco"
          : data.macd.histogram != null && data.macd.histogram > 0
            ? "Histograma MACD positivo"
            : "Sin confirmación MACD alcista",
      direction: "bullish",
    },
    {
      name: "Stochastic no sobrecomprado o cruce alcista fresco",
      fired:
        (data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish") ||
        (data.stochastic.k != null && data.stochastic.k < 80),
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish"
          ? "Cruce Stochastic alcista fresco"
          : data.stochastic.k != null && data.stochastic.k < 80
            ? `%K ${data.stochastic.k.toFixed(1)} (no sobrecomprado)`
            : "Stochastic sobrecomprado",
      direction: "bullish",
    },
  ],
};

/** Strategy 2: Mean reversion BUY (RSI oversold + Stochastic oversold + price near support). */
export const MEAN_REVERSION_BUY: Strategy = {
  id: "mean_reversion_buy",
  name: "Reversión a la Media · Compra",
  description:
    "Compra cuando el activo está sobrevendido (RSI < 35, Stochastic < 25) y el precio está cerca del soporte.",
  targetAction: "BUY",
  evaluate: (data) => [
    {
      name: "RSI < 35 (sobrevendido)",
      fired: data.rsi_14_4h != null && data.rsi_14_4h < 35,
      description:
        data.rsi_14_4h != null
          ? `RSI ${data.rsi_14_4h.toFixed(1)} ${data.rsi_14_4h < 35 ? "sobrevendido" : "no sobrevendido"}`
          : "RSI no disponible",
      direction: data.rsi_14_4h != null && data.rsi_14_4h < 35 ? "bullish" : "neutral",
    },
    {
      name: "Stochastic %K < 25",
      fired: data.stochastic.k != null && data.stochastic.k < 25,
      description:
        data.stochastic.k != null
          ? `%K ${data.stochastic.k.toFixed(1)} ${data.stochastic.k < 25 ? "sobrevendido" : "no sobrevendido"}`
          : "Stochastic no disponible",
      direction: data.stochastic.k != null && data.stochastic.k < 25 ? "bullish" : "neutral",
    },
    {
      name: "Stochastic cruce alcista fresco",
      fired: data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish",
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bullish"
          ? "Cruce %K/%D alcista confirmado"
          : "Sin cruce Stochastic alcista fresco",
      direction: "bullish",
    },
    {
      name: "Precio cerca de soporte (< 2% sobre support)",
      fired:
        data.spot_price != null && data.support != null && data.spot_price <= data.support * 1.02,
      description:
        data.spot_price != null && data.support != null
          ? `Precio ${(((data.spot_price - data.support) / data.support) * 100).toFixed(1)}% sobre soporte`
          : "Soporte no disponible",
      direction: "bullish",
    },
    {
      name: "No en squeeze (volatilidad normal)",
      fired: data.bollinger_squeeze?.is_squeezed !== true,
      description:
        data.bollinger_squeeze?.is_squeezed === true
          ? "Squeeze activo — esperar breakout"
          : "Volatilidad normal — condiciones para revertir",
      direction: "neutral",
    },
  ],
};

/** Strategy 3: Trend-following SHORT (EMA bearish + RSI not oversold + MACD bearish). */
export const TREND_SHORT: Strategy = {
  id: "trend_short",
  name: "Seguimiento de Tendencia · Short",
  description:
    "Vende en corto cuando la tendencia es bajista (EMA55 < EMA200), RSI no está sobrevendido, y MACD confirma momentum bajista.",
  targetAction: "SHORT",
  evaluate: (data) => [
    {
      name: "EMA55 < EMA200",
      fired: data.cross_state === "BAJISTA",
      description: data.cross_state === "BAJISTA"
        ? "Estructura de medias bajista"
        : "No hay estructura bajista",
      direction: data.cross_state === "BAJISTA" ? "bearish" : "bullish",
    },
    {
      name: "RSI > 30 (no sobrevendido)",
      fired: data.rsi_14_4h != null && data.rsi_14_4h > 30,
      description:
        data.rsi_14_4h != null
          ? `RSI ${data.rsi_14_4h.toFixed(1)} ${data.rsi_14_4h <= 30 ? "sobrevendido — no cortar" : "no sobrevendido"}`
          : "RSI no disponible",
      direction: data.rsi_14_4h != null && data.rsi_14_4h > 30 ? "bearish" : "bullish",
    },
    {
      name: "Precio bajo EMA55",
      fired: data.spot_price != null && data.ema55_4h != null && data.spot_price < data.ema55_4h,
      description:
        data.spot_price != null && data.ema55_4h != null
          ? `Precio ${data.spot_price < data.ema55_4h ? "bajo" : "sobre"} EMA55`
          : "Datos insuficientes",
      direction: data.spot_price != null && data.ema55_4h != null && data.spot_price < data.ema55_4h ? "bearish" : "bullish",
    },
    {
      name: "MACD cross bajista o histograma negativo",
      fired:
        (data.macd_cross?.happened === true && data.macd_cross.direction === "bearish") ||
        (data.macd.histogram != null && data.macd.histogram < 0),
      description:
        data.macd_cross?.happened === true && data.macd_cross.direction === "bearish"
          ? "Cruce MACD bajista fresco"
          : data.macd.histogram != null && data.macd.histogram < 0
            ? "Histograma MACD negativo"
            : "Sin confirmación MACD bajista",
      direction: "bearish",
    },
    {
      name: "Stochastic no sobrevendido o cruce bajista fresco",
      fired:
        (data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish") ||
        (data.stochastic.k != null && data.stochastic.k > 20),
      description:
        data.stoch_cross?.happened === true && data.stoch_cross.direction === "bearish"
          ? "Cruce Stochastic bajista fresco"
          : data.stochastic.k != null && data.stochastic.k > 20
            ? `%K ${data.stochastic.k.toFixed(1)} (no sobrevendido)`
            : "Stochastic sobrevendido — no cortar",
      direction: "bearish",
    },
  ],
};

/** Strategy 4: HOLD (no action — conditions are mixed or unclear). */
export const HOLD: Strategy = {
  id: "hold",
  name: "Mantener · No Operar",
  description:
    "Recomienda mantener/no operar cuando las señales son mixtas o el mercado está comprimido sin dirección clara.",
  targetAction: "HOLD",
  evaluate: (data) => [
    {
      name: "Medias comprimidas o mixtas",
      fired: data.cross_state === "COMPRIMIDO",
      description:
        data.cross_state === "COMPRIMIDO"
          ? "Medias comprimidas — esperar expansión"
          : "Medias no comprimidas",
      direction: "neutral",
    },
    {
      name: "Bollinger squeeze activo",
      fired: data.bollinger_squeeze?.is_squeezed === true,
      description:
        data.bollinger_squeeze?.is_squeezed === true
          ? `Squeeze activo (${data.bollinger_squeeze.bandwidth?.toFixed(2)}%) — esperar breakout`
          : "No hay squeeze",
      direction: "neutral",
    },
    {
      name: "RSI en zona neutral (35-65)",
      fired: data.rsi_14_4h != null && data.rsi_14_4h >= 35 && data.rsi_14_4h <= 65,
      description:
        data.rsi_14_4h != null
          ? `RSI ${data.rsi_14_4h.toFixed(1)} ${data.rsi_14_4h >= 35 && data.rsi_14_4h <= 65 ? "neutral" : "extremo"}`
          : "RSI no disponible",
      direction: "neutral",
    },
    {
      name: "Sin cruces frescos de EMA/MACD",
      fired:
        data.cross_info?.happened !== true && data.macd_cross?.happened !== true,
      description:
        data.cross_info?.happened === true || data.macd_cross?.happened === true
          ? "Hay cruces frescos — posible señal direccional"
          : "Sin cruces frescos — sin cambio de momentum",
      direction: "neutral",
    },
  ],
};

/** All predefined strategies, keyed by id. */
export const STRATEGIES: Record<string, Strategy> = {
  trend_buy: TREND_BUY,
  mean_reversion_buy: MEAN_REVERSION_BUY,
  trend_short: TREND_SHORT,
  hold: HOLD,
};

export const STRATEGY_LIST: Strategy[] = [TREND_BUY, MEAN_REVERSION_BUY, TREND_SHORT, HOLD];
