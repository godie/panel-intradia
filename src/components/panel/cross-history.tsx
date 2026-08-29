"use client";

import { useEffect, useState } from "react";
import { SYMBOL_META, type CrossState } from "@/lib/types";
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Activity,
  History,
  Loader2,
} from "lucide-react";

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

type Stats = Record<
  string,
  { ema: number; macd: number; momentum: number; total: number }
>;

type Response = {
  events: CrossEvent[];
  stats: Stats;
  count: number;
};

const TYPE_META: Record<
  CrossEventType,
  { label: string; short: string; color: string; icon: typeof Zap }
> = {
  ema: { label: "EMA 55/200", short: "EMA", color: "#4fa8d8", icon: Activity },
  macd: { label: "MACD / Signal", short: "MACD", color: "#e8b04b", icon: Zap },
  momentum: {
    label: "Giro momentum",
    short: "MOM",
    color: "#b48cff",
    icon: TrendingUp,
  },
};

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const day = Math.floor(hr / 24);
  return `hace ${day}d`;
}

function fmtPrice(n: number): string {
  if (n >= 1000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/**
 * CrossHistory — a collapsible timeline of the most recent EMA/MACD/momentum
 * crosses across all symbols, fetched from /api/cross-history and auto-
 * refreshing every 60s.
 *
 * Shows:
 *  - A header row with aggregate stats (per-symbol counts in the last 7 days)
 *  - A vertical timeline of events (newest first), each row showing the
 *    symbol, cross type (color-coded), direction (bull/bear icon), price at
 *    detection, candles ago, and relative time.
 *
 * Empty state: "Sin cruces registrados" when no events exist yet — this is
 * expected on a fresh database until crosses occur in the market.
 */
export function CrossHistory({ pollMs = 60_000 }: { pollMs?: number }) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Filter state: "all" | "ema" | "macd" | "momentum" for type,
  // "all" | "bullish" | "bearish" for direction.
  const [typeFilter, setTypeFilter] = useState<"all" | CrossEventType>("all");
  const [dirFilter, setDirFilter] = useState<"all" | CrossDirection>("all");

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const res = await fetch("/api/cross-history?limit=30", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Response;
        if (!aborted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!aborted) {
          setError(err instanceof Error ? err.message : "Error");
        }
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, [pollMs]);

  const allEvents = data?.events ?? [];
  const stats = data?.stats ?? {};
  const totalAll = Object.values(stats).reduce((s, v) => s + v.total, 0);

  // Apply filters.
  const events = allEvents.filter((ev) => {
    if (typeFilter !== "all" && ev.type !== typeFilter) return false;
    if (dirFilter !== "all" && ev.direction !== dirFilter) return false;
    return true;
  });

  return (
    <section className="rounded-xl border border-white/5 bg-card/40 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left transition-colors hover:bg-card/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fa8d8]"
        aria-expanded={expanded}
        aria-controls="cross-history-body"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/8 bg-black/20">
            <History className="h-5 w-5 text-[#4fa8d8]" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Historial de Cruces
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {totalAll > 0
                ? `${totalAll} cruces en los últimos 7 días · ${events.length} recientes`
                : "EMA · MACD · momentum flips persistidos en SQLite"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Per-symbol stat badges */}
          {Object.entries(stats).slice(0, 3).map(([sym, s]) => (
            <span
              key={sym}
              className="hidden items-center gap-1 rounded border border-white/8 bg-black/20 px-2 py-1 text-[10px] sm:inline-flex"
              title={`${SYMBOL_META[sym]?.asset ?? sym}: ${s.total} cruces (EMA ${s.ema}, MACD ${s.macd}, MOM ${s.momentum})`}
            >
              <span className="font-medium text-foreground/80">
                {SYMBOL_META[sym]?.asset ?? sym}
              </span>
              <span className="tnum text-muted-foreground">{s.total}</span>
            </span>
          ))}
          <span
            className={`text-muted-foreground transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            ▾
          </span>
        </div>
      </button>

      {expanded && (
        <div
          id="cross-history-body"
          className="border-t border-white/5 px-5 pb-5 pt-3"
        >
          {/* Filter controls */}
          {allEvents.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {/* Type filter tabs */}
              <div className="flex items-center gap-1 rounded-lg border border-white/8 bg-black/20 p-0.5">
                <FilterButton
                  active={typeFilter === "all"}
                  onClick={() => setTypeFilter("all")}
                  label="Todos"
                />
                {(Object.keys(TYPE_META) as CrossEventType[]).map((t) => (
                  <FilterButton
                    key={t}
                    active={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                    label={TYPE_META[t].short}
                    color={TYPE_META[t].color}
                  />
                ))}
              </div>
              {/* Direction filter */}
              <div className="flex items-center gap-1 rounded-lg border border-white/8 bg-black/20 p-0.5">
                <FilterButton
                  active={dirFilter === "all"}
                  onClick={() => setDirFilter("all")}
                  label="Dir."
                />
                <FilterButton
                  active={dirFilter === "bullish"}
                  onClick={() => setDirFilter("bullish")}
                  label="↑ Alcista"
                  color="#5fbf8f"
                />
                <FilterButton
                  active={dirFilter === "bearish"}
                  onClick={() => setDirFilter("bearish")}
                  label="↓ Bajista"
                  color="#e2604f"
                />
              </div>
              <span className="tnum ml-auto text-[10px] text-muted-foreground/60">
                {events.length}/{allEvents.length} eventos
              </span>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando historial…
            </div>
          )}
          {error && (
            <div className="py-6 text-center text-xs text-[#e2604f]">
              Error: {error}
            </div>
          )}
          {!loading && !error && events.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground/60">
              Sin cruces registrados todavía. Aparecerán aquí cuando el
              mercado produzca cruces frescos de EMA55/200, MACD/signal o
              giros de momentum.
            </div>
          )}
          {!loading && !error && events.length > 0 && (
            <ol className="relative max-h-80 space-y-1.5 overflow-y-auto scroll-thin pr-2">
              {events.map((ev) => {
                const meta = TYPE_META[ev.type];
                const Icon = meta.icon;
                const bullish = ev.direction === "bullish";
                const dirColor = bullish ? "#5fbf8f" : "#e2604f";
                const DirIcon = bullish ? TrendingUp : TrendingDown;
                return (
                  <li
                    key={ev.id}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/15 px-3 py-2 transition-colors hover:bg-black/25"
                  >
                    {/* Type icon */}
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
                      style={{
                        borderColor: `${meta.color}40`,
                        background: `${meta.color}12`,
                      }}
                    >
                      <Icon
                        className="h-4 w-4"
                        style={{ color: meta.color }}
                        aria-hidden
                      />
                    </div>
                    {/* Symbol + type */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="tnum text-xs font-semibold text-foreground">
                          {SYMBOL_META[ev.symbol]?.asset ?? ev.symbol}
                        </span>
                        <span
                          className="text-[10px] uppercase tracking-wider"
                          style={{ color: meta.color }}
                        >
                          {meta.short}
                        </span>
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: dirColor }}
                        >
                          <DirIcon className="h-3 w-3" aria-hidden />
                          {bullish ? "Alcista" : "Bajista"}
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
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

/** Small filter tab button — active state uses the accent color. */
function FilterButton({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
        active
          ? "bg-white/10 text-foreground"
          : "text-muted-foreground hover:text-foreground/80"
      }`}
      style={
        active && color
          ? { color, background: `${color}1a`, boxShadow: `inset 0 0 0 1px ${color}40` }
          : undefined
      }
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

export type { CrossState };
