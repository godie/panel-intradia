import { describe, expect, it } from "vitest";
import {
  COMPARE_PRESETS,
  DEFAULT_COMPARE_PRESET_ID,
  DEFAULT_TIMEFRAME,
  TIMEFRAMES,
  getPreset,
  isTimeframe,
  normalizeTimeframe,
  parseTimeframeMap,
  serializeTimeframeMap,
} from "@/lib/timeframes";

describe("TIMEFRAMES / DEFAULT_TIMEFRAME", () => {
  it("lists the four supported timeframes in canonical order", () => {
    expect(TIMEFRAMES).toEqual(["1h", "4h", "1d", "1w"]);
  });

  it("defaults to 4h (the historical interval)", () => {
    expect(DEFAULT_TIMEFRAME).toBe("4h");
    expect(TIMEFRAMES).toContain(DEFAULT_TIMEFRAME);
  });
});

describe("isTimeframe", () => {
  it("accepts every canonical value", () => {
    for (const tf of TIMEFRAMES) {
      expect(isTimeframe(tf)).toBe(true);
    }
  });

  it("rejects uppercase, aliases, blanks and non-strings", () => {
    expect(isTimeframe("4H")).toBe(false);
    expect(isTimeframe("daily")).toBe(false);
    expect(isTimeframe("")).toBe(false);
    expect(isTimeframe(null)).toBe(false);
    expect(isTimeframe(undefined)).toBe(false);
    expect(isTimeframe(1)).toBe(false);
    expect(isTimeframe("15m")).toBe(false);
  });
});

describe("normalizeTimeframe", () => {
  it("passes through canonical values", () => {
    expect(normalizeTimeframe("1h")).toBe("1h");
    expect(normalizeTimeframe("4h")).toBe("4h");
    expect(normalizeTimeframe("1d")).toBe("1d");
    expect(normalizeTimeframe("1w")).toBe("1w");
  });

  it("accepts uppercase", () => {
    expect(normalizeTimeframe("1H")).toBe("1h");
    expect(normalizeTimeframe("4H")).toBe("4h");
    expect(normalizeTimeframe("1D")).toBe("1d");
    expect(normalizeTimeframe("1W")).toBe("1w");
  });

  it("accepts word aliases, trimmed", () => {
    expect(normalizeTimeframe("hourly")).toBe("1h");
    expect(normalizeTimeframe("daily")).toBe("1d");
    expect(normalizeTimeframe(" day ")).toBe("1d");
    expect(normalizeTimeframe("weekly")).toBe("1w");
    expect(normalizeTimeframe("W")).toBe("1w");
  });

  it("returns null for blanks, unknown intervals and nullish input", () => {
    expect(normalizeTimeframe("")).toBeNull();
    expect(normalizeTimeframe("   ")).toBeNull();
    expect(normalizeTimeframe("15m")).toBeNull();
    expect(normalizeTimeframe("nope")).toBeNull();
    expect(normalizeTimeframe(null)).toBeNull();
    expect(normalizeTimeframe(undefined)).toBeNull();
  });
});

describe("COMPARE_PRESETS", () => {
  it("has the three consecutive presets", () => {
    expect(COMPARE_PRESETS.map((p) => p.id)).toEqual(["1h-4h", "4h-1d", "1d-1w"]);
  });

  it("is consecutive: each preset's b is the next preset's a", () => {
    for (let i = 1; i < COMPARE_PRESETS.length; i++) {
      expect(COMPARE_PRESETS[i].a).toBe(COMPARE_PRESETS[i - 1].b);
    }
  });

  it("orders each preset from the shorter to the longer timeframe", () => {
    for (const preset of COMPARE_PRESETS) {
      expect(TIMEFRAMES.indexOf(preset.a)).toBeLessThan(TIMEFRAMES.indexOf(preset.b));
    }
  });

  it("defaults to 4h-1d and that id exists", () => {
    expect(DEFAULT_COMPARE_PRESET_ID).toBe("4h-1d");
    expect(getPreset(DEFAULT_COMPARE_PRESET_ID)?.id).toBe(DEFAULT_COMPARE_PRESET_ID);
  });
});

describe("getPreset", () => {
  it("resolves every preset id", () => {
    for (const preset of COMPARE_PRESETS) {
      expect(getPreset(preset.id)).toEqual(preset);
    }
  });

  it("returns null for unknown / nullish ids", () => {
    expect(getPreset("1w-1d")).toBeNull();
    expect(getPreset("")).toBeNull();
    expect(getPreset(null)).toBeNull();
    expect(getPreset(undefined)).toBeNull();
  });
});

describe("parseTimeframeMap / serializeTimeframeMap", () => {
  it("round-trips a valid map", () => {
    const map = { BTCUSDT: "1h", ETHUSDT: "1w" } as const;
    expect(parseTimeframeMap(serializeTimeframeMap({ ...map }))).toEqual(map);
  });

  it("returns {} for null, empty and malformed input", () => {
    expect(parseTimeframeMap(null)).toEqual({});
    expect(parseTimeframeMap("")).toEqual({});
    expect(parseTimeframeMap("{")).toEqual({});
    expect(parseTimeframeMap("null")).toEqual({});
    expect(parseTimeframeMap("[1,2]")).toEqual({});
    expect(parseTimeframeMap('"str"')).toEqual({});
  });

  it("drops entries with unknown timeframes or non-string values", () => {
    const raw = JSON.stringify({
      BTCUSDT: "1h",
      BADUSDT: "15m",
      ALSOBAD: 4,
      NULLISH: null,
    });
    expect(parseTimeframeMap(raw)).toEqual({ BTCUSDT: "1h" });
  });

  it("drops unknown symbols with empty keys", () => {
    expect(parseTimeframeMap(JSON.stringify({ "": "1h", BTCUSDT: "1d" }))).toEqual({
      BTCUSDT: "1d",
    });
  });

  it("serializes an empty map to a JSON object", () => {
    expect(serializeTimeframeMap({})).toBe("{}");
  });
});
