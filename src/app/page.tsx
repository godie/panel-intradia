"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AssetCard } from "@/components/panel/asset-card";
import { TimeframeSelector } from "@/components/panel/timeframe-selector";
import { TickerTape } from "@/components/panel/ticker-tape";
import { MarketSummary } from "@/components/panel/market-summary";
import { CrossHistory } from "@/components/panel/cross-history";
import { MarketOverview } from "@/components/panel/market-overview";
import { AddTickerModal } from "@/components/panel/add-ticker-modal";
import { TickerDetailModal } from "@/components/panel/ticker-detail-modal";
import { getSymbolMeta, type AnalysisResponse } from "@/lib/types";
import {
  DEFAULT_TIMEFRAME,
  TF_MAP_STORAGE_KEY,
  parseTimeframeMap,
  serializeTimeframeMap,
  type Timeframe,
} from "@/lib/timeframes";
import { useLocalStorageString } from "@/hooks/use-local-storage";
import {
  DEFAULT_WATCHLIST,
  loadWatchlist,
  addSymbol,
  removeSymbol,
} from "@/lib/symbol-manager";
import {
  useTickStream,
  clearTickPriceGlobal,
} from "@/hooks/use-tick-stream";
import { useOrderBook } from "@/hooks/use-order-book";
import { useCrossAlerts } from "@/hooks/use-cross-alerts";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useStrategyAlerts } from "@/hooks/use-strategy-alerts";
import { exportSnapshot } from "@/lib/export-snapshot";
import { KeyboardHelpModal } from "@/components/panel/keyboard-help-modal";
import { PriceAlertsButton } from "@/components/panel/price-alerts-button";
import { LanguageSelector } from "@/components/panel/language-selector";
import { useLanguage } from "@/hooks/use-language";
import {
  RefreshCw,
  Radio,
  AlertTriangle,
  Clock,
  Wifi,
  WifiOff,
  Download,
  Keyboard,
  Plus,
  ArrowLeftRight,
  Activity,
} from "lucide-react";

const REFRESH_MS = 60_000;
type Cell = { loading: boolean; error: string | null; data: AnalysisResponse | null };

const initialCell: Cell = { loading: true, error: null, data: null };

/** The comparison page's default preset. */
const COMPARE_HREF = "/comparar?preset=4h-1d";

/** Cells and in-flight fetches are keyed "SYMBOL:tf" so one symbol can be
 *  rendered on two different timeframes at once. Symbols never contain ":". */
function cellKey(symbol: string, tf: Timeframe): string {
  return `${symbol}:${tf}`;
}

/** Aggregates (ticker tape, market summary/overview, strategy alerts) are
 *  always computed on this interval so they stay comparable across cards. */
const AGGREGATE_TF: Timeframe = DEFAULT_TIMEFRAME;

/**
 * Every cell that must be loaded: the aggregate interval for each symbol (the
 * aggregates always need it) plus the interval the user picked for that symbol.
 * With every card on the default this is exactly one key per symbol.
 */
function visibleCellKeys(
  symbols: string[],
  tfMap: Record<string, Timeframe>,
): string[] {
  const keys = new Set<string>();
  for (const s of symbols) {
    keys.add(cellKey(s, AGGREGATE_TF));
    keys.add(cellKey(s, tfMap[s] ?? DEFAULT_TIMEFRAME));
  }
  return [...keys];
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
    });
  } catch {
    return "—";
  }
}

