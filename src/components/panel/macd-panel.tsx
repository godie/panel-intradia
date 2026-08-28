"use client";

import { Zap } from "lucide-react";
import type { MacdCrossInfo } from "@/lib/types";

type Props = {
  macd: { line: number | null; signal: number | null; histogram: number | null };
  series: (number | null)[];
  unavailable: boolean;
  /** MACD/signal crossover + momentum flip detection. */
  macdCross?: MacdCrossInfo | null;
  /** Optional number of bars to render (default 40). */
  bars?: number;
};

/**
 * MacdPanel — compact MACD histogram (last ~40 bars).
 *
 * Renders vertical bars centered on a zero baseline:
 *  - positive bars (MACD > signal) are green (#5fbf8f) growing upward
 *  - negative bars are red (#e2604f) growing downward
 *
 * When `macdCross.happened` is true (fresh MACD/signal crossover) a banner
 * "⚡ Cruce MACD alcista/bajista · hace N vela(s)" is shown at the top.
 * When `macdCross.momentum_flip` is true, the last bar of the histogram
 * flashes to draw attention to the momentum shift.
 *
 * The current MACD line / signal / histogram values are labeled to the right.
 */
export function MacdPanel({ macd, series, unavailable, macdCross, bars = 40 }: Props) {
  if (unavailable || macd.line == null) {
    return (
      <div className="rounded-md border border-white/5 bg-black/20 px-3 py-2.5 text-center text-[11px] italic text-muted-foreground/60">
        MACD no disponible
      </div>
    );
  }

  // Build the visible window: last `bars` histogram values.
  const hist = (series ?? [])
    .filter((v): v is number => v != null && Number.isFinite(v))
    .slice(-bars);

  // Normalize: max abs value across the window.
  const maxAbs = Math.max(1e-9, ...hist.map((v) => Math.abs(v)));
  const BAR_H = 36; // px of the chart area above+below the baseline
  const BASELINE = BAR_H; // baseline sits at y = BAR_H (middle of a 2*BAR_H area)

  const lineColor =
    (macd.histogram ?? 0) >= 0 ? "#5fbf8f" : "#e2604f";

  // Trend label based on histogram sign & momentum.
  const histValue = macd.histogram ?? 0;
  const trend =
    histValue > 0
      ? hist.length > 1 && (hist[hist.length - 1] ?? 0) < (hist[hist.length - 2] ?? 0)
        ? "Creciente ↓"
        : "Alcista ↑"
      : hist.length > 1 && (hist[hist.length - 1] ?? 0) > (hist[hist.length - 2] ?? 0)
        ? "Recuperando ↑"
        : "Bajista ↓";

  const trendColor =
    histValue > 0 ? "#5fbf8f" : "#e2604f";

  // MACD vs signal relationship (bullish when MACD > signal).
  const cross = (macd.line ?? 0) > (macd.signal ?? 0) ? "MACD > Signal" : "MACD < Signal";

  const lastBarFlash =
    macdCross?.momentum_flip === true ? "animate-macd-flash" : "";

  return (
    <div className="space-y-1.5">
      {/* MACD crossover banner */}
      {macdCross?.happened === true && macdCross.direction && (
        <div
          className={`flex items-center justify-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
            macdCross.direction === "bullish"
              ? "border-[#5fbf8f]/40 bg-[#5fbf8f]/12 text-[#5fbf8f]"
              : "border-[#e2604f]/40 bg-[#e2604f]/12 text-[#e2604f]"
          }`}
        >
          <Zap className="h-3 w-3 animate-pulse" aria-hidden />
          Cruce MACD {macdCross.direction === "bullish" ? "alcista" : "bajista"} · hace{" "}
          {macdCross.candles_since_cross} vela(s)
        </div>
      )}

      {/* Momentum flip banner (subtler — leading signal) */}
      {macdCross?.momentum_flip === true &&
        macdCross.momentum_flip_direction &&
        macdCross.happened !== true && (
          <div
            className={`flex items-center justify-center gap-1.5 rounded border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
              macdCross.momentum_flip_direction === "bullish"
                ? "border-[#5fbf8f]/30 bg-[#5fbf8f]/8 text-[#5fbf8f]/90"
                : "border-[#e2604f]/30 bg-[#e2604f]/8 text-[#e2604f]/90"
            }`}
          >
            <Zap className="h-2.5 w-2.5" aria-hidden />
            Giro momentum {macdCross.momentum_flip_direction === "bullish" ? "alcista" : "bajista"} · hace{" "}
            {macdCross.candles_since_flip} vela(s)
          </div>
        )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          MACD · 12 / 26 / 9 · 4h
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: trendColor }}
        >
          {trend}
        </span>
      </div>

      {/* Histogram bars */}
      <div
        className="relative w-full"
        style={{ height: BAR_H * 2 }}
        aria-label={`Histograma MACD, último valor ${histValue.toFixed(2)}`}
        role="img"
      >
        {/* Baseline */}
        <div
          className="absolute inset-x-0 h-px bg-white/15"
          style={{ top: BASELINE }}
        />
        {/* Subtle horizontal guides */}
        <div
          className="absolute inset-x-0 h-px bg-white/[0.04]"
          style={{ top: BASELINE - BAR_H / 2 }}
        />
        <div
          className="absolute inset-x-0 h-px bg-white/[0.04]"
          style={{ top: BASELINE + BAR_H / 2 }}
        />

        {/* Bars */}
        <div className="absolute inset-0 flex items-stretch gap-[1px]">
          {hist.map((v, i) => {
            const ratio = Math.abs(v) / maxAbs; // 0..1
            const barH = Math.max(2, ratio * BAR_H);
            const positive = v >= 0;
            const isLast = i === hist.length - 1;
            return (
              <div
                key={i}
                className="relative flex-1"
                title={`v${i}: ${v.toFixed(3)}`}
              >
                <div
                  className={`absolute left-0 right-0 transition-[height] duration-300 ease-out ${
                    isLast ? lastBarFlash : ""
                  }`}
                  style={{
                    background: positive
                      ? "linear-gradient(180deg, rgba(95,191,143,0.95), rgba(95,191,143,0.55))"
                      : "linear-gradient(0deg, rgba(226,96,79,0.95), rgba(226,96,79,0.55))",
                    boxShadow: positive
                      ? "0 0 4px rgba(95,191,143,0.4)"
                      : "0 0 4px rgba(226,96,79,0.4)",
                    [positive ? "bottom" : "top"]: BASELINE,
                    height: barH,
                  }}
                />
              </div>
            );
          })}
          {/* Placeholder bars when window is short */}
          {hist.length === 0 &&
            Array.from({ length: 5 }).map((_, i) => (
              <div key={`empty-${i}`} className="flex-1 opacity-20">
                <div
                  className="absolute left-0 right-0 h-1 bg-white/10"
                  style={{ top: BASELINE - 0.5 }}
                />
              </div>
            ))}
        </div>
      </div>

      {/* Numeric labels */}
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded border border-white/5 bg-black/15 px-1.5 py-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            MACD
          </div>
          <div className="tnum font-medium" style={{ color: lineColor }}>
            {macd.line != null ? macd.line.toFixed(2) : "—"}
          </div>
        </div>
        <div className="rounded border border-white/5 bg-black/15 px-1.5 py-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Signal
          </div>
          <div className="tnum font-medium text-[#4fa8d8]">
            {macd.signal != null ? macd.signal.toFixed(2) : "—"}
          </div>
        </div>
        <div className="rounded border border-white/5 bg-black/15 px-1.5 py-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
            Hist
          </div>
          <div
            className="tnum font-medium"
            style={{ color: lineColor }}
          >
            {macd.histogram != null
              ? `${macd.histogram >= 0 ? "+" : ""}${macd.histogram.toFixed(2)}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground/60">
        <span>{cross}</span>
        <span>4h · Appel</span>
      </div>
    </div>
  );
}
