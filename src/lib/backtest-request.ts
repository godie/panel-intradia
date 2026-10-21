/**
 * backtest-request.ts — request-shape helpers shared by
 * `/api/backtest` and `/api/backtest/walk-forward`.
 *
 * Pure functions only (no fetch, no NextResponse): the routes validate the
 * JSON body here once and then call the engine. Keeping ONE source of truth
 * for the clamps/defaults avoids the two endpoints drifting apart — their
 * limits, defaults and error messages are identical by intent.
 */

import type { BacktestInterval, PositionSizing } from "@/lib/backtest";
import { customStrategyToStrategy } from "@/lib/custom-strategies";
import type { ConditionType, CustomStrategy } from "@/lib/custom-strategies";
import { STRATEGY_LIST } from "@/lib/strategies";
import type { Strategy, StrategyAction } from "@/lib/strategies";

export const VALID_INTERVALS: BacktestInterval[] = ["15m", "1h", "4h", "1d"];
export const VALID_ACTIONS: StrategyAction[] = ["BUY", "HOLD", "SHORT", "WAIT"];
export const VALID_SIZING: PositionSizing[] = [
  "full",
  "fixed_fractional",
  "half_kelly",
  "kelly",
];

export function clampNumber(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** body[key] only when it is a finite number; otherwise the default. */
function numOr(body: Record<string, unknown>, key: string, def: number): number {
  const v = body[key];
  return typeof v === "number" ? v : def;
}

/** Trade-execution limits shared by both endpoints (clamped, defaults applied). */
export type TradeLimits = {
  minConfidence: number;
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxHoldCandles: number;
  positionSizing: PositionSizing;
  fixedFractionalPct: number;
  feeBps: number;
};

export function parseTradeLimits(body: Record<string, unknown>): TradeLimits {
  return {
    minConfidence: clampNumber(numOr(body, "minConfidence", 60), 10, 100),
    initialCapital: clampNumber(
      numOr(body, "initialCapital", 10_000),
      100,
      1_000_000_000,
    ),
    stopLossPct: clampNumber(numOr(body, "stopLossPct", 5), 0.1, 50),
    takeProfitPct: clampNumber(numOr(body, "takeProfitPct", 10), 0.1, 200),
    maxHoldCandles: clampNumber(numOr(body, "maxHoldCandles", 50), 1, 500),
    positionSizing:
      typeof body.positionSizing === "string" &&
      VALID_SIZING.includes(body.positionSizing as PositionSizing)
        ? (body.positionSizing as PositionSizing)
        : "full",
    fixedFractionalPct: clampNumber(
      numOr(body, "fixedFractionalPct", 25),
      1,
      100,
    ),
    feeBps: clampNumber(numOr(body, "feeBps", 10), 0, 500),
  };
}

export type StrategyResolution =
  | {
      ok: true;
      /** Strategy object for the engine (predefined or converted custom). */
      strategyRef: Strategy;
      /** Resolved id to echo back in the `strategy` response field. */
      strategyId: string;
      /** Resolved display name (an i18n key for predefined strategies). */
      strategyName: string;
      action: StrategyAction;
    }
  | { ok: false; error: string };

/**
 * Resolve the request's strategy: a predefined one by `strategyId`, or a
 * custom strategy from the builder via `customStrategy`. The custom shape is
 * validated item by item — malformed conditions (null entries, missing
 * types) are rejected with a 400 instead of crashing into a 500.
 */
export function resolveStrategy(
  body: Record<string, unknown>,
): StrategyResolution {
  const strategyId = typeof body.strategyId === "string" ? body.strategyId : null;
  const customStrategyRaw = body.customStrategy;

  if (strategyId) {
    const predefined = STRATEGY_LIST.find((s) => s.id === strategyId);
    if (!predefined) {
      return { ok: false, error: `Unknown predefined strategy: ${strategyId}` };
    }
    return {
      ok: true,
      strategyRef: predefined,
      strategyId: predefined.id,
      strategyName: predefined.name,
      action: predefined.targetAction,
    };
  }

  if (
    customStrategyRaw &&
    typeof customStrategyRaw === "object" &&
    !Array.isArray(customStrategyRaw)
  ) {
    const parsed = parseCustomStrategy(customStrategyRaw as Record<string, unknown>);
    if (!parsed.ok) {
      return { ok: false, error: "Invalid custom strategy shape." };
    }
    const { strategy: custom } = parsed;
    return {
      ok: true,
      strategyRef: customStrategyToStrategy(custom),
      strategyId: custom.id,
      strategyName: custom.name,
      action: custom.action,
    };
  }

  return {
    ok: false,
    error: "Missing strategy: provide either strategyId or customStrategy.",
  };
}

export type CustomStrategyParse =
  | { ok: true; strategy: CustomStrategy }
  | { ok: false };

/**
 * Parse and validate a custom strategy object: every condition must be a
 * non-null object with a known-typed `type` field; invalid entries are
 * dropped, and a strategy with no valid conditions at all is rejected.
 */
export function parseCustomStrategy(
  s: Record<string, unknown>,
): CustomStrategyParse {
  if (
    typeof s.id !== "string" ||
    typeof s.name !== "string" ||
    typeof s.action !== "string" ||
    !VALID_ACTIONS.includes(s.action as StrategyAction) ||
    !Array.isArray(s.conditions)
  ) {
    return { ok: false };
  }

  const conditions: CustomStrategy["conditions"] = [];
  for (const c of s.conditions as unknown[]) {
    if (c == null || typeof c !== "object" || Array.isArray(c)) continue;
    const obj = c as Record<string, unknown>;
    if (typeof obj.type !== "string") continue;
    const cond: { type: ConditionType; threshold?: number } = {
      type: obj.type as ConditionType,
    };
    if (typeof obj.threshold === "number") cond.threshold = obj.threshold;
    conditions.push(cond);
  }
  if (conditions.length === 0) return { ok: false };

  return {
    ok: true,
    strategy: {
      id: s.id,
      name: s.name,
      action: s.action as StrategyAction,
      conditions,
      createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
    },
  };
}
