/**
 * Symbol manager — dynamic watchlist of crypto tickers stored in localStorage.
 *
 * The default watchlist is the 5 hardcoded symbols (BTC/ETH/XRP/SOL/BNB), but
 * users can add any Binance USDT pair (e.g. ADAUSDT, DOTUSDT, LINKUSDT) and
 * remove symbols they don't care about. The list persists across page reloads.
 *
 * Validation: a symbol must be uppercase, end with "USDT", be 8-16 chars
 * total, and consist only of letters. The actual existence of the trading
 * pair on Binance is validated lazily by the /api/analysis endpoint (which
 * returns a 400/error if Binance rejects the symbol).
 */

import { SYMBOLS } from "./types";

const STORAGE_KEY = "panel:watchlist";
const MAX_SYMBOLS = 20;

export type Watchlist = {
  symbols: string[];
};

/** Default watchlist — the 5 hardcoded symbols. */
export const DEFAULT_WATCHLIST: string[] = [...SYMBOLS];

/**
 * Load the watchlist from localStorage. Falls back to DEFAULT_WATCHLIST
 * if nothing is stored, the stored value is malformed, or the stored list
 * is empty (we always keep at least 1 symbol).
 */
export function loadWatchlist(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_WATCHLIST];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_WATCHLIST];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_WATCHLIST];
    // Filter to valid-looking symbols only.
    const valid = parsed.filter(
      (s): s is string =>
        typeof s === "string" && /^[A-Z]{2,12}USDT$/.test(s),
    );
    if (valid.length === 0) return [...DEFAULT_WATCHLIST];
    // Dedupe + cap.
    return Array.from(new Set(valid)).slice(0, MAX_SYMBOLS);
  } catch {
    return [...DEFAULT_WATCHLIST];
  }
}

/** Persist the watchlist to localStorage. */
export function saveWatchlist(symbols: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const capped = symbols.slice(0, MAX_SYMBOLS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // ignore quota errors
  }
}

/**
 * Validate a symbol string. Returns the normalized symbol (uppercase) if
 * valid, null otherwise.
 *
 * Rules:
 *   - Must be uppercase or lowercase letters only (we normalize to upper).
 *   - Must end with "USDT" (we only support USDT-quoted pairs for now).
 *   - Total length 6-16 chars (e.g. BTCUSDT=7, DOGEUSDT=8).
 *   - Base asset must be 2-12 letters.
 */
export function validateSymbol(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{2,12}USDT$/.test(normalized)) return null;
  if (normalized.length < 6 || normalized.length > 16) return null;
  return normalized;
}

/**
 * Add a symbol to the watchlist. Returns the new list.
 * - If the symbol is invalid or already present, returns the unchanged list.
 * - If the list is at MAX_SYMBOLS, the new symbol is not added.
 */
export function addSymbol(symbols: string[], symbol: string): string[] {
  const valid = validateSymbol(symbol);
  if (!valid) return symbols;
  if (symbols.includes(valid)) return symbols;
  if (symbols.length >= MAX_SYMBOLS) return symbols;
  const next = [...symbols, valid];
  saveWatchlist(next);
  return next;
}

/**
 * Remove a symbol from the watchlist. Returns the new list.
 * - Always keeps at least 1 symbol (if trying to remove the last one,
 *   returns the unchanged list).
 */
export function removeSymbol(symbols: string[], symbol: string): string[] {
  if (symbols.length <= 1) return symbols;
  const next = symbols.filter((s) => s !== symbol);
  saveWatchlist(next);
  return next;
}

/** Reset the watchlist to the default 5 symbols. */
export function resetWatchlist(): string[] {
  const next = [...DEFAULT_WATCHLIST];
  saveWatchlist(next);
  return next;
}

/** Get the maximum number of symbols allowed in the watchlist. */
export function getMaxSymbols(): number {
  return MAX_SYMBOLS;
}

/**
 * Derive a display label for a symbol. For known symbols (in SYMBOL_META),
 * returns the stored label. For unknown symbols, derives a reasonable label
 * from the ticker (e.g. "ADAUSDT" → "ADA", "DOTUSDT" → "DOT").
 */
export function getSymbolLabel(symbol: string, knownLabels: Record<string, string>): string {
  if (knownLabels[symbol]) return knownLabels[symbol];
  // Strip the USDT suffix and return the base asset as the label.
  return symbol.replace(/USDT$/, "");
}

/**
 * Derive a pair label for a symbol. For known symbols, returns the stored
 * pair (e.g. "BTC / USD"). For unknown, returns "{BASE} / USD".
 */
export function getSymbolPair(symbol: string, knownPairs: Record<string, string>): string {
  if (knownPairs[symbol]) return knownPairs[symbol];
  const base = symbol.replace(/USDT$/, "");
  return `${base} / USD`;
}

/**
 * Derive the base asset name for a symbol. E.g. "BTCUSDT" → "BTC".
 */
export function getSymbolAsset(symbol: string): string {
  return symbol.replace(/USDT$/, "");
}
