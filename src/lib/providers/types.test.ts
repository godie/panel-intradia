import { describe, it, expect } from "vitest";
import type { MarketDataProvider, ProviderId } from "./types";

describe("ProviderId", () => {
  it("only accepts the documented sources", () => {
    const ids: ProviderId[] = ["binance", "bybit"];
    expect(ids).toHaveLength(2);
  });
});

describe("MarketDataProvider", () => {
  it("is structurally compatible with a stub", () => {
    const stub: MarketDataProvider = {
      id: "binance",
      getKlines: async () => [],
      getTicker24h: async () => null,
      subscribeTicks: () => () => {},
      healthy: async () => true,
    };
    expect(stub.id).toBe("binance");
    expect(typeof stub.subscribeTicks).toBe("function");
  });
});
