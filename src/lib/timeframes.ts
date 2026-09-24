/**
 * Timeframes — the candle intervals the dashboard can analyse, plus the fixed
 * presets used by the comparison page.
 *
 * The canonical value is exactly what Binance/Bybit expect in their kline
 * endpoint (`1h`, `4h`, `1d`, `1w` — lowercase `d`/`w`), so the same string
 * flows through the API query param, the providers and the persisted map.
 *
 * `isTimeframe` is the strict check (canonical only) — use it when the value
 * comes from somewhere already canonical. `normalizeTimeframe` is the input
 * boundary (query params, hand-edited localStorage) and accepts case/alias
 * variants.
 */

export type Timeframe = "1h" | "4h" | "1d" | "1w";

/** Canonical order, shortest → longest. Also the order of the UI buttons. */
export const TIMEFRAMES: readonly Timeframe[] = ["1h", "4h", "1d", "1w"];

/** Interval used when nothing is specified (the dashboard's historical one). */
export const DEFAULT_TIMEFRAME: Timeframe = "4h";

/** i18n keys for the short label rendered on the selector buttons. */
export const TIMEFRAME_LABEL_KEY: Record<Timeframe, string> = {
  "1h": "tf.1h",
  "4h": "tf.4h",
  "1d": "tf.1d",
  "1w": "tf.1w",
};

export function isTimeframe(value: unknown): value is Timeframe {
  return (
    typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value)
  );
}

/** Alias → canonical. Keys must already be trimmed + lowercased. */
const TIMEFRAME_ALIASES: Record<string, Timeframe> = {
  "1h": "1h",
  "1hr": "1h",
  h: "1h",
  h1: "1h",
  hour: "1h",
  hourly: "1h",
  "4h": "4h",
  "4hr": "4h",
  h4: "4h",
  "1d": "1d",
  "1day": "1d",
  d: "1d",
  d1: "1d",
  day: "1d",
  daily: "1d",
  "1w": "1w",
  "1week": "1w",
  w: "1w",
  w1: "1w",
  week: "1w",
  weekly: "1w",
};

/**
 * normalizeTimeframe — canonicalizes a user-supplied interval. Returns null
 * for anything unrecognized (the caller decides the fallback).
 */
export function normalizeTimeframe(
  value: string | null | undefined,
): Timeframe | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (key === "") return null;
  return TIMEFRAME_ALIASES[key] ?? null;
}

export type ComparePreset = {
  /** URL id, e.g. "4h-1d". */
  id: string;
  /** Left column — the shorter (micro) timeframe. */
  a: Timeframe;
  /** Right column — the longer (macro) timeframe. */
  b: Timeframe;
};

/**
 * The comparison page's presets: three consecutive micro/macro steps. Fixed on
 * purpose — the page has no timeframe dropdowns.
 */
export const COMPARE_PRESETS: readonly ComparePreset[] = [
  { id: "1h-4h", a: "1h", b: "4h" },
  { id: "4h-1d", a: "4h", b: "1d" },
  { id: "1d-1w", a: "1d", b: "1w" },
];

export const DEFAULT_COMPARE_PRESET_ID = "4h-1d";

export function getPreset(id: string | null | undefined): ComparePreset | null {
  if (typeof id !== "string") return null;
  return COMPARE_PRESETS.find((p) => p.id === id) ?? null;
}

/** localStorage key holding the per-symbol timeframe map as one JSON object. */
export const TF_MAP_STORAGE_KEY = "panel:tf-map";

/**
 * parseTimeframeMap — reads the persisted `{ SYMBOL: Timeframe }` map.
 * Never throws: malformed JSON, arrays, null, and entries with unknown
 * timeframes or empty symbols are all dropped.
 */
export function parseTimeframeMap(raw: string | null): Record<string, Timeframe> {
  if (typeof raw !== "string" || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, Timeframe> = {};
  for (const [symbol, tf] of Object.entries(parsed as Record<string, unknown>)) {
    if (symbol !== "" && isTimeframe(tf)) out[symbol] = tf;
  }
  return out;
}

/** serializeTimeframeMap — inverse of parseTimeframeMap. */
export function serializeTimeframeMap(map: Record<string, Timeframe>): string {
  return JSON.stringify(map);
}
