/**
 * Shared types between the API route and the frontend.
 * Kept in lib/ (not in the route file) so client components can import
 * the type without pulling route-side code into the client bundle.
 */

export type CrossState = "ALCISTA" | "BAJISTA" | "COMPRIMIDO";

export type CrossInfo = {
  /** Fresh cross within `recentThreshold` candles (default 10). */
  happened: boolean;
  candles_since_cross: number | null;
  direction: "bullish" | "bearish" | null;
  window: number;
};

export type MacdCrossInfo = {
  /** Fresh MACD/signal cross within `recentThreshold` bars (default 6). */
  happened: boolean;
  candles_since_cross: number | null;
  direction: "bullish" | "bearish" | null;
  /** Histogram sign flip within `recentThreshold` bars (momentum shift). */
  momentum_flip: boolean;
  momentum_flip_direction: "bullish" | "bearish" | null;
  candles_since_flip: number | null;
  window: number;
};

export type AnalysisResponse = {
  symbol: string;
  spot_price: number | null;
  change_24h_pct: number | null;
  ema55_4h: number | null;
  ema200_4h: number | null;
  cross_state: CrossState | null;
  cross_info: CrossInfo | null;
  resistance: number | null;
  support: number | null;
  /** RSI(14) on 4h closes — Wilder smoothing. */
  rsi_14_4h: number | null;
  /** 24h quote volume in USD (from ticker). */
  volume_24h_usd: number | null;
  /** 24h trade count (from ticker). */
  trades_24h: number | null;
  /** 24h high / low (from ticker). */
  high_24h: number | null;
  low_24h: number | null;
  /** MACD(12, 26, 9) on 4h closes — Gerald Appel defaults. */
  macd: {
    line: number | null;
    signal: number | null;
    histogram: number | null;
  };
  /** MACD/signal crossover detection (recent + momentum flip). */
  macd_cross: MacdCrossInfo | null;
  /** ATR(14) on 4h — volatility measure (Average True Range, Wilder). */
  atr_14_4h: number | null;
  /** Bollinger Bands (20, 2) on 4h — SMA ± 2 stddev. */
  bollinger: {
    upper: number | null;
    middle: number | null;
    lower: number | null;
    bandwidth: number | null; // (upper - lower) / middle * 100
  };
  /** Bollinger squeeze detection — true when bandwidth < threshold (default 3%). */
  bollinger_squeeze: {
    is_squeezed: boolean;
    threshold_pct: number;
    bandwidth: number | null;
  };
  /** Squeeze breakout — when bandwidth crosses from <3% to ≥3% (volatility expansion). */
  squeeze_breakout: {
    happened: boolean;
    direction: "bullish" | "bearish" | null;
    candles_since_breakout: number | null;
    bandwidth_before: number | null;
    bandwidth_after: number | null;
  };
  /** ATR-based stop loss suggestion — price - ATR * multiplier. */
  stop_loss_suggestion: {
    price: number | null;
    atr: number | null;
    multiplier: number;
    /** "long" stop (below price) or "short" stop (above price). */
    direction: "long" | "short";
  } | null;
  /** Fibonacci retracement levels over the last swing (100 candles). */
  fibonacci: {
    swing_high: number | null;
    swing_low: number | null;
    direction: "up" | "down" | null;
    levels: { ratio: number; price: number; label: string }[];
    /** Extension levels (127.2%, 161.8%, 261.8%) — profit targets. */
    extensions: { ratio: number; price: number; label: string }[];
  } | null;
  /** VWAP(20) on 4h — Volume Weighted Average Price, rolling 20 candles. */
  vwap_20_4h: number | null;
  /** Stochastic oscillator %K and %D (14, 3). */
  stochastic: { k: number | null; d: number | null };
  structure_text: string;
  no_disponible: {
    spot_price: boolean;
    change_24h_pct: boolean;
    ema55_4h: boolean;
    ema200_4h: boolean;
    cross_state: boolean;
    cross_info: boolean;
    resistance: boolean;
    support: boolean;
    rsi_14_4h: boolean;
    volume_24h_usd: boolean;
    high_24h: boolean;
    low_24h: boolean;
    macd: boolean;
    macd_cross: boolean;
    atr_14_4h: boolean;
    bollinger: boolean;
    bollinger_squeeze: boolean;
    squeeze_breakout: boolean;
    stop_loss_suggestion: boolean;
    fibonacci: boolean;
    vwap_20_4h: boolean;
    stochastic: boolean;
  };
  series: {
    closes: number[];
    ema55: (number | null)[];
    ema200: (number | null)[];
    rsi: (number | null)[];
    macd_histogram: (number | null)[];
    bollinger_upper: (number | null)[];
    bollinger_lower: (number | null)[];
    vwap: (number | null)[];
  };
  updated_at: string;
};

export type AssetError = { error: string };

export const SYMBOL_META: Record<
  string,
  { label: string; pair: string; asset: string; quote: string }
> = {
  BTCUSDT: { label: "Bitcoin", pair: "BTC / USD", asset: "BTC", quote: "USD" },
  ETHUSDT: { label: "Ethereum", pair: "ETH / USD", asset: "ETH", quote: "USD" },
  XRPUSDT: { label: "Ripple", pair: "XRP / USD", asset: "XRP", quote: "USD" },
  SOLUSDT: { label: "Solana", pair: "SOL / USD", asset: "SOL", quote: "USD" },
  BNBUSDT: { label: "BNB", pair: "BNB / USD", asset: "BNB", quote: "USD" },
};

export const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "BNBUSDT",
] as const;
/** Extended set including SOL and BNB (used by the API + mini-services). */
export const ALL_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "XRPUSDT",
  "SOLUSDT",
  "BNBUSDT",
] as const;

/** User-defined price alert (stored in localStorage, checked against live ticks). */
export type PriceAlert = {
  id: string;
  symbol: string;
  price: number;
  direction: "above" | "below";
  createdAt: number;
  triggered: boolean;
};
