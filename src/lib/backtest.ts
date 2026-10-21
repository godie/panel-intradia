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
import { getCached, setCached } from "@/lib/cache";
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

export type PositionSizing =
  | "full"              // 100% of equity per trade (default)
  | "fixed_fractional"  // fixed % of equity per trade (configurable)
  | "half_kelly"        // half-Kelly criterion based on win rate + payoff
  | "kelly";            // full Kelly criterion (more aggressive, riskier)

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
  /** Position sizing mode. Default "full". */
  positionSizing?: PositionSizing;
  /** For fixed_fractional: percent of equity to risk per trade (1-100). Default 25. */
  fixedFractionalPct?: number;
  /** Trading fee per side in basis points (1 bp = 0.01%). Default 10 (0.10%).
   *  Set to 0 to disable fees. Binance spot maker/taker is ~10 bp. */
  feeBps?: number;
  /** Preloaded klines — when provided the engine SKIPS the provider fetch
   *  (used by POST /api/backtest/compare to share ONE upstream fetch across
   *  all N strategy runs). Same warmup rules apply (≥220 candles). */
  preloadedKlines?: Kline[];
  /** Provider the preloaded klines came from (for the result metadata). */
  preloadedProvider?: ProviderId;
};

export type BacktestTrade = {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  /** P&L in USD for this single trade (net of fees). */
  pnl: number;
  /** P&L as percent of the capital allocated to this trade (net of fees). */
  pnlPct: number;
  /** Number of candles held. */
  holdCandles: number;
  /** Reason the trade was closed. */
  exitReason: "stop_loss" | "take_profit" | "max_hold" | "signal_exit" | "end_of_data";
  /** Action label of the strategy (BUY/SHORT/HOLD). */
  action: string;
  /** Percent of equity allocated to this trade at entry (0-100). */
  positionSizePct: number;
  /** Total fees paid on this trade (entry + exit) in USD. */
  feesPaid: number;
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
  /** Total fees paid across all trades in USD. */
  totalFees: number;
  /** Average position size as % of equity across all trades. */
  avgPositionSizePct: number;
  /** Annualized Sharpe ratio (risk-free rate 0). NaN if stddev is 0. */
  sharpeRatio: number;
  /** Annualized Sortino ratio (downside deviation only). NaN if no downside. */
  sortinoRatio: number;
  /** Calmar ratio = totalReturn / maxDrawdown (NaN if maxDD = 0). */
  calmarRatio: number;
  /** Largest consecutive winning streak. */
  maxWinStreak: number;
  /** Largest consecutive losing streak. */
  maxLossStreak: number;
  /** Average winning trade P&L percent. */
  avgWinPct: number;
  /** Average losing trade P&L percent (negative). */
  avgLossPct: number;
  /** Expectancy per trade in % (avg win * winRate - avg loss * lossRate). */
  expectancyPct: number;
};

/** Histogram bucket for trade duration distribution. */
export type DurationBucket = {
  /** Lower bound of the bucket (inclusive), in candles. */
  min: number;
  /** Upper bound of the bucket (inclusive), in candles. */
  max: number;
  /** Human-readable label, e.g. "1-5", "6-10", "11-20", "21-50", "50+". */
  label: string;
  /** Number of trades that fell in this bucket. */
  count: number;
};

export type BacktestResult = {
  symbol: string;
  interval: string;
  candlesAnalyzed: number;
  provider: ProviderId;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  stats: BacktestStats;
  /** Trade duration distribution histogram (4 buckets). */
  durationBuckets: DurationBucket[];
  strategy: { id: string; name: string; action: string };
  params: {
    minConfidence: number;
    initialCapital: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldCandles: number;
    positionSizing: PositionSizing;
    fixedFractionalPct: number;
    feeBps: number;
  };
  error?: string;
};

const WARMUP = 200; // EMA200 + Ichimoku(52) need ~200 candles before all indicators are valid.

