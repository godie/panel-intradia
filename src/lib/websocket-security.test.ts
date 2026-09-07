import { describe, expect, it } from "vitest";
import {
  isAllowedWebSocketOrigin,
  isValidMarketPrice,
  isValidMarketQuantity,
  isValidChatText,
} from "@/lib/websocket-security";

describe("isAllowedWebSocketOrigin", () => {
  const allowed = ["https://dashboard.example.com", "http://localhost:3000"];

  it("allows an exact configured origin", () => {
    expect(isAllowedWebSocketOrigin("https://dashboard.example.com", allowed)).toBe(true);
  });

  it("rejects an unconfigured origin", () => {
    expect(isAllowedWebSocketOrigin("https://evil.example", allowed)).toBe(false);
  });

  it("rejects lookalike subdomains and missing origins", () => {
    expect(isAllowedWebSocketOrigin("https://dashboard.example.com.evil.example", allowed)).toBe(false);
    expect(isAllowedWebSocketOrigin(undefined, allowed)).toBe(false);
  });
});

describe("chat input validation", () => {
  it("requires non-empty text within the configured limit", () => {
    expect(isValidChatText("alice", 64)).toBe(true);
    expect(isValidChatText("   ", 64)).toBe(false);
    expect(isValidChatText("a".repeat(65), 64)).toBe(false);
    expect(isValidChatText(null, 64)).toBe(false);
  });
});

describe("market-data validation", () => {
  it("accepts finite positive prices", () => {
    expect(isValidMarketPrice(1)).toBe(true);
    expect(isValidMarketPrice(0)).toBe(false);
    expect(isValidMarketPrice(Number.NaN)).toBe(false);
    expect(isValidMarketPrice("1")).toBe(false);
  });

  it("accepts finite non-negative quantities", () => {
    expect(isValidMarketQuantity(0)).toBe(true);
    expect(isValidMarketQuantity(1.5)).toBe(true);
    expect(isValidMarketQuantity(-1)).toBe(false);
    expect(isValidMarketQuantity(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
