/**
 * DecisionSource — the pluggable interface the bot engine asks for a
 * buy/short/hold call. `consensusDecisionSource` (the only implementation
 * today) wraps the existing strategy consensus engine (`computeConsensus`).
 * A future TypeSafe/Jev-backed source can implement the same interface
 * without any change to `src/lib/bot/engine.ts`.
 */

import { computeConsensus, type ConsensusLevel } from "@/lib/consensus";
import type { AnalysisResponse } from "@/lib/types";

export type BotAction = "BUY" | "SHORT" | "HOLD";

export type Decision = {
  action: BotAction;
  /** 0-100. */
  confidence: number;
  /** Human-readable label for the trade record, e.g. the consensus level. */
  label: string;
};

export interface DecisionSource {
  id: string;
  decide(analysis: AnalysisResponse): Decision;
}

const LEVEL_TO_ACTION: Record<ConsensusLevel, BotAction> = {
  strong_buy: "BUY",
  buy: "BUY",
  mixed: "HOLD",
  short: "SHORT",
  strong_short: "SHORT",
};

export const consensusDecisionSource: DecisionSource = {
  id: "consensus",
  decide(analysis) {
    const consensus = computeConsensus(analysis);
    return {
      action: LEVEL_TO_ACTION[consensus.level],
      confidence: consensus.avgConfidence,
      label: consensus.level,
    };
  },
};

/** Single extension point — swap this to plug in a different decision engine. */
export function getDecisionSource(): DecisionSource {
  return consensusDecisionSource;
}
