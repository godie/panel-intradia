/**
 * POST /api/backtest/walk-forward — run a walk-forward optimization.
 *
 * Walk-forward analysis splits the historical series into N contiguous
 * IS+OOS windows, runs the strategy on each segment, and aggregates the
 * OOS performance into robustness metrics (efficiency, positive OOS rate,
 * robustness rate, etc.) so the user can tell whether the strategy is
 * overfit or genuinely robust out-of-sample.
 *
 * Request body (JSON): same shape as /api/backtest plus:
 *   windowSize?: number,      // 220-800, default 500
 *   inSampleRatio?: number,   // 0.3-0.9, default 0.7
 *   stepSize?: number,        // optional, defaults to OOS size
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
  type BacktestInterval,
  type PositionSizing,
} from "@/lib/backtest";
import type { CustomStrategy } from "@/lib/custom-strategies";
import { customStrategyToStrategy } from "@/lib/custom-strategies";
import { STRATEGY_LIST } from "@/lib/strategies";
import type { StrategyAction } from "@/lib/strategies";
import { isValidSymbolFormat } from "@/lib/providers/symbols";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_INTERVALS: BacktestInterval[] = ["15m", "1h", "4h", "1d"];
const VALID_ACTIONS: StrategyAction[] = ["BUY", "HOLD", "SHORT", "WAIT"];
const VALID_SIZING: PositionSizing[] = ["full", "fixed_fractional", "half_kelly", "kelly"];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

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
  const strategyId = typeof body.strategyId === "string" ? body.strategyId : null;
  const customStrategyRaw = body.customStrategy;

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
  let strategyIdResolved: string;
  let strategyName: string;
  let action: StrategyAction;

  let strategyRef: ReturnType<typeof customStrategyToStrategy> | (typeof STRATEGY_LIST)[number];

  if (strategyId) {
    const predefined = STRATEGY_LIST.find((s) => s.id === strategyId);
    if (!predefined) {
      return NextResponse.json(
        { error: `Unknown predefined strategy: ${strategyId}` },
        { status: 400 },
      );
    }
    strategyRef = predefined;
    strategyIdResolved = predefined.id;
    strategyName = predefined.name;
    action = predefined.targetAction;
  } else if (customStrategyRaw && typeof customStrategyRaw === "object") {
    const s = customStrategyRaw as Record<string, unknown>;
    if (
      typeof s.id !== "string" ||
      typeof s.name !== "string" ||
      typeof s.action !== "string" ||
      !VALID_ACTIONS.includes(s.action as StrategyAction) ||
      !Array.isArray(s.conditions)
    ) {
      return NextResponse.json(
        { error: "Invalid custom strategy shape." },
        { status: 400 },
      );
    }
    const custom: CustomStrategy = {
      id: s.id,
      name: s.name,
      action: s.action as StrategyAction,
      conditions: (s.conditions as CustomStrategy["conditions"]).map((c) => ({
        type: c.type,
        threshold: typeof c.threshold === "number" ? c.threshold : undefined,
      })),
      createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
    };
    strategyRef = customStrategyToStrategy(custom);
    strategyIdResolved = custom.id;
    strategyName = custom.name;
    action = custom.action;
  } else {
    return NextResponse.json(
      { error: "Missing strategy: provide either strategyId or customStrategy." },
      { status: 400 },
    );
  }

  const minConfidence =
    typeof body.minConfidence === "number" ? clamp(body.minConfidence, 10, 100) : 60;
  const initialCapital =
    typeof body.initialCapital === "number"
      ? clamp(body.initialCapital, 100, 1_000_000_000)
      : 10_000;
  const stopLossPct =
    typeof body.stopLossPct === "number" ? clamp(body.stopLossPct, 0.1, 50) : 5;
  const takeProfitPct =
    typeof body.takeProfitPct === "number" ? clamp(body.takeProfitPct, 0.1, 200) : 10;
  const maxHoldCandles =
    typeof body.maxHoldCandles === "number" ? clamp(body.maxHoldCandles, 1, 500) : 50;
  const positionSizing: PositionSizing =
    typeof body.positionSizing === "string" && VALID_SIZING.includes(body.positionSizing as PositionSizing)
      ? (body.positionSizing as PositionSizing)
      : "full";
  const fixedFractionalPct =
    typeof body.fixedFractionalPct === "number"
      ? clamp(body.fixedFractionalPct, 1, 100)
      : 25;
  const feeBps =
    typeof body.feeBps === "number" ? clamp(body.feeBps, 0, 500) : 10;

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
        robustness: {
          avgOosReturnPct: 0,
          avgIsReturnPct: 0,
          efficiency: 0,
          positiveOosRate: 0,
          robustnessRate: 0,
          avgOosSharpe: 0,
          avgOosMaxDD: 0,
          totalOosTrades: 0,
        },
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