/** Per-candle snapshot. The full AnalysisResponse is built once per candle. */
export type CandleSnapshot = {
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
    ema55: s.ema55,
    ema200: s.ema200,
    cross_state: s.crossState,
    cross_info: null,
    resistance: null,
    support: null,
    rsi_14: s.rsi,
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
    atr_14: null,
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
    vwap_20: s.vwap,
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
      ema55: false,
      ema200: false,
      cross_state: false,
      rsi_14: false,
      macd_cross: false,
      bollinger_squeeze: false,
      vwap_20: false,
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

/**
 * Position size (% of equity) for the next trade under a given sizing mode.
 *
 * - "full": 100%.
 * - "fixed_fractional": clamped fixedFractionalPct (1-100).
 * - "kelly" / "half_kelly": Kelly fraction f* = (p*b - q)/b estimated from
 *   realized trades (p = win rate, b = avgWin/avgLoss). Needs at least 5
 *   closed trades as a warmup sample (otherwise 100%). A non-positive edge
 *   falls back to the 1% floor. Half-Kelly sizes at half of the kelly
 *   fraction.
 */
export function calculatePositionSizePct(
  sizing: PositionSizing,
  closedTrades: Pick<BacktestTrade, "pnl" | "pnlPct">[],
  fixedFractionalPct: number,
): number {
  if (sizing === "full") return 100;
  if (sizing === "fixed_fractional") {
    return Math.max(1, Math.min(100, fixedFractionalPct));
  }
  // Kelly / half_kelly — need at least a few trades to estimate.
  if (closedTrades.length < 5) return 100; // warmup: full size until stats stabilize
  const wins = closedTrades.filter((t) => t.pnl > 0);
  const losses = closedTrades.filter((t) => t.pnl <= 0);
  if (wins.length === 0 || losses.length === 0) return 100;
  const winRate = wins.length / closedTrades.length;
  const avgWin = wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length);
  if (avgLoss === 0) return 100;
  const payoff = avgWin / avgLoss; // win/loss ratio
  // Kelly fraction f* = (p*b - q) / b  where p=win rate, q=1-p, b=payoff
  const kellyFrac = (winRate * payoff - (1 - winRate)) / payoff;
  if (kellyFrac <= 0) return 1; // edge negative — minimal size
  // Convert Kelly fraction (0-1) to % of equity, capped at 100%.
  const rawPct = sizing === "kelly" ? kellyFrac * 100 : kellyFrac * 50;
  return Math.max(1, Math.min(100, rawPct));
}

/**
 * PnL and fees for a single closed trade. Fees are charged on both the
 * entry notional and the exit notional (exit notional = entry notional
 * × exitPrice/entryPrice).
 */
export function computeTradePnl(input: {
  entryPrice: number;
  exitPrice: number;
  positionDirection: 1 | -1;
  entryNotional: number;
  feePerSide: number;
}): { grossPnl: number; netPnl: number; netPnlPct: number; feesPaid: number } {
  const { entryPrice, exitPrice, positionDirection, entryNotional, feePerSide } = input;
  const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100 * positionDirection;
  const exitNotional = entryNotional * (exitPrice / entryPrice);
  const feesPaid = entryNotional * feePerSide + exitNotional * feePerSide;
  const grossPnl = (entryNotional * grossPnlPct) / 100;
  const netPnl = grossPnl - feesPaid;
  const netPnlPct = (netPnl / entryNotional) * 100;
  return { grossPnl, netPnl, netPnlPct, feesPaid };
}

/**
 * Trade execution shared by the full-history backtest and the walk-forward
 * windows, so both run the exact same engine (one place to change exit
 * checks, fees or sizing — no divergent copies).
 *
 * `warmupIndex` is the first candle allowed to OPEN a position:
 * - runBacktest passes `min(WARMUP, len - 1)` — the fetched kline history is
 *   too short for warm indicators before that;
 * - walk-forward passes 0, because its windows are slices of ONE snapshot
 *   series computed over the whole fetched history: every candle already
 *   carries the full-history indicator context live trading would have.
 */
