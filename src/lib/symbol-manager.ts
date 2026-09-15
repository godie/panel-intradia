/**
 * Symbol manager — dynamic watchlist of crypto tickers stored in localStorage.
 *
 * The default watchlist is the 5 hardcoded symbols (BTC/ETH/XRP/SOL/BNB), but
 * users can add any Binance USDT pair (e.g. ADAUSDT, DOTUSDT, LINKUSDT) and
 * remove symbols they don't care about. The list persists across page reloads.
 *
 * Shape validation is shared with the API routes via `isValidSymbolFormat`;
 * whether the pair actually exists on Binance is validated lazily by
 * /api/analysis (which returns an error for unknown symbols).
 */

import { SYMBOLS } from "./types";
import { isValidSymbolFormat } from "./providers/symbols";

const STORAGE_KEY = "panel:watchlist";
const MAX_SYMBOLS = 20;

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
    const valid = parsed.filter(
      (s): s is string => typeof s === "string" && isValidSymbolFormat(s),
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
 * valid, null otherwise. Accepts lowercase input and normalizes it.
 */
export function validateSymbol(input: string): string | null {
  const normalized = input.trim().toUpperCase();
  return isValidSymbolFormat(normalized) ? normalized : null;
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
