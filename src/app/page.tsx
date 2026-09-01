"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssetCard } from "@/components/panel/asset-card";
import { TickerTape } from "@/components/panel/ticker-tape";
import { MarketSummary } from "@/components/panel/market-summary";
import { CrossHistory } from "@/components/panel/cross-history";
import { MarketOverview } from "@/components/panel/market-overview";
import { SYMBOLS, SYMBOL_META, type AnalysisResponse } from "@/lib/types";
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
import { RefreshCw, Radio, AlertTriangle, Clock, Wifi, WifiOff, Download, Keyboard, HelpCircle } from "lucide-react";

const REFRESH_MS = 60_000;
type Cell = { loading: boolean; error: string | null; data: AnalysisResponse | null };

const initialCell: Cell = { loading: true, error: null, data: null };

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
  const [cells, setCells] = useState<Record<string, Cell>>(
    Object.fromEntries(SYMBOLS.map((s) => [s, { ...initialCell }])),
  );
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(REFRESH_MS / 1000);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [helpOpen, setHelpOpen] = useState(false);
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

  const fetchAll = useCallback(async (manual: boolean) => {
    // Cancel any in-flight fetch.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    if (manual) setRefreshing(true);
    // Mark loading only for manual refresh so auto-refresh doesn't flash skeletons.
    if (manual) {
      setCells((prev) => {
        const next: Record<string, Cell> = {};
        for (const s of SYMBOLS) {
          next[s] = prev[s]?.data
            ? { ...prev[s], loading: true }
            : { loading: true, error: null, data: null };
        }
        return next;
      });
    }

    await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          const res = await fetch(`/api/analysis?symbol=${symbol}`, {
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
            [symbol]: { loading: false, error: null, data },
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
            [symbol]: { loading: false, error: msg, data: prev[symbol]?.data ?? null },
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

  const tickerItems = SYMBOLS.map((s) => cells[s].data);
  // Strategy alerts — fire toasts when strategy transitions WAIT→BUY/SHORT.
  useStrategyAlerts(tickerItems, "trend_buy");
  const anyLoading = SYMBOLS.some((s) => cells[s].loading);
  const anyError = SYMBOLS.some((s) => cells[s].error);

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

        {/* Header */}
        <header className="border-b border-white/5 bg-card/40 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#4fa8d8]/30 bg-[#4fa8d8]/10">
                <Radio className="h-5 w-5 text-[#4fa8d8]" aria-hidden />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  Panel Cuantitativo{" "}
                  <span className="text-muted-foreground">{"// Intradía"}</span>
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  BTC · ETH · XRP — EMA 55/200 (4h), RSI, MACD, soportes/resistencias
                  por pivotes y estructura de mercado en vivo.
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
                aria-label="Actualizar ahora los datos del panel"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                  aria-hidden
                />
                {refreshing ? "Actualizando…" : "Actualizar ahora"}
              </button>

              <button
                type="button"
                onClick={() => exportSnapshot(tickerItems)}
                className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
                aria-label="Exportar snapshot JSON"
                title="Exportar análisis actual como JSON"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Exportar</span>
              </button>

              <PriceAlertsButton
                alerts={priceAlerts.alerts}
                onAdd={priceAlerts.addAlert}
                onRemove={priceAlerts.removeAlert}
                onClearTriggered={priceAlerts.clearTriggered}
                livePrices={tick.prices}
              />

              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="hidden items-center gap-1 rounded-md border border-white/8 bg-black/20 px-2.5 py-1.5 text-[10px] text-muted-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground/80 focus-visible:outline-2 focus-visible:outline-[#4fa8d8] md:inline-flex"
                title="Atajos: R=refrescar, C=colapsar todo, E=expandir todo, ?=ayuda"
                aria-label="Mostrar ayuda de atajos de teclado"
              >
                <Keyboard className="h-3 w-3" aria-hidden />
                R · C · E
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
                    Sincronizando con Binance…
                  </span>
                )}
                {SYMBOLS.filter((s) => cells[s].error).map((s) => (
                  <span
                    key={s}
                    className="flex items-center gap-1.5 text-[#e2604f]"
                    title={cells[s].error ?? ""}
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {SYMBOL_META[s].asset}: {cells[s].error}
                  </span>
                ))}
              </div>
            </div>
          )}
        </header>

        {/* Market summary strip — aggregate sentiment across all 3 pairs */}
        {tickerItems.some((i) => i != null) && (
          <div className="border-b border-white/5 bg-black/15">
            <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
              <MarketSummary items={tickerItems} />
            </div>
          </div>
        )}

        {/* Main grid */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {SYMBOLS.map((symbol) => {
              const cell = cells[symbol];
              if (cell.error && !cell.data) {
                return (
                  <article
                    key={symbol}
                    className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-[#e2604f]/30 bg-card/60 p-8 text-center"
                  >
                    <AlertTriangle className="h-8 w-8 text-[#e2604f]" aria-hidden />
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        {SYMBOL_META[symbol].pair}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        No se pudo cargar el análisis.
                      </p>
                    </div>
                    <p className="max-w-xs text-xs text-[#e2604f]/80">{cell.error}</p>
                    <button
                      type="button"
                      onClick={() => fetchAll(true)}
                      className="mt-2 inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-foreground hover:bg-white/10"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      Reintentar
                    </button>
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
                    aria-label={`Cargando ${SYMBOL_META[symbol].pair}`}
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
                  livePrice={livePrice}
                  tickActive={tick.connected && tick.binanceLive}
                  lastTickAt={lastTickAt}
                  nowMs={nowMs}
                  depthSnapshot={book.snapshots[symbol]}
                  depthConnected={book.connected && book.binanceLive}
                />
              );
            })}
            {/* Market overview — fills the 6th grid slot */}
            <MarketOverview items={tickerItems} />
          </div>

          {/* Cross history timeline — persisted EMA/MACD/momentum crosses */}
          <div className="mt-6">
            <CrossHistory />
          </div>

          {/* Methodology note */}
          <section className="mt-6 rounded-xl border border-white/5 bg-card/40 p-5 text-xs leading-relaxed text-muted-foreground">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground/70">
              Metodolog&iacute;a
            </h2>
            <p>
              Las <span className="text-[#e8b04b]">EMA 55</span> y{" "}
              <span className="text-[#4fa8d8]">EMA 200</span> se calculan sobre
              cierres de 4h (semilla SMA, k = 2/(N+1)). Soporte y resistencia
              provienen de pivotes de m&aacute;ximos/m&iacute;nimos en las &uacute;ltimas
              80 velas con ventana sim&eacute;trica de &plusmn;3. El estado del cruce
              es <span className="text-[#5fbf8f]">ALCISTA</span> si EMA55 &gt; EMA200,{" "}
              <span className="text-[#e2604f]">BAJISTA</span> si EMA55 &lt; EMA200, y{" "}
              <span className="text-[#e8b04b]">COMPRIMIDO</span> cuando la diferencia
              relativa es menor al 0.15%. El{" "}
              <span className="text-foreground/80">RSI(14)</span> usa el suavizado de
              Wilder; zonas &gt;70 = sobrecomprado, &lt;30 = sobrevendido. El{" "}
              <span className="text-foreground/80">MACD(12, 26, 9)</span> usa los
              defaults de Appel: MACD = EMA12 &minus; EMA26, se&ntilde;al = EMA9 del
              MACD, histograma = MACD &minus; se&ntilde;al. La
              detecci&oacute;n de cruce reciente escanea las &uacute;ltimas 30 velas
              buscando flips de signo en EMA55 &minus; EMA200 y marca como
              &ldquo;recente&rdquo; si ocurri&oacute; dentro de 10 velas. Los{" "}
              <span className="text-[#5fbf8f]">precios tick-a-tick</span> provienen de
              un WebSocket conectado al stream de trades de Binance
              (mini-service socket.io en puerto 3003, throttled a 1 emit/800ms por
              s&iacute;mbolo). El an&aacute;lisis EMA/RSI/MACD/S-R se recalcula
              cada 60s; el precio spot se actualiza en vivo entre refrescos.
              Los campos que no pueden calcularse se marcan
              expl&iacute;citamente como &ldquo;Dato no disponible&rdquo;.
            </p>
          </section>
        </main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t border-white/8 bg-black/50">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-center text-[11px] sm:px-6 md:flex-row md:items-center md:justify-between md:text-left lg:px-8">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground/80">
                Panel Cuantitativo // Intrad&iacute;a
              </span>{" "}
              — an&aacute;lisis t&eacute;cnico autom&aacute;tico, sin juicio humano.
            </p>
            <p className="font-medium text-foreground/70">
              Esto no constituye asesor&iacute;a financiera; verifica siempre en tu
              plataforma de ejecuci&oacute;n antes de operar.
            </p>
          </div>
        </footer>
      </div>

      {/* Keyboard shortcuts help modal */}
      <KeyboardHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
