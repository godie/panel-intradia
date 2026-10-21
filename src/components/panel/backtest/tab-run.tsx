"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Loader2, Play, Save } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";
import { STRATEGY_LIST } from "@/lib/strategies";
import type { BacktestResult } from "@/lib/backtest";
import {
  loadCustomStrategies,
  type CustomStrategy,
} from "@/lib/custom-strategies";
import { formatNumber } from "./format";
import {
  BacktestConfigForm,
  type BacktestFormConfig,
} from "./config-form";
import { EquityCurveCanvas } from "./equity-curve";
import { TradeTable } from "./trade-table";
import { WalkForwardModal } from "@/components/panel/walk-forward-modal";

const DEFAULT_CONFIG: BacktestFormConfig = {
  symbol: "BTCUSDT",
  interval: "4h",
  candles: 500,
  strategyId: "trend_buy",
  customStrategyName: "",
  customStrategy: null,
  minConfidence: 60,
  initialCapital: 10_000,
  stopLossPct: 5,
  takeProfitPct: 10,
  maxHoldCandles: 50,
  positionSizing: "full",
  fixedFractionalPct: 25,
  feeBps: 10,
};

/** Identidad seleccionable del selector de estrategia. */
type StrategyPick =
  | { kind: "predefined"; id: string }
  | { kind: "custom"; strategy: CustomStrategy };

function pickValue(p: StrategyPick): string {
  return p.kind === "predefined" ? p.id : `custom:${p.strategy.id}`;
}

type Preset = { id: string; name: string; config: Record<string, unknown> };

/**
 * Tab Corrida — run individual con el endpoint /api/backtest existente,
 * guardado en BD (/api/backtest/runs), presets (/api/backtest/presets) y
 * Walk-Forward reusado (modal, prop-shape idéntica al BacktestModal).
 */
