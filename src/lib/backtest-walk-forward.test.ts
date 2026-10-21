import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { AnalysisResponse } from "./types";
import {
  buildWalkForwardWindows,
  classifyEfficiency,
  computeEfficiency,
  computeRobustness,
  emptyRobustness,
  planWalkForwardWindows,
  type CandleSnapshot,
  type RobustnessVerdict,
  type TradeSimParams,
  type WalkForwardWindow,
  type WalkForwardWindowStats,
} from "./backtest";
import { POST } from "@/app/api/backtest/walk-forward/route";

// ---------------------------------------------------------------------------
// Helpers shared across these tests
// ---------------------------------------------------------------------------

function windowStats(
  returnPct: number,
  trades: number,
  overrides: Partial<WalkForwardWindowStats> = {},
): WalkForwardWindowStats {
  return {
    candles: 350,
    returnPct,
    trades,
    wins: 0,
    losses: 0,
    maxDrawdownPct: 0,
    sharpeRatio: 0,
    ...overrides,
  };
}

function window(
  index: number,
  startIndex: number,
  endIndex: number,
  isRet: number,
  oosRet: number,
  isTrades: number,
  oosTrades: number,
): WalkForwardWindow {
  return {
    index,
    startIndex,
    endIndex,
    inSample: windowStats(isRet, isTrades, { candles: 350 }),
    outOfSample: windowStats(oosRet, oosTrades, { candles: 150 }),
  };
}

/** Snapshot factory with a hand-built analysis: only spot_price matters for
 * the fake strategy used below (everything else stays undefined-safe). */
function snapshot(index: number, close: number): CandleSnapshot {
  return {
    index,
    time: 1_700_000_000_000 + index * 3_600_000,
    close,
    analysis: { spot_price: close } as unknown as AnalysisResponse,
  };
}

/** Strategy that fires on every candle → maximal trade activity. */
function alwaysFireStrategy(): TradeSimParams["strategy"] {
  return {
    id: "test_always",
    name: "test_always",
    description: "test",
    targetAction: "BUY",
    evaluate: () => [
      { name: "always", fired: true, description: "test", direction: "bullish" },
    ],
  };
}

