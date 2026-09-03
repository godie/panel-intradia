import { describe, it, expect } from "vitest";
import {
  toBinanceSymbol,
  fromBinanceSymbol,
  toBybitSymbol,
  fromBybitSymbol,
  isSupportedSymbol,
} from "./symbols";

describe("symbol mapping", () => {
  it("round-trips Binance symbols unchanged", () => {
    const s = "BTCUSDT";
    expect(toBinanceSymbol(s)).toBe("BTCUSDT");
    expect(fromBinanceSymbol(s)).toBe("BTCUSDT");
  });

  it("Bybit uses the same symbol string for USDT spot pairs", () => {
    const s = "BTCUSDT";
    expect(toBybitSymbol(s)).toBe("BTCUSDT");
    expect(fromBybitSymbol(s)).toBe("BTCUSDT");
  });

  it("isSupportedSymbol accepts the documented set", () => {
    for (const s of ["BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT", "BNBUSDT"]) {
      expect(isSupportedSymbol(s)).toBe(true);
    }
  });

  it("isSupportedSymbol rejects unknown tickers", () => {
    expect(isSupportedSymbol("DOGEUSDT")).toBe(false);
    expect(isSupportedSymbol("")).toBe(false);
    expect(isSupportedSymbol("btcusdt")).toBe(false); // case sensitive
  });
});