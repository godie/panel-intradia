/**
 * MarketDataProvider — the abstraction every upstream (Binance, Bybit, ...)
 * must implement so the rest of the app stays exchange-agnostic.
 *
 * Conventions:
 *  - All symbols passed in / returned are uppercase and end in "USDT"
 *    (e.g. "BTCUSDT"). Per-exchange remapping lives in `symbols.ts`.
 *  - All network calls inside implementations MUST throw `UpstreamError`
 *    on failure so the router can treat failures uniformly.
 *  - `getKlines` and `getTicker24h` return parsed data or throw — they
 *    never return partial data.
 *  - `subscribeTicks` returns an `unsubscribe` function; the router
 *    holds the active subscription and tears it down on provider swap.
 */

export type ProviderId = "binance" | "bybit";

export type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
};

export type Ticker24h = {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  trades: number;
};

export type TickEvent = {
  symbol: string;
  price: number;
  time: number;
};

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly upstream?: unknown,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export type Unsubscribe = () => void;

export interface MarketDataProvider {
  readonly id: ProviderId;
  getKlines(symbol: string, interval?: string, limit?: number): Promise<Kline[]>;
  getTicker24h(symbol: string): Promise<Ticker24h | null>;
  subscribeTicks(
    symbols: string[],
    onTick: (t: TickEvent) => void,
    onStatus: (status: { connected: boolean }) => void,
  ): Unsubscribe;
  healthy(): Promise<boolean>;
}
