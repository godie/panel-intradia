import { SYMBOLS } from "@/lib/types";

const SUPPORTED = new Set<string>(SYMBOLS as readonly string[]);

/** Binance USDT spot pairs: 2-12 uppercase letters for the base asset + "USDT". */
const SYMBOL_FORMAT = /^[A-Z]{2,12}USDT$/;

export function isSupportedSymbol(symbol: string): boolean {
  return SUPPORTED.has(symbol);
}

/**
 * Validate that a symbol string is a plausible Binance USDT spot pair.
 *
 * Only checks the shape (uppercase letters, ends with "USDT", 6-16 chars).
 * Whether the pair actually exists on Binance is validated lazily by the
 * upstream klines/ticker fetch, which errors for unknown pairs.
 */
export function isValidSymbolFormat(symbol: string): boolean {
  return SYMBOL_FORMAT.test(symbol);
}

export function toBinanceSymbol(symbol: string): string {
  return symbol;
}

export function fromBinanceSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

export function toBybitSymbol(symbol: string): string {
  // Bybit v5 uses the same "BTCUSDT" form for spot USDT pairs.
  return symbol;
}

export function fromBybitSymbol(symbol: string): string {
  return symbol.toUpperCase();
}