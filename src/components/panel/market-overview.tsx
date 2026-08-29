"use client";

import { SYMBOL_META, type AnalysisResponse } from "@/lib/types";
import { TrendingUp, TrendingDown, Minimize2, Globe, Award } from "lucide-react";

type Props = {
  items: (AnalysisResponse | null)[];
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * MarketOverview — an aggregate "market pulse" card that fills the 6th grid
 * slot (5 pairs + this overview = 6 cells in a 3-column grid = 2 full rows).
 *
 * Shows:
 *  - Top performer (biggest 24h gainer)
 *  - Biggest mover (largest |24h change| — high volatility)
 *  - Market breadth (% of pairs that are alcista)
 *  - Average RSI across all pairs
 *  - A mini bar chart of 24h changes per pair
 *
 * When no data is available (all loading), shows a placeholder.
 */
export function MarketOverview({ items }: Props) {
  const ready = items.filter(
    (i): i is AnalysisResponse =>
      i != null && i.spot_price != null && i.change_24h_pct != null,
  );

  if (ready.length === 0) {
    return (
      <article className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-white/8 bg-card/40 p-8 text-center animate-card-enter">
        <Globe className="h-8 w-8 text-muted-foreground/40" aria-hidden />
        <p className="text-xs text-muted-foreground">
          Cargando visión de mercado…
        </p>
      </article>
    );
  }

  // Top performer = biggest 24h gainer.
  const sorted = [...ready].sort(
    (a, b) => (b.change_24h_pct ?? -Infinity) - (a.change_24h_pct ?? -Infinity),
  );
  const topPerformer = sorted[0];
  const worstPerformer = sorted[sorted.length - 1];

  // Biggest mover = largest absolute change.
  const biggestMover = [...ready].sort(
    (a, b) =>
      Math.abs(b.change_24h_pct ?? 0) - Math.abs(a.change_24h_pct ?? 0),
  )[0];

  // Breadth: % alcista.
  const bullish = ready.filter((i) => i.cross_state === "ALCISTA").length;
  const bearish = ready.filter((i) => i.cross_state === "BAJISTA").length;
  const compressed = ready.filter((i) => i.cross_state === "COMPRIMIDO").length;
  const breadthPct = Math.round((bullish / ready.length) * 100);

  // Average RSI.
  const rsis = ready
    .map((i) => i.rsi_14_4h)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const avgRsi = rsis.length
    ? rsis.reduce((a, b) => a + b, 0) / rsis.length
    : null;

  const topAsset = SYMBOL_META[topPerformer.symbol]?.asset ?? topPerformer.symbol;
  const worstAsset = SYMBOL_META[worstPerformer.symbol]?.asset ?? worstPerformer.symbol;
  const moverAsset = SYMBOL_META[biggestMover.symbol]?.asset ?? biggestMover.symbol;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-white/8 bg-card/80 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-card animate-card-enter">
      {/* Top accent — neutral blue gradient */}
      <div
        className="h-0.5 w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, #4fa8d8, transparent)",
        }}
        aria-hidden
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Visión de Mercado
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Resumen agregado · {ready.length} pares
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/12 px-2.5 py-1 text-xs font-medium text-[#4fa8d8]">
          <Globe className="h-3.5 w-3.5" aria-hidden />
          OVERVIEW
        </span>
      </div>

      {/* Breadth gauge */}
      <div className="px-5 pb-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Amplitud del mercado
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-black/30">
            <div
              className="absolute inset-y-0 left-0 bg-[#5fbf8f] transition-[width] duration-500"
              style={{ width: `${(bullish / ready.length) * 100}%` }}
            />
            <div
              className="absolute inset-y-0 bg-[#e8b04b] transition-[width] duration-500"
              style={{
                left: `${(bullish / ready.length) * 100}%`,
                width: `${(compressed / ready.length) * 100}%`,
              }}
            />
            <div
              className="absolute inset-y-0 bg-[#e2604f] transition-[width] duration-500"
              style={{
                left: `${((bullish + compressed) / ready.length) * 100}%`,
                width: `${(bearish / ready.length) * 100}%`,
              }}
            />
          </div>
          <span className="tnum text-sm font-semibold text-[#5fbf8f]">
            {breadthPct}%
          </span>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/60">
          <span className="text-[#5fbf8f]">{bullish} alcista</span>
          <span className="text-[#e8b04b]">{compressed} comprimido</span>
          <span className="text-[#e2604f]">{bearish} bajista</span>
        </div>
      </div>

      {/* Top performer + worst performer */}
      <div className="grid grid-cols-2 gap-2 px-5 pb-3">
        <div className="rounded-lg border border-[#5fbf8f]/20 bg-[#5fbf8f]/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#5fbf8f]">
            <Award className="h-3 w-3" aria-hidden />
            Top performer
          </div>
          <div className="mt-1 tnum text-base font-bold text-foreground">
            {topAsset}
          </div>
          <div className="tnum text-xs text-[#5fbf8f]">
            {fmtPct(topPerformer.change_24h_pct)}
          </div>
        </div>
        <div className="rounded-lg border border-[#e2604f]/20 bg-[#e2604f]/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#e2604f]">
            <TrendingDown className="h-3 w-3" aria-hidden />
            Peor performer
          </div>
          <div className="mt-1 tnum text-base font-bold text-foreground">
            {worstAsset}
          </div>
          <div className="tnum text-xs text-[#e2604f]">
            {fmtPct(worstPerformer.change_24h_pct)}
          </div>
        </div>
      </div>

      {/* Biggest mover + avg RSI */}
      <div className="grid grid-cols-2 gap-2 px-5 pb-3">
        <div className="rounded-lg border border-white/8 bg-black/15 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mayor movimiento
          </div>
          <div className="mt-1 tnum text-base font-bold text-foreground">
            {moverAsset}
          </div>
          <div
            className="tnum text-xs"
            style={{
              color:
                (biggestMover.change_24h_pct ?? 0) >= 0
                  ? "#5fbf8f"
                  : "#e2604f",
            }}
          >
            {fmtPct(biggestMover.change_24h_pct)}
          </div>
        </div>
        <div className="rounded-lg border border-white/8 bg-black/15 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            RSI promedio
          </div>
          <div className="mt-1 tnum text-base font-bold text-foreground">
            {avgRsi != null ? avgRsi.toFixed(1) : "—"}
          </div>
          <div
            className="tnum text-xs"
            style={{
              color:
                (avgRsi ?? 50) >= 70
                  ? "#e2604f"
                  : (avgRsi ?? 50) <= 30
                    ? "#5fbf8f"
                    : "#e8b04b",
            }}
          >
            {(avgRsi ?? 50) >= 70
              ? "Sobrecomprado"
              : (avgRsi ?? 50) <= 30
                ? "Sobrevendido"
                : "Neutral"}
          </div>
        </div>
      </div>

      {/* Mini bar chart of 24h changes */}
      <div className="px-5 pb-3">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          Cambio 24h por par
        </div>
        <div className="space-y-1">
          {sorted.map((item) => {
            const change = item.change_24h_pct ?? 0;
            const positive = change >= 0;
            const maxAbs = Math.max(
              ...ready.map((i) => Math.abs(i.change_24h_pct ?? 0)),
              0.01,
            );
            const widthPct = (Math.abs(change) / maxAbs) * 50; // max 50% width
            const asset = SYMBOL_META[item.symbol]?.asset ?? item.symbol;
            const color = positive ? "#5fbf8f" : "#e2604f";
            return (
              <div key={item.symbol} className="flex items-center gap-2 text-[10px]">
                <span className="w-8 shrink-0 font-medium text-foreground/80">
                  {asset}
                </span>
                <div className="relative flex h-3.5 flex-1 items-center justify-center">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                  {positive ? (
                    <div
                      className="absolute inset-y-0 rounded-sm bg-[#5fbf8f]/40"
                      style={{ left: "50%", width: `${widthPct}%` }}
                    />
                  ) : (
                    <div
                      className="absolute inset-y-0 rounded-sm bg-[#e2604f]/40"
                      style={{
                        right: "50%",
                        width: `${widthPct}%`,
                      }}
                    />
                  )}
                </div>
                <span
                  className="tnum w-12 shrink-0 text-right"
                  style={{ color }}
                >
                  {fmtPct(change)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-white/5 bg-white/[0.015] p-5">
        <p className="text-xs leading-relaxed text-foreground/70">
          <span className="font-medium text-foreground/90">
            {breadthPct >= 60
              ? "Sesgo alcista amplio"
              : breadthPct <= 40
                ? "Sesgo bajista amplio"
                : "Mercado dividido"}
          </span>
          {" — "}
          {bullish}/{ready.length} pares en estructura alcista
          {compressed > 0 ? `, ${compressed} comprimidos` : ""}.{" "}
          {biggestMover.symbol === topPerformer.symbol
            ? `${moverAsset} lidera con el mayor movimiento.`
            : `${moverAsset} muestra la mayor volatilidad.`}
        </p>
      </div>
    </article>
  );
}
