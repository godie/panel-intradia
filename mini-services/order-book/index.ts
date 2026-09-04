/**
 * order-book — L2 order book depth mini-service with Binance → Bybit fallback.
 *
 * Connects to Binance's partial book depth WebSocket (top 20 levels, 1000ms
 * updates). If Binance WS drops 3 times in a row within 30s, switches to
 * Bybit's order book WebSocket. Both upstreams produce normalized
 * {symbol, bids, asks, time} events to all connected browser clients.
 *
 * socket.io on port 3004, path "/socket.io/".
 *
 * Events:
 *  - `depth`      { symbol, bids: Level[], asks: Level[], time }
 *  - `ws-status`  { connected: boolean, source: "binance"|"bybit"|null }
 *  - `heartbeat`  { time }
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";
import { WebSocket } from "ws";

const PORT = 3004;
const SYMBOLS = ["btcusdt", "ethusdt", "xrpusdt", "solusdt", "bnbusdt"] as const;
type Source = "binance" | "bybit";
const FAILURE_THRESHOLD = 3;

const BINANCE_WS_URL =
  "wss://stream.binance.com:9443/stream?streams=" +
  SYMBOLS.map((s) => `${s}@depth20@1000ms`).join("/");
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:81",
  "http://localhost:3000",
  "http://127.0.0.1:81",
  "http://127.0.0.1:3000",
];
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = CORS_ORIGINS.length > 0 ? CORS_ORIGINS : DEFAULT_CORS_ORIGINS;

// Bybit v5 order book WS: wss://stream.bybit.com/v5/public/spot
// Subscribe args: "orderbook.20.{SYMBOL}" (e.g. "orderbook.20.BTCUSDT")
const BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/spot";
const BYBIT_DEPTH = 20;

type Level = { price: number; qty: number };
type DepthSnapshot = {
  symbol: string;
  bids: Level[];
  asks: Level[];
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
        activeSource,
        binanceConnected: binanceReady,
        bybitConnected: bybitReady,
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
  cors: {
    origin: allowedOrigins,
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
let bybitFailures = 0;
let depthMessageCount = 0;

function setActive(source: Source | null): void {
  if (source === activeSource) return;
  activeSource = source;
  io.emit("ws-status", { connected: source !== null, source });
}

function toLevels(arr: unknown[]): Level[] {
  return arr
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const price = Number(entry[0]);
      const qty = Number(entry[1]);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
      return { price, qty } as Level;
    })
    .filter((v): v is Level => v != null);
}

// ============================================================
// BINANCE
// ============================================================
function connectBinance(): void {
  console.log(`[binance] connecting to depth stream`);
  const ws = new WebSocket(BINANCE_WS_URL);
  binanceWs = ws;

  ws.on("open", () => {
    binanceReady = true;
    binanceFailures = 0;
    console.log("[binance] connected, streaming L2 depth");
    setActive("binance");
  });

  ws.on("message", (raw: Buffer | string) => {
    if (activeSource !== "binance") return;
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      const data = msg?.data ?? msg;
      const symbolFromStream =
        typeof msg?.stream === "string"
          ? msg.stream.split("@")[0].toUpperCase()
          : "";
      const symbol = String(data?.s ?? "").toUpperCase() || symbolFromStream;
      const rawBids = data?.bids ?? data?.b ?? [];
      const rawAsks = data?.asks ?? data?.a ?? [];
      if (!symbol || !Array.isArray(rawBids) || !Array.isArray(rawAsks)) return;

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
    binanceReady = false;
    binanceWs = null;
    if (activeSource === "bybit") return;
    binanceFailures++;
    if (binanceFailures >= FAILURE_THRESHOLD) {
      console.log(`[binance] ${binanceFailures} consecutive failures, activating bybit`);
      setActive("bybit");
      connectBybit();
    } else {
      const delay = Math.min(1000 * Math.pow(2, binanceFailures), 30000);
      console.log(`[binance] disconnected, reconnecting in ${delay}ms`);
      setTimeout(connectBinance, delay);
    }
  });
}

// ============================================================
// BYBIT
// ============================================================
function connectBybit(): void {
  if (bybitWs) return;
  console.log(`[bybit] connecting to depth stream`);
  const ws = new WebSocket(BYBIT_WS_URL);
  bybitWs = ws;

  ws.on("open", () => {
    bybitReady = true;
    bybitFailures = 0;
    const args = SYMBOLS.map((s) => `orderbook.${BYBIT_DEPTH}.${s.toUpperCase()}`);
    ws.send(JSON.stringify({ op: "subscribe", args }));
    setActive("bybit");
    console.log("[bybit] connected, subscribed to orderbook");
  });

  ws.on("message", (raw: Buffer | string) => {
    if (activeSource !== "bybit") return;
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      // Bybit v5 order book: topic "orderbook.20.BTCUSDT", data: {b: [...], a: [...]}
      if (!msg?.topic?.startsWith("orderbook.")) return;
      const symbol = msg.topic.split(".").pop()?.toUpperCase();
      if (!symbol) return;
      const rawBids = msg?.data?.b ?? [];
      const rawAsks = msg?.data?.a ?? [];
      if (!Array.isArray(rawBids) || !Array.isArray(rawAsks)) return;

      // Bybit levels are [price, qty] like Binance.
      const snapshot: DepthSnapshot = {
        symbol,
        bids: toLevels(rawBids),
        asks: toLevels(rawAsks),
        time: Date.now(),
      };
      depthMessageCount++;
      io.emit("depth", snapshot);
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
    if (activeSource === "bybit") {
      activeSource = null;
      io.emit("ws-status", { connected: false, source: null });
    }
    bybitFailures++;
    const delay = Math.min(1000 * Math.pow(2, bybitFailures), 15000);
    console.log(`[bybit] disconnected, reconnecting in ${delay}ms`);
    setTimeout(connectBybit, delay);
  });
}

// Heartbeat
setInterval(() => {
  if (activeSource) {
    io.emit("heartbeat", { time: Date.now() });
  }
}, 5000);

io.on("connection", (socket) => {
  console.log(`[client] connected (${socket.id}), total=${io.engine.clientsCount}`);
  socket.emit("ws-status", { connected: activeSource !== null, source: activeSource });
  socket.on("disconnect", () => {});
});

httpServer.listen(PORT, () => {
  console.log(`[order-book] socket.io server listening on port ${PORT}`);
  connectBinance();
});

function shutdown(signal: string) {
  console.log(`[order-book] received ${signal}, shutting down...`);
  binanceWs?.close();
  bybitWs?.close();
  io.close(() => {
    httpServer.close(() => {
      console.log("[order-book] closed");
      process.exit(0);
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
