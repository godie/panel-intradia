"use client";

import { useEffect, useState } from "react";
import { Sparkline } from "./sparkline";
import { getSymbolMeta, type AnalysisResponse } from "@/lib/types";
import { useLanguage } from "@/hooks/use-language";
import {
  X,
  TrendingUp,
  TrendingDown,
  Minimize2,
  Activity,
  Zap,
  BarChart3,
  Loader2,
  History,
  Radio,
} from "lucide-react";

type Props = {
  /** The symbol to render. May be null when closed. */
  symbol: string | null;
  /** The cached analysis payload for this symbol (from page.tsx's cells map). */
  data: AnalysisResponse | null;
  open: boolean;
  onClose: () => void;
};

type CrossEventType = "ema" | "macd" | "momentum";
type CrossDirection = "bullish" | "bearish";

type CrossEvent = {
  id: string;
  symbol: string;
  type: CrossEventType;
  direction: CrossDirection;
  price: number;
  candlesAgo: number;
  detectedAt: string;
};

type CrossHistoryResponse = {
  events: CrossEvent[];
};

const TYPE_META: Record<
  CrossEventType,
  { short: string; color: string; icon: typeof Zap }
> = {
  ema: { short: "EMA", color: "#4fa8d8", icon: Activity },
  macd: { short: "MACD", color: "#e8b04b", icon: Zap },
  momentum: { short: "MOM", color: "#b48cff", icon: TrendingUp },
};

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000)
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
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

