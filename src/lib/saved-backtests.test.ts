import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadSavedBacktests,
  saveBacktest,
  deleteSavedBacktest,
  clearSavedBacktests,
  exportSavedBacktests,
  importSavedBacktests,
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
      sharpeRatio: 1.5,
      sortinoRatio: 2.2,
      calmarRatio: 3.9,
      maxWinStreak: 3,
      maxLossStreak: 1,
      avgWinPct: 5,
      avgLossPct: -2,
      expectancyPct: 3.5,
    },
    durationBuckets: [],
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

type StorageMock = Storage & { failWrites: () => void };

function createStorageMock(): StorageMock {
  const store = new Map<string, string>();
  let fail = false;
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
      if (fail) throw new Error("QuotaExceededError");
      store.set(key, value);
    },
    failWrites: () => {
      fail = true;
    },
  };
}

let storage: StorageMock;

// saved-backtests.ts guards on `typeof window === "undefined"`, so expose
// the DOM globals it reads directly. We set them on globalThis instead of
// using vi.stubGlobal (Vitest-only) because CI runs the suite with Bun's
// native test runner (`bun test`), which must also pass.
beforeEach(() => {
  storage = createStorageMock();
  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).localStorage = storage;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
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
    storage.failWrites();
    expect(saveBacktest(makeResult())).toBeNull();
    expect(loadSavedBacktests()).toEqual([]);
  });
});

/** Build a plain (untyped) saved-backtest payload so tests can also feed
 *  intentionally malformed data through the import validator. */
function makeSaved(
  id: string,
  stats: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    savedAt: "2026-01-01T00:00:00.000Z",
    label: `Entry ${id}`,
    result: {
      symbol: "BTCUSDT",
      interval: "4h",
      candlesAnalyzed: 500,
      provider: "binance",
      trades: [],
      equityCurve: [],
      durationBuckets: [],
      stats: { totalTrades: 1, winRate: 50, ...stats },
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
      ...extra,
    },
  };
}