function simulateTrades(
  snapshots: CandleSnapshot[],
  params: TradeSimParams,
  warmupIndex: number,
  provider: ProviderId,
): BacktestResult {
  const {
    symbol,
    interval,
    strategy,
    action,
    minConfidence,
    initialCapital,
    stopLossPct,
    takeProfitPct,
    maxHoldCandles,
    positionSizing,
    fixedFractionalPct,
    feeBps,
  } = params;

  // --- Trade simulation ---
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;
  let totalFees = 0;

  let inPosition = false;
  let entryIndex = -1;
  let entryPrice = 0;
  let entryTime = 0;
  let tradeAction = action;
  let positionSizePct = 100;  // % of equity allocated to the current trade
  let entryEquity = 0;        // equity snapshot when the position opened

  // Long for BUY/HOLD/WAIT (defensive), short for SHORT.
  const isShortStrategy = action === "SHORT";
  const positionDirection = isShortStrategy ? -1 : 1;

  // Fee per side in decimal (e.g. 10 bp = 0.001).
  const feePerSide = feeBps / 10_000;

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
        // Notional is based on the equity snapshot at entry time, so PnL
        // and fees stay consistent even if the sizing mode changes later.
        const entryNotional = (entryEquity * positionSizePct) / 100;
        const { netPnl, netPnlPct, feesPaid } = computeTradePnl({
          entryPrice,
          exitPrice,
          positionDirection,
          entryNotional,
          feePerSide,
        });
        totalFees += feesPaid;
        equity += netPnl;
        if (equity < 0) equity = 0;

        trades.push({
          entryIndex,
          exitIndex: i,
          entryPrice,
          exitPrice,
          entryTime,
          exitTime: snap.time,
          pnl: netPnl,
          pnlPct: netPnlPct,
          holdCandles: i - entryIndex,
          exitReason,
          action: tradeAction,
          positionSizePct,
          feesPaid,
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
        positionSizePct = calculatePositionSizePct(positionSizing, trades, fixedFractionalPct);
        entryEquity = equity;
      }
    }

    // Mark-to-market equity + drawdown tracking. The open position's
    // contribution to equity is `(equity * positionSizePct/100) * openPnlPct/100`.
    let markedEquity = equity;
    if (inPosition) {
      const entryNotional = (entryEquity * positionSizePct) / 100;
      const openPnlPct = ((snap.close - entryPrice) / entryPrice) * 100 * positionDirection;
      // Subtract the entry fee from the marked equity (we already paid it).
      const entryFeePaid = entryNotional * feePerSide;
      markedEquity = equity + (entryNotional * openPnlPct) / 100 - entryFeePaid;
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

  const stats = computeStats(trades, equity, initialCapital, maxDrawdownPct, totalFees, equityCurve, interval);
  const durationBuckets = computeDurationBuckets(trades);

  return {
    symbol,
    interval,
    candlesAnalyzed: snapshots.length,
    provider,
    trades,
    equityCurve,
    stats,
    durationBuckets,
    strategy: { id: strategy.id, name: strategy.name, action },
    params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
  };
}

export type TradeSimParams = {
  symbol: string;
  interval: BacktestInterval;
  strategy: Strategy;
  action: StrategyAction;
  minConfidence: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldCandles: number;
  positionSizing: PositionSizing;
  fixedFractionalPct: number;
  feeBps: number;
};


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
    positionSizing = "full",
    fixedFractionalPct = 25,
    feeBps = 10,
  } = params;

  // Cap limit to provider max (1000) and ensure we have enough warmup.
  const safeLimit = Math.max(220, Math.min(1000, Math.floor(limit)));

  let provider: ProviderId = params.preloadedProvider ?? "binance";
  let klines: Kline[] = params.preloadedKlines ?? [];
  if (!params.preloadedKlines) {
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
        durationBuckets: [],
        strategy: { id: strategy.id, name: strategy.name, action },
        params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
        error: "Failed to fetch historical klines from upstream provider.",
      };
    }
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
      durationBuckets: [],
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
      error: `Insufficient historical data (${klines.length} candles; need at least 220 for warmup).`,
    };
  }

  const snapshots = buildSnapshots(klines, symbol);
  const warmupIndex = Math.min(WARMUP, snapshots.length - 1);

  // The trade execution lives in simulateTrades() so the walk-forward
  // windows run the exact same engine byte-for-byte.
  return simulateTrades(
    snapshots,
    {
      symbol,
      interval,
      strategy,
      action,
      minConfidence,
      initialCapital,
      stopLossPct,
      takeProfitPct,
      maxHoldCandles,
      positionSizing,
      fixedFractionalPct,
      feeBps,
    },
    Math.min(WARMUP, snapshots.length - 1),
    provider,
  );
}

export function emptyStats(initialCapital: number): BacktestStats {
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
    totalFees: 0,
    avgPositionSizePct: 0,
    sharpeRatio: NaN,
    sortinoRatio: NaN,
    calmarRatio: NaN,
    maxWinStreak: 0,
    maxLossStreak: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    expectancyPct: 0,
  };
}

/** Candles per year by interval — used to annualize Sharpe/Sortino. */
const CANDLES_PER_YEAR: Record<string, number> = {
  "15m": 365 * 24 * 4,   // 35,040
  "1h": 365 * 24,         // 8,760
  "4h": 365 * 6,          // 2,190
  "1d": 365,              // 365
};

