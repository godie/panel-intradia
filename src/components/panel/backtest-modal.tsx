"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { SYMBOLS, SYMBOL_META } from "@/lib/types";
import type { CustomStrategy } from "@/lib/custom-strategies";
import type {
  BacktestResult,
  BacktestTrade,
  BacktestInterval,
  PositionSizing,
} from "@/lib/backtest";
import {
  loadSavedBacktests,
  saveBacktest,
  deleteSavedBacktest,
  clearSavedBacktests,
  exportSavedBacktests,
  importSavedBacktests,
  type SavedBacktest,
} from "@/lib/saved-backtests";
import { useLanguage } from "@/hooks/use-language";
import {
  X,
  Loader2,
  Play,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  AlertTriangle,
  BarChart3,
  Save,
  History,
  Trash2,
  GitCompareArrows,
  Check,
  CheckSquare,
  Square,
  Download,
  Upload,
} from "lucide-react";

type Props = {
  /** The strategy to backtest. May be a predefined id (e.g. "trend_buy") or
   *  a full custom strategy object from the builder. */
  strategy: CustomStrategy | { id: string; name: string; action: string; conditions?: never };
  /** Predefined strategy flag — when true the request uses strategyId. */
  predefined?: boolean;
  /** Default symbol to backtest (the asset shown on the card). */
  defaultSymbol: string;
  open: boolean;
  onClose: () => void;
};

const INTERVALS: BacktestInterval[] = ["15m", "1h", "4h", "1d"];

const CANDLE_OPTIONS = [
  { value: 220, labelKey: "backtest.candles" },
  { value: 500, labelKey: "backtest.candles" },
  { value: 1000, labelKey: "backtest.candles" },
];

const REASON_KEYS: Record<BacktestTrade["exitReason"], string> = {
  stop_loss: "backtest.reasonStopLoss",
  take_profit: "backtest.reasonTakeProfit",
  max_hold: "backtest.reasonMaxHold",
  signal_exit: "backtest.reasonSignalExit",
  end_of_data: "backtest.reasonEnd",
};

/**
 * BacktestModal — lets the user run a strategy against historical klines and
 * inspect the equity curve + trade list + summary metrics.
 *
 * The config panel (left, sticky on desktop) collects symbol, interval,
 * candle count, min confidence, initial capital, SL/TP, max hold. The Run
 * button POSTs to /api/backtest and renders results on the right.
 *
 * Equity curve is drawn on a HiDPI canvas (initial capital baseline, equity
 * line colored by direction, in-position regions highlighted).
 *
 * Trade list is rendered as a scrollable table with entry/exit/price/PnL/hold/
 * exit reason. Color-coded PnL (green positive, red negative).
 */
