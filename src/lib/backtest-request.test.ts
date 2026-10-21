import { describe, it, expect } from "vitest";
import {
  parseCompareConfig,
  parseCustomStrategy,
  parseStrategyRefs,
  parseTradeLimits,
  resolveStrategy,
  VALID_INTERVALS,
  clampNumber,
} from "./backtest-request";

describe("parseStrategyRefs", () => {
  const base = { minConfidence: 60 };
  void base;

  it("sin strategies válido (vacío / no-array) → ok:false", () => {
    for (const body of [{ strategies: [] }, {}, { strategies: "trend_buy" }]) {
      const out = parseStrategyRefs(body);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toContain("strategies");
    }
  });

  it(">10 estrategias → ok:false con el cap explícito en el mensaje", () => {
    const many = Array.from({ length: 11 }, () => "trend_buy");
    const out = parseStrategyRefs({ strategies: many });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("10");
  });

  it("ids predefinidos pasan por strategyId verbatim (resolveStrategy es case-sensitive)", () => {
    const out = parseStrategyRefs({ strategies: ["trend_buy", " breakout_short "] });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.refs).toEqual([{ strategyId: "trend_buy" }, { strategyId: "breakout_short" }]);
    }
  });

  it("customStrategy válido pasa por parseCustomStrategy", () => {
    const custom = {
      id: "c1",
      name: "Mi LX",
      action: "BUY",
      conditions: [{ type: "rsi_below", threshold: 30 }],
    };
    const out = parseStrategyRefs({ strategies: [custom] });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.refs[0]).toEqual({
        customStrategy: { ...custom, createdAt: expect.any(Number) },
      });
    }
  });

  it("cualquier item inválido rechaza TODO el pedido (nunca silencioso)", () => {
    // Shape inválido: sin condiciones (la única que tenía no era string.type).
    const bad = [
      { id: "c1", name: "x", action: "BUY", conditions: [] },
      { id: "c1", name: "x", action: "BUY", conditions: [{ type: 123 }] },
    ];
    expect(parseStrategyRefs({ strategies: bad }).ok).toBe(false);
    expect(parseStrategyRefs({ strategies: [42] }).ok).toBe(false);
    expect(parseStrategyRefs({ strategies: [null] }).ok).toBe(false);
    expect(
      parseStrategyRefs({ strategies: ["trend_buy", { no: true }] }).ok,
    ).toBe(false);
  });
});

describe("parseCompareConfig", () => {
  it("symbol inválido o faltante → ok:false", () => {
    for (const body of [{}, { symbol: "corto" }, { symbol: "BTC/USD" }]) {
      expect(parseCompareConfig(body).ok).toBe(false);
    }
  });

  it("interval fuera de VALID_INTERVALS → ok:false", () => {
    expect(parseCompareConfig({ symbol: "BTCUSDT", interval: "9m" }).ok).toBe(false);
  });

  it("limit numérico fuera de [50,1000] → ok:false; string cae al default (igual que /api/backtest)", () => {
    for (const limit of [49, 1500]) {
      expect(parseCompareConfig({ symbol: "BTCUSDT", limit }).ok).toBe(false);
    }
    expect(parseCompareConfig({ symbol: "BTCUSDT", limit: "600" })).toEqual({
      ok: true,
      config: expect.objectContaining({ limit: 500 }),
    });
  });

  it("caso mínimo válido: defaults interval 4h / limit 500 y tradeLimits de parseTradeLimits", () => {
    const out = parseCompareConfig({ symbol: "ethusdt" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.config.symbol).toBe("ETHUSDT");
      expect(out.config.interval).toBe("4h");
      expect(out.config.limit).toBe(500);
      expect(out.config.tradeLimits.minConfidence).toBe(60);
      expect(out.config.tradeLimits.positionSizing).toBe("full");
    }
  });
});

describe("clampNumber", () => {
  it("clamps into the range", () => {
    expect(clampNumber(150, 10, 100)).toBe(100);
    expect(clampNumber(5, 10, 100)).toBe(10);
    expect(clampNumber(50, 10, 100)).toBe(50);
  });
});

describe("VALID_INTERVALS", () => {
  it("covers the accepted intervals", () => {
    expect(VALID_INTERVALS).toEqual(["15m", "1h", "4h", "1d"]);
  });
});

