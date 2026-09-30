"use client";

import { useEffect, useState, useCallback } from "react";
import {
  X,
  Loader2,
  Play,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { SYMBOLS, SYMBOL_META } from "@/lib/types";
import type { CustomStrategy } from "@/lib/custom-strategies";
import type {
  BacktestInterval,
  PositionSizing,
  WalkForwardResult,
} from "@/lib/backtest";

type Props = {
  /** The strategy to backtest. May be a predefined id or a full custom strategy. */
  strategy: CustomStrategy | { id: string; name: string; action: string; conditions?: never };
  /** Predefined strategy flag — when true the request uses strategyId. */
  predefined?: boolean;
  /** Default symbol to backtest (the asset shown on the parent card). */
  defaultSymbol: string;
  /** Current backtest params to inherit. */
  currentParams: {
    interval: BacktestInterval;
    minConfidence: number;
    initialCapital: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldCandles: number;
    positionSizing: PositionSizing;
    fixedFractionalPct: number;
    feeBps: number;
  };
  open: boolean;
  onClose: () => void;
};

const WINDOW_SIZES = [300, 400, 500, 600];
const IS_RATIOS = [0.6, 0.7, 0.8];

/**
 * WalkForwardModal — run a walk-forward optimization on the current strategy.
 *
 * Walk-forward analysis splits the historical series into N contiguous
 * IS+OOS windows, runs the strategy on each segment, and aggregates the
 * OOS performance into robustness metrics so the user can tell whether
 * the strategy is overfit or genuinely robust out-of-sample.
 *
 * Config: symbol select, window size buttons (300/400/500/600), IS ratio
 * buttons (60/70/80%). Results render a robustness summary panel (color
 * coded green/amber/red by efficiency) with 8 metrics in a 4-col grid,
 * plus a per-window table comparing IS vs OOS returns.
 *
 * Purple theme (#b48cff) distinguishes this from the regular backtest
 * (blue) and multi-symbol (also blue) modals. Escape closes.
 */
export function WalkForwardModal({
  strategy,
  predefined,
  defaultSymbol,
  currentParams,
  open,
  onClose,
}: Props) {
  const { t } = useLanguage();
  const [symbol, setSymbol] = useState<string>(defaultSymbol);
  const [windowSize, setWindowSize] = useState<number>(500);
  const [inSampleRatio, setInSampleRatio] = useState<number>(0.7);

  const [result, setResult] = useState<WalkForwardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track previous `open` so we can reset state synchronously during render
  // when the modal opens (React's "adjust state during render" pattern,
  // avoids the set-state-in-effect lint rule).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSymbol(defaultSymbol);
      setWindowSize(500);
      setInSampleRatio(0.7);
      setResult(null);
      setError(null);
      setLoading(false);
    }
  }

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const runWalkForward = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        symbol,
        interval: currentParams.interval,
        minConfidence: currentParams.minConfidence,
        initialCapital: currentParams.initialCapital,
        stopLossPct: currentParams.stopLossPct,
        takeProfitPct: currentParams.takeProfitPct,
        maxHoldCandles: currentParams.maxHoldCandles,
        positionSizing: currentParams.positionSizing,
        fixedFractionalPct: currentParams.fixedFractionalPct,
        feeBps: currentParams.feeBps,
        windowSize,
        inSampleRatio,
      };
      if (predefined) {
        payload.strategyId = strategy.id;
      } else {
        payload.customStrategy = strategy;
      }
      const res = await fetch("/api/backtest/walk-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as WalkForwardResult & { error?: string };
      if (json.error) {
        setError(json.error);
        setResult(null);
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [symbol, currentParams, predefined, strategy, windowSize, inSampleRatio]);

  if (!open) return null;

  // Robustness verdict based on efficiency.
  const r = result?.robustness;
  const efficiency = r?.efficiency;
  const verdict: "good" | "medium" | "poor" | "none" =
    efficiency == null || !Number.isFinite(efficiency)
      ? "none"
      : efficiency >= 0.5
        ? "good"
        : efficiency >= 0.3
          ? "medium"
          : "poor";
  const verdictColor =
    verdict === "good"
      ? "#5fbf8f"
      : verdict === "medium"
        ? "#e8b04b"
        : verdict === "poor"
          ? "#e2604f"
          : "#8b96a5";
  const verdictLabel =
    verdict === "good"
      ? t("backtest.robustnessGood")
      : verdict === "medium"
        ? t("backtest.robustnessMedium")
        : verdict === "poor"
          ? t("backtest.robustnessPoor")
          : "—";

  const strategyLabel = predefined ? t(strategy.name) : strategy.name;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm animate-card-enter p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("backtest.walkForward")}
    >
      <div
        className="relative w-full max-w-4xl max-h-[94vh] overflow-hidden rounded-xl border border-[#b48cff]/20 bg-card shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (purple accent) */}
        <div className="flex items-center justify-between border-b border-white/8 p-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#b48cff]/30 bg-[#b48cff]/10">
              <BarChart3 className="h-4 w-4 text-[#b48cff]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {t("backtest.walkForward")}
              </h3>
              <p className="text-[10px] text-muted-foreground truncate">
                {strategyLabel} · {strategy.action} · {t("backtest.walkForwardDesc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#b48cff]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {/* Config row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Symbol select */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5 block">
                {t("backtest.symbol")}
              </label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="tnum h-9 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-foreground outline-none focus-visible:border-[#b48cff] focus-visible:ring-2 focus-visible:ring-[#b48cff]/30"
              >
                {SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {SYMBOL_META[s]?.pair ?? s}
                  </option>
                ))}
              </select>
            </div>

            {/* Window size buttons */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5 block">
                {t("backtest.windowSize")}
              </label>
              <div className="grid grid-cols-4 gap-1">
                {WINDOW_SIZES.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWindowSize(w)}
                    className={`tnum h-9 rounded-md border text-[11px] font-mono transition-colors ${
                      windowSize === w
                        ? "border-[#b48cff]/40 bg-[#b48cff]/15 text-[#b48cff]"
                        : "border-white/10 bg-black/20 text-foreground/70 hover:bg-white/5"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            {/* IS ratio buttons */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-1.5 block">
                {t("backtest.inSampleRatio")}
              </label>
              <div className="grid grid-cols-3 gap-1">
                {IS_RATIOS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInSampleRatio(r)}
                    className={`tnum h-9 rounded-md border text-[11px] font-mono transition-colors ${
                      inSampleRatio === r
                        ? "border-[#b48cff]/40 bg-[#b48cff]/15 text-[#b48cff]"
                        : "border-white/10 bg-black/20 text-foreground/70 hover:bg-white/5"
                    }`}
                  >
                    {Math.round(r * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Run button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runWalkForward}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b48cff]/40 bg-[#b48cff]/15 px-4 py-2 text-xs font-semibold text-[#b48cff] transition-colors hover:bg-[#b48cff]/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t("common.loading")}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  {t("backtest.runWalkForward")}
                </>
              )}
            </button>
            <span className="text-[10px] text-muted-foreground/60">
              {currentParams.interval.toUpperCase()} · {t("backtest.minConfidence")}: {currentParams.minConfidence}
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[#e2604f]/30 bg-[#e2604f]/10 px-3 py-2 text-xs text-[#e2604f]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
              <span className="break-words">{error}</span>
            </div>
          )}

          {/* Results */}
          {result && !error && (
            <>
              {/* Robustness summary panel */}
              <div
                className="rounded-md border p-3 space-y-2"
                style={{
                  borderColor: `${verdictColor}40`,
                  background: `${verdictColor}10`,
                }}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("backtest.robustness")}
                  </h4>
                  <div
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      color: verdictColor,
                      background: `${verdictColor}20`,
                      border: `1px solid ${verdictColor}40`,
                    }}
                  >
                    {verdict === "good" ? (
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                    ) : (
                      <Activity className="h-3 w-3" aria-hidden />
                    )}
                    {verdictLabel}
                  </div>
                </div>

                {/* 8 metrics in a 4-col grid (2 rows) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <RobustnessMetric
                    label={t("backtest.efficiency")}
                    value={formatRatio(r?.efficiency)}
                    hint={t("backtest.efficiencyHint")}
                    tone="purple"
                  />
                  <RobustnessMetric
                    label={t("backtest.avgIsReturn")}
                    value={formatPct(r?.avgIsReturnPct)}
                    tone={r && r.avgIsReturnPct >= 0 ? "positive" : "negative"}
                  />
                  <RobustnessMetric
                    label={t("backtest.avgOosReturn")}
                    value={formatPct(r?.avgOosReturnPct)}
                    tone={r && r.avgOosReturnPct >= 0 ? "positive" : "negative"}
                  />
                  <RobustnessMetric
                    label={t("backtest.positiveOosRate")}
                    value={formatPctRaw(r?.positiveOosRate)}
                  />
                  <RobustnessMetric
                    label={t("backtest.robustnessRate")}
                    value={formatPctRaw(r?.robustnessRate)}
                  />
                  <RobustnessMetric
                    label={t("backtest.avgOosSharpe")}
                    value={formatRatio(r?.avgOosSharpe)}
                  />
                  <RobustnessMetric
                    label={t("backtest.avgOosMaxDD")}
                    value={r ? `-${r.avgOosMaxDD.toFixed(2)}%` : "—"}
                    tone="negative"
                  />
                  <RobustnessMetric
                    label={t("backtest.totalOosTrades")}
                    value={r ? String(r.totalOosTrades) : "—"}
                  />
                </div>

                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  {t("backtest.efficiencyHint")}
                </p>
              </div>

              {/* Per-window table */}
              {result.windows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("backtest.windows")}
                    </h4>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                      {result.windows.length} {t("backtest.windows").toLowerCase()}
                    </span>
                  </div>
                  <div className="rounded-md border border-white/8 bg-background/30 overflow-x-auto custom-scrollbar">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b border-white/8">
                          <th className="px-2 py-1.5 font-medium">{t("backtest.window")}</th>
                          <th className="px-2 py-1.5 font-medium text-right">{t("backtest.isReturn")}</th>
                          <th className="px-2 py-1.5 font-medium text-right">{t("backtest.oosReturn")}</th>
                          <th className="px-2 py-1.5 font-medium text-right">{t("backtest.isTrades")}</th>
                          <th className="px-2 py-1.5 font-medium text-right">{t("backtest.oosTrades")}</th>
                          <th className="px-2 py-1.5 font-medium text-right">{t("backtest.efficiency")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.windows.map((w) => {
                          const isRet = w.inSample.stats.totalReturnPct;
                          const oosRet = w.outOfSample.stats.totalReturnPct;
                          const eff =
                            isRet !== 0
                              ? oosRet / isRet
                              : oosRet === 0
                                ? 0
                                : oosRet > 0
                                  ? Infinity
                                  : -Infinity;
                          const effTone =
                            !Number.isFinite(eff)
                              ? "neutral"
                              : eff >= 0.5
                                ? "positive"
                                : eff >= 0.3
                                  ? "warn"
                                  : "negative";
                          const effColor =
                            effTone === "positive"
                              ? "text-[#5fbf8f]"
                              : effTone === "warn"
                                ? "text-[#e8b04b]"
                                : effTone === "negative"
                                  ? "text-[#e2604f]"
                                  : "text-muted-foreground";
                          return (
                            <tr key={w.index} className="border-b border-white/5 hover:bg-white/[0.02]">
                              <td className="px-2 py-1.5 text-foreground/80 font-semibold">#{w.index}</td>
                              <td
                                className={`px-2 py-1.5 text-right ${isRet >= 0 ? "text-[#5fbf8f]" : "text-[#e2604f]"}`}
                              >
                                {isRet >= 0 ? "+" : ""}
                                {isRet.toFixed(2)}%
                              </td>
                              <td
                                className={`px-2 py-1.5 text-right ${oosRet >= 0 ? "text-[#5fbf8f]" : "text-[#e2604f]"}`}
                              >
                                {oosRet >= 0 ? "+" : ""}
                                {oosRet.toFixed(2)}%
                              </td>
                              <td className="px-2 py-1.5 text-right text-muted-foreground">
                                {w.inSample.stats.totalTrades}
                              </td>
                              <td className="px-2 py-1.5 text-right text-muted-foreground">
                                {w.outOfSample.stats.totalTrades}
                              </td>
                              <td className={`px-2 py-1.5 text-right font-semibold ${effColor}`}>
                                {Number.isFinite(eff) ? eff.toFixed(2) : "∞"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Empty state */}
          {!result && !error && !loading && (
            <div className="rounded-md border border-white/8 bg-background/30 p-8 text-center">
              <BarChart3 className="h-8 w-8 text-[#b48cff]/40 mx-auto mb-2" aria-hidden />
              <p className="text-[11px] text-muted-foreground/70">
                {t("backtest.walkForwardDesc")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact metric tile for the robustness grid. */
function RobustnessMetric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral" | "purple";
}) {
  const toneColor =
    tone === "positive"
      ? "text-[#5fbf8f]"
      : tone === "negative"
        ? "text-[#e2604f]"
        : tone === "purple"
          ? "text-[#b48cff]"
          : "text-foreground";
  return (
    <div className="rounded-md border border-white/8 bg-background/40 p-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5 truncate">
        {label}
      </div>
      <div className={`text-sm font-mono font-semibold ${toneColor}`}>{value}</div>
      {hint && (
        <div className="text-[9px] text-muted-foreground/50 mt-0.5 leading-tight">{hint}</div>
      )}
    </div>
  );
}

/** Format a percent value with explicit sign (e.g. +1.23% / -1.23%). */
function formatPct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Format a raw percent (e.g. 75.0%) — no sign. */
function formatPctRaw(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

/** Format a risk ratio — NaN / Infinity → "∞" / "—". */
function formatRatio(r: number | undefined | null): string {
  if (r == null) return "—";
  if (!Number.isFinite(r)) return r > 0 ? "∞" : "—";
  return r.toFixed(2);
}