function fmtTrades(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

const STATE_STYLES: Record<
  NonNullable<AnalysisResponse["cross_state"]>,
  { label: string; text: string; bg: string; border: string; icon: typeof TrendingUp }
> = {
  ALCISTA: {
    label: "card.stateAlcista",
    text: "text-[#5fbf8f]",
    bg: "bg-[#5fbf8f]/12",
    border: "border-[#5fbf8f]/30",
    icon: TrendingUp,
  },
  BAJISTA: {
    label: "card.stateBajista",
    text: "text-[#e2604f]",
    bg: "bg-[#e2604f]/12",
    border: "border-[#e2604f]/30",
    icon: TrendingDown,
  },
  COMPRIMIDO: {
    label: "card.stateComprimido",
    text: "text-[#e8b04b]",
    bg: "bg-[#e8b04b]/12",
    border: "border-[#e8b04b]/30",
    icon: Minimize2,
  },
};

/**
 * TickerDetailModal — full breakdown of every indicator we compute for a
 * single symbol. Opened from the AssetCard's "Details" button.
 *
 * Layout:
 *  - Header: pair + spot price + 24h change + state badge + source
 *  - Large sparkline (h-48) with EMA55/EMA200/Bollinger/VWAP/Ichimoku overlays
 *  - "All indicators" grid (EMA, MACD, RSI, ATR, Bollinger, VWAP, Stoch, Ichimoku, S/R)
 *  - Fibonacci levels list
 *  - Structure text paragraph
 *  - Recent cross events fetched from /api/cross-history?symbol=X&limit=10
 */
export function TickerDetailModal({ symbol, data, open, onClose }: Props) {
  const { t } = useLanguage();
  const [crosses, setCrosses] = useState<CrossEvent[]>([]);
  const [crossesLoading, setCrossesLoading] = useState(false);
  const [crossesError, setCrossesError] = useState<string | null>(null);
  // Track previous `symbol` so we can reset the cross-history state
  // synchronously during render when the symbol changes. This is React's
  // recommended "adjust state during render" pattern (avoids the
  // set-state-in-effect lint rule).
  const [prevSymbol, setPrevSymbol] = useState<string | null>(symbol);
  if (symbol !== prevSymbol) {
    setPrevSymbol(symbol);
    setCrosses([]);
    setCrossesError(null);
    setCrossesLoading(!!symbol);
  }

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Fetch recent cross events for this symbol whenever it changes.
  useEffect(() => {
    if (!open || !symbol) return;
    let aborted = false;
    fetch(`/api/cross-history?symbol=${symbol}&limit=10`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as CrossHistoryResponse;
        if (!aborted) {
          setCrosses(json.events ?? []);
          setCrossesError(null);
        }
      })
      .catch((err) => {
        if (!aborted) {
          setCrosses([]);
          setCrossesError(err instanceof Error ? err.message : "Error");
        }
      })
      .finally(() => {
        if (!aborted) setCrossesLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [open, symbol]);

  if (!open || !symbol) return null;

  const meta = getSymbolMeta(symbol);
  // `data?.no_disponible` is undefined when data is null (loading state).
  // Use a partial default so `nd.X` accesses return `undefined` (falsy) instead
  // of throwing — every usage is wrapped in `!!` or a ternary so this is safe.
  const nd = (data?.no_disponible ?? {}) as Partial<
    AnalysisResponse["no_disponible"]
  >;
  const state = data?.cross_state;
  const stateStyle = state ? STATE_STYLES[state] : null;
  const change = data?.change_24h_pct ?? null;
  const changePositive = (change ?? 0) >= 0;
  const spot = data?.spot_price ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-card-enter p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("ticker.detailTitle").replace("{symbol}", meta.pair)}
    >
      <div
        className="relative w-full max-w-3xl max-h-[94vh] overflow-hidden rounded-xl border border-white/10 bg-card shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/8 p-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/8 bg-black/20">
              <BarChart3 className="h-5 w-5 text-[#4fa8d8]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {t("ticker.detailTitle").replace("{symbol}", meta.pair)}
              </h3>
              <p className="text-[11px] text-muted-foreground truncate">
                {meta.label} · {data ? new Date(data.updated_at).toLocaleString("es-ES", { timeZone: "UTC" }) + " UTC" : "—"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8] shrink-0"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto scroll-thin">
          {!data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("common.loading")}…
            </div>
          ) : (
            <div className="space-y-5 p-4">
              {/* Spot price + 24h change */}
              <div className="flex items-end justify-between gap-4 rounded-lg border border-white/8 bg-black/20 px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t("card.spotPrice")}
                  </div>
                  <div className="tnum text-3xl font-semibold leading-none text-foreground mt-1">
                    {nd?.spot_price ? (
                      <span className="text-muted-foreground/60 text-xl italic">{t("card.notAvailable")}</span>
                    ) : (
                      `$${fmtPrice(spot)}`
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {t("card.change24h")}
                  </div>
                  <div
                    className={`tnum mt-1 text-lg font-medium ${
                      nd?.change_24h_pct
                        ? "italic text-muted-foreground/60"
                        : changePositive
                          ? "text-[#5fbf8f]"
                          : "text-[#e2604f]"
                    }`}
                  >
                    {nd?.change_24h_pct ? "N/D" : fmtPct(change)}
                  </div>
                </div>
                {stateStyle && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${stateStyle.bg} ${stateStyle.border} ${stateStyle.text}`}
                  >
                    <stateStyle.icon className="h-3.5 w-3.5" aria-hidden />
                    {t(stateStyle.label)}
                  </span>
                )}
              </div>

              {/* Larger sparkline with all overlays */}
              <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-4">
                <Sparkline
                  closes={data.series.closes}
                  ema55={data.series.ema55}
                  ema200={data.series.ema200}
                  bbUpper={data.series.bollinger_upper}
                  bbLower={data.series.bollinger_lower}
                  vwap={data.series.vwap}
                  ichimokuSenkouA={data.series.ichimoku_senkou_a}
                  ichimokuSenkouB={data.series.ichimoku_senkou_b}
                  ichimokuTenkan={data.series.ichimoku_tenkan}
                  ichimokuKijun={data.series.ichimoku_kijun}
                  spot={spot}
                  crossState={data.cross_state}
                  height={192}
                />
              </div>

              {/* All indicators grid */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <Activity className="h-3 w-3" aria-hidden />
                  {t("ticker.allIndicators")}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <DetailMetric label={`${t("card.ema55")} · 4h`} value={`$${fmtPrice(data.ema55_4h)}`} unavailable={!!nd.ema55_4h} color="#e8b04b" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.ema200")} · 4h`} value={`$${fmtPrice(data.ema200_4h)}`} unavailable={!!nd.ema200_4h} color="#4fa8d8" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric
                    label={t("card.rsi")}
                    value={data.rsi_14_4h != null ? data.rsi_14_4h.toFixed(2) : "—"}
                    unavailable={!!nd.rsi_14_4h}
                    color={data.rsi_14_4h != null && data.rsi_14_4h >= 70 ? "#e2604f" : data.rsi_14_4h != null && data.rsi_14_4h <= 30 ? "#5fbf8f" : "#8b96a5"}
                    notAvailableLabel={t("card.notAvailable")}
                  />
                  <DetailMetric label={t("card.atr")} value={`$${fmtPrice(data.atr_14_4h)}`} unavailable={!!nd.atr_14_4h} color="#b48cff" hint={t("card.atrHint")} notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={t("card.resistance")} value={`$${fmtPrice(data.resistance)}`} unavailable={!!nd.resistance} color="#e2604f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={t("card.support")} value={`$${fmtPrice(data.support)}`} unavailable={!!nd.support} color="#5fbf8f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.macdSignal")}`} value={`$${fmtPrice(data.macd.line)}`} unavailable={!!nd.macd} color="#e8b04b" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Signal" value={`$${fmtPrice(data.macd.signal)}`} unavailable={!!nd.macd} color="#e8b04b" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Histogram" value={`$${fmtPrice(data.macd.histogram)}`} unavailable={!!nd.macd} color={data.macd.histogram != null && data.macd.histogram >= 0 ? "#5fbf8f" : "#e2604f"} notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.bollinger")} U`} value={`$${fmtPrice(data.bollinger.upper)}`} unavailable={!!nd.bollinger} color="#b48cff" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.bollinger")} M`} value={`$${fmtPrice(data.bollinger.middle)}`} unavailable={!!nd.bollinger} color="#b48cff" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.bollinger")} L`} value={`$${fmtPrice(data.bollinger.lower)}`} unavailable={!!nd.bollinger} color="#b48cff" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={t("card.bollingerBw")} value={data.bollinger.bandwidth != null ? `${data.bollinger.bandwidth.toFixed(2)}%` : "—"} unavailable={!!nd.bollinger} color="#b48cff" hint={t("card.bollingerBwHint")} notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={t("card.vwapLabel")} value={`$${fmtPrice(data.vwap_20_4h)}`} unavailable={!!nd.vwap_20_4h} color="#5fbf8f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.stochastic")} %K`} value={data.stochastic.k != null ? data.stochastic.k.toFixed(2) : "—"} unavailable={!!nd.stochastic} color="#e8b04b" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label={`${t("card.stochastic")} %D`} value={data.stochastic.d != null ? data.stochastic.d.toFixed(2) : "—"} unavailable={!!nd.stochastic} color="#e8b04b" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Tenkan-sen" value={`$${fmtPrice(data.ichimoku.tenkan)}`} unavailable={!!nd.ichimoku} color="#5fbf8f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Kijun-sen" value={`$${fmtPrice(data.ichimoku.kijun)}`} unavailable={!!nd.ichimoku} color="#4fa8d8" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Senkou A" value={`$${fmtPrice(data.ichimoku.senkou_a)}`} unavailable={!!nd.ichimoku} color="#5fbf8f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Senkou B" value={`$${fmtPrice(data.ichimoku.senkou_b)}`} unavailable={!!nd.ichimoku} color="#e2604f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric
                    label="Cloud"
                    value={
                      data.ichimoku.cloud_color === "bullish"
                        ? "Bullish"
                        : data.ichimoku.cloud_color === "bearish"
                          ? "Bearish"
                          : "Neutral"
                    }
                    unavailable={!!nd.ichimoku}
                    color={
                      data.ichimoku.cloud_color === "bullish"
                        ? "#5fbf8f"
                        : data.ichimoku.cloud_color === "bearish"
                          ? "#e2604f"
                          : "#e8b04b"
                    }
                    notAvailableLabel={t("card.notAvailable")}
                  />
                  <DetailMetric
                    label="Price vs cloud"
                    value={
                      data.ichimoku.price_vs_cloud === "above"
                        ? t("card.ichimokuAbove")
                        : data.ichimoku.price_vs_cloud === "below"
                          ? t("card.ichimokuBelow")
                          : data.ichimoku.price_vs_cloud === "inside"
                            ? t("card.ichimokuInside")
                            : "—"
                    }
                    unavailable={!!nd.ichimoku}
                    color={
                      data.ichimoku.cloud_color === "bullish"
                        ? "#5fbf8f"
                        : data.ichimoku.cloud_color === "bearish"
                          ? "#e2604f"
                          : "#e8b04b"
                    }
                    notAvailableLabel={t("card.notAvailable")}
                  />
                  <DetailMetric label="Volume 24h" value={fmtVolume(data.volume_24h_usd)} unavailable={!!nd.volume_24h_usd} color="#8b96a5" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Trades 24h" value={fmtTrades(data.trades_24h)} unavailable={!!nd.volume_24h_usd} color="#8b96a5" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="High 24h" value={`$${fmtPrice(data.high_24h)}`} unavailable={!!nd.high_24h} color="#5fbf8f" notAvailableLabel={t("card.notAvailable")} />
                  <DetailMetric label="Low 24h" value={`$${fmtPrice(data.low_24h)}`} unavailable={!!nd.low_24h} color="#e2604f" notAvailableLabel={t("card.notAvailable")} />
                </div>
              </div>

              {/* Fibonacci levels */}
              {data.fibonacci && !nd.fibonacci && (
                <div>
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("card.fibonacci")}
                    {data.fibonacci.direction && (
                      <span className="ml-2 text-muted-foreground/60">
                        {data.fibonacci.direction === "up" ? t("card.fibUptrend") : t("card.fibDowntrend")}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {data.fibonacci.levels.map((l) => (
                      <div
                        key={l.label}
                        className="flex items-center justify-between rounded-md border border-white/5 bg-black/15 px-2.5 py-1.5"
                      >
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          {l.label}
                        </span>
                        <span className="tnum text-xs font-medium text-foreground">
                          ${fmtPrice(l.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {data.fibonacci.extensions.length > 0 && (
                    <div className="mt-2">
                      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        {t("card.fibExtensions")}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {data.fibonacci.extensions.map((l) => (
                          <div
                            key={l.label}
                            className="flex items-center justify-between rounded-md border border-white/5 bg-black/15 px-2.5 py-1.5"
                          >
                            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              {l.label}
                            </span>
                            <span className="tnum text-xs font-medium text-foreground">
                              ${fmtPrice(l.price)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Structure text */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t("card.structure")}
                </div>
                <p className="rounded-md border border-white/5 bg-black/15 px-3 py-2.5 text-xs leading-relaxed text-foreground/80">
                  {data.structure_text}
                </p>
              </div>

              {/* Recent crosses */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <History className="h-3 w-3" aria-hidden />
                  {t("ticker.recentCrosses")}
                </div>
                {crossesLoading && (
                  <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {t("common.loading")}…
                  </div>
                )}
                {crossesError && (
                  <div className="py-2 text-xs text-[#e2604f]">Error: {crossesError}</div>
                )}
                {!crossesLoading && !crossesError && crosses.length === 0 && (
                  <div className="py-2 text-xs text-muted-foreground/60">
                    {t("ticker.noCrosses")}
                  </div>
                )}
                {!crossesLoading && !crossesError && crosses.length > 0 && (
                  <ul className="space-y-1.5">
                    {crosses.map((ev) => {
                      const tm = TYPE_META[ev.type];
                      const Icon = tm.icon;
                      const bullish = ev.direction === "bullish";
                      const dirColor = bullish ? "#5fbf8f" : "#e2604f";
                      const DirIcon = bullish ? TrendingUp : TrendingDown;
                      return (
                        <li
                          key={ev.id}
                          className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/15 px-3 py-2"
                        >
                          <div
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                            style={{ borderColor: `${tm.color}40`, background: `${tm.color}12` }}
                          >
                            <Icon className="h-3.5 w-3.5" style={{ color: tm.color }} aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: tm.color }}>
                                {tm.short}
                              </span>
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wider" style={{ color: dirColor }}>
                                <DirIcon className="h-3 w-3" aria-hidden />
                                {bullish ? t("market.bullish") : t("market.bearish")}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                              <span className="tnum">@ ${fmtPrice(ev.price)}</span>
                              <span>·</span>
                              <span>vela {ev.candlesAgo}</span>
                              <span>·</span>
                              <span>{fmtRelative(ev.detectedAt)}</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Footer — updated timestamp */}
              <div className="flex items-center justify-between border-t border-white/5 pt-3 text-[10px] text-muted-foreground/60">
                <span className="tnum">
                  {new Date(data.updated_at).toLocaleString("es-ES", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </span>
                {data.source && (
                  <span className="inline-flex items-center gap-1.5">
                    <Radio className="h-3 w-3" aria-hidden />
                    {data.source}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * DetailMetric — single key/value cell in the indicators grid.
 * Mirrors the AssetCard's MetricRow but compacted to a fixed-height tile
 * so the 2/3-column grid stays aligned.
 */
function DetailMetric({
  label,
  value,
  unavailable,
  color,
  hint,
  notAvailableLabel,
}: {
  label: string;
  value: string;
  unavailable: boolean;
  color?: string;
  hint?: string;
  notAvailableLabel: string;
}) {
  return (
    <div className="rounded-md border border-white/5 bg-black/15 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        {color && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: color }}
            aria-hidden
          />
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <div
        className={`tnum mt-0.5 text-sm font-medium ${unavailable ? "italic text-muted-foreground/60 text-xs" : ""}`}
        style={unavailable ? undefined : color ? { color } : undefined}
        title={hint}
      >
        {unavailable ? notAvailableLabel : value}
      </div>
      {hint && !unavailable && (
        <div className="text-[9px] text-muted-foreground/60 truncate">{hint}</div>
      )}
    </div>
  );
}
