/**
 * POST /api/backtest/compare — correr N estrategias (≤10) contra el MISMO
 * config (símbolo × intervalo × velas × tradeLimits) y devolver los
 * resultados crudos + las filas de comparación listas para la UI.
 *
 * Server-driven por diseño: fetchKlinesCached baja la historia UNA VEZ y la
 * inyecta en cada runBacktest via preloadedKlines — N estrategias NO
 * significan N descargas de Binance. Los errores por estrategia quedan
 * inline en esa entry (nunca abortan las demás, nunca datos fabricados).
 */

import { NextRequest, NextResponse } from "next/server";
import type { BacktestInterval, BacktestParams, BacktestResult } from "@/lib/backtest";
import type { Strategy, StrategyAction } from "@/lib/strategies";
import {
  parseCompareConfig,
  parseStrategyRefs,
  resolveStrategy,
} from "@/lib/backtest-request";
import { buildComparisonRows, type CompareEntry } from "@/lib/backtest-compare";
import { fetchKlinesCached, runBacktest } from "@/lib/backtest";
import type { Kline, ProviderId } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolvedStrategy =
  | {
      ok: true;
      strategyRef: Strategy;
      strategyId: string;
      strategyName: string;
      action: StrategyAction;
      isCustom: boolean;
    }
  | { ok: false; error: string };

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const cfg = parseCompareConfig(body);
  if (!cfg.ok) {
    return NextResponse.json({ error: cfg.error }, { status: 400 });
  }
  const refs = parseStrategyRefs(body);
  if (!refs.ok) {
    return NextResponse.json({ error: refs.error }, { status: 400 });
  }

  // Resolución por ref: reusa resolveStrategy (mismo contrato de
  // strategyId/customStrategy que la route /api/backtest ya valida).
  const resolved: ResolvedStrategy[] = refs.refs.map((ref) => {
    const s = resolveStrategy(ref as Record<string, unknown>);
    if (!s.ok) return { ok: false, error: s.error };
    return {
      ok: true,
      strategyRef: s.strategyRef,
      strategyId: s.strategyId,
      strategyName: s.strategyName,
      action: s.action,
      isCustom: "customStrategy" in ref,
    };
  });

  // UNA descarga compartida (cache 60s). Una falla global se propaga como
  // error inline a TODAS las entries (ninguna corrida existe en ese caso).
  let klines: Kline[] | null = null;
  let provider: ProviderId | null = null;
  let upstreamError: string | null = null;
  try {
    const res = await fetchKlinesCached(
      cfg.config.symbol,
      cfg.config.interval as BacktestInterval,
      cfg.config.limit,
    );
    klines = res.klines;
    provider = res.provider;
  } catch {
    upstreamError = "Failed to fetch historical klines from upstream provider.";
  }

  const results: CompareEntry[] = [];
  for (const r of resolved) {
    if (!r.ok) {
      // Estrategia no resoluble: fila de error sin competir (buildComparisonRows).
      results.push({
        strategyId: "unknown",
        strategyName: "unknown",
        action: "UNKNOWN",
        isCustom: false,
        error: r.error,
        result: null,
      });
      continue;
    }
    if (upstreamError != null || klines == null) {
      results.push({
        strategyId: r.strategyId,
        strategyName: r.strategyName,
        action: r.action,
        isCustom: r.isCustom,
        error: upstreamError,
        result: null,
      });
      continue;
    }
    const params: BacktestParams = {
      symbol: cfg.config.symbol,
      interval: cfg.config.interval as BacktestInterval,
      limit: cfg.config.limit,
      strategy: r.strategyRef,
      action: r.action,
      minConfidence: cfg.config.tradeLimits.minConfidence,
      initialCapital: cfg.config.tradeLimits.initialCapital,
      stopLossPct: cfg.config.tradeLimits.stopLossPct,
      takeProfitPct: cfg.config.tradeLimits.takeProfitPct,
      maxHoldCandles: cfg.config.tradeLimits.maxHoldCandles,
      positionSizing: cfg.config.tradeLimits.positionSizing,
      fixedFractionalPct: cfg.config.tradeLimits.fixedFractionalPct,
      feeBps: cfg.config.tradeLimits.feeBps,
      preloadedKlines: klines,
      preloadedProvider: provider ?? undefined,
    };
    const result: BacktestResult = await runBacktest(params);
    results.push({
      strategyId: r.strategyId,
      strategyName: r.strategyName,
      action: r.action,
      isCustom: r.isCustom,
      error: result.error ?? null,
      result: result.error ? null : result,
    });
  }

  return NextResponse.json({ results, rows: buildComparisonRows(results) });
}
