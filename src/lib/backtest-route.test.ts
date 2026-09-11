/**
 * Tests for POST /api/backtest — the upstream-failure error path.
 *
 * AGENTS.md §7: a failed backtest must return an honest empty payload plus an
 * `error` message — never fabricated numbers — so the modal can render the
 * failure inline. The route delegates to `emptyStats(initialCapital)` for that
 * payload, and this file pins that contract.
 *
 * Lives under src/lib/ because AGENTS.md forbids test files in src/app/ and
 * vitest.config.ts only collects `src/lib/**\/*.test.ts`.
 */

import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/backtest/route";
import { emptyStats } from "@/lib/backtest";

/** Shape of the JSON the route serializes for the client. */
type RouteBody = {
  error?: string;
  candlesAnalyzed?: number;
  trades?: unknown[];
  equityCurve?: unknown[];
  durationBuckets?: unknown[];
  stats?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

const realFetch = globalThis.fetch;

/**
 * Force every provider HTTP call to fail. `healthy()` swallows the rejection
 * and reports `false`, so the router runs out of providers and throws, which
 * `runBacktest` turns into its empty `emptyStats` result.
 */
function breakUpstream(): void {
  globalThis.fetch = (async () => {
    throw new Error("network down (test)");
  }) as unknown as typeof fetch;
}

function postBacktest(body: Record<string, unknown>): Promise<Response> {
  const req = new NextRequest("http://localhost/api/backtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

/** The route's payload is serialized to JSON, which turns the NaN ratios of
 *  `emptyStats` into null — assert against what actually crosses the wire. */
function serializedEmptyStats(initialCapital: number): Record<string, unknown> {
  return JSON.parse(JSON.stringify(emptyStats(initialCapital))) as Record<string, unknown>;
}

const BASE_BODY = {
  symbol: "BTCUSDT",
  interval: "4h",
  limit: 500,
  strategyId: "trend_buy",
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/backtest error path", () => {
  it("returns emptyStats instead of fabricated data when upstream fails", async () => {
    breakUpstream();
    const res = await postBacktest({ ...BASE_BODY, initialCapital: 25_000 });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RouteBody;

    expect(body.stats).toEqual(serializedEmptyStats(25_000));
    expect(body.trades).toEqual([]);
    expect(body.equityCurve).toEqual([]);
    expect(body.durationBuckets).toEqual([]);
    expect(body.candlesAnalyzed).toBe(0);
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toBe("");
  });

  it("carries the request's initialCapital into the empty payload", async () => {
    breakUpstream();
    const res = await postBacktest({ ...BASE_BODY, initialCapital: 7_500 });
    const body = (await res.json()) as RouteBody;

    expect(body.params?.initialCapital).toBe(7_500);
    expect(body.stats?.finalEquity).toBe(7_500);
    expect(body.stats?.totalReturnPct).toBe(0);
  });

  it("preserves the unavailable-ratio contract (NaN -> null) rather than faking a ratio", async () => {
    breakUpstream();
    const res = await postBacktest(BASE_BODY);
    const { stats } = (await res.json()) as RouteBody;

    expect(stats).toBeDefined();
    // In-process emptyStats is explicit about "unavailable" being NaN...
    expect(Number.isNaN(emptyStats(10_000).sharpeRatio)).toBe(true);
    expect(Number.isNaN(emptyStats(10_000).sortinoRatio)).toBe(true);
    expect(Number.isNaN(emptyStats(10_000).calmarRatio)).toBe(true);
    // ...and JSON carries that as null, which the UI renders as an em dash.
    expect(stats?.sharpeRatio).toBeNull();
    expect(stats?.sortinoRatio).toBeNull();
    expect(stats?.calmarRatio).toBeNull();
    // Counters are real zeros, not undefined (the UI calls .toFixed() on them).
    expect(stats?.totalTrades).toBe(0);
    expect(stats?.winRate).toBe(0);
    expect(stats?.profitFactor).toBe(0);
    expect(stats?.maxWinStreak).toBe(0);
    expect(stats?.expectancyPct).toBe(0);
  });

  it("still rejects invalid input with HTTP 400 and no stats payload", async () => {
    breakUpstream();
    const res = await postBacktest({ ...BASE_BODY, symbol: "NOPEUSDT" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as RouteBody;
    expect(body.stats).toBeUndefined();
    expect(body.error).toContain("NOPEUSDT");
  });
});
