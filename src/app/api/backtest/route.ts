/**
 * POST /api/backtest — run a strategy backtest over historical klines.
 *
 * Request body (JSON):
 *   {
 *     symbol: string,        // e.g. "BTCUSDT"
 *     interval: "15m" | "1h" | "4h" | "1d",
 *     limit: number,         // candles to fetch (max 1000)
 *     // Either:
 *     strategyId?: string,    // predefined id — see STRATEGY_LIST in src/lib/strategies.ts
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
  runMultiSymbolBacktest,
  emptyStats,
  type BacktestParams,
} from "@/lib/backtest";
import type { BacktestInterval } from "@/lib/backtest";
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

  const symbol = typeof body.symbol === "string" ? body.symbol : "";
  const symbolsRaw = body.symbols;
  const interval = typeof body.interval === "string" ? (body.interval as BacktestInterval) : "4h";
  const limit = typeof body.limit === "number" ? body.limit : 500;

  // Parse symbols: support both single `symbol` and multi `symbols[]`.
  const isMultiSymbol = Array.isArray(symbolsRaw) && symbolsRaw.length > 0;
  const symbols: string[] = isMultiSymbol
    ? (symbolsRaw as unknown[]).filter((s): s is string => typeof s === "string" && isValidSymbolFormat(s.toUpperCase())).map((s) => s.toUpperCase())
    : [symbol.toUpperCase()].filter((s) => isValidSymbolFormat(s));

  // Validate base params.
  if (symbols.length === 0) {
    return NextResponse.json(
      { error: `No valid symbols provided. Use a single USDT pair (e.g. BTCUSDT) or a symbols[] array.` },
      { status: 400 },
    );
  }
  if (isMultiSymbol && symbols.length > 10) {
    return NextResponse.json(
      { error: "Maximum 10 symbols allowed in multi-symbol mode." },
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

  try {
    if (isMultiSymbol) {
      // Multi-symbol mode: run across all symbols, return aggregated result.
      const multiResult = await runMultiSymbolBacktest({
        symbols,
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
      });
      return NextResponse.json({
        ...multiResult,
        strategy: { id: strategyIdResolved, name: strategyName, action },
        multiSymbol: true,
      });
    }
    // Single-symbol mode (backward compatible).
    const params: BacktestParams = {
      symbol: symbols[0],
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
        symbol: symbols[0] ?? "",
        symbols,
        interval,
        candlesAnalyzed: 0,
        provider: "binance",
        trades: [],
        equityCurve: [],
        stats: emptyStats(initialCapital),
        durationBuckets: [],
        strategy: { id: strategyIdResolved, name: strategyName, action },
        params: { minConfidence, initialCapital, stopLossPct, takeProfitPct, maxHoldCandles, positionSizing, fixedFractionalPct, feeBps },
        error: message,
      },
      { status: 200 },
    );
  }
}