export function computeStats(
  trades: BacktestTrade[],
  finalEquity: number,
  initialCapital: number,
  maxDrawdownPct: number,
  totalFees: number,
  equityCurve: EquityPoint[],
  interval: string,
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
  const avgPositionSizePct =
    trades.reduce((s, t) => s + t.positionSizePct, 0) / trades.length;

  // Average win / loss percent.
  const avgWinPct = wins.length > 0
    ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length
    : 0;
  const avgLossPct = losses.length > 0
    ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length
    : 0;

  // Expectancy = avgWin * winRate - |avgLoss| * lossRate (in %).
  const winRate = wins.length / trades.length;
  const lossRate = 1 - winRate;
  const expectancyPct = avgWinPct * winRate - Math.abs(avgLossPct) * lossRate;

  // Streaks: find max consecutive wins/losses in trade order.
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWinStreak) maxWinStreak = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLossStreak) maxLossStreak = curLoss;
    }
  }

  // Sharpe / Sortino: compute per-candle returns from the equity curve.
  // Return_t = (equity_t - equity_{t-1}) / equity_{t-1}.
  // Annualize by multiplying mean by sqrt(candlesPerYear) and stddev by 1.
  const cpy = CANDLES_PER_YEAR[interval] ?? CANDLES_PER_YEAR["1d"];
  let sharpeRatio = NaN;
  let sortinoRatio = NaN;
  if (equityCurve.length >= 2) {
    const returns: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].equity;
      const cur = equityCurve[i].equity;
      if (prev > 0) returns.push((cur - prev) / prev);
    }
    if (returns.length > 0) {
      const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
      const stddev = Math.sqrt(variance);
      if (stddev > 0) {
        sharpeRatio = (meanReturn / stddev) * Math.sqrt(cpy);
      }
      // Downside deviation (only negative returns).
      const downsideReturns = returns.filter((r) => r < 0);
      if (downsideReturns.length > 0) {
        const downsideVar = downsideReturns.reduce((s, r) => s + r * r, 0) / returns.length;
        const downsideDev = Math.sqrt(downsideVar);
        if (downsideDev > 0) {
          sortinoRatio = (meanReturn / downsideDev) * Math.sqrt(cpy);
        }
      }
    }
  }

  // Calmar = totalReturnPct / maxDrawdownPct (annualized totalReturn optional;
  // we use the raw totalReturnPct over the backtest period — simpler).
  const calmarRatio = maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : NaN;

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
    totalFees: Math.round(totalFees * 100) / 100,
    avgPositionSizePct: Math.round(avgPositionSizePct * 10) / 10,
    sharpeRatio: Number.isFinite(sharpeRatio) ? Math.round(sharpeRatio * 100) / 100 : NaN,
    sortinoRatio: Number.isFinite(sortinoRatio) ? Math.round(sortinoRatio * 100) / 100 : NaN,
    calmarRatio: Number.isFinite(calmarRatio) ? Math.round(calmarRatio * 100) / 100 : NaN,
    maxWinStreak,
    maxLossStreak,
    avgWinPct: Math.round(avgWinPct * 100) / 100,
    avgLossPct: Math.round(avgLossPct * 100) / 100,
    expectancyPct: Math.round(expectancyPct * 100) / 100,
  };
}

/** Build the duration distribution histogram (4 buckets + 1 overflow).
 *  Ranges are inclusive on both ends, so holdCandles of exactly 5, 10, 20 or
 *  50 land in the labeled bucket instead of falling between buckets. */
export function computeDurationBuckets(trades: BacktestTrade[]): DurationBucket[] {
  const buckets: DurationBucket[] = [
    { min: 1, max: 5, label: "1-5", count: 0 },
    { min: 6, max: 10, label: "6-10", count: 0 },
    { min: 11, max: 20, label: "11-20", count: 0 },
    { min: 21, max: 50, label: "21-50", count: 0 },
    { min: 51, max: Infinity, label: "50+", count: 0 },
  ];
  for (const t of trades) {
    const h = t.holdCandles;
    for (const b of buckets) {
      if (h >= b.min && h <= b.max) {
        b.count++;
        break;
      }
    }
  }
  return buckets;
}

// ============================================================
// MULTI-SYMBOL BACKTEST
// ============================================================

/** Per-symbol result within a multi-symbol backtest. */
export type PerSymbolResult = {
  symbol: string;
  /** The full single-symbol BacktestResult (with its own equity curve, trades, stats). */
  result: BacktestResult;
  /** This symbol's allocation as a fraction of the total capital (1/N). */
  allocation: number;
  /** Final equity for this symbol's slice. */
  finalEquity: number;
  /** Return % for this symbol's slice. */
  totalReturnPct: number;
};

/** Aggregated multi-symbol backtest result. */
export type MultiSymbolBacktestResult = {
  symbols: string[];
  interval: string;
  candlesAnalyzed: number;
  provider: ProviderId;
  /** Aggregated stats across all symbols (combined trades, weighted returns). */
  stats: BacktestStats;
  /** Aggregated equity curve — sum of all per-symbol equity curves at each candle index. */
  equityCurve: EquityPoint[];
  /** Per-symbol breakdown for the comparison table. */
  perSymbol: PerSymbolResult[];
  strategy: { id: string; name: string; action: string };
  params: {
    minConfidence: number;
    initialCapital: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldCandles: number;
    positionSizing: PositionSizing;
    fixedFractionalPct: number;
    feeBps: number;
  };
  errors: string[];
};

/**
 * Run a backtest across multiple symbols simultaneously. Each symbol gets
 * an equal slice of the initial capital (initialCapital / N) and is traded
 * independently using the same strategy + params. The aggregated equity
 * curve is the sum of all per-symbol equity curves at each candle index.
 *
 * This answers questions like "does my strategy work across the whole
 * watchlist, or only on BTC?" and provides a per-symbol breakdown so the
 * user can see which symbols contribute positively vs negatively.
 */
