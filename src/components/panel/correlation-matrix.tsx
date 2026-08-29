"use client";

import { useEffect, useState } from "react";
import { SYMBOL_META } from "@/lib/types";
import { Loader2 } from "lucide-react";

type Props = {
  pollMs?: number;
};

type Response = {
  symbols: string[];
  matrix: (number | null)[][];
  window: string;
  updated_at: string;
};

/** Color scale: -1 (red) → 0 (dark) → +1 (green). */
function cellColor(v: number | null): { bg: string; fg: string } {
  if (v == null || !Number.isFinite(v)) {
    return { bg: "rgba(255,255,255,0.03)", fg: "rgba(139,150,165,0.4)" };
  }
  // Clamp to [-1, 1].
  const c = Math.max(-1, Math.min(1, v));
  const abs = Math.abs(c);
  if (c >= 0) {
    // Green tint, intensity by |v|.
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

/**
 * CorrelationMatrix — a compact heatmap showing Pearson correlation between
 * all pairs based on 4h returns. Fetched from /api/correlation (120s cache).
 *
 * Renders as a square matrix with symbol labels on the top + left. Each cell
 * is color-coded: green for positive correlation, red for negative, with
 * intensity proportional to |r|. The diagonal is always 1.0.
 *
 * Used inside the Market Overview card to give a quick read on which pairs
 * move together vs. independently.
 */
export function CorrelationMatrix({ pollMs = 120_000 }: Props) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const res = await fetch("/api/correlation", { cache: "no-store" });
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
    load();
    const id = setInterval(load, pollMs);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, [pollMs]);

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
  const n = symbols.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Correlación (Pearson)
        </span>
        <span className="text-[9px] text-muted-foreground/50">{winLabel}</span>
      </div>
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="p-1" />
              {symbols.map((s) => (
                <th
                  key={s}
                  className="p-1 text-center font-medium text-muted-foreground/70"
                  title={SYMBOL_META[s]?.label ?? s}
                >
                  {SYMBOL_META[s]?.asset ?? s.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSym, i) => (
              <tr key={rowSym}>
                <td
                  className="p-1 pr-2 text-right font-medium text-muted-foreground/70"
                  title={SYMBOL_META[rowSym]?.label ?? rowSym}
                >
                  {SYMBOL_META[rowSym]?.asset ?? rowSym.slice(0, 3)}
                </td>
                {symbols.map((colSym, j) => {
                  const v = matrix[i]?.[j] ?? null;
                  const { bg, fg } = cellColor(v);
                  const isDiagonal = i === j;
                  return (
                    <td key={colSym} className="p-0.5">
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded tnum text-[9px] font-medium"
                        style={{
                          background: bg,
                          color: fg,
                          boxShadow: isDiagonal
                            ? "inset 0 0 0 1px rgba(255,255,255,0.15)"
                            : undefined,
                        }}
                        title={`${SYMBOL_META[rowSym]?.asset ?? rowSym} ↔ ${
                          SYMBOL_META[colSym]?.asset ?? colSym
                        }: ${v != null ? v.toFixed(2) : "—"}`}
                      >
                        {v != null ? v.toFixed(2) : "—"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Color legend */}
      <div className="flex items-center justify-between text-[9px] text-muted-foreground/50">
        <span className="text-[#e2604f]">−1.0 (inverso)</span>
        <div
          className="h-1.5 flex-1 mx-2 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, rgba(226,96,79,0.5), rgba(255,255,255,0.05), rgba(95,191,143,0.5))",
          }}
        />
        <span className="text-[#5fbf8f]">+1.0 (idéntico)</span>
      </div>
    </div>
  );
}
