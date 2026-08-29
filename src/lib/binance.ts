/**
 * Binance public API client.
 *
 * All network calls use a 5-second timeout and throw typed errors so the
 * API route can translate them into HTTP 502 responses. No data is ever
 * fabricated — if Binance fails, we surface the failure explicitly.
 */

const BINANCE_BASE = "https://api.binance.com/api/v3";
const FETCH_TIMEOUT_MS = 5000;

export type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
};

export type Ticker24h = {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  trades: number;
};

export class BinanceError extends Error {
  constructor(
    message: string,
    public readonly upstream?: unknown,
  ) {
    super(message);
    this.name = "BinanceError";
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PanelCuantitativo/1.0 (+server)",
      },
      // Never cache upstream responses at the fetch layer — we manage our
      // own 60s server cache in lib/cache.ts.
      cache: "no-store",
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => undefined);
      }
      throw new BinanceError(
        `Binance responded ${res.status} ${res.statusText}`,
        body,
      );
    }
    return res;
  } catch (err) {
    if (err instanceof BinanceError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new BinanceError(`Binance request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new BinanceError(
      `Network error contacting Binance: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fetchKlines — fetch OHLCV candles for a symbol.
 * Endpoint: /api/v3/klines
 *
 * Each kline returned by Binance is an array:
 * [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, ...]
 */
export async function fetchKlines(
  symbol: string,
  interval = "4h",
  limit = 500,
): Promise<Kline[]> {
  const url = `${BINANCE_BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
    interval,
  )}&limit=${limit}`;
  const res = await fetchWithTimeout(url);
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) {
    throw new BinanceError("Klines payload was not an array", raw);
  }
  return raw.map((k) => {
    if (!Array.isArray(k) || k.length < 9) {
      throw new BinanceError("Malformed kline entry", k);
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

/**
 * fetchTicker24h — spot price + 24h change stats.
 * Endpoint: /api/v3/ticker/24hr
 */
export async function fetchTicker24h(symbol: string): Promise<Ticker24h> {
  const url = `${BINANCE_BASE}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetchWithTimeout(url);
  const raw = (await res.json()) as Record<string, string | number>;
  if (!raw || typeof raw !== "object" || !("lastPrice" in raw)) {
    throw new BinanceError("Ticker payload missing lastPrice", raw);
  }
  return {
    symbol: String(raw.symbol),
    lastPrice: Number(raw.lastPrice),
    priceChange: Number(raw.priceChange),
    priceChangePercent: Number(raw.priceChangePercent),
    highPrice: Number(raw.highPrice),
    lowPrice: Number(raw.lowPrice),
    volume: Number(raw.volume),
    quoteVolume: Number(raw.quoteVolume),
    trades: Number(raw.count ?? 0),
  };
}
