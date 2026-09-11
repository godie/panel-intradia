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

import type { BacktestResult, BacktestStats, PositionSizing } from "@/lib/backtest";

const STORAGE_KEY = "panel:saved-backtests";
const MAX_SAVED = 50;  // cap to avoid localStorage quota issues

const VALID_POSITION_SIZING: PositionSizing[] = [
  "full",
  "fixed_fractional",
  "half_kelly",
  "kelly",
];

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

/** Coerce an unknown value to a finite number. Numeric strings (hand-edited
 *  JSON, spreadsheet exports) are accepted; anything else falls back. */
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Normalize every numeric field of a persisted stats block. Exports from
 *  older versions lack the v3 risk metrics: they land on the "unavailable"
 *  contract (NaN for ratios, 0 for counters) instead of leaking `undefined`
 *  or strings into the UI, which calls `.toFixed()` on these fields. */
function normalizeStats(raw: unknown): BacktestStats {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    totalTrades: toNumber(s.totalTrades, 0),
    wins: toNumber(s.wins, 0),
    losses: toNumber(s.losses, 0),
    winRate: toNumber(s.winRate, 0),
    totalReturnPct: toNumber(s.totalReturnPct, 0),
    maxDrawdownPct: toNumber(s.maxDrawdownPct, 0),
    // An all-winning run has profitFactor === Infinity, which JSON persists as
    // null. Keep that value non-finite so the UI still renders it as "∞"
    // instead of collapsing it to a misleading 0.00.
    profitFactor: toNumber(s.profitFactor, Infinity),
    avgHoldCandles: toNumber(s.avgHoldCandles, 0),
    bestTradePct: toNumber(s.bestTradePct, 0),
    worstTradePct: toNumber(s.worstTradePct, 0),
    finalEquity: toNumber(s.finalEquity, 0),
    totalFees: toNumber(s.totalFees, 0),
    avgPositionSizePct: toNumber(s.avgPositionSizePct, 0),
    sharpeRatio: toNumber(s.sharpeRatio, NaN),
    sortinoRatio: toNumber(s.sortinoRatio, NaN),
    calmarRatio: toNumber(s.calmarRatio, NaN),
    maxWinStreak: toNumber(s.maxWinStreak, 0),
    maxLossStreak: toNumber(s.maxLossStreak, 0),
    avgWinPct: toNumber(s.avgWinPct, 0),
    avgLossPct: toNumber(s.avgLossPct, 0),
    expectancyPct: toNumber(s.expectancyPct, 0),
  };
}

/** Normalize the persisted params block (numeric fields + sizing enum) so a
 *  foreign export can't render `NaN` in the equity-curve axis labels. */
function normalizeParams(raw: unknown): BacktestResult["params"] {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sizing = p.positionSizing;
  return {
    minConfidence: toNumber(p.minConfidence, 60),
    initialCapital: toNumber(p.initialCapital, 10_000),
    stopLossPct: toNumber(p.stopLossPct, 5),
    takeProfitPct: toNumber(p.takeProfitPct, 10),
    maxHoldCandles: toNumber(p.maxHoldCandles, 50),
    positionSizing: VALID_POSITION_SIZING.includes(sizing as PositionSizing)
      ? (sizing as PositionSizing)
      : "full",
    fixedFractionalPct: toNumber(p.fixedFractionalPct, 25),
    feeBps: toNumber(p.feeBps, 10),
  };
}

/** Normalize an imported SavedBacktest: coerce the numeric stats/params fields
 *  and guarantee the array fields exist. Malformed-but-shape-valid input can
 *  otherwise crash the number formatting in the UI. */
function normalizeSavedBacktest(saved: SavedBacktest): SavedBacktest {
  const result = saved.result;
  return {
    id: saved.id,
    savedAt: saved.savedAt,
    label: saved.label,
    result: {
      ...result,
      trades: Array.isArray(result.trades) ? result.trades : [],
      equityCurve: Array.isArray(result.equityCurve) ? result.equityCurve : [],
      durationBuckets: Array.isArray(result.durationBuckets) ? result.durationBuckets : [],
      stats: normalizeStats(result.stats),
      params: normalizeParams(result.params),
    },
  };
}

/** Load all saved backtests from localStorage. Returns [] on any error. */
export function loadSavedBacktests(): SavedBacktest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize on read as well as on import: entries persisted by older
    // versions lack the v3 risk metrics, and the UI calls number formatting
    // (`.toFixed()`) on them directly.
    return parsed.filter(isSavedBacktest).map(normalizeSavedBacktest);
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
 *
 * `imported` counts only entries that survived the MAX_SAVED cap, and
 * `dropped` reports how many entries the cap discarded, so the UI can report
 * the cap honestly instead of over-counting.
 */
export function importSavedBacktests(jsonText: string): {
  imported: number;
  skipped: number;
  dropped: number;
  total: number;
  backtests: SavedBacktest[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { imported: 0, skipped: 0, dropped: 0, total: 0, backtests: [] };
  }

  // Accept either { backtests: [...] } or a bare array.
  let incoming: unknown[];
  if (Array.isArray(parsed)) {
    incoming = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { backtests?: unknown }).backtests)) {
    incoming = (parsed as { backtests: unknown[] }).backtests;
  } else {
    return { imported: 0, skipped: 0, dropped: 0, total: 0, backtests: [] };
  }

  // Reuse the same shape guard as loadSavedBacktests, then normalize the
  // numeric fields so a foreign / older export can't inject strings or
  // undefined values into the formatting code.
  const valid = incoming.filter(isSavedBacktest).map(normalizeSavedBacktest);

  const existing = loadSavedBacktests();
  const existingIds = new Set(existing.map((s) => s.id));

  let skipped = 0;
  const newEntries: SavedBacktest[] = [];
  for (const s of valid) {
    if (existingIds.has(s.id)) {
      skipped++;
    } else {
      existingIds.add(s.id);
      newEntries.push(s);
    }
  }

  // Merge newest-first: imported entries go in front of the existing list,
  // preserving their original file order. The cap then trims from the tail.
  const merged = [...newEntries, ...existing];
  const trimmed = merged.slice(0, MAX_SAVED);
  const keptIds = new Set(trimmed.map((s) => s.id));

  const imported = newEntries.reduce((n, s) => n + (keptIds.has(s.id) ? 1 : 0), 0);
  const dropped = merged.length - trimmed.length;

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
    dropped,
    total: trimmed.length,
    backtests: trimmed,
  };
}

