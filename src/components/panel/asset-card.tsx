"use client";

import { Sparkline } from "./sparkline";
import { RsiGauge } from "./rsi-gauge";
import { RangeBar } from "./range-bar";
import { MacdPanel } from "./macd-panel";
import { DepthBar } from "./depth-bar";
import { CollapsibleSection } from "./collapsible-section";
import { SYMBOL_META, type AnalysisResponse } from "@/lib/types";
import type { DepthSnapshot } from "@/hooks/use-order-book";
import {
  TrendingUp,
  TrendingDown,
  Minimize2,
  Activity,
  Zap,
  BarChart3,
  Radio,
} from "lucide-react";

type Props = {
  data: AnalysisResponse;
  /** Live tick price (overrides REST spot_price when present). */
  livePrice?: number | null;
  /** Whether the tick stream is currently emitting ticks for this symbol. */
  tickActive?: boolean;
  /** Epoch ms of the most recent tick for this symbol (used for the "ms ago" label). */
  lastTickAt?: number | null;
  /** "now" reference for computing elapsed time — passed from the page so all cards use the same tick. */
  nowMs?: number;
  /** L2 order book depth snapshot (from order-book mini-service). */
  depthSnapshot?: DepthSnapshot | undefined;
  /** Whether the order-book socket is connected. */
  depthConnected?: boolean;
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "Dato no disponible";
  if (n >= 1000)
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "Dato no disponible";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtVolume(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd.toFixed(0)}`;
}

const STATE_STYLES: Record<
  NonNullable<AnalysisResponse["cross_state"]>,
  {
    label: string;
    text: string;
    bg: string;
    border: string;
    icon: typeof TrendingUp;
    glow: string;
    accent: string;
  }
> = {
  ALCISTA: {
    label: "Alcista",
    text: "text-[#5fbf8f]",
    bg: "bg-[#5fbf8f]/12",
    border: "border-[#5fbf8f]/30",
    icon: TrendingUp,
    glow: "shadow-[0_0_24px_-8px_rgba(95,191,143,0.5)]",
    accent: "#5fbf8f",
  },
  BAJISTA: {
    label: "Bajista",
    text: "text-[#e2604f]",
    bg: "bg-[#e2604f]/12",
    border: "border-[#e2604f]/30",
    icon: TrendingDown,
    glow: "shadow-[0_0_24px_-8px_rgba(226,96,79,0.5)]",
    accent: "#e2604f",
  },
  COMPRIMIDO: {
    label: "Comprimido",
    text: "text-[#e8b04b]",
    bg: "bg-[#e8b04b]/12",
    border: "border-[#e8b04b]/30",
    icon: Minimize2,
    glow: "shadow-[0_0_24px_-8px_rgba(232,176,75,0.5)]",
    accent: "#e8b04b",
  },
};

/**
 * PriceFlash — wraps the spot price and briefly flashes when the value
 * changes, mimicking a trading terminal's tick indicator.
 *
 * Implementation: the `key` prop is bound to the value so React remounts
 * the span on every change, which retriggers the CSS `price-flash`
 * animation. No state, no refs, no effect — side-effect-free.
 *
 * When `live` is true we use the bullish/bearish color to also indicate
 * direction (up = green, down = red) by computing the diff from the
 * previous render's value. Because the component remounts on value change,
 * we capture the "previous" value via a module-level cache keyed on the
 * parent symbol — but to keep this pure & simple we just flash with the
 * foreground color and let the parent pass the direction-correct value.
 */
function PriceFlash({ value, live }: { value: number | null; live?: boolean }) {
  const color = live ? "#5fbf8f" : undefined;
  return (
    <span
      key={value ?? "none"}
      className="tnum text-foreground animate-price-flash"
      style={color ? { color } : undefined}
      aria-live="polite"
    >
      ${fmtPrice(value)}
    </span>
  );
}

/**
 * formatElapsed — human-readable "Ns" or "Nm" for elapsed milliseconds.
 */
function formatElapsed(ms: number): string {
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}

function MetricRow({
  label,
  value,
  unavailable,
  color,
  hint,
}: {
  label: string;
  value: string;
  unavailable: boolean;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <div className="flex items-center gap-2">
        {color && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
        )}
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-col items-end">
        <span
          className={
            unavailable
              ? "tnum text-xs italic text-muted-foreground/60"
              : "tnum text-sm font-medium"
          }
          style={unavailable ? undefined : color ? { color } : undefined}
          title={hint}
        >
          {unavailable ? "Dato no disponible" : value}
        </span>
        {hint && !unavailable && (
          <span className="text-[10px] text-muted-foreground/70">{hint}</span>
        )}
      </div>
    </div>
  );
}

export function AssetCard({
  data,
  livePrice,
  tickActive,
  lastTickAt,
  nowMs,
  depthSnapshot,
  depthConnected,
}: Props) {
  const meta = SYMBOL_META[data.symbol] ?? {
    label: data.symbol,
    pair: data.symbol,
    asset: data.symbol,
    quote: "USD",
  };
  const nd = data.no_disponible;
  const state = data.cross_state;
  const stateStyle = state ? STATE_STYLES[state] : null;

  const change = data.change_24h_pct;
  const changePositive = (change ?? 0) >= 0;

  const crossInfo = data.cross_info;
  const recentCross = crossInfo?.happened === true;
  const crossDir = crossInfo?.direction;

  // Effective price: live tick overrides REST spot_price when present.
  const displayPrice =
    livePrice != null && Number.isFinite(livePrice) ? livePrice : data.spot_price;
  const usingLive =
    tickActive === true && livePrice != null && Number.isFinite(livePrice);

  // Elapsed since last tick — formatted as "hace Ns" or "Nm".
  const elapsedMs =
    usingLive && lastTickAt != null && nowMs != null ? nowMs - lastTickAt : null;

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card/80 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-card animate-card-enter ${
        stateStyle ? `${stateStyle.border} ${stateStyle.glow}` : "border-white/8"
      }`}
      aria-label={`Tarjeta de análisis para ${meta.pair}`}
    >
      {/* Top accent strip colored by state */}
      <div
        className="h-0.5 w-full"
        style={{
          background: stateStyle
            ? `linear-gradient(90deg, transparent, ${stateStyle.accent}, transparent)`
            : "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
        }}
        aria-hidden
      />

      {/* Recent-cross banner */}
      {recentCross && crossDir && (
        <div
          className={`flex items-center justify-center gap-1.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
            crossDir === "bullish"
              ? "bg-[#5fbf8f]/15 text-[#5fbf8f]"
              : "bg-[#e2604f]/15 text-[#e2604f]"
          }`}
        >
          <Zap className="h-3 w-3 animate-pulse" aria-hidden />
          Cruce {crossDir === "bullish" ? "alcista" : "bajista"} · hace{" "}
          {crossInfo?.candles_since_cross} vela(s)
        </div>
      )}

      {/* Bollinger squeeze banner — compressed volatility warning */}
      {data.bollinger_squeeze?.is_squeezed === true && (
        <div className="flex items-center justify-center gap-1.5 bg-[#b48cff]/15 py-1 text-[10px] font-bold uppercase tracking-widest text-[#b48cff]">
          <Activity className="h-3 w-3 animate-pulse" aria-hidden />
          Squeeze · volatilidad comprimida ({data.bollinger_squeeze.bandwidth?.toFixed(2)}%)
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="tnum text-lg font-semibold tracking-tight text-foreground">
              {meta.pair}
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.label}</p>
        </div>
        {stateStyle && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${stateStyle.bg} ${stateStyle.border} ${stateStyle.text}`}
          >
            <stateStyle.icon className="h-3.5 w-3.5" aria-hidden />
            {stateStyle.label}
          </span>
        )}
        {nd.cross_state && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            N/D
          </span>
        )}
      </div>

      {/* Price block */}
      <div className="px-5 pb-3">
        <div className="flex items-end gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>Precio spot · USD</span>
              {usingLive && (
                <span
                  className="inline-flex items-center gap-1 rounded border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-1 py-px text-[9px] font-bold tracking-wider text-[#5fbf8f]"
                  title={`Tick en vivo · ${elapsedMs != null ? `hace ${formatElapsed(elapsedMs)}` : "—"}`}
                >
                  <Radio className="h-2.5 w-2.5 animate-pulse" aria-hidden />
                  TICK
                </span>
              )}
            </div>
            <div
              className={`mt-0.5 text-3xl font-semibold leading-none ${
                nd.spot_price ? "italic text-muted-foreground/60 text-xl" : ""
              }`}
            >
              {nd.spot_price ? (
                <span className="text-muted-foreground/60">Dato no disponible</span>
              ) : (
                <PriceFlash value={displayPrice} live={usingLive} />
              )}
            </div>
            {usingLive && elapsedMs != null && (
              <div className="mt-1 text-[10px] text-muted-foreground/60 tnum">
                tick hace {formatElapsed(elapsedMs)}
              </div>
            )}
          </div>
          <div className="mb-0.5 ml-auto text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              24h
            </div>
            <div
              className={`tnum mt-0.5 text-sm font-medium ${
                nd.change_24h_pct
                  ? "italic text-muted-foreground/60"
                  : changePositive
                    ? "text-[#5fbf8f]"
                    : "text-[#e2604f]"
              }`}
            >
              {nd.change_24h_pct ? "N/D" : fmtPct(data.change_24h_pct)}
            </div>
          </div>
        </div>

        {/* 24h high/low/volume mini-strip */}
        {!nd.high_24h && !nd.low_24h && (
          <div className="mt-2.5 flex items-center justify-between rounded-md border border-white/5 bg-black/15 px-3 py-1.5 text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">L</span>
              <span className="tnum text-[#e2604f]/90">
                ${fmtPrice(data.low_24h)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <BarChart3 className="h-3 w-3" aria-hidden />
              <span className="tnum">{fmtVolume(data.volume_24h_usd)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">H</span>
              <span className="tnum text-[#5fbf8f]/90">
                ${fmtPrice(data.high_24h)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sparkline */}
      <div className="px-5 pb-3">
        <Sparkline
          closes={data.series.closes}
          ema55={data.series.ema55}
          ema200={data.series.ema200}
          bbUpper={data.series.bollinger_upper}
          bbLower={data.series.bollinger_lower}
          spot={displayPrice}
          crossState={data.cross_state}
          height={150}
        />
      </div>

      {/* MACD mini-panel — histogram of last ~40 bars + crossover alerts */}
      <CollapsibleSection
        label="MACD · 12/26/9 · 4h"
        accent="#e8b04b"
        badge={
          data.macd_cross?.happened ? (
            <span className="inline-flex items-center gap-0.5 rounded border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#5fbf8f]">
              <Zap className="h-2.5 w-2.5" aria-hidden />
              Cruce
            </span>
          ) : undefined
        }
      >
        <MacdPanel
          macd={data.macd}
          series={data.series.macd_histogram}
          unavailable={nd.macd}
          macdCross={data.macd_cross}
        />
      </CollapsibleSection>

      {/* Range bar — position of price within S/R with EMA markers */}
      <div className="px-5 pb-3">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          Posición en el rango · S/R
        </div>
        <RangeBar
          spot={displayPrice}
          support={data.support}
          resistance={data.resistance}
          ema55={data.ema55_4h}
          ema200={data.ema200_4h}
          high24h={data.high_24h}
          low24h={data.low_24h}
        />
      </div>

      {/* L2 Order book — bid/ask depth + spread + imbalance */}
      <CollapsibleSection
        label="Order Book · L2"
        accent="#4fa8d8"
        badge={
          depthConnected ? (
            <span className="inline-flex items-center gap-1 rounded border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-1.5 py-0.5 text-[9px] font-medium uppercase text-[#5fbf8f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5fbf8f] live-dot" />
              LIVE
            </span>
          ) : undefined
        }
      >
        <DepthBar
          snapshot={depthSnapshot}
          spotPrice={displayPrice}
          connected={depthConnected === true}
        />
      </CollapsibleSection>

      {/* Metric rows + RSI */}
      <CollapsibleSection label="Indicadores · 4h" accent="#8b96a5">
        <MetricRow
          label="EMA 55 · 4h"
          value={`$${fmtPrice(data.ema55_4h)}`}
          unavailable={nd.ema55_4h}
          color="#e8b04b"
        />
        <MetricRow
          label="EMA 200 · 4h"
          value={`$${fmtPrice(data.ema200_4h)}`}
          unavailable={nd.ema200_4h}
          color="#4fa8d8"
        />
        <MetricRow
          label="Resistencia"
          value={`$${fmtPrice(data.resistance)}`}
          unavailable={nd.resistance}
          color="#e2604f"
        />
        <MetricRow
          label="Soporte"
          value={`$${fmtPrice(data.support)}`}
          unavailable={nd.support}
          color="#5fbf8f"
        />
        <MetricRow
          label="ATR 14 · 4h"
          value={`$${fmtPrice(data.atr_14_4h)}`}
          unavailable={nd.atr_14_4h}
          color="#b48cff"
          hint="Volatilidad (Average True Range)"
        />
        <MetricRow
          label="Bollinger BW"
          value={data.bollinger?.bandwidth != null ? `${data.bollinger.bandwidth.toFixed(2)}%` : "—"}
          unavailable={nd.bollinger}
          color="#b48cff"
          hint="Ancho de banda (squeeze < 3%)"
        />
        {/* RSI gauge (own row, richer) */}
        <RsiGauge
          rsi={data.rsi_14_4h}
          unavailable={nd.rsi_14_4h}
          series={data.series.rsi}
        />
      </CollapsibleSection>

      {/* Structure text */}
      <div className="mt-auto border-t border-white/5 bg-white/[0.015] p-5">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          Estructura de mercado
        </div>
        <p className="text-xs leading-relaxed text-foreground/80">
          {data.structure_text}
        </p>

        {/* ATR-based stop loss suggestion */}
        {data.stop_loss_suggestion && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-[#b48cff]/20 bg-[#b48cff]/5 px-2.5 py-1.5">
            <span className="text-[9px] uppercase tracking-wider text-[#b48cff]">
              Stop ATR
            </span>
            <span className="tnum text-[11px] font-medium text-foreground/90">
              ${fmtPrice(data.stop_loss_suggestion.price)}
            </span>
            <span className="text-[9px] text-muted-foreground">
              ({data.stop_loss_suggestion.direction === "long" ? "largo" : "corto"} · {data.stop_loss_suggestion.multiplier}× ATR)
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground/60">
          <span className="tnum">
            {new Date(data.updated_at).toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZone: "UTC",
            })}{" "}
            UTC
          </span>
          <span>Binance · 4h klines</span>
        </div>
      </div>
    </article>
  );
}
