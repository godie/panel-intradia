"use client";

type FibLevel = { ratio: number; price: number; label: string };

type Props = {
  spot: number | null;
  support: number | null;
  resistance: number | null;
  ema55: number | null;
  ema200: number | null;
  high24h: number | null;
  low24h: number | null;
  /** Optional Fibonacci retracement levels to display as markers. */
  fibLevels?: FibLevel[];
};

/**
 * RangeBar — a horizontal bar showing where the spot price sits within its
 * support/resistance range. EMA55, EMA200 and the 24h high/low are marked
 * as vertical ticks so the trader can read the full micro-structure at a
 * glance.
 *
 * The bar spans from `min(all lows)` to `max(all highs)` so every marker
 * is always visible. The spot price is rendered as a glowing dot whose
 * color reflects its position (green near support, red near resistance).
 *
 * If support or resistance is missing the component renders an explicit
 * "Dato no disponible" notice — never a fabricated bar.
 */
export function RangeBar({
  spot,
  support,
  resistance,
  ema55,
  ema200,
  high24h,
  low24h,
  fibLevels,
}: Props) {
  // Gather all reference points (including Fib levels) to compute the visible range.
  const fibPrices = (fibLevels ?? [])
    .map((l) => l.price)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const points = [support, resistance, ema55, ema200, high24h, low24h, spot, ...fibPrices].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );

  if (spot == null || points.length < 2) {
    return (
      <div className="rounded-md border border-white/5 bg-black/20 px-3 py-2.5 text-center text-[11px] italic text-muted-foreground/60">
        Dato no disponible
      </div>
    );
  }

  let min = Math.min(...points);
  let max = Math.max(...points);
  // 4% headroom so markers don't touch the edges.
  const span = max - min || 1;
  min -= span * 0.04;
  max += span * 0.04;

  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const spotPct = pct(spot);

  // Spot color: green when near support (bottom 33%), red near resistance (top 33%).
  const spotColor =
    spotPct < 33 ? "#5fbf8f" : spotPct > 67 ? "#e2604f" : "#e8b04b";

  type Tick = {
    pct: number;
    color: string;
    label: string;
    fullLabel: string;
    price: number | null;
  };
  const ticks: Tick[] = [];
  if (support != null)
    ticks.push({
      pct: pct(support),
      color: "#5fbf8f",
      label: "S",
      fullLabel: "Soporte",
      price: support,
    });
  if (resistance != null)
    ticks.push({
      pct: pct(resistance),
      color: "#e2604f",
      label: "R",
      fullLabel: "Resistencia",
      price: resistance,
    });
  if (ema55 != null)
    ticks.push({
      pct: pct(ema55),
      color: "#e8b04b",
      label: "55",
      fullLabel: "EMA 55 (4h)",
      price: ema55,
    });
  if (ema200 != null)
    ticks.push({
      pct: pct(ema200),
      color: "#4fa8d8",
      label: "200",
      fullLabel: "EMA 200 (4h)",
      price: ema200,
    });
  // Fibonacci retracement levels (only the golden ratio 61.8% to avoid clutter).
  if (fibLevels) {
    for (const fl of fibLevels) {
      if (fl.price == null || !Number.isFinite(fl.price)) continue;
      // Only show the key Fib levels on the range bar to avoid overcrowding.
      if (fl.ratio === 0.382 || fl.ratio === 0.618 || fl.ratio === 0.786) {
        ticks.push({
          pct: pct(fl.price),
          color: "#b48cff",
          label: fl.label.replace("%", ""),
          fullLabel: `Fib ${fl.label}`,
          price: fl.price,
        });
      }
    }
  }

  const fmtP = (n: number | null) =>
    n == null
      ? "—"
      : n >= 1000
        ? n.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : n >= 1
          ? n.toFixed(2)
          : n.toFixed(4);

  return (
    <div className="space-y-1.5">
      {/* The bar */}
      <div className="relative h-7">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#5fbf8f]/25 via-[#e8b04b]/25 to-[#e2604f]/25" />
        {/* 24h range band (low→high) — subtle filled zone */}
        {high24h != null && low24h != null && (
          <div
            className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-white/[0.06] transition-[width,left] duration-500"
            style={{
              left: `${pct(low24h)}%`,
              width: `${pct(high24h) - pct(low24h)}%`,
            }}
            title={`Rango 24h: ${fmtP(low24h)} – ${fmtP(high24h)}`}
          />
        )}
        {/* Mid line */}
        <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-white/10" />
        {/* Reference ticks */}
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-1/2 h-3.5 w-px -translate-y-1/2 cursor-help transition-[left] duration-500"
            style={{ left: `${t.pct}%`, background: t.color }}
            title={`${t.fullLabel}: $${fmtP(t.price)} (${t.pct.toFixed(1)}% del rango)`}
          >
            <span
              className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-medium leading-none"
              style={{ color: t.color }}
            >
              {t.label}
            </span>
          </div>
        ))}
        {/* Spot price — glowing dot */}
        <div
          className="absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black transition-[left] duration-500 ease-out"
          style={{
            left: `${spotPct}%`,
            background: spotColor,
            boxShadow: `0 0 10px ${spotColor}, 0 0 4px ${spotColor}`,
          }}
          title={`Precio: ${spot}`}
        />
      </div>
      {/* Scale labels */}
      <div className="flex justify-between text-[10px] text-muted-foreground/70 tnum">
        <span>${fmtP(min)}</span>
        <span className="text-muted-foreground/50">rango S/R</span>
        <span>${fmtP(max)}</span>
      </div>
    </div>
  );
}
