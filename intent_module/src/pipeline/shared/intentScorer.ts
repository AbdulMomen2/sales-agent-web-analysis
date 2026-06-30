import type { LRTable } from '../../config/signals.js';

export interface IntentScorerInput {
  signals: string[];
  lrTable: LRTable;
  p0: number;
}

export function computeIntentProbability(input: IntentScorerInput): number {
  const priorOdds = input.p0 / (1 - input.p0);
  let logOdds = Math.log(priorOdds);

  for (const signal of input.signals) {
    const lr = input.lrTable[signal];
    if (lr !== undefined && lr > 0) {
      logOdds += Math.log(lr);
    }
  }

  return 1 / (1 + Math.exp(-logOdds));
}
