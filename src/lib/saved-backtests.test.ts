import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSavedBacktests,
  saveBacktest,
  deleteSavedBacktest,
  clearSavedBacktests,
} from "./saved-backtests";
import type { BacktestResult, BacktestTrade } from "./backtest";

function makeTrade(i: number): BacktestTrade {
  return {
    entryIndex: i,
    exitIndex: i + 5,
    entryPrice: 100,
    exitPrice: 105,
    entryTime: i,
    exitTime: i + 5,
    pnl: 5,
    pnlPct: 5,
    holdCandles: 5,
    exitReason: "signal_exit",
    action: "BUY",
    positionSizePct: 100,
    feesPaid: 0.1,
  };
}

function makeResult(overrides?: Partial<BacktestResult>): BacktestResult {
  return {
    symbol: "BTCUSDT",
    interval: "4h",
    candlesAnalyzed: 500,
    provider: "binance",
    trades: [makeTrade(0)],
    equityCurve: [{ candleIndex: 0, time: 0, equity: 10000, inPosition: false }],
    stats: {
      totalTrades: 1,
      wins: 1,
      losses: 0,
      winRate: 100,
      totalReturnPct: 12.5,
      maxDrawdownPct: 3.2,
      profitFactor: 2,
      avgHoldCandles: 5,
      bestTradePct: 5,
      worstTradePct: 0,
      finalEquity: 11250,
      totalFees: 0.2,
      avgPositionSizePct: 100,
    },
    strategy: { id: "trend_buy", name: "Trend Buy", action: "BUY" },
    params: {
      minConfidence: 60,
      initialCapital: 10000,
      stopLossPct: 5,
      takeProfitPct: 10,
      maxHoldCandles: 50,
      positionSizing: "full",
      fixedFractionalPct: 25,
      feeBps: 10,
    },
    ...overrides,
  };
}

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  } as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = createStorageMock();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saved backtests persistence", () => {
  it("load returns [] when nothing is stored", () => {
    expect(loadSavedBacktests()).toEqual([]);
  });

  it("load returns [] on invalid JSON", () => {
    storage.setItem("panel:saved-backtests", "{not json");
    expect(loadSavedBacktests()).toEqual([]);
  });

  it("save persists the entry and compacts the result", () => {
    const big = makeResult({ trades: Array.from({ length: 150 }, (_, i) => makeTrade(i)) });
    const saved = saveBacktest(big);
    expect(saved).not.toBeNull();
    // Compaction: equityCurve stripped, trades truncated to 100.
    expect(saved!.result.equityCurve).toEqual([]);
    expect(saved!.result.trades).toHaveLength(100);
    const loaded = loadSavedBacktests();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(saved!.id);
  });

  it("label includes strategy · symbol interval · signed return", () => {
    const saved = saveBacktest(makeResult({ stats: { ...makeResult().stats, totalReturnPct: 12.5 } }));
    expect(saved!.label).toContain("Trend Buy");
    expect(saved!.label).toContain("BTCUSDT 4h");
    expect(saved!.label).toMatch(/\+12\.50%$/);
    const neg = saveBacktest(makeResult({ stats: { ...makeResult().stats, totalReturnPct: -3.1 } }));
    expect(neg!.label).toMatch(/-3\.10%$/);
  });

  it("delete removes the entry by id", () => {
    const a = saveBacktest(makeResult())!;
    const b = saveBacktest(makeResult())!;
    expect(loadSavedBacktests()).toHaveLength(2);
    const remaining = deleteSavedBacktest(a.id);
    expect(remaining.map((s) => s.id)).toEqual([b.id]);
    expect(loadSavedBacktests()).toHaveLength(1);
  });

  it("clear empties all saved backtests", () => {
    saveBacktest(makeResult());
    saveBacktest(makeResult());
    clearSavedBacktests();
    expect(loadSavedBacktests()).toEqual([]);
  });

  it("filters malformed entries from storage", () => {
    const valid = saveBacktest(makeResult())!;
    const raw = JSON.parse(storage.getItem("panel:saved-backtests")!) as unknown[];
    raw.push({ id: 42, result: null }); // malformed — wrong types
    storage.setItem("panel:saved-backtests", JSON.stringify(raw));
    const loaded = loadSavedBacktests();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(valid.id);
  });

  it("caps the list at 50 entries", () => {
    for (let i = 0; i < 55; i++) saveBacktest(makeResult());
    expect(loadSavedBacktests()).toHaveLength(50);
  });

  it("returns null when the write always fails (quota exceeded)", () => {
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(saveBacktest(makeResult())).toBeNull();
    expect(loadSavedBacktests()).toEqual([]);
  });
});