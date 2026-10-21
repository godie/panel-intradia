import { describe, expect, it } from "vitest";
import type { BacktestResult } from "@/lib/backtest";
import { buildComparisonRows, type CompareEntry } from "@/lib/backtest-compare";
import { summarizeResult } from "@/lib/backtest-db";

function makeResult(
  id: string,
  stats: Partial<BacktestResult["stats"]>,
): BacktestResult {
  const s = {
    totalTrades: 10,
    wins: 6,
    losses: 4,
    winRate: 60,
    totalReturnPct: 12,
    maxDrawdownPct: 4,
    profitFactor: 1.5,
    avgHoldCandles: 5,
    bestTradePct: 5,
    worstTradePct: -5,
    finalEquity: 11_200,
    totalFees: 20,
    avgPositionSizePct: 100,
    sharpeRatio: NaN,
    sortinoRatio: NaN,
    calmarRatio: NaN,
    maxWinStreak: 3,
    maxLossStreak: 2,
    avgWinPct: 4,
    avgLossPct: -2,
    expectancyPct: 2,
    ...stats,
  };
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    candlesAnalyzed: 500,
    provider: "binance",
    trades: [],
    equityCurve: [],
    stats: s,
    durationBuckets: [],
    strategy: { id, name: id, action: "BUY" },
    params: {
      minConfidence: 60,
      initialCapital: 10_000,
      stopLossPct: 5,
      takeProfitPct: 10,
      maxHoldCandles: 50,
      positionSizing: "full",
      fixedFractionalPct: 25,
      feeBps: 10,
    },
  } as unknown as BacktestResult;
}

function entry(
  strategyId: string,
  over: Partial<CompareEntry> & { stats?: Partial<BacktestResult["stats"]> } = {},
): CompareEntry {
  const { stats, ...rest } = over;
  return {
    strategyId,
    strategyName: strategyId,
    action: "BUY",
    isCustom: false,
    error: null,
    result: stats ? makeResult(strategyId, stats) : null,
    ...rest,
  };
}

describe("buildComparisonRows", () => {
  it("lista vacía → [] y no lanza", () => {
    expect(buildComparisonRows([])).toEqual([]);
  });

  it("entrada con error → fila con summary null y sin best", () => {
    const rows = buildComparisonRows([entry("bad", { error: "upstream 502" })]);
    expect(rows[0]).toMatchObject({
      strategyId: "bad",
      error: "upstream 502",
      summary: null,
      best: {
        winRate: false,
        totalReturn: false,
        maxDrawdown: false,
        profitFactor: false,
      },
    });
  });

  it("un solo elemento válido → es best en las 4 métricas", () => {
    const rows = buildComparisonRows([entry("solo", { stats: { winRate: 50 } })]);
    expect(rows[0].summary).toEqual(
      summarizeResult(makeResult("solo", { winRate: 50 }).stats),
    );
    expect(rows[0].best).toEqual({
      winRate: true,
      totalReturn: true,
      maxDrawdown: true,
      profitFactor: true,
    });
  });

  it("mejores por columna: winRate/retorno/FP máx, drawdown MÍNIMO", () => {
    const rows = buildComparisonRows([
      entry("a", {
        stats: { winRate: 60, totalReturnPct: 12, maxDrawdownPct: 4, profitFactor: 1.5 },
      }),
      entry("b", {
        stats: { winRate: 80, totalReturnPct: 12, maxDrawdownPct: 8, profitFactor: 2.0 },
      }),
      entry("c", {
        stats: { winRate: 40, totalReturnPct: 40, maxDrawdownPct: 2, profitFactor: 0.5 },
      }),
    ]);
    expect(rows[0].best).toEqual({
      winRate: false,
      totalReturn: false,
      maxDrawdown: false,
      profitFactor: false,
    });
    expect(rows[1].best).toEqual({
      winRate: true,
      totalReturn: false,
      maxDrawdown: false,
      profitFactor: true,
    });
    expect(rows[2].best).toEqual({
      winRate: false,
      totalReturn: true,
      maxDrawdown: true,
      profitFactor: false,
    });
  });

  it("empate absoluto → todos los empatados llevan best", () => {
    const rows = buildComparisonRows([
      entry("a", { stats: { winRate: 50 } }),
      entry("b", { stats: { winRate: 50 } }),
    ]);
    expect(rows[0].best.winRate).toBe(true);
    expect(rows[1].best.winRate).toBe(true);
  });

  it("filas con error quedan fuera de la competencia de best", () => {
    const rows = buildComparisonRows([
      entry("ok", { stats: { winRate: 30 } }),
      entry("ko", { error: "boom", result: null }),
    ]);
    expect(rows[0].best.winRate).toBe(true);
    expect(rows[1].best.winRate).toBe(false);
  });

  it("respeta isCustom y las 10 entradas", () => {
    const many: CompareEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry(`s${i}`, { isCustom: true, stats: { winRate: i } }),
    );
    const rows = buildComparisonRows(many);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.isCustom)).toBe(true);
  });
});