export default function TabRun() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<BacktestFormConfig>(DEFAULT_CONFIG);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [wfOpen, setWfOpen] = useState(false);

  // Estrategias del builder (localStorage) + presets (BD server-side).
  const customStrategies = useMemo<CustomStrategy[]>(
    () => loadCustomStrategies(),
    [],
  );
  const reloadPresets = useCallback(async () => {
    try {
      const res = await fetch("/api/backtest/presets");
      const json = (await res.json()) as { presets?: Preset[] };
      setPresets(json.presets ?? []);
    } catch {
      setPresets([]);
    }
  }, []);
  useEffect(() => {
    void reloadPresets();
  }, [reloadPresets]);

  const pick: StrategyPick =
    config.customStrategy
      ? { kind: "custom", strategy: config.customStrategy }
      : { kind: "predefined", id: config.strategyId ?? "trend_buy" };

  const setPick = (value: string) => {
    if (value.startsWith("custom:")) {
      const id = value.slice("custom:".length);
      const cs = customStrategies.find((c) => c.id === id);
      if (cs) setConfig({ ...config, strategyId: null, customStrategy: cs, customStrategyName: cs.name });
      return;
    }
    setConfig({ ...config, strategyId: value, customStrategy: null, customStrategyName: "" });
  };

  const strategyNameForWf = pick.kind === "predefined"
    ? STRATEGY_LIST.find((s) => s.id === pick.id)?.name ?? pick.id
    : pick.strategy.name;

  const applyPreset = () => {
    const preset = presets.find((p) => p.id === selectedPreset);
    if (!preset) return;
    const c = preset.config;
    setConfig((prev) => ({
      ...prev,
      symbol: typeof c.symbol === "string" ? c.symbol.toUpperCase() : prev.symbol,
      candles: typeof c.limit === "number" ? c.limit : prev.candles,
      minConfidence: typeof c.minConfidence === "number" ? c.minConfidence : prev.minConfidence,
      initialCapital: typeof c.initialCapital === "number" ? c.initialCapital : prev.initialCapital,
      stopLossPct: typeof c.stopLossPct === "number" ? c.stopLossPct : prev.stopLossPct,
      takeProfitPct: typeof c.takeProfitPct === "number" ? c.takeProfitPct : prev.takeProfitPct,
      maxHoldCandles: typeof c.maxHoldCandles === "number" ? c.maxHoldCandles : prev.maxHoldCandles,
      positionSizing:
        c.positionSizing === "fixed_fractional" ||
        c.positionSizing === "half_kelly" ||
        c.positionSizing === "kelly"
          ? c.positionSizing
          : prev.positionSizing,
      fixedFractionalPct:
        typeof c.fixedFractionalPct === "number" ? c.fixedFractionalPct : prev.fixedFractionalPct,
      feeBps: typeof c.feeBps === "number" ? c.feeBps : prev.feeBps,
    }));
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    setPresetMsg(null);
    try {
      const res = await fetch("/api/backtest/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.slice(0, 80),
          config: {
            symbol: config.symbol,
            interval: config.interval,
            limit: config.candles,
            minConfidence: config.minConfidence,
            initialCapital: config.initialCapital,
            stopLossPct: config.stopLossPct,
            takeProfitPct: config.takeProfitPct,
            maxHoldCandles: config.maxHoldCandles,
            positionSizing: config.positionSizing,
            fixedFractionalPct: config.fixedFractionalPct,
            feeBps: config.feeBps,
          },
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setPresetMsg(json.error ?? t("backtestUI.saveFailed"));
      } else {
        setPresetMsg(t("backtestUI.presetSaved"));
        setPresetName("");
        await reloadPresets();
      }
    } catch {
      setPresetMsg(t("backtestUI.saveFailed"));
    }
  };

  const deletePreset = async () => {
    if (!selectedPreset) return;
    try {
      await fetch(`/api/backtest/presets/${selectedPreset}`, { method: "DELETE" });
      setSelectedPreset("");
      await reloadPresets();
    } catch {
      // sin badge: el select se refresca y ya no lo muestra
    }
  };

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: config.symbol,
          interval: config.interval,
          limit: config.candles,
          ...(config.customStrategy
            ? { customStrategy: config.customStrategy }
            : { strategyId: config.strategyId }),
          minConfidence: config.minConfidence,
          initialCapital: config.initialCapital,
          stopLossPct: config.stopLossPct,
          takeProfitPct: config.takeProfitPct,
          maxHoldCandles: config.maxHoldCandles,
          positionSizing: config.positionSizing,
          fixedFractionalPct: config.fixedFractionalPct,
          feeBps: config.feeBps,
        }),
      });
      const json = (await res.json()) as BacktestResult;
      if (json.error) {
        setError(json.error);
        setResult(null);
      } else {
        setResult(json);
      }
    } catch {
      setError(t("backtest.error"));
    } finally {
      setRunning(false);
    }
  }, [config, t]);

  const save = useCallback(async () => {
    if (!result) return;
    setSaveMsg(null);
    try {
      const res = await fetch("/api/backtest/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            symbol: result.symbol,
            interval: config.interval,
            candles: config.candles,
            strategyId: config.customStrategy ? null : result.strategy.id,
            strategyName: config.customStrategy
              ? config.customStrategyName
              : t(result.strategy.name) === result.strategy.name
                ? result.strategy.name
                : t(result.strategy.name),
            isCustom: !!config.customStrategy,
            minConfidence: config.minConfidence,
            initialCapital: config.initialCapital,
            stopLossPct: config.stopLossPct,
            takeProfitPct: config.takeProfitPct,
            maxHoldCandles: config.maxHoldCandles,
            positionSizing: config.positionSizing,
            fixedFractionalPct: config.fixedFractionalPct,
            feeBps: config.feeBps,
          },
          result,
        }),
      });
      const json = (await res.json()) as {
        id?: string;
        truncated?: boolean;
        error?: string;
      };
      if (!res.ok || !json.id) {
        setSaveMsg(t("backtestUI.saveFailed"));
      } else {
        setSaveMsg(
          json.truncated
            ? `${t("backtestUI.savedDb")} · ${t("backtestUI.saveTruncated")}`
            : t("backtestUI.savedDb"),
        );
      }
    } catch {
      setSaveMsg(t("backtestUI.saveFailed"));
    }
  }, [config, result, t]);

  const stats = result?.stats;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3 self-start rounded-lg border border-white/10 bg-[#11151c] p-4 lg:sticky lg:top-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("backtest.configTitle")}
        </h3>

        <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("backtestUI.strategy")}
          <select
            value={pickValue(pick)}
            onChange={(e) => setPick(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
          >
            {STRATEGY_LIST.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#11151c]">
                {t(s.name)}
              </option>
            ))}
            {customStrategies.map((cs) => (
              <option key={`custom:${cs.id}`} value={`custom:${cs.id}`} className="bg-[#11151c]">
                {cs.name}
              </option>
            ))}
          </select>
        </label>

        <BacktestConfigForm value={config} onChange={setConfig} variant="run" />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#5FBF8F] px-3 py-2 text-xs font-semibold text-[#0A0D12] transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            {running ? t("backtest.running") : t("backtest.run")}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!result}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#4fa8d8]/40 bg-[#4fa8d8]/10 px-3 py-2 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {t("backtestUI.saveDb")}
            </button>
            <button
              type="button"
              onClick={() => setWfOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#b48cff]/40 bg-[#b48cff]/10 px-3 py-2 text-xs font-medium text-[#b48cff] transition-colors hover:bg-[#b48cff]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {t("backtest.walkForward")}
            </button>
          </div>
          {saveMsg && <p className="text-[11px] text-muted-foreground">{saveMsg}</p>}
        </div>

        {/* Presets (BD) */}
        <div className="space-y-2 border-t border-white/8 pt-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("backtestUI.loadPresets")}
          </h3>
          {presets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("backtestUI.noPresets")}</p>
          ) : (
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              <option value="" className="bg-[#11151c]">
                {t("backtestUI.loadPresets")}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#11151c]">
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={applyPreset}
              disabled={!selectedPreset}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-white/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {t("backtestUI.applyPreset")}
            </button>
            <button
              type="button"
              onClick={() => void deletePreset()}
              disabled={!selectedPreset}
              className="rounded-md border border-[#E2604F]/40 bg-[#E2604F]/10 px-3 py-1.5 text-xs text-[#E2604F] transition-colors hover:bg-[#E2604F]/20 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {t("backtestUI.deletePreset")}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={presetName}
              maxLength={80}
              onChange={(e) => setPresetName(e.target.value)}
              aria-label={t("backtestUI.presetName")}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            />
            <button
              type="button"
              onClick={() => void savePreset()}
              className="rounded-md border border-[#4fa8d8]/40 bg-[#4fa8d8]/10 px-3 py-1.5 text-xs text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
            >
              {t("backtestUI.savePreset")}
            </button>
          </div>
          {presetMsg && <p className="text-[11px] text-muted-foreground">{presetMsg}</p>}
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-[#E2604F]/40 bg-[#E2604F]/10 px-3 py-2 text-xs text-[#E2604F]"
          >
            {error}
          </div>
        )}

        {!result && !error && !running && (
          <div className="rounded-lg border border-white/10 bg-[#11151c] p-10 text-center text-sm text-muted-foreground">
            {t("backtest.description")}
          </div>
        )}

        {result && stats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  { key: "backtest.totalTrades", val: String(stats.totalTrades) },
                  { key: "backtest.winRate", val: `${stats.winRate.toFixed(1)}%` },
                  { key: "backtest.totalReturn", val: `${stats.totalReturnPct >= 0 ? "+" : ""}${stats.totalReturnPct.toFixed(2)}%` },
                  { key: "backtest.maxDrawdown", val: `${stats.maxDrawdownPct.toFixed(2)}%` },
                  { key: "backtest.profitFactor", val: Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "—" },
                  { key: "backtest.finalEquity", val: `$${formatNumber(stats.finalEquity)}` },
                  { key: "backtest.wins", val: String(stats.wins) },
                  { key: "backtest.losses", val: String(stats.losses) },
                ] as const
              ).map((m) => (
                <div
                  key={m.key}
                  className="rounded-md border border-white/8 bg-[#11151c] px-3 py-2"
                >
                  <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t(m.key)}
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-sm ${
                      m.key === "backtest.totalReturn"
                        ? Number(stats.totalReturnPct) >= 0
                          ? "text-[#5FBF8F]"
                          : "text-[#E2604F]"
                        : "text-foreground"
                    }`}
                  >
                    {m.val}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-white/10 bg-[#11151c] p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("backtest.equityCurve")}
                </h4>
                <Coins className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              </div>
              <EquityCurveCanvas
                result={result}
                className="w-full h-64 rounded-md border border-white/8 bg-background/40 md:h-80"
                ariaLabel={t("backtest.equityCurve")}
              />
              <p className="mt-2 text-[10px] text-muted-foreground">
                {t("backtest.candlesAnalyzed")}: {result.candlesAnalyzed} ·{" "}
                {t("backtest.provider")}: {result.provider}
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#11151c] p-4">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("backtest.trades")}{" "}
                <span className="font-normal text-muted-foreground/60">
                  ({result.trades.length})
                </span>
              </h4>
              <TradeTable trades={result.trades} maxHeightClass="max-h-[60vh]" />
            </div>
          </>
        )}
      </section>

      <WalkForwardModal
        strategy={
          pick.kind === "predefined"
            ? { id: pick.id, name: strategyNameForWf, action: "BUY" }
            : pick.strategy
        }
        predefined={pick.kind === "predefined"}
        defaultSymbol={config.symbol}
        currentParams={{
          interval: config.interval,
          minConfidence: config.minConfidence,
          initialCapital: config.initialCapital,
          stopLossPct: config.stopLossPct,
          takeProfitPct: config.takeProfitPct,
          maxHoldCandles: config.maxHoldCandles,
          positionSizing: config.positionSizing,
          fixedFractionalPct: config.fixedFractionalPct,
          feeBps: config.feeBps,
        }}
        open={wfOpen}
        onClose={() => setWfOpen(false)}
      />
    </div>
  );
}
