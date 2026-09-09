/**
 * Backtest persistence — save / load / delete backtest results in
 * localStorage. Lets users build a history of past runs and re-open or
 * compare them later without re-running the backtest.
 *
 * We persist a compact summary of each backtest (not the full equity curve
 * or trade list, which would blow past the localStorage 5MB quota quickly).
 * The summary is enough to render the comparison view; re-opening a saved
 * backtest can optionally re-run it with the same params to get the full
 * detail back.
 */

import type { BacktestResult } from "@/lib/backtest";

const STORAGE_KEY = "panel:saved-backtests";
const MAX_SAVED = 50;  // cap to avoid localStorage quota issues

export type SavedBacktest = {
  /** Stable id (uuid-like) generated at save time. */
  id: string;
  /** ISO timestamp when the backtest was saved. */
  savedAt: string;
  /** Display label shown in the UI (auto-generated from strategy + symbol). */
  label: string;
  /** The full BacktestResult object (compact — we strip the equityCurve
   *  and trade list to save space, keeping only stats + params + strategy). */
  result: BacktestResult;
};

function generateId(): string {
  return `bt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateLabel(result: BacktestResult): string {
  const stratName = result.strategy.name;
  const sym = result.symbol;
  const interval = result.interval;
  const ret = result.stats.totalReturnPct;
  const sign = ret >= 0 ? "+" : "";
  return `${stratName} · ${sym} ${interval} · ${sign}${ret.toFixed(2)}%`;
}

/** Compact a BacktestResult before storing: drop the (potentially huge)
 *  equityCurve array and truncate the trades list to the first 100. */
function compactResult(result: BacktestResult): BacktestResult {
  return {
    ...result,
    equityCurve: [],  // strip — re-run if the user wants the chart
    trades: result.trades.slice(0, 100),
  };
}

/** Load all saved backtests from localStorage. Returns [] on any error. */
export function loadSavedBacktests(): SavedBacktest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedBacktest[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Save a new backtest result. Returns the new SavedBacktest. The list is
 *  capped at MAX_SAVED entries (oldest dropped). */
export function saveBacktest(result: BacktestResult): SavedBacktest | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = loadSavedBacktests();
    const saved: SavedBacktest = {
      id: generateId(),
      savedAt: new Date().toISOString(),
      label: generateLabel(result),
      result: compactResult(result),
    };
    const updated = [saved, ...existing].slice(0, MAX_SAVED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return saved;
  } catch {
    // Likely quota exceeded — try dropping the oldest entry and retry once.
    try {
      const existing = loadSavedBacktests();
      const saved: SavedBacktest = {
        id: generateId(),
        savedAt: new Date().toISOString(),
        label: generateLabel(result),
        result: compactResult(result),
      };
      const trimmed = [saved, ...existing.slice(0, MAX_SAVED - 1)];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return saved;
    } catch {
      return null;
    }
  }
}

/** Delete a saved backtest by id. Returns the new list. */
export function deleteSavedBacktest(id: string): SavedBacktest[] {
  if (typeof window === "undefined") return [];
  try {
    const existing = loadSavedBacktests();
    const updated = existing.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

/** Clear all saved backtests. */
export function clearSavedBacktests(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
