# AGENTS.md — Panel Cuantitativo // Intradía

> Guidelines for AI code agents working on this project. Follow these rules strictly.

## Project Overview

A crypto quantitative trading dashboard with real-time price ticks, L2 order book, 11 technical indicators, **7 trading strategies** across **4 timeframes** (1h/4h/1D/1W), cross-event alerts, and multilanguage support (ES/EN/ZH/FR).

**Live URL**: `http://localhost:3000` (dev) / `:81` through Caddy. User-visible routes: `/`, `/comparar`, `/status`.
**Repo**: https://github.com/godie/panel-intradia.git

## Tech Stack (NON-NEGOTIABLE)

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js 16 (App Router) | ^16.1.1 |
| Language | TypeScript 5 (strict) | ^5 |
| Runtime | Bun | latest |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) | ^4 |
| Database | Prisma ORM + SQLite | ^6.11 |
| Testing | Vitest | ^4.1 |
| Real-time | Socket.io (mini-services) | ^4.8 |
| State | React hooks (useState/useEffect/useRef) | React 19 |
| Charts | Pure Canvas API (no chart library) | — |
| Icons | Lucide React | ^0.525 |
| Toasts | Sonner | ^2.0 |

### Forbidden
- ❌ No PHP, no Python, no Ruby — TypeScript only
- ❌ No chart libraries (Recharts, Chart.js, D3) — use Canvas API directly
- ❌ No CSS frameworks other than Tailwind (no styled-components, emotion)
- ❌ No indigo or blue primary colors — use the defined palette below
- ❌ No `z-ai-web-dev-sdk` in client-side code — backend only
- ❌ No `bun run build` — dev server only (`bun run dev`)
- ❌ No test files in `src/app/` — tests go in `src/lib/*.test.ts`
- ❌ No hardcoded Spanish strings — use `t()` from `useLanguage()`
- ❌ No direct mini-service fetches — connect through the Caddy gateway using
  `buildGatewaySocketTarget()`: the prefix goes in `opts.path`, **never** in the
  URL (socket.io-client reads a URL path as the *namespace*)
- ❌ No `backdrop-blur`/`filter`/`transform` on the `<header>` — `backdrop-filter`
  creates a stacking context AND a containing block for `fixed` descendants, which
  traps the language dropdown behind the cards and makes the price-alerts modal
  resolve `fixed inset-0` against the header instead of the viewport

## Color Palette

```
Background:     #0A0D12 (near-black)
Card:           #11151C (elevated surface)
Bullish/Green:  #5FBF8F
Bearish/Red:    #E2604F
Amber/Warning:  #E8B04B
Cold Blue:      #4FA8D8
Purple/Fib:     #B48CFF
Foreground:     #E6EDF3
Muted:          #8B96A5
Border:         rgba(255,255,255,0.08)
```

## Architecture

