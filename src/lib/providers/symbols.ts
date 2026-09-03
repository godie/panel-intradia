import { SYMBOLS } from "@/lib/types";

const SUPPORTED = new Set<string>(SYMBOLS as readonly string[]);

export function isSupportedSymbol(symbol: string): boolean {
  return SUPPORTED.has(symbol);
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