export default function Page() {
  const { t } = useLanguage();
  const router = useRouter();
  // Dynamic watchlist — the initial state MUST be the same on the server and
  // on the first client render, so it cannot read localStorage (SSR has none).
  // We start from the default list and swap in the stored one after mount.
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_WATCHLIST);
  const [cells, setCells] = useState<Record<string, Cell>>(() =>
    Object.fromEntries(
      DEFAULT_WATCHLIST.map((s) => [
        cellKey(s, DEFAULT_TIMEFRAME),
        { ...initialCell },
      ]),
    ),
  );
  // Per-symbol timeframe, persisted as ONE JSON map. `useLocalStorageString` is
  // hydration-safe (useSyncExternalStore) and a single key is required because
  // hooks cannot be called inside `symbols.map()`.
  const [tfMapRaw, setTfMapRaw] = useLocalStorageString(TF_MAP_STORAGE_KEY, "{}");
  const tfMap = useMemo(() => parseTimeframeMap(tfMapRaw), [tfMapRaw]);
  const tfFor = (symbol: string): Timeframe => tfMap[symbol] ?? DEFAULT_TIMEFRAME;
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(REFRESH_MS / 1000);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [helpOpen, setHelpOpen] = useState(false);
  const [addTickerOpen, setAddTickerOpen] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Live tick stream — shared singleton socket.
  const tick = useTickStream();
  const book = useOrderBook();
  const priceAlerts = usePriceAlerts(tick.prices);
  useCrossAlerts();
  useKeyboardShortcuts({
    onRefresh: () => fetchAllRef.current?.(true),
    onToggleHelp: () => setHelpOpen((v) => !v),
  });

  // Keep a ref of the current symbol list so the (stable) fetchAll callback
  // can read the latest list without re-creating itself on every change.
  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;
  const tfMapRef = useRef(tfMap);
  tfMapRef.current = tfMap;

  const fetchAll = useCallback(async (manual: boolean) => {
    // Cancel any in-flight fetch.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const keys = visibleCellKeys(symbolsRef.current, tfMapRef.current);
    if (manual) setRefreshing(true);
    // Mark loading only for manual refresh so auto-refresh doesn't flash skeletons.
    if (manual) {
      setCells((prev) => {
        const next: Record<string, Cell> = {};
        for (const key of keys) {
          next[key] = prev[key]?.data
            ? { ...prev[key], loading: true }
            : { loading: true, error: null, data: null };
        }
        return next;
      });
    }

    await Promise.all(
      keys.map(async (key) => {
        const [symbol, tf] = key.split(":") as [string, Timeframe];
        try {
          const res = await fetch(`/api/analysis?symbol=${symbol}&tf=${tf}`, {
            signal: ac.signal,
            cache: "no-store",
          });
          if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try {
              const body = await res.json();
              if (body?.error) msg = body.error;
            } catch {
              /* ignore */
            }
            throw new Error(msg);
          }
          const data = (await res.json()) as AnalysisResponse;
          if (ac.signal.aborted) return;
          setCells((prev) => ({
            ...prev,
            [key]: { loading: false, error: null, data },
          }));
          // Clear the live tick price so the freshly-fetched REST spot_price
          // takes over until the next tick arrives (which then re-flashes).
          clearTickPriceGlobal(symbol);
        } catch (err) {
          if (ac.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Error desconocido";
          setCells((prev) => ({
            ...prev,
            [key]: { loading: false, error: msg, data: prev[key]?.data ?? null },
          }));
        }
      }),
    );

    if (!ac.signal.aborted) {
      setLastUpdated(new Date().toISOString());
      setCountdown(REFRESH_MS / 1000);
    }
    if (manual) setRefreshing(false);
  }, []);

  // Keep a ref to fetchAll so the keyboard shortcuts hook can call it without
  // stale closure issues.
  const fetchAllRef = useRef(fetchAll);
  fetchAllRef.current = fetchAll;

  // Initial fetch.
  useEffect(() => {
    fetchAll(false);
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  // Auto-refresh every 60s.
  useEffect(() => {
    const id = setInterval(() => fetchAll(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Countdown ticker (every second) + a "now" reference for elapsed-tick display.
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => (c <= 1 ? REFRESH_MS / 1000 : c - 1));
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // After mount, adopt the watchlist persisted in localStorage. Deferred to an
  // effect so the first client render still matches the SSR HTML.
  useEffect(() => {
    setSymbols(loadWatchlist());
  }, []);

  // When the watchlist or any card's timeframe changes, reconcile the cells
  // map: seed the visible keys that are missing, drop cells for symbols that
  // left the watchlist, and refetch. Cells for other timeframes of a symbol
  // that is still listed are KEPT — the aggregates read the 4h ones.
  useEffect(() => {
    setCells((prev) => {
      const next: Record<string, Cell> = { ...prev };
      for (const key of visibleCellKeys(symbols, tfMap)) {
        next[key] = next[key] ?? { ...initialCell };
      }
      for (const key of Object.keys(next)) {
        if (!symbols.includes(key.split(":")[0])) delete next[key];
      }
      return next;
    });
    // Refetch so newly visible cells get data.
    fetchAll(false);
  }, [symbols, tfMap, fetchAll]);

  // Aggregates are always 4h (see AGGREGATE_TF) so they stay comparable no
  // matter which timeframe each card is showing.
  const tickerItems = symbols.map((s) => cells[cellKey(s, AGGREGATE_TF)]?.data ?? null);
  // Strategy alerts — fire toasts when strategy transitions WAIT→BUY/SHORT.
  useStrategyAlerts(tickerItems.filter((i): i is AnalysisResponse => i != null), "trend_buy");
  const anyLoading = symbols.some((s) => cells[cellKey(s, tfFor(s))]?.loading);
  const anyError = symbols.some((s) => cells[cellKey(s, tfFor(s))]?.error);

  // Connection indicator state:
  //  - live (green pulsing "TICK LIVE") when socket connected AND binance upstream live
  //  - connecting (amber "CONECTANDO") when socket connected but binance not yet live
  //  - offline (red "OFFLINE") when socket disconnected
  const connState: "live" | "connecting" | "offline" = !tick.connected
    ? "offline"
    : tick.binanceLive
      ? "live"
      : "connecting";

  const connMeta = {
    live: {
      label: "TICK LIVE",
      color: "#5fbf8f",
      Icon: Radio,
    },
    connecting: {
      label: "CONECTANDO",
      color: "#e8b04b",
      Icon: Wifi,
    },
    offline: {
      label: "OFFLINE",
      color: "#e2604f",
      Icon: WifiOff,
    },
  }[connState];

  return (
    <div className="relative flex min-h-screen flex-col bg-background terminal-grid">
      {/* Scanline overlay — purely decorative, pointer-events-none. */}
      <div className="terminal-scanlines pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TickerTape items={tickerItems} />

        {/* Header. Deliberately NO `backdrop-blur`/`filter`/`transform` here:
            `backdrop-filter` creates a stacking context AND a containing block
            for fixed-position descendants. That trapped the language dropdown's
            z-50 behind the cards and made the alerts modal (`fixed inset-0`,
            rendered inside this header) resolve against the header's box
            instead of the viewport, so it appeared crammed at the top. */}
        <header className="border-b border-white/5 bg-card/40">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#4fa8d8]/30 bg-[#4fa8d8]/10">
                <Radio className="h-5 w-5 text-[#4fa8d8]" aria-hidden />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {t("header.title")}{" "}
                  <span className="text-muted-foreground">{t("header.subtitle")}</span>
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("header.description")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Live tick connection indicator */}
              <div
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors duration-300"
                style={{
                  borderColor: `${connMeta.color}55`,
                  backgroundColor: `${connMeta.color}12`,
                }}
                title={
                  connState === "live"
                    ? `Ticks en vivo · ${tick.tickCount} recibidos · último heartbeat ${tick.lastHeartbeat ? new Date(tick.lastHeartbeat).toLocaleTimeString("es-ES") : "—"}`
                    : connState === "connecting"
                      ? "Socket conectado, esperando upstream de Binance…"
                      : "Socket desconectado — reintentando…"
                }
              >
                <span className="relative flex h-2 w-2">
                  {connState === "live" && (
                    <span
                      className="absolute inline-flex h-2 w-2 rounded-full"
                      style={{
                        background: connMeta.color,
                        animation: "live-pulse 1.8s ease-in-out infinite",
                      }}
                    />
                  )}
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full transition-colors duration-300"
                    style={{ background: connMeta.color }}
                  />
                </span>
                <connMeta.Icon
                  className="h-3.5 w-3.5 transition-colors duration-300"
                  style={{ color: connMeta.color }}
                  aria-hidden
                />
                <span
                  className="text-xs font-semibold tracking-wider transition-colors duration-300"
                  style={{ color: connMeta.color }}
                >
                  {connMeta.label}
                </span>
              </div>

              {tick.source && (
                <div
                  className="flex items-center gap-2 rounded-md border border-white/8 bg-black/20 px-3 py-1.5 text-xs"
                  title={`Proveedor upstream activo: ${tick.source}`}
                >
                  <span className="text-muted-foreground">{t("header.source")}:</span>
                  <span className="font-semibold uppercase tracking-wider">{t(`header.source${tick.source[0].toUpperCase()}${tick.source.slice(1)}` as "header.sourceBinance" | "header.sourceBybit")}</span>
                </div>
              )}

              <div className="flex items-center gap-1.5 rounded-md border border-white/8 bg-black/20 px-3 py-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                <span className="tnum">{fmtTime(lastUpdated)}</span>
                <span className="text-muted-foreground/50">UTC</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="tnum tabular-nums">
                  pr&oacute;x. {String(countdown).padStart(2, "0")}s
                </span>
              </div>

              <button
                type="button"
                onClick={() => fetchAll(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-md border border-[#4fa8d8]/30 bg-[#4fa8d8]/10 px-3.5 py-1.5 text-xs font-medium text-[#4fa8d8] transition-colors hover:bg-[#4fa8d8]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t("header.refreshAria")}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  aria-hidden
                />
                {refreshing ? t("header.refreshing") : t("header.refresh")}
              </button>

              <button
                type="button"
                onClick={() => setAddTickerOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-[#5fbf8f]/30 bg-[#5fbf8f]/10 px-3 py-1.5 text-xs font-medium text-[#5fbf8f] transition-colors hover:bg-[#5fbf8f]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5fbf8f]"
                aria-label={t("ticker.add")}
                title={t("ticker.addDesc")}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("ticker.add")}</span>
              </button>

              <button
                type="button"
                onClick={() => exportSnapshot(tickerItems.filter((i): i is AnalysisResponse => i != null))}
                className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
                aria-label={t("header.export")}
                title={t("header.exportAria")}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("header.export")}</span>
              </button>

              <Link
                href={COMPARE_HREF}
                className="inline-flex items-center gap-2 rounded-md border border-[#b48cff]/30 bg-[#b48cff]/10 px-3 py-1.5 text-xs font-medium text-[#b48cff] transition-colors hover:bg-[#b48cff]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b48cff]"
                aria-label={t("compare.button")}
                title={t("compare.title")}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("compare.button")}</span>
              </Link>

              <Link
                href="/status"
                className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
                aria-label={t("status.title")}
                title={t("status.subtitle")}
              >
                <Activity className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("status.title")}</span>
              </Link>

              <PriceAlertsButton
                alerts={priceAlerts.alerts}
                onAdd={priceAlerts.addAlert}
                onRemove={priceAlerts.removeAlert}
                onClearTriggered={priceAlerts.clearTriggered}
                livePrices={tick.prices}
              />

              <LanguageSelector />

              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="hidden items-center gap-1 rounded-md border border-white/8 bg-black/20 px-2.5 py-1.5 text-[10px] text-muted-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-[#4fa8d8] md:inline-flex"
                title={t("header.shortcutsAria")}
                aria-label={t("header.shortcuts")}
              >
                <Keyboard className="h-3 w-3" aria-hidden />
                {t("header.shortcuts")}
              </button>
            </div>
          </div>

          {/* Status strip */}
          {(anyLoading || anyError) && (
            <div className="border-t border-white/5 bg-black/20">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1.5 text-[11px] text-muted-foreground sm:px-6 lg:px-8">
                {anyLoading && (
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
                    {t("common.synchronizing")}
                  </span>
                )}
                {symbols.filter((s) => cells[s]?.error).map((s) => (
                  <span
                    key={s}
                    className="flex items-center gap-1.5 text-[#e2604f]"
                    title={cells[s]?.error ?? ""}
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {getSymbolMeta(s).asset}: {cells[cellKey(s, tfFor(s))]?.error}
                  </span>
                ))}
              </div>
            </div>
          )}
        </header>

        {/* Market summary strip — aggregate sentiment, always on AGGREGATE_TF */}
        {tickerItems.some((i) => i != null) && (
          <div className="border-b border-white/5 bg-black/15">
            <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
              <span className="shrink-0 rounded border border-white/8 bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("tf.4h")}
              </span>
              <div className="min-w-0 flex-1">
                <MarketSummary items={tickerItems.filter((i): i is AnalysisResponse => i != null)} />
              </div>
            </div>
          </div>
        )}

        {/* Main grid */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {symbols.map((symbol) => {
              const tf = tfFor(symbol);
              const cell = cells[cellKey(symbol, tf)] ?? { ...initialCell };
              const meta = getSymbolMeta(symbol);
              if (cell.error && !cell.data) {
                return (
                  <article
                    key={symbol}
                    className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-[#e2604f]/30 bg-card/60 p-8 text-center"
                  >
                    <AlertTriangle className="h-8 w-8 text-[#e2604f]" aria-hidden />
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        {meta.pair}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        No se pudo cargar el análisis.
                      </p>
                    </div>
                    <p className="max-w-xs text-xs text-[#e2604f]/80">{cell.error}</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fetchAll(true)}
                        className="mt-2 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-foreground hover:bg-white/10"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        {t("common.retry")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (symbols.length <= 1) return;
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              t("ticker.removeConfirm").replace("{symbol}", symbol),
                            )
                          )
                            return;
                          setSymbols((prev) => removeSymbol(prev, symbol));
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#e2604f]/30 bg-[#e2604f]/10 px-2.5 py-1.5 text-[11px] text-[#e2604f] hover:bg-[#e2604f]/20"
                        title={t("ticker.remove")}
                      >
                        {t("ticker.remove")}
                      </button>
                    </div>
                  </article>
                );
              }
              if (!cell.data) {
                // Skeleton
                return (
                  <article
                    key={symbol}
                    className="flex min-h-[420px] animate-pulse flex-col gap-4 rounded-xl border border-white/8 bg-card/40 p-5"
                    aria-busy="true"
                    aria-label={`Cargando ${meta.pair}`}
                  >
                    <div className="h-6 w-32 rounded bg-white/5" />
                    <div className="h-10 w-48 rounded bg-white/5" />
                    <div className="h-[150px] w-full rounded bg-white/5" />
                    <div className="space-y-3">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex justify-between">
                          <div className="h-4 w-20 rounded bg-white/5" />
                          <div className="h-4 w-28 rounded bg-white/5" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto h-16 w-full rounded bg-white/5" />
                  </article>
                );
              }
              const tickPrice = tick.prices[symbol];
              const livePrice = tickPrice?.price ?? null;
              const lastTickAt = tickPrice?.time ?? null;
              return (
                <AssetCard
                  key={symbol}
                  data={cell.data}
                  timeframe={tf}
                  onTimeframeChange={(next) =>
                    setTfMapRaw(serializeTimeframeMap({ ...tfMap, [symbol]: next }))
                  }
                  onCompare={() => router.push(COMPARE_HREF)}
                  livePrice={livePrice}
                  tickActive={tick.connected && tick.binanceLive}
                  lastTickAt={lastTickAt}
                  nowMs={nowMs}
                  depthSnapshot={book.snapshots[symbol]}
                  depthConnected={book.connected && book.binanceLive}
                  onRemove={
                    symbols.length > 1
                      ? () => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(
                              t("ticker.removeConfirm").replace("{symbol}", symbol),
                            )
                          )
                            return;
                          setSymbols((prev) => removeSymbol(prev, symbol));
                        }
                      : undefined
                  }
                  onDetail={() => setDetailSymbol(symbol)}
                />
              );
            })}
            {/* Market overview — fills the 6th grid slot */}
            <MarketOverview
              items={tickerItems.filter((i): i is AnalysisResponse => i != null)}
              timeframeLabel={t("tf.4h")}
            />
          </div>

          {/* Cross history timeline — persisted EMA/MACD/momentum crosses */}
          <div className="mt-6">
            <CrossHistory />
          </div>

          {/* Methodology note */}
          <section className="mt-6 rounded-xl border border-white/5 bg-card/40 p-5 text-xs leading-relaxed text-muted-foreground">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/70">
              {t("methodology.title")}
            </h2>
            <p>
              {t("methodology.text")}
            </p>
          </section>
        </main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t border-white/8 bg-black/50">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-center text-[11px] sm:px-6 md:flex-row md:items-center md:justify-between md:text-left lg:px-8">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/80">
                {t("footer.name")}
              </span>{" "}
              — {t("footer.tagline")}
            </p>
            <p className="font-medium text-foreground/70">
              {t("footer.disclaimer")}
            </p>
          </div>
        </footer>
      </div>

      {/* Keyboard shortcuts help modal */}
      <KeyboardHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Add ticker modal — validate + add any Binance USDT pair */}
      <AddTickerModal
        open={addTickerOpen}
        existing={symbols}
        onClose={() => setAddTickerOpen(false)}
        onAdd={(sym) => {
          setSymbols((prev) => addSymbol(prev, sym));
          setAddTickerOpen(false);
        }}
      />

      {/* Ticker detail modal — full indicator breakdown for one symbol */}
      <TickerDetailModal
        symbol={detailSymbol}
        data={
          detailSymbol ? cells[cellKey(detailSymbol, tfFor(detailSymbol))]?.data ?? null : null
        }
        timeframe={detailSymbol ? tfFor(detailSymbol) : DEFAULT_TIMEFRAME}
        open={!!detailSymbol}
        onClose={() => setDetailSymbol(null)}
      />
    </div>
  );
}
