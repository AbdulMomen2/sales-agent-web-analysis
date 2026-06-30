import type { HysteresisState } from '../../types/index.js';

export interface HysteresisConfig {
  ema_half_life_seconds: number;
  tick_interval_seconds: number;
  trigger_threshold: number;
  trigger_sustain_seconds: number;
}

export interface HysteresisResult {
  state: HysteresisState;
  trigger: boolean;
}

export function updateHysteresis(
  prev: HysteresisState | null,
  intentProbability: number,
  now: number,
  config: HysteresisConfig,
): HysteresisResult {
  const alpha = 2 / (config.ema_half_life_seconds / config.tick_interval_seconds + 1);

  let emaValue: number;
  let aboveThresholdSince = prev?.above_threshold_since ?? null;

  if (prev === null || prev.ema_value === 0) {
    // First tick for session — no blend (§6.9)
    emaValue = intentProbability;
  } else {
    emaValue = alpha * intentProbability + (1 - alpha) * prev.ema_value;
  }

  if (emaValue >= config.trigger_threshold) {
    if (aboveThresholdSince === null) {
      aboveThresholdSince = now;
    }
  } else {
    aboveThresholdSince = null;
  }

  const sustained = aboveThresholdSince !== null
    ? (now - aboveThresholdSince) / 1000
    : 0;
  const trigger = sustained >= config.trigger_sustain_seconds;
  const lastTrigger = prev?.last_trigger ?? false;

  return {
    state: {
      ema_value: emaValue,
      above_threshold_since: aboveThresholdSince,
      last_trigger: trigger,
    },
    trigger: trigger !== lastTrigger ? trigger : false,
  };
}
