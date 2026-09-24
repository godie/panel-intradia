/**
 * Consensus — runs every predefined strategy against one analysis payload and
 * summarises the agreement.
 *
 * Extracted from `strategy-consensus.tsx` so the card and the comparison page
 * share one source of truth (the thresholds used to live inline in the
 * component).
 *
 * Seven built-in strategies: three targeting BUY (trend_buy,
 * mean_reversion_buy, breakout_buy), three targeting SHORT (trend_short,
 * mean_reversion_short, breakout_short) and one HOLD. Every consensus level is
 * therefore reachable — `strong_buy` needs the three BUY strategies to clear
 * the threshold with no SHORT vote, `strong_short` the mirror image.
 */

import {
  STRATEGY_LIST,
  evaluateStrategy,
  type Strategy,
  type StrategyAction,
  type StrategyResult,
} from "./strategies";
import type { AnalysisResponse } from "./types";

export type ConsensusLevel =
  | "strong_buy"
  | "buy"
  | "mixed"
  | "short"
  | "strong_short";

/** Weight per action, used to place the consensus on a -100..100 scale. */
const ACTION_WEIGHT: Record<StrategyAction, number> = {
  BUY: 2,
  SHORT: -2,
  HOLD: 0,
  WAIT: 0,
};

export type ConsensusResult = {
  level: ConsensusLevel;
  /** How many strategies landed on each action. */
  votes: Record<StrategyAction, number>;
  /** Mean confidence across all strategies, 0-100. */
  avgConfidence: number;
  /** Weighted score, clamped to -100 (all short) .. +100 (all buy). */
  scorePct: number;
  /** Per-strategy detail; `strategy` is the definition that produced it. */
  results: (StrategyResult & { strategy: Strategy })[];
};

export function computeConsensus(data: AnalysisResponse): ConsensusResult {
  const results = STRATEGY_LIST.map((s) => ({
    ...evaluateStrategy(s, data),
    strategy: s,
  }));

  const votes: Record<StrategyAction, number> = {
    BUY: 0,
    SHORT: 0,
    HOLD: 0,
    WAIT: 0,
  };
  let totalConfidence = 0;
  let weightedScore = 0;

  for (const r of results) {
    votes[r.action]++;
    totalConfidence += r.confidence;
    weightedScore += ACTION_WEIGHT[r.action] * (r.confidence / 100);
  }

  let level: ConsensusLevel;
  if (votes.BUY >= 3 && votes.SHORT === 0) level = "strong_buy";
  else if (votes.BUY >= 2 && votes.SHORT === 0) level = "buy";
  else if (votes.SHORT >= 3 && votes.BUY === 0) level = "strong_short";
  else if (votes.SHORT >= 2 && votes.BUY === 0) level = "short";
  else level = "mixed";

  const avgConfidence = Math.round(totalConfidence / results.length);
  const scorePct = Math.max(
    -100,
    Math.min(100, Math.round((weightedScore / results.length) * 50)),
  );

  return { level, votes, avgConfidence, scorePct, results };
}