describe("parseTradeLimits", () => {
  it("applies the documented defaults", () => {
    expect(parseTradeLimits({})).toEqual({
      minConfidence: 60,
      initialCapital: 10_000,
      stopLossPct: 5,
      takeProfitPct: 10,
      maxHoldCandles: 50,
      positionSizing: "full",
      fixedFractionalPct: 25,
      feeBps: 10,
    });
  });

  it("clamps numeric fields into their ranges", () => {
    const limits = parseTradeLimits({
      minConfidence: 500,
      initialCapital: 999_999_999_999,
      stopLossPct: 1000,
      takeProfitPct: 5000,
      maxHoldCandles: -20,
      fixedFractionalPct: 0,
      feeBps: 80_000,
    });
    expect(limits.minConfidence).toBe(100);
    expect(limits.initialCapital).toBe(1_000_000_000);
    expect(limits.stopLossPct).toBe(50);
    expect(limits.takeProfitPct).toBe(200);
    expect(limits.maxHoldCandles).toBe(1);
    expect(limits.fixedFractionalPct).toBe(1);
    expect(limits.feeBps).toBe(500);
  });

  it("falls back to 'full' on an unknown positionSizing", () => {
    const limits = parseTradeLimits({ positionSizing: "all_in" });
    expect(limits.positionSizing).toBe("full");
  });

  it("keeps valid sizing modes", () => {
    const limits = parseTradeLimits({ positionSizing: "half_kelly" });
    expect(limits.positionSizing).toBe("half_kelly");
  });

  it("ignores non-number values (they are not a JSON number)", () => {
    expect(parseTradeLimits({ minConfidence: "90" }).minConfidence).toBe(60);
    expect(parseTradeLimits({ stopLossPct: null }).stopLossPct).toBe(5);
  });
});

describe("resolveStrategy", () => {
  it("resolves a predefined strategy by id", () => {
    const r = resolveStrategy({ strategyId: "trend_buy" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategyId).toBe("trend_buy");
    expect(r.action).toBe(r.strategyRef.targetAction);
  });

  it("rejects an unknown predefined strategy id", () => {
    const r = resolveStrategy({ strategyId: "moonshot" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("moonshot");
  });

  it("rejects a body without any strategy", () => {
    const r = resolveStrategy({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Missing strategy");
  });

  it("resolves a valid custom strategy", () => {
    const r = resolveStrategy({
      customStrategy: {
        id: "my_strat",
        name: "My Strat",
        action: "SHORT",
        conditions: [{ type: "rsi_below", threshold: 30 }],
        createdAt: 1234,
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategyId).toBe("my_strat");
    expect(r.action).toBe("SHORT");
    expect(r.strategyRef.id).toBe("my_strat");
  });

  it("rejects a custom strategy with malformed shape fields", () => {
    const r = resolveStrategy({ customStrategy: { id: "x" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Invalid custom strategy");
  });

  it("rejects (not crashes) when no condition entry is a usable object", () => {
    // Used to TypeError inside conditions.map() and surface as HTTP 500.
    const r = resolveStrategy({
      customStrategy: {
        id: "x",
        name: "x",
        action: "BUY",
        conditions: [null, "rsi_below"],
        createdAt: 1,
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Invalid custom strategy");
  });

  it("keeps usable entries surrounded by invalid ones", () => {
    const r = resolveStrategy({
      customStrategy: {
        id: "x",
        name: "x",
        action: "BUY",
        conditions: [null, { type: "macd_bullish" }],
        createdAt: 1,
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategyRef.id).toBe("x");
  });

  it("validates actions against the four allowed values", () => {
    const r = resolveStrategy({
      customStrategy: {
        id: "x",
        name: "x",
        action: "MOON",
        conditions: [{ type: "bollinger_squeeze" }],
        createdAt: 1,
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe("parseCustomStrategy", () => {
  it("keeps valid conditions and drops untyped ones", () => {
    const r = parseCustomStrategy({
      id: "s1",
      name: "S1",
      action: "BUY",
      conditions: [
        { type: "rsi_below", threshold: 30 },
        null,
        { type: "bollinger_squeeze" },
        42,
      ],
      createdAt: 7,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategy.conditions).toHaveLength(2);
    expect(r.strategy.conditions[0]).toEqual({
      type: "rsi_below",
      threshold: 30,
    });
    expect(r.strategy.conditions[1]).toEqual({ type: "bollinger_squeeze" });
    expect(r.strategy.createdAt).toBe(7);
  });

  it("defaults createdAt to now when absent", () => {
    const r = parseCustomStrategy({
      id: "s",
      name: "s",
      action: "HOLD",
      conditions: [{ type: "macd_bullish" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.strategy.createdAt).toBeGreaterThan(0);
  });
});
