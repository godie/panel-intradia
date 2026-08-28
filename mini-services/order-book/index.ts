/**
 * order-book — L2 order book depth mini-service.
 *
 * Connects to Binance's partial book depth WebSocket (top 20 levels, 1000ms
 * updates) for BTC/ETH/XRP and rebroadcasts snapshots to all browser clients
 * via socket.io. This enriches the dashboard's RangeBar with bid/ask volume
 * context — the single feature that most distinguishes a quantitative panel
 * from a simple price tracker.
 *
 * Architecture:
 *  - Binance WS (wss://stream.binance.com:9443/stream?streams=...@depth20@1000ms)
 *    → emits JSON {stream, data:{lastUpdateId, bids:[[price,qty]...], asks:[...]}}
 *  - We parse + transform into a compact shape {symbol, bids, asks, time} and
 *    emit "depth" events. Throttled to 1 emit / 1000ms per symbol (matches
 *    the upstream cadence).
 *  - socket.io server on port 3004, path "/socket.io/" (default — required
 *    so the custom /health endpoint on the same httpServer is reachable;
 *    a path of "/" would have socket.io intercept every request).
 *
 * Resilience: exponential backoff reconnect (1s→30s), ws-status events on
 * connect/disconnect so the UI can show "LIVE"/"RECONNECTING".
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";
import { WebSocket } from "ws";

const PORT = 3004;
const SYMBOLS = ["btcusdt", "ethusdt", "xrpusdt"] as const;
// depth20 = top 20 levels; @1000ms = 1 update per second.
const BINANCE_WS_URL =
  "wss://stream.binance.com:9443/stream?streams=" +
  SYMBOLS.map((s) => `${s}@depth20@1000ms`).join("/");

type Level = { price: number; qty: number };
type DepthSnapshot = {
  symbol: string; // uppercase "BTCUSDT"
  bids: Level[]; // sorted descending price (best bid first)
  asks: Level[]; // sorted ascending price (best ask first)
  time: number;
};

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "order-book",
        port: PORT,
        binanceConnected: binanceWsReady,
        clients: io.engine.clientsCount,
        uptime: process.uptime(),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

let binanceWsReady = false;
let binanceWs: WebSocket | null = null;
let reconnectAttempts = 0;
let depthMessageCount = 0;

function connectBinance() {
  console.log(`[binance] connecting to ${BINANCE_WS_URL}`);
  const ws = new WebSocket(BINANCE_WS_URL);
  binanceWs = ws;

  ws.on("open", () => {
    binanceWsReady = true;
    reconnectAttempts = 0;
    console.log("[binance] connected, streaming L2 depth");
    io.emit("ws-status", { connected: true });
  });

  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      const data = msg?.data ?? msg;
      // Binance partial book depth (combined stream) payload looks like:
      //   { stream: "btcusdt@depth20@1000ms", data: { lastUpdateId, bids, asks } }
      // Note: the `data` object has NO `s` field (unlike trade streams) —
      // the symbol is encoded in the `stream` field. We parse it from there.
      // For non-combined streams the symbol is also derivable from msg.s.
      const symbolFromStream =
        typeof msg?.stream === "string"
          ? msg.stream.split("@")[0].toUpperCase()
          : "";
      const symbol =
        String(data?.s ?? "").toUpperCase() || symbolFromStream;
      const rawBids = data?.bids ?? data?.b ?? [];
      const rawAsks = data?.asks ?? data?.a ?? [];
      if (!symbol || !Array.isArray(rawBids) || !Array.isArray(rawAsks)) return;

      // Transform [priceStr, qtyStr] → {price, qty}.
      const toLevels = (arr: unknown[]): Level[] =>
        arr
          .map((entry) => {
            if (!Array.isArray(entry) || entry.length < 2) return null;
            const price = Number(entry[0]);
            const qty = Number(entry[1]);
            if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
            return { price, qty } as Level;
          })
          .filter((v): v is Level => v != null);

      const snapshot: DepthSnapshot = {
        symbol,
        bids: toLevels(rawBids),
        asks: toLevels(rawAsks),
        time: Date.now(),
      };
      if (depthMessageCount === 0) {
        console.log(
          `[binance] first depth snapshot for ${symbol}: ${snapshot.bids.length} bids / ${snapshot.asks.length} asks`,
        );
      }
      depthMessageCount++;
      io.emit("depth", snapshot);
    } catch (err) {
      console.error("[binance] parse error:", err);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("[binance] ws error:", err.message);
  });

  ws.on("close", () => {
    binanceWsReady = false;
    io.emit("ws-status", { connected: false, reconnecting: true });
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.log(`[binance] disconnected, reconnecting in ${delay}ms`);
    setTimeout(connectBinance, delay);
  });
}

// Heartbeat so the UI knows the stream is alive.
setInterval(() => {
  if (binanceWsReady) {
    io.emit("heartbeat", { time: Date.now() });
  }
}, 5000);

io.on("connection", (socket) => {
  console.log(`[client] connected (${socket.id}), total=${io.engine.clientsCount}`);
  socket.emit("ws-status", { connected: binanceWsReady });
  socket.on("disconnect", (reason) => {
    console.log(`[client] disconnected (${socket.id}): ${reason}`);
  });
  socket.on("error", (err: Error) => {
    console.error(`[client] socket error (${socket.id}):`, err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[order-book] socket.io server listening on port ${PORT}`);
  connectBinance();
});

function shutdown(signal: string) {
  console.log(`[order-book] received ${signal}, shutting down...`);
  if (binanceWs) binanceWs.close();
  io.close(() => {
    httpServer.close(() => {
      console.log("[order-book] closed");
      process.exit(0);
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
