# AGENTS.md — Panel Cuantitativo // Intradía

> Guidelines for AI code agents working on this project. Follow these rules strictly.

## Project Overview

A crypto quantitative trading dashboard with real-time price ticks, L2 order book, 11 technical indicators, 4 trading strategies, cross-event alerts, and multilanguage support (ES/EN/ZH/FR).

**Live URL**: `http://localhost:3000` (only `/` route is user-visible)
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
- ❌ No direct mini-service fetches — use `io('/?XTransformPort=3005')` through the Caddy gateway

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
      analysis/route.ts     — GET /api/analysis?symbol=BTCUSDT (60s cache)
      correlation/route.ts  — GET /api/correlation?interval=4h&limit=500
      cross-history/route.ts — GET /api/cross-history?symbol=X&limit=50
      returns/route.ts      — GET /api/returns?symbolA=X&symbolB=Y
    page.tsx                — Dashboard (client component, "use client")
    layout.tsx              — Root layout + LanguageProvider + Toaster
    globals.css             — Theme variables + animations
  lib/
    i18n.ts                 — Translation dictionaries (4 languages, ~160 keys)
    indicators.ts           — Technical indicator calculations (pure functions)
    indicators.test.ts      — Vitest tests for indicators (110 tests)
    structure.ts             — Market structure text builder (pure function)
    structure.test.ts        — Tests for structure
    strategies.ts           — 4 predefined trading strategies
    types.ts                — Shared types (AnalysisResponse, PriceAlert, etc.)
    binance.ts              — Binance API client (fetchKlines, fetchTicker24h)
    cache.ts                — In-memory TTL cache (Map-based)
    cross-history.ts        — SQLite persistence for cross events (Prisma)
    export-snapshot.ts      — JSON export helper
    db.ts                   — Prisma client singleton
  hooks/
    use-language.tsx        — LanguageProvider context + useLanguage hook
    use-tick-stream.ts      — Socket.io singleton for live price ticks
    use-order-book.ts       — Socket.io for L2 order book depth
    use-cross-alerts.tsx    — Toast notifications for cross events (sessionStorage dedup)
    use-price-alerts.tsx    — User price alerts (localStorage + Web Audio sound)
    use-strategy-alerts.tsx — Toast on strategy action transitions
    use-keyboard-shortcuts.ts — R/C/E/? keyboard shortcuts
  components/panel/
    asset-card.tsx          — Main card per crypto pair
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
    stop-loss-selector.tsx — ATR-based stop loss with multiplier dropdown
    strategy-selector.tsx  — Strategy dropdown + signal breakdown
    strategy-consensus.tsx  — 4-strategy consensus panel
    cross-history.tsx       — Cross event timeline with filters
    price-alerts-button.tsx — Price alerts modal + sound toggle
    keyboard-help-modal.tsx — Shortcuts help modal
    language-selector.tsx   — Language dropdown (ES/EN/ZH/FR)
    scatter-plot-modal.tsx  — Returns scatter plot + regression
    correlation-matrix.tsx  — Pearson correlation heatmap
    collapsible-section.tsx — Collapsible wrapper (localStorage persistence)
mini-services/
  tick-stream/              — Socket.io server (port 3005) → Binance/Bybit trade stream
  order-book/               — Socket.io server (port 3004) → Binance depth20 stream
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
- 110 tests currently passing — never reduce test count
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
- Frontend connects via `io("/?XTransformPort=PORT", { path: "/socket.io/" })`
- Health endpoint at `/health` returns JSON with `binanceConnected` status
- Background processes started with double-fork pattern:
  ```bash
  ( setsid nohup bun index.ts > service.log 2>&1 < /dev/null & ) &
  ```

### 7. API Routes

- All API routes use `NextRequest` + `NextResponse`
- 60-second server-side cache for `/api/analysis` (Map-based, `lib/cache.ts`)
- 120-second cache for `/api/correlation`
- Errors return `{ "error": "message" }` with HTTP 502 — NEVER fabricated data
- `no_disponible` object flags which fields are unavailable
- Binance API calls use 5-second timeout with `AbortController`
- Fire-and-forget persistence (DB writes don't block the response)

### 8. Testing Checklist

Before committing:
```bash
bun run lint   # Must be clean (0 errors, 0 warnings)
bun run test   # Must be 110+ passing
```

Test coverage requirements:
- `indicators.ts`: every exported function must have tests
- `structure.ts`: `buildStructureText` must have tests
- Edge cases: empty arrays, null values, zero ranges, mismatched lengths
- New indicators: minimum 5 tests per function

### 9. Git Conventions

- Commit message format: `Panel Cuantitativo // Intradía - <description>`
- One commit per feature/fix round
- Never commit: `node_modules/`, `dev.log`, `*.png` (screenshots), `db/custom.db`, `.next/`

### 10. Performance

- Canvas charts: redraw only when data changes (useEffect deps)
- Socket.io: singleton pattern (one connection per service, shared across components)
- Price tick throttle: 800ms per symbol (tick-stream service)
- Order book: 1000ms update cadence (Binance depth20@1000ms)
- Sparkline: max 120 points (sliced from 500 klines)
- Cache: 60s for analysis, 120s for correlation

## Current State (v23)

- **11 technical indicators**: EMA55, EMA200, RSI(14), MACD(12,26,9), S/R pivots, ATR(14), Bollinger Bands(20,2), Fibonacci retracement+extensions, VWAP(20), Stochastic(14,3), Ichimoku(9,26,52)
- **5 crypto pairs**: BTC, ETH, XRP, SOL, BNB
- **4 trading strategies**: Trend Buy, Mean Reversion Buy, Trend Short, Hold
- **7 alert types**: EMA cross, MACD cross, momentum flip, Bollinger squeeze, squeeze breakout, Stochastic cross, strategy transitions
- **4 languages**: Español, English, 中文, Français
- **110 Vitest tests**
- **2 mini-services**: tick-stream (port 3005), order-book (port 3004)

## Commands

```bash
bun run dev          # Start Next.js dev server (port 3000)
bun run lint         # ESLint check
bun run test         # Vitest run (110 tests)
bun run test:watch   # Vitest watch mode
bun run db:push      # Push Prisma schema to SQLite
bun run db:generate  # Generate Prisma client

# Mini-services (separate terminals)
cd mini-services/tick-stream && bun run dev  # Port 3005
cd mini-services/order-book && bun run dev   # Port 3004
```
