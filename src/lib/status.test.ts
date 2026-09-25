import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPSTREAM,
  SERVICE_ENV_VAR,
  diagnose,
  formatUptime,
  parseHealthPayload,
  resolveServiceTargets,
} from "@/lib/status";

describe("resolveServiceTargets", () => {
  it("defaults to localhost on the mini-service ports", () => {
    const targets = resolveServiceTargets({});
    expect(targets.map((t) => t.id)).toEqual(["tick-stream", "order-book"]);
    expect(targets[0].target).toBe("localhost:3005");
    expect(targets[0].healthUrl).toBe("http://localhost:3005/health");
    expect(targets[1].target).toBe("localhost:3004");
    expect(targets[1].healthUrl).toBe("http://localhost:3004/health");
  });

  it("uses the same env vars the gateway (Caddy) uses", () => {
    const targets = resolveServiceTargets({
      TICK_STREAM_UPSTREAM: "tick-stream:3005",
      ORDER_BOOK_UPSTREAM: "order-book:3004",
    });
    expect(targets[0].target).toBe("tick-stream:3005");
    expect(targets[0].healthUrl).toBe("http://tick-stream:3005/health");
    expect(targets[1].healthUrl).toBe("http://order-book:3004/health");
    expect(targets[0].envVar).toBe("TICK_STREAM_UPSTREAM");
  });

  it("accepts a full URL and keeps its scheme", () => {
    const [tick] = resolveServiceTargets({
      TICK_STREAM_UPSTREAM: "https://ws.example.com",
    });
    expect(tick.healthUrl).toBe("https://ws.example.com/health");
  });

  it("strips trailing slashes so the path doesn't double up", () => {
    const [tick] = resolveServiceTargets({
      TICK_STREAM_UPSTREAM: "https://ws.example.com///",
    });
    expect(tick.healthUrl).toBe("https://ws.example.com/health");
  });

  it("falls back to the default on blank / whitespace values", () => {
    const targets = resolveServiceTargets({
      TICK_STREAM_UPSTREAM: "   ",
      ORDER_BOOK_UPSTREAM: "",
    });
    expect(targets[0].target).toBe(DEFAULT_UPSTREAM["tick-stream"]);
    expect(targets[1].target).toBe(DEFAULT_UPSTREAM["order-book"]);
  });

  it("exposes the env var name for each service", () => {
    expect(SERVICE_ENV_VAR["tick-stream"]).toBe("TICK_STREAM_UPSTREAM");
    expect(SERVICE_ENV_VAR["order-book"]).toBe("ORDER_BOOK_UPSTREAM");
  });
});

describe("parseHealthPayload", () => {
  const valid = {
    ok: true,
    service: "tick-stream",
    port: 3005,
    activeSource: "binance",
    binanceConnected: true,
    bybitConnected: false,
    clients: 3,
    uptime: 1234.5,
  };

  it("parses the mini-service /health contract", () => {
    expect(parseHealthPayload(valid)).toEqual(valid);
  });

  it("rejects anything that isn't an ok:true object with a service name", () => {
    expect(parseHealthPayload(null)).toBeNull();
    expect(parseHealthPayload(undefined)).toBeNull();
    expect(parseHealthPayload("nope")).toBeNull();
    expect(parseHealthPayload([])).toBeNull();
    expect(parseHealthPayload({})).toBeNull();
    expect(parseHealthPayload({ ok: false, service: "tick-stream" })).toBeNull();
    expect(parseHealthPayload({ ok: true })).toBeNull();
    expect(parseHealthPayload({ ok: true, service: 42 })).toBeNull();
  });

  it("defaults the optional fields instead of rejecting the payload", () => {
    expect(parseHealthPayload({ ok: true, service: "order-book" })).toEqual({
      ok: true,
      service: "order-book",
      port: null,
      activeSource: null,
      binanceConnected: false,
      bybitConnected: false,
      clients: 0,
      uptime: 0,
    });
  });

  it("coerces non-boolean flags to false rather than truthy values", () => {
    const out = parseHealthPayload({
      ok: true,
      service: "tick-stream",
      binanceConnected: "yes",
      bybitConnected: 1,
    });
    expect(out?.binanceConnected).toBe(false);
    expect(out?.bybitConnected).toBe(false);
  });
});

describe("diagnose", () => {
  it("is ok only when both signals agree the services are up", () => {
    expect(diagnose(true, true, true)).toBe("ok");
  });

  it("blames the gateway when the server reaches them but the browser can't", () => {
    expect(diagnose(true, false, false)).toBe("gateway");
    expect(diagnose(true, true, false)).toBe("gateway");
    expect(diagnose(true, false, true)).toBe("gateway");
  });

  it("reports server_blind when only the browser can reach them", () => {
    expect(diagnose(false, true, true)).toBe("server_blind");
  });

  it("reports down when neither side reaches them", () => {
    expect(diagnose(false, false, false)).toBe("down");
    expect(diagnose(false, true, false)).toBe("down");
    expect(diagnose(false, false, true)).toBe("down");
  });
});

describe("formatUptime", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(42)).toBe("42s");
    expect(formatUptime(90)).toBe("1m 30s");
    expect(formatUptime(3600)).toBe("1h 0m");
    expect(formatUptime(3725)).toBe("1h 2m");
    expect(formatUptime(86400)).toBe("1d 0h");
    expect(formatUptime(1811156.86)).toBe("20d 23h");
  });

  it("handles nonsense input without throwing", () => {
    expect(formatUptime(Number.NaN)).toBe("—");
    expect(formatUptime(-5)).toBe("0s");
    expect(formatUptime(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
