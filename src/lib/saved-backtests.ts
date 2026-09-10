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

/**
 * Export all saved backtests as a downloadable JSON file.
 * Triggers a browser download via a Blob + temporary anchor element.
 * Returns the exported JSON string (useful for testing / programmatic use).
 */
export function exportSavedBacktests(): string {
  const data = {
    exported_at: new Date().toISOString(),
    format: "panel-intradia/saved-backtests/v1",
    count: 0,
    backtests: [] as SavedBacktest[],
  };
  const existing = loadSavedBacktests();
  data.backtests = existing;
  data.count = existing.length;
  const json = JSON.stringify(data, null, 2);
  if (typeof window === "undefined") return json;
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `panel-backtests-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    // ignore download errors (e.g. headless browser)
  }
  return json;
}

/**
 * Import saved backtests from a JSON file (uploaded by the user).
 * Merges with existing saved backtests, skipping duplicates by id.
 * Returns the new merged list (capped at MAX_SAVED).
 *
 * The expected JSON shape:
 *   { format: "panel-intradia/saved-backtests/v1", backtests: SavedBacktest[] }
 * or simply an array of SavedBacktest[] (legacy format).
 */
export function importSavedBacktests(jsonText: string): {
  imported: number;
  skipped: number;
  total: number;
  backtests: SavedBacktest[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { imported: 0, skipped: 0, total: 0, backtests: [] };
  }

  // Accept either { backtests: [...] } or a bare array.
  let incoming: SavedBacktest[] = [];
  if (Array.isArray(parsed)) {
    incoming = parsed as SavedBacktest[];
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { backtests?: unknown }).backtests)) {
    incoming = (parsed as { backtests: SavedBacktest[] }).backtests;
  } else {
    return { imported: 0, skipped: 0, total: 0, backtests: [] };
  }

  // Filter to well-formed entries only.
  const valid = incoming.filter(
    (s) =>
      s &&
      typeof s.id === "string" &&
      typeof s.savedAt === "string" &&
      typeof s.label === "string" &&
      s.result &&
      typeof s.result === "object",
  );

  const existing = loadSavedBacktests();
  const existingIds = new Set(existing.map((s) => s.id));

  let imported = 0;
  let skipped = 0;
  // Merge: prepend imported entries (newest-first), skip duplicates by id.
  const merged: SavedBacktest[] = [...existing];
  for (const s of valid) {
    if (existingIds.has(s.id)) {
      skipped++;
    } else {
      merged.unshift(s);
      existingIds.add(s.id);
      imported++;
    }
  }
  const trimmed = merged.slice(0, MAX_SAVED);

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // ignore quota — return what we have in memory
    }
  }

  return {
    imported,
    skipped,
    total: trimmed.length,
    backtests: trimmed,
  };
}

