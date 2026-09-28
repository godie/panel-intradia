"use client";

import type { StrategyAction } from "@/lib/strategies";
import { computeConsensus, type ConsensusLevel } from "@/lib/consensus";
import type { AnalysisResponse } from "@/lib/types";
import { Check, X, Minus, Target } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  data: AnalysisResponse;
};

const ACTION_META: Record<
  StrategyAction,
  { label: string; color: string; icon: typeof Check }
> = {
  BUY: { label: "Buy", color: "#5fbf8f", icon: Check },
  SHORT: { label: "Short", color: "#e2604f", icon: X },
  HOLD: { label: "Hold", color: "#e8b04b", icon: Minus },
  WAIT: { label: "Wait", color: "#8b96a5", icon: Minus },
};

export const CONSENSUS_META: Record<
  ConsensusLevel,
  { label: string; color: string; bg: string }
> = {
  strong_buy: { label: "BUY Fuerte", color: "#5fbf8f", bg: "bg-[#5fbf8f]/15 border-[#5fbf8f]/30" },
  buy: { label: "Buy", color: "#5fbf8f", bg: "bg-[#5fbf8f]/10 border-[#5fbf8f]/20" },
  mixed: { label: "Mixto", color: "#e8b04b", bg: "bg-[#e8b04b]/10 border-[#e8b04b]/20" },
  short: { label: "Short", color: "#e2604f", bg: "bg-[#e2604f]/10 border-[#e2604f]/20" },
  strong_short: { label: "SHORT Fuerte", color: "#e2604f", bg: "bg-[#e2604f]/15 border-[#e2604f]/30" },
};

/**
 * StrategyConsensus — evaluates ALL 4 predefined strategies simultaneously
 * and shows a consensus recommendation. If most strategies agree on BUY or
 * SHORT, the consensus is strong; if they disagree, the consensus is mixed.
 *
 * Shows:
 *  - A consensus action badge (strong BUY / BUY / mixed / SHORT / strong SHORT)
 *  - A list of all 4 strategies with their individual actions + confidence
 *  - A weighted score bar (sum of weights × confidence)
 */
export function StrategyConsensus({ data }: Props) {
  const { t } = useLanguage();
  const {
    level: consensus,
    avgConfidence,
    scorePct,
    results,
  } = computeConsensus(data);

  const consensusMeta = CONSENSUS_META[consensus];

  return (
    <div className="rounded-lg border border-white/8 bg-card/60 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            {t("strategy.consensus")}
          </span>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold ${consensusMeta.bg}`}
          style={{ color: consensusMeta.color }}
        >
          {consensusMeta.label}
          <span className="tnum text-[10px] opacity-70">{avgConfidence}%</span>
        </div>
      </div>

      {/* Score bar */}
      <div className="mt-2">
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/30">
          {/* Center line */}
          <div className="absolute left-1/2 top-0 h-full w-px bg-white/15" />
          {/* Score fill */}
          <div
            className="absolute top-0 h-full transition-[width,left] duration-500"
            style={{
              left: scorePct >= 0 ? "50%" : `${50 + scorePct / 2}%`,
              width: `${Math.abs(scorePct) / 2}%`,
              background: scorePct >= 0 ? "#5fbf8f" : "#e2604f",
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/50">
          <span className="text-[#e2604f]">{t("strategy.shortLabel")}</span>
          <span>{t("common.neutral")}</span>
          <span className="text-[#5fbf8f]">{t("strategy.buyLabel")}</span>
        </div>
      </div>

      {/* Strategy list */}
      <div className="mt-2.5 space-y-1">
        {results.map((r) => {
          const meta = ACTION_META[r.action];
          const Icon = meta.icon;
          return (
            <div
              key={r.strategyId}
              className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/[0.03]"
            >
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                style={{ background: `${meta.color}15` }}
              >
                <Icon className="h-3 w-3" style={{ color: meta.color }} aria-hidden />
              </div>
              <span className="flex-1 truncate text-foreground/70">
                {t(r.strategy.name).split("·")[0].trim()}
              </span>
              <span
                className="tnum font-medium"
                style={{ color: meta.color }}
              >
                {meta.label} {r.confidence}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
