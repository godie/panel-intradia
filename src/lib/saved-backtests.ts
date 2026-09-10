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

/** Guard that a parsed entry actually has the SavedBacktest shape (defensive
 *  against stale/corrupt data written by older versions of the app). */
function isSavedBacktest(v: unknown): v is SavedBacktest {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  const result = s.result as Record<string, unknown> | null | undefined;
  return (
    typeof s.id === "string" &&
    typeof s.savedAt === "string" &&
    typeof s.label === "string" &&
    typeof result === "object" &&
    result !== null &&
    typeof result.stats === "object" &&
    result.stats !== null
  );
}

/** Load all saved backtests from localStorage. Returns [] on any error. */
export function loadSavedBacktests(): SavedBacktest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedBacktest);
  } catch {
    return [];
  }
}

/** Save a new backtest result. Returns the new SavedBacktest. The list is
 *  capped at MAX_SAVED entries (oldest dropped). If the write exceeds the
 *  localStorage quota, the oldest entries are dropped progressively until
 *  the write fits. */
export function saveBacktest(result: BacktestResult): SavedBacktest | null {
  if (typeof window === "undefined") return null;
  const saved: SavedBacktest = {
    id: generateId(),
    savedAt: new Date().toISOString(),
    label: generateLabel(result),
    result: compactResult(result),
  };
  const existing = loadSavedBacktests();
  for (let drop = 0; drop <= MAX_SAVED; drop++) {
    // Newest-first with the 50-entry cap; on quota failure progressively
    // drop more of the oldest entries until the write fits.
    const kept = existing.slice(0, MAX_SAVED - 1 - drop);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([saved, ...kept]));
      return saved;
    } catch {
      // Quota exceeded — drop one more old entry and retry.
    }
  }
  return null;
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
