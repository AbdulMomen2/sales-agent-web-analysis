import type { WelfordState } from '../../types/index.js';
import { score, corr_score, weighted_score } from '../shared/saturation.js';
import { welfordVariance } from '../shared/welford.js';

export interface DesktopHumannessInputs {
  tier0_score: number;
  E_session_variance: number | null;
  R_session_variance: number | null;
  fitts_correlation: number | null;
}

export interface DesktopHumannessWeights {
  tier0: number;
  tier1: number;
  fitts: number;
}

export interface DesktopKValues {
  E: number;
  R: number;
  jerk: number;
}

export function computeHumanness(
  inputs: DesktopHumannessInputs,
  weights: DesktopHumannessWeights,
  k_values: DesktopKValues,
  fittsCorrScale: number,
): number {
  return weighted_score([
    { value: inputs.tier0_score, weight: weights.tier0 },
    { value: score(inputs.E_session_variance, k_values.E), weight: weights.tier1 },
    { value: score(inputs.R_session_variance, k_values.R), weight: weights.tier1 },
    { value: corr_score(inputs.fitts_correlation, fittsCorrScale), weight: weights.fitts },
  ]);
}

export function sessionToHumannessInputs(
  tier0_score: number,
  welford_E: WelfordState | null,
  welford_R: WelfordState | null,
  fitts_correlation: number | null,
  minCurvesForVariance: number,
): DesktopHumannessInputs {
  return {
    tier0_score,
    E_session_variance: welfordVariance(welford_E, minCurvesForVariance),
    R_session_variance: welfordVariance(welford_R, minCurvesForVariance),
    fitts_correlation,
  };
}
