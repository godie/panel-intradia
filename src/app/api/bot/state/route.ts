/**
 * GET /api/bot/state — current bot config, the open position (with
 * unrealized PnL at the live price) if any, and the most recent closed
 * trades.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { providerRouter } from "@/lib/providers/router";
import { UpstreamError } from "@/lib/providers/types";
import { computeTradePnl } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_ID = "default";
const RECENT_CLOSED_LIMIT = 20;

async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const { ticker } = await providerRouter.getTicker24h(symbol);
    if (ticker?.lastPrice != null) return ticker.lastPrice;
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
  }
  try {
    const { klines } = await providerRouter.getKlines(symbol, "1h", 1);
    return klines[0]?.close ?? null;
  } catch (e) {
    if (e instanceof UpstreamError) return null;
    throw e;
  }
}

export async function GET() {
  const config = await db.botConfig.upsert({
    where: { id: CONFIG_ID },
    update: {},
    create: { id: CONFIG_ID },
  });

  const [openTrade, closedTrades] = await Promise.all([
    db.botTrade.findFirst({ where: { status: "OPEN" }, orderBy: { entryTime: "desc" } }),
    db.botTrade.findMany({
      where: { status: "CLOSED" },
      orderBy: { exitTime: "desc" },
      take: RECENT_CLOSED_LIMIT,
    }),
  ]);

  const price = await getCurrentPrice(config.symbol);

  let unrealizedPnl: { pnl: number; pnlPct: number } | null = null;
  if (openTrade && price != null) {
    const positionDirection = openTrade.action === "SHORT" ? -1 : 1;
    const entryNotional = (openTrade.entryEquity * openTrade.positionSizePct) / 100;
    const { netPnl, netPnlPct } = computeTradePnl({
      entryPrice: openTrade.entryPrice,
      exitPrice: price,
      positionDirection,
      entryNotional,
      feePerSide: config.feeBps / 10_000,
    });
    unrealizedPnl = { pnl: netPnl, pnlPct: netPnlPct };
  }

  return NextResponse.json({
    config,
    price,
    openTrade,
    unrealizedPnl,
    closedTrades,
  });
}
