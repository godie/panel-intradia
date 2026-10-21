/**
 * Cross-event persistence — records every detected EMA55/200 and MACD/signal
 * crossover to SQLite via Prisma, and exposes a read query for the history
 * timeline.
 *
 * Dedup strategy: we only insert a cross if no cross of the same (symbol,
 * type, direction) has been recorded in the last `DEDUP_WINDOW_MS`. This
 * prevents duplicate inserts on every 60s refresh while the same cross
 * remains "recent". For MACD momentum flips we use a tighter window since
 * they flip more often.
 */

import { db } from "./db";
import type { AnalysisResponse } from "./types";

const DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours for EMA/MACD crosses
const MOMENTUM_DEDUP_MS = 2 * 60 * 60 * 1000; // 2 hours for momentum flips
const SQUEEZE_DEDUP_MS = 12 * 60 * 60 * 1000; // 12 hours for squeeze events

export type CrossEventType = "ema" | "macd" | "momentum" | "squeeze" | "squeeze_breakout" | "stoch_cross";
export type CrossDirection = "bullish" | "bearish" | "neutral";

type RecordInput = {
  symbol: string;
  type: CrossEventType;
  direction: CrossDirection;
  price: number;
  candlesAgo: number;
};

/**
 * recordCrossIfNew — insert a CrossEvent row unless an identical cross
 * (same symbol + type + direction) was recorded within the dedup window.
 *
 * Non-blocking: errors are swallowed (logged to stderr) so the API route
 * never fails because of a DB issue — the analysis JSON still returns.
 */
export async function recordCrossIfNew(input: RecordInput): Promise<void> {
  try {
    const windowMs =
      input.type === "momentum"
        ? MOMENTUM_DEDUP_MS
        : input.type === "squeeze"
          ? SQUEEZE_DEDUP_MS
          : DEDUP_WINDOW_MS;
    const since = new Date(Date.now() - windowMs);
    const existing = await db.crossEvent.findFirst({
      where: {
        symbol: input.symbol,
        type: input.type,
        direction: input.direction,
        detectedAt: { gte: since },
      },
      orderBy: { detectedAt: "desc" },
      select: { id: true },
    });
    if (existing) return; // dedup — same cross already recorded recently

    await db.crossEvent.create({
      data: {
        symbol: input.symbol,
        type: input.type,
        direction: input.direction,
        price: input.price,
        candlesAgo: input.candlesAgo,
      },
    });
  } catch (err) {
    // DB errors must never break the API response.
    console.error("[cross-history] record error:", err);
  }
}

export type CrossCandidate = {
  symbol: string;
  type: CrossEventType;
  direction: CrossDirection;
  price: number;
  candlesAgo: number;
};

/**
 * collectCrossCandidates — función pura: recibe un payload ya computado y
 * devuelve los cruces fresh ahora mismo. [] cuando no hay spot price
 * (no hay nada que registrar) o no hay señal fresh. Sin I/O.
 */
export function collectCrossCandidates(
  payload: AnalysisResponse,
): CrossCandidate[] {
  const out: CrossCandidate[] = [];
  const price = payload.spot_price;
  if (price == null || !Number.isFinite(price)) return out;

  const push = (
    type: CrossEventType,
    direction: CrossDirection,
    candlesAgo: number,
  ): void => {
    out.push({ symbol: payload.symbol, type, direction, price, candlesAgo });
  };

  const ema = payload.cross_info;
  if (ema?.happened && ema.direction) {
    push("ema", ema.direction, ema.candles_since_cross ?? 0);
  }

  const macd = payload.macd_cross;
  if (macd?.happened && macd.direction) {
    push("macd", macd.direction, macd.candles_since_cross ?? 0);
  }
  if (macd?.momentum_flip && macd.momentum_flip_direction) {
    push("momentum", macd.momentum_flip_direction, macd.candles_since_flip ?? 0);
  }

  const breakout = payload.squeeze_breakout;
  if (breakout?.happened && breakout.direction) {
    push("squeeze_breakout", breakout.direction, breakout.candles_since_breakout ?? 0);
  }

  if (payload.bollinger_squeeze?.is_squeezed) {
    push("squeeze", "neutral", 0);
  }

  const stoch = payload.stoch_cross;
  if (stoch?.happened && stoch.direction) {
    push("stoch_cross", stoch.direction, stoch.candles_since_cross ?? 0);
  }

  return out;
}

export type CrossHistoryEntry = {
  id: string;
  symbol: string;
  type: CrossEventType;
  direction: CrossDirection;
  price: number;
  candlesAgo: number;
  detectedAt: string; // ISO
};

/**
 * getCrossHistory — returns the most recent cross events, optionally
 * filtered by symbol. Sorted newest-first. Defaults to the last 50 events.
 */
export async function getCrossHistory(
  symbol?: string,
  limit = 50,
): Promise<CrossHistoryEntry[]> {
  const rows = await db.crossEvent.findMany({
    where: symbol ? { symbol } : undefined,
    orderBy: { detectedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    type: r.type as CrossEventType,
    direction: r.direction as CrossDirection,
    price: r.price,
    candlesAgo: r.candlesAgo,
    detectedAt: r.detectedAt.toISOString(),
  }));
}

/**
 * getCrossCountBySymbol — aggregate counts per symbol+type for the header
 * summary badge ("N cruces esta semana").
 */
export async function getCrossStats(sinceDays = 7): Promise<
  Record<string, { ema: number; macd: number; momentum: number; total: number }>
> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db.crossEvent.findMany({
    where: { detectedAt: { gte: since } },
    select: { symbol: true, type: true },
  });
  const out: Record<string, { ema: number; macd: number; momentum: number; total: number }> = {};
  for (const r of rows) {
    if (!out[r.symbol]) out[r.symbol] = { ema: 0, macd: 0, momentum: 0, total: 0 };
    const key = r.type as "ema" | "macd" | "momentum";
    if (key in out[r.symbol]) out[r.symbol][key]++;
    out[r.symbol].total++;
  }
  return out;
}
