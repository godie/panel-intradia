"use client";

type Props = {
  k: number | null;
  d: number | null;
  unavailable: boolean;
};

/**
 * StochasticRow — compact %K + %D display with overbought/oversold zones.
 *
 * Shows the current %K and %D values + a mini gauge bar with the 20/80
 * threshold zones. Interpretation:
 *  - %K > 80 → overbought (red)
 *  - %K < 20 → oversold (green)
 *  - %K crossing above %D → bullish
 *  - %K crossing below %D → bearish
 */
export function StochasticRow({ k, d, unavailable }: Props) {
  if (unavailable || k == null || !Number.isFinite(k)) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Stochastic · 14/3
        </span>
        <span className="tnum text-xs italic text-muted-foreground/60">
          Dato no disponible
        </span>
      </div>
    );
  }

  const zone = k >= 80 ? "overbought" : k <= 20 ? "oversold" : "neutral";
  const color =
    zone === "overbought" ? "#e2604f" : zone === "oversold" ? "#5fbf8f" : "#e8b04b";
  const label =
    zone === "overbought"
      ? "Sobrecomprado"
      : zone === "oversold"
        ? "Sobrevendido"
        : "Neutral";

  // Cross signal: %K above %D = bullish, below = bearish.
  const crossSignal =
    d != null && Number.isFinite(d)
      ? k > d
        ? "↑ alcista"
        : k < d
          ? "↓ bajista"
          : "="
      : null;
  const crossColor = crossSignal?.includes("alcista") ? "#5fbf8f" : crossSignal?.includes("bajista") ? "#e2604f" : "#8b96a5";

  return (
    <div className="border-b border-white/5 py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Stochastic · 14/3
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="tnum text-sm font-semibold" style={{ color }}>
            %K {k.toFixed(1)}
          </span>
          {d != null && Number.isFinite(d) && (
            <span className="tnum text-[11px] text-muted-foreground">
              %D {d.toFixed(1)}
            </span>
          )}
          {crossSignal && (
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: crossColor }}
            >
              {crossSignal}
            </span>
          )}
        </div>
      </div>

      {/* Mini gauge bar */}
      <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 flex">
          <div className="h-full w-[20%] bg-[#5fbf8f]/25" />
          <div className="h-full w-[60%] bg-white/5" />
          <div className="h-full w-[20%] bg-[#e2604f]/25" />
        </div>
        <div
          className="absolute left-[20%] top-0 h-full w-px bg-white/15"
        />
        <div
          className="absolute left-[80%] top-0 h-full w-px bg-white/15"
        />
        {/* %K needle */}
        <div
          className="absolute top-0 h-full w-0.5 transition-[left] duration-500 ease-out"
          style={{
            left: `${k}%`,
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
        {/* %D needle (thinner, blue) */}
        {d != null && Number.isFinite(d) && (
          <div
            className="absolute top-0 h-full w-px bg-[#4fa8d8]/60 transition-[left] duration-500 ease-out"
            style={{ left: `${d}%` }}
          />
        )}
      </div>

      {/* Scale */}
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/50 tnum">
        <span>0</span>
        <span>20</span>
        <span className={zone === "overbought" ? "text-[#e2604f]" : ""}>{label}</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}
