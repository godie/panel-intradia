/**
 * Back-compat shim — the Binance client moved to `src/lib/providers/binance.ts`.
 * Existing imports keep working until Task 11 deletes this file.
 */
export {
  binanceProvider,
  parseKlines as _parseKlines,
  parseTicker as _parseTicker,
} from "./providers/binance";
export type { Kline, Ticker24h } from "./providers/types";
export { UpstreamError as BinanceError } from "./providers/types";
