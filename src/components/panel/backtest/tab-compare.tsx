"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Play, Save } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { STRATEGY_LIST } from "@/lib/strategies";
import {
  loadCustomStrategies,
  type CustomStrategy,
} from "@/lib/custom-strategies";
import type { BacktestResult } from "@/lib/backtest";
import { BacktestConfigForm, type BacktestFormConfig } from "./config-form";
import { EquityCurveCanvas } from "./equity-curve";
import { TradeTable } from "./trade-table";

const DEFAULT_CONFIG: BacktestFormConfig = {
  symbol: "BTCUSDT",
  interval: "4h",
  candles: 500,
  strategyId: null,
  customStrategyName: "",
  customStrategy: null,
  minConfidence: 60,
  initialCapital: 10_000,
  stopLossPct: 5,
  takeProfitPct: 10,
  maxHoldCandles: 50,
  positionSizing: "full",
  fixedFractionalPct: 25,
  feeBps: 10,
};

type CompareEntry = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  result: BacktestResult | null;
};

type ComparisonRow = {
  strategyId: string;
  strategyName: string;
  action: string;
  isCustom: boolean;
  error: string | null;
  summary: {
    totalTrades: number;
    winRatePct: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    profitFactor: number;
  } | null;
  best: {
    winRate: boolean;
    totalReturn: boolean;
    maxDrawdown: boolean;
    profitFactor: boolean;
  };
};

const BEST_KEYS = ["winRate", "totalReturn", "maxDrawdown", "profitFactor"] as const;

/**
 * Tab Comparación — mismo config × N estrategias (≤10) con UNA descarga de
 * klines (server-driven). La route devuelve rows listas (buildComparisonRows)
 * para la tabla con "mejor de columna" resaltado; click en fila expande su
 * equity curve + trades. Guardar compara → una fila BacktestRun por estrategia.
 */
