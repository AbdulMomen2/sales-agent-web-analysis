import type { WelfordState } from '../../types/index.js';

export function update(state: WelfordState, x: number): WelfordState {
  const n = state.n + 1;
  const mean = state.mean + (x - state.mean) / n;
  const delta2 = x - mean;
  const M2 = state.M2 + (x - state.mean) * delta2;
  return { n, mean, M2 };
}

export function welfordVariance(state: WelfordState | null, minN: number): number | null {
  return !state || state.n < minN ? null : state.M2 / (state.n - 1);
}
