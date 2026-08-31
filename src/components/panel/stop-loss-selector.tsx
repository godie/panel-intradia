"use client";

import { useState } from "react";

type Props = {
  spotPrice: number | null;
  atr: number | null;
  direction: "long" | "short";
  defaultMultiplier?: number;
};

const MULTIPLIERS = [1.0, 1.5, 2.0, 3.0] as const;

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/**
 * StopLossSelector — ATR-based stop loss with an interactive multiplier
 * dropdown. The user can pick 1×, 1.5×, 2×, or 3× ATR and the stop price
 * recalculates instantly client-side (no API round-trip needed).
 *
 * Direction is fixed by the backend (long stop below price, short stop above)
 * based on the EMA trend, but the multiplier is user-adjustable to match
 * their risk tolerance.
 */
export function StopLossSelector({
  spotPrice,
  atr,
  direction,
  defaultMultiplier = 1.5,
}: Props) {
  const [multiplier, setMultiplier] = useState<number>(defaultMultiplier);

  if (spotPrice == null || atr == null) {
    return null;
  }

  const stopPrice =
    direction === "short"
      ? spotPrice + atr * multiplier
      : spotPrice - atr * multiplier;

  const riskPct = (atr * multiplier / spotPrice) * 100;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-[#b48cff]/20 bg-[#b48cff]/5 px-2.5 py-1.5">
      <span className="text-[9px] uppercase tracking-wider text-[#b48cff]">
        Stop ATR
      </span>
      <span className="tnum text-[11px] font-medium text-foreground/90">
        ${fmtPrice(stopPrice)}
      </span>
      <span className="text-[9px] text-muted-foreground">
        ({direction === "long" ? "largo" : "corto"} · {riskPct.toFixed(2)}% riesgo)
      </span>
      <div className="ml-auto flex items-center gap-1">
        <select
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value))}
          className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[9px] font-medium text-foreground/80 focus-visible:outline-2 focus-visible:outline-[#b48cff]"
          aria-label="Multiplicador ATR del stop loss"
        >
          {MULTIPLIERS.map((m) => (
            <option key={m} value={m} className="bg-card text-foreground">
              {m}× ATR
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
