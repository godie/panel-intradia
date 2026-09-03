import {
  UpstreamError,
  type Kline,
  type MarketDataProvider,
  type TickEvent,
  type Ticker24h,
  type Unsubscribe,
} from "./types";
import { toBybitSymbol } from "./symbols";

const BYBIT_BASE = "https://api.bybit.com/v5/market";
const FETCH_TIMEOUT_MS = 5000;

const INTERVAL_TO_BYBIT: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
};

function intervalMs(interval: string): number {
  const m = /^(\d+)m$/.exec(interval);
  if (m) return Number(m[1]) * 60_000;
  if (interval === "1h") return 3_600_000;
  if (interval === "4h") return 4 * 3_600_000;
  if (interval === "1d") return 86_400_000;
  return 4 * 3_600_000;
}

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
      try { body = await res.json(); } catch { body = await res.text().catch(() => undefined); }
      throw new UpstreamError(`Bybit responded ${res.status} ${res.statusText}`, "bybit", body);
    }
    return res;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new UpstreamError(`Bybit timed out after ${FETCH_TIMEOUT_MS}ms`, "bybit");
    }
    throw new UpstreamError(`Bybit network error: ${err instanceof Error ? err.message : String(err)}`, "bybit");
  } finally {
    clearTimeout(timer);
  }
}

export function parseBybitKlines(raw: unknown, interval: string): Kline[] {
  if (!Array.isArray(raw)) {
    throw new UpstreamError("Bybit klines payload was not an array", "bybit", raw);
  }
  const step = intervalMs(interval);
  return raw.map((row) => {
    if (!Array.isArray(row) || row.length < 7) {
      throw new UpstreamError("Bybit malformed kline row", "bybit", row);
    }
    const openTime = Number(row[0]);
    return {
      openTime,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: openTime + step,
      quoteVolume: Number(row[6]),
      trades: 0,
    };
  });
}

export function parseBybitTicker(raw: unknown): Ticker24h {
  if (!raw || typeof raw !== "object" || !("lastPrice" in raw)) {
    throw new UpstreamError("Bybit ticker missing lastPrice", "bybit", raw);
  }
  const r = raw as Record<string, string | number>;
  const last = Number(r.lastPrice);
  const pct = Number(r.price24hPcnt);
  return {
    symbol: String(r.symbol),
    lastPrice: last,
    priceChange: last * pct,
    priceChangePercent: pct * 100,
    highPrice: Number(r.highPrice24h),
    lowPrice: Number(r.lowPrice24h),
    volume: Number(r.volume24h),
    quoteVolume: Number(r.turnover24h),
    trades: 0,
  };
}

export class BybitProvider implements MarketDataProvider {
  readonly id = "bybit" as const;

  async getKlines(symbol: string, interval = "4h", limit = 500): Promise<Kline[]> {
    const s = toBybitSymbol(symbol);
    const bybitInterval = INTERVAL_TO_BYBIT[interval] ?? "240";
    const url = `${BYBIT_BASE}/klines?category=spot&symbol=${encodeURIComponent(s)}&interval=${bybitInterval}&limit=${limit}`;
    const res = await fetchWithTimeout(url);
    const json = (await res.json()) as { result?: { list?: unknown[] } };
    return parseBybitKlines(json?.result?.list, interval).reverse();
  }

  async getTicker24h(symbol: string): Promise<Ticker24h> {
    const s = toBybitSymbol(symbol);
    const url = `${BYBIT_BASE}/tickers?category=spot&symbol=${encodeURIComponent(s)}`;
    const res = await fetchWithTimeout(url);
    const json = (await res.json()) as { result?: { list?: unknown[] } };
    if (!json.result?.list?.[0]) {
      throw new UpstreamError("Bybit ticker list empty", "bybit", json);
    }
    return parseBybitTicker(json.result.list[0]);
  }

  subscribeTicks(
    _symbols: string[],
    _onTick: (t: TickEvent) => void,
    _onStatus: (status: { connected: boolean }) => void,
  ): Unsubscribe {
    return () => {};
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${BYBIT_BASE}/time`);
      const json = (await res.json()) as { retCode?: number };
      return res.ok && json.retCode === 0;
    } catch {
      return false;
    }
  }
}

export const bybitProvider = new BybitProvider();
