import { describe, expect, it } from "vitest";
import {
  addSymbol,
  loadWatchlist,
  removeSymbol,
  validateSymbol,
  DEFAULT_WATCHLIST,
} from "./symbol-manager";

describe("validateSymbol", () => {
  it("normalizes a lowercase pair to uppercase", () => {
    expect(validateSymbol("btcusdt")).toBe("BTCUSDT");
    expect(validateSymbol("  adausdt ")).toBe("ADAUSDT");
  });

  it("rejects pairs that don't end in USDT", () => {
    expect(validateSymbol("BTCUSD")).toBeNull();
    expect(validateSymbol("BTCBUSD")).toBeNull();
  });

  it("rejects separators, digits and empty input", () => {
    expect(validateSymbol("BTC-USDT")).toBeNull();
    expect(validateSymbol("1INCHUSDT")).toBeNull();
    expect(validateSymbol("")).toBeNull();
    expect(validateSymbol("   ")).toBeNull();
  });

  it("enforces the 2-12 letter base-asset bound", () => {
    expect(validateSymbol("AUSDT")).toBeNull(); // 1-letter base
    expect(validateSymbol("ABCDEFGHIJKLMUSDT")).toBeNull(); // 13-letter base
    expect(validateSymbol("ABCDEFGHIJKLUSDT")).toBe("ABCDEFGHIJKLUSDT");
  });
});

describe("addSymbol", () => {
  it("appends a valid symbol after normalizing it", () => {
    expect(addSymbol(["BTCUSDT"], "adausdt")).toEqual(["BTCUSDT", "ADAUSDT"]);
  });

  it("returns the same list reference for duplicates and invalid input", () => {
    const list = ["BTCUSDT"];
    expect(addSymbol(list, "BTCUSDT")).toBe(list);
    expect(addSymbol(list, "NOPE")).toBe(list);
  });

  it("refuses to grow past the 20-symbol cap", () => {
    const full = Array.from(
      { length: 20 },
      (_, i) => `${String.fromCharCode(65 + i)}XUSDT`,
    );
    expect(addSymbol(full, "ADAUSDT")).toBe(full);
    expect(full).toHaveLength(20);
  });
});

describe("removeSymbol", () => {
  it("removes the requested symbol", () => {
    expect(removeSymbol(["BTCUSDT", "ETHUSDT"], "BTCUSDT")).toEqual(["ETHUSDT"]);
  });

  it("always keeps at least one symbol", () => {
    const single = ["BTCUSDT"];
    expect(removeSymbol(single, "BTCUSDT")).toBe(single);
  });

  it("is a no-op for an unknown symbol", () => {
    const list = ["BTCUSDT", "ETHUSDT"];
    expect(removeSymbol(list, "ADAUSDT")).toEqual(list);
  });
});

describe("loadWatchlist", () => {
  it("falls back to the default 5 symbols when localStorage is unavailable", () => {
    expect(loadWatchlist()).toEqual([...DEFAULT_WATCHLIST]);
  });

  it("returns a fresh copy so callers can't mutate the default", () => {
    const first = loadWatchlist();
    first.push("ADAUSDT");
    expect(loadWatchlist()).not.toContain("ADAUSDT");
  });
});
