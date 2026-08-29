"use client";

import { useEffect, useState } from "react";
import { SYMBOL_META } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { ScatterPlotModal } from "./scatter-plot-modal";

type Props = {
  pollMs?: number;
};

type Response = {
  symbols: string[];
  matrix: (number | null)[][];
  interval: string;
  limit: number;
  window: string;
  updated_at: string;
};

const TIMEFRAMES = [
  { value: "1h", label: "1H", limit: 500 },
  { value: "4h", label: "4H", limit: 500 },
  { value: "1d", label: "1D", limit: 500 },
] as const;

const WINDOW_SIZES = [100, 500, 1000] as const;

/** Color scale: -1 (red) → 0 (dark) → +1 (green). */
function cellColor(v: number | null): { bg: string; fg: string } {
  if (v == null || !Number.isFinite(v)) {
    return { bg: "rgba(255,255,255,0.03)", fg: "rgba(139,150,165,0.4)" };
  }
  const c = Math.max(-1, Math.min(1, v));
  const abs = Math.abs(c);
  if (c >= 0) {
    return {
      bg: `rgba(95,191,143,${0.08 + abs * 0.32})`,
      fg: abs > 0.6 ? "#5fbf8f" : "rgba(95,191,143,0.85)",
    };
  }
  return {
    bg: `rgba(226,96,79,${0.08 + abs * 0.32})`,
    fg: abs > 0.6 ? "#e2604f" : "rgba(226,96,79,0.85)",
  };
}

/** Interpret the correlation strength for the insight text. */
function interpretCorrelation(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return "datos insuficientes";
  const abs = Math.abs(r);
  const dir = r >= 0 ? "positiva" : "negativa";
  const strength =
    abs >= 0.7 ? "fuerte" : abs >= 0.4 ? "moderada" : "débil";
  return `correlación ${dir} ${strength} (${r.toFixed(2)})`;
}

/**
 * CorrelationMatrix — a compact heatmap showing Pearson correlation between
 * all pairs. Supports timeframe selection (1h/4h/1d) and window size
 * (100/500/1000 candles) via dropdowns. Hovering a row/column highlights the
 * entire row+column to make pair relationships scannable.
 *
 * Fetched from /api/correlation?interval=X&limit=Y (120s cache per combo).
 */
