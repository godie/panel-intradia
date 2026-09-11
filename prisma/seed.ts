/**
 * Seed script — Panel Cuantitativo // Intradía
 *
 * Populates the SQLite database (CrossEvent table) with realistic demo data
 * so the cross-history timeline, header badges and stats have content on a
 * fresh install.
 *
 * Usage:
 *   bun prisma/seed.ts                 # seed if empty (no-op if data exists)
 *   bun prisma/seed.ts --reset         # wipe CrossEvent rows, then seed
 *   bun prisma/seed.ts --reset --days 30 --per-symbol 40
 *
 * Safe to re-run: without --reset it exits early when rows already exist
 * (the dashboard also live-inserts real crosses on every /api/analysis
 * refresh, so we never clobber production-ish data by accident).
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** The 5 pairs tracked by the dashboard (AGENTS.md "Current State"). */
const SYMBOLS = [
  { symbol: "BTCUSDT", basePrice: 78_000, vol: 0.012 },
  { symbol: "ETHUSDT", basePrice: 4_300, vol: 0.016 },
  { symbol: "XRPUSDT", basePrice: 2.6, vol: 0.02 },
  { symbol: "SOLUSDT", basePrice: 190, vol: 0.022 },
  { symbol: "BNBUSDT", basePrice: 900, vol: 0.014 },
] as const;

/** Event types supported by src/lib/cross-history.ts. Weighted below. */
type EventType = "ema" | "macd" | "momentum" | "squeeze" | "squeeze_breakout" | "stoch_cross";
const EVENT_WEIGHTS: Array<[EventType, number]> = [
  ["ema", 2],
  ["macd", 3],
  ["momentum", 4],
  ["stoch_cross", 3],
  ["squeeze", 1],
  ["squeeze_breakout", 1],
];
const TOTAL_WEIGHT = EVENT_WEIGHTS.reduce((acc, [, w]) => acc + w, 0);

type Direction = "bullish" | "bearish" | "neutral";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible datasets across runs.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rand: () => number): EventType {
  let roll = rand() * TOTAL_WEIGHT;
  for (const [type, weight] of EVENT_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return "momentum";
}

function pickDirection(rand: () => number): Direction {
  const roll = rand();
  if (roll < 0.45) return "bullish";
  if (roll < 0.9) return "bearish";
  return "neutral"; // only squeeze events can be neutral
}

/** Round to a sensible number of decimals for the pair's price magnitude. */
function roundPrice(price: number): number {
  if (price >= 10_000) return Math.round(price * 100) / 100;
  if (price >= 100) return Math.round(price * 1000) / 1000;
  return Math.round(price * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Dataset generation
// ---------------------------------------------------------------------------

type SeedRow = {
  symbol: string;
  type: EventType;
  direction: Direction;
  price: number;
  candlesAgo: number;
  detectedAt: Date;
};

function generateRows(opts: { days: number; perSymbol: number }): SeedRow[] {
  const rand = mulberry32(20260910);
  const now = Date.now();
  const rows: SeedRow[] = [];

  for (const { symbol, basePrice, vol } of SYMBOLS) {
    for (let i = 0; i < opts.perSymbol; i++) {
      const type = pickWeighted(rand);
      // squeeze events are the only ones that can be neutral
      let direction = pickDirection(rand);
      if (direction === "neutral" && type !== "squeeze" && type !== "squeeze_breakout") {
        direction = rand() < 0.5 ? "bullish" : "bearish";
      }
      // Price drifts within ±6% of the base — plausible intraday history.
      const drift = 1 + (rand() - 0.5) * 2 * vol * 5;
      const ageMs = Math.floor(rand() * opts.days * 24 * 60 * 60 * 1000);
      rows.push({
        symbol,
        type,
        direction,
        price: roundPrice(basePrice * drift),
        candlesAgo: Math.floor(rand() * 40),
        detectedAt: new Date(now - ageMs),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reset = args.includes("--reset");
  const days = Math.max(1, Number(args[args.indexOf("--days") + 1]) || 14);
  const perSymbol = Math.max(1, Number(args[args.indexOf("--per-symbol") + 1]) || 24);

  const existing = await db.crossEvent.count();
  if (existing > 0 && !reset) {
    console.log(
      `[seed] CrossEvent already has ${existing} rows — nothing to do. ` +
        `Use --reset to wipe and reseed.`,
    );
    return;
  }

  if (reset) {
    const deleted = await db.crossEvent.deleteMany({});
    console.log(`[seed] Reset: deleted ${deleted.count} existing rows.`);
  }

  const rows = generateRows({ days, perSymbol });
  // createMany keeps this fast even for hundreds of rows.
  const result = await db.crossEvent.createMany({ data: rows });

  const total = await db.crossEvent.count();
  const bySymbol = await db.crossEvent.groupBy({
    by: ["symbol"],
    _count: { _all: true },
  });
  console.log(`[seed] Inserted ${result.count} rows (${total} total).`);
  for (const g of bySymbol) {
    console.log(`[seed]   ${g.symbol}: ${g._count._all}`);
  }
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
