# Work Record — Task `round-3`

**Agent:** cron webDevReview (webDevReview)
**Task ID:** round-3
**Project:** Panel Cuantitativo // Intradía (Next.js 16 + TypeScript + Tailwind 4)
**Repository:** https://github.com/godie/panel-intradia.git
**Path:** `/home/z/my-project`

## Summary

Added 2 major features (WebSocket real-time ticks + MACD indicator) and
styling improvements (scanline/grid overlay) to a stable v2 trading
dashboard. All work is verified end-to-end with agent-browser + VLM
(9/10 desktop + mobile, no console errors, lint clean, footer sticky).

## What Was Done

### 1. Mini-service `ws-tick` (puerto 3003)

Started the existing mini-service at
`/home/z/my-project/mini-services/ws-tick/index.ts` using
`setsid nohup bun index.ts > service.log 2>&1 &` so it survives the
shell session ending.

Verified with `ps aux | grep bun` and `service.log` shows:
```
[ws-tick] socket.io server listening on port 3003
[binance] connecting to wss://stream.binance.com:9443/stream?streams=...
[binance] connected, streaming trades
```

The service connects to Binance's combined WebSocket trade stream
(btcusdt/ethusdt/xrpusdt @trade), throttles emits to 1/800ms per symbol,
and broadcasts `tick`, `ws-status`, `heartbeat` events via socket.io
on port 3003 (path `/`).

### 2. Hook `useTickStream` (`src/hooks/use-tick-stream.ts`)

New file. Pattern: `useSyncExternalStore` (React 19 native) backed by a
module-level singleton store. ONE socket per browser tab, shared across
all components calling `useTickStream()`. The store keeps
`{prices, connected, binanceLive, lastHeartbeat, tickCount}` and notifies
all listeners on every state change.

`useSyncExternalStore` was chosen specifically because the first
implementation (using `useEffect + setLocal(state)`) triggered the
`react-hooks/set-state-in-effect` lint rule. The external-store pattern
side-steps that cleanly.

Exports:
- `useTickStream()` — returns `TickState`.
- `clearTickPriceGlobal(symbol)` — used by `page.tsx` to clear the live
  price cache after a REST refresh so the fresh REST spot_price takes
  over until the next tick.
- `clearTickPrice(setter, symbol)` — kept for API compatibility if a
  caller wants to maintain its own state.

### 3. Backend MACD (`src/lib/indicators.ts`)

Added `calculateMACD(closes, fast=12, slow=26, signal=9)` returning
`MACDResult`:
```
{ macdLine, signalLine, histogram, lastMacd, lastSignal, lastHistogram, available }
```

MACD line = EMA(fast) - EMA(slow). Signal line = EMA(signal) over the
contiguous non-null MACD slice (seeded with SMA via the existing
`calculateEMA` helper). Histogram = MACD - Signal wherever both defined.

Edge cases: returns `available: false` when `n < slow + signal`,
`fast >= slow`, or `period <= 0`. All series align to `closes` length
with `null` until the indicator is defined.

### 4. Types + API route

`src/lib/types.ts`: added `AnalysisResponse.macd { line, signal, histogram }`,
`AnalysisResponse.series.macd_histogram`, `AnalysisResponse.no_disponible.macd`.

`src/app/api/analysis/route.ts`: imported `calculateMACD`, computes it
in `buildAnalysis`, includes `macd` + `series.macd_histogram` in payload.

Verified with `curl /api/analysis?symbol=BTCUSDT`:
```
macd: {'line': 286.45, 'signal': 652.99, 'histogram': -366.54}
series.macd_histogram len: 120
no_disponible.macd: False
```

### 5. `MacdPanel` component (`src/components/panel/macd-panel.tsx`)

