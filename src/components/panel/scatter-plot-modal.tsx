"use client";

import { useEffect, useRef, useState } from "react";
import { SYMBOL_META } from "@/lib/types";
import { X, Loader2, TrendingUp, TrendingDown } from "lucide-react";

type Props = {
  symbolA: string;
  symbolB: string;
  interval: string;
  limit: number;
  open: boolean;
  onClose: () => void;
};

type ReturnsResponse = {
  symbolA: string;
  symbolB: string;
  interval: string;
  limit: number;
  returnsA: number[];
  returnsB: number[];
  stats: {
    r: number;
    rSquared: number;
    slope: number;
    intercept: number;
    meanA: number;
    meanB: number;
    n: number;
  } | null;
  updated_at: string;
};

/**
 * ScatterPlotModal — a modal showing the scatter plot of paired returns
 * between two symbols, with a linear regression line and R² overlay.
 *
 * Renders on a HiDPI canvas:
 *  - Each point = (returnA[i], returnB[i]) — a single 4h candle's return pair.
 *  - Color: green if both positive (up-up), red if both negative (down-down),
 *    amber if divergent (one up, one down).
 *  - Regression line: dashed white line from (minX, slope*minX+intercept) to
 *    (maxX, slope*maxX+intercept).
 *  - Axes with labels + zero lines.
 *
 * Stats panel below the chart: r, R², slope, intercept, n, and a plain-
 * language interpretation ("BTC explica X% de la varianza de ETH").
 */
export function ScatterPlotModal({
  symbolA,
  symbolB,
  interval,
  limit,
  open,
  onClose,
}: Props) {
  const [data, setData] = useState<ReturnsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fetch returns when the modal opens.
  useEffect(() => {
    if (!open) return;
    let aborted = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/returns?symbolA=${symbolA}&symbolB=${symbolB}&interval=${interval}&limit=${limit}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as ReturnsResponse;
        if (!aborted) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!aborted) {
          setError(err instanceof Error ? err.message : "Error");
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [open, symbolA, symbolB, interval, limit]);

  // Draw the scatter plot when data arrives.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !data.stats) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 400;
    const cssH = 320;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 40;
    const padR = 16;
    const padT = 16;
    const padB = 30;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    const { returnsA, returnsB, stats } = data;
    const allX = returnsA;
    const allY = returnsB;
    const minX = Math.min(0, ...allX);
    const maxX = Math.max(0, ...allX);
    const minY = Math.min(0, ...allY);
    const maxY = Math.max(0, ...allY);
    // 5% headroom.
    const padX = (maxX - minX) * 0.05 || 1;
    const padY = (maxY - minY) * 0.05 || 1;
    const xMin = minX - padX;
    const xMax = maxX + padX;
    const yMin = minY - padY;
    const yMax = maxY + padY;

    const x = (v: number) => padL + ((v - xMin) / (xMax - xMin)) * plotW;
    const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // Grid + zero lines.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(cssW - padR, gy);
      ctx.stroke();
    }
    // Zero lines.
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(x(0), padT);
    ctx.lineTo(x(0), padT + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padL, y(0));
    ctx.lineTo(cssW - padR, y(0));
    ctx.stroke();

    // Points.
    for (let i = 0; i < allX.length; i++) {
      const px = allX[i];
      const py = allY[i];
      const bothUp = px >= 0 && py >= 0;
      const bothDown = px < 0 && py < 0;
      const color = bothUp
        ? "rgba(95,191,143,0.5)"
        : bothDown
          ? "rgba(226,96,79,0.5)"
          : "rgba(232,176,75,0.4)";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x(px), y(py), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Regression line.
    const { slope, intercept } = stats;
    ctx.strokeStyle = "rgba(79,168,216,0.8)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x(xMin), y(slope * xMin + intercept));
    ctx.lineTo(x(xMax), y(slope * xMax + intercept));
    ctx.stroke();
    ctx.setLineDash([]);

    // Axis labels.
    ctx.fillStyle = "rgba(139,150,165,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${xMin.toFixed(1)}%`, padL, cssH - padB + 14);
    ctx.textAlign = "right";
    ctx.fillText(`${xMax.toFixed(1)}%`, cssW - padR, cssH - padB + 14);
    ctx.textAlign = "left";
    ctx.fillText(`${yMin.toFixed(1)}%`, 2, padT + plotH);
    ctx.fillText(`${yMax.toFixed(1)}%`, 2, padT + 8);
  }, [data]);

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const assetA = SYMBOL_META[symbolA]?.asset ?? symbolA;
  const assetB = SYMBOL_META[symbolB]?.asset ?? symbolB;
  const stats = data?.stats;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-card-enter"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Scatter plot ${assetA} vs ${assetB}`}
    >
      <div
        className="relative w-full max-w-lg mx-4 rounded-xl border border-white/10 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 p-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {assetA} ↔ {assetB}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              Scatter de returns · {interval} · {limit} velas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#4fa8d8]"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Calculando returns…
            </div>
          )}
          {error && (
            <div className="py-12 text-center text-xs text-[#e2604f]">
              Error: {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {/* Scatter plot canvas */}
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: 320 }}
                className="rounded-lg border border-white/5 bg-black/20"
                aria-label={`Scatter plot de returns ${assetA} vs ${assetB}`}
              />

              {/* Axis labels */}
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/60">
                <span>X: {assetA} return %</span>
                <span>Y: {assetB} return %</span>
              </div>

              {/* Stats grid */}
              {stats && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
                  <StatCard label="Correlación (r)" value={stats.r.toFixed(3)} color={stats.r >= 0 ? "#5fbf8f" : "#e2604f"} />
                  <StatCard label="R²" value={stats.rSquared.toFixed(3)} color="#4fa8d8" />
                  <StatCard label="Pendiente (β)" value={stats.slope.toFixed(3)} color="#e8b04b" />
                  <StatCard label="Intercepto" value={stats.intercept.toFixed(4)} />
                  <StatCard label="Media X" value={`${stats.meanA.toFixed(2)}%`} />
                  <StatCard label="Observaciones" value={String(stats.n)} />
                </div>
              )}

              {/* Interpretation */}
              {stats && (
                <div className="mt-3 rounded-lg border border-white/5 bg-black/20 p-3 text-[11px] leading-relaxed text-foreground/70">
                  {stats.r >= 0 ? (
                    <TrendingUp className="mr-1 inline h-3 w-3 text-[#5fbf8f]" aria-hidden />
                  ) : (
                    <TrendingDown className="mr-1 inline h-3 w-3 text-[#e2604f]" aria-hidden />
                  )}
                  <span className="font-medium text-foreground/90">
                    {assetA} explica el {(stats.rSquared * 100).toFixed(1)}%
                  </span>{" "}
                  de la varianza de {assetB}. Beta = {stats.slope.toFixed(2)}{" "}
                  (por cada 1% de movimiento en {assetA}, {assetB} se mueve{" "}
                  {Math.abs(stats.slope).toFixed(2)}% {stats.slope >= 0 ? "en la misma dirección" : "en dirección contraria"}).
                </div>
              )}

              {/* Legend */}
              <div className="mt-3 flex items-center justify-center gap-4 text-[9px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#5fbf8f]/50" />
                  Ambos ↑
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#e2604f]/50" />
                  Ambos ↓
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#e8b04b]/40" />
                  Divergentes
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-[#4fa8d8]/80" style={{ borderTop: "1px dashed #4fa8d8" }} />
                  Regresión
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <div
        className="tnum mt-0.5 text-xs font-semibold"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
