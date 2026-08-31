"use client";

import { useEffect, useRef } from "react";

type Props = {
  closes: number[];
  ema55: (number | null)[];
  ema200: (number | null)[];
  spot: number | null;
  crossState: "ALCISTA" | "BAJISTA" | "COMPRIMIDO" | null;
  /** Bollinger Bands upper/lower series for overlay (optional). */
  bbUpper?: (number | null)[];
  bbLower?: (number | null)[];
  /** VWAP series for overlay (optional). */
  vwap?: (number | null)[];
  /** height of the canvas in CSS pixels (width is responsive). */
  height?: number;
};

const COLORS = {
  price: "#e6edf3",
  ema55: "#e8b04b",
  ema200: "#4fa8d8",
  vwap: "#5fbf8f",
  bollinger: "rgba(180,140,255,0.35)",
  bollingerFill: "rgba(180,140,255,0.06)",
  grid: "rgba(255,255,255,0.05)",
  bullFill: "rgba(95,191,143,0.12)",
  bearFill: "rgba(226,96,79,0.12)",
};

/**
 * Sparkline — pure-canvas price chart with EMA55 / EMA200 overlays.
 *
 * Draws on a HiDPI-aware canvas. Price line uses the foreground color,
 * EMA55 amber, EMA200 cold blue (dashed). A faint area fill under the
 * price line is tinted green/red based on the overall cross state to
 * reinforce the bullish/bearish reading at a glance.
 */
