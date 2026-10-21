"use client";

import { useMemo } from "react";
import type { BacktestInterval, PositionSizing } from "@/lib/backtest";
import type { CustomStrategy } from "@/lib/custom-strategies";
import { loadWatchlist } from "@/lib/symbol-manager";
import { useLanguage } from "@/hooks/use-language";

export type BacktestFormConfig = {
  symbol: string;
  interval: BacktestInterval;
  /** 220 | 500 | 1000 (provider cap). */
  candles: number;
  /** Predefined strategy id; null cuando la estrategia es custom. */
  strategyId: string | null;
  /** Display name si es custom (para el guardado). */
  customStrategyName: string;
  /** Custom strategy del builder; null para predefinidas. */
  customStrategy: CustomStrategy | null;
  minConfidence: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldCandles: number;
  positionSizing: PositionSizing;
  fixedFractionalPct: number;
  feeBps: number;
};

type Props = {
  value: BacktestFormConfig;
  onChange: (next: BacktestFormConfig) => void;
  /** El selector de estrategia vive fuera del form (run) o no existe (compare). */
  variant: "run" | "compare";
};

const INTERVALS: BacktestInterval[] = ["15m", "1h", "4h", "1d"];
const CANDLE_OPTIONS = [220, 500, 1000];
const SIZING_OPTIONS: PositionSizing[] = [
  "full",
  "fixed_fractional",
  "half_kelly",
  "kelly",
];

const SIZING_LABEL_KEYS: Record<PositionSizing, string> = {
  full: "backtest.sizingFull",
  fixed_fractional: "backtest.sizingFixedFractional",
  half_kelly: "backtest.sizingHalfKelly",
  kelly: "backtest.sizingKelly",
};

const INPUT_CLS =
  "mt-1 w-full rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-mono text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]";
const LABEL_CLS =
  "block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground";

function numFromEvent(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * BacktestConfigForm — panel de configuración compartido por las tabs
 * Corrida y Comparación (misma fuente de verdad para los tradeLimits).
 * No incluye el/los selectores de estrategia: cada tab decide el suyo.
 */
export function BacktestConfigForm({ value, onChange, variant }: Props) {
  const { t } = useLanguage();
  const set = (patch: Partial<BacktestFormConfig>) =>
    onChange({ ...value, ...patch });

  // Watchlist del dashboard (5 default + pares agregados por el usuario):
  // autocomplete nativo via <datalist>; el input sigue aceptando cualquier
  // par USDT válido (la validación que importa es validateSymbol/server).
  const watchlist = useMemo(() => loadWatchlist(), []);

  void variant; // mismas brains para ambas tabs en v1

  return (
    <div className="space-y-3">
      <label className={LABEL_CLS}>
        {t("backtest.symbol")}
        <input
          type="text"
          list="backtest-symbol-options"
          value={value.symbol}
          onChange={(e) => set({ symbol: e.target.value.toUpperCase() })}
          className={INPUT_CLS}
        />
      </label>
      <datalist id="backtest-symbol-options">
        {watchlist.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className={LABEL_CLS}>
        <span className={LABEL_CLS.replace("block ", "")}>{t("backtest.interval")}</span>
        <div className="mt-1 flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => set({ interval: iv })}
              aria-pressed={value.interval === iv}
              className={`flex-1 rounded-md px-2 py-1 font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8] ${
                value.interval === iv
                  ? "bg-[#4fa8d8]/15 text-[#4fa8d8]"
                  : "text-foreground/60 hover:bg-white/5"
              }`}
            >
              {iv.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <label className={LABEL_CLS}>
        {t("backtest.candles")}
        <select
          value={String(value.candles)}
          onChange={(e) => set({ candles: numFromEvent(e.target.value, 500) })}
          className={INPUT_CLS}
        >
          {CANDLE_OPTIONS.map((c) => (
            <option key={c} value={String(c)} className="bg-[#11151c]">
              {c}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className={LABEL_CLS}>
          {t("backtest.minConfidence")}
          <input
            type="number"
            min={10}
            max={100}
            value={value.minConfidence}
            onChange={(e) =>
              set({ minConfidence: numFromEvent(e.target.value, 60) })
            }
            className={INPUT_CLS}
          />
        </label>
        <label className={LABEL_CLS}>
          {t("backtest.initialCapital")}
          <input
            type="number"
            min={100}
            value={value.initialCapital}
            onChange={(e) =>
              set({ initialCapital: numFromEvent(e.target.value, 10_000) })
            }
            className={INPUT_CLS}
          />
        </label>
        <label className={LABEL_CLS}>
          {t("backtest.stopLoss")}
          <input
            type="number"
            min={0.1}
            max={50}
            step={0.1}
            value={value.stopLossPct}
            onChange={(e) => set({ stopLossPct: numFromEvent(e.target.value, 5) })}
            className={INPUT_CLS}
          />
        </label>
        <label className={LABEL_CLS}>
          {t("backtest.takeProfit")}
          <input
            type="number"
            min={0.1}
            max={200}
            step={0.1}
            value={value.takeProfitPct}
            onChange={(e) =>
              set({ takeProfitPct: numFromEvent(e.target.value, 10) })
            }
            className={INPUT_CLS}
          />
        </label>
      </div>

      <label className={LABEL_CLS}>
        {t("backtest.maxHold")}
        <input
          type="number"
          min={1}
          max={500}
          value={value.maxHoldCandles}
          onChange={(e) =>
            set({ maxHoldCandles: numFromEvent(e.target.value, 50) })
          }
          className={INPUT_CLS}
        />
      </label>

      <label className={LABEL_CLS}>
        {t("backtest.positionSizing")}
        <select
          value={value.positionSizing}
          onChange={(e) =>
            set({ positionSizing: e.target.value as PositionSizing })
          }
          className={INPUT_CLS}
        >
          {SIZING_OPTIONS.map((s) => (
            <option key={s} value={s} className="bg-[#11151c]">
              {t(SIZING_LABEL_KEYS[s])}
            </option>
          ))}
        </select>
      </label>

      {value.positionSizing === "fixed_fractional" && (
        <label className={LABEL_CLS}>
          {t("backtest.fixedFractionalPct")}
          <input
            type="number"
            min={1}
            max={100}
            value={value.fixedFractionalPct}
            onChange={(e) =>
              set({ fixedFractionalPct: numFromEvent(e.target.value, 25) })
            }
            className={INPUT_CLS}
          />
        </label>
      )}

      <label className={LABEL_CLS}>
        {t("backtest.feeBps")}
        <input
          type="number"
          min={0}
          max={500}
          value={value.feeBps}
          onChange={(e) => set({ feeBps: numFromEvent(e.target.value, 10) })}
          className={INPUT_CLS}
        />
        <span className="mt-0.5 block text-[9px] font-normal normal-case tracking-normal text-muted-foreground/60">
          {t("backtest.feeHint")}
        </span>
      </label>
    </div>
  );
}