export function BacktestModal({ strategy, predefined, defaultSymbol, open, onClose }: Props) {
  const { t } = useLanguage();

  const [symbol, setSymbol] = useState<string>(defaultSymbol);
  const [interval, setInterval] = useState<BacktestInterval>("4h");
  const [limit, setLimit] = useState<number>(500);
  const [minConfidence, setMinConfidence] = useState<number>(60);
  const [initialCapital, setInitialCapital] = useState<number>(10_000);
  const [stopLossPct, setStopLossPct] = useState<number>(5);
  const [takeProfitPct, setTakeProfitPct] = useState<number>(10);
  const [maxHoldCandles, setMaxHoldCandles] = useState<number>(50);
  const [positionSizing, setPositionSizing] = useState<PositionSizing>("full");
  const [fixedFractionalPct, setFixedFractionalPct] = useState<number>(25);
  const [feeBps, setFeeBps] = useState<number>(10);

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState<SavedBacktest[]>([]);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareView, setCompareView] = useState<SavedBacktest[] | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Re-sync the symbol when the modal opens with a new defaultSymbol.
  useEffect(() => {
    if (open) setSymbol(defaultSymbol);
  }, [open, defaultSymbol]);

  // Reset state when the modal closes.
  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setLoading(false);
      setSaveMsg(null);
      setShowSaved(false);
      setCompareIds(new Set());
      setCompareView(null);
    }
  }, [open]);

  // Load saved backtests when the saved panel is opened.
  useEffect(() => {
    if (open && showSaved) {
      setSaved(loadSavedBacktests());
    }
  }, [open, showSaved]);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSaveMsg(null);
    try {
      const payload: Record<string, unknown> = {
        symbol,
        interval,
        limit,
        minConfidence,
        initialCapital,
        stopLossPct,
        takeProfitPct,
        maxHoldCandles,
        positionSizing,
        fixedFractionalPct,
        feeBps,
      };
      if (predefined) {
        payload.strategyId = strategy.id;
      } else {
        payload.customStrategy = strategy;
      }
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as BacktestResult & { error?: string };
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
  }, [
    symbol,
    interval,
    limit,
    strategy,
    predefined,
    minConfidence,
    initialCapital,
    stopLossPct,
    takeProfitPct,
    maxHoldCandles,
    positionSizing,
    fixedFractionalPct,
    feeBps,
  ]);

  const handleSave = useCallback(() => {
    if (!result) return;
    const saved_bt = saveBacktest(result);
    if (saved_bt) {
      setSaveMsg(t("backtest.saved"));
      setSaved(loadSavedBacktests());
      setTimeout(() => setSaveMsg(null), 2500);
    }
  }, [result, t]);

  const handleDeleteSaved = useCallback((id: string) => {
    setSaved(deleteSavedBacktest(id));
    setCompareIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    clearSavedBacktests();
    setSaved([]);
    setCompareIds(new Set());
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 3) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const runCompare = useCallback(() => {
    if (compareIds.size < 2) return;
    const selected = saved.filter((s) => compareIds.has(s.id));
    setCompareView(selected);
  }, [compareIds, saved]);

  // Export / import saved backtests as JSON.
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    exportSavedBacktests();
  }, []);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        const result = importSavedBacktests(text);
        if (result.total === 0 && result.imported === 0 && result.skipped === 0) {
          setError(t("backtest.importError"));
          return;
        }
        setSaved(result.backtests);
        setSaveMsg(
          t("backtest.imported")
            .replace("{n}", String(result.imported))
            .replace("{skipped}", String(result.skipped)),
        );
        setTimeout(() => setSaveMsg(null), 3500);
      };
      reader.onerror = () => setError(t("backtest.importError"));
      reader.readAsText(file);
      // Reset the input so the same file can be re-selected later.
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [t],
  );

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Draw equity curve on the canvas.
  useEffect(() => {
    if (!open || !result || result.equityCurve.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Background.
    ctx.fillStyle = "rgba(10,13,18,0.4)";
    ctx.fillRect(0, 0, cssW, cssH);

    const curve = result.equityCurve;
    const padL = 44;
    const padR = 12;
    const padT = 12;
    const padB = 22;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    // Y range: include a bit of headroom.
    const equities = curve.map((p) => p.equity);
    let yMin = Math.min(...equities, result.params.initialCapital);
    let yMax = Math.max(...equities, result.params.initialCapital);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) {
      yMin = result.params.initialCapital * 0.95;
      yMax = result.params.initialCapital * 1.05;
    }
    const yPad = (yMax - yMin) * 0.08;
    yMin -= yPad;
    yMax += yPad;

    const x = (i: number) => padL + (i / (curve.length - 1)) * plotW;
    const y = (val: number) => padT + (1 - (val - yMin) / (yMax - yMin)) * plotH;

    // Horizontal gridlines + Y-axis labels.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "rgba(139,150,165,0.6)";
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const yPos = padT + (plotH * i) / gridLines;
      ctx.beginPath();
      ctx.moveTo(padL, yPos);
      ctx.lineTo(padL + plotW, yPos);
      ctx.stroke();
      const val = yMax - ((yMax - yMin) * i) / gridLines;
      ctx.textAlign = "right";
      ctx.fillText(`$${formatNumber(val)}`, padL - 6, yPos + 3);
    }

    // Initial capital baseline.
    const baselineY = y(result.params.initialCapital);
    ctx.strokeStyle = "rgba(139,150,165,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, baselineY);
    ctx.lineTo(padL + plotW, baselineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // In-position regions (light shaded backgrounds).
    ctx.fillStyle = "rgba(95,191,143,0.06)";
    let regionStart: number | null = null;
    for (let i = 0; i < curve.length; i++) {
      const inPos = curve[i].inPosition;
      if (inPos && regionStart === null) regionStart = i;
      if ((!inPos || i === curve.length - 1) && regionStart !== null) {
        const end = inPos ? i : i - 1;
        if (end >= regionStart) {
          ctx.fillRect(x(regionStart), padT, x(end) - x(regionStart), plotH);
        }
        regionStart = null;
      }
    }

    // Gradient fill under the equity curve.
    const finalEq = curve[curve.length - 1].equity;
    const isPositive = finalEq >= result.params.initialCapital;
    const lineColor = isPositive ? "#5fbf8f" : "#e2604f";
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    if (isPositive) {
      grad.addColorStop(0, "rgba(95,191,143,0.25)");
      grad.addColorStop(1, "rgba(95,191,143,0.01)");
    } else {
      grad.addColorStop(0, "rgba(226,96,79,0.25)");
      grad.addColorStop(1, "rgba(226,96,79,0.01)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x(0), padT + plotH);
    for (let i = 0; i < curve.length; i++) {
      ctx.lineTo(x(i), y(curve[i].equity));
    }
    ctx.lineTo(x(curve.length - 1), padT + plotH);
    ctx.closePath();
    ctx.fill();

    // Equity line — colored by direction vs initial capital.
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const px = x(i);
      const py = y(curve[i].equity);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = lineColor;
    ctx.stroke();

    // Final equity marker dot.
    ctx.fillStyle = finalEq >= result.params.initialCapital ? "#5fbf8f" : "#e2604f";
    ctx.beginPath();
    ctx.arc(x(curve.length - 1), y(finalEq), 3.5, 0, Math.PI * 2);
    ctx.fill();

    // X-axis labels: first, middle, last timestamps.
    ctx.fillStyle = "rgba(139,150,165,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(formatTime(curve[0].time), padL, cssH - 6);
    ctx.textAlign = "center";
    if (curve.length > 2) {
      ctx.fillText(
        formatTime(curve[Math.floor(curve.length / 2)].time),
        padL + plotW / 2,
        cssH - 6,
      );
    }
    ctx.textAlign = "right";
    ctx.fillText(formatTime(curve[curve.length - 1].time), padL + plotW, cssH - 6);
  }, [open, result]);

  if (!open) return null;

  const stats = result?.stats;
  const isPositive = stats ? stats.totalReturnPct >= 0 : false;
  const assetLabel = SYMBOL_META[symbol]?.asset ?? symbol;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-card-enter p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("backtest.title")}
    >
      <div
        className="relative w-full max-w-4xl max-h-[94vh] overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 p-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <BarChart3 className="h-5 w-5 text-[#4fa8d8] shrink-0" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {t("backtest.title")}
              </h3>
              <p className="text-[10px] text-muted-foreground truncate">
                {(predefined ? t(strategy.name) : strategy.name)} · {strategy.action}
                {!predefined && " · " + (strategy as CustomStrategy).conditions.length + " " + t("custom.conditions").toLowerCase()}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8] shrink-0"
            aria-label={t("backtest.close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-0">
            {/* Config panel (left) */}
            <div className="border-b lg:border-b-0 lg:border-r border-white/8 p-4 space-y-3.5 bg-background/40">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  {t("backtest.symbol")}
                </label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-background/60 px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
                >
                  {SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {SYMBOL_META[s]?.label ?? s} · {SYMBOL_META[s]?.pair}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  {t("backtest.interval")}
                </label>
                <div className="grid grid-cols-4 gap-1">
                  {INTERVALS.map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      onClick={() => setInterval(iv)}
                      className={`rounded-md px-2 py-1.5 text-[11px] font-medium font-mono transition-colors ${
                        interval === iv
                          ? "bg-[#4fa8d8]/20 text-[#4fa8d8] border border-[#4fa8d8]/40"
                          : "bg-background/40 text-muted-foreground border border-white/8 hover:bg-white/5"
                      }`}
                    >
                      {iv}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  {t("backtest.candles")}
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {CANDLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLimit(opt.value)}
                      className={`rounded-md px-2 py-1.5 text-[11px] font-mono transition-colors ${
                        limit === opt.value
                          ? "bg-[#4fa8d8]/20 text-[#4fa8d8] border border-[#4fa8d8]/40"
                          : "bg-background/40 text-muted-foreground border border-white/8 hover:bg-white/5"
                      }`}
                    >
                      {opt.value}
                    </button>
                  ))}
                </div>
              </div>

              <NumberField
                label={t("backtest.minConfidence")}
                value={minConfidence}
                onChange={setMinConfidence}
                min={10}
                max={100}
                step={5}
                suffix="%"
              />

              <NumberField
                label={t("backtest.initialCapital")}
                value={initialCapital}
                onChange={setInitialCapital}
                min={100}
                max={1_000_000}
                step={1_000}
                prefix="$"
              />

              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={t("backtest.stopLoss")}
                  value={stopLossPct}
                  onChange={setStopLossPct}
                  min={0.1}
                  max={50}
                  step={0.5}
                  suffix="%"
                  compact
                />
                <NumberField
                  label={t("backtest.takeProfit")}
                  value={takeProfitPct}
                  onChange={setTakeProfitPct}
                  min={0.1}
                  max={200}
                  step={0.5}
                  suffix="%"
                  compact
                />
              </div>

              <NumberField
                label={t("backtest.maxHold")}
                value={maxHoldCandles}
                onChange={setMaxHoldCandles}
                min={1}
                max={500}
                step={5}
              />

              {/* Position sizing mode */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  {t("backtest.positionSizing")}
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      { value: "full", labelKey: "backtest.sizingFull" },
                      { value: "fixed_fractional", labelKey: "backtest.sizingFixedFractional" },
                      { value: "half_kelly", labelKey: "backtest.sizingHalfKelly" },
                      { value: "kelly", labelKey: "backtest.sizingKelly" },
                    ] as { value: PositionSizing; labelKey: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPositionSizing(opt.value)}
                      className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
                        positionSizing === opt.value
                          ? "bg-[#4fa8d8]/20 text-[#4fa8d8] border border-[#4fa8d8]/40"
                          : "bg-background/40 text-muted-foreground border border-white/8 hover:bg-white/5"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {positionSizing === "fixed_fractional" && (
                <NumberField
                  label={t("backtest.fixedFractionalPct")}
                  value={fixedFractionalPct}
                  onChange={setFixedFractionalPct}
                  min={1}
                  max={100}
                  step={1}
                  suffix="%"
                />
              )}

              <NumberField
                label={t("backtest.feeBps")}
                value={feeBps}
                onChange={setFeeBps}
                min={0}
                max={500}
                step={1}
                suffix="bp"
              />
              <p className="text-[9px] text-muted-foreground/60 -mt-1.5">
                {t("backtest.feeHint")}
              </p>

              <button
                type="button"
                onClick={runBacktest}
                disabled={loading}
                className="w-full mt-1 flex items-center justify-center gap-2 rounded-md bg-[#4fa8d8] px-3 py-2 text-xs font-semibold text-[#0A0D12] transition-colors hover:bg-[#4fa8d8]/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {t("backtest.running")}
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden />
                    {t("backtest.run")}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowSaved((v) => !v)}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-white/10 bg-background/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" aria-hidden />
                {t("backtest.openSaved")}
              </button>
            </div>

            {/* Results panel (right) */}
            <div className="p-4 space-y-4 min-w-0">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-[#e2604f]/30 bg-[#e2604f]/8 p-3 text-xs text-[#e2604f]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <div>
                    <div className="font-semibold mb-0.5">{t("backtest.error")}</div>
                    {error}
                  </div>
                </div>
              )}

              {!loading && !error && !result && (
                <div className="flex flex-col items-center justify-center py-16 text-center text-xs text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mb-3 opacity-30" aria-hidden />
                  <p className="max-w-xs">{t("backtest.description")}</p>
                </div>
              )}

              {loading && !result && !error && (
                <div className="flex flex-col items-center justify-center py-16 text-xs text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mb-3" aria-hidden />
                  {t("backtest.running")}
                </div>
              )}

              {result && !error && stats && (
                <>
                  {/* Header summary */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-white/8">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2.5">
                      <span>
                        {t("backtest.candlesAnalyzed")}:{" "}
                        <span className="text-foreground font-mono">
                          {result.candlesAnalyzed}
                        </span>
                      </span>
                      <span>
                        {t("backtest.provider")}:{" "}
                        <span className="text-foreground font-mono uppercase">
                          {result.provider}
                        </span>
                      </span>
                    </div>
                    <span
                      className={`flex items-center gap-1 text-xs font-semibold font-mono px-2 py-0.5 rounded ${
                        isPositive
                          ? "text-[#5fbf8f] bg-[#5fbf8f]/10"
                          : "text-[#e2604f] bg-[#e2604f]/10"
                      }`}
                    >
                      {isPositive ? (
                        <TrendingUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <TrendingDown className="h-3 w-3" aria-hidden />
                      )}
                      {stats.totalReturnPct >= 0 ? "+" : ""}
                      {stats.totalReturnPct.toFixed(2)}%
                    </span>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <MetricCard
                      label={t("backtest.totalTrades")}
                      value={String(stats.totalTrades)}
                      icon={Activity}
                    />
                    <MetricCard
                      label={t("backtest.winRate")}
                      value={`${stats.winRate.toFixed(1)}%`}
                      sub={`${stats.wins}/${stats.losses}`}
                      icon={Target}
                      tone={stats.winRate >= 50 ? "positive" : "neutral"}
                    />
                    <MetricCard
                      label={t("backtest.totalReturn")}
                      value={`${stats.totalReturnPct >= 0 ? "+" : ""}${stats.totalReturnPct.toFixed(2)}%`}
                      icon={isPositive ? TrendingUp : TrendingDown}
                      tone={isPositive ? "positive" : "negative"}
                    />
                    <MetricCard
                      label={t("backtest.maxDrawdown")}
                      value={`-${stats.maxDrawdownPct.toFixed(2)}%`}
                      icon={TrendingDown}
                      tone="negative"
                    />
                    <MetricCard
                      label={t("backtest.profitFactor")}
                      value={
                        Number.isFinite(stats.profitFactor)
                          ? stats.profitFactor.toFixed(2)
                          : "∞"
                      }
                      icon={BarChart3}
                      tone={stats.profitFactor >= 1 ? "positive" : "neutral"}
                    />
                    <MetricCard
                      label={t("backtest.avgHold")}
                      value={`${stats.avgHoldCandles}`}
                      sub={t("backtest.hold").toLowerCase()}
                      icon={Activity}
                    />
                    <MetricCard
                      label={t("backtest.bestTrade")}
                      value={`${stats.bestTradePct >= 0 ? "+" : ""}${stats.bestTradePct.toFixed(2)}%`}
                      icon={TrendingUp}
                      tone="positive"
                    />
                    <MetricCard
                      label={t("backtest.worstTrade")}
                      value={`${stats.worstTradePct >= 0 ? "+" : ""}${stats.worstTradePct.toFixed(2)}%`}
                      icon={TrendingDown}
                      tone="negative"
                    />
                    <MetricCard
                      label={t("backtest.totalFees")}
                      value={`$${formatNumber(stats.totalFees)}`}
                      icon={Activity}
                      tone="neutral"
                    />
                    <MetricCard
                      label={t("backtest.avgPositionSize")}
                      value={`${stats.avgPositionSizePct.toFixed(1)}%`}
                      icon={Target}
                      tone="neutral"
                    />
                  </div>

                  {/* Risk-adjusted metrics row */}
                  <div>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                      {t("backtest.riskMetrics")}
                    </h4>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <MetricCard
                        label={t("backtest.sharpe")}
                        value={formatRatio(stats.sharpeRatio)}
                        icon={Activity}
                        tone={stats.sharpeRatio >= 1 ? "positive" : "neutral"}
                        compact
                      />
                      <MetricCard
                        label={t("backtest.sortino")}
                        value={formatRatio(stats.sortinoRatio)}
                        icon={TrendingUp}
                        tone={stats.sortinoRatio >= 1 ? "positive" : "neutral"}
                        compact
                      />
                      <MetricCard
                        label={t("backtest.calmar")}
                        value={formatRatio(stats.calmarRatio)}
                        icon={Target}
                        tone={stats.calmarRatio >= 1 ? "positive" : "neutral"}
                        compact
                      />
                      <MetricCard
                        label={t("backtest.maxWinStreak")}
                        value={String(stats.maxWinStreak)}
                        icon={TrendingUp}
                        tone="positive"
                        compact
                      />
                      <MetricCard
                        label={t("backtest.maxLossStreak")}
                        value={String(stats.maxLossStreak)}
                        icon={TrendingDown}
                        tone="negative"
                        compact
                      />
                      <MetricCard
                        label={t("backtest.expectancy")}
                        value={`${stats.expectancyPct >= 0 ? "+" : ""}${stats.expectancyPct.toFixed(2)}%`}
                        icon={Activity}
                        tone={stats.expectancyPct >= 0 ? "positive" : "negative"}
                        compact
                      />
                    </div>
                  </div>

                  {/* Trade duration distribution */}
                  {result.durationBuckets && result.durationBuckets.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                          {t("backtest.durationDist")}
                        </h4>
                        <span className="text-[10px] text-muted-foreground/60 font-mono">
                          {t("backtest.avgHold")}: {stats.avgHoldCandles}
                        </span>
                      </div>
                      <DurationDistribution
                        buckets={result.durationBuckets}
                        total={stats.totalTrades}
                      />
                    </div>
                  )}

                  {/* Save backtest button + status */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={!result}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/8 px-3 py-1.5 text-[11px] font-medium text-[#5fbf8f] transition-colors hover:bg-[#5fbf8f]/15 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={t("backtest.saveTooltip")}
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden />
                      {t("backtest.save")}
                    </button>
                    {saveMsg && (
                      <span className="text-[11px] text-[#5fbf8f] flex items-center gap-1 animate-card-enter">
                        <Check className="h-3 w-3" aria-hidden />
                        {saveMsg}
                      </span>
                    )}
                  </div>

                  {/* Equity curve */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("backtest.equityCurve")}
                      </h4>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {t("backtest.finalEquity")}:{" "}
                        <span
                          className={
                            stats.finalEquity >= result.params.initialCapital
                              ? "text-[#5fbf8f]"
                              : "text-[#e2604f]"
                          }
                        >
                          ${formatNumber(stats.finalEquity)}
                        </span>
                      </span>
                    </div>
                    <canvas
                      ref={canvasRef}
                      className="w-full h-44 rounded-md border border-white/8 bg-background/40"
                      aria-label={t("backtest.equityCurve")}
                    />
                  </div>

                  {/* Trade list */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {t("backtest.trades")}{" "}
                      <span className="text-muted-foreground/60 font-normal">
                        ({result.trades.length})
                      </span>
                    </h4>
                    {result.trades.length === 0 ? (
                      <div className="rounded-md border border-white/8 bg-background/30 p-6 text-center text-xs text-muted-foreground">
                        {t("backtest.noTrades")}
                      </div>
                    ) : (
                      <div className="rounded-md border border-white/8 bg-background/30 max-h-72 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-[11px] font-mono">
                          <thead className="sticky top-0 bg-card/95 backdrop-blur-sm">
                            <tr className="text-left text-muted-foreground">
                              <th className="px-2.5 py-1.5 font-medium">#</th>
                              <th className="px-2.5 py-1.5 font-medium">{t("backtest.entry")}</th>
                              <th className="px-2.5 py-1.5 font-medium">{t("backtest.exit")}</th>
                              <th className="px-2.5 py-1.5 font-medium text-right">{t("backtest.price")}</th>
                              <th className="px-2.5 py-1.5 font-medium text-right">{t("backtest.pnl")}</th>
                              <th className="px-2.5 py-1.5 font-medium text-right">{t("backtest.hold")}</th>
                              <th className="px-2.5 py-1.5 font-medium">{t("backtest.reason")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.trades.map((tr, idx) => {
                              const positive = tr.pnl >= 0;
                              return (
                                <tr
                                  key={idx}
                                  className="border-t border-white/5 hover:bg-white/3"
                                >
                                  <td className="px-2.5 py-1.5 text-muted-foreground">
                                    {idx + 1}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-foreground/80">
                                    {formatTime(tr.entryTime)}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-foreground/80">
                                    {formatTime(tr.exitTime)}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-right text-foreground/80">
                                    {formatPrice(tr.entryPrice)} →{" "}
                                    {formatPrice(tr.exitPrice)}
                                  </td>
                                  <td
                                    className={`px-2.5 py-1.5 text-right font-semibold ${
                                      positive ? "text-[#5fbf8f]" : "text-[#e2604f]"
                                    }`}
                                  >
                                    {positive ? "+" : ""}
                                    {tr.pnlPct.toFixed(2)}%
                                  </td>
                                  <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                                    {tr.holdCandles}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-muted-foreground">
                                    {t(REASON_KEYS[tr.exitReason])}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Saved Backtests panel (toggle) */}
              {showSaved && (
                <div className="rounded-md border border-white/10 bg-background/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("backtest.savedBacktests")}{" "}
                      <span className="text-muted-foreground/60 font-normal">
                        ({saved.length})
                      </span>
                    </h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={runCompare}
                        disabled={compareIds.size < 2}
                        className="inline-flex items-center gap-1 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/8 px-2 py-0.5 text-[10px] font-medium text-[#4fa8d8] hover:bg-[#4fa8d8]/15 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <GitCompareArrows className="h-3 w-3" aria-hidden />
                        {t("backtest.compareRun")} ({compareIds.size}/3)
                      </button>
                      <button
                        type="button"
                        onClick={handleExport}
                        disabled={saved.length === 0}
                        className="inline-flex items-center gap-1 rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/8 px-2 py-0.5 text-[10px] font-medium text-[#5fbf8f] hover:bg-[#5fbf8f]/15 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={t("backtest.export")}
                      >
                        <Download className="h-3 w-3" aria-hidden />
                        {t("backtest.export")}
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1 rounded-md border border-[#b48cff]/30 bg-[#b48cff]/8 px-2 py-0.5 text-[10px] font-medium text-[#b48cff] hover:bg-[#b48cff]/15"
                        title={t("backtest.import")}
                      >
                        <Upload className="h-3 w-3" aria-hidden />
                        {t("backtest.import")}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={handleImport}
                      />
                      <button
                        type="button"
                        onClick={handleClearAll}
                        disabled={saved.length === 0}
                        className="inline-flex items-center gap-1 rounded-md border border-[#e2604f]/30 bg-[#e2604f]/8 px-2 py-0.5 text-[10px] font-medium text-[#e2604f] hover:bg-[#e2604f]/15 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                        {t("backtest.clearAll")}
                      </button>
                    </div>
                  </div>

                  {saved.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70 py-3 text-center">
                      {t("backtest.savedEmpty")}
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                      {saved.map((s) => {
                        const isSel = compareIds.has(s.id);
                        const r = s.result;
                        const ret = r.stats.totalReturnPct;
                        return (
                          <div
                            key={s.id}
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-white/[0.03] border border-white/5"
                          >
                            <button
                              type="button"
                              onClick={() => toggleCompare(s.id)}
                              className={`shrink-0 ${isSel ? "text-[#4fa8d8]" : "text-muted-foreground/40 hover:text-muted-foreground/80"}`}
                              title={t("backtest.selectToCompare")}
                              aria-label={t("backtest.selectToCompare")}
                            >
                              {isSel ? (
                                <CheckSquare className="h-4 w-4" aria-hidden />
                              ) : (
                                <Square className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="truncate text-foreground/80 font-medium">
                                {s.label}
                              </div>
                              <div className="text-[9px] text-muted-foreground/60 font-mono">
                                {s.savedAt.slice(0, 16).replace("T", " ")} ·{" "}
                                {r.stats.totalTrades} {t("backtest.trades").toLowerCase()} ·{" "}
                                <span
                                  className={
                                    ret >= 0 ? "text-[#5fbf8f]" : "text-[#e2604f]"
                                  }
                                >
                                  {ret >= 0 ? "+" : ""}
                                  {ret.toFixed(2)}%
                                </span>{" "}
                                · {r.stats.winRate.toFixed(0)}% {t("backtest.winRate").toLowerCase()}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteSaved(s.id)}
                              className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:text-[#e2604f]"
                              title={t("backtest.deleteSaved")}
                              aria-label={t("backtest.deleteSaved")}
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Comparison view (renders when user selects ≥ 2 saved backtests) */}
              {compareView && compareView.length >= 2 && (
                <div className="rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#4fa8d8]">
                      <GitCompareArrows className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" aria-hidden />
                      {t("backtest.compareTitle")}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setCompareView(null)}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={t("common.close")}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    {t("backtest.comparePickHint")}
                  </p>
                  <CompareTable saved={compareView} t={t} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Comparison table — rows are metrics, columns are SavedBacktests. */
function CompareTable({
  saved,
  t,
}: {
  saved: SavedBacktest[];
  t: (key: string) => string;
}) {
  // `best` declares which direction to highlight as the best value:
  // "max" (e.g. return, win rate), "min" (e.g. max drawdown), or undefined
  // (no highlight — trade count / fees / avg size are not better in either
  // direction). Note worstTradePct is "max": the least-negative worst trade
  // is the best outcome.
  const metrics: {
    key: keyof SavedBacktest["result"]["stats"];
    label: string;
    format: (v: number) => string;
    best?: "max" | "min";
  }[] = [
    { key: "totalReturnPct", label: t("backtest.totalReturn"), format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, best: "max" },
    { key: "winRate", label: t("backtest.winRate"), format: (v) => `${v.toFixed(1)}%`, best: "max" },
    { key: "profitFactor", label: t("backtest.profitFactor"), format: (v) => (Number.isFinite(v) ? v.toFixed(2) : "∞"), best: "max" },
    { key: "maxDrawdownPct", label: t("backtest.maxDrawdown"), format: (v) => `-${v.toFixed(2)}%`, best: "min" },
    { key: "totalTrades", label: t("backtest.totalTrades"), format: (v) => String(v) },
    { key: "avgHoldCandles", label: t("backtest.avgHold"), format: (v) => String(v) },
    { key: "bestTradePct", label: t("backtest.bestTrade"), format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, best: "max" },
    { key: "worstTradePct", label: t("backtest.worstTrade"), format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, best: "max" },
    { key: "finalEquity", label: t("backtest.finalEquity"), format: (v) => `$${Math.round(v).toLocaleString("en-US")}`, best: "max" },
    { key: "totalFees", label: t("backtest.totalFees"), format: (v) => `$${v.toFixed(2)}` },
    { key: "avgPositionSizePct", label: t("backtest.avgPositionSize"), format: (v) => `${v.toFixed(1)}%` },
  ];

  const bestByKey: Record<string, string | null> = {};
  for (const m of metrics) {
    if (!m.best) {
      bestByKey[m.key as string] = null;
      continue;
    }
    let best = m.best === "max" ? -Infinity : Infinity;
    let bestId: string | null = null;
    for (const s of saved) {
      const v = s.result.stats[m.key];
      const better = m.best === "max" ? v > best : v < best;
      if (better) {
        best = v;
        bestId = s.id;
      }
    }
    bestByKey[m.key as string] = bestId;
  }

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-[10px] font-mono">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-white/8">
            <th className="px-2 py-1.5 font-medium">{t("backtest.metric")}</th>
            {saved.map((s) => (
              <th key={s.id} className="px-2 py-1.5 font-medium min-w-[100px]">
                <div className="truncate text-foreground/80" title={s.label}>
                  {s.label.split("·")[0].trim()}
                </div>
                <div className="text-[9px] text-muted-foreground/60 font-normal truncate">
                  {s.label.split("·").slice(1).join("·").trim()}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.key as string} className="border-b border-white/5 hover:bg-white/[0.02]">
              <td className="px-2 py-1.5 text-muted-foreground/80">{m.label}</td>
              {saved.map((s) => {
                const v = s.result.stats[m.key] as number;
                const isBest = bestByKey[m.key as string] === s.id;
                return (
                  <td
                    key={s.id}
                    className={`px-2 py-1.5 ${
                      isBest ? "text-[#5fbf8f] font-semibold" : "text-foreground/80"
                    }`}
                  >
                    {m.format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact numeric input field with label + optional prefix/suffix. */
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  compact,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  compact?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-mono pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
          }}
          className={`w-full ${compact ? "py-1" : "py-1.5"} ${
            prefix ? "pl-5" : "pl-2"
          } ${suffix ? "pr-6" : "pr-2"} rounded-md border border-white/10 bg-background/60 text-xs font-mono text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]`}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/** Stat tile for the metrics grid. */
function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Activity;
  tone?: "positive" | "negative" | "neutral";
  compact?: boolean;
}) {
  const toneColor =
    tone === "positive"
      ? "text-[#5fbf8f]"
      : tone === "negative"
        ? "text-[#e2604f]"
        : "text-foreground";
  return (
    <div className={`rounded-md border border-white/8 bg-background/40 ${compact ? "p-1.5" : "p-2.5"}`}>
      <div className={`flex items-center gap-1 ${compact ? "text-[8px]" : "text-[9px]"} uppercase tracking-wider text-muted-foreground mb-1`}>
        <Icon className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} opacity-60`} aria-hidden />
        {label}
      </div>
      <div className={`${compact ? "text-xs" : "text-sm"} font-mono font-semibold ${toneColor}`}>{value}</div>
      {sub && (
        <div className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{sub}</div>
      )}
    </div>
  );
}

/** Format a USD value compactly (e.g., 12345 → "12,345" or 1234567 → "1.23M"). */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Format a candle timestamp as a compact date (YYYY-MM-DD or MM-DD HH). */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a price with the right precision based on its magnitude. */
function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

/** Format a risk ratio (Sharpe, Sortino, Calmar) — NaN → "—". */
function formatRatio(r: number): string {
  if (!Number.isFinite(r)) return "—";
  return r.toFixed(2);
}

/**
 * DurationDistribution — a compact horizontal bar chart showing how many
 * trades fell into each duration bucket (1-5, 6-10, 11-20, 21-50, 50+
 * candles). Each bar is labeled with the bucket range + count.
 */
function DurationDistribution({
  buckets,
  total,
}: {
  buckets: { label: string; count: number }[];
  total: number;
}) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const colors = ["#5fbf8f", "#4fa8d8", "#e8b04b", "#b48cff", "#e2604f"];
  return (
    <div className="rounded-md border border-white/8 bg-background/40 p-3 space-y-1.5">
      {buckets.map((b, i) => {
        const pct = (b.count / maxCount) * 100;
        const sharePct = total > 0 ? (b.count / total) * 100 : 0;
        return (
          <div key={b.label} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="w-12 shrink-0 text-muted-foreground/70 text-right">
              {b.label}
            </span>
            <div className="flex-1 h-4 rounded bg-black/20 overflow-hidden relative">
              <div
                className="h-full rounded transition-[width] duration-500"
                style={{
                  width: `${pct}%`,
                  background: colors[i] ?? "#4fa8d8",
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-foreground/80">
              {b.count}{" "}
              <span className="text-muted-foreground/50">
                ({sharePct.toFixed(0)}%)
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
