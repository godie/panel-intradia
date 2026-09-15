import { describe, it, expect } from "vitest";
import {
  toBinanceSymbol,
  fromBinanceSymbol,
  toBybitSymbol,
  fromBybitSymbol,
  isSupportedSymbol,
  isValidSymbolFormat,
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

describe("isValidSymbolFormat", () => {
  it("accepts well-formed USDT spot pairs", () => {
    for (const s of ["BTCUSDT", "DOGEUSDT", "ADAUSDT", "ABCDEFGHIJKLUSDT"]) {
      expect(isValidSymbolFormat(s)).toBe(true);
    }
  });

  it("rejects empty, lowercase, non-USDT and malformed bases", () => {
    expect(isValidSymbolFormat("")).toBe(false);
    expect(isValidSymbolFormat("btcusdt")).toBe(false); // must be uppercase
    expect(isValidSymbolFormat("USDT")).toBe(false); // 0-letter base
    expect(isValidSymbolFormat("AUSDT")).toBe(false); // 1-letter base
    expect(isValidSymbolFormat("ABCDEFGHIJKLMUSDT")).toBe(false); // 13-letter base
    expect(isValidSymbolFormat("BTC2USDT")).toBe(false); // digits
    expect(isValidSymbolFormat("BTC-USD")).toBe(false);
    expect(isValidSymbolFormat("BTCUSD")).toBe(false); // missing T
  });

  it("only checks shape — a repeated suffix still passes (upstream is the real gate)", () => {
    // "BTCUSDT" is a valid 7-letter base, so "BTCUSDTUSDT" passes the shape
    // check. Whether the pair exists is decided by the Binance fetch, not here.
    expect(isValidSymbolFormat("BTCUSDTUSDT")).toBe(true);
  });
});