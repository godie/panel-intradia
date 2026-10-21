/**
 * backtest-compare.ts — pure builder for the strategy-comparison table of
 * the dedicated /backtest page. Input: what POST /api/backtest/compare
 * produced per strategy. NO I/O — rendering lives in the UI.
 */

import type { BacktestResult } from "@/lib/backtest";
import { summarizeResult, type RunSummary } from "@/lib/backtest-db";

export type CompareEntry = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  result: BacktestResult | null;
};

export type ComparisonRow = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  summary: RunSummary | null;
  best: {
    winRate: boolean;
    totalReturn: boolean;
    maxDrawdown: boolean;
    profitFactor: boolean;
  };
};

const NO_BEST = {
  winRate: false,
  totalReturn: false,
  maxDrawdown: false,
  profitFactor: false,
};

export function buildComparisonRows(entries: CompareEntry[]): ComparisonRow[] {
  const rows: ComparisonRow[] = entries.map((e) => ({
    strategyId: e.strategyId,
    strategyName: e.strategyName,
    action: e.action,
    isCustom: e.isCustom,
    error: e.error,
    summary: e.error == null && e.result ? summarizeResult(e.result.stats) : null,
    best: { ...NO_BEST },
  }));

  // Competencia de best solo entre filas con summary (una corrida fallida
  // no roba el "mejor" a las que corrieron).
  const scored = rows.filter(
    (r): r is ComparisonRow & { summary: RunSummary } =>
      r.summary !== null && r.summary.totalTrades > 0,
  );
  if (scored.length > 0) {
    // Mapeo explícito summary → best (los nombres difieren: winRatePct
    // en RunSummary, winRate en best). drawdown MÍNIMO gana; empates
    // marcan a todos los empatados (comparación === estricta).
    const METRICS: [
      key: keyof RunSummary,
      bestKey: keyof ComparisonRow["best"],
      dir: "max" | "min",
    ][] = [
      ["winRatePct", "winRate", "max"],
      ["totalReturnPct", "totalReturn", "max"],
      ["maxDrawdownPct", "maxDrawdown", "min"],
      ["profitFactor", "profitFactor", "max"],
    ];
    for (const [key, bestKey, dir] of METRICS) {
      const values = scored.map((r) => r.summary[key]);
      const target = dir === "max" ? Math.max(...values) : Math.min(...values);
      for (const r of scored) r.best[bestKey] = r.summary[key] === target;
    }
  }

  return rows;
}