```
src/
  app/
    api/                    — Next.js API Routes (server-side, use `export const runtime = "nodejs"`)
      route.ts              — GET /api
      analysis/route.ts     — GET /api/analysis?symbol=BTCUSDT&tf=4h (60s cache, keyed symbol+tf)
      backtest/route.ts     — POST /api/backtest (single `symbol` or `symbols[]`, max 10)
      correlation/route.ts  — GET /api/correlation?interval=4h&limit=500
      cross-history/route.ts — GET /api/cross-history?symbol=X&limit=50
      returns/route.ts      — GET /api/returns?symbolA=X&symbolB=Y
      status/route.ts       — GET /api/status (server-side probe of the mini-services)
    page.tsx                — Dashboard (client component, "use client")
    comparar/page.tsx       — Fullscreen timeframe comparison (3 fixed presets)
    status/page.tsx         — System status: server probe + browser sockets + diagnosis
    layout.tsx              — Root layout + LanguageProvider + Toaster
    globals.css             — Theme variables + animations
  lib/
    i18n.ts                 — Translation dictionaries (4 languages, ~200 keys)
    indicators.ts           — Technical indicator calculations (pure functions)
    indicators.test.ts      — Vitest tests for indicators
    structure.ts            — Market structure text builder (pure function)
    strategies.ts           — 7 predefined trading strategies
    consensus.ts            — computeConsensus() over all strategies (card + /comparar)
    timeframes.ts           — Timeframe type/aliases, compare presets, tf-map persistence
    status.ts               — Service targets, /health parsing, formatUptime, diagnose()
    types.ts                — Shared types (AnalysisResponse, PriceAlert, etc.)
    cache.ts                — In-memory TTL cache (Map-based)
    cross-history.ts        — SQLite persistence for cross events (Prisma)
    symbol-manager.ts       — Watchlist persistence (localStorage) + validation helpers
    custom-strategies.ts    — User-defined strategies from the builder
    saved-backtests.ts      — Saved backtest history (localStorage)
    backtest.ts             — Backtest engine (+ runMultiSymbolBacktest)
    socket-url.ts           — buildGatewaySocketTarget(): { url, path } for the gateway
    storage-store.ts        — localStorage pub/sub for useSyncExternalStore
    websocket-security.ts   — Shared Origin/price/quantity validators (also used by the mini-services)
    export-snapshot.ts      — JSON export helper
    db.ts                   — Prisma client singleton
    providers/              — Market data providers (binance primary, bybit fallback)
      router.ts             — runWithFallback: tries each provider, reports EVERY failure
      binance.ts            — REST client; base URL comes from BINANCE_BASE_URL
      bybit.ts              — REST fallback client
      symbols.ts            — isValidSymbolFormat / to*Symbol helpers
  hooks/
    use-language.tsx        — LanguageProvider context + useLanguage hook
    use-tick-stream.ts      — Socket.io singleton for live price ticks
    use-order-book.ts       — Socket.io for L2 order book depth
    use-local-storage.ts    — Hydration-safe persisted string (useSyncExternalStore)
    use-cross-alerts.tsx    — Toast notifications for cross events (sessionStorage dedup)
    use-price-alerts.tsx    — User price alerts (localStorage + Web Audio sound)
    use-strategy-alerts.tsx — Toast on strategy action transitions
    use-keyboard-shortcuts.ts — R/C/E/? keyboard shortcuts
    use-toast.ts            — shadcn toast helper
  components/panel/
    asset-card.tsx          — Main card per crypto pair (+ timeframe selector)
    timeframe-selector.tsx  — 1H/4H/1D/1W segmented control
    sparkline.tsx           — Canvas chart (price + EMA + Bollinger + VWAP + Ichimoku)
    market-overview.tsx     — Aggregate market card (breadth, top performer, correlation)
    market-summary.tsx      — Header summary strip
    ticker-tape.tsx         — Scrolling price ticker
    range-bar.tsx           — S/R position bar with Fib markers
    rsi-gauge.tsx           — RSI gauge with zones
    macd-panel.tsx          — MACD histogram + crossover banners
    depth-bar.tsx           — L2 order book visualization
    fib-levels.tsx          — Fibonacci retracement + extensions
    stochastic-row.tsx      — Stochastic oscillator gauge
    stop-loss-selector.tsx  — ATR-based stop loss with multiplier dropdown
    strategy-selector.tsx   — Strategy dropdown + signal breakdown
    strategy-consensus.tsx  — 7-strategy consensus panel (exports CONSENSUS_META)
    strategy-builder.tsx    — Custom strategy builder
    backtest-modal.tsx      — Backtest runner (+ multi-symbol mode)
    cross-history.tsx       — Cross event timeline with filters
    price-alerts-button.tsx — Price alerts modal + sound toggle
    keyboard-help-modal.tsx — Shortcuts help modal
    add-ticker-modal.tsx    — Add a USDT pair to the watchlist
    ticker-detail-modal.tsx — Full per-ticker indicator breakdown
    language-selector.tsx   — Language dropdown (ES/EN/ZH/FR)
    scatter-plot-modal.tsx  — Returns scatter plot + regression (not rendered anywhere yet)
    correlation-matrix.tsx  — Pearson correlation heatmap
    collapsible-section.tsx — Collapsible wrapper (localStorage persistence)
  mini-services/
    websocket-security.ts   — Shared validators; BOTH services import it as `../websocket-security`
    tick-stream/            — Socket.io server (port 3005) → Binance/Bybit trade stream (+ Dockerfile)
    order-book/             — Socket.io server (port 3004) → Binance depth20 stream (+ Dockerfile)
  caddy/
    Dockerfile              — Bakes the root Caddyfile (Railway can't bind-mount a single file)
prisma/
  schema.prisma             — CrossEvent model (SQLite)
```

## Development Rules

### 1. TDD (Test-Driven Development)

**Mandatory for all pure functions in `src/lib/`.**

```
Write test → Run test (fail) → Implement → Run test (pass) → Refactor
```

- Tests live in `src/lib/*.test.ts` (co-located with the source)
- Test framework: Vitest (`bun run test`)
- 278 tests currently passing — never reduce test count
- Every new indicator or strategy function MUST have tests BEFORE implementation
- Test file naming: `{filename}.test.ts` (e.g., `indicators.test.ts`)
- Test structure: `describe("functionName", () => { it("description", () => { ... }) })`

### 2. Code Style

```typescript
// ✅ Correct
import { calculateEMA } from "@/lib/indicators";
import { useLanguage } from "@/hooks/use-language";

// ❌ Wrong — no relative imports for lib/hooks
import { calculateEMA } from "../../lib/indicators";
```

