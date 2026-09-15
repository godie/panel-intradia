import { describe, expect, it } from "vitest";
import { getSymbolMeta, SYMBOL_META } from "./types";

describe("getSymbolMeta", () => {
  it("returns the stored metadata for a known symbol", () => {
    expect(getSymbolMeta("BTCUSDT")).toBe(SYMBOL_META.BTCUSDT);
    expect(getSymbolMeta("ETHUSDT")).toBe(SYMBOL_META.ETHUSDT);
  });

  it("derives metadata for an unknown USDT pair", () => {
    expect(getSymbolMeta("ADAUSDT")).toEqual({
      label: "ADA",
      pair: "ADA / USD",
      asset: "ADA",
      quote: "USD",
    });
  });

  it("falls back to the raw symbol when there is no USDT suffix", () => {
    expect(getSymbolMeta("WEIRD")).toEqual({
      label: "WEIRD",
      pair: "WEIRD / USD",
      asset: "WEIRD",
      quote: "USD",
    });
  });
});
