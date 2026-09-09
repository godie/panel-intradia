/**
 * POST /api/backtest — run a strategy backtest over historical klines.
 *
 * Request body (JSON):
 *   {
 *     symbol: string,        // e.g. "BTCUSDT"
 *     interval: "15m" | "1h" | "4h" | "1d",
 *     limit: number,         // candles to fetch (max 1000)
 *     // Either:
 *     strategyId?: string,    // predefined: "trend_buy" | "mean_reversion_buy" | "trend_short" | "hold"
 *     // Or:
 *     customStrategy?: CustomStrategy, // from the builder
 *     minConfidence?: number,
 *     initialCapital?: number,
 *     stopLossPct?: number,
 *     takeProfitPct?: number,
 *     maxHoldCandles?: number,
 *   }
 *
 * Response: BacktestResult JSON (see src/lib/backtest.ts).
 *
 * Errors:
 *   400 — missing/invalid params
 *   200 with `error` field — upstream fetch failure (returned inline so the
 *         client can render the error in the modal without a hard HTTP failure)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runBacktest,
  type BacktestParams,
  type BacktestInterval,
  type PositionSizing,
} from "@/lib/backtest";
import type { CustomStrategy } from "@/lib/custom-strategies";
import { customStrategyToStrategy } from "@/lib/custom-strategies";
import { STRATEGY_LIST } from "@/lib/strategies";
import type { StrategyAction } from "@/lib/strategies";
import { isSupportedSymbol } from "@/lib/providers/symbols";

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

  const symbol = typeof body.symbol === "string" ? body.symbol : "";
  const interval = typeof body.interval === "string" ? (body.interval as BacktestInterval) : "4h";
  const limit = typeof body.limit === "number" ? body.limit : 500;
  const strategyId = typeof body.strategyId === "string" ? body.strategyId : null;
  const customStrategyRaw = body.customStrategy;

  // Validate base params.
  if (!symbol || !isSupportedSymbol(symbol)) {
    return NextResponse.json(
      { error: `Unsupported symbol: ${symbol || "(missing)"}` },
      { status: 400 },
    );
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: `Invalid interval: ${interval}` }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit < 50 || limit > 1000) {
    return NextResponse.json(
      { error: "limit must be between 50 and 1000." },
      { status: 400 },
    );
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

  const params: BacktestParams = {
    symbol,
    interval,
    limit,
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
  };

  try {
    const result = await runBacktest(params);
    // Override the strategy display name with what we resolved (in case the
    // engine returned a raw id from a predefined strategy whose name is an
    // i18n key — the client should translate it).
    return NextResponse.json({
      ...result,
      strategy: { id: strategyIdResolved, name: strategyName, action },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown backtest error.";
    return NextResponse.json(
      {
        symbol,
        interval,
        candlesAnalyzed: 0,
        provider: "binance",
        trades: [],
        equityCurve: [],
        stats: {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalReturnPct: 0,
          maxDrawdownPct: 0,
          profitFactor: 0,
          avgHoldCandles: 0,
          bestTradePct: 0,
          worstTradePct: 0,
          finalEquity: initialCapital,
          totalFees: 0,
          avgPositionSizePct: 0,
        },
        strategy: { id: strategyIdResolved, name: strategyName, action },
        params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
        error: message,
      },
      { status: 200 },
    );
  }
}
