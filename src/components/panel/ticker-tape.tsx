"use client";

import { SYMBOL_META, type AnalysisResponse } from "@/lib/types";

type Props = {
  items: (AnalysisResponse | null)[];
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000)
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function TickerItem({ data }: { data: AnalysisResponse }) {
  const meta = SYMBOL_META[data.symbol];
  const change = data.change_24h_pct;
  const positive = (change ?? 0) >= 0;
  const unavailable = data.no_disponible.change_24h_pct;
  return (
    <div className="flex items-center gap-2 px-6">
      <span className="text-xs font-semibold uppercase tracking-wider text-foreground/90">
        {meta?.asset ?? data.symbol}
      </span>
      <span className="text-xs text-muted-foreground">/ {meta?.quote ?? "USD"}</span>
      <span className="tnum text-sm font-medium text-foreground">
        ${fmtPrice(data.spot_price)}
      </span>
      <span
        className={`tnum text-xs font-medium ${
          unavailable ? "text-muted-foreground/50" : positive ? "text-[#5fbf8f]" : "text-[#e2604f]"
        }`}
      >
        {unavailable ? "N/D" : `${positive ? "+" : ""}${change?.toFixed(2)}%`}
      </span>
      <span className="text-muted-foreground/20">|</span>
    </div>
  );
}

/**
 * TickerTape — horizontally scrolling marquee of the 3 spot prices + 24h %.
 *
 * The list is duplicated once so the CSS translateX(-50%) loop is seamless.
 * Hovering pauses the animation (see .animate-ticker in globals.css).
 */
export function TickerTape({ items }: Props) {
  const ready = items.filter((i): i is AnalysisResponse => i != null);
  if (ready.length === 0) {
    return (
      <div className="flex h-9 items-center border-b border-white/5 bg-black/30 px-4 text-xs text-muted-foreground">
        Cargando precios…
      </div>
    );
  }
  // Duplicate the list for a seamless loop.
  const loop = [...ready, ...ready];

  return (
    <div className="relative flex h-9 items-center overflow-hidden border-b border-white/5 bg-black/30">
      {/* Edge fades */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-12 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-12 bg-gradient-to-l from-background to-transparent" />
      <div className="flex w-max animate-ticker">
        {loop.map((d, i) => (
          <TickerItem key={`${d.symbol}-${i}`} data={d} />
        ))}
      </div>
    </div>
  );
}
