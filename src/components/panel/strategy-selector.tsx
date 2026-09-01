"use client";

import { useState } from "react";
import {
  STRATEGY_LIST,
  evaluateStrategy,
  type Strategy,
  type StrategyResult,
  type StrategyAction,
} from "@/lib/strategies";
import type { AnalysisResponse } from "@/lib/types";
import { Target, ChevronDown, Check, X, Minus } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

type Props = {
  data: AnalysisResponse;
};

/**
 * StrategySelector — a collapsible panel that lets the user pick a predefined
 * trading strategy and see the current evaluation (BUY/HOLD/SHORT/WAIT) with
 * confidence score and a breakdown of which signals fired.
 *
 * Strategies are evaluated client-side from the analysis data (no extra API
 * call). The selected strategy is persisted in localStorage.
 */
export function StrategySelector({ data }: Props) {
  const { t } = useLanguage();

  const ACTION_META: Record<
    StrategyAction,
    { label: string; color: string; bg: string; icon: typeof Check }
  > = {
    BUY: {
      label: t("strategy.buy"),
      color: "#5fbf8f",
      bg: "bg-[#5fbf8f]/12 border-[#5fbf8f]/30",
      icon: Check,
    },
    SHORT: {
      label: t("strategy.short"),
      color: "#e2604f",
      bg: "bg-[#e2604f]/12 border-[#e2604f]/30",
      icon: X,
    },
    HOLD: {
      label: t("strategy.hold"),
      color: "#e8b04b",
      bg: "bg-[#e8b04b]/12 border-[#e8b04b]/30",
      icon: Minus,
    },
    WAIT: {
      label: t("strategy.wait"),
      color: "#8b96a5",
      bg: "bg-white/5 border-white/10",
      icon: Minus,
    },
  };

  const [selectedId, setSelectedId] = useState<string>(() => {
    if (typeof window === "undefined") return "trend_buy";
    try {
      return localStorage.getItem("panel:strategy") || "trend_buy";
    } catch {
      return "trend_buy";
    }
  });
  const [expanded, setExpanded] = useState(false);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem("panel:strategy", id);
    } catch {
      // ignore
    }
  };

  const strategy: Strategy | undefined = STRATEGY_LIST.find(
    (s) => s.id === selectedId,
  );
  if (!strategy) return null;

  const result: StrategyResult = evaluateStrategy(strategy, data);
  const actionMeta = ACTION_META[result.action];
  const ActionIcon = actionMeta.icon;

  return (
    <div className="rounded-lg border border-white/8 bg-card/60 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-[#4fa8d8]" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            {t("strategy.title")}
          </span>
        </div>
        {/* Action badge */}
        <div
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold ${actionMeta.bg}`}
          style={{ color: actionMeta.color }}
        >
          <ActionIcon className="h-3.5 w-3.5" aria-hidden />
          {actionMeta.label}
          <span className="tnum text-[10px] opacity-70">{result.confidence}%</span>
        </div>
      </div>

      {/* Strategy selector dropdown */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-white/8 bg-black/20 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-black/30 focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
          aria-expanded={expanded}
        >
          <span className="truncate font-medium text-foreground/90">
            {strategy.name}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </button>

        {expanded && (
          <div className="mt-1 space-y-1">
            {STRATEGY_LIST.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  handleSelect(s.id);
                  setExpanded(false);
                }}
                className={`w-full rounded-md border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                  s.id === selectedId
                    ? "border-[#4fa8d8]/30 bg-[#4fa8d8]/10 text-foreground"
                    : "border-white/5 bg-black/15 text-muted-foreground hover:text-foreground/80"
                }`}
              >
                <div className="font-medium">{s.name}</div>
                <div className="mt-0.5 text-[9px] leading-snug opacity-60">
                  {s.description}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/70">
        {strategy.description}
      </p>

      {/* Summary */}
      <div
        className="mt-2.5 rounded-md border px-2.5 py-2 text-[11px] leading-relaxed"
        style={{
          borderColor: `${actionMeta.color}30`,
          background: `${actionMeta.color}08`,
          color: result.action === "WAIT" ? "rgba(230,237,243,0.7)" : actionMeta.color,
        }}
      >
        {result.summary}
      </div>

      {/* Signals breakdown */}
      <div className="mt-2 space-y-1">
        {result.signals.map((sig, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded px-1.5 py-0.5 text-[10px]"
          >
            <span
              className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
                sig.fired
                  ? "bg-[#5fbf8f]/15"
                  : "bg-white/5"
              }`}
            >
              {sig.fired ? (
                <Check className="h-2.5 w-2.5 text-[#5fbf8f]" aria-hidden />
              ) : (
                <Minus className="h-2.5 w-2.5 text-muted-foreground/40" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <span
                className={`font-medium ${
                  sig.fired ? "text-foreground/80" : "text-muted-foreground/60"
                }`}
              >
                {sig.name}
              </span>
              <span className="ml-1 text-muted-foreground/50">
                {sig.description}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Confidence bar */}
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[9px] text-muted-foreground/50">
          <span>{t("strategy.confidence")}</span>
          <span className="tnum">{result.confidence}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/30">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${result.confidence}%`,
              background: actionMeta.color,
            }}
          />
        </div>
      </div>
    </div>
  );
}