describe("exportSavedBacktests", () => {
  it("returns an envelope with format, count and the saved entries", () => {
    const a = saveBacktest(makeResult())!;
    const b = saveBacktest(makeResult({ symbol: "ETHUSDT" }))!;
    const parsed = JSON.parse(exportSavedBacktests()) as {
      format: string;
      count: number;
      backtests: { id: string }[];
    };
    expect(parsed.format).toBe("panel-intradia/saved-backtests/v1");
    expect(parsed.count).toBe(2);
    expect(parsed.backtests.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("returns a valid empty envelope when nothing is saved", () => {
    const parsed = JSON.parse(exportSavedBacktests()) as { count: number; backtests: unknown[] };
    expect(parsed.count).toBe(0);
    expect(parsed.backtests).toEqual([]);
  });
});

describe("importSavedBacktests", () => {
  it("imports an envelope and persists the entries (newest-first)", () => {
    const payload = { format: "panel-intradia/saved-backtests/v1", backtests: [makeSaved("a"), makeSaved("b")] };
    const result = importSavedBacktests(JSON.stringify(payload));
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.dropped).toBe(0);
    expect(result.total).toBe(2);
    expect(result.backtests.map((s) => s.id)).toEqual(["a", "b"]);
    expect(loadSavedBacktests().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("accepts a bare array (legacy format)", () => {
    const result = importSavedBacktests(JSON.stringify([makeSaved("legacy")]));
    expect(result.imported).toBe(1);
    expect(result.total).toBe(1);
  });

  it("returns zeros for invalid JSON or non-array payloads", () => {
    for (const text of ["{not json", "42", JSON.stringify({ foo: 1 }), JSON.stringify(null)]) {
      const result = importSavedBacktests(text);
      expect(result).toEqual({ imported: 0, skipped: 0, dropped: 0, total: 0, backtests: [] });
    }
  });

  it("skips duplicates against existing entries and within the file", () => {
    const existing = saveBacktest(makeResult())!;
    const payload = [makeSaved(existing.id), makeSaved("new-a"), makeSaved("new-a")];
    const result = importSavedBacktests(JSON.stringify(payload));
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.total).toBe(2);
    expect(loadSavedBacktests().map((s) => s.id)).toEqual(["new-a", existing.id]);
  });

  it("rejects entries that lack a stats block (isSavedBacktest reuse)", () => {
    const payload = [
      { id: "x", savedAt: "2026-01-01T00:00:00.000Z", label: "L", result: {} },
      { id: "y", savedAt: "2026-01-01T00:00:00.000Z", label: "L", result: { stats: null } },
      { id: "z", result: null },
    ];
    const result = importSavedBacktests(JSON.stringify(payload));
    expect(result.imported).toBe(0);
    expect(result.total).toBe(0);
    expect(result.backtests).toEqual([]);
  });

  it("normalizes numeric stats/params and fills missing risk metrics", () => {
    const payload = [
      makeSaved(
        "norm",
        { totalReturnPct: "12.5", winRate: "50", maxWinStreak: "3" },
        { params: { initialCapital: "5000", positionSizing: "bogus" }, trades: undefined },
      ),
    ];
    const result = importSavedBacktests(JSON.stringify(payload));
    const imported = result.backtests[0];
    expect(imported.result.stats.totalReturnPct).toBe(12.5);
    expect(imported.result.stats.winRate).toBe(50);
    expect(imported.result.stats.maxWinStreak).toBe(3);
    // Pre-v3 exports have no risk metrics → the "unavailable" contract.
    expect(Number.isNaN(imported.result.stats.sharpeRatio)).toBe(true);
    expect(imported.result.stats.expectancyPct).toBe(0);
    expect(imported.result.params.initialCapital).toBe(5000);
    expect(imported.result.params.positionSizing).toBe("full");
    expect(Array.isArray(imported.result.trades)).toBe(true);
    expect(Array.isArray(imported.result.durationBuckets)).toBe(true);
  });

  it("reports the cap honestly when an import exceeds MAX_SAVED", () => {
    const payload = Array.from({ length: 60 }, (_, i) => makeSaved(`bt-${i}`));
    const result = importSavedBacktests(JSON.stringify(payload));
    expect(result.imported).toBe(50);
    expect(result.dropped).toBe(10);
    expect(result.total).toBe(50);
    expect(result.backtests).toHaveLength(50);
  });

  it("counts entries trimmed from the existing list toward dropped", () => {
    for (let i = 0; i < 48; i++) saveBacktest(makeResult({ symbol: `SYM${i}` }));
    const payload = Array.from({ length: 5 }, (_, i) => makeSaved(`new-${i}`));
    const result = importSavedBacktests(JSON.stringify(payload));
    expect(result.imported).toBe(5);
    expect(result.dropped).toBe(3);
    expect(result.total).toBe(50);
    expect(loadSavedBacktests()).toHaveLength(50);
  });

  it("round-trips an export back into a clean store", () => {
    saveBacktest(makeResult({ symbol: "BTCUSDT" }));
    saveBacktest(makeResult({ symbol: "ETHUSDT" }));
    const json = exportSavedBacktests();
    clearSavedBacktests();
    const result = importSavedBacktests(json);
    expect(result.imported).toBe(2);
    expect(result.total).toBe(2);
    expect(loadSavedBacktests().map((s) => s.result.symbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
});

describe("loadSavedBacktests — normalization", () => {
  it("normalizes numeric stats of entries written by older versions", () => {
    const legacy = makeSaved("legacy", {
      totalReturnPct: "12.5",
      winRate: "50",
      maxWinStreak: "3",
    });
    storage.setItem("panel:saved-backtests", JSON.stringify([legacy]));
    const loaded = loadSavedBacktests();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].result.stats.totalReturnPct).toBe(12.5);
    expect(loaded[0].result.stats.winRate).toBe(50);
    expect(loaded[0].result.stats.maxWinStreak).toBe(3);
    expect(Number.isNaN(loaded[0].result.stats.sharpeRatio)).toBe(true);
    expect(loaded[0].result.stats.expectancyPct).toBe(0);
  });

  it("keeps a persisted Infinity profit factor meaningful", () => {
    // JSON.stringify(Infinity) === "null", so an all-wins run round-trips as null.
    // It must stay non-finite so the UI renders "∞" rather than 0.00.
    const allWins = makeSaved("all-wins", { profitFactor: null });
    storage.setItem("panel:saved-backtests", JSON.stringify([allWins]));
    const loaded = loadSavedBacktests();
    expect(loaded[0].result.stats.profitFactor).toBe(Infinity);
    expect(Number.isFinite(loaded[0].result.stats.profitFactor)).toBe(false);
  });

  it("re-ensures the array fields when loading", () => {
    const raw = makeSaved("no-arrays");
    const result = raw.result as Record<string, unknown>;
    delete result.trades;
    delete result.equityCurve;
    delete result.durationBuckets;
    storage.setItem("panel:saved-backtests", JSON.stringify([raw]));
    const loaded = loadSavedBacktests();
    expect(Array.isArray(loaded[0].result.trades)).toBe(true);
    expect(Array.isArray(loaded[0].result.equityCurve)).toBe(true);
    expect(Array.isArray(loaded[0].result.durationBuckets)).toBe(true);
  });
});