export function CorrelationMatrix({ pollMs = 120_000 }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setIntervalVal] = useState<string>("4h");
  const [limit, setLimit] = useState<number>(500);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  // Scatter modal state: which pair is being viewed (null = closed).
  const [scatterPair, setScatterPair] = useState<{
    a: string;
    b: string;
  } | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async (showLoading: boolean) => {
      if (showLoading && !aborted) setLoading(true);
      try {
        const url = `/api/correlation?interval=${interval}&limit=${limit}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Response;
        if (!aborted) {
          setData(json);
          setLoading(false);
        }
      } catch {
        if (!aborted) setLoading(false);
      }
    };
    load(true);
    const id = setInterval(() => load(false), pollMs);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, [pollMs, interval, limit]);

  // Find the highest off-diagonal correlation for the insight text.
  const topPair = (() => {
    if (!data) return null;
    let best: { i: number; j: number; r: number } | null = null;
    for (let i = 0; i < data.symbols.length; i++) {
      for (let j = i + 1; j < data.symbols.length; j++) {
        const r = data.matrix[i]?.[j];
        if (r != null && Number.isFinite(r)) {
          if (!best || Math.abs(r) > Math.abs(best.r)) {
            best = { i, j, r };
          }
        }
      }
    }
    return best;
  })();

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Calculando correlaciones…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-3 text-center text-[11px] text-muted-foreground/60">
        Correlación no disponible
      </div>
    );
  }

  const { symbols, matrix, window: winLabel } = data;

  return (
    <div className="space-y-2">
      {/* Header with timeframe + window selectors */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Correlación (Pearson)
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Timeframe selector */}
          <div className="flex items-center gap-0.5 rounded-md border border-white/8 bg-black/20 p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                type="button"
                onClick={() => setIntervalVal(tf.value)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider transition-colors ${
                  interval === tf.value
                    ? "bg-[#4fa8d8]/20 text-[#4fa8d8]"
                    : "text-muted-foreground/60 hover:text-foreground/80"
                }`}
                aria-pressed={interval === tf.value}
              >
                {tf.label}
              </button>
            ))}
          </div>
          {/* Window size selector */}
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border border-white/8 bg-black/20 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
            aria-label="Número de velas"
          >
            {WINDOW_SIZES.map((w) => (
              <option key={w} value={w} className="bg-card text-foreground">
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto scroll-thin">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="p-1" />
              {symbols.map((s, j) => (
                <th
                  key={s}
                  className={`p-1 text-center font-medium transition-colors ${
                    hoverCol === j
                      ? "text-foreground"
                      : "text-muted-foreground/70"
                  }`}
                  title={SYMBOL_META[s]?.label ?? s}
                  onMouseEnter={() => setHoverCol(j)}
                  onMouseLeave={() => setHoverCol(null)}
                >
                  {SYMBOL_META[s]?.asset ?? s.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSym, i) => (
              <tr
                key={rowSym}
                onMouseEnter={() => setHoverRow(i)}
                onMouseLeave={() => setHoverRow(null)}
              >
                <td
                  className={`p-1 pr-2 text-right font-medium transition-colors ${
                    hoverRow === i
                      ? "text-foreground"
                      : "text-muted-foreground/70"
                  }`}
                  title={SYMBOL_META[rowSym]?.label ?? rowSym}
                >
                  {SYMBOL_META[rowSym]?.asset ?? rowSym.slice(0, 3)}
                </td>
                {symbols.map((colSym, j) => {
                  const v = matrix[i]?.[j] ?? null;
                  const { bg, fg } = cellColor(v);
                  const isDiagonal = i === j;
                  const isHighlighted =
                    hoverRow === i || hoverCol === j || hoverRow === j ||
                    hoverCol === i;
                  return (
                    <td key={colSym} className="p-0.5">
                      <button
                        type="button"
                        disabled={isDiagonal}
                        onClick={() =>
                          !isDiagonal &&
                          setScatterPair({ a: rowSym, b: colSym })
                        }
                        className={`flex h-7 w-7 items-center justify-center rounded tnum text-[9px] font-medium transition-all duration-150 ${
                          isHighlighted ? "scale-110 ring-1 ring-white/30" : ""
                        } ${isDiagonal ? "cursor-default" : "cursor-pointer hover:scale-125 hover:ring-2 hover:ring-[#4fa8d8]"}`}
                        style={{
                          background: bg,
                          color: fg,
                          boxShadow: isDiagonal
                            ? "inset 0 0 0 1px rgba(255,255,255,0.15)"
                            : undefined,
                        }}
                        title={
                          isDiagonal
                            ? `${SYMBOL_META[rowSym]?.asset ?? rowSym} (auto-correlación = 1.0)`
                            : `Click: scatter plot ${SYMBOL_META[rowSym]?.asset ?? rowSym} ↔ ${SYMBOL_META[colSym]?.asset ?? colSym} (r=${v != null ? v.toFixed(2) : "—"})`
                        }
                        aria-label={
                          isDiagonal
                            ? `${rowSym} diagonal`
                            : `Ver scatter plot ${rowSym} vs ${colSym}`
                        }
                      >
                        {v != null ? v.toFixed(2) : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Insight text — highest correlation pair */}
      {topPair && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {SYMBOL_META[symbols[topPair.i]]?.asset} ↔{" "}
            {SYMBOL_META[symbols[topPair.j]]?.asset}
          </span>
          : {interpretCorrelation(topPair.r)}.
          {Math.abs(topPair.r) >= 0.7 &&
            " Diversificación limitada entre ambos."}
        </p>
      )}

      {/* Color legend */}
      <div className="flex items-center justify-between text-[9px] text-muted-foreground/50">
        <span className="text-[#e2604f]">−1.0 (inverso)</span>
        <div
          className="mx-2 h-1.5 flex-1 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, rgba(226,96,79,0.5), rgba(255,255,255,0.05), rgba(95,191,143,0.5))",
          }}
        />
        <span className="text-[#5fbf8f]">+1.0 (idéntico)</span>
      </div>
      <div className="text-center text-[9px] text-muted-foreground/40">
        {winLabel}
      </div>

      {/* Scatter plot modal — opened by clicking a matrix cell */}
      {scatterPair && (
        <ScatterPlotModal
          symbolA={scatterPair.a}
          symbolB={scatterPair.b}
          interval={interval}
          limit={limit}
          open={scatterPair != null}
          onClose={() => setScatterPair(null)}
        />
      )}
    </div>
  );
}
