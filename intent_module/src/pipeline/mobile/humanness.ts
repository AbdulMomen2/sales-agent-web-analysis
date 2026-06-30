import { score, weighted_score } from '../shared/saturation.js';
import type { WelfordState } from '../../types/index.js';
import { welfordVariance } from '../shared/welford.js';

export interface MobileHumannessInputs {
  tier0_score: number;
  path_efficiency_variance: number | null;
  pressure_variance: number | null;
  radius_variance: number | null;
  decay_rate_variance: number | null;
}

export interface MobileHumannessWeights {
  tier0: number;
  tier1: number;
  tier2: number;
}

export interface MobileKValues {
  path_efficiency: number;
  pressure: number;
  radius: number;
  decay: number;
}

export function computeMobileHumanness(
  inputs: MobileHumannessInputs,
  weights: MobileHumannessWeights,
  k_values: MobileKValues,
): number {
  return weighted_score([
    { value: inputs.tier0_score, weight: weights.tier0 },
    { value: score(inputs.path_efficiency_variance, k_values.path_efficiency), weight: weights.tier1 },
    { value: score(inputs.pressure_variance, k_values.pressure), weight: weights.tier2 },
    { value: score(inputs.radius_variance, k_values.radius), weight: weights.tier2 },
    { value: score(inputs.decay_rate_variance, k_values.decay), weight: weights.tier1 },
  ]);
}

export function sessionToMobileHumannessInputs(
  tier0_score: number,
  welford_path_efficiency: WelfordState | null,
  welford_pressure: WelfordState | null,
  welford_radius: WelfordState | null,
  welford_decay_rate: WelfordState | null,
  minPathEfficiencyN: number,
  minPressureN: number,
  minRadiusN: number,
  minDecayRateN: number,
): MobileHumannessInputs {
  return {
    tier0_score,
    path_efficiency_variance: welfordVariance(welford_path_efficiency, minPathEfficiencyN),
    pressure_variance: welfordVariance(welford_pressure, minPressureN),
    radius_variance: welfordVariance(welford_radius, minRadiusN),
    decay_rate_variance: welfordVariance(welford_decay_rate, minDecayRateN),
  };
}