New file. Compact histogram of last ~40 MACD histogram values as
vertical bars growing from a centered baseline:
- positive bars (green #5fbf8f) grow upward
- negative bars (red #e2604f) grow downward
- bar heights normalized against max(|hist|) in viewport

Below the chart: 3-column grid with current MACD / Signal / Histogram
values, colored by histogram sign. Plus trend label
("Alcista ↑" / "Bajista ↓" / "Creciente ↓" / "Recuperando ↑") and
cross state ("MACD > Signal" / "MACD < Signal").

Inserted in `AssetCard` between the Sparkline and RangeBar (per spec).

### 6. `AssetCard` integration (`src/components/panel/asset-card.tsx`)

New props: `livePrice?`, `tickActive?`, `lastTickAt?`, `nowMs?`.

- `displayPrice = livePrice ?? data.spot_price` (with `Number.isFinite` guard).
- "TICK" badge (Radio icon + `animate-pulse`) next to "Precio spot · USD"
  label when `tickActive && livePrice` is valid. Tooltip shows
  `tick hace Ns`.
- "tick hace Ns" text below the price (formatElapsed helper:
  `<60s` → "Ns", else "Nm").
- `PriceFlash` now accepts a `live` prop and colors the flash green
  (#5fbf8f) when the tick is active.
- Sparkline and RangeBar now consume `displayPrice` (not `data.spot_price`)
  so the spot marker / range-bar dot moves in real time with ticks.

### 7. Page integration (`src/app/page.tsx`)

`useTickStream()` at the top level. Passes `livePrice`, `tickActive`,
`lastTickAt`, `nowMs` to each `AssetCard`.

Header connection indicator with 3 states (smooth `transition-colors
duration-300`):
- `live` — green pulsing dot + Radio icon + "TICK LIVE" (when socket
  connected AND binanceLive upstream)
- `connecting` — amber dot + Wifi icon + "CONECTANDO" (socket connected,
  binance not yet live)
- `offline` — red dot + WifiOff icon + "OFFLINE" (socket disconnected)

Tooltip shows `tickCount`, `lastHeartbeat` formatted as es-ES time.

On each successful REST refresh, `clearTickPriceGlobal(symbol)` is called
so the freshly-fetched REST spot_price takes over until the next tick
arrives.

New state `nowMs` (updated every 1s) is local to the page — this drives
the "tick hace Ns" elapsed time without re-rendering the singleton store
on every tick of the wall clock.

Methodology section updated to document MACD + tick stream.

### 8. Styling: scanline/grid overlay (`src/app/globals.css`)

- `.terminal-grid` — applied to the root wrapper. Background-image stack:
  48px grid lines (rgba 0.035) + the existing radial accents.
- `.terminal-scanlines` — fixed overlay div (`pointer-events-none`).
  Repeating-linear-gradient horizontal lines (rgba 0.025),
  `mix-blend-mode: overlay`, opacity 0.7.
- `@keyframes scan-sweep` — vertical glow sweep every 12s.
- `prefers-reduced-motion` disables both animations.

### 9. Verification

- `bun run lint` — clean (zero errors, zero warnings). One iteration to
  fix `react-hooks/set-state-in-effect` (resolved by refactor to
  `useSyncExternalStore`).
- `tail -30 dev.log` — only 200 responses, no runtime errors. Latency
  4-200ms (cache HIT ~5ms, MISS ~120ms).
- agent-browser (via port 81 = Caddy gateway; port 3000 direct breaks
  `io('/?XTransformPort=3003')` because Next.js doesn't proxy WebSocket
  upgrades):
  - 3 cards render with sparkline + MACD histogram + RSI gauge + RangeBar.
  - TICK badge visible on all 3 cards. "tick hace 0s/3s/4s" under prices.
  - Header shows "TICK LIVE".
  - No console errors.
  - Footer sticky confirmed on viewport 2400px (sticksToBottom=true).
- VLM desktop (1440x900): "9/10 — 3 cards with sparklines + MACD
  histogram panels (green/red bars), TICK LIVE badge with pulsing dot,
  TICK badges and 'tick hace Ns' timestamps, subtle CRT scanline + grid
  texture, no visual bugs."
- VLM mobile (390x844): "9/10 — single-column layout, all cards
  readable, charts/indicators visible without overflow, TICK LIVE
  indicator visible, market summary readable."

## Files Touched

- `/home/z/my-project/src/hooks/use-tick-stream.ts` (new)
- `/home/z/my-project/src/lib/indicators.ts` (+calculateMACD, +MACDResult type)
- `/home/z/my-project/src/lib/types.ts` (AnalysisResponse.macd, series.macd_histogram, no_disponible.macd)
- `/home/z/my-project/src/app/api/analysis/route.ts` (MACD integration)
- `/home/z/my-project/src/components/panel/macd-panel.tsx` (new)
- `/home/z/my-project/src/components/panel/asset-card.tsx` (livePrice/tickActive props, TICK badge, tick-hace-Ns, MACD panel integrated)
- `/home/z/my-project/src/app/page.tsx` (useTickStream + header conn indicator + clearTickPriceGlobal + terminal-grid wrapper)
- `/home/z/my-project/src/app/globals.css` (.terminal-grid + .terminal-scanlines + scan-sweep + reduced-motion)
- `/home/z/my-project/worklog.md` (round-3 entry appended)

## Mini-service Status

- ws-tick: **running** on port 3003 (PID verified via `ps aux`).
- Health: `/health` endpoint responds with status JSON.
- Binance upstream: connected, streaming trades (verified via service.log).
- Resilience: auto-reconnect with exponential backoff (1s→30s cap).
- Throttle: 800ms per symbol — prevents flooding the browser with
  hundreds of BTC trades/sec.

## Lint Status

```
$ bun run lint
$ eslint .
```
Zero errors, zero warnings. One iteration was needed:
- First implementation of `useTickStream` used `useEffect + setLocal(state)`
  which triggered `react-hooks/set-state-in-effect`.
- Refactored to `useSyncExternalStore` (the canonical pattern for
  external store subscriptions in React 19). Clean pass after that.

## Known Caveats

1. **ws-tick lifetime**: the process is detached with `setsid nohup`, but
   if the host reboots it won't auto-start. Production should use systemd
   or pm2.
2. **Direct port 3000 testing breaks the WebSocket**: agent-browser must
   open `http://localhost:81/` (Caddy gateway), not `:3000`. The Caddyfile
   routes `/?XTransformPort=3003` to port 3003, but Next.js doesn't.
3. **Tick re-renders**: every tick re-renders the entire Page (because
   `useTickStream` returns a new snapshot). For 3 cards × ~1.25
   ticks/symbol/s = ~4 re-renders/s — irrelevant. If more pairs are
   added, wrap AssetCard in React.memo with a custom comparator.

## Recommended Next Step (round 4)

See `/home/z/my-project/worklog.md` → "Recommended Next Step (round 4)":
**MACD crossover alerts** (análogo a `detectRecentCross` para EMA55/200)
+ **tooltips nativos** en RangeBar/RsiGauge/MacdPanel.
