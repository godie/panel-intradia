import {
  UpstreamError,
  type Kline,
  type MarketDataProvider,
  type ProviderId,
  type Ticker24h,
  type TickEvent,
  type Unsubscribe,
} from "./types";
import { binanceProvider } from "./binance";
import { bybitProvider } from "./bybit";

export type ProviderResult<T> = { provider: ProviderId; value: T };

/**
 * createProviderRouter — runs a list of providers in order and returns
 * the first successful result. The active source is cached in memory so
 * the UI badge can read it synchronously after the first call.
 *
 * The default singleton uses [binance, bybit]. Tests inject their own
 * providers via `createProviderRouter([...])`.
 */
export function createProviderRouter(providers: MarketDataProvider[]) {
  let activeSource: ProviderId | null = null;
  const HEALTH_CACHE_TTL_MS = 15_000;
  let healthCache: { value: Record<ProviderId, boolean>; expires: number } | null = null;

  async function runWithFallback<T>(
    label: string,
    fn: (p: MarketDataProvider) => Promise<T>,
  ): Promise<ProviderResult<T>> {
    let lastErr: unknown = null;

    const now = Date.now();
    const cachedHealth =
      healthCache && healthCache.expires > now ? healthCache.value : null;

    for (const p of providers) {
      const isHealthy = cachedHealth ? cachedHealth[p.id] : await p.healthy();
      if (!isHealthy) {
        lastErr = new Error(`${p.id} is unhealthy`);
        continue;
      }
      try {
        const value = await fn(p);
        activeSource = p.id;
        return { provider: p.id, value };
      } catch (err) {
        lastErr = err;
      }
    }

    // No provider succeeded — refresh health cache and re-throw.
    if (!cachedHealth) {
      const fresh = {} as Record<ProviderId, boolean>;
      await Promise.all(
        providers.map(async (p) => {
          fresh[p.id] = await p.healthy();
        }),
      );
      healthCache = { value: fresh, expires: now + HEALTH_CACHE_TTL_MS };
    }

    const msg =
      lastErr instanceof Error
        ? `All providers failed for ${label}: ${lastErr.message}`
        : `All providers failed for ${label}`;
    throw new UpstreamError(msg, activeSource ?? providers[0]?.id ?? "binance", lastErr);
  }

  return {
    id: "router" as const,
    getKlines(symbol: string, interval = "4h", limit = 500) {
      return runWithFallback(`getKlines(${symbol})`, (p) =>
        p.getKlines(symbol, interval, limit),
      ).then((r) => ({ provider: r.provider, klines: r.value }));
    },
    getTicker24h(symbol: string) {
      return runWithFallback(`getTicker24h(${symbol})`, (p) =>
        p.getTicker24h(symbol),
      ).then((r) => ({ provider: r.provider, ticker: r.value }));
    },
    subscribeTicks(
      symbols: string[],
      onTick: (t: TickEvent) => void,
      onStatus: (status: { connected: boolean }) => void,
    ): Unsubscribe {
      // The active provider holds the WS subscription. If the active
      // provider later swaps (e.g. health check fails), the tick-stream
      // mini-service will re-establish with the new active provider.
      const active = providers.find((p) => p.id === activeSource) ?? providers[0];
      return active.subscribeTicks(symbols, onTick, onStatus);
    },
    async healthy(): Promise<Record<ProviderId, boolean>> {
      const out = {} as Record<ProviderId, boolean>;
      await Promise.all(
        providers.map(async (p) => {
          out[p.id] = await p.healthy();
        }),
      );
      return out;
    },
    getActiveSource(): ProviderId | null {
      return activeSource;
    },
    providers,
  };
}

export const providerRouter = createProviderRouter([binanceProvider, bybitProvider]);
