import { describe, expect, it } from "vitest";
import { buildGatewaySocketTarget } from "@/lib/socket-url";

describe("buildGatewaySocketTarget", () => {
  it("uses the page origin and the prefixed path when served by the gateway", () => {
    expect(
      buildGatewaySocketTarget("3004", {
        protocol: "http:",
        hostname: "localhost",
        port: "81",
      }),
    ).toEqual({ url: "http://localhost:81", path: "/_order-book/socket.io/" });
  });

  it("preserves HTTPS when reaching the gateway from a direct page", () => {
    expect(
      buildGatewaySocketTarget("3004", {
        protocol: "https:",
        hostname: "dashboard.example.com",
        port: "443",
      }),
    ).toEqual({
      url: "https://dashboard.example.com",
      path: "/_order-book/socket.io/",
    });
  });

  it("uses the page hostname for direct development access", () => {
    expect(
      buildGatewaySocketTarget("3005", {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "3000",
      }),
    ).toEqual({ url: "http://127.0.0.1:81", path: "/_tick-stream/socket.io/" });
  });

  it("returns an empty origin without a browser location (SSR)", () => {
    expect(buildGatewaySocketTarget("3005")).toEqual({
      url: "",
      path: "/_tick-stream/socket.io/",
    });
  });

  it("supports the default HTTPS port represented by an empty location port", () => {
    expect(
      buildGatewaySocketTarget("3005", {
        protocol: "https:",
        hostname: "dashboard.example.com",
        port: "",
      }),
    ).toEqual({
      url: "https://dashboard.example.com",
      path: "/_tick-stream/socket.io/",
    });
  });

  it("never puts the prefix in the URL — socket.io reads that as the namespace", () => {
    const target = buildGatewaySocketTarget("3005", {
      protocol: "http:",
      hostname: "localhost",
      port: "81",
    });
    expect(target.url).not.toContain("_tick-stream");
    expect(target.path).toContain("_tick-stream");
    expect(target.path.endsWith("/socket.io/")).toBe(true);
  });

  it("falls back to the bare engine path for an unknown service port", () => {
    expect(
      buildGatewaySocketTarget("9999", {
        protocol: "http:",
        hostname: "localhost",
        port: "81",
      }),
    ).toEqual({ url: "http://localhost:81", path: "/socket.io/" });
  });
});
