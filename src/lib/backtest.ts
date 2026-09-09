/**
 * Backtest engine — runs a strategy (custom or predefined) against historical
 * klines and produces performance metrics.
 *
 * The engine:
 *   1. Fetches historical klines (server-side via the provider router).
 *   2. Computes indicator series once over the full range (EMA55, EMA200,
 *      RSI14, MACD, Stochastic, VWAP, Bollinger, Ichimoku).
 *   3. Iterates candles from the warmup index to the end, building a per-
 *      candle AnalysisResponse snapshot with the indicator fields that
 *      strategy.evaluate() reads.
 *   4. Evaluates the strategy at each candle and simulates trades:
 *        - Enter when the strategy confidence >= minConfidence and no
 *          position is open.
 *        - Exit when stop-loss, take-profit, or max-hold is hit; otherwise
 *          exit when the entry signals stop firing. A force-flatten happens
 *          at the last candle.
 *   5. Computes equity curve + summary stats (win rate, total return, max
 *      drawdown, profit factor, avg hold, best/worst trade).
 *
 * The engine works with both predefined strategies (TREND_BUY, MEAN_REVERSION_BUY,
 * TREND_SHORT, HOLD) and custom strategies built via customStrategyToStrategy().
 */

import { providerRouter } from "@/lib/providers/router";
import type { Kline, ProviderId } from "@/lib/providers/types";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateStochastic,
  calculateVWAP,
  calculateBollingerBands,
  calculateIchimoku,
  determineCrossState,
  type CrossState,
} from "@/lib/indicators";
import type { AnalysisResponse } from "@/lib/types";
import {
  type Strategy,
  type StrategyAction,
  evaluateStrategy,
} from "@/lib/strategies";

/** Supported backtest intervals (Binance/Bybit kline intervals). */
export type BacktestInterval = "15m" | "1h" | "4h" | "1d";

export type BacktestParams = {
  symbol: string;
  interval: BacktestInterval;
  /** Number of historical candles to fetch (max 1000 — provider limit). */
  limit: number;
  /** Strategy to evaluate (predefined or custom). The engine uses
   *  strategy.evaluate() per candle, so both kinds work uniformly. */
  strategy: Strategy;
  /** Strategy action label (BUY/HOLD/SHORT/WAIT) for trade records. */
  action: StrategyAction;
  /** Minimum confidence (0-100) required to open a position. Default 60. */
  minConfidence?: number;
  /** Initial capital in USD. Default 10000. */
  initialCapital?: number;
  /** Stop loss percent (e.g., 5 = exit if price drops 5% from entry). Default 5. */
  stopLossPct?: number;
  /** Take profit percent (e.g., 10 = exit if price rises 10% from entry). Default 10. */
  takeProfitPct?: number;
  /** Max candles to hold a position before force-closing. Default 50. */
  maxHoldCandles?: number;
};

export type BacktestTrade = {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  /** P&L in USD for this single trade. */
  pnl: number;
  /** P&L as percent of the capital allocated to this trade. */
  pnlPct: number;
  /** Number of candles held. */
  holdCandles: number;
  /** Reason the trade was closed. */
  exitReason: "stop_loss" | "take_profit" | "max_hold" | "signal_exit" | "end_of_data";
  /** Action label of the strategy (BUY/SHORT/HOLD). */
  action: string;
};

export type EquityPoint = {
  candleIndex: number;
  time: number;
  /** Equity in USD at this candle. */
  equity: number;
  /** Whether a trade was open at this candle (for overlay). */
  inPosition: boolean;
};

export type BacktestStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Final equity as a percent change from initial capital. */
  totalReturnPct: number;
  /** Largest peak-to-trough drop in equity (percent). */
  maxDrawdownPct: number;
  /** Sum of winning P&L / absolute sum of losing P&L. Infinity if no losses. */
  profitFactor: number;
  /** Average candles held across all closed trades. */
  avgHoldCandles: number;
  /** Best single-trade P&L percent. */
  bestTradePct: number;
  /** Worst single-trade P&L percent. */
  worstTradePct: number;
  /** Final equity in USD. */
  finalEquity: number;
};

export type BacktestResult = {
  symbol: string;
  interval: string;
  candlesAnalyzed: number;
  provider: ProviderId;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  stats: BacktestStats;
  strategy: { id: string; name: string; action: string };
  params: {
    minConfidence: number;
    initialCapital: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldCandles: number;
  };
  error?: string;
};

const WARMUP = 200; // EMA200 + Ichimoku(52) need ~200 candles before all indicators are valid.

/** Per-candle snapshot. The full AnalysisResponse is built once per candle. */
type CandleSnapshot = {
  index: number;
  time: number;
  close: number;
  analysis: AnalysisResponse;
};

