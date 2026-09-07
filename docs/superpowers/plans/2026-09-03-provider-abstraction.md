# Provider Abstraction + Bybit Fallback Implementation Plan

**Repository**: https://github.com/godie/panel-intradia.git

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `MarketDataProvider` abstraction that lets the dashboard keep working when Binance is unreachable by falling back to Bybit (REST + public WebSocket), and surfaces the active data source to the user in the UI.

**Architecture:** A new `src/lib/providers/` module defines a `MarketDataProvider` interface (`getKlines`, `getTicker24h`, `subscribeTicks`, `healthy`). The current Binance code moves into `providers/binance.ts`. A new `providers/bybit.ts` implements the same interface against Bybit v5 (REST `/v5/market/klines`, `/v5/market/ticker`, and public WS `wss://stream.bybit.com/v5/public/spot`). A `providers/router.ts` keeps a prioritized list `[binance, bybit]` and falls back on timeout, 5xx, or geo-block. The `/api/analysis` route uses the router and stamps the active provider on the response payload so the frontend can show a `FUENTE` badge. The `ws-tick` mini-service becomes a "tick-stream router" that connects to whichever upstream is healthy and emits the same `tick` event schema.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Bun, socket.io 4, Vitest 4 (existing), `ws` 8, `zod` 4. No new runtime dependencies.

## Global Constraints

- **Language / framework floors:** Next.js 16, React 19, TypeScript 5, Bun 1.3 for mini-services.
- **Lint:** Every task ends with `bun run lint` and `bun test` passing — no new warnings.
- **Test framework:** Vitest 4. All new pure functions (provider symbol mapping, response normalizers, router decision logic) MUST have unit tests.
- **Naming:** Files in `src/lib/providers/` are the new home for upstream clients; `src/lib/binance.ts` stays as a re-export shim during migration, removed in Task 11.
- **Backwards compat:** `/api/analysis` response shape gains ONE additive field `source: "binance" | "bybit"`. No other field renames. Existing frontend code keeps working.
- **i18n:** New user-visible strings (badge labels) go into `src/lib/i18n.ts` for the 4 supported languages (es/en/zh/fr) with Spanish as the key source.
- **Symbol set:** Whitelisted set stays `BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, BNBUSDT`. Both providers MUST support the full set; if a provider doesn't list a symbol, the router skips it.
- **Timeout:** Every upstream call has a 5s hard timeout (matches current `binance.ts`).
- **No emoji in source code** (existing convention).
- **Frequent commits:** Each task ends with a commit. Use conventional commits (`feat:`, `chore:`, `refactor:`, `test:`, `docs:`).

---

## File Structure

### Created

- `src/lib/providers/types.ts` — `MarketDataProvider` interface + `ProviderId` union + `TickEvent` type + shared `Kline` / `Ticker24h` types (moved from `binance.ts`).
- `src/lib/providers/binance.ts` — Binance implementation (extracted from `src/lib/binance.ts`, renamed `BinanceError` → `UpstreamError`).
- `src/lib/providers/bybit.ts` — Bybit v5 REST + WS implementation.
- `src/lib/providers/router.ts` — Fallback router. Holds provider order, exposes `getKlines`, `getTicker24h`, `subscribeTicks`, `getActiveSource()`.
- `src/lib/providers/symbols.ts` — Symbol mapping helpers (`toBybitSymbol("BTCUSDT") → "BTCUSDT"` etc., kept centralized because some upstreams may rename later).
- `src/lib/providers/binance.test.ts` — Unit tests for Binance provider normalizers (kline + ticker shape).
- `src/lib/providers/bybit.test.ts` — Unit tests for Bybit provider normalizers (parse `result.list` shape → unified `Kline[]`).
- `src/lib/providers/router.test.ts` — Unit tests for fallback logic (timeout, 5xx, all-down).
- `mini-services/tick-stream/index.ts` — Renamed/extended mini-service: tries Binance WS, then Bybit WS, emits the same `tick` event.
- `mini-services/tick-stream/package.json` — New service manifest with `ws` and `socket.io`.
- `mini-services/tick-stream/tsconfig.json` — TS config for the service.
- `docs/superpowers/plans/2026-09-03-provider-abstraction.md` — This plan file.

### Modified

- `src/lib/binance.ts` — Becomes a re-export shim from `providers/binance.ts` for back-compat, deleted in Task 11.
- `src/app/api/analysis/route.ts` — Switches to `router.getKlines()` + `router.getTicker24h()`, includes `source` in the payload.
- `src/app/api/correlation/route.ts` — Switches to `router.getKlines()`.
- `src/app/api/returns/route.ts` — Switches to `router.getKlines()`.
- `src/lib/types.ts` — `AnalysisResponse` gains `source: ProviderId`. `no_disponible.source: false` added so missing-source degrades gracefully.
- `src/lib/i18n.ts` — Adds `header.source`, `header.sourceBinance`, `header.sourceBybit` for es/en/zh/fr.
- `src/app/page.tsx` — Reads `cells[s].data?.source` from each asset and renders a `FUENTE` badge in the asset card + a global indicator near the live-tick badge.
- `src/components/panel/asset-card.tsx` — Adds the `FUENTE: BINANCE | BYBIT` micro-badge under the symbol header.
- `src/hooks/use-tick-stream.ts` — Adds `source` to `TickState`, points at port 3005 (tick-stream service).
- `mini-services/ws-tick/index.ts` — Replaced by `tick-stream/` in Task 8.

### Deleted

- `mini-services/ws-tick/` — Removed after Task 8 once `tick-stream/` is verified.
- `src/lib/binance.ts` — Removed in Task 11 after all callers migrated.

---

## Task 1: Extract shared types and the `MarketDataProvider` interface

**Files:**
- Create: `src/lib/providers/types.ts`
- Test: `src/lib/providers/types.test.ts`

**Interfaces:**
- Produces: `ProviderId = "binance" | "bybit"`, `Kline`, `Ticker24h`, `TickEvent`, `UpstreamError extends Error`, `MarketDataProvider`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/providers/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { MarketDataProvider, ProviderId } from "./types";

describe("ProviderId", () => {
  it("only accepts the documented sources", () => {
    const ids: ProviderId[] = ["binance", "bybit"];
    expect(ids).toHaveLength(2);
  });
});

