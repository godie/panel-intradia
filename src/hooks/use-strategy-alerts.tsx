"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Target, TrendingUp, TrendingDown } from "lucide-react";
import { SYMBOL_META, type AnalysisResponse } from "@/lib/types";
import { STRATEGY_LIST, evaluateStrategy, type StrategyAction } from "@/lib/strategies";

const STORAGE_KEY = "panel:strategy-alert-seen";

type SeenState = Record<string, StrategyAction>; // symbol → last action

function loadSeen(): SeenState {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SeenState) : {};
  } catch {
    return {};
  }
}

function saveSeen(seen: SeenState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // ignore
  }
}

/**
 * useStrategyAlerts — evaluates the selected strategy for each symbol on every
 * data refresh and fires a toast when the action TRANSITIONS from WAIT to
 * BUY/SHORT (or vice versa). This closes the loop: strategy → signal → alert.
 *
 * Only transitions are notified (not steady states) to avoid toast spam.
 * The seen-state is persisted in sessionStorage to survive reloads without
 * re-firing.
 */
export function useStrategyAlerts(
  items: (AnalysisResponse | null)[],
  strategyId: string,
  enabled: boolean = true,
) {
  const seenRef = useRef<SeenState>(loadSeen());
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (!enabled || items.length === 0) return;

    const strategy = STRATEGY_LIST.find((s) => s.id === strategyId);
    if (!strategy) return;

    const seen = seenRef.current;
    let changed = false;

    for (const data of items) {
      if (!data || !data.symbol) continue;
      const result = evaluateStrategy(strategy, data);
      const symbol = data.symbol;
      const prevAction = seen[symbol] ?? "WAIT";
      const newAction = result.action;

      // Only fire on transitions from/to actionable states.
      const isTransition =
        (prevAction === "WAIT" && (newAction === "BUY" || newAction === "SHORT")) ||
        ((prevAction === "BUY" || prevAction === "SHORT") && newAction === "WAIT");

      seen[symbol] = newAction;
      if (isTransition) changed = true;

      // On the first run, seed the seen state without firing toasts.
      if (firstRunRef.current) continue;
      if (!isTransition) continue;

      fireStrategyToast(symbol, result.strategyName, newAction, result.confidence);
    }

    if (changed) saveSeen(seen);
    firstRunRef.current = false;
  }, [items, strategyId, enabled]);
}

function fireStrategyToast(
  symbol: string,
  strategyName: string,
  action: StrategyAction,
  confidence: number,
) {
  const asset = SYMBOL_META[symbol]?.asset ?? symbol;
  const isBuy = action === "BUY";
  const color = isBuy ? "#5fbf8f" : action === "SHORT" ? "#e2604f" : "#8b96a5";
  const Icon = isBuy ? TrendingUp : action === "SHORT" ? TrendingDown : Target;

  toast(
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
        style={{ borderColor: `${color}40`, background: `${color}12` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-foreground">
          {asset} · {strategyName}
        </div>
        <div className="text-[11px]" style={{ color }}>
          {action === "BUY" ? "SEÑAL DE COMPRA" : action === "SHORT" ? "SEÑAL DE SHORT" : "Sin señal — esperar"}{" "}
          ({confidence}% confianza)
        </div>
      </div>
    </div>,
    {
      duration: 10000,
      style: {
        borderColor: `${color}40`,
        boxShadow: `0 0 20px -8px ${color}80`,
      },
    },
  );
}
