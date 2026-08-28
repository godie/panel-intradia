/**
 * ws-tick — real-time price tick mini-service.
 *
 * Connects to Binance's combined WebSocket trade stream for BTC/ETH/XRP
 * and rebroadcasts each price update to all connected browser clients via
 * socket.io. This lets the dashboard flash the spot price in real time
 * without polling the REST API every second.
 *
 * Architecture:
 *  - Binance WS (wss://stream.binance.com:9443/stream?streams=...@trade)
 *    → emits JSON {stream, data:{s,p,T}} where s=symbol, p=price, T=trade time
 *  - We parse + throttle (max 1 emit / 800ms per symbol) to avoid flooding
 *    the browser with hundreds of BTC trades per second.
 *  - socket.io server on port 3003, path "/socket.io/" (default — required
 *    so the custom /health endpoint on the same httpServer is reachable;
 *    a path of "/" would have socket.io intercept every request).
 *
 * Resilience:
 *  - Binance WS auto-reconnects with backoff (exponential 1s→30s).
 *  - On reconnect we re-subscribe and emit a "ws-status" event so the UI
 *    can show "RECONNECTING / LIVE" state.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";
import { WebSocket } from "ws";

const PORT = 3003;
const SYMBOLS = ["btcusdt", "ethusdt", "xrpusdt"] as const;
const BINANCE_WS_URL =
  "wss://stream.binance.com:9443/stream?streams=" +
  SYMBOLS.map((s) => `${s}@trade`).join("/");

/** Throttle: minimum ms between emits per symbol. */
const THROTTLE_MS = 800;
const lastEmit = new Map<string, number>();

type Tick = {
  symbol: string; // uppercase, e.g. "BTCUSDT"
  price: number;
  time: number; // epoch ms
};

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // Simple health endpoint.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "ws-tick",
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

function connectBinance() {
  console.log(`[binance] connecting to ${BINANCE_WS_URL}`);
  const ws = new WebSocket(BINANCE_WS_URL);
  binanceWs = ws;

  ws.on("open", () => {
    binanceWsReady = true;
    reconnectAttempts = 0;
    console.log("[binance] connected, streaming trades");
    io.emit("ws-status", { connected: true });
  });

  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      // Combined stream format: { stream: "btcusdt@trade", data: {...} }
      const data = msg?.data ?? msg;
      const symbol = String(data?.s ?? "").toUpperCase();
      const priceStr = data?.p;
      const time = Number(data?.T ?? Date.now());
      if (!symbol || priceStr == null) return;
      const price = Number(priceStr);
      if (!Number.isFinite(price)) return;

      // Throttle per symbol.
      const now = Date.now();
      const last = lastEmit.get(symbol) ?? 0;
      if (now - last < THROTTLE_MS) return;
      lastEmit.set(symbol, now);

      const tick: Tick = { symbol, price, time };
      io.emit("tick", tick);
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
    // Exponential backoff capped at 30s.
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.log(`[binance] disconnected, reconnecting in ${delay}ms`);
    setTimeout(connectBinance, delay);
  });
}

// Periodically emit a heartbeat so the UI knows the stream is alive even
// if a symbol has no trades (rare but possible for XRP in quiet hours).
let lastHeartbeat = Date.now();
setInterval(() => {
  lastHeartbeat = Date.now();
  if (binanceWsReady) {
    io.emit("heartbeat", { time: lastHeartbeat });
  }
}, 5000);

io.on("connection", (socket) => {
  console.log(`[client] connected (${socket.id}), total=${io.engine.clientsCount}`);
  // Send current connection state immediately.
  socket.emit("ws-status", { connected: binanceWsReady });

  socket.on("disconnect", (reason) => {
    console.log(`[client] disconnected (${socket.id}): ${reason}`);
  });

  socket.on("error", (err: Error) => {
    console.error(`[client] socket error (${socket.id}):`, err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[ws-tick] socket.io server listening on port ${PORT}`);
  connectBinance();
});

// Graceful shutdown.
function shutdown(signal: string) {
  console.log(`[ws-tick] received ${signal}, shutting down...`);
  if (binanceWs) binanceWs.close();
  io.close(() => {
    httpServer.close(() => {
      console.log("[ws-tick] closed");
      process.exit(0);
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
