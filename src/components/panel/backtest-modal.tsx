"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { SYMBOLS, SYMBOL_META } from "@/lib/types";
import type { CustomStrategy } from "@/lib/custom-strategies";
import type { BacktestResult, BacktestTrade, BacktestInterval } from "@/lib/backtest";
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

  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    }
  }, [open]);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
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
  ]);

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

    // Equity line — colored by direction vs initial capital.
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const px = x(i);
      const py = y(curve[i].equity);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const finalEq = curve[curve.length - 1].equity;
    ctx.strokeStyle =
      finalEq >= result.params.initialCapital ? "#5fbf8f" : "#e2604f";
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
            </div>
          </div>
        </div>
      </div>
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
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Activity;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneColor =
    tone === "positive"
      ? "text-[#5fbf8f]"
      : tone === "negative"
        ? "text-[#e2604f]"
        : "text-foreground";
  return (
    <div className="rounded-md border border-white/8 bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
        <Icon className="h-3 w-3 opacity-60" aria-hidden />
        {label}
      </div>
      <div className={`text-sm font-mono font-semibold ${toneColor}`}>{value}</div>
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
