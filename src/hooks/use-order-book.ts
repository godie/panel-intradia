"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type OrderLevel = { price: number; qty: number };

export type DepthSnapshot = {
  symbol: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  time: number;
};

export type OrderBookState = {
  /** Latest depth snapshot per symbol (keyed by uppercase symbol). */
  snapshots: Record<string, DepthSnapshot>;
  connected: boolean;
  binanceLive: boolean;
  /** Active data source: "binance" | "bybit" | null */
  source: "binance" | "bybit" | null;
  lastUpdate: number | null;
};

/**
 * useOrderBook — subscribes to the order-book mini-service (socket.io on
 * port 3004) and exposes the latest L2 depth snapshot per symbol.
 *
 * Connection: auto-detects gateway vs direct-dev-server (same pattern as
 * useTickStream). Routes through Caddy (port 81) when on dev port 3000,
 * uses relative URL when already behind the gateway.
 *
 * The socket.io client `path` is set to "/socket.io/" to match the server
 * side — the previous "/" collided with the mini-service's /health
 * endpoint and was intercepted by engine.io with a 400 "Transport unknown".
 *
 * Only the top-of-book (best bid + best ask) is consumed by the RangeBar
 * right now, but the full 20 levels are available for future use (depth
 * chart, bid/ask imbalance, etc.).
 */
function buildSocketUrl(): string {
  if (typeof window === "undefined") return "/";
  const { hostname, port } = window.location;
  // Gateway is on port 81. If we're already there, use a relative URL.
  if (port === "81") return "/?XTransformPort=3004";
  // Otherwise (dev server on 3000, or any other port), go through Caddy
  // on port 81 which forwards the WS upgrade to port 3004.
  return `http://${hostname}:81/?XTransformPort=3004`;
}

export function useOrderBook(enabled: boolean = true): OrderBookState {
  const [state, setState] = useState<OrderBookState>({
    snapshots: {},
    connected: false,
    binanceLive: false,
    source: null,
    lastUpdate: null,
  });

  useEffect(() => {
    if (!enabled) return;

    const socket = io(buildSocketUrl(), {
      path: "/socket.io/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });

    socket.on("connect", () => {
      setState((s) => ({ ...s, connected: true }));
    });

    socket.on("disconnect", () => {
      setState((s) => ({ ...s, connected: false, binanceLive: false }));
    });

    socket.on("connect_error", () => {
      setState((s) => ({ ...s, connected: false, binanceLive: false }));
    });

    socket.on("ws-status", (d: { connected?: boolean; source?: "binance" | "bybit" }) => {
      setState((s) => ({
        ...s,
        binanceLive: d?.connected === true,
        source: d?.source ?? (d?.connected === true ? "binance" : null),
        connected: true,
      }));
    });

    socket.on("depth", (snap: DepthSnapshot) => {
      if (!snap?.symbol || !Array.isArray(snap.bids) || !Array.isArray(snap.asks))
        return;
      setState((s) => ({
        ...s,
        snapshots: { ...s.snapshots, [snap.symbol]: snap },
        lastUpdate: snap.time,
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [enabled]);

  return state;
}

/**
 * Compute the bid/ask spread and mid price from a depth snapshot.
 * Returns nulls if the snapshot is missing or empty.
 */
export function computeTopOfBook(snap: DepthSnapshot | undefined): {
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPct: number | null;
  bidVolume: number;
  askVolume: number;
  imbalance: number | null;
} {
  const empty = {
    bestBid: null,
    bestAsk: null,
    midPrice: null,
    spread: null,
    spreadPct: null,
    bidVolume: 0,
    askVolume: 0,
    imbalance: null,
  };
  if (!snap || snap.bids.length === 0 || snap.asks.length === 0) return empty;

  const bestBid = snap.bids[0].price;
  const bestAsk = snap.asks[0].price;
  const midPrice = (bestBid + bestAsk) / 2;
  const spread = bestAsk - bestBid;
  const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : null;

  // Top-20 volume aggregation for imbalance.
  const bidVolume = snap.bids.reduce((sum, l) => sum + l.qty, 0);
  const askVolume = snap.asks.reduce((sum, l) => sum + l.qty, 0);
  const total = bidVolume + askVolume;
  const imbalance = total > 0 ? (bidVolume - askVolume) / total : null;

  return {
    bestBid,
    bestAsk,
    midPrice,
    spread,
    spreadPct,
    bidVolume,
    askVolume,
    imbalance,
  };
}
