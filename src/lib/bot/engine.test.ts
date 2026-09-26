import { describe, it, expect, vi } from "vitest";
import { runBotTick, type BotTickDeps } from "./engine";
import type { DecisionSource, Decision } from "./decision-source";
import type { AnalysisResponse } from "@/lib/types";

type FakeConfig = {
  id: string;
  symbol: string;
  initialCapital: number;
  equity: number;
  minConfidence: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldTicks: number;
  positionSizing: string;
  fixedFractionalPct: number;
  feeBps: number;
  isActive: boolean;
  lastTickAt: Date | null;
  updatedAt: Date;
};

type FakeTrade = {
  id: string;
  symbol: string;
  action: string;
  status: string;
  entryPrice: number;
  entryTime: Date;
  entryEquity: number;
  positionSizePct: number;
  confidence: number;
  decisionLabel: string;
  ticksOpen: number;
  exitPrice: number | null;
  exitTime: Date | null;
  exitReason: string | null;
  pnl: number | null;
  pnlPct: number | null;
  feesPaid: number | null;
};

function matches(item: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === "object" && "not" in (cond as Record<string, unknown>)) {
      return item[key] !== (cond as { not: unknown }).not;
    }
    return item[key] === cond;
  });
}

function makeFakePrisma(configOverrides: Partial<FakeConfig> = {}) {
  let config: FakeConfig = {
    id: "default",
    symbol: "BTCUSDT",
    initialCapital: 1000,
    equity: 1000,
    minConfidence: 60,
    stopLossPct: 5,
    takeProfitPct: 10,
    maxHoldTicks: 20,
    positionSizing: "full",
    fixedFractionalPct: 25,
    feeBps: 10,
    isActive: true,
    lastTickAt: null,
    updatedAt: new Date(),
    ...configOverrides,
  };
  const trades: FakeTrade[] = [];
  let idCounter = 0;

  const prisma = {
    botConfig: {
      upsert: vi.fn(async () => config),
      update: vi.fn(async ({ data }: { data: Partial<FakeConfig> }) => {
        config = { ...config, ...data };
        return config;
      }),
    },
    botTrade: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return trades.find((t) => matches(t, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return trades.filter((t) => matches(t, where));
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeTrade> }) => {
        const trade: FakeTrade = {
          id: `t${++idCounter}`,
          ticksOpen: 0,
          exitPrice: null,
          exitTime: null,
          exitReason: null,
          pnl: null,
          pnlPct: null,
          feesPaid: null,
          ...data,
        } as FakeTrade;
        trades.push(trade);
        return trade;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = trades.findIndex((t) => t.id === where.id);
        const current = trades[idx];
        const increment = (data.ticksOpen as { increment: number } | undefined)?.increment;
        trades[idx] = {
          ...current,
          ...data,
          ticksOpen: increment != null ? current.ticksOpen + increment : (data.ticksOpen as number) ?? current.ticksOpen,
        };
        return trades[idx];
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  return { prisma, getConfig: () => config, getTrades: () => trades };
}

function makeAnalysis(spotPrice: number): AnalysisResponse {
  return { spot_price: spotPrice } as unknown as AnalysisResponse;
}

function makeDecisionSource(decision: Decision): DecisionSource {
  return { id: "fake", decide: () => decision };
}

function baseDeps(overrides: Partial<BotTickDeps> = {}): BotTickDeps {
  return {
    fetchAnalysis: async () => makeAnalysis(100),
    decisionSource: makeDecisionSource({ action: "BUY", confidence: 80, label: "strong_buy" }),
    ...overrides,
  };
}

describe("runBotTick", () => {
  it("opens a trade when confidence clears the threshold", async () => {
    const { prisma, getTrades } = makeFakePrisma();
    const result = await runBotTick({ ...baseDeps(), prisma: prisma as never });

    expect(result.action).toBe("opened");
    expect(getTrades()).toHaveLength(1);
    expect(getTrades()[0].status).toBe("OPEN");
    expect(getTrades()[0].action).toBe("BUY");
  });

  it("does not open a trade when confidence is below the threshold", async () => {
    const { prisma, getTrades } = makeFakePrisma();
    const deps = baseDeps({
      decisionSource: makeDecisionSource({ action: "BUY", confidence: 40, label: "buy" }),
    });
    const result = await runBotTick({ ...deps, prisma: prisma as never });

    expect(result.action).toBe("noop");
    expect(getTrades()).toHaveLength(0);
  });

  it("closes an open trade on stop loss", async () => {
    const { prisma, getConfig, getTrades } = makeFakePrisma();
    // Open a BUY at 100.
    await runBotTick({ ...baseDeps(), prisma: prisma as never });
    expect(getTrades()[0].status).toBe("OPEN");

    // Price drops 6% — past the default 5% stop loss.
    const deps = baseDeps({
      fetchAnalysis: async () => makeAnalysis(94),
      decisionSource: makeDecisionSource({ action: "BUY", confidence: 80, label: "strong_buy" }),
    });
    const result = await runBotTick({ ...deps, prisma: prisma as never });

    expect(result.action).toBe("closed");
    expect(result.trade?.exitReason).toBe("stop_loss");
    expect(getTrades()[0].status).toBe("CLOSED");
    expect(getConfig().equity).toBeLessThan(1000);
  });

  it("closes an open trade on take profit", async () => {
    const { prisma, getConfig, getTrades } = makeFakePrisma();
    await runBotTick({ ...baseDeps(), prisma: prisma as never });

    // Price rises 12% — past the default 10% take profit.
    const deps = baseDeps({
      fetchAnalysis: async () => makeAnalysis(112),
      decisionSource: makeDecisionSource({ action: "BUY", confidence: 80, label: "strong_buy" }),
    });
    const result = await runBotTick({ ...deps, prisma: prisma as never });

    expect(result.action).toBe("closed");
    expect(result.trade?.exitReason).toBe("take_profit");
    expect(getTrades()[0].status).toBe("CLOSED");
    expect(getConfig().equity).toBeGreaterThan(1000);
  });

  it("closes an open trade on signal exit when the decision flips", async () => {
    const { prisma, getTrades } = makeFakePrisma();
    await runBotTick({ ...baseDeps(), prisma: prisma as never });

    // Price barely moves, but the decision flips to SHORT.
    const deps = baseDeps({
      fetchAnalysis: async () => makeAnalysis(101),
      decisionSource: makeDecisionSource({ action: "SHORT", confidence: 70, label: "strong_short" }),
    });
    const result = await runBotTick({ ...deps, prisma: prisma as never });

    expect(result.action).toBe("closed");
    expect(result.trade?.exitReason).toBe("signal_exit");
    expect(getTrades()[0].status).toBe("CLOSED");
  });

  it("holds an open trade and increments ticksOpen when no exit condition fires", async () => {
    const { prisma, getTrades } = makeFakePrisma();
    await runBotTick({ ...baseDeps(), prisma: prisma as never });

    const deps = baseDeps({
      fetchAnalysis: async () => makeAnalysis(101),
      decisionSource: makeDecisionSource({ action: "BUY", confidence: 80, label: "strong_buy" }),
    });
    const result = await runBotTick({ ...deps, prisma: prisma as never });

    expect(result.action).toBe("held");
    expect(getTrades()[0].status).toBe("OPEN");
    expect(getTrades()[0].ticksOpen).toBe(1);
  });
});