/**
 * Detect a bullish/bearish cross between two series at index `i`.
 * A bullish cross means seriesA crossed above seriesB: prev A < prev B AND A >= B.
 */
function crossAt(
  seriesA: (number | null)[],
  seriesB: (number | null)[],
  i: number,
): "bullish" | "bearish" | null {
  if (i < 1) return null;
  const aPrev = seriesA[i - 1];
  const bPrev = seriesB[i - 1];
  const aCur = seriesA[i];
  const bCur = seriesB[i];
  if (aPrev == null || bPrev == null || aCur == null || bCur == null) return null;
  if (aPrev < bPrev && aCur >= bCur) return "bullish";
  if (aPrev > bPrev && aCur <= bCur) return "bearish";
  return null;
}

/**
 * Find the most recent cross in [endIdx - lookback + 1, endIdx].
 */
function mostRecentCross(
  seriesA: (number | null)[],
  seriesB: (number | null)[],
  endIdx: number,
  lookback: number,
): { happened: boolean; direction: "bullish" | "bearish" | null } {
  for (let offset = 0; offset < lookback; offset++) {
    const idx = endIdx - offset;
    if (idx < 1) break;
    const dir = crossAt(seriesA, seriesB, idx);
    if (dir !== null) return { happened: true, direction: dir };
  }
  return { happened: false, direction: null };
}

/**
 * Build the AnalysisResponse snapshot that strategy.evaluate() reads.
 * Only the fields the conditions check are populated; the rest are defaulted
 * so the evaluator doesn't throw.
 */
function buildAnalysisSnapshot(
  s: {
    close: number;
    crossState: CrossState | null;
    rsi: number | null;
    macdLine: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    macdCrossHappened: boolean;
    macdCrossDirection: "bullish" | "bearish" | null;
    stochK: number | null;
    stochD: number | null;
    stochCrossHappened: boolean;
    stochCrossDirection: "bullish" | "bearish" | null;
    vwap: number | null;
    bollingerSqueezed: boolean;
    ichimokuPriceVsCloud: "above" | "below" | "inside" | "unknown";
    ema55: number | null;
    ema200: number | null;
  },
  symbol: string,
): AnalysisResponse {
  return {
    symbol,
    spot_price: s.close,
    change_24h_pct: null,
    ema55_4h: s.ema55,
    ema200_4h: s.ema200,
    cross_state: s.crossState,
    cross_info: null,
    resistance: null,
    support: null,
    rsi_14_4h: s.rsi,
    volume_24h_usd: null,
    trades_24h: null,
    high_24h: null,
    low_24h: null,
    macd: { line: s.macdLine, signal: s.macdSignal, histogram: s.macdHistogram },
    macd_cross: s.macdCrossHappened
      ? {
          happened: true,
          candles_since_cross: 0,
          direction: s.macdCrossDirection,
          momentum_flip: false,
          momentum_flip_direction: null,
          candles_since_flip: null,
          window: 6,
        }
      : {
          happened: false,
          candles_since_cross: null,
          direction: null,
          momentum_flip: false,
          momentum_flip_direction: null,
          candles_since_flip: null,
          window: 6,
        },
    atr_14_4h: null,
    bollinger: { upper: null, middle: null, lower: null, bandwidth: null },
    bollinger_squeeze: { is_squeezed: s.bollingerSqueezed, threshold_pct: 3, bandwidth: null },
    squeeze_breakout: {
      happened: false,
      direction: null,
      candles_since_breakout: null,
      bandwidth_before: null,
      bandwidth_after: null,
    },
    stop_loss_suggestion: null,
    fibonacci: null,
    vwap_20_4h: s.vwap,
    stochastic: { k: s.stochK, d: s.stochD },
    stoch_cross: s.stochCrossHappened
      ? { happened: true, candles_since_cross: 0, direction: s.stochCrossDirection, k_at_cross: s.stochK }
      : { happened: false, candles_since_cross: null, direction: null, k_at_cross: null },
    ichimoku: {
      tenkan: null,
      kijun: null,
      senkou_a: null,
      senkou_b: null,
      chikou: null,
      cloud_color: "neutral",
      price_vs_cloud: s.ichimokuPriceVsCloud,
    },
    structure_text: "",
    no_disponible: {
      spot_price: false,
      change_24h_pct: true,
      ema55_4h: false,
      ema200_4h: false,
      cross_state: false,
      rsi_14_4h: false,
      macd_cross: false,
      bollinger_squeeze: false,
      vwap_20_4h: false,
      stoch_cross: false,
      ichimoku: false,
    },
  } as unknown as AnalysisResponse;
}

/**
 * Build per-candle snapshots for the whole kline series.
 *
 * Indicator series are computed once (full length), then for each candle we
 * look up the values + check whether a cross happened within the last
 * `recentThreshold` candles (matching what /api/analysis reports live).
 */
