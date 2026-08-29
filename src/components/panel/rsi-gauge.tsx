"use client";

type Props = {
  rsi: number | null;
  unavailable: boolean;
  series?: (number | null)[];
};

/**
 * RsiGauge — compact horizontal RSI meter with the classic 30/70 zones.
 *
 * Layout:
 *  - A 100px-wide track split into 3 zones: oversold (0–30, green tint),
 *    neutral (30–70, muted), overbought (70–100, red tint).
 *  - A vertical needle marking the current RSI value.
 *  - The numeric value to the right, colored by zone.
 *  - Optional mini sparkline of the RSI series underneath.
 *
 * When `unavailable` is true we render an explicit "N/D" pill — never a
 * fabricated number.
 */
export function RsiGauge({ rsi, unavailable, series }: Props) {
  if (unavailable || rsi == null || !Number.isFinite(rsi)) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          RSI 14 · 4h
        </span>
        <span className="tnum text-xs italic text-muted-foreground/60">
          Dato no disponible
        </span>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, rsi));
  const zone =
    clamped >= 70 ? "overbought" : clamped <= 30 ? "oversold" : "neutral";
  const color =
    zone === "overbought" ? "#e2604f" : zone === "oversold" ? "#5fbf8f" : "#e8b04b";
  const label =
    zone === "overbought"
      ? "Sobrecomprado"
      : zone === "oversold"
        ? "Sobrevendido"
        : "Neutral";

  // Mini RSI sparkline (last 40 points).
  const spark = (series ?? [])
    .filter((v): v is number => v != null && Number.isFinite(v))
    .slice(-40);
  const sparkMin = spark.length ? Math.min(...spark) : 0;
  const sparkMax = spark.length ? Math.max(...spark) : 100;
  const sparkSpan = sparkMax - sparkMin || 1;

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
            RSI 14 · 4h
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="tnum text-sm font-semibold" style={{ color }}>
            {clamped.toFixed(1)}
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color }}>
            {label}
          </span>
        </div>
      </div>

      {/* Gauge track */}
      <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full">
        <div className="absolute inset-0 flex">
          <div className="h-full w-[30%] bg-[#5fbf8f]/25" />
          <div className="h-full w-[40%] bg-white/5" />
          <div className="h-full w-[30%] bg-[#e2604f]/25" />
        </div>
        {/* Zone dividers */}
        <div className="absolute left-[30%] top-0 h-full w-px bg-white/15" />
        <div className="absolute left-[70%] top-0 h-full w-px bg-white/15" />
        {/* Needle */}
        <div
          className="absolute top-0 h-full w-0.5 transition-[left] duration-500 ease-out"
          style={{
            left: `${clamped}%`,
            background: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
      </div>

      {/* Scale */}
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/50 tnum">
        <span>0</span>
        <span>30</span>
        <span>50</span>
        <span>70</span>
        <span>100</span>
      </div>

      {/* Optional mini sparkline */}
      {spark.length > 2 && (
        <div className="mt-2 h-6 w-full">
          <svg
            viewBox={`0 0 ${spark.length - 1} 100`}
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden
          >
            <line
              x1="0"
              y1={100 - ((70 - sparkMin) / sparkSpan) * 100}
              x2={spark.length - 1}
              y2={100 - ((70 - sparkMin) / sparkSpan) * 100}
              stroke="rgba(226,96,79,0.25)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
            <line
              x1="0"
              y1={100 - ((30 - sparkMin) / sparkSpan) * 100}
              x2={spark.length - 1}
              y2={100 - ((30 - sparkMin) / sparkSpan) * 100}
              stroke="rgba(95,191,143,0.25)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
            <polyline
              fill="none"
              stroke={color}
              strokeWidth="1.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={spark
                .map(
                  (v, i) =>
                    `${i},${100 - ((v - sparkMin) / sparkSpan) * 100}`,
                )
                .join(" ")}
            />
          </svg>
        </div>
      )}
    </div>
  );
}
