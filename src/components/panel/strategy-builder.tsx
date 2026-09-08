"use client";

import { useState } from "react";
import {
  loadCustomStrategies,
  saveCustomStrategies,
  customStrategyToStrategy,
  CONDITION_OPTIONS,
  type CustomStrategy,
  type CustomCondition,
  type ConditionType,
  evaluateCustomStrategy,
} from "@/lib/custom-strategies";
import { STRATEGY_LIST, evaluateStrategy, type StrategyAction } from "@/lib/strategies";
import { useLanguage } from "@/hooks/use-language";
import type { AnalysisResponse } from "@/lib/types";
import { Plus, Trash2, Save, Check, Wand2, X } from "lucide-react";

type Props = {
  data: AnalysisResponse;
};

const ACTIONS: { value: StrategyAction; labelKey: string; color: string }[] = [
  { value: "BUY", labelKey: "strategy.buy", color: "#5fbf8f" },
  { value: "SHORT", labelKey: "strategy.short", color: "#e2604f" },
  { value: "HOLD", labelKey: "strategy.hold", color: "#e8b04b" },
];

export function StrategyBuilder({ data }: Props) {
  const { t } = useLanguage();
  // Load custom strategies on mount — use useState initializer to avoid
  // the setState-in-effect lint rule.
  const [strategies, setStrategies] = useState<CustomStrategy[]>(() =>
    loadCustomStrategies(),
  );
  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState("");
  const [action, setAction] = useState<StrategyAction>("BUY");
  const [conditions, setConditions] = useState<CustomCondition[]>([]);

  // No useEffect needed — strategies loaded via useState initializer.

  const handleSave = () => {
    if (!name.trim() || conditions.length === 0) return;
    const newStrategy: CustomStrategy = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      action,
      conditions,
      createdAt: Date.now(),
    };
    const updated = [...strategies, newStrategy];
    setStrategies(updated);
    saveCustomStrategies(updated);
    setName("");
    setConditions([]);
    setAction("BUY");
    setShowBuilder(false);
  };

  const handleDelete = (id: string) => {
    const updated = strategies.filter((s) => s.id !== id);
    setStrategies(updated);
    saveCustomStrategies(updated);
  };

  const addCondition = (type: ConditionType) => {
    const opt = CONDITION_OPTIONS.find((o) => o.type === type);
    setConditions([...conditions, {
      type,
      threshold: opt?.hasThreshold ? opt.defaultThreshold : undefined,
    }]);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const updateThreshold = (index: number, value: number) => {
    setConditions(conditions.map((c, i) => i === index ? { ...c, threshold: value } : c));
  };

  // Evaluate all strategies (predefined + custom) for this card
  const allStrategies = [
    ...STRATEGY_LIST,
    ...strategies.map(customStrategyToStrategy),
  ];

  return (
    <div className="rounded-lg border border-white/8 bg-card/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-[#b48cff]" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
            {t("custom.title")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowBuilder(!showBuilder)}
          className="inline-flex items-center gap-1 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/10 px-2 py-1 text-[10px] font-medium text-[#4fa8d8] hover:bg-[#4fa8d8]/20"
        >
          {showBuilder ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showBuilder ? t("common.close") : t("custom.create")}
        </button>
      </div>

      {/* Builder UI */}
      {showBuilder && (
        <div className="mt-3 space-y-2 rounded-md border border-white/5 bg-black/20 p-3">
          {/* Name + Action */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("custom.namePlaceholder")}
              className="w-32 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
            />
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as StrategyAction)}
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value} className="bg-card">
                  {t(a.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Conditions */}
          <div className="space-y-1">
            {conditions.map((cond, i) => {
              const opt = CONDITION_OPTIONS.find((o) => o.type === cond.type);
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex-1 text-[11px] text-foreground/80">
                    {t(opt?.labelKey ?? cond.type)}
                  </span>
                  {opt?.hasThreshold && (
                    <input
                      type="number"
                      value={cond.threshold ?? 0}
                      onChange={(e) => updateThreshold(i, Number(e.target.value))}
                      className="w-14 rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-foreground"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeCondition(i)}
                    className="rounded p-0.5 text-muted-foreground/40 hover:text-[#e2604f]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add condition dropdown */}
          <div className="flex flex-wrap gap-1">
            {CONDITION_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => addCondition(opt.type)}
                className="rounded border border-white/8 bg-black/20 px-1.5 py-0.5 text-[9px] text-muted-foreground/70 hover:bg-white/5 hover:text-foreground/80"
              >
                + {t(opt.labelKey)}
              </button>
            ))}
          </div>

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || conditions.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-2.5 py-1 text-xs font-medium text-[#5fbf8f] hover:bg-[#5fbf8f]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {t("custom.save")}
          </button>
        </div>
      )}

      {/* Saved strategies list */}
      {strategies.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
            {t("custom.saved")}
          </div>
          {strategies.map((s) => {
            const result = evaluateCustomStrategy(s, data);
            const actionColor =
              result.action === "BUY" ? "#5fbf8f"
                : result.action === "SHORT" ? "#e2604f"
                : result.action === "HOLD" ? "#e8b04b"
                : "#8b96a5";
            return (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] hover:bg-white/[0.03]"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: actionColor }}
                />
                <span className="flex-1 truncate text-foreground/70">{s.name}</span>
                <span className="tnum font-medium" style={{ color: actionColor }}>
                  {t(`strategy.${result.action.toLowerCase() === "buy" ? "buyLabel" : result.action.toLowerCase() === "short" ? "shortLabel" : result.action.toLowerCase() === "hold" ? "hold" : "wait"}`)} {result.confidence}%
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  className="rounded p-0.5 text-muted-foreground/40 hover:text-[#e2604f]"
                  title={t("custom.deleteConfirm")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {strategies.length === 0 && !showBuilder && (
        <p className="mt-2 text-[10px] text-muted-foreground/40">
          {t("custom.empty")}
        </p>
      )}
    </div>
  );
}