- Use `@/` alias for all imports from `src/lib/`, `src/hooks/`, `src/components/`
- Use relative imports (`./`) only within `src/components/panel/`
- `"use client"` at top of every component file that uses hooks
- `"use client"` NOT needed in `src/lib/` (pure functions)
- TypeScript strict mode — no `any`, no `@ts-ignore`
- Functions in `src/lib/` must be pure (no side effects, no I/O)
- API routes use `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`

### 3. Indicators (`src/lib/indicators.ts`)

All indicator functions follow this pattern:

```typescript
export function calculateX(
  input: number[],
  period: number,
): { series: (number | null)[]; last: number | null; available: boolean } {
  // 1. Validate inputs (return empty/unavailable if invalid)
  // 2. Compute the series
  // 3. Return { series, last, available }
}
```

Rules:
- Always return `available: false` when inputs are insufficient
- Series arrays align with the input array (null for undefined entries)
- No floating point assumptions — use `Number.isFinite()` checks
- Test edge cases: empty arrays, mismatched lengths, zero range, flat series

### 4. Frontend Components

- All text visible to users MUST use `t("key")` from `useLanguage()` — no hardcoded strings
- Canvas rendering: use HiDPI-aware sizing (`window.devicePixelRatio`)
- Responsive: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
- Footer MUST be sticky: `min-h-screen flex flex-col` on root + `mt-auto` on footer
- Accessibility: ARIA labels, `focus-visible` outlines, semantic HTML (`main`, `header`, `footer`)
- No `useEffect` for state derivation — use `useMemo` or compute during render
- No `setState` inside `useEffect` body (lint rule: `react-hooks/set-state-in-effect`)
- No `useRef` access during render (lint rule: `react-hooks/refs`)
- Animations: respect `prefers-reduced-motion`
- Never put `backdrop-blur`/`filter`/`transform` on the `<header>` — it becomes a
  stacking context (trapping the language dropdown's `z-50` behind the cards) and a
  containing block for `fixed` descendants (breaking the price-alerts modal). See
  the comment in `src/app/page.tsx`

### 5. i18n (`src/lib/i18n.ts`)

- 4 languages: `es` (default), `en`, `zh`, `fr`
- Keys are dot-separated: `"section.key"` (e.g., `"header.title"`, `"card.spotPrice"`)
- Fallback chain: target language → Spanish → key itself
- Dynamic values: use `{placeholder}` in the string + `.replace()` in the component
- Language persisted in `localStorage("panel:lang")`
- NEVER hardcode user-visible strings in components — always use `t()`

### 6. Mini-Services

- Each mini-service is an independent Bun project in `mini-services/`
- Must define `index.ts` as entry file
- Must define a specific port (3005 for tick-stream, 3004 for order-book)
- `bun --hot` for auto-restart on file changes
- Socket.io `path: "/socket.io/"` (NOT `"/"`)
- Frontend connects via `buildGatewaySocketTarget("3005" | "3004", window.location)` →
  `io(target.url, { path: target.path })`. The prefix goes in `opts.path`, **never** in the URL:
  `io("http://host:81", { path: "/_tick-stream/socket.io/" })`. Putting it in the URL makes
  socket.io-client treat it as the *namespace* and the server answers "Invalid namespace".
  Caddy's `handle_path` strips the prefix so the service receives the plain `/socket.io/`.
- Health endpoint at `/health` returns JSON with `binanceConnected` status
- Validate with `bash mini-services/validate-service.sh <service-dir> <service> <port>` — boots the service, asserts the `/health` contract, the `/socket.io/` engine path and its Origin enforcement, then shuts it down. The `Validate order-book` / `Validate tick-stream` CI jobs run exactly this script
- **The Dockerfiles must mirror the repo layout** (`WORKDIR /app/mini-services/<svc>` plus a copy
  of `mini-services/websocket-security.ts` at `/app/mini-services/`), because both `index.ts`
  import the shared module as `../websocket-security`. A plain `COPY <svc>/ ./` leaves that
  import unresolvable and the container dies on boot — it must be verified with a real
  `docker build` + `docker run`, since `validate-service.sh` runs from the repo and won't catch it
- Background processes started with double-fork pattern (note: `setsid` is Linux-only — macOS
  needs a plain `nohup ... &`):
  ```bash
  ( setsid nohup bun index.ts > service.log 2>&1 < /dev/null & ) &
  ```

### 7. API Routes

- All API routes use `NextRequest` + `NextResponse`
- 60-second server-side cache for `/api/analysis` (Map-based, `lib/cache.ts`); the key is `symbol+tf`
- `/api/analysis` takes an optional `?tf=` (`1h|4h|1d|1w`, default `4h`, aliases like `1D`/`daily`
  accepted); an unrecognized value returns **400** rather than silently substituting
- `/api/status` probes each mini-service `/health` server-side, using the same
  `TICK_STREAM_UPSTREAM` / `ORDER_BOOK_UPSTREAM` env vars Caddy uses
- 120-second cache for `/api/correlation`
- Errors return `{ "error": "message" }` with HTTP 502 — NEVER fabricated data
- `no_disponible` object flags which fields are unavailable
- Binance API calls use 5-second timeout with `AbortController`
- Fire-and-forget persistence (DB writes don't block the response)

### 8. Testing Checklist

Before committing:
```bash
bun run lint       # Must be clean (0 errors, 0 warnings)
bun run typecheck  # tsc --noEmit — must be clean
bun run test       # Must be 278+ passing
```

Test coverage requirements:
- `indicators.ts`: every exported function must have tests
- `structure.ts`: `buildStructureText` must have tests
- Edge cases: empty arrays, null values, zero ranges, mismatched lengths
- New indicators: minimum 5 tests per function

### 9. Git Conventions

- Commit messages: **Conventional Commits** (`feat:`, `fix(scope):`, `chore:`, `docs:`) — that is
  what the actual history uses, not the `Panel Cuantitativo // Intradía - …` form
- One commit per feature/fix round
- Never commit: `node_modules/`, `dev.log`, `*.png` (screenshots), `db/custom.db`, `.next/`,
  `tool-results/`

### 10. Performance

- Canvas charts: redraw only when data changes (useEffect deps)
- Socket.io: singleton pattern (one connection per service, shared across components)
- Price tick throttle: 800ms per symbol (tick-stream service)
- Order book: 1000ms update cadence (Binance depth20@1000ms)
- Sparkline: max 120 points (sliced from 500 klines)
- Cache: 60s for analysis, 120s for correlation

### 11. Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:/app/db/custom.db` (Docker) · `file:./db/custom.db` (`.env`) | A **relative** `file:` URL resolves against the schema directory, not the cwd — use an absolute path in containers so the DB lands inside the mounted volume |
| `BINANCE_BASE_URL` | `https://api.binance.com/api/v3` | Point at `https://api.binance.us/api/v3` where `api.binance.com` is geo-blocked (it answers **HTTP 451** to US IPs — Railway's default region is us-west) |
| `CORS_ORIGINS` | `http://localhost:81,http://localhost:8000` | Exact browser origins accepted on the mini-services' Socket.IO handshake. A wrong value ⇒ **403** |
| `TICK_STREAM_UPSTREAM` / `ORDER_BOOK_UPSTREAM` | `localhost:3005` / `localhost:3004` | Upstream the gateway proxies to **and** the target `/api/status` probes |
| `PORT` | `8000` (Docker) · `3000` (dev) | |
| `SKIP_DB_INIT` | unset | `1` skips the entrypoint's `prisma db push` (mini-services, placeholder commands) |

## Current State

- **11 technical indicators**: EMA55, EMA200, RSI(14), MACD(12,26,9), S/R pivots, ATR(14), Bollinger Bands(20,2), Fibonacci retracement+extensions, VWAP(20), Stochastic(14,3), Ichimoku(9,26,52)
- **4 timeframes**: 1h / 4h / 1d / 1w, selectable per card; `/comparar` compares two of them with 3 fixed presets
- **Dynamic watchlist**: the default 5 pairs (BTC, ETH, XRP, SOL, BNB) plus any Binance USDT spot pair the user adds
- **7 trading strategies**: Trend Buy, Mean Reversion Buy, Breakout Buy, Trend Short, Mean Reversion Short, Breakout Short, Hold — 3 BUY / 3 SHORT / 1 HOLD, so every consensus level is reachable
- **7 alert types**: EMA cross, MACD cross, momentum flip, Bollinger squeeze, squeeze breakout, Stochastic cross, strategy transitions
- **4 languages**: Español, English, 中文, Français
- **278 Vitest tests**
- **2 mini-services**: tick-stream (port 3005), order-book (port 3004)
- **3 user-visible routes**: `/` (dashboard), `/comparar` (timeframe comparison), `/status` (system status)

## Commands

```bash
bun run dev          # Start Next.js dev server (port 3000)
bun run lint         # ESLint check
bun run typecheck    # tsc --noEmit
bun run test         # Vitest run (278 tests)
bun run test:watch   # Vitest watch mode
bun run db:push      # Push Prisma schema to SQLite
bun run db:generate  # Generate Prisma client

# Mini-services (separate terminals)
cd mini-services/tick-stream && bun run dev  # Port 3005
cd mini-services/order-book && bun run dev   # Port 3004
```
