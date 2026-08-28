"use client";

import { Sparkline } from "./sparkline";
import { SYMBOL_META, type AnalysisResponse } from "@/lib/types";
import { TrendingUp, TrendingDown, Minimize2, Activity } from "lucide-react";

type Props = {
  data: AnalysisResponse;
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "Dato no disponible";
  if (n >= 1000)
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "Dato no disponible";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

const STATE_STYLES: Record<
  NonNullable<AnalysisResponse["cross_state"]>,
  {
    label: string;
    text: string;
    bg: string;
    border: string;
    icon: typeof TrendingUp;
    glow: string;
  }
> = {
  ALCISTA: {
    label: "Alcista",
    text: "text-[#5fbf8f]",
    bg: "bg-[#5fbf8f]/12",
    border: "border-[#5fbf8f]/30",
    icon: TrendingUp,
    glow: "shadow-[0_0_24px_-8px_rgba(95,191,143,0.5)]",
  },
  BAJISTA: {
    label: "Bajista",
    text: "text-[#e2604f]",
    bg: "bg-[#e2604f]/12",
    border: "border-[#e2604f]/30",
    icon: TrendingDown,
    glow: "shadow-[0_0_24px_-8px_rgba(226,96,79,0.5)]",
  },
  COMPRIMIDO: {
    label: "Comprimido",
    text: "text-[#e8b04b]",
    bg: "bg-[#e8b04b]/12",
    border: "border-[#e8b04b]/30",
    icon: Minimize2,
    glow: "shadow-[0_0_24px_-8px_rgba(232,176,75,0.5)]",
  },
};

function MetricRow({
  label,
  value,
  unavailable,
  color,
  hint,
}: {
  label: string;
  value: string;
  unavailable: boolean;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <div className="flex items-center gap-2">
        {color && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
        )}
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span
          className={
            unavailable
              ? "tnum text-xs italic text-muted-foreground/60"
              : "tnum text-sm font-medium"
          }
          style={unavailable ? undefined : color ? { color } : undefined}
          title={hint}
        >
          {unavailable ? "Dato no disponible" : value}
        </span>
        {hint && !unavailable && (
          <span className="text-[10px] text-muted-foreground/70">{hint}</span>
        )}
      </div>
    </div>
  );
}

export function AssetCard({ data }: Props) {
  const meta = SYMBOL_META[data.symbol] ?? {
    label: data.symbol,
    pair: data.symbol,
    asset: data.symbol,
    quote: "USD",
  };
  const nd = data.no_disponible;
  const state = data.cross_state;
  const stateStyle = state ? STATE_STYLES[state] : null;

  const change = data.change_24h_pct;
  const changePositive = (change ?? 0) >= 0;

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card/80 backdrop-blur-sm transition-all hover:bg-card ${
        stateStyle ? `${stateStyle.border} ${stateStyle.glow}` : "border-white/8"
      }`}
      aria-label={`Tarjeta de análisis para ${meta.pair}`}
    >
      {/* Top accent strip colored by state */}
      <div
        className="h-0.5 w-full"
        style={{
          background: stateStyle
            ? `linear-gradient(90deg, transparent, currentColor, transparent)`
            : "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
        }}
        aria-hidden
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="tnum text-lg font-semibold tracking-tight text-foreground">
              {meta.pair}
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.label}</p>
        </div>
        {stateStyle && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${stateStyle.bg} ${stateStyle.border} ${stateStyle.text}`}
          >
            <stateStyle.icon className="h-3.5 w-3.5" aria-hidden />
            {stateStyle.label}
          </span>
        )}
        {nd.cross_state && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            N/D
          </span>
        )}
      </div>

      {/* Price block */}
      <div className="px-5 pb-3">
        <div className="flex items-end gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Precio spot · USD
            </div>
            <div
              className={`tnum mt-0.5 text-3xl font-semibold leading-none ${
                nd.spot_price ? "text-muted-foreground/60 italic text-xl" : "text-foreground"
              }`}
            >
              {nd.spot_price ? "Dato no disponible" : `$${fmtPrice(data.spot_price)}`}
            </div>
          </div>
          <div className="mb-0.5 ml-auto text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              24h
            </div>
            <div
              className={`tnum mt-0.5 text-sm font-medium ${
                nd.change_24h_pct
                  ? "text-muted-foreground/60 italic"
                  : changePositive
                    ? "text-[#5fbf8f]"
                    : "text-[#e2604f]"
              }`}
            >
              {nd.change_24h_pct ? "N/D" : fmtPct(data.change_24h_pct)}
            </div>
          </div>
        </div>
      </div>

      {/* Sparkline */}
      <div className="px-5 pb-3">
        <Sparkline
          closes={data.series.closes}
          ema55={data.series.ema55}
          ema200={data.series.ema200}
          spot={data.spot_price}
          crossState={data.cross_state}
          height={150}
        />
      </div>

      {/* Metric rows */}
      <div className="px-5 pb-3">
        <MetricRow
          label="EMA 55 · 4h"
          value={`$${fmtPrice(data.ema55_4h)}`}
          unavailable={nd.ema55_4h}
          color="#e8b04b"
        />
        <MetricRow
          label="EMA 200 · 4h"
          value={`$${fmtPrice(data.ema200_4h)}`}
          unavailable={nd.ema200_4h}
          color="#4fa8d8"
        />
        <MetricRow
          label="Resistencia"
          value={`$${fmtPrice(data.resistance)}`}
          unavailable={nd.resistance}
          color="#e2604f"
        />
        <MetricRow
          label="Soporte"
          value={`$${fmtPrice(data.support)}`}
          unavailable={nd.support}
          color="#5fbf8f"
        />
      </div>

      {/* Structure text */}
      <div className="mt-auto border-t border-white/5 bg-white/[0.015] p-5">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          Estructura de mercado
        </div>
        <p className="text-xs leading-relaxed text-foreground/80">
          {data.structure_text}
        </p>
        <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span className="tnum">
            {new Date(data.updated_at).toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "UTC",
            })}{" "}
            UTC
          </span>
          <span>Binance · 4h klines</span>
        </div>
      </div>
    </article>
  );
}
