"use client";

import type { AnalysisResponse, CrossState } from "@/lib/types";
import { TrendingUp, TrendingDown, Minimize2 } from "lucide-react";

type Props = {
  items: (AnalysisResponse | null)[];
};

type Summary = {
  bullish: number;
  bearish: number;
  compressed: number;
  total: number;
  avgChange: number | null;
  avgRsi: number | null;
  overbought: number;
  oversold: number;
  recentBullCross: number;
  recentBearCross: number;
};

function computeSummary(items: (AnalysisResponse | null)[]): Summary {
  const ready = items.filter((i): i is AnalysisResponse => i != null);
  const states = ready
    .map((i) => i.cross_state)
    .filter((s): s is CrossState => s != null);
  const changes = ready
    .map((i) => i.change_24h_pct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const rsis = ready
    .map((i) => i.rsi_14_4h)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    bullish: states.filter((s) => s === "ALCISTA").length,
    bearish: states.filter((s) => s === "BAJISTA").length,
    compressed: states.filter((s) => s === "COMPRIMIDO").length,
    total: states.length,
    avgChange: avg(changes),
    avgRsi: avg(rsis),
    overbought: rsis.filter((r) => r >= 70).length,
    oversold: rsis.filter((r) => r <= 30).length,
    recentBullCross: ready.filter(
      (i) => i.cross_info?.happened && i.cross_info.direction === "bullish",
    ).length,
    recentBearCross: ready.filter(
      (i) => i.cross_info?.happened && i.cross_info.direction === "bearish",
    ).length,
  };
}

function Stat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="tnum text-xs font-semibold" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function MarketSummary({ items }: Props) {
  const s = computeSummary(items);
  if (s.total === 0) return null;

  const sentiment =
    s.bullish > s.bearish
      ? { label: "Riesgo Alcista", color: "#5fbf8f" }
      : s.bearish > s.bullish
        ? { label: "Riesgo Bajista", color: "#e2604f" }
        : { label: "Mixto / Neutral", color: "#e8b04b" };

  const avgChangeColor =
    (s.avgChange ?? 0) >= 0 ? "#5fbf8f" : "#e2604f";

  const avgRsiColor =
    (s.avgRsi ?? 50) >= 70
      ? "#e2604f"
      : (s.avgRsi ?? 50) <= 30
        ? "#5fbf8f"
        : "#e8b04b";

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-white/8 bg-black/25 px-4 py-2.5">
      {/* Sentiment pill */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: sentiment.color, boxShadow: `0 0 8px ${sentiment.color}` }}
          aria-hidden
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/90">
          Mercado:
        </span>
        <span
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: sentiment.color }}
        >
          {sentiment.label}
        </span>
      </div>

      <div className="hidden h-4 w-px bg-white/10 sm:block" />

      {/* Cross-state breakdown */}
      <div className="flex items-center gap-3">
        <Stat
          label="Alcista"
          value={`${s.bullish}/${s.total}`}
          color="#5fbf8f"
          icon={<TrendingUp className="h-3 w-3 text-[#5fbf8f]" aria-hidden />}
        />
        <Stat
          label="Bajista"
          value={`${s.bearish}/${s.total}`}
          color="#e2604f"
          icon={<TrendingDown className="h-3 w-3 text-[#e2604f]" aria-hidden />}
        />
        {s.compressed > 0 && (
          <Stat
            label="Compr."
            value={`${s.compressed}/${s.total}`}
            color="#e8b04b"
            icon={<Minimize2 className="h-3 w-3 text-[#e8b04b]" aria-hidden />}
          />
        )}
      </div>

      <div className="hidden h-4 w-px bg-white/10 sm:block" />

      {/* Avg change + avg RSI */}
      <Stat
        label="Δ24h prom."
        value={`${s.avgChange != null ? (s.avgChange >= 0 ? "+" : "") + s.avgChange.toFixed(2) : "—"}%`}
        color={avgChangeColor}
      />
      <Stat
        label="RSI prom."
        value={s.avgRsi != null ? s.avgRsi.toFixed(1) : "—"}
        color={avgRsiColor}
      />

      {/* Recent cross alerts */}
      {(s.recentBullCross > 0 || s.recentBearCross > 0) && (
        <>
          <div className="hidden h-4 w-px bg-white/10 sm:block" />
          {s.recentBullCross > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#5fbf8f]">
              ⚡ {s.recentBullCross} cruce alcista reciente
            </span>
          )}
          {s.recentBearCross > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-[#e2604f]/30 bg-[#e2604f]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#e2604f]">
              ⚡ {s.recentBearCross} cruce bajista reciente
            </span>
          )}
        </>
      )}
    </div>
  );
}
