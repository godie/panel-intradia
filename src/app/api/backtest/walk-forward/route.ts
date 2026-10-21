/**
 * POST /api/backtest/walk-forward — run a walk-forward optimization.
 *
 * Walk-forward analysis splits the historical series into sliding IS+OOS
 * windows, runs the strategy on each segment over ONE pre-warmed indicator
 * series, and aggregates the OOS performance into robustness metrics
 * (efficiency, positive OOS rate, robustness rate, etc.) so the user can
 * tell whether the strategy is overfit or genuinely robust out-of-sample.
 *
 * Request body (JSON): same shape as /api/backtest plus:
 *   windowSize?: number,      // 220-800, default 500
 *   inSampleRatio?: number,   // 0.3-0.9, default 0.7
 *   stepSize?: number,        // optional, defaults to OOS size
 *                             // (clamped up to the OOS size in the engine
 *                             // so the same OOS data is never re-sampled)
 *
 * Response: WalkForwardResult JSON (see src/lib/backtest.ts).
 *
 * Errors:
 *   400 — missing/invalid params
 *   200 with `error` field — upstream fetch failure or insufficient data
 *         (returned inline so the client can render the error in the modal
 *         without a hard HTTP failure)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runWalkForward,
  emptyRobustness,
  type BacktestInterval,
} from "@/lib/backtest";
import {
  parseTradeLimits,
  resolveStrategy,
  VALID_INTERVALS,
} from "@/lib/backtest-request";
import { isValidSymbolFormat } from "@/lib/providers/symbols";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const symbolRaw = typeof body.symbol === "string" ? body.symbol : "";
  const symbol = symbolRaw.toUpperCase();
  const interval = typeof body.interval === "string" ? (body.interval as BacktestInterval) : "4h";

  if (!isValidSymbolFormat(symbol)) {
    return NextResponse.json(
      { error: "Invalid symbol. Use a single USDT pair (e.g. BTCUSDT)." },
      { status: 400 },
    );
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: `Invalid interval: ${interval}` }, { status: 400 });
  }

  // Resolve strategy: predefined (by id) or custom (from builder).
  const strategy = resolveStrategy(body);
  if (!strategy.ok) {
    return NextResponse.json({ error: strategy.error }, { status: 400 });
  }
  const { strategyRef, strategyId: strategyIdResolved, strategyName, action } = strategy;

  const {
    minConfidence,
    initialCapital,
    stopLossPct,
    takeProfitPct,
    maxHoldCandles,
    positionSizing,
    fixedFractionalPct,
    feeBps,
  } = parseTradeLimits(body);

  const windowSize =
    typeof body.windowSize === "number" ? clamp(body.windowSize, 220, 800) : 500;
  const inSampleRatio =
    typeof body.inSampleRatio === "number" ? clamp(body.inSampleRatio, 0.3, 0.9) : 0.7;
  const stepSize =
    typeof body.stepSize === "number" && Number.isFinite(body.stepSize) && body.stepSize > 0
      ? clamp(body.stepSize, 10, 800)
      : undefined;

  try {
    const result = await runWalkForward({
      symbol,
      interval,
      limit: 1000,
      strategy: strategyRef,
      action,
      minConfidence,
      initialCapital,
      stopLossPct,
      takeProfitPct,
      maxHoldCandles,
      positionSizing,
      fixedFractionalPct,
      feeBps,
      windowSize,
      inSampleRatio,
      stepSize,
    });
    return NextResponse.json({
      ...result,
      strategy: { id: strategyIdResolved, name: strategyName, action },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown walk-forward error.";
    return NextResponse.json(
      {
        symbol,
        interval,
        windows: [],
        robustness: emptyRobustness(),
        strategy: { id: strategyIdResolved, name: strategyName, action },
        params: {
          windowSize,
          inSampleRatio,
          minConfidence,
          initialCapital,
          stopLossPct,
          takeProfitPct,
          maxHoldCandles,
          positionSizing,
          fixedFractionalPct,
          feeBps,
        },
        error: message,
      },
      { status: 200 },
    );
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
