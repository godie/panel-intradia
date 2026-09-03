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
  cors: { origin: "*", methods: ["GET", "POST"] },
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
    if (activeSource === "bybit") return;
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
    bybitFailures = 0;
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
    if (activeSource === "bybit") {
      activeSource = null;
      io.emit("ws-status", { connected: false, source: null });
    }
    bybitFailures++;
    const delay = Math.min(1000 * Math.pow(2, bybitFailures), 15000);
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
  io.close(() => {
    httpServer.close(() => {
      console.log("[tick-stream] closed");
      process.exit(0);
    });
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
