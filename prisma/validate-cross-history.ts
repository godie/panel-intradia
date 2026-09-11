/**
 * validate-cross-history — asserts the JSON shape served by
 * GET /api/cross-history against a real (seeded) SQLite database.
 *
 * The API route calls exactly two functions — getCrossHistory() and
 * getCrossStats() — and wraps them as `{ events, stats, count }`. This
 * script runs the same calls against the DB pointed to by DATABASE_URL
 * and validates the resulting contract, so CI fails if the CrossEvent
 * schema, the query layer, or the serialization shape drifts.
 *
 * Usage: bun prisma/validate-cross-history.ts   (requires seeded DB)
 */

import { db } from "@/lib/db";
import { getCrossHistory, getCrossStats } from "@/lib/cross-history";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "BNBUSDT"];
const TYPES = [
  "ema",
  "macd",
  "momentum",
  "squeeze",
  "squeeze_breakout",
  "stoch_cross",
] as const;
const DIRECTIONS = ["bullish", "bearish", "neutral"] as const;

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

async function main(): Promise<void> {
  // Same calls the route makes (route limit default is 50; we exercise the
  // capped path with 30, matching the seeded 5 × 24 = 120-row dataset).
  const [events, stats] = await Promise.all([
    getCrossHistory(undefined, 30),
    getCrossStats(7),
  ]);

  assert(Array.isArray(events), "events must be an array");
  assert(
    events.length > 0 && events.length <= 30,
    `expected 1..30 events, got ${events.length}`,
  );

  for (const e of events) {
    assert(
      typeof e.id === "string" && e.id.length > 0,
      `id must be a non-empty string (got ${JSON.stringify(e.id)})`,
    );
    assert(
      (SYMBOLS as readonly string[]).includes(e.symbol),
      `unexpected symbol: ${e.symbol}`,
    );
    assert(
      (TYPES as readonly string[]).includes(e.type),
      `unexpected type: ${e.type}`,
    );
    assert(
      (DIRECTIONS as readonly string[]).includes(e.direction),
      `unexpected direction: ${e.direction}`,
    );
    assert(
      Number.isFinite(e.price) && e.price > 0,
      `price must be a positive finite number (got ${e.price})`,
    );
    assert(
      Number.isInteger(e.candlesAgo) && e.candlesAgo >= 0,
      `candlesAgo must be a non-negative integer (got ${e.candlesAgo})`,
    );
    assert(
      typeof e.detectedAt === "string" && !Number.isNaN(Date.parse(e.detectedAt)),
      `detectedAt must be an ISO date string (got ${JSON.stringify(e.detectedAt)})`,
    );
  }

  // Newest-first ordering — the contract the cross-history timeline relies on.
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (!prev || !curr) continue;
    assert(
      prev.detectedAt >= curr.detectedAt,
      "events must be sorted newest-first",
    );
  }

  assert(typeof stats === "object" && stats !== null, "stats must be an object");
  for (const [symbol, s] of Object.entries(stats)) {
    assert(
      (SYMBOLS as readonly string[]).includes(symbol),
      `stats has an unexpected symbol: ${symbol}`,
    );
    assert(
      Number.isInteger(s.ema) && s.ema >= 0,
      `stats[${symbol}].ema must be a non-negative integer`,
    );
    assert(
      Number.isInteger(s.macd) && s.macd >= 0,
      `stats[${symbol}].macd must be a non-negative integer`,
    );
    assert(
      Number.isInteger(s.momentum) && s.momentum >= 0,
      `stats[${symbol}].momentum must be a non-negative integer`,
    );
    assert(
      Number.isInteger(s.total) && s.total >= 0,
      `stats[${symbol}].total must be a non-negative integer`,
    );
    assert(
      s.ema + s.macd + s.momentum <= s.total,
      `stats[${symbol}]: ema+macd+momentum (${s.ema + s.macd + s.momentum}) must not exceed total (${s.total})`,
    );
  }

  const total = await db.crossEvent.count();
  assert(total === 120, `expected 120 seeded rows, got ${total}`);

  if (failures > 0) {
    console.error(
      `cross-history validation FAILED (${failures} issue${failures === 1 ? "" : "s"})`,
    );
    await db.$disconnect();
    process.exit(1);
  }
  console.log(
    `cross-history OK: ${events.length} events validated, stats for ${Object.keys(stats).length} symbol(s), ${total} rows in DB`,
  );
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