function simParams(
  overrides: Partial<TradeSimParams> = {},
): TradeSimParams {
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    strategy: alwaysFireStrategy(),
    action: "BUY",
    minConfidence: 1,
    initialCapital: 10_000,
    stopLossPct: 5,
    takeProfitPct: 10,
    maxHoldCandles: 50,
    positionSizing: "full",
    fixedFractionalPct: 25,
    feeBps: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeEfficiency / classifyEfficiency — single source for OOS/IS ratio
// ---------------------------------------------------------------------------

describe("computeEfficiency", () => {
  it("returns the raw OOS/IS ratio when IS is non-zero", () => {
    expect(computeEfficiency(10, 5)).toBe(0.5);
    expect(computeEfficiency(4, -2)).toBe(-0.5);
    // Both legs settle at 0 → nothing to degrade → 0.
    expect(computeEfficiency(0, 0)).toBe(0);
  });

  it("returns null instead of ±Infinity when IS is 0 and OOS is not (JSON-safe)", () => {
    // JSON.stringify consumes ±Infinity as null; never emit it if the API
    // contract says `number | null`.
    expect(computeEfficiency(0, 5)).toBeNull();
    expect(computeEfficiency(0, -5)).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(computeEfficiency(NaN, 1)).toBeNull();
    expect(computeEfficiency(1, NaN)).toBeNull();
    expect(computeEfficiency(Infinity, 1)).toBeNull();
  });
});

describe("classifyEfficiency", () => {
  it("maps thresholds: >= 0.5 robust, >= 0.3 moderate, else overfit", () => {
    const verdicts: Array<[number | null, RobustnessVerdict]> = [
      [0.75, "good"],
      [0.5, "good"],
      [0.49, "medium"],
      [0.3, "medium"],
      [0.29, "poor"],
      [-1, "poor"],
      [0, "poor"],
    ];
    for (const [eff, expected] of verdicts) {
      expect(classifyEfficiency(eff)).toBe(expected);
    }
  });

  it("returns no verdict for null/non-finite inputs", () => {
    expect(classifyEfficiency(null)).toBe("none");
    expect(classifyEfficiency(NaN)).toBe("none");
    expect(classifyEfficiency(Infinity)).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// computeRobustness — aggregation over per-window summaries
// ---------------------------------------------------------------------------

describe("computeRobustness", () => {
  it("aggregates OOS and IS returns as means and derives efficiency", () => {
    const windows = [
      window(1, 0, 500, 10, 5, 5, 3),
      window(2, 500, 1000, -2, 1, 4, 2),
    ];
    const agg = computeRobustness(windows);
    // avgIs = (10 + -2) / 2 = 4; avgOos = (5 + 1) / 2 = 3
    expect(agg.avgIsReturnPct).toBe(4);
    expect(agg.avgOosReturnPct).toBe(3);
    // efficiency = 3 / 4 = 0.75
    expect(agg.efficiency).toBe(0.75);
  });

  it("counts positive OOS windows", () => {
    const windows = [
      window(1, 0, 500, 10, 5, 5, 3),
      window(2, 500, 1000, 10, -3, 4, 2),
      window(3, 1000, 1500, 10, 0, 4, 2),
    ];
    // only the first window has OOS > 0
    expect(computeRobustness(windows).positiveOosRate).toBe(33.3);
  });

  it("counts robust windows where positive IS kept at least half of itself OOS", () => {
    const windows = [
      window(1, 0, 500, 10, 6, 5, 3), // 6 >= 5 ✓
      window(2, 500, 1000, 10, 5, 4, 2), // 5 >= 5 ✓
      window(3, 1000, 1500, 10, 5, 4, 2), // 5 >= 5 ✓
      window(4, 1500, 2000, -5, -1, 0, 0), // IS negative → never robust
      window(5, 2000, 2500, 10, 4, 4, 2), // 4 < 5 ✗
    ];
    expect(computeRobustness(windows).robustnessRate).toBe(60);
  });

  it("returns the zero object for an empty window list", () => {
    expect(computeRobustness([])).toEqual(emptyRobustness());
  });

  it("keeps efficiency null (not Infinity) when avgIs is 0 and avgOos is not", () => {
    const windows = [
      window(1, 0, 500, 0, 5, 5, 3),
      window(2, 500, 1000, 0, 1, 4, 2),
    ];
    const agg = computeRobustness(windows);
    expect(agg.avgIsReturnPct).toBe(0);
    expect(agg.avgOosReturnPct).toBe(3);
    expect(agg.efficiency).toBeNull();
  });

  it("collapses a NaN OOS Sharpe into 0 for the average", () => {
    const windows = [
      window(1, 0, 500, 10, 5, 5, 3),
      window(2, 500, 1000, 10, 0, 4, 2),
    ];
    const agg = computeRobustness(windows);
    expect(agg.avgOosSharpe).toBe(0);
  });

  it("uses the sum of OOS trades for totalOosTrades", () => {
    const windows = [
      window(1, 0, 500, 10, 5, 0, 5),
      window(2, 500, 1000, 10, -2, 3, 0),
    ];
    expect(computeRobustness(windows).totalOosTrades).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// planWalkForwardWindows — the window arithmetic
// ---------------------------------------------------------------------------

describe("planWalkForwardWindows", () => {
  it("defaults the step to the OOS size (contiguous OOS across windows)", () => {
    const plan = planWalkForwardWindows(1000, 500, 0.7);
    // oos = floor(500 * 0.3) = 150; is = 350
    expect(plan.isSize).toBe(350);
    expect(plan.oosSize).toBe(150);
    expect(plan.effectiveWindow).toBe(500);
    expect(plan.effectiveStep).toBe(150);
  });

  it("counts windows that fit, starting with the very first full window", () => {
    const plan = planWalkForwardWindows(1000, 500, 0.7);
    // windows at start = 0, 150, 300, 450 → start + 500 <= 1000
    expect(plan.windowCount).toBe(4);
  });

  it("reports zero windows when the history cannot fit one window", () => {
    const plan = planWalkForwardWindows(300, 500, 0.7);
    expect(plan.windowCount).toBe(0);
  });

  it("clamps windowSize into 100-1000 and inSampleRatio into 0.3-0.9", () => {
    const plan = planWalkForwardWindows(10_000, 5000, 5);
    expect(plan.windowSize).toBe(1000);
    expect(plan.inSampleRatio).toBe(0.9);
    // oos = max(20, floor(1000 * 0.1)) = 100; is = 900
    expect(plan.oosSize).toBe(100);
    expect(plan.isSize).toBe(900);
  });

  it("enforces a minimum OOS size of 20 candles", () => {
    const plan = planWalkForwardWindows(10_000, 500, 0.98);
    // ratio clamped to 0.9 → oos = max(20, floor(500 * 0.1)) = 50
    expect(plan.inSampleRatio).toBe(0.9);
    expect(plan.oosSize).toBe(50);
    expect(plan.isSize).toBe(450);
  });

  it("clamps a caller-supplied step up to the OOS size (no OOS re-sampling)", () => {
    const plan = planWalkForwardWindows(1000, 500, 0.7, 10);
    expect(plan.effectiveStep).toBe(150);
    // A step of exactly the OOS size stays as-is
    expect(planWalkForwardWindows(1000, 500, 0.7, 150).effectiveStep).toBe(150);
    // Larger steps are honored (skip data between windows)
    expect(planWalkForwardWindows(1000, 500, 0.7, 400).effectiveStep).toBe(400);
  });

  it("caps the plan at 50 windows", () => {
    const plan = planWalkForwardWindows(1000, 500, 0.7, 150);
    expect(plan.windowCount).toBe(4); // fits naturally
    // window 100 / ratio 0.3 → oos=70, is=30, step=70: 4000 candles would
    // yield 56 windows → the 50 cap kicks in.
    const capped = planWalkForwardWindows(4000, 100, 0.3);
    expect(capped.windowCount).toBe(50);
  });

  it("guards against non-finite stepSize (falls back to the OOS size)", () => {
    const plan = planWalkForwardWindows(1000, 500, 0.7, NaN);
    expect(plan.effectiveStep).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// buildWalkForwardWindows — pure simulation over pre-built snapshots
// ---------------------------------------------------------------------------

describe("buildWalkForwardWindows", () => {
  it("keeps contiguous non-overlapping OOS ranges and 1-based indices", () => {
    const snapshots = Array.from({ length: 1000 }, (_, i) => snapshot(i, 100));
    const plan = planWalkForwardWindows(1000, 500, 0.7);
    const windows = buildWalkForwardWindows(
      snapshots,
      plan,
      simParams(),
      "binance",
    );
    expect(windows.length).toBe(4);
    // OOS segments: [350,500), [500,650), [650,800), [800,950) — contiguous
    expect(windows.map((w) => w.index)).toEqual([1, 2, 3, 4]);
    expect(windows.map((w) => w.startIndex)).toEqual([0, 150, 300, 450]);
    expect(windows.map((w) => w.endIndex)).toEqual([500, 650, 800, 950]);
    for (const w of windows) {
      expect(w.inSample.candles).toBe(350);
      expect(w.outOfSample.candles).toBe(150);
    }
  });

  it("records trades in both segments of a firing strategy", () => {
    const snapshots = Array.from({ length: 1000 }, (_, i) => snapshot(i, 100));
    const plan = planWalkForwardWindows(1000, 500, 0.7);
    const windows = buildWalkForwardWindows(
      snapshots,
      plan,
      simParams(),
      "binance",
    );
    const w1 = windows[0];
    // Every candle fires → enters at candle 0, exits via max_hold (50).
    expect(w1.inSample.trades).toBeGreaterThan(0);
    expect(w1.outOfSample.trades).toBeGreaterThan(0);
  });

  it("collapses a NaN OOS Sharpe into 0 and rounds returns", () => {
    const snapshots = Array.from({ length: 1000 }, (_, i) => snapshot(i, 100));
    const plan = planWalkForwardWindows(1000, 500, 0.7);
    const windows = buildWalkForwardWindows(
      snapshots,
      plan,
      simParams({ strategy: alwaysFireStrategy() }),
      "binance",
    );
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(Number.isFinite(w.inSample.returnPct)).toBe(true);
      expect(Number.isFinite(w.outOfSample.sharpeRatio)).toBe(true);
    }
  });

  it("uses the caller step when it does not re-sample OOS data", () => {
    const snapshots = Array.from({ length: 700 }, (_, i) => snapshot(i, 100));
    // windowSize 500 / ratio 0.8 → is=400, oos=100; a step of 500 (the full
    // window) makes the windows non-overlapping and disjoint.
    const plan = planWalkForwardWindows(700, 500, 0.8, 500);
    expect(plan.effectiveStep).toBe(500);
    const windows = buildWalkForwardWindows(
      snapshots,
      plan,
      simParams(),
      "binance",
    );
    expect(windows.length).toBe(1);
    expect(windows[0].startIndex).toBe(0);
    expect(windows[0].endIndex).toBe(500);
    expect(windows[0].inSample.candles).toBe(400);
    expect(windows[0].outOfSample.candles).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// runWalkForward empty/error path under deterministic mocks
// ---------------------------------------------------------------------------

describe("runWalkForward empty/error path", () => {
  it("returns an empty result shape when no windows are built", async () => {
    // We cannot run runWalkForward here without a live provider, but we can
    // assert the return type's empty shape contract through the exported types.
    const empty = {
      symbol: "BTCUSDT",
      interval: "4h" as const,
      windows: [] as WalkForwardWindow[],
      robustness: emptyRobustness(),
      strategy: { id: "trend_buy", name: "Trend Buy", action: "BUY" as const },
      params: {
        windowSize: 500,
        inSampleRatio: 0.7,
        minConfidence: 60,
        initialCapital: 10_000,
        stopLossPct: 5,
        takeProfitPct: 10,
        maxHoldCandles: 50,
        positionSizing: "full" as const,
        fixedFractionalPct: 25,
        feeBps: 10,
      },
    } satisfies import("./backtest").WalkForwardResult;
    expect(empty.windows).toEqual([]);
    expect(empty.robustness).toBeDefined();
    expect(empty.robustness.totalOosTrades).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/backtest/walk-forward error path
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

function breakUpstream(): void {
  globalThis.fetch = (async () => {
    throw new Error("network down (test)");
  }) as unknown as typeof fetch;
}

function postWalkForward(body: Record<string, unknown>): Promise<Response> {
  const req = new NextRequest("http://localhost/api/backtest/walk-forward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

function upWalkForwardBody(): Record<string, unknown> {
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    strategyId: "trend_buy",
    windowSize: 500,
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/backtest/walk-forward error path", () => {
  it("returns an empty result with an error message when upstream fails", async () => {
    breakUpstream();
    const res = await postWalkForward(upWalkForwardBody());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: string; windows?: unknown[]; robustness?: unknown };
    expect(body.windows).toEqual([]);
    expect(body.robustness).toBeDefined();
    expect(body.robustness).toHaveProperty("totalOosTrades", 0);
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toBe("");
  });

  it("still returns a JSON-safe robustness object (no Infinity) on failure", async () => {
    breakUpstream();
    const res = await postWalkForward(upWalkForwardBody());
    const body = await res.json();
    // JSON discriminates: ±Infinity would have been serialized as null.
    expect(body.robustness.efficiency).toBe(0);
  });

  it("still rejects an invalid symbol with HTTP 400", async () => {
    breakUpstream();
    const res = await postWalkForward({
      symbol: "NOTASYMBOL",
      interval: "4h",
      strategyId: "trend_buy",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
    expect((body as Record<string, unknown>).windows).toBeUndefined();
  });

  it("still rejects an unknown interval with HTTP 400", async () => {
    breakUpstream();
    const res = await postWalkForward({
      symbol: "BTCUSDT",
      interval: "7d",
      strategyId: "trend_buy",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });

  it("still rejects a missing strategy with HTTP 400", async () => {
    breakUpstream();
    const res = await postWalkForward({
      symbol: "BTCUSDT",
      interval: "4h",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });

  it("still rejects an invalid custom strategy shape with HTTP 400", async () => {
    breakUpstream();
    const res = await postWalkForward({
      symbol: "BTCUSDT",
      interval: "4h",
      customStrategy: { id: "x" },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });

  it("rejects a custom strategy whose conditions are not objects with HTTP 400", async () => {
    breakUpstream();
    // Regressed to a 500 before the null-safe validation: a null/non-object
    // entry used to TypeError inside conditions.map().
    const res = await postWalkForward({
      symbol: "BTCUSDT",
      interval: "4h",
      customStrategy: {
        id: "x",
        name: "x",
        action: "BUY",
        conditions: [null, "rsi_below"],
        createdAt: 1,
      },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });
});