export async function runMultiSymbolBacktest(
  params: Omit<BacktestParams, "symbol"> & { symbols: string[] },
): Promise<MultiSymbolBacktestResult> {
  const {
    symbols,
    interval,
    limit,
    strategy,
    action,
    minConfidence = 60,
    initialCapital = 10_000,
    stopLossPct = 5,
    takeProfitPct = 10,
    maxHoldCandles = 50,
    positionSizing = "full",
    fixedFractionalPct = 25,
    feeBps = 10,
  } = params;

  const validSymbols = symbols.filter((s) => s && s.length > 0);
  const errors: string[] = [];

  if (validSymbols.length === 0) {
    return {
      symbols: [],
      interval,
      candlesAnalyzed: 0,
      provider: "binance",
      stats: emptyStats(initialCapital),
      equityCurve: [],
      perSymbol: [],
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
      errors: ["No symbols provided."],
    };
  }

  const perSymbolCapital = initialCapital / validSymbols.length;

  // Run each symbol's backtest in parallel.
  const results = await Promise.all(
    validSymbols.map(async (symbol) => {
      try {
        const result = await runBacktest({
          symbol,
          interval,
          limit,
          strategy,
          action,
          minConfidence,
          initialCapital: perSymbolCapital,
          stopLossPct,
          takeProfitPct,
          maxHoldCandles,
          positionSizing,
          fixedFractionalPct,
          feeBps,
        });
        if (result.error) {
          errors.push(`${symbol}: ${result.error}`);
        }
        return { symbol, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${symbol}: ${msg}`);
        return { symbol, result: null };
      }
    }),
  );

  // Build per-symbol breakdown.
  const perSymbol: PerSymbolResult[] = [];
  for (const { symbol, result } of results) {
    if (!result || result.error) continue;
    perSymbol.push({
      symbol,
      result,
      allocation: 1 / validSymbols.length,
      finalEquity: result.stats.finalEquity,
      totalReturnPct: result.stats.totalReturnPct,
    });
  }

  if (perSymbol.length === 0) {
    return {
      symbols: validSymbols,
      interval,
      candlesAnalyzed: 0,
      provider: "binance",
      stats: emptyStats(initialCapital),
      equityCurve: [],
      perSymbol: [],
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
      errors,
    };
  }

  // Aggregate equity curve: sum all per-symbol equity curves at each candle index.
  // All symbols should have the same number of candles (same interval + limit),
  // but we handle different lengths gracefully by using the shortest.
  const minLen = Math.min(...perSymbol.map((p) => p.result.equityCurve.length));
  const aggregatedEquity: EquityPoint[] = [];
  let peakEquity = initialCapital;
  let maxDrawdownPct = 0;
  for (let i = 0; i < minLen; i++) {
    let totalEquity = 0;
    let inPosition = false;
    let time = 0;
    for (const p of perSymbol) {
      const pt = p.result.equityCurve[i];
      totalEquity += pt.equity;
      if (pt.inPosition) inPosition = true;
      if (time === 0) time = pt.time;
    }
    aggregatedEquity.push({
      candleIndex: i,
      time,
      equity: totalEquity,
      inPosition,
    });
    if (totalEquity > peakEquity) peakEquity = totalEquity;
    if (peakEquity > 0) {
      const dd = ((peakEquity - totalEquity) / peakEquity) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  // Aggregate trades: combine all trades from all symbols.
  const allTrades: BacktestTrade[] = [];
  let totalFees = 0;
  for (const p of perSymbol) {
    allTrades.push(...p.result.trades);
    totalFees += p.result.stats.totalFees;
  }

  // Compute aggregated final equity.
  const finalEquity = perSymbol.reduce((sum, p) => sum + p.result.stats.finalEquity, 0);
  const provider = perSymbol[0].result.provider;
  const candlesAnalyzed = perSymbol[0].result.candlesAnalyzed;

  // Compute aggregated stats using the combined trades + aggregated equity curve.
  const stats = computeStats(allTrades, finalEquity, initialCapital, maxDrawdownPct, totalFees, aggregatedEquity, interval);

  return {
    symbols: validSymbols,
    interval,
    candlesAnalyzed,
    provider,
    stats,
    equityCurve: aggregatedEquity,
    perSymbol,
    strategy: { id: strategy.id, name: strategy.name, action },
    params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
    errors,
  };
}

// ============================================================
// WALK-FORWARD OPTIMIZATION
// ============================================================

/**
 * Per-window summary. Deliberately small: the API payload grows with
 * `windows.length`, and the UI consumes only a couple of numbers per window.
 * Carrying each segment's full `BacktestResult` (equity curve, trades,
 * duration buckets included) made a 50-window response ~1.4 MB.
 */
export type WalkForwardWindowStats = {
  /** Candles in this IS/OOS segment. */
  candles: number;
  /** Total return % over the segment (rounded to 2 decimals). */
  returnPct: number;
  /** Closed trades in the segment. */
  trades: number;
  wins: number;
  losses: number;
  maxDrawdownPct: number;
  /** Sharpe ratio with NaN collapsed to 0 (JSON-safe). */
  sharpeRatio: number;
};

/**
 * WalkForwardWindow — one IS/OOS slice of the historical series.
 *
 * Windows slide by `stepSize` (default = OOS size): consecutive windows
 * contribute CONTIGUOUS, NON-overlapping OOS data, while their IS portions
 * do overlap. Both segments are simulated over a snapshot series built ONCE
 * from the full fetched history, so every candle inside a window carries the
 * same warm-indicator context live trading would — OOS results are never
 * handicapped by a cold indicator series re-computed from its own slice.
 */
export type WalkForwardWindow = {
  /** Sequential window index (1-based for display). */
  index: number;
  /** Inclusive start index of the window inside the snapshot series. */
  startIndex: number;
  /** Exclusive end index of the window inside the snapshot series. */
  endIndex: number;
  inSample: WalkForwardWindowStats;
  outOfSample: WalkForwardWindowStats;
};

/**
 * Aggregated robustness metrics across all walk-forward windows.
 *
 * - `avgOosReturnPct` / `avgIsReturnPct` — mean of the per-window segment
 *   returns. A robust strategy has OOS returns close to IS returns.
 * - `efficiency` — avgOos / avgIs (see `computeEfficiency`; `null` when the
 *   IS mean is 0 and the OOS mean is not — JSON cannot carry Infinity).
 * - `positiveOosRate` — percentage of windows whose OOS return > 0.
 * - `robustnessRate` — percentage of windows whose positive IS return
 *   kept at least half of itself out-of-sample (per-window OOS >= IS/2).
 * - `avgOosSharpe` / `avgOosMaxDD` — mean Sharpe / max drawdown across OOS
 *   segments (NaN Sharpe treated as 0).
 * - `totalOosTrades` — sum of OOS trade counts.
 */
export type WalkForwardRobustness = {
  avgOosReturnPct: number;
  avgIsReturnPct: number;
  efficiency: number | null;
  positiveOosRate: number;
  robustnessRate: number;
  avgOosSharpe: number;
  avgOosMaxDD: number;
  totalOosTrades: number;
};

export type WalkForwardResult = {
  symbol: string;
  interval: string;
  windows: WalkForwardWindow[];
  robustness: WalkForwardRobustness;
  strategy: { id: string; name: string; action: string };
  params: {
    windowSize: number;
    inSampleRatio: number;
    minConfidence: number;
    initialCapital: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldCandles: number;
    positionSizing: PositionSizing;
    fixedFractionalPct: number;
    feeBps: number;
  };
  error?: string;
};

/** Verdict used by the UI's Robusto / Moderado / Sobreajuste chip. */
export type RobustnessVerdict = "good" | "medium" | "poor" | "none";

/**
 * OOS/IS efficiency ratio. Returns `null` ("not computable") when the IS
 * return is 0 and OOS is not — the ratio is undefined there, and JSON has no
 * representation for ±Infinity. A 0/0 pair stays 0 (nothing to degrade).
 */
export function computeEfficiency(
  isReturnPct: number,
  oosReturnPct: number,
): number | null {
  if (!Number.isFinite(isReturnPct) || !Number.isFinite(oosReturnPct)) {
    return null;
  }
  if (isReturnPct === 0) return oosReturnPct === 0 ? 0 : null;
  const eff = oosReturnPct / isReturnPct;
  return Number.isFinite(eff) ? eff : null;
}

/** efficiency >= 0.5 → robust, >= 0.3 → moderate, else overfit. */
export function classifyEfficiency(efficiency: number | null): RobustnessVerdict {
  if (efficiency == null || !Number.isFinite(efficiency)) return "none";
  if (efficiency >= 0.5) return "good";
  if (efficiency >= 0.3) return "medium";
  return "poor";
}

/** Empty robustness object (used when no windows could be built). Exported so
 * the API route's catch path returns the exact same zero object instead of
 * duplicating the literal. */
export function emptyRobustness(): WalkForwardRobustness {
  return {
    avgOosReturnPct: 0,
    avgIsReturnPct: 0,
    efficiency: 0,
    positiveOosRate: 0,
    robustnessRate: 0,
    avgOosSharpe: 0,
    avgOosMaxDD: 0,
    totalOosTrades: 0,
  };
}

/**
 * Aggregate OOS performance across all walk-forward windows into the
 * robustness metrics.
 */
export function computeRobustness(
  windows: WalkForwardWindow[],
): WalkForwardRobustness {
  if (windows.length === 0) return emptyRobustness();
  const n = windows.length;
  let sumIsReturn = 0;
  let sumOosReturn = 0;
  let positiveOosCount = 0;
  let robustCount = 0;
  let sumOosSharpe = 0;
  let sumOosMaxDD = 0;
  let totalOosTrades = 0;
  for (const w of windows) {
    const isRet = w.inSample.returnPct;
    const oosRet = w.outOfSample.returnPct;
    sumIsReturn += isRet;
    sumOosReturn += oosRet;
    if (oosRet > 0) positiveOosCount++;
    // Per-window robustness: OOS kept at least half of a positive IS return.
    if (isRet > 0 && oosRet >= isRet * 0.5) robustCount++;
    sumOosSharpe += w.outOfSample.sharpeRatio;
    sumOosMaxDD += w.outOfSample.maxDrawdownPct;
    totalOosTrades += w.outOfSample.trades;
  }
  const avgIs = sumIsReturn / n;
  const avgOos = sumOosReturn / n;
  return {
    avgOosReturnPct: Math.round(avgOos * 100) / 100,
    avgIsReturnPct: Math.round(avgIs * 100) / 100,
    efficiency: computeEfficiency(avgIs, avgOos),
    positiveOosRate: Math.round((positiveOosCount / n) * 1000) / 10,
    robustnessRate: Math.round((robustCount / n) * 1000) / 10,
    avgOosSharpe: Math.round((sumOosSharpe / n) * 100) / 100,
    avgOosMaxDD: Math.round((sumOosMaxDD / n) * 100) / 100,
    totalOosTrades,
  };
}

/** Concrete walk-forward window plan derived from the user inputs. */
export type WalkForwardPlan = {
  isSize: number;
  oosSize: number;
  effectiveWindow: number;
  effectiveStep: number;
  /** Windows that actually fit in the history (capped at 50). */
  windowCount: number;
  /** Clamped inputs, echoed back in WalkForwardResult.params. */
  windowSize: number;
  inSampleRatio: number;
};

/**
 * Derive the walk-forward plan from user inputs (pure; no I/O).
 *
 * - windowSize clamped to 100-1000 candles, inSampleRatio to 0.3-0.9.
 * - OOS has at least 20 candles; IS at least 30, so a window can still trade
 *   even at extreme ratios.
 * - Step defaults to the OOS size (contiguous OOS data across windows) and a
 *   caller-supplied step is clamped UP to >= oosSize: a step below the OOS
 *   size would sample the same OOS candles in several windows and
 *   double-count them in the positive/robustness rates.
 * - Max 50 windows so a small step cannot blow up the response payload.
 */
export function planWalkForwardWindows(
  snapshotCount: number,
  windowSize: number,
  inSampleRatio = 0.7,
  stepSize?: number,
): WalkForwardPlan {
  const safeWindowSize = Math.max(100, Math.min(1000, Math.floor(windowSize)));
  const safeRatio = Math.max(0.3, Math.min(0.9, inSampleRatio));
  // + 1e-9 guards float dust: 1 - 0.2 = 0.19999999999999998 would floor a
  // 100-candle OOS to 99 without it.
  const oosSize = Math.max(20, Math.floor(safeWindowSize * (1 - safeRatio) + 1e-9));
  const isSize = Math.max(30, safeWindowSize - oosSize);
  const effectiveWindow = isSize + oosSize;
  const requestedStep =
    stepSize != null && Number.isFinite(stepSize) ? Math.floor(stepSize) : oosSize;
  const effectiveStep = Math.max(oosSize, requestedStep);
  const windowCount =
    snapshotCount >= effectiveWindow
      ? Math.min(
          50,
          Math.floor((snapshotCount - effectiveWindow) / effectiveStep) + 1,
        )
      : 0;
  return {
    isSize,
    oosSize,
    effectiveWindow,
    effectiveStep,
    windowCount,
    windowSize: safeWindowSize,
    inSampleRatio: safeRatio,
  };
}

/** Collapse a full BacktestResult into its JSON-safe per-window summary. */
function toWindowStats(
  result: BacktestResult,
  candles: number,
): WalkForwardWindowStats {
  const s = result.stats;
  return {
    candles,
    returnPct: Math.round(s.totalReturnPct * 100) / 100,
    trades: s.totalTrades,
    wins: s.wins,
    losses: s.losses,
    maxDrawdownPct: Math.round(s.maxDrawdownPct * 100) / 100,
    sharpeRatio: Number.isFinite(s.sharpeRatio) ? Math.round(s.sharpeRatio * 100) / 100 : 0,
  };
}

/**
 * Build and simulate the walk-forward windows over a pre-built snapshot
 * series. Pure: no fetching, no I/O (see runWalkForward for the live call).
 *
 * Both segments run `simulateTrades` with warmupIndex 0: the snapshot series
 * was built over the WHOLE fetched history, so the indicators at every
 * candle inside a window already have their full-history context — including
 * the EMA55/EMA200 cross, which a 150-candle OOS slice re-computed from
 * scratch could never produce.
 */
export function buildWalkForwardWindows(
  snapshots: CandleSnapshot[],
  plan: WalkForwardPlan,
  simParams: TradeSimParams,
  provider: ProviderId = "binance",
): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  for (let w = 0; w < plan.windowCount; w++) {
    const start = w * plan.effectiveStep;
    if (start + plan.effectiveWindow > snapshots.length) break;
    const inSampleSnapshots = snapshots.slice(start, start + plan.isSize);
    const oosSnapshots = snapshots.slice(start + plan.isSize, start + plan.effectiveWindow);
    windows.push({
      index: w + 1,
      startIndex: start,
      endIndex: start + plan.effectiveWindow,
      inSample: toWindowStats(
        simulateTrades(inSampleSnapshots, simParams, 0, provider),
        plan.isSize,
      ),
      outOfSample: toWindowStats(
        simulateTrades(oosSnapshots, simParams, 0, provider),
        plan.oosSize,
      ),
    });
  }
  return windows;
}

/**
 * Run a walk-forward optimization: fetch a long history, split it into
 * sliding IS+OOS windows, run the strategy on each segment over a single
 * pre-warmed indicator series, and aggregate OOS performance into
 * robustness metrics.
 */
export async function runWalkForward(
  params: BacktestParams & { windowSize: number; inSampleRatio?: number; stepSize?: number },
): Promise<WalkForwardResult> {
  const {
    symbol,
    interval,
    strategy,
    action,
    minConfidence = 60,
    initialCapital = 10_000,
    stopLossPct = 5,
    takeProfitPct = 10,
    maxHoldCandles = 50,
    positionSizing = "full",
    fixedFractionalPct = 25,
    feeBps = 10,
    windowSize,
    inSampleRatio,
    stepSize,
  } = params;

  const simParams: TradeSimParams = {
    symbol,
    interval,
    strategy,
    action,
    minConfidence,
    initialCapital,
    stopLossPct,
    takeProfitPct,
    maxHoldCandles,
    positionSizing,
    fixedFractionalPct,
    feeBps,
  };

  let provider: ProviderId = "binance";
  let klines: Kline[] = [];
  try {
    const res = await providerRouter.getKlines(symbol, interval, 1000);
    klines = res.klines;
    provider = res.provider;
  } catch {
    return {
      symbol,
      interval,
      windows: [],
      robustness: emptyRobustness(),
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { windowSize: Math.floor(windowSize) || 0, inSampleRatio: inSampleRatio ?? 0.7, minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
      error: "Failed to fetch historical klines from upstream provider.",
    };
  }

  const snapshots = buildSnapshots(klines, symbol);
  const plan = planWalkForwardWindows(snapshots.length, windowSize, inSampleRatio, stepSize);

  if (plan.windowCount === 0) {
    return {
      symbol,
      interval,
      windows: [],
      robustness: emptyRobustness(),
      strategy: { id: strategy.id, name: strategy.name, action },
      params: { windowSize: plan.windowSize, inSampleRatio: plan.inSampleRatio, minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
      error: `Insufficient historical data (${klines.length} candles; need at least ${plan.effectiveWindow} for one ${plan.isSize}/${plan.oosSize} IS/OOS window).`,
    };
  }

  const windows = buildWalkForwardWindows(snapshots, plan, simParams, provider);
  const robustness = computeRobustness(windows);

  return {
    symbol,
    interval,
    windows,
    robustness,
    strategy: { id: strategy.id, name: strategy.name, action },
    params: { windowSize: plan.windowSize, inSampleRatio: plan.inSampleRatio, minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
  };
}

/**
 * Klines para corridas de backtest EN SERVIDOR con cache TTL de 60s.
 * POST /api/backtest/compare la llama UNA VEZ antes de correr N estrategias
 * e inyecta el resultado via preloadedKlines — así N estrategias comparten
 * la misma respuesta de upstream (regla del spec: N estrategias NO
 * significan N descargas de Binance).
 */
export async function fetchKlinesCached(
  symbol: string,
  interval: BacktestInterval,
  limit: number,
): Promise<{ klines: Kline[]; provider: ProviderId }> {
  const safeLimit = Math.max(220, Math.min(1000, Math.floor(limit)));
  const key = `backtest:klines:${symbol}:${interval}:${safeLimit}`;
  const hit = getCached<{ klines: Kline[]; provider: ProviderId }>(key);
  if (hit) return hit;
  const res = await providerRouter.getKlines(symbol, interval, safeLimit);
  setCached(key, res);
  return res;
}
