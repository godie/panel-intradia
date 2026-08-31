"use client";

type FibLevel = { ratio: number; price: number; label: string };

type Props = {
  fibonacci: {
    swing_high: number | null;
    swing_low: number | null;
    direction: "up" | "down" | null;
    levels: FibLevel[];
    extensions?: FibLevel[];
  } | null;
  spotPrice: number | null;
  unavailable: boolean;
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/**
 * FibLevels — compact Fibonacci retracement display.
 *
 * Shows the swing high/low + 5 retracement levels (23.6%, 38.2%, 50%, 61.8%,
 * 78.6%). Each level is a row with the label + price, colored by proximity to
 * the current spot price (the closest level gets a highlighted background).
 *
 * Direction indicator: "↑ Alcista" (up) or "↓ Bajista" (down) based on
 * which swing came first.
 */
export function FibLevels({ fibonacci, spotPrice, unavailable }: Props) {
  if (unavailable || !fibonacci || !fibonacci.direction) {
    return (
      <div className="rounded-md border border-white/5 bg-black/20 px-3 py-2.5 text-center text-[11px] italic text-muted-foreground/60">
        Fibonacci no disponible
      </div>
    );
  }

  const { swing_high, swing_low, direction, levels } = fibonacci;
  const isUp = direction === "up";

  // Find the closest Fib level to the spot price for highlighting.
  let closestIdx = -1;
  let closestDist = Infinity;
  if (spotPrice != null) {
    levels.forEach((l, i) => {
      const dist = Math.abs(l.price - spotPrice);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    });
  }

  return (
    <div className="space-y-1.5">
      {/* Header with direction */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Fibonacci · 100 velas
        </span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            isUp ? "text-[#5fbf8f]" : "text-[#e2604f]"
          }`}
        >
          {isUp ? "↑ Alcista" : "↓ Bajista"}
        </span>
      </div>

      {/* Swing extremes */}
      <div className="flex items-center justify-between rounded-md border border-white/5 bg-black/15 px-2.5 py-1 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground/60">Swing H</span>
          <span className="tnum font-medium text-[#e2604f]/80">
            ${fmtPrice(swing_high)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="tnum font-medium text-[#5fbf8f]/80">
            ${fmtPrice(swing_low)}
          </span>
          <span className="text-muted-foreground/60">Swing L</span>
        </div>
      </div>

      {/* Fib levels */}
      <div className="space-y-0.5">
        {levels.map((l, i) => {
          const isClosest = i === closestIdx;
          const isGolden = l.ratio === 0.618; // 61.8% = golden ratio
          return (
            <div
              key={l.ratio}
              className={`flex items-center justify-between rounded px-2 py-0.5 text-[10px] transition-colors ${
                isClosest
                  ? "bg-[#4fa8d8]/10 ring-1 ring-[#4fa8d8]/30"
                  : "hover:bg-white/[0.03]"
              }`}
              title={`${l.label} retracement = $${fmtPrice(l.price)}`}
            >
              <span
                className={`font-medium ${
                  isGolden ? "text-[#e8b04b]" : "text-muted-foreground/70"
                }`}
              >
                {l.label}
                {isGolden && " ⭐"}
              </span>
              <span
                className={`tnum ${
                  isClosest ? "font-semibold text-[#4fa8d8]" : "text-foreground/80"
                }`}
              >
                ${fmtPrice(l.price)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Extension levels (profit targets) */}
      {fibonacci.extensions && fibonacci.extensions.length > 0 && (
        <>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
              Extensiones · objetivos
            </span>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="space-y-0.5">
            {fibonacci.extensions.map((l) => {
              const isGolden = l.ratio === 1.618;
              return (
                <div
                  key={l.ratio}
                  className="flex items-center justify-between rounded px-2 py-0.5 text-[10px] hover:bg-white/[0.03]"
                  title={`${l.label} extension = $${fmtPrice(l.price)}`}
                >
                  <span
                    className={`font-medium ${
                      isGolden ? "text-[#5fbf8f]" : "text-muted-foreground/60"
                    }`}
                  >
                    {l.label}
                    {isGolden && " 🎯"}
                  </span>
                  <span className="tnum text-foreground/70">
                    ${fmtPrice(l.price)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Spot position indicator */}
      {spotPrice != null && closestIdx >= 0 && (
        <div className="text-center text-[9px] text-muted-foreground/50">
          Precio cerca de{" "}
          <span className="font-medium text-[#4fa8d8]">
            {levels[closestIdx].label}
          </span>{" "}
          (${fmtPrice(levels[closestIdx].price)})
        </div>
      )}
    </div>
  );
}
