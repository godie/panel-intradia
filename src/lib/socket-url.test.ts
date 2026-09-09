import { describe, expect, it } from "vitest";
import { buildGatewaySocketUrl } from "@/lib/socket-url";

describe("buildGatewaySocketUrl", () => {
  it("uses a relative URL when the page is served by the gateway", () => {
    expect(
      buildGatewaySocketUrl("3004", {
        protocol: "http:",
        hostname: "localhost",
        port: "81",
      }),
    ).toBe("/_order-book/socket.io/");
  });

  it("preserves HTTPS when reaching the gateway from a direct page", () => {
    expect(
      buildGatewaySocketUrl("3004", {
        protocol: "https:",
        hostname: "dashboard.example.com",
        port: "443",
      }),
    ).toBe("https://dashboard.example.com/_order-book/socket.io/");
  });

  it("uses the page hostname for direct development access", () => {
    expect(
      buildGatewaySocketUrl("3005", {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "3000",
      }),
    ).toBe("http://127.0.0.1:81/_tick-stream/socket.io/");
  });

  it("returns a relative URL without a browser location", () => {
    expect(buildGatewaySocketUrl("3005")).toBe("/_tick-stream/socket.io/");
  });

  it("supports the default HTTPS port represented by an empty location port", () => {
    expect(
      buildGatewaySocketUrl("3005", {
        protocol: "https:",
        hostname: "dashboard.example.com",
        port: "",
      }),
    ).toBe("https://dashboard.example.com/_tick-stream/socket.io/");
  });
});
