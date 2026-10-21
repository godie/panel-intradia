import { describe, expect, it } from "vitest";
import type { BacktestResult } from "@/lib/backtest";
import {
  RESULT_JSON_CAP_BYTES,
  parseStoredResult,
  serializeRun,
  summarizeResult,
  truncateResultJson,
} from "@/lib/backtest-db";

/** BacktestResult mínimo pero bien formado (solo lo que usan los helpers). */
function makeResult(opts?: {
  trades?: number;
  winRate?: number;
  totalReturnPct?: number;
  maxDrawdownPct?: number;
  profitFactor?: number;
}): BacktestResult {
  const n = opts?.trades ?? 3;
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    candlesAnalyzed: 500,
    provider: "binance",
    trades: Array.from({ length: n }, (_, i) => ({
      entryIndex: i * 10,
      exitIndex: i * 10 + 5,
      entryPrice: 100 + i,
      exitPrice: 105 + i,
      entryTime: 1_700_000_000_000 + i * 10_000,
      exitTime: 1_700_005_000_000 + i * 10_000,
      pnl: 50,
      pnlPct: 5,
      holdCandles: 5,
      exitReason: "take_profit",
      action: "BUY",
      positionSizePct: 100,
      feesPaid: 2,
    })),
    equityCurve: [],
    stats: {
      totalTrades: n,
      wins: n,
      losses: 0,
      winRate: opts?.winRate ?? 100,
      totalReturnPct: opts?.totalReturnPct ?? 15,
      maxDrawdownPct: opts?.maxDrawdownPct ?? 3,
      profitFactor: opts?.profitFactor ?? 2,
      avgHoldCandles: 5,
      bestTradePct: 5,
      worstTradePct: 5,
      finalEquity: 11_500,
      totalFees: 6,
      avgPositionSizePct: 100,
      sharpeRatio: NaN,
      sortinoRatio: NaN,
      calmarRatio: NaN,
      maxWinStreak: n,
      maxLossStreak: 0,
      avgWinPct: 5,
      avgLossPct: 0,
      expectancyPct: 5,
    },
    durationBuckets: [],
    strategy: { id: "trend_buy", name: "Trend Buy", action: "BUY" },
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

describe("summarizeResult", () => {
  it("proyecta los 5 índices del stats", () => {
    expect(summarizeResult(makeResult().stats)).toEqual({
      totalTrades: 3,
      winRatePct: 100,
      totalReturnPct: 15,
      maxDrawdownPct: 3,
      profitFactor: 2,
    });
  });

  it("reemplaza NaN e Infinity por 0 (SQLite no admite no-finitos)", () => {
    const s = summarizeResult({
      ...makeResult().stats,
      winRate: NaN,
      profitFactor: Infinity,
    });
    expect(s.winRatePct).toBe(0);
    expect(s.profitFactor).toBe(0);
    expect(Number.isFinite(s.maxDrawdownPct)).toBe(true);
    expect(Number.isFinite(s.totalReturnPct)).toBe(true);
  });
});

describe("truncateResultJson", () => {
  it("no trunca un payload bajo el cap", () => {
    const out = truncateResultJson(makeResult({ trades: 3 }));
    expect(out.truncated).toBe(false);
    expect(out.keptTrades).toBe(3);
    expect(out.json.length).toBeLessThan(RESULT_JSON_CAP_BYTES);
    expect(JSON.parse(out.json).stats.totalTrades).toBe(3);
  });

  it("trunca trades de forma determinística hasta caber en el cap", () => {
    const result = makeResult({ trades: 200 });
    const out = truncateResultJson(result, 2_000);
    expect(out.truncated).toBe(true);
    expect(out.keptTrades).toBeLessThan(200);
    const parsed = JSON.parse(out.json) as {
      trades: unknown[];
      stats: { totalTrades: number };
      _truncation?: { originalTrades: number; keptTrades: number };
    };
    expect(parsed.trades.length).toBe(out.keptTrades);
    // NUNCA fabrica datos: los stats conservan el conteo original y la
    // metadata de truncación explica la diferencia.
    expect(parsed.stats.totalTrades).toBe(200);
    expect(parsed._truncation).toEqual({
      originalTrades: 200,
      keptTrades: out.keptTrades,
    });
  });

  it("determinismo: mismo input produce el mismo kept", () => {
    const a = truncateResultJson(makeResult({ trades: 200 }), 2_000);
    const b = truncateResultJson(makeResult({ trades: 200 }), 2_000);
    expect(b.keptTrades).toBe(a.keptTrades);
    expect(b.json).toBe(a.json);
  });

  it("cap absurdamente chico: cae a trades=[] sin lanzar", () => {
    const out = truncateResultJson(makeResult({ trades: 50 }), 10);
    expect(out.truncated).toBe(true);
    expect(out.keptTrades).toBe(0);
  });
});

describe("serializeRun", () => {
  it("combina summary + truncado", () => {
    const summary = summarizeResult(makeResult().stats);
    const out = serializeRun(summary, makeResult({ trades: 3 }));
    expect(out.summary).toEqual(summary);
    expect(out.truncated).toBe(false);
    expect(out.keptTrades).toBe(3);
    expect(() => JSON.parse(out.resultJson)).not.toThrow();
  });
});

describe("parseStoredResult", () => {
  it("round-trip: serialize → parse devuelve el resultado intacto", () => {
    const out = parseStoredResult(truncateResultJson(makeResult({ trades: 3 })).json);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.stats.totalTrades).toBe(3);
      expect(out.truncatedMeta).toBeNull();
    }
  });

  it("recupera la metadata de truncación si existe", () => {
    const json = truncateResultJson(makeResult({ trades: 200 }), 2_000).json;
    const out = parseStoredResult(json);
    expect(out.ok).toBe(true);
    if (out.ok && out.truncatedMeta) {
      expect(out.truncatedMeta.originalTrades).toBe(200);
      expect(out.truncatedMeta.keptTrades).toBe(out.result.trades.length);
    }
  });

  it("JSON inválido → ok:false con razón", () => {
    const out = parseStoredResult("{not json");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("JSON");
  });

  it("JSON válido pero sin forma de BacktestResult → ok:false", () => {
    const out = parseStoredResult(JSON.stringify({ hello: 1 }));
    expect(out.ok).toBe(false);
  });

  it("campos numéricos no-numéricos en el stats del payload → ok:false", () => {
    const r = JSON.parse(truncateResultJson(makeResult({ trades: 1 }), 50_000).json) as {
      stats: Record<string, unknown>;
    };
    r.stats.winRate = "no-es-numérico";
    const out = parseStoredResult(JSON.stringify(r));
    expect(out.ok).toBe(false);
  });
});
