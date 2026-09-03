import { describe, it, expect } from "vitest";
import { parseKlines, parseTicker } from "./binance";
import type { Kline, Ticker24h } from "./types";

describe("parseKlines", () => {
  it("converts Binance raw kline arrays into Kline objects", () => {
    const raw = [
      [
        1700000000000, "30000", "30100", "29900", "30050",
        "100", 1700003599999, "3005000", "5000",
      ],
    ];
    const out = parseKlines(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual<Kline>({
      openTime: 1700000000000,
      open: 30000,
      high: 30100,
      low: 29900,
      close: 30050,
      volume: 100,
      closeTime: 1700003599999,
      quoteVolume: 3005000,
      trades: 5000,
    });
  });

  it("throws UpstreamError on malformed entry", () => {
    expect(() => parseKlines([["a", "b"]])).toThrow();
  });
});

describe("parseTicker", () => {
  it("normalizes stringy numbers from the Binance ticker payload", () => {
    const out = parseTicker({
      symbol: "BTCUSDT",
      lastPrice: "30000.50",
      priceChange: "150",
      priceChangePercent: "0.5",
      highPrice: "30500",
      lowPrice: "29900",
      volume: "1000",
      quoteVolume: "30000000",
      count: "5000",
    });
    expect(out).toEqual<Ticker24h>({
      symbol: "BTCUSDT",
      lastPrice: 30000.5,
      priceChange: 150,
      priceChangePercent: 0.5,
      highPrice: 30500,
      lowPrice: 29900,
      volume: 1000,
      quoteVolume: 30000000,
      trades: 5000,
    });
  });
});