export function Sparkline({
  closes,
  ema55,
  ema200,
  spot,
  crossState,
  bbUpper,
  bbLower,
  vwap,
  height = 150,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // HiDPI sizing.
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 320;
    const cssH = height;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 4;
    const padR = 4;
    const padT = 8;
    const padB = 8;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    // Compute y-range across all series (including Bollinger) so every line is visible.
    let min = Infinity;
    let max = -Infinity;
    const allSeries: (number | null)[][] = [closes, ema55, ema200];
    if (bbUpper) allSeries.push(bbUpper);
    if (bbLower) allSeries.push(bbLower);
    if (vwap) allSeries.push(vwap);
    for (const s of allSeries) {
      for (const v of s) {
        if (v != null && Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      ctx.fillStyle = COLORS.grid;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = "rgba(230,237,243,0.4)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Sin datos suficientes", cssW / 2, cssH / 2);
      return;
    }
    // Add 4% headroom top/bottom so lines don't hug the edges.
    const span = max - min;
    min -= span * 0.04;
    max += span * 0.04;

    const n = Math.max(closes.length, ema55.length, ema200.length);
    if (n < 2) return;
    const x = (i: number) => padL + (i / (n - 1)) * plotW;
    const y = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;

    // Horizontal grid lines (4 of them).
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(cssW - padR, gy);
      ctx.stroke();
    }

    // Area fill under price — colored by cross state.
    const fill =
      crossState === "BAJISTA"
        ? COLORS.bearFill
        : crossState === "ALCISTA"
          ? COLORS.bullFill
          : "rgba(232,176,75,0.10)";
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x(0), padT + plotH);
    for (let i = 0; i < closes.length; i++) {
      ctx.lineTo(x(i), y(closes[i]));
    }
    ctx.lineTo(x(closes.length - 1), padT + plotH);
    ctx.closePath();
    ctx.fill();

    // Bollinger Bands fill (between upper and lower) — subtle purple area.
    if (bbUpper && bbLower) {
      ctx.fillStyle = COLORS.bollingerFill;
      ctx.beginPath();
      let started = false;
      // Upper band (left → right).
      for (let i = 0; i < bbUpper.length; i++) {
        const v = bbUpper[i];
        if (v == null || !Number.isFinite(v)) continue;
        if (!started) {
          ctx.moveTo(x(i), y(v));
          started = true;
        } else {
          ctx.lineTo(x(i), y(v));
        }
      }
      // Lower band (right → left) to close the area.
      for (let i = bbLower.length - 1; i >= 0; i--) {
        const v = bbLower[i];
        if (v == null || !Number.isFinite(v)) continue;
        ctx.lineTo(x(i), y(v));
      }
      ctx.closePath();
      ctx.fill();
    }

    // Helper to plot a series skipping nulls.
    const plotLine = (
      series: (number | null)[],
      color: string,
      width: number,
      dash: number[] = [],
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < series.length; i++) {
        const v = series[i];
        if (v == null || !Number.isFinite(v)) {
          drawing = false;
          continue;
        }
        const px = x(i);
        const py = y(v);
        if (!drawing) {
          ctx.moveTo(px, py);
          drawing = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // EMA200 (drawn first so it sits under EMA55 & price).
    plotLine(ema200, COLORS.ema200, 1.5, [5, 4]);
    // Bollinger Bands upper/lower (thin dashed purple).
    if (bbUpper) plotLine(bbUpper, COLORS.bollinger, 1, [2, 3]);
    if (bbLower) plotLine(bbLower, COLORS.bollinger, 1, [2, 3]);
    // VWAP (solid green, thin).
    if (vwap) plotLine(vwap, COLORS.vwap, 1.25, [4, 2]);
    // EMA55.
    plotLine(ema55, COLORS.ema55, 1.5);
    // Price last (on top).
    plotLine(closes, COLORS.price, 1.75);

    // Spot marker — a small dot + horizontal dashed line at the latest close.
    if (spot != null && Number.isFinite(spot)) {
      const lastIdx = closes.length - 1;
      const py = y(spot);
      ctx.strokeStyle = "rgba(230,237,243,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, py);
      ctx.lineTo(cssW - padR, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.price;
      ctx.beginPath();
      ctx.arc(x(lastIdx), py, 3, 0, Math.PI * 2);
      ctx.fill();

      // Spot price label on the right edge.
      const label = spot >= 1000
        ? spot.toLocaleString("en-US", { maximumFractionDigits: 0 })
        : spot >= 1
          ? spot.toFixed(2)
          : spot.toFixed(4);
      ctx.font = "10px ui-monospace, monospace";
      const tw = ctx.measureText(label).width + 6;
      const lx = cssW - padR - tw;
      const ly = Math.max(padT + 6, Math.min(py - 6, cssH - padB - 10));
      ctx.fillStyle = "rgba(10,13,18,0.85)";
      ctx.fillRect(lx, ly - 8, tw, 14);
      ctx.fillStyle = COLORS.price;
      ctx.textAlign = "left";
      ctx.fillText(label, lx + 3, ly + 2);
    }

    // Min/max price labels on the left axis.
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "rgba(139,150,165,0.6)";
    ctx.textAlign = "left";
    const maxLabel =
      max >= 1000 ? max.toLocaleString("en-US", { maximumFractionDigits: 0 }) : max.toFixed(2);
    const minLabel =
      min >= 1000 ? min.toLocaleString("en-US", { maximumFractionDigits: 0 }) : min.toFixed(2);
    ctx.fillText(maxLabel, padL + 2, padT + 8);
    ctx.fillText(minLabel, padL + 2, cssH - padB - 2);
  }, [closes, ema55, ema200, spot, crossState, height]);

  return (
    <div className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height }}
        aria-label="Mini gráfico sparkline de precio con EMA55 y EMA200 superpuestas"
        role="img"
      />
      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3"
            style={{ background: COLORS.price }}
          />
          Precio
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3"
            style={{ background: COLORS.ema55 }}
          />
          EMA 55
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-3"
            style={{
              background: `repeating-linear-gradient(90deg, ${COLORS.ema200} 0 3px, transparent 3px 6px)`,
            }}
          />
          EMA 200
        </span>
        {bbUpper && bbLower && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-3"
              style={{
                background: `repeating-linear-gradient(90deg, ${COLORS.bollinger} 0 2px, transparent 2px 4px)`,
              }}
            />
            Bollinger
          </span>
        )}
        {vwap && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-3"
              style={{
                background: `repeating-linear-gradient(90deg, ${COLORS.vwap} 0 4px, transparent 4px 6px)`,
              }}
            />
            VWAP
          </span>
        )}
      </div>
    </div>
  );
}
