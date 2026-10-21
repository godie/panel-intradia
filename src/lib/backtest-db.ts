/**
 * backtest-db.ts — pure serialization/parsing helpers for the persisted
 * backtest runs (BacktestRun rows). NO I/O — the routes in
 * src/app/api/backtest/runs call these and own the Prisma client.
 *
 * Invariant: never fabricate data. When the serialized result exceeds the
 * 1 MB cap, the trade list is truncated deterministically and the run's
 * stats keep the ORIGINAL values; the payload carries `_truncation` so the
 * UI can surface "showing K of N closed trades" instead of lying.
 */

import type { BacktestResult, BacktestStats } from "@/lib/backtest";

export const RESULT_JSON_CAP_BYTES = 1_048_576;

export type RunSummary = {
  totalTrades: number;
  winRatePct: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
};

function finiteOrZero(v: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function summarizeResult(stats: BacktestStats): RunSummary {
  return {
    totalTrades: Math.max(0, Math.floor(finiteOrZero(stats.totalTrades))),
    winRatePct: finiteOrZero(stats.winRate),
    totalReturnPct: finiteOrZero(stats.totalReturnPct),
    maxDrawdownPct: finiteOrZero(stats.maxDrawdownPct),
    profitFactor: finiteOrZero(stats.profitFactor),
  };
}

export type TruncationMeta = { originalTrades: number; keptTrades: number };

export function truncateResultJson(
  result: BacktestResult,
  cap: number = RESULT_JSON_CAP_BYTES,
): { json: string; truncated: boolean; keptTrades: number } {
  const originalTrades = result.trades.length;

  const serialize = (kept: number): string =>
    JSON.stringify({
      ...result,
      trades: result.trades.slice(0, kept),
      ...(kept < originalTrades
        ? { _truncation: { originalTrades, keptTrades: kept } }
        : {}),
    });

  // Fast path: under cap with all trades.
  let kept = originalTrades;
  let json = serialize(kept);
  if (Buffer.byteLength(json, "utf8") <= cap) {
    return { json, truncated: false, keptTrades: originalTrades };
  }

  // Deterministic shaving: halve the kept prefix until it fits (or empty).
  while (kept > 0 && Buffer.byteLength(json, "utf8") > cap) {
    kept = Math.floor(kept / 2);
    json = serialize(kept);
  }

  return { json, truncated: kept < originalTrades, keptTrades: kept };
}

export function serializeRun(
  summary: RunSummary,
  result: BacktestResult,
): { summary: RunSummary; resultJson: string; truncated: boolean; keptTrades: number } {
  const t = truncateResultJson(result);
  return {
    summary: { ...summary },
    resultJson: t.json,
    truncated: t.truncated,
    keptTrades: t.keptTrades,
  };
}

export type ParsedStoredResult =
  | {
      ok: true;
      result: BacktestResult;
      truncatedMeta: TruncationMeta | null;
    }
  | { ok: false; reason: string };

/** Estructura mínima que debe tener el payload guardado para considerarse
 *  un BacktestResult (los helpers nunca aceptan basura silenciosamente). */
function looksLikeResult(v: unknown): v is BacktestResult {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.symbol === "string" &&
    typeof r.interval === "string" &&
    Array.isArray(r.trades) &&
    Array.isArray(r.equityCurve) &&
    r.stats != null &&
    typeof r.stats === "object"
  );
}

function statsHasOnlyFiniteNumbers(v: unknown): boolean {
  if (v == null || typeof v !== "object") return false;
  // `null` es el encoding JSON de NaN (sharpe/sortino/calmar salen NaN del
  // engine en corridas sin trades) — se acepta; cualquier otro tipo no.
  return Object.values(v as Record<string, unknown>).every(
    (x) =>
      x === null || (typeof x === "number" && Number.isFinite(x)),
  );
}

export function parseStoredResult(resultJson: string): ParsedStoredResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return { ok: false, reason: "Stored payload is not valid JSON." };
  }
  if (!looksLikeResult(parsed)) {
    return { ok: false, reason: "Stored payload is not a BacktestResult." };
  }
  if (!statsHasOnlyFiniteNumbers((parsed as BacktestResult).stats)) {
    return { ok: false, reason: "Stored stats contain non-finite values." };
  }
  const meta = (parsed as { _truncation?: TruncationMeta })._truncation ?? null;
  return { ok: true, result: parsed as BacktestResult, truncatedMeta: meta };
}
