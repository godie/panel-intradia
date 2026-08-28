/**
 * Shared types between the API route and the frontend.
 * Kept in lib/ (not in the route file) so client components can import
 * the type without pulling route-side code into the client bundle.
 */

export type CrossState = "ALCISTA" | "BAJISTA" | "COMPRIMIDO";

export type AnalysisResponse = {
  symbol: string;
  spot_price: number | null;
  change_24h_pct: number | null;
  ema55_4h: number | null;
  ema200_4h: number | null;
  cross_state: CrossState | null;
  resistance: number | null;
  support: number | null;
  structure_text: string;
  no_disponible: {
    spot_price: boolean;
    change_24h_pct: boolean;
    ema55_4h: boolean;
    ema200_4h: boolean;
    cross_state: boolean;
    resistance: boolean;
    support: boolean;
  };
  series: {
    closes: number[];
    ema55: (number | null)[];
    ema200: (number | null)[];
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