export default function TabCompare() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<BacktestFormConfig>(DEFAULT_CONFIG);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["trend_buy", "breakout_buy"]),
  );
  const customStrategies = useMemo<CustomStrategy[]>(
    () => loadCustomStrategies(),
    [],
  );
  const [selectedCustom, setSelectedCustom] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const togglePredefined = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleCustom = (id: string) => {
    const next = new Set(selectedCustom);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCustom(next);
  };

  const selectedCount = selected.size + selectedCustom.size;

  const runCompare = useCallback(async () => {
    if (selectedCount === 0) return;
    setComparing(true);
    setError(null);
    setRows(null);
    setExpanded(null);
    setSaveMsg(null);
    try {
      const customList = customStrategies.filter((c) => selectedCustom.has(c.id));
      const res = await fetch("/api/backtest/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: config.symbol,
          interval: config.interval,
          limit: config.candles,
          minConfidence: config.minConfidence,
          initialCapital: config.initialCapital,
          stopLossPct: config.stopLossPct,
          takeProfitPct: config.takeProfitPct,
          maxHoldCandles: config.maxHoldCandles,
          positionSizing: config.positionSizing,
          fixedFractionalPct: config.fixedFractionalPct,
          feeBps: config.feeBps,
          strategies: [...selected, ...customList],
        }),
      });
      const json = (await res.json()) as {
        rows?: ComparisonRow[];
        results?: CompareEntry[];
        error?: string;
      };
      if (!res.ok || json.error) {
        setError(json.error ?? t("backtest.error"));
        return;
      }
      setRows(json.rows ?? []);
      setEntries(json.results ?? []);
    } catch {
      setError(t("backtest.error"));
    } finally {
      setComparing(false);
    }
  }, [config, selected, selectedCustom, customStrategies, selectedCount, t]);

  const saveCompare = useCallback(async () => {
    const withResult = entries.filter((e) => !e.error && e.result);
    if (withResult.length === 0) return;
    setSaving(true);
    setSaveMsg(null);
    let saved = 0;
    try {
      for (const e of withResult) {
        const res = await fetch("/api/backtest/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: {
              symbol: config.symbol,
              interval: config.interval,
              candles: config.candles,
              strategyId: e.isCustom ? null : e.strategyId,
              strategyName: e.strategyName,
              isCustom: e.isCustom,
              minConfidence: config.minConfidence,
              initialCapital: config.initialCapital,
              stopLossPct: config.stopLossPct,
              takeProfitPct: config.takeProfitPct,
              maxHoldCandles: config.maxHoldCandles,
              positionSizing: config.positionSizing,
              fixedFractionalPct: config.fixedFractionalPct,
              feeBps: config.feeBps,
            },
            result: e.result,
          }),
        });
        if (res.ok) saved += 1;
      }
      setSaveMsg(t("backtestUI.savedCompare").replace("{n}", String(saved)));
    } catch {
      setSaveMsg(t("backtestUI.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [config, entries, t]);

  const nameOf = (row: ComparisonRow): string => {
    if (row.isCustom) return row.strategyName;
    const predefined = STRATEGY_LIST.find((s) => s.id === row.strategyId);
    return predefined ? t(predefined.name) : row.strategyName;
  };

  const entryOf = (row: ComparisonRow): CompareEntry | undefined =>
    entries.find((e) => e.strategyId === row.strategyId && !e.error);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3 self-start rounded-lg border border-white/10 bg-[#11151c] p-4 lg:sticky lg:top-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("backtest.configTitle")}
        </h3>
        <BacktestConfigForm value={config} onChange={setConfig} variant="compare" />

        <div className="space-y-2 border-t border-white/8 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("backtestUI.selected")}: {selectedCount}
            </span>
          </div>
          <div className="space-y-1">
            {STRATEGY_LIST.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => togglePredefined(s.id)}
                  className="accent-[#4fa8d8]"
                />
                <span className="text-foreground/80">{t(s.name)}</span>
              </label>
            ))}
            {customStrategies.map((cs) => (
              <label
                key={`custom:${cs.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selectedCustom.has(cs.id)}
                  onChange={() => toggleCustom(cs.id)}
                  className="accent-[#4fa8d8]"
                />
                <span className="text-foreground/80">{cs.name}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                setSelected(new Set(STRATEGY_LIST.map((s) => s.id)))
              }
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {t("backtestUI.selected")}: 7
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {t("backtestUI.selected")}: 0
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            {t("backtestUI.compareHint")}
          </p>
          <button
            type="button"
            onClick={() => void runCompare()}
            disabled={comparing || selectedCount === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#5FBF8F] px-3 py-2 text-xs font-semibold text-[#0A0D12] transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
          >
            {comparing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            {comparing ? t("backtest.running") : t("backtest.run")}
          </button>
          {rows != null && (
            <button
              type="button"
              onClick={() => void saveCompare()}
              disabled={saving || !entries.some((e) => !e.error && e.result)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#4fa8d8]/40 bg-[#4fa8d8]/10 px-3 py-2 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden />
              )}
              {t("backtestUI.saveCompare")}
            </button>
          )}
          {saveMsg && <p className="text-[11px] text-muted-foreground">{saveMsg}</p>}
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-[#E2604F]/40 bg-[#E2604F]/10 px-3 py-2 text-xs text-[#E2604F]"
          >
            {error}
          </div>
        )}

        {!rows && !error && !comparing && (
          <div className="rounded-lg border border-white/10 bg-[#11151c] p-10 text-center text-sm text-muted-foreground">
            {t("backtestUI.compareHint")}
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#11151c] custom-scrollbar">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2.5 py-2 font-medium">{t("backtestUI.colStrategy")}</th>
                  <th className="px-2.5 py-2 text-right font-medium">{t("backtest.totalTrades")}</th>
                  <th className="px-2.5 py-2 text-right font-medium">{t("backtest.winRate")}</th>
                  <th className="px-2.5 py-2 text-right font-medium">{t("backtest.totalReturn")}</th>
                  <th className="px-2.5 py-2 text-right font-medium">{t("backtest.maxDrawdown")}</th>
                  <th className="px-2.5 py-2 text-right font-medium">{t("backtest.profitFactor")}</th>
                  <th className="w-8 px-1.5 py-2" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const s = row.summary;
                  const isExpanded = expanded === row.strategyId;
                  const entry = entryOf(row);
                  return (
                    <Fragment key={row.strategyId}>
                      <tr
                        onClick={() => entry && setExpanded(isExpanded ? null : row.strategyId)}
                        className={`border-t border-white/5 ${entry ? "cursor-pointer hover:bg-white/3" : ""}`}
                      >
                        <td className="px-2.5 py-2">
                          <span className="text-foreground/85">{nameOf(row)}</span>
                          {row.isCustom && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground/60">
                              custom
                            </span>
                          )}
                        </td>
                        {s ? (
                          <>
                            <td className="px-2.5 py-2 text-right text-foreground/80">
                              {s.totalTrades}
                            </td>
                            {(["winRatePct", "totalReturnPct", "maxDrawdownPct", "profitFactor"] as const).map(
                              (metric, idx) => {
                                const bestKey = BEST_KEYS[idx];
                                const isBest = row.best[bestKey];
                                const val =
                                  metric === "profitFactor"
                                    ? Number.isFinite(s[metric])
                                      ? s[metric].toFixed(2)
                                      : "—"
                                    : `${s[metric].toFixed(2)}%`;
                                const cls =
                                  metric === "totalReturnPct"
                                    ? Number(s[metric]) >= 0
                                      ? "text-[#5fbf8f]"
                                      : "text-[#e2604f]"
                                    : "text-foreground/80";
                                return (
                                  <td
                                    key={metric}
                                    title={isBest ? t("backtestUI.bestMark") : undefined}
                                    className={`px-2.5 py-2 text-right font-semibold ${isBest ? "bg-[#5FBF8F]/10 text-[#5FBF8F]" : cls}`}
                                  >
                                    {val}
                                  </td>
                                );
                              },
                            )}
                          </>
                        ) : (
                          <td
                            colSpan={4}
                            className="px-2.5 py-2 text-[#E2604F]"
                            title={row.error ?? t("backtestUI.rowError")}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="text-[10px]">{row.error ?? t("backtestUI.rowError")}</span>
                            </span>
                          </td>
                        )}
                        <td className="px-1.5 py-2 text-center">
                          {entry && (
                            <ChevronDown
                              className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              aria-hidden
                            />
                          )}
                        </td>
                      </tr>
                      {isExpanded && entry?.result && (
                        <tr>
                          <td colSpan={7} className="border-t border-white/5 bg-black/20 px-4 py-3">
                            <InjectableExpanded entry={entry} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Curva + tabla de la fila expandida. */
function InjectableExpanded({ entry }: { entry: CompareEntry }) {
  const { t } = useLanguage();
  const r = entry.result;
  if (!r) return null;
  return (
    <div className="space-y-3">
      <EquityCurveCanvas
        result={r}
        className="w-full h-56 rounded-md border border-white/8 bg-background/40"
        ariaLabel={t("backtest.equityCurve")}
      />
      <TradeTable trades={r.trades} maxHeightClass="max-h-56" />
    </div>
  );
}
