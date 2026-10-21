"use client";

import { useEffect, useRef } from "react";
import type { BacktestResult } from "@/lib/backtest";
import { formatNumber, formatTime } from "./format";

type Props = {
  /** Full engine result — the component reads equityCurve + params. */
  result: BacktestResult;
  /**
   * Tailwind sizing/rounded classes for the canvas. Default matches the
   * modal's look (h-44); the /backtest page passes a taller height.
   */
  className?: string;
  /** Accessible label — callers pass it translated (t("backtest.equityCurve")). */
  ariaLabel?: string;
};

/**
 * EquityCurveCanvas — HiDPI canvas equity chart, extracted VERBATIM from
 * BacktestModal (repo rule: Canvas API, no chart libraries). Heights scale
 * to the canvas box; drawing logic is unchanged.
 */
export function EquityCurveCanvas({ result, className, ariaLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw equity curve on the canvas.
  useEffect(() => {
    if (result.equityCurve.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Background.
    ctx.fillStyle = "rgba(10,13,18,0.4)";
    ctx.fillRect(0, 0, cssW, cssH);

    const curve = result.equityCurve;
    const padL = 44;
    const padR = 12;
    const padT = 12;
    const padB = 22;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;

    // Y range: include a bit of headroom.
    const equities = curve.map((p) => p.equity);
    let yMin = Math.min(...equities, result.params.initialCapital);
    let yMax = Math.max(...equities, result.params.initialCapital);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) {
      yMin = result.params.initialCapital * 0.95;
      yMax = result.params.initialCapital * 1.05;
    }
    const yPad = (yMax - yMin) * 0.08;
    yMin -= yPad;
    yMax += yPad;

    const x = (i: number) => padL + (i / (curve.length - 1)) * plotW;
    const y = (val: number) => padT + (1 - (val - yMin) / (yMax - yMin)) * plotH;

    // Horizontal gridlines + Y-axis labels.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "rgba(139,150,165,0.6)";
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const yPos = padT + (plotH * i) / gridLines;
      ctx.beginPath();
      ctx.moveTo(padL, yPos);
      ctx.lineTo(padL + plotW, yPos);
      ctx.stroke();
      const val = yMax - ((yMax - yMin) * i) / gridLines;
      ctx.textAlign = "right";
      ctx.fillText(`$${formatNumber(val)}`, padL - 6, yPos + 3);
    }

    // Initial capital baseline.
    const baselineY = y(result.params.initialCapital);
    ctx.strokeStyle = "rgba(139,150,165,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, baselineY);
    ctx.lineTo(padL + plotW, baselineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // In-position regions (light shaded backgrounds).
    ctx.fillStyle = "rgba(95,191,143,0.06)";
    let regionStart: number | null = null;
    for (let i = 0; i < curve.length; i++) {
      const inPos = curve[i].inPosition;
      if (inPos && regionStart === null) regionStart = i;
      if ((!inPos || i === curve.length - 1) && regionStart !== null) {
        const end = inPos ? i : i - 1;
        if (end >= regionStart) {
          ctx.fillRect(x(regionStart), padT, x(end) - x(regionStart), plotH);
        }
        regionStart = null;
      }
    }

    // Gradient fill under the equity curve.
    const finalEq = curve[curve.length - 1].equity;
    const isPositive = finalEq >= result.params.initialCapital;
    const lineColor = isPositive ? "#5fbf8f" : "#e2604f";
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    if (isPositive) {
      grad.addColorStop(0, "rgba(95,191,143,0.25)");
      grad.addColorStop(1, "rgba(95,191,143,0.01)");
    } else {
      grad.addColorStop(0, "rgba(226,96,79,0.25)");
      grad.addColorStop(1, "rgba(226,96,79,0.01)");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x(0), padT + plotH);
    for (let i = 0; i < curve.length; i++) {
      ctx.lineTo(x(i), y(curve[i].equity));
    }
    ctx.lineTo(x(curve.length - 1), padT + plotH);
    ctx.closePath();
    ctx.fill();

    // Equity line — colored by direction vs initial capital.
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const px = x(i);
      const py = y(curve[i].equity);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = lineColor;
    ctx.stroke();

    // Final equity marker dot.
    ctx.fillStyle = finalEq >= result.params.initialCapital ? "#5fbf8f" : "#e2604f";
    ctx.beginPath();
    ctx.arc(x(curve.length - 1), y(finalEq), 3.5, 0, Math.PI * 2);
    ctx.fill();

    // X-axis labels: first, middle, last timestamps.
    ctx.fillStyle = "rgba(139,150,165,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(formatTime(curve[0].time), padL, cssH - 6);
    ctx.textAlign = "center";
    if (curve.length > 2) {
      ctx.fillText(
        formatTime(curve[Math.floor(curve.length / 2)].time),
        padL + plotW / 2,
        cssH - 6,
      );
    }
    ctx.textAlign = "right";
    ctx.fillText(formatTime(curve[curve.length - 1].time), padL + plotW, cssH - 6);
  }, [result]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "w-full h-44 rounded-md border border-white/8 bg-background/40"}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
    />
  );
}