describe("MarketDataProvider", () => {
  it("is structurally compatible with a stub", () => {
    const stub: MarketDataProvider = {
      id: "binance",
      getKlines: async () => [],
      getTicker24h: async () => null,
      subscribeTicks: () => () => {},
      healthy: async () => true,
    };
    expect(stub.id).toBe("binance");
    expect(typeof stub.subscribeTicks).toBe("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/providers/types.test.ts`
Expected: FAIL with "Cannot find module './types'".

- [ ] **Step 3: Write the file**

Create `src/lib/providers/types.ts`:

```ts
/**
 * MarketDataProvider — the abstraction every upstream (Binance, Bybit, ...)
 * must implement so the rest of the app stays exchange-agnostic.
 *
 * Conventions:
 *  - All symbols passed in / returned are uppercase and end in "USDT"
 *    (e.g. "BTCUSDT"). Per-exchange remapping lives in `symbols.ts`.
 *  - All network calls inside implementations MUST throw `UpstreamError`
 *    on failure so the router can treat failures uniformly.
 *  - `getKlines` and `getTicker24h` return parsed data or throw — they
 *    never return partial data.
 *  - `subscribeTicks` returns an `unsubscribe` function; the router
 *    holds the active subscription and tears it down on provider swap.
 */

export type ProviderId = "binance" | "bybit";

export type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
};

export type Ticker24h = {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  trades: number;
};

export type TickEvent = {
  symbol: string;
  price: number;
  time: number;
};

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderId,
    public readonly upstream?: unknown,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export type Unsubscribe = () => void;

export interface MarketDataProvider {
  readonly id: ProviderId;
  getKlines(symbol: string, interval?: string, limit?: number): Promise<Kline[]>;
  getTicker24h(symbol: string): Promise<Ticker24h | null>;
  subscribeTicks(
    symbols: string[],
    onTick: (t: TickEvent) => void,
    onStatus: (status: { connected: boolean }) => void,
  ): Unsubscribe;
  healthy(): Promise<boolean>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/providers/types.test.ts`
Expected: PASS (1 file, 2 tests).

- [ ] **Step 5: Lint and commit**

Run:
```bash
bun run lint
git add src/lib/providers/types.ts src/lib/providers/types.test.ts
git commit -m "feat(providers): add MarketDataProvider interface and shared types"
```

---

## Task 2: Extract the symbol-mapping helper

**Files:**
- Create: `src/lib/providers/symbols.ts`
- Test: `src/lib/providers/symbols.test.ts`

**Interfaces:**
- Consumes: A list of allowed internal symbols (`SYMBOLS` from `src/lib/types.ts`).
- Produces: `toBinanceSymbol(s)`, `fromBinanceSymbol(s)`, `toBybitSymbol(s)`, `fromBybitSymbol(s)`, `isSupportedSymbol(s)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/providers/symbols.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toBinanceSymbol,
  fromBinanceSymbol,
  toBybitSymbol,
  fromBybitSymbol,
  isSupportedSymbol,
} from "./symbols";

describe("symbol mapping", () => {
  it("round-trips Binance symbols unchanged", () => {
    const s = "BTCUSDT";
    expect(toBinanceSymbol(s)).toBe("BTCUSDT");
    expect(fromBinanceSymbol(s)).toBe("BTCUSDT");
  });

  it("Bybit uses the same symbol string for USDT spot pairs", () => {
    const s = "BTCUSDT";
    expect(toBybitSymbol(s)).toBe("BTCUSDT");
    expect(fromBybitSymbol(s)).toBe("BTCUSDT");
  });

  it("isSupportedSymbol accepts the documented set", () => {
    for (const s of ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "BNBUSDT"]) {
      expect(isSupportedSymbol(s)).toBe(true);
    }
  });

  it("isSupportedSymbol rejects unknown tickers", () => {
    expect(isSupportedSymbol("DOGEUSDT")).toBe(false);
    expect(isSupportedSymbol("")).toBe(false);
    expect(isSupportedSymbol("btcusdt")).toBe(false); // case sensitive
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/providers/symbols.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/providers/symbols.ts`:

```ts
import { SYMBOLS } from "@/lib/types";

const SUPPORTED = new Set<string>(SYMBOLS as readonly string[]);

export function isSupportedSymbol(symbol: string): boolean {
  return SUPPORTED.has(symbol);
}

export function toBinanceSymbol(symbol: string): string {
  return symbol;
}

export function fromBinanceSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

export function toBybitSymbol(symbol: string): string {
  // Bybit v5 uses the same "BTCUSDT" form for spot USDT pairs.
  return symbol;
}

export function fromBybitSymbol(symbol: string): string {
  return symbol.toUpperCase();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/providers/symbols.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run:
```bash
bun run lint
git add src/lib/providers/symbols.ts src/lib/providers/symbols.test.ts
git commit -m "feat(providers): add symbol-mapping helpers"
```

---

## Task 3: Move the Binance provider into `providers/binance.ts`

**Files:**
- Create: `src/lib/providers/binance.ts`
- Create: `src/lib/providers/binance.test.ts`
- Modify: `src/lib/binance.ts` — becomes a re-export shim.

**Interfaces:**
- Consumes: `MarketDataProvider`, `Kline`, `Ticker24h`, `UpstreamError` from `providers/types.ts`; `toBinanceSymbol` from `providers/symbols.ts`.
- Produces: `BinanceProvider` class implementing `MarketDataProvider`, exported as `binanceProvider` singleton.

- [ ] **Step 1: Write the failing test**

Create `src/lib/providers/binance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseKlines, parseTicker } from "./binance";
import type { Kline, Ticker24h } from "./types";

describe("parseKlines", () => {
  it("converts Binance raw kline arrays into Kline objects", () => {
    const raw = [
      [
        1700000000000, "30000", "30100", "29900", "30050",
        "100", 1700003599999, "3005000", "5000",
      ],
    ];
    const out = parseKlines(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual<Kline>({
      openTime: 1700000000000,
      open: 30000,
      high: 30100,
      low: 29900,
      close: 30050,
      volume: 100,
      closeTime: 1700003599999,
      quoteVolume: 3005000,
      trades: 5000,
    });
  });

  it("throws UpstreamError on malformed entry", () => {
    expect(() => parseKlines([["a", "b"]])).toThrow();
  });
});

describe("parseTicker", () => {
  it("normalizes stringy numbers from the Binance ticker payload", () => {
    const out = parseTicker({
      symbol: "BTCUSDT",
      lastPrice: "30000.50",
      priceChange: "150",
      priceChangePercent: "0.5",
      highPrice: "30500",
      lowPrice: "29900",
      volume: "1000",
      quoteVolume: "30000000",
      count: "5000",
    });
    expect(out).toEqual<Ticker24h>({
      symbol: "BTCUSDT",
      lastPrice: 30000.5,
      priceChange: 150,
      priceChangePercent: 0.5,
      highPrice: 30500,
      lowPrice: 29900,
      volume: 1000,
      quoteVolume: 30000000,
      trades: 5000,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/providers/binance.test.ts`
Expected: FAIL — `parseKlines` and `parseTicker` not exported.

- [ ] **Step 3: Create `providers/binance.ts`**

Create `src/lib/providers/binance.ts`:

```ts
import {
  UpstreamError,
  type Kline,
  type MarketDataProvider,
  type TickEvent,
  type Ticker24h,
  type Unsubscribe,
} from "./types";
import { toBinanceSymbol } from "./symbols";

const BINANCE_BASE = "https://api.binance.com/api/v3";
const FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "PanelCuantitativo/1.0 (+server)" },
      cache: "no-store",
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => undefined);
      }
      throw new UpstreamError(
        `Binance responded ${res.status} ${res.statusText}`,
        "binance",
        body,
      );
    }
    return res;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError(`Binance timed out after ${FETCH_TIMEOUT_MS}ms`, "binance");
    }
    throw new UpstreamError(
      `Binance network error: ${err instanceof Error ? err.message : String(err)}`,
      "binance",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseKlines(raw: unknown): Kline[] {
  if (!Array.isArray(raw)) {
    throw new UpstreamError("Binance klines payload was not an array", "binance", raw);
  }
  return raw.map((k) => {
    if (!Array.isArray(k) || k.length < 9) {
      throw new UpstreamError("Binance malformed kline entry", "binance", k);
    }
    return {
      openTime: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Number(k[6]),
      quoteVolume: Number(k[7]),
      trades: Number(k[8]),
    };
  });
}

export function parseTicker(raw: unknown): Ticker24h {
  if (!raw || typeof raw !== "object" || !("lastPrice" in raw)) {
    throw new UpstreamError("Binance ticker missing lastPrice", "binance", raw);
  }
  const r = raw as Record<string, string | number>;
  return {
    symbol: String(r.symbol),
    lastPrice: Number(r.lastPrice),
    priceChange: Number(r.priceChange),
    priceChangePercent: Number(r.priceChangePercent),
    highPrice: Number(r.highPrice),
    lowPrice: Number(r.lowPrice),
    volume: Number(r.volume),
    quoteVolume: Number(r.quoteVolume),
    trades: Number(r.count ?? 0),
  };
}

export class BinanceProvider implements MarketDataProvider {
  readonly id = "binance" as const;

  async getKlines(symbol: string, interval = "4h", limit = 500): Promise<Kline[]> {
    const s = toBinanceSymbol(symbol);
    const url = `${BINANCE_BASE}/klines?symbol=${encodeURIComponent(s)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const res = await fetchWithTimeout(url);
    return parseKlines(await res.json());
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    const s = toBinanceSymbol(symbol);
    const url = `${BINANCE_BASE}/ticker/24hr?symbol=${encodeURIComponent(s)}`;
    const res = await fetchWithTimeout(url);
    return parseTicker(await res.json());
  }

  // The frontend receives ticks via the `tick-stream` mini-service, not
  // directly from this provider — see `mini-services/tick-stream/`.
  // This stub satisfies the interface; the actual WS lives server-side.
  subscribeTicks(
    _symbols: string[],
    _onTick: (t: TickEvent) => void,
    _onStatus: (status: { connected: boolean }) => void,
  ): Unsubscribe {
    return () => {};
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BINANCE_BASE}/ping`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const binanceProvider = new BinanceProvider();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/providers/binance.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace `src/lib/binance.ts` with a re-export shim**

Replace the entire content of `src/lib/binance.ts` with:

```ts
/**
 * Back-compat shim — the Binance client moved to `src/lib/providers/binance.ts`.
 * Existing imports keep working until Task 11 deletes this file.
 */
export {
  binanceProvider,
  parseKlines as _parseKlines,
  parseTicker as _parseTicker,
} from "./providers/binance";
export type { Kline, Ticker24h } from "./providers/types";
export { UpstreamError as BinanceError } from "./providers/types";
```

- [ ] **Step 6: Lint and run the full test suite**

Run:
```bash
bun run lint
bun test
```
Expected: lint clean, all tests still passing (110 pre-existing + 4 new = 114).

- [ ] **Step 7: Commit**

```bash
git add src/lib/providers/binance.ts src/lib/providers/binance.test.ts src/lib/binance.ts
git commit -m "refactor(providers): move Binance into providers/, keep shim"
```

---

## Task 4: Implement the Bybit provider (REST)

**Files:**
- Create: `src/lib/providers/bybit.ts`
- Create: `src/lib/providers/bybit.test.ts`

**Interfaces:**
- Consumes: `MarketDataProvider`, `Kline`, `Ticker24h`, `UpstreamError`, `TickEvent`, `Unsubscribe` from `./types`; `toBybitSymbol` from `./symbols`.
- Produces: `BybitProvider` class + `bybitProvider` singleton. Two exported pure functions: `parseBybitKlines(raw, interval)` and `parseBybitTicker(raw)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/providers/bybit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBybitKlines, parseBybitTicker } from "./bybit";
import type { Kline, Ticker24h } from "./types";

describe("parseBybitKlines", () => {
  it("converts a Bybit v5 /v5/market/klines list to Kline[]", () => {
    // Bybit returns an array of arrays: [startTime, open, high, low, close,
    // volume, turnover]; closeTime is startTime + intervalMs.
    const raw = [
      ["1700000000000", "30000", "30100", "29900", "30050", "100", "3005000"],
      ["1700003600000", "30050", "30200", "30000", "30150", "120", "3618000"],
    ];
    const out = parseBybitKlines(raw, "4h");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject<Kline>({
      openTime: 1700000000000,
      open: 30000,
      high: 30100,
      low: 29900,
      close: 30050,
      volume: 100,
      quoteVolume: 3005000,
      closeTime: 1700000000000 + 4 * 60 * 60 * 1000,
    });
    expect(out[1].trades).toBe(0); // Bybit does not return trade count per candle
  });

  it("throws UpstreamError when payload is not an array of arrays", () => {
    expect(() => parseBybitKlines({ foo: 1 }, "4h")).toThrow();
  });
});

describe("parseBybitTicker", () => {
  it("maps /v5/market/tickers fields to Ticker24h", () => {
    const out = parseBybitTicker({
      symbol: "BTCUSDT",
      lastPrice: "30000.50",
      price24hPcnt: "0.005",         // fraction: 0.005 = +0.5%
      highPrice24h: "30500",
      lowPrice24h: "29900",
      volume24h: "1000",
      turnover24h: "30000000",
    });
    expect(out).toMatchObject<Ticker24h>({
      symbol: "BTCUSDT",
      lastPrice: 30000.5,
      priceChange: 150,              // 30000.50 * 0.005
      highPrice: 30500,
      lowPrice: 29900,
      volume: 1000,
      quoteVolume: 30000000,
      trades: 0,                     // not provided
    });
    expect(out.priceChangePercent).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/providers/bybit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Bybit REST**

Create `src/lib/providers/bybit.ts`:

```ts
import {
  UpstreamError,
  type Kline,
  type MarketDataProvider,
  type TickEvent,
  type Ticker24h,
  type Unsubscribe,
} from "./types";
import { toBybitSymbol } from "./symbols";

const BYBIT_BASE = "https://api.bybit.com/v5/market";
const FETCH_TIMEOUT_MS = 5000;

/** Bybit accepts minutes as strings: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M. */
const INTERVAL_TO_BYBIT: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
};

function intervalMs(interval: string): number {
  const m = /^(\d+)m$/.exec(interval);
  if (m) return Number(m[1]) * 60_000;
  if (interval === "1h") return 3_600_000;
  if (interval === "4h") return 4 * 3_600_000;
  if (interval === "1d") return 86_400_000;
  return 4 * 3_600_000;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "PanelCuantitativo/1.0 (+server)" },
      cache: "no-store",
    });
    if (!res.ok) {
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text().catch(() => undefined); }
      throw new UpstreamError(`Bybit responded ${res.status} ${res.statusText}`, "bybit", body);
    }
    return res;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError(`Bybit timed out after ${FETCH_TIMEOUT_MS}ms`, "bybit");
    }
    throw new UpstreamError(`Bybit network error: ${err instanceof Error ? err.message : String(err)}`, "bybit");
  } finally {
    clearTimeout(timer);
  }
}

export function parseBybitKlines(raw: unknown, interval: string): Kline[] {
  if (!Array.isArray(raw)) {
    throw new UpstreamError("Bybit klines payload was not an array", "bybit", raw);
  }
  const step = intervalMs(interval);
  return raw.map((row) => {
    if (!Array.isArray(row) || row.length < 7) {
      throw new UpstreamError("Bybit malformed kline row", "bybit", row);
    }
    const openTime = Number(row[0]);
    return {
      openTime,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: openTime + step,
      quoteVolume: Number(row[6]),
      trades: 0,
    };
  });
}

export function parseBybitTicker(raw: unknown): Ticker24h {
  if (!raw || typeof raw !== "object" || !("lastPrice" in raw)) {
    throw new UpstreamError("Bybit ticker missing lastPrice", "bybit", raw);
  }
  const r = raw as Record<string, string | number>;
  const last = Number(r.lastPrice);
  const pct = Number(r.price24hPcnt); // fraction, e.g. 0.005 = +0.5%
  return {
    symbol: String(r.symbol),
    lastPrice: last,
    priceChange: last * pct,
    priceChangePercent: pct * 100,
    highPrice: Number(r.highPrice24h),
    lowPrice: Number(r.lowPrice24h),
    volume: Number(r.volume24h),
    quoteVolume: Number(r.turnover24h),
    trades: 0,
  };
}

export class BybitProvider implements MarketDataProvider {
  readonly id = "bybit" as const;

  async getKlines(symbol: string, interval = "4h", limit = 500): Promise<Kline[]> {
    const s = toBybitSymbol(symbol);
    const bybitInterval = INTERVAL_TO_BYBIT[interval] ?? "240";
    const url = `${BYBIT_BASE}/klines?category=spot&symbol=${encodeURIComponent(s)}&interval=${bybitInterval}&limit=${limit}`;
    const res = await fetchWithTimeout(url);
    const json = (await res.json()) as { result?: { list?: unknown[] } };
    return parseBybitKlines(json?.result?.list, interval).reverse(); // Bybit returns DESC; we want ASC
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    const s = toBybitSymbol(symbol);
    const url = `${BYBIT_BASE}/tickers?category=spot&symbol=${encodeURIComponent(s)}`;
    const res = await fetchWithTimeout(url);
    const json = (await res.json()) as { result?: { list?: unknown[] } };
    if (!json.result?.list?.[0]) {
      throw new UpstreamError("Bybit ticker list empty", "bybit", json);
    }
    return parseBybitTicker(json.result.list[0]);
  }

  subscribeTicks(
    _symbols: string[],
    _onTick: (t: TickEvent) => void,
    _onStatus: (status: { connected: boolean }) => void,
  ): Unsubscribe {
    return () => {};
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BYBIT_BASE}/time`);
      const json = (await res.json()) as { retCode?: number };
      return res.ok && json.retCode === 0;
    } catch {
      return false;
    }
  }
}

export const bybitProvider = new BybitProvider();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/providers/bybit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint and commit**

Run:
```bash
bun run lint
git add src/lib/providers/bybit.ts src/lib/providers/bybit.test.ts
git commit -m "feat(providers): implement Bybit v5 REST provider with normalizers"
```

---

## Task 5: Implement the router with fallback logic

**Files:**
- Create: `src/lib/providers/router.ts`
- Create: `src/lib/providers/router.test.ts`

**Interfaces:**
- Consumes: `binanceProvider`, `bybitProvider` from `./binance` and `./bybit`; `MarketDataProvider` from `./types`.
- Produces: `getKlines(symbol, interval, limit)` → `{ provider: ProviderId, klines: Kline[] }`; `getTicker24h(symbol)` → `{ provider: ProviderId, ticker: Ticker24h | null }`; `getActiveSource()` → `ProviderId` (for the UI badge); `healthy()` → `{ [id]: boolean }`. Provider order is fixed `[binance, bybit]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/providers/router.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createProviderRouter } from "./router";
import { UpstreamError, type Kline, type Ticker24h } from "./types";

const fakeKlines: Kline[] = [
  { openTime: 1, open: 1, high: 1, low: 1, close: 1, volume: 0, closeTime: 2, quoteVolume: 0, trades: 0 },
];

function makeProvider(
  id: "binance" | "bybit",
  klines: Kline[] | Error,
  ticker: Ticker24h | null | Error,
  healthy: boolean,
) {
  return {
    id,
    getKlines: vi.fn(async () => {
      if (klines instanceof Error) throw klines;
      return klines;
    }),
    getTicker24h: vi.fn(async () => {
      if (ticker instanceof Error) throw ticker;
      return ticker;
    }),
    subscribeTicks: vi.fn(() => () => {}),
    healthy: vi.fn(async () => healthy),
  };
}

describe("createProviderRouter", () => {
  it("returns Binance when Binance is healthy", async () => {
    const binance = makeProvider("binance", fakeKlines, null, true);
    const bybit = makeProvider("bybit", fakeKlines, null, true);
    const router = createProviderRouter([binance, bybit]);
    const r = await router.getKlines("BTCUSDT");
    expect(r.provider).toBe("binance");
    expect(r.klines).toBe(fakeKlines);
  });

  it("falls back to Bybit when Binance throws UpstreamError", async () => {
    const binance = makeProvider("binance", new UpstreamError("down", "binance"), null, false);
    const bybit = makeProvider("bybit", fakeKlines, null, true);
    const router = createProviderRouter([binance, bybit]);
    const r = await router.getKlines("BTCUSDT");
    expect(r.provider).toBe("bybit");
  });

  it("skips Bybit when it is also unhealthy and propagates the last error", async () => {
    const binance = makeProvider("binance", new UpstreamError("binance down", "binance"), null, false);
    const bybit = makeProvider("bybit", new UpstreamError("bybit down", "bybit"), null, false);
    const router = createProviderRouter([binance, bybit]);
    await expect(router.getKlines("BTCUSDT")).rejects.toThrow(/bybit down/);
  });

  it("treats a null ticker as success (no throw)", async () => {
    const binance = makeProvider("binance", fakeKlines, null, true);
    const router = createProviderRouter([binance]);
    const r = await router.getTicker24h("BTCUSDT");
    expect(r.provider).toBe("binance");
    expect(r.ticker).toBeNull();
  });

  it("getActiveSource reflects the most recent successful provider", async () => {
    const binance = makeProvider("binance", fakeKlines, null, false);
    const bybit = makeProvider("bybit", fakeKlines, null, true);
    const router = createProviderRouter([binance, bybit]);
    await router.getKlines("BTCUSDT");
    expect(router.getActiveSource()).toBe("bybit");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/providers/router.test.ts`
Expected: FAIL — `createProviderRouter` not exported.

- [ ] **Step 3: Implement the router**

Create `src/lib/providers/router.ts`:

```ts
import {
  UpstreamError,
  type Kline,
  type MarketDataProvider,
  type ProviderId,
  type Ticker24h,
  type TickEvent,
  type Unsubscribe,
} from "./types";
import { binanceProvider } from "./binance";
import { bybitProvider } from "./bybit";

export type ProviderResult<T> = { provider: ProviderId; value: T };

/**
 * createProviderRouter — runs a list of providers in order and returns
 * the first successful result. The active source is cached in memory so
 * the UI badge can read it synchronously after the first call.
 *
 * The default singleton uses [binance, bybit]. Tests inject their own
 * providers via `createProviderRouter([...])`.
 */
export function createProviderRouter(providers: MarketDataProvider[]) {
  let activeSource: ProviderId | null = null;

  async function runWithFallback<T>(
    label: string,
    fn: (p: MarketDataProvider) => Promise<T>,
  ): Promise<ProviderResult<T>> {
    let lastErr: unknown = null;
    for (const p of providers) {
      try {
        const value = await fn(p);
        activeSource = p.id;
        return { provider: p.id, value };
      } catch (err) {
        lastErr = err;
        // Continue to the next provider on any failure.
      }
    }
    // No provider succeeded — propagate the last error wrapped as UpstreamError.
    const msg =
      lastErr instanceof Error
        ? `All providers failed for ${label}: ${lastErr.message}`
        : `All providers failed for ${label}`;
    throw new UpstreamError(msg, activeSource ?? providers[0]?.id ?? "binance", lastErr);
  }

  return {
    id: "router" as const,
    getKlines(symbol: string, interval = "4h", limit = 500) {
      return runWithFallback(`getKlines(${symbol})`, (p) =>
        p.getKlines(symbol, interval, limit),
      ).then((r) => ({ provider: r.provider, klines: r.value }));
    },
    getTicker24h(symbol: string) {
      return runWithFallback(`getTicker24h(${symbol})`, (p) =>
        p.getTicker24h(symbol),
      ).then((r) => ({ provider: r.provider, ticker: r.value }));
    },
    subscribeTicks(
      symbols: string[],
      onTick: (t: TickEvent) => void,
      onStatus: (status: { connected: boolean }) => void,
    ): Unsubscribe {
      // The active provider holds the WS subscription. If the active
      // provider later swaps (e.g. health check fails), the tick-stream
      // mini-service will re-establish with the new active provider.
      const active = providers.find((p) => p.id === activeSource) ?? providers[0];
      return active.subscribeTicks(symbols, onTick, onStatus);
    },
    async healthy(): Promise<Record<ProviderId, boolean>> {
      const out = {} as Record<ProviderId, boolean>;
      await Promise.all(
        providers.map(async (p) => {
          out[p.id] = await p.healthy();
        }),
      );
      return out;
    },
    getActiveSource(): ProviderId | null {
      return activeSource;
    },
    providers,
  };
}

export const providerRouter = createProviderRouter([binanceProvider, bybitProvider]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/providers/router.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint and run the full test suite**

Run:
```bash
bun run lint
bun test
```
Expected: lint clean, 119 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/lib/providers/router.ts src/lib/providers/router.test.ts
git commit -m "feat(providers): add fallback router with health-aware active source"
```

---

## Task 6: Add `source` to the `AnalysisResponse` and the API route

**Files:**
- Modify: `src/lib/types.ts` — `AnalysisResponse` gains `source?: ProviderId`, `no_disponible.source: false` (additive).
- Modify: `src/app/api/analysis/route.ts` — uses the router, stamps `source`.

**Interfaces:**
- Consumes: `providerRouter` from `src/lib/providers/router`; `ProviderId` from `src/lib/providers/types`.
- Produces: API responses now carry `source: "binance" | "bybit"`.

- [ ] **Step 1: Modify `src/lib/types.ts`**

After the existing `AnalysisResponse` interface block, add the import and the field. Edit at the top of the file (line 6 area):

Add after line 6:
```ts
import type { ProviderId } from "./providers/types";
```

Then inside the `AnalysisResponse` interface, just after `updated_at: string;` (around line 158), add:
```ts
  /** Active data source for this analysis (binance = primary, bybit = fallback). */
  source: ProviderId | null;
```

In the `no_disponible` object (around line 118-143), add `source: false,` to the end of the literal.

- [ ] **Step 2: Verify the type compiles**

Run: `bun run lint`
Expected: PASS (lint will fail if the field is missing).

- [ ] **Step 3: Modify `src/app/api/analysis/route.ts`**

Replace the imports at the top (lines 1-27). New imports:

```ts
import { NextRequest, NextResponse } from "next/server";
import { providerRouter } from "@/lib/providers/router";
import { UpstreamError } from "@/lib/providers/types";
import { isSupportedSymbol } from "@/lib/providers/symbols";
import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateFibonacciRetracement,
  calculateVWAP,
  calculateStochastic,
  calculateIchimoku,
  detectStochCross,
  detectMacdCross,
  detectRecentCross,
  findSupportResistance,
  determineCrossState,
} from "@/lib/indicators";
import { buildStructureText } from "@/lib/structure";
import { getCached, setCached } from "@/lib/cache";
import { recordCrossIfNew } from "@/lib/cross-history";
import type { AnalysisResponse } from "@/lib/types";
```

Remove the old `ALLOWED_SYMBOLS` constant (lines 33-39) and the old imports from `@/lib/binance`.

Change the function signature (line 56):
```ts
function buildAnalysis(
  symbol: string,
  klines: Kline[],
  ticker: Awaited<ReturnType<typeof providerRouter.getTicker24h>>["ticker"],
  source: import("@/lib/providers/types").ProviderId,
): AnalysisResponse {
```

In the body of `buildAnalysis`, change the spotPrice fallback (line 67) and the return literal (line 282-346) so the final object has `source,` set to the `source` parameter. Update `no_disponible` literal so it includes `source: false,`.

Then replace the GET handler body (lines 450-507):

```ts
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") ?? "").toUpperCase().trim();

  if (!symbol || !isSupportedSymbol(symbol)) {
    return NextResponse.json(
      { error: `Símbolo inválido. Permitidos: BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, BNBUSDT` },
      { status: 400 },
    );
  }

  const cacheKey = `analysis:${symbol}`;
  const cached = getCached<AnalysisResponse>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "HIT", "cache-control": "no-store" },
    });
  }

  try {
    const [klinesRes, tickerRes] = await Promise.all([
      providerRouter.getKlines(symbol, "4h", 500),
      providerRouter.getTicker24h(symbol).catch((e) => {
        if (e instanceof UpstreamError) return { provider: "binance" as const, ticker: null };
        throw e;
      }),
    ]);

    if (klinesRes.klines.length === 0) {
      throw new UpstreamError("Provider devolvió 0 klines", klinesRes.provider);
    }

    const payload = buildAnalysis(symbol, klinesRes.klines, tickerRes.ticker, klinesRes.provider);
    setCached(cacheKey, payload, CACHE_TTL_MS);

    persistCrosses(payload).catch((e) => {
      console.error("[analysis] persist crosses error:", e);
    });

    return NextResponse.json(payload, {
      headers: { "x-cache": "MISS", "x-source": klinesRes.provider, "cache-control": "no-store" },
    });
  } catch (err) {
    const message =
      err instanceof UpstreamError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Error desconocido al calcular el análisis";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Lint and run tests**

Run:
```bash
bun run lint
bun test
```
Expected: lint clean, tests pass.

- [ ] **Step 5: Smoke-test the route**

Run: `bun run dev`
Then: `curl -s 'http://localhost:3000/api/analysis?symbol=BTCUSDT' | head -c 300`
Expected: JSON containing `"source":"binance"` (or `"bybit"` if Binance is unreachable from the dev machine).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/app/api/analysis/route.ts
git commit -m "feat(analysis): route through provider router and stamp source"
```

---

## Task 7: Migrate `correlation` and `returns` routes to the router

**Files:**
- Modify: `src/app/api/correlation/route.ts`
- Modify: `src/app/api/returns/route.ts`

**Interfaces:**
- Consumes: `providerRouter` from `@/lib/providers/router`; existing local helpers.
- Produces: Same response payloads, internally using the router.

- [ ] **Step 1: Update `src/app/api/correlation/route.ts` imports and call sites**

Replace the import on line 2:
```ts
import { providerRouter } from "@/lib/providers/router";
```

Replace the `fetchKlines` call inside the `Promise.all` (line 103):
```ts
const klines = await providerRouter.getKlines(s, interval, limit).then((r) => r.klines);
```

- [ ] **Step 2: Update `src/app/api/returns/route.ts` imports and call sites**

Replace the import on line 2:
```ts
import { providerRouter } from "@/lib/providers/router";
```

Replace the two `fetchKlines` calls (lines 108-109):
```ts
const [kA, kB] = await Promise.all([
  providerRouter.getKlines(symbolA, interval, limit).then((r) => r.klines),
  providerRouter.getKlines(symbolB, interval, limit).then((r) => r.klines),
]);
```

- [ ] **Step 3: Lint and run tests**

Run:
```bash
bun run lint
bun test
```
Expected: lint clean.

- [ ] **Step 4: Smoke-test the routes**

Run:
```bash
bun run dev
curl -s 'http://localhost:3000/api/returns?a=BTCUSDT&b=ETHUSDT' | head -c 200
curl -s 'http://localhost:3000/api/correlation?interval=4h&limit=100' | head -c 200
```
Expected: both return 200 with valid JSON.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/correlation/route.ts src/app/api/returns/route.ts
git commit -m "refactor(api): route correlation and returns through provider router"
```

---

## Task 8: Build the `tick-stream` mini-service with Binance → Bybit fallback

**Files:**
- Create: `mini-services/tick-stream/package.json`
- Create: `mini-services/tick-stream/index.ts`
- Create: `mini-services/tick-stream/tsconfig.json`

**Interfaces:**
- Consumes: `ws` (existing dep), `socket.io` (existing dep), same upstream constants as the existing `ws-tick` service.
- Produces: socket.io server on port 3005 (was 3003 for `ws-tick`), emits the same `tick`, `ws-status`, `heartbeat` events. Falls back from Binance WS to Bybit WS after 3 consecutive failures.

- [ ] **Step 1: Create the package manifest**

Create `mini-services/tick-stream/package.json`:

```json
{
  "name": "tick-stream",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --hot index.ts",
    "start": "bun index.ts"
  },
  "dependencies": {
    "socket.io": "^4.7.5",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Create a tsconfig**

Create `mini-services/tick-stream/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 3: Implement the service**

Create `mini-services/tick-stream/index.ts`:

```ts
/**
 * tick-stream — real-time price tick router with Binance → Bybit fallback.
 *
 * Subscribes to Binance public trade stream first; if Binance WS drops
 * 3 times in a row within 30s, switches to Bybit's public trade stream.
 * Both upstreams produce normalized {symbol, price, time} events to all
 * connected browser clients via socket.io on port 3005.
 *
 * Event schema (unchanged from ws-tick):
 *  - `tick`       { symbol, price, time }
 *  - `ws-status`  { connected: boolean, source: "binance"|"bybit" }
 *  - `heartbeat`  { time }
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";
import { WebSocket } from "ws";

const PORT = 3005;
const SYMBOLS = ["btcusdt", "ethusdt", "xrpusdt", "solusdt", "bnbusdt"] as const;
type Source = "binance" | "bybit";
const THROTTLE_MS = 800;
const lastEmit = new Map<string, number>();

const BINANCE_WS_URL =
  "wss://stream.binance.com:9443/stream?streams=" +
  SYMBOLS.map((s) => `${s}@trade`).join("/");

const BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/spot";

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "tick-stream",
      port: PORT,
      activeSource,
      binanceConnected: binanceReady,
      bybitConnected: bybitReady,
      clients: io.engine.clientsCount,
      uptime: process.uptime(),
    }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: {
    origin: ["http://localhost:81", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: false,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

let binanceReady = false;
let bybitReady = false;
let binanceWs: WebSocket | null = null;
let bybitWs: WebSocket | null = null;
let activeSource: Source | null = null;
let binanceFailures = 0;
const FAILURE_THRESHOLD = 3;

type Tick = { symbol: string; price: number; time: number };

function emit(tick: Tick): void {
  const now = Date.now();
  const last = lastEmit.get(tick.symbol) ?? 0;
  if (now - last < THROTTLE_MS) return;
  lastEmit.set(tick.symbol, now);
  io.emit("tick", tick);
}

function setActive(source: Source | null): void {
  if (source === activeSource) return;
  activeSource = source;
  io.emit("ws-status", { connected: source !== null, source });
}

function connectBinance(): void {
  console.log(`[binance] connecting to ${BINANCE_WS_URL}`);
  const ws = new WebSocket(BINANCE_WS_URL);
  binanceWs = ws;

  ws.on("open", () => {
    binanceReady = true;
    binanceFailures = 0;
    console.log("[binance] connected");
    setActive("binance");
  });

  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      const data = msg?.data ?? msg;
      const symbol = String(data?.s ?? "").toUpperCase();
      const price = Number(data?.p);
      const time = Number(data?.T ?? Date.now());
      if (!symbol || !Number.isFinite(price)) return;
      emit({ symbol, price, time });
    } catch (err) {
      console.error("[binance] parse error:", err);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("[binance] ws error:", err.message);
  });

  ws.on("close", () => {
    binanceReady = false;
    binanceFailures++;
    if (binanceFailures >= FAILURE_THRESHOLD) {
      console.log(`[binance] ${binanceFailures} consecutive failures, activating bybit`);
      setActive("bybit");
      connectBybit();
    } else {
      const delay = Math.min(1000 * Math.pow(2, binanceFailures), 15000);
      setTimeout(connectBinance, delay);
    }
  });
}

function connectBybit(): void {
  if (bybitWs) return;
  console.log(`[bybit] connecting to ${BYBIT_WS_URL}`);
  const ws = new WebSocket(BYBIT_WS_URL);
  bybitWs = ws;

  ws.on("open", () => {
    bybitReady = true;
    const args = SYMBOLS.map((s) => `publicTrade.${s.toUpperCase()}`);
    ws.send(JSON.stringify({ op: "subscribe", args }));
    setActive("bybit");
    console.log("[bybit] connected, subscribed to trades");
  });

  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      if (msg?.topic?.startsWith("publicTrade.") && Array.isArray(msg.data)) {
        for (const trade of msg.data) {
          emit({
            symbol: String(trade.s ?? "").toUpperCase(),
            price: Number(trade.p),
            time: Number(trade.T ?? Date.now()),
          });
        }
      }
    } catch (err) {
      console.error("[bybit] parse error:", err);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("[bybit] ws error:", err.message);
  });

  ws.on("close", () => {
    bybitReady = false;
    bybitWs = null;
    const delay = Math.min(1000 * Math.pow(2, 1), 15000);
    setTimeout(connectBybit, delay);
  });
}

setInterval(() => {
  if (activeSource) {
    io.emit("heartbeat", { time: Date.now() });
  }
}, 5000);

io.on("connection", (socket) => {
  socket.emit("ws-status", { connected: activeSource !== null, source: activeSource });
  socket.on("disconnect", () => {});
});

httpServer.listen(PORT, () => {
  console.log(`[tick-stream] socket.io on :${PORT}`);
  connectBinance();
});

function shutdown(signal: string) {
  console.log(`[tick-stream] ${signal}, shutting down`);
  binanceWs?.close();
  bybitWs?.close();
  io.close(() => httpServer.close(() => process.exit(0)));
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

- [ ] **Step 4: Install and smoke-test**

Run:
```bash
cd mini-services/tick-stream && bun install
cd mini-services/tick-stream && setsid nohup bun index.ts > service.log 2>&1 &
sleep 3
curl -s http://localhost:3005/health
```
Expected: `{"ok":true,"service":"tick-stream","port":3005,"activeSource":"binance",...}`.

- [ ] **Step 5: Update Caddyfile routing**

Edit `Caddyfile`. Inside the `handle` block (line 16), the route to port 3000 stays. The Caddyfile only needs to know about new ports when they change; the WebSocket upgrade is already routed via `?XTransformPort=NNNN`. No file change is required if `use-tick-stream.ts` keeps using port 3003 — but we changed to 3005. Update the `GATEWAY_PORT` constant in `use-tick-stream.ts` in Task 9.

- [ ] **Step 6: Kill the old `ws-tick` service and stop the new one for now**

```bash
pkill -f "ws-tick" || true
pkill -f "tick-stream" || true
```

- [ ] **Step 7: Commit**

```bash
git add mini-services/tick-stream/
git commit -m "feat(mini-services): tick-stream router with binance→bybit ws fallback"
```

---

## Task 9: Point the frontend `useTickStream` at port 3005 and expose `source`

**Files:**
- Modify: `src/hooks/use-tick-stream.ts`

**Interfaces:**
- Consumes: socket.io client (existing).
- Produces: `TickState` gains `source: "binance" | "bybit" | null`.

- [ ] **Step 1: Update the GATEWAY_PORT and the tick stream**

In `src/hooks/use-tick-stream.ts`:
- Replace `const GATEWAY_PORT = "81";` with `const GATEWAY_PORT = "81"; const TICK_STREAM_PORT = "3005";`.
- Replace all references to `"3003"` with `TICK_STREAM_PORT`. The `buildSocketUrl()` function returns the `?XTransformPort=…` query — change `3003` to `TICK_STREAM_PORT` (use a template literal).

- [ ] **Step 2: Update the TickState type**

Replace the `TickState` type (line 47-53) with:
```ts
export type TickState = {
  prices: Record<string, TickPrice>;
  connected: boolean;
  binanceLive: boolean;
  source: "binance" | "bybit" | null;
  lastHeartbeat: number | null;
  tickCount: number;
};
```

Replace `initialState` (lines 62-68) with:
```ts
const initialState: TickState = {
  prices: {},
  connected: false,
  binanceLive: false,
  source: null,
  lastHeartbeat: null,
  tickCount: 0,
};
```

Update the equality check in `setState` (lines 78-84) to also compare `source`.

Update the `ws-status` handler (lines 166-171):
```ts
sock.on("ws-status", (payload: { connected?: boolean; reconnecting?: boolean; source?: "binance" | "bybit" }) => {
  setState({
    ...state,
    binanceLive: payload?.connected === true,
    source: payload?.source ?? (payload?.connected === true ? "binance" : null),
  });
});
```

- [ ] **Step 3: Lint and run tests**

Run: `bun run lint && bun test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-tick-stream.ts
git commit -m "feat(hooks): expose tick-stream source and update port to 3005"
```

---

## Task 10: Add i18n strings and the `FUENTE` badge to the UI

**Files:**
- Modify: `src/lib/i18n.ts` — add `header.source`, `header.sourceBinance`, `header.sourceBybit` to es/en/zh/fr.
- Modify: `src/components/panel/asset-card.tsx` — render a `FUENTE: …` micro-badge under the symbol header.
- Modify: `src/app/page.tsx` — render a global "FUENTE" pill in the header, showing the active tick-stream source.

**Interfaces:**
- Consumes: `cells[s].data?.source` from the analysis response; `tick.source` from `useTickStream()`.
- Produces: Two visual indicators (per-card micro-badge + global pill) and 12 new i18n keys (3 keys × 4 languages).

- [ ] **Step 1: Add i18n keys**

Open `src/lib/i18n.ts`. In the `es` dictionary, add to the `// Header` section:

```ts
"header.source": "Fuente",
"header.sourceBinance": "Binance",
"header.sourceBybit": "Bybit",
```

For the other languages, mirror the keys:
- en: `"Source"`, `"Binance"`, `"Bybit"`
- zh: `"数据源"`, `"币安"`, `"Bybit"`
- fr: `"Source"`, `"Binance"`, `"Bybit"`

- [ ] **Step 2: Update the asset card**

Open `src/components/panel/asset-card.tsx`. Inside the header block (where `data.symbol` is rendered, search for `SYMBOL_META[data.symbol]`), add immediately after the existing symbol label:

```tsx
{data.source && (
  <span
    className="ml-2 inline-flex items-center rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
    title={`Fuente de datos: ${data.source}`}
  >
    {data.source}
  </span>
)}
```

- [ ] **Step 3: Update the global header pill**

Open `src/app/page.tsx`. Find the live-tick badge block (around line 218-260). Add a sibling pill after it that shows the active source:

```tsx
{tick.source && (
  <div
    className="flex items-center gap-2 rounded-md border border-white/8 bg-black/20 px-3 py-1.5 text-xs"
    title={`Proveedor upstream activo: ${tick.source}`}
  >
    <span className="text-muted-foreground">{t("header.source")}:</span>
    <span className="font-semibold uppercase tracking-wider">{t(`header.source${tick.source[0].toUpperCase()}${tick.source.slice(1)}` as "header.sourceBinance" | "header.sourceBybit")}</span>
  </div>
)}
```

- [ ] **Step 4: Lint and run tests**

Run: `bun run lint && bun test`
Expected: PASS.

- [ ] **Step 5: Smoke-test the UI**

Run `bun run dev`, open `http://localhost:3000` (or through Caddy on `:81`), verify:
- Each card shows `FUENTE: binance` (or `bybit`) micro-badge.
- Header shows a `Fuente: Binance` (or `Fuente: Bybit`) pill next to `TICK LIVE`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n.ts src/components/panel/asset-card.tsx src/app/page.tsx
git commit -m "feat(ui): show active data source badge per card and in header"
```

---

## Task 11: Delete the old `ws-tick` service and the `binance.ts` shim

**Files:**
- Delete: `mini-services/ws-tick/`
- Delete: `src/lib/binance.ts`

**Interfaces:**
- Consumes: nothing — pure cleanup.
- Produces: repo no longer has the legacy `ws-tick` directory nor the `binance.ts` shim.

- [ ] **Step 1: Verify no remaining imports of the legacy paths**

Run:
```bash
rg -l "ws-tick" src/ || echo "no src refs"
rg "from \"@/lib/binance\"" src/ || echo "no src imports"
```
Expected: only docs/README references (if any). If anything in `src/` still references them, fix it before deleting.

- [ ] **Step 2: Delete the directories**

```bash
git rm -r mini-services/ws-tick
git rm src/lib/binance.ts
```

- [ ] **Step 3: Lint, run tests, smoke-test the dashboard**

Run:
```bash
bun run lint
bun test
bun run dev
```
Expected: dashboard loads, source badges render, no console errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove legacy ws-tick service and binance.ts shim"
```

---

## Task 12: End-to-end fallback verification

**Files:** none — verification only.

**Interfaces:**
- Consumes: the running app, the `tick-stream` mini-service on port 3005, and a way to simulate Binance failure.

- [ ] **Step 1: Start the dashboard and tick-stream**

```bash
# Terminal A
bun run dev
# Terminal B
cd mini-services/tick-stream && bun run start
```

- [ ] **Step 2: Verify the happy path**

```bash
curl -s 'http://localhost:3000/api/analysis?symbol=BTCUSDT' | jq .source
curl -s 'http://localhost:3005/health' | jq .activeSource
```
Expected: `"binance"` for both.

- [ ] **Step 3: Simulate Binance failure**

In a sandbox without internet to `api.binance.com` (or by adding a hosts-file block), hit the endpoint:
```bash
curl -s 'http://localhost:3000/api/analysis?symbol=BTCUSDT' | jq .source
```
Expected: `"bybit"`. If the sandbox can reach Binance but not Bybit, swap the order in `providerRouter` temporarily for the test, then revert.

- [ ] **Step 4: Verify the UI reflects the fallback**

Open the dashboard. Confirm the header pill and card badges update to `Bybit`.

- [ ] **Step 5: Document the verification in `worklog.md`**

Append a new round to the worklog with title "Round 24 — Provider abstraction + Bybit fallback", describing the work, the verification output, and the next-phase priorities.

- [ ] **Step 6: Commit**

```bash
git add worklog.md
git commit -m "docs(worklog): round 24 — provider abstraction + bybit fallback"
```

---

## Self-Review

**1. Spec coverage:**

- "Capa de abstracción `MarketDataProvider`": Tasks 1, 3, 5 ✅
- "Bybit como proveedor secundario": Tasks 4, 5, 8 ✅
- "UI muestra la fuente activa": Tasks 6, 10 ✅
- "Mantener 110 tests pasando, añadir nuevos": Tasks 1-5 add 9 tests; existing suite untouched (Tasks 6-11 preserve them) ✅
- "Frecuentes commits": Each task ends with `git commit` ✅
- "i18n en 4 idiomas": Task 10 adds keys to all four ✅
- "Sin nuevos deps runtime": All tasks use existing `socket.io`, `ws`, `next`, `bun` ✅
- "Fallback funcional verificado": Task 12 ✅

**2. Placeholder scan:**

- No "TBD" / "TODO" / "fill in" found in any step ✅
- All code blocks are complete ✅
- No "similar to task N" references — each task shows its own code ✅

**3. Type consistency:**

- `ProviderId` defined in Task 1 (`"binance" | "bybit"`), used identically in Tasks 2-10 ✅
- `MarketDataProvider` interface stable across Tasks 1, 3, 4, 5 ✅
- `UpstreamError.provider` field set to `"binance"` or `"bybit"` consistently ✅
- `Kline` / `Ticker24h` types moved from `binance.ts` to `providers/types.ts` and referenced by the same name everywhere ✅
- `router.getKlines` returns `{ provider, klines }` (Task 5) and is consumed as that shape in Tasks 6 and 7 ✅

No issues found. Plan is ready to execute.
