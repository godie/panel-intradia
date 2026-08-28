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
  };
  series: {
    closes: number[];
    ema55: (number | null)[];
    ema200: (number | null)[];
    rsi: (number | null)[];
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
};

export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XRPUSDT"] as const;
