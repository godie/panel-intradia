import { describe, it, expect, vi } from "vitest";
import { createProviderRouter } from "./router";
import { UpstreamError, type Kline, type Ticker24h } from "./types";

const fakeKlines: Kline[] = [
  { openTime: 1, open: 1, high: 1, low: 1, close: 1, volume: 0, closeTime: 2, quoteVolume: 0, trades: 0 },
];

function makeProvider(
  id: "binance" | "bybit",
  klines: Kline[] | Error,
  ticker: Ticker24h | null | Error,
  healthy: boolean,
) {
  return {
    id,
    getKlines: vi.fn(async () => {
      if (klines instanceof Error) throw klines;
      return klines;
    }),
    getTicker24h: vi.fn(async () => {
      if (ticker instanceof Error) throw ticker;
      return ticker;
    }),
    subscribeTicks: vi.fn(() => () => {}),
    healthy: vi.fn(async () => healthy),
  };
}

describe("createProviderRouter", () => {
  it("returns Binance when Binance is healthy", async () => {
    const binance = makeProvider("binance", fakeKlines, null, true);
    const bybit = makeProvider("bybit", fakeKlines, null, true);
    const router = createProviderRouter([binance, bybit]);
    const r = await router.getKlines("BTCUSDT");
    expect(r.provider).toBe("binance");
    expect(r.klines).toBe(fakeKlines);
  });

  it("falls back to Bybit when Binance throws UpstreamError", async () => {
    const binance = makeProvider("binance", new UpstreamError("down", "binance"), null, false);
    const bybit = makeProvider("bybit", fakeKlines, null, true);
    const router = createProviderRouter([binance, bybit]);
    const r = await router.getKlines("BTCUSDT");
    expect(r.provider).toBe("bybit");
  });

  it("skips Bybit when it is also unhealthy and propagates the last error", async () => {
    const binance = makeProvider("binance", new UpstreamError("binance down", "binance"), null, false);
    const bybit = makeProvider("bybit", new UpstreamError("bybit down", "bybit"), null, false);
    const router = createProviderRouter([binance, bybit]);
    await expect(router.getKlines("BTCUSDT")).rejects.toThrow(/bybit is unhealthy/);
  });

  it("treats a null ticker as success (no throw)", async () => {
    const binance = makeProvider("binance", fakeKlines, null, true);
    const router = createProviderRouter([binance]);
    const r = await router.getTicker24h("BTCUSDT");
    expect(r.provider).toBe("binance");
    expect(r.ticker).toBeNull();
  });

  it("getActiveSource reflects the most recent successful provider", async () => {
    const binance = makeProvider("binance", fakeKlines, null, false);
    const bybit = makeProvider("bybit", fakeKlines, null, true);
    const router = createProviderRouter([binance, bybit]);
    await router.getKlines("BTCUSDT");
    expect(router.getActiveSource()).toBe("bybit");
  });
});
