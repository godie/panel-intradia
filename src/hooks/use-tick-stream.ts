"use client";

import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * use-tick-stream — subscribe to real-time price ticks from the tick-stream
 * mini-service (socket.io on port 3005, behind the Caddy gateway).
 *
 * Connection string MUST go through the gateway — the path is "/socket.io/"
 * (the default socket.io path; the previous "/" collided with the /health
 * endpoint of the mini-service) and the port is encoded as a
 * `XTransformPort` query param so Caddy can route it.
 * NEVER connect to `http://localhost:3005` directly (sandbox rule).
 *
 * The URL is auto-detected at runtime via `buildSocketUrl()`:
 *  - If the page is already served from the gateway (port 81), use a
 *    relative URL (`/?XTransformPort=3003`) so the same origin is reused.
 *  - Otherwise (e.g. Next.js dev port 3000), explicitly point the socket
 *    at the gateway (`http://hostname:81/?XTransformPort=3003`).
 *
 * The socket.io client `path` option is set to "/socket.io/" so the
 * resulting request URLs become
 *   `http://hostname:81/socket.io/?...&XTransformPort=3003` which Caddy
 * forwards to localhost:3003 and the mini-service handles at its socket.io
 * endpoint.
 *
 * Events from the server:
 *  - `tick`         { symbol, price, time }    — one price update per symbol
 *  - `ws-status`    { connected, reconnecting? }— Binance upstream state
 *  - `heartbeat`    { time }                   — every 5s while binance is live
 *
 * The hook uses `useSyncExternalStore` so React 19 can safely subscribe
 * to the module-level singleton store without triggering the
 * "set-state-in-effect" lint rule. The socket lifecycle is owned by the
 * module (singleton), the React layer just observes a snapshot.
 *
 * Returns:
 *  - `prices`        Record<symbol, { price, time }>
 *  - `connected`     boolean — the socket.io client is connected
 *  - `binanceLive`   boolean — the upstream Binance WS is live
 *  - `lastHeartbeat` number|null — epoch ms of last heartbeat
 *  - `tickCount`     number — total ticks received this session
 */
export type TickPrice = { price: number; time: number };

export type TickState = {
  prices: Record<string, TickPrice>;
  connected: boolean;
  binanceLive: boolean;
  source: "binance" | "bybit" | null;
  lastHeartbeat: number | null;
  tickCount: number;
};

// -----------------------------------------------------------------------------
// Module-level singleton store.
// -----------------------------------------------------------------------------
// One socket.io connection per browser tab. Multiple components calling
// `useTickStream()` share the same store; each registers as a listener.
let socket: Socket | null = null;

const initialState: TickState = {
  prices: {},
  connected: false,
  binanceLive: false,
  source: null,
  lastHeartbeat: null,
  tickCount: 0,
};

// The store is a tiny pub/sub: state + Set of listeners.
let state: TickState = initialState;
const listeners = new Set<() => void>();

function setState(next: TickState): void {
  // Shallow equality check — skip if nothing changed structurally.
  if (
    next === state ||
    (next.connected === state.connected &&
      next.binanceLive === state.binanceLive &&
      next.source === state.source &&
      next.lastHeartbeat === state.lastHeartbeat &&
      next.tickCount === state.tickCount &&
      next.prices === state.prices)
  ) {
    return;
  }
  state = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Lazy-init the socket on first subscriber.
  ensureSocket();
  return () => {
    listeners.delete(cb);
    // We intentionally do NOT close the socket on unsubscribe — the
    // singleton lives for the tab's lifetime and is shared across cards.
  };
}

function getSnapshot(): TickState {
  return state;
}

// Gateway port — Caddy reverse proxy that routes `?XTransformPort=NNNN`
// to the matching localhost port. In dev, the page can be served either
// from the gateway (port 81) or directly from Next.js (port 3000). The
// socket.io client MUST talk to the gateway so Caddy can forward the
// WebSocket upgrade to the tick-stream mini-service on port 3005.
const GATEWAY_PORT = "81";
const TICK_STREAM_PORT = "3005";

function buildSocketUrl(): string {
  if (typeof window === "undefined") {
    // SSR safety — return a relative URL; the singleton only inits on client.
    return `/?XTransformPort=${TICK_STREAM_PORT}`;
  }
  const loc = window.location;
  // Already on the gateway → relative URL keeps same origin (cookies, etc).
  if (loc.port === GATEWAY_PORT) {
    return `/?XTransformPort=${TICK_STREAM_PORT}`;
  }
  // Direct Next.js access (e.g. dev port 3000) → point at the gateway
  // explicitly so socket.io can reach the tick-stream mini-service.
  return `${loc.protocol}//${loc.hostname}:${GATEWAY_PORT}/?XTransformPort=${TICK_STREAM_PORT}`;
}

function ensureSocket(): Socket {
  if (socket) return socket;
  const sock = io(buildSocketUrl(), {
    path: "/socket.io/",
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 10000,
  });
  socket = sock;

  sock.on("connect", () => {
    setState({ ...state, connected: true });
  });
  sock.on("disconnect", () => {
    setState({
      ...state,
      connected: false,
      binanceLive: false,
      source: null,
    });
  });
  sock.on("connect_error", () => {
    setState({ ...state, connected: false });
  });

  sock.on("tick", (tick: { symbol: string; price: number; time: number }) => {
    if (!tick || typeof tick.symbol !== "string") return;
    setState({
      ...state,
      prices: {
        ...state.prices,
        [tick.symbol]: { price: tick.price, time: tick.time },
      },
      tickCount: state.tickCount + 1,
    });
  });

  sock.on("ws-status", (payload: { connected?: boolean; reconnecting?: boolean; source?: "binance" | "bybit" }) => {
    setState({
      ...state,
      binanceLive: payload?.connected === true,
      source: payload?.source ?? (payload?.connected === true ? "binance" : null),
    });
  });

  sock.on("heartbeat", (payload: { time?: number }) => {
    setState({
      ...state,
      lastHeartbeat: typeof payload?.time === "number" ? payload.time : Date.now(),
    });
  });

  return sock;
}

/**
 * clearTickPrice — clear the cached live price for a symbol. Used by the
 * page when a fresh REST snapshot arrives: the REST value takes over until
 * the next tick arrives, which then re-flashes the price.
 *
 * Two forms:
 *  - `clearTickPrice(setter, symbol)` operates on a local React state
 *    (kept for API compatibility, in case a caller keeps its own copy).
 *  - `clearTickPriceGlobal(symbol)` operates on the module singleton.
 */
export function clearTickPrice(
  setter: (next: (prev: Record<string, TickPrice>) => Record<string, TickPrice>) => void,
  symbol: string,
): void {
  setter((prev) => {
    if (!prev[symbol]) return prev;
    const next = { ...prev };
    delete next[symbol];
    return next;
  });
}

export function clearTickPriceGlobal(symbol: string): void {
  if (!state.prices[symbol]) return;
  const nextPrices = { ...state.prices };
  delete nextPrices[symbol];
  setState({ ...state, prices: nextPrices });
}

export function useTickStream(): TickState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
