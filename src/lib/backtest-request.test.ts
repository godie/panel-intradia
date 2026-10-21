import { describe, it, expect } from "vitest";
import {
  parseCustomStrategy,
  parseTradeLimits,
  resolveStrategy,
  VALID_INTERVALS,
  clampNumber,
} from "./backtest-request";

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
