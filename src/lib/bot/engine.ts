/**
 * Bot engine — the paper-trading tick loop. Called manually from
 * `POST /api/bot/tick`. There is exactly one bot (`BotConfig` id "default")
 * and at most one open `BotTrade` at a time.
 *
 * This NEVER talks to an exchange to place a real order — every trade is a
 * SQLite row, priced off live market data via `providerRouter` purely to
 * make the simulation realistic. No funds ever move.
 *
 * Reuses the exact PnL/fees math (`computeTradePnl`) and position-sizing
 * math (`calculatePositionSizePct`) that `runBacktest` already uses, so a
 * live bot trade and a backtested trade are priced identically.
 */

import type { BotConfig, BotTrade, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { providerRouter } from "@/lib/providers/router";
import { UpstreamError } from "@/lib/providers/types";
import { buildAnalysis } from "@/app/api/analysis/route";
import { DEFAULT_TIMEFRAME } from "@/lib/timeframes";
import {
  computeTradePnl,
  calculatePositionSizePct,
  type PositionSizing,
} from "@/lib/backtest";
import {
  getDecisionSource,
  type DecisionSource,
  type Decision,
} from "@/lib/bot/decision-source";
import type { AnalysisResponse } from "@/lib/types";

const CONFIG_ID = "default";

export type FetchAnalysis = (symbol: string) => Promise<AnalysisResponse>;

async function defaultFetchAnalysis(symbol: string): Promise<AnalysisResponse> {
  const [klinesRes, tickerRes] = await Promise.all([
    providerRouter.getKlines(symbol, DEFAULT_TIMEFRAME, 500),
    providerRouter.getTicker24h(symbol).catch((e) => {
      if (e instanceof UpstreamError) return { provider: "binance" as const, ticker: null };
      throw e;
    }),
  ]);
  if (klinesRes.klines.length === 0) {
    throw new UpstreamError("Provider devolvió 0 klines", klinesRes.provider);
  }
  return buildAnalysis(
    symbol,
    klinesRes.klines,
    tickerRes.ticker,
    klinesRes.provider,
    DEFAULT_TIMEFRAME,
  );
}

type BotPrisma = Pick<PrismaClient, "botConfig" | "botTrade" | "$transaction">;

export type BotTickDeps = {
  fetchAnalysis?: FetchAnalysis;
  decisionSource?: DecisionSource;
  prisma?: BotPrisma;
};

export type BotTickAction = "opened" | "closed" | "held" | "noop";

export type BotTickResult = {
  config: BotConfig;
  action: BotTickAction;
  trade: BotTrade | null;
  price: number;
  decision: Decision;
};

async function loadConfig(prisma: BotPrisma): Promise<BotConfig> {
  return prisma.botConfig.upsert({
    where: { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID },
  });
}

/** Stop-loss / take-profit / max-hold / signal-flip exit check — mirrors
 *  the exit logic in `runBacktest` (src/lib/backtest.ts). */
function evaluateExit(
  trade: BotTrade,
  price: number,
  decision: Decision,
  config: BotConfig,
): BotTrade["exitReason"] | null {
  const positionDirection = trade.action === "SHORT" ? -1 : 1;
  const movePct = ((price - trade.entryPrice) / trade.entryPrice) * 100 * positionDirection;
  if (movePct <= -config.stopLossPct) return "stop_loss";
  if (movePct >= config.takeProfitPct) return "take_profit";
  if (trade.ticksOpen + 1 >= config.maxHoldTicks) return "max_hold";
  if (decision.action !== trade.action) return "signal_exit";
  return null;
}

export async function runBotTick(deps: BotTickDeps = {}): Promise<BotTickResult> {
  const prisma = deps.prisma ?? db;
  const fetchAnalysis = deps.fetchAnalysis ?? defaultFetchAnalysis;
  const decisionSource = deps.decisionSource ?? getDecisionSource();

  const config = await loadConfig(prisma);
  const analysis = await fetchAnalysis(config.symbol);
  const price = analysis.spot_price;
  if (price == null) {
    throw new Error(`No hay precio disponible para ${config.symbol}.`);
  }
  const decision = decisionSource.decide(analysis);

  const openTrade = await prisma.botTrade.findFirst({
    where: { status: "OPEN" },
    orderBy: { entryTime: "desc" },
  });

  if (openTrade) {
    const exitReason = evaluateExit(openTrade, price, decision, config);

    if (exitReason) {
      const positionDirection = openTrade.action === "SHORT" ? -1 : 1;
      const entryNotional = (openTrade.entryEquity * openTrade.positionSizePct) / 100;
      const { netPnl, netPnlPct, feesPaid } = computeTradePnl({
        entryPrice: openTrade.entryPrice,
        exitPrice: price,
        positionDirection,
        entryNotional,
        feePerSide: config.feeBps / 10_000,
      });
      const newEquity = Math.max(0, config.equity + netPnl);

      const [closedTrade, updatedConfig] = await prisma.$transaction([
        prisma.botTrade.update({
          where: { id: openTrade.id },
          data: {
            status: "CLOSED",
            exitPrice: price,
            exitTime: new Date(),
            exitReason,
            pnl: netPnl,
            pnlPct: netPnlPct,
            feesPaid,
          },
        }),
        prisma.botConfig.update({
          where: { id: CONFIG_ID },
          data: { equity: newEquity, lastTickAt: new Date() },
        }),
      ]);

      return { config: updatedConfig, action: "closed", trade: closedTrade, price, decision };
    }

    const [heldTrade, updatedConfig] = await prisma.$transaction([
      prisma.botTrade.update({
        where: { id: openTrade.id },
        data: { ticksOpen: { increment: 1 } },
      }),
      prisma.botConfig.update({
        where: { id: CONFIG_ID },
        data: { lastTickAt: new Date() },
      }),
    ]);

    return { config: updatedConfig, action: "held", trade: heldTrade, price, decision };
  }

  if (decision.action !== "HOLD" && decision.confidence >= config.minConfidence) {
    const closedTrades = await prisma.botTrade.findMany({
      where: { status: "CLOSED", pnl: { not: null }, pnlPct: { not: null } },
      select: { pnl: true, pnlPct: true },
    });
    const positionSizePct = calculatePositionSizePct(
      config.positionSizing as PositionSizing,
      closedTrades as { pnl: number; pnlPct: number }[],
      config.fixedFractionalPct,
    );

    const [newTrade, updatedConfig] = await prisma.$transaction([
      prisma.botTrade.create({
        data: {
          symbol: config.symbol,
          action: decision.action,
          status: "OPEN",
          entryPrice: price,
          entryTime: new Date(),
          entryEquity: config.equity,
          positionSizePct,
          confidence: Math.round(decision.confidence),
          decisionLabel: decision.label,
        },
      }),
      prisma.botConfig.update({
        where: { id: CONFIG_ID },
        data: { lastTickAt: new Date() },
      }),
    ]);

    return { config: updatedConfig, action: "opened", trade: newTrade, price, decision };
  }

  const updatedConfig = await prisma.botConfig.update({
    where: { id: CONFIG_ID },
    data: { lastTickAt: new Date() },
  });

  return { config: updatedConfig, action: "noop", trade: null, price, decision };
}