function buildSnapshots(klines: Kline[], symbol: string): CandleSnapshot[] {
  const n = klines.length;
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const volumes = klines.map((k) => k.volume);

  // Indicator series.
  const ema55 = calculateEMA(closes, 55).series;
  const ema200 = calculateEMA(closes, 200).series;
  const rsi = calculateRSI(closes, 14).series;
  const macd = calculateMACD(closes, 12, 26, 9);
  const stoch = calculateStochastic(highs, lows, closes, 14, 3);
  const vwap = calculateVWAP(highs, lows, closes, volumes, 20).series;
  const bollinger = calculateBollingerBands(closes, 20, 2);
  const ichimoku = calculateIchimoku(highs, lows, closes, 9, 26, 52);

  // Bollinger bandwidth series for squeeze detection (threshold 3%).
  const bandwidthSeries: (number | null)[] = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const mid = bollinger.middle[i];
    const up = bollinger.upper[i];
    const lo = bollinger.lower[i];
    if (mid != null && up != null && lo != null && mid !== 0) {
      bandwidthSeries[i] = ((up - lo) / mid) * 100;
    }
  }

  const MACD_RECENT = 6;
  const STOCH_RECENT = 3;

  const snapshots: CandleSnapshot[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e55 = ema55[i];
    const e200 = ema200[i];
    let crossState: CrossState | null = null;
    if (e55 != null && e200 != null) {
      crossState = determineCrossState(e55, e200).state;
    }

    const macdCross = mostRecentCross(macd.macdLine, macd.signalLine, i, MACD_RECENT);
    const stochCross = mostRecentCross(stoch.kSeries, stoch.dSeries, i, STOCH_RECENT);

    const bandwidth = bandwidthSeries[i];
    const bollingerSqueezed = bandwidth != null && bandwidth < 3;

    const tenkan = ichimoku.tenkanSeries[i];
    const kijun = ichimoku.kijunSeries[i];
    const senkouA = ichimoku.senkouASeries[i];
    const senkouB = ichimoku.senkouBSeries[i];
    let ichimokuVsCloud: "above" | "below" | "inside" | "unknown" = "unknown";
    if (tenkan != null && kijun != null && senkouA != null && senkouB != null) {
      const cloudTop = Math.max(senkouA, senkouB);
      const cloudBottom = Math.min(senkouA, senkouB);
      const price = closes[i];
      if (price > cloudTop) ichimokuVsCloud = "above";
      else if (price < cloudBottom) ichimokuVsCloud = "below";
      else ichimokuVsCloud = "inside";
    }

    const analysis = buildAnalysisSnapshot(
      {
        close: closes[i],
        crossState,
        rsi: rsi[i],
        macdLine: macd.macdLine[i],
        macdSignal: macd.signalLine[i],
        macdHistogram: macd.histogram[i],
        macdCrossHappened: macdCross.happened,
        macdCrossDirection: macdCross.direction,
        stochK: stoch.kSeries[i],
        stochD: stoch.dSeries[i],
        stochCrossHappened: stochCross.happened,
        stochCrossDirection: stochCross.direction,
        vwap: vwap[i],
        bollingerSqueezed,
        ichimokuPriceVsCloud: ichimokuVsCloud,
        ema55: e55,
        ema200: e200,
      },
      symbol,
    );

    snapshots[i] = {
      index: i,
      time: klines[i].openTime,
      close: closes[i],
      analysis,
    };
  }

  return snapshots;
}

/**
 * Returns true when the strategy's entry signal fires at this candle: the
 * strategy's evaluate() returns signals whose fired count gives a confidence
 * >= minConfidence.
 */
function entrySignalFires(
  strategy: Strategy,
  snap: CandleSnapshot,
  minConfidence: number,
): boolean {
  const result = evaluateStrategy(strategy, snap.analysis);
  if (result.signals.length === 0) return false;
  return result.confidence >= minConfidence;
}

