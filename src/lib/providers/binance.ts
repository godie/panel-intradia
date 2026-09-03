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
