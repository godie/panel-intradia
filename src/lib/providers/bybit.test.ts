import { describe, it, expect } from "vitest";
import { parseBybitKlines, parseBybitTicker } from "./bybit";
import type { Kline, Ticker24h } from "./types";

describe("parseBybitKlines", () => {
  it("converts a Bybit v5 /v5/market/klines list to Kline[]", () => {
    const raw = [
      ["1700000000000", "30000", "30100", "29900", "30050", "100", "3005000"],
      ["1700003600000", "30050", "30200", "30000", "30150", "120", "3618000"],
    ];
    const out = parseBybitKlines(raw, "4h");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject<Kline>({
      openTime: 1700000000000,
      open: 30000,
      high: 30100,
      low: 29900,
      close: 30050,
      volume: 100,
      quoteVolume: 3005000,
      closeTime: 1700000000000 + 4 * 60 * 60 * 1000,
    });
    expect(out[1].trades).toBe(0);
  });

  it("throws UpstreamError when payload is not an array of arrays", () => {
    expect(() => parseBybitKlines({ foo: 1 }, "4h")).toThrow();
  });
});

describe("parseBybitTicker", () => {
  it("maps /v5/market/tickers fields to Ticker24h", () => {
    const out = parseBybitTicker({
      symbol: "BTCUSDT",
      lastPrice: "30000.50",
      price24hPcnt: "0.005",
      highPrice24h: "30500",
      lowPrice24h: "29900",
      volume24h: "1000",
      turnover24h: "30000000",
    });
    expect(out).toMatchObject<Ticker24h>({
      symbol: "BTCUSDT",
      lastPrice: 30000.5,
      highPrice: 30500,
      lowPrice: 29900,
      volume: 1000,
      quoteVolume: 30000000,
      trades: 0,
    });
    expect(out.priceChange).toBeCloseTo(150.0025, 3);
    expect(out.priceChangePercent).toBeCloseTo(0.5, 5);
  });
});
