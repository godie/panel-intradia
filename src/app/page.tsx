"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssetCard } from "@/components/panel/asset-card";
import { TickerTape } from "@/components/panel/ticker-tape";
import { MarketSummary } from "@/components/panel/market-summary";
import { SYMBOLS, SYMBOL_META, type AnalysisResponse } from "@/lib/types";
import { RefreshCw, Radio, AlertTriangle, Clock } from "lucide-react";

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
  const [cells, setCells] = useState<Record<string, Cell>>({
    BTCUSDT: { ...initialCell },
    ETHUSDT: { ...initialCell },
    XRPUSDT: { ...initialCell },
  });
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(REFRESH_MS / 1000);
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

  // Countdown ticker (every second).
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => (c <= 1 ? REFRESH_MS / 1000 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const tickerItems = SYMBOLS.map((s) => cells[s].data);
  const anyLoading = SYMBOLS.some((s) => cells[s].loading);
  const anyError = SYMBOLS.some((s) => cells[s].error);

  return (
    <div className="flex min-h-screen flex-col bg-background">
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
                BTC · ETH · XRP — EMA 55/200 (4h), soportes/resistencias por
                pivotes y estructura de mercado en vivo.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-white/8 bg-black/20 px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="live-dot absolute inline-flex h-2 w-2 rounded-full bg-[#5fbf8f]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#5fbf8f]" />
              </span>
              <span className="text-xs font-medium text-foreground/80">EN VIVO</span>
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
            return <AssetCard key={symbol} data={cell.data} />;
          })}
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
            Wilder; zonas &gt;70 = sobrecomprado, &lt;30 = sobrevendido. La
            detecci&oacute;n de cruce reciente escanea las &uacute;ltimas 30 velas
            buscando flips de signo en EMA55 &minus; EMA200 y marca como
            &ldquo;recente&rdquo; si ocurri&oacute; dentro de 10 velas. Los datos
            provienen de la API p&uacute;blica de Binance
            (BTCUSDT/ETHUSDT/XRPUSDT como proxy de USD), con cach&eacute; de
            servidor de 60 segundos. Los campos que no pueden calcularse se marcan
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
  );
}