/** Run a backtest. Returns the full result (no error thrown on data quality). */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const {
    symbol,
    interval,
    limit,
    strategy,
    action,
    minConfidence = 60,
    initialCapital = 10_000,
    stopLossPct = 5,
    takeProfitPct = 10,
    maxHoldCandles = 50,
  } = params;

  // Cap limit to provider max (1000) and ensure we have enough warmup.
  const safeLimit = Math.max(220, Math.min(1000, Math.floor(limit)));

  let provider: ProviderId = "binance";
  let klines: Kline[] = [];
  try {
    const res = await providerRouter.getKlines(symbol, interval, safeLimit);
    klines = res.klines;
    provider = res.provider;
  } catch {
    return {
      symbol,
      interval,
      candlesAnalyzed: 0,
      provider,
      trades: [],
      equityCurve: [],
      stats: emptyStats(initialCapital),
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles },
      error: "Failed to fetch historical klines from upstream provider.",
    };
  }

  if (klines.length < 220) {
    return {
      symbol,
      interval,
      candlesAnalyzed: klines.length,
      provider,
      trades: [],
      equityCurve: [],
      stats: emptyStats(initialCapital),
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles },
      error: `Insufficient historical data (${klines.length} candles; need at least 220 for warmup).`,
    };
  }

  const snapshots = buildSnapshots(klines, symbol);
  const warmupIndex = Math.min(WARMUP, snapshots.length - 1);

  // --- Trade simulation ---
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;

  let inPosition = false;
  let entryIndex = -1;
  let entryPrice = 0;
  let entryTime = 0;
  let tradeAction = action;

  // Long for BUY/HOLD/WAIT (defensive), short for SHORT.
  const isShortStrategy = action === "SHORT";
  const positionDirection = isShortStrategy ? -1 : 1;

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];

    if (inPosition) {
      const priceMovePct = ((snap.close - entryPrice) / entryPrice) * 100;
      const tradePctRaw = priceMovePct * positionDirection;
      let exitReason: BacktestTrade["exitReason"] | null = null;

      if (tradePctRaw <= -stopLossPct) exitReason = "stop_loss";
      else if (tradePctRaw >= takeProfitPct) exitReason = "take_profit";
      else if (i - entryIndex >= maxHoldCandles) exitReason = "max_hold";
      else if (!entrySignalFires(strategy, snap, minConfidence)) {
        exitReason = "signal_exit";
      } else if (i === snapshots.length - 1) {
        exitReason = "end_of_data";
      }

      if (exitReason !== null) {
        const exitPrice = snap.close;
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100 * positionDirection;
        const pnl = (equity * pnlPct) / 100;
        equity += pnl;
        if (equity < 0) equity = 0;

        trades.push({
          entryIndex,
          exitIndex: i,
          entryPrice,
          exitPrice,
          entryTime,
          exitTime: snap.time,
          pnl,
          pnlPct,
          holdCandles: i - entryIndex,
          exitReason,
          action: tradeAction,
        });

        inPosition = false;
        entryIndex = -1;
        entryPrice = 0;
        entryTime = 0;
      }
    }

    if (!inPosition && i >= warmupIndex) {
      if (entrySignalFires(strategy, snap, minConfidence)) {
        inPosition = true;
        entryIndex = i;
        entryPrice = snap.close;
        entryTime = snap.time;
        tradeAction = action;
      }
    }

    // Mark-to-market equity + drawdown tracking.
    let markedEquity = equity;
    if (inPosition) {
      const openPnlPct = ((snap.close - entryPrice) / entryPrice) * 100 * positionDirection;
      markedEquity = equity + (equity * openPnlPct) / 100;
    }
    equityCurve.push({
      candleIndex: i,
      time: snap.time,
      equity: markedEquity,
      inPosition,
    });

    if (markedEquity > peakEquity) peakEquity = markedEquity;
    if (peakEquity > 0) {
      const dd = ((peakEquity - markedEquity) / peakEquity) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  const stats = computeStats(trades, equity, initialCapital, maxDrawdownPct);

  return {
    symbol,
    interval,
    candlesAnalyzed: snapshots.length,
    provider,
    trades,
    equityCurve,
    stats,
    strategy: { id: strategy.id, name: strategy.name, action },
    params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles },
  };
}

function emptyStats(initialCapital: number): BacktestStats {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    profitFactor: 0,
    avgHoldCandles: 0,
    bestTradePct: 0,
    worstTradePct: 0,
    finalEquity: initialCapital,
  };
}

function computeStats(
  trades: BacktestTrade[],
  finalEquity: number,
  initialCapital: number,
  maxDrawdownPct: number,
): BacktestStats {
  if (trades.length === 0) return emptyStats(initialCapital);
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalWinPnl = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : wins.length > 0 ? Infinity : 0;
  const avgHold = trades.reduce((sum, t) => sum + t.holdCandles, 0) / trades.length;
  const bestTradePct = trades.reduce((m, t) => Math.max(m, t.pnlPct), -Infinity);
  const worstTradePct = trades.reduce((m, t) => Math.min(m, t.pnlPct), Infinity);
  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    totalReturnPct,
    maxDrawdownPct,
    profitFactor,
    avgHoldCandles: Math.round(avgHold * 10) / 10,
    bestTradePct: Math.round(bestTradePct * 100) / 100,
    worstTradePct: Math.round(worstTradePct * 100) / 100,
    finalEquity: Math.round(finalEquity * 100) / 100,
  };
}
