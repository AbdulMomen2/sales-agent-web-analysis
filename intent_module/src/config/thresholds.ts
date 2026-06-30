import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

function loadJson<T>(filename: string): T {
  const path = join(CONFIG_DIR, filename);
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export interface DesktopSignalConfig {
  hover_dwell_ms?: number;
  scroll_reversal_threshold_px?: number;
  scroll_history_min_length?: number;
  E_mean_high_threshold?: number;
  time_on_page_ms?: number;
}

export interface DesktopConfig {
  curve_gap_ms?: number;
  curve_max_duration_ms?: number;
  curve_min_path_length_px?: number;
  curve_min_points_for_jerk?: number;
  humanness_min_curves_for_variance?: number;
  humanness_weights?: Record<string, number>;
  k_values?: Record<string, number>;
  signals?: DesktopSignalConfig;
}

export interface MobileSignalConfig {
  pricing_section_dwell_ms?: number;
  scroll_reversal_threshold_px?: number;
  scroll_history_min_length?: number;
  time_on_page_ms?: number;
}

export interface MobileConfig {
  tap_max_duration_ms?: number;
  tap_max_displacement_px?: number;
  long_press_min_duration_ms?: number;
  pinch_min_distance_change_px?: number;
  touch_min_path_for_efficiency_px?: number;
  humanness_min_path_efficiency_n?: number;
  humanness_min_pressure_n?: number;
  humanness_min_radius_n?: number;
  humanness_min_decay_rate_n?: number;
  humanness_weights?: Record<string, number>;
  k_values?: Record<string, number>;
  fling_min_samples?: number;
  fling_min_r_squared?: number;
  signals?: MobileSignalConfig;
}

export interface Thresholds {
  p0?: number;
  ema_half_life_seconds?: number;
  tick_interval_seconds?: number;
  trigger_threshold?: number;
  trigger_sustain_seconds?: number;
  fitts_min_pairs?: number;
  fitts_corr_scale?: number;
  humanness_min_valid?: number;
  desktop?: DesktopConfig;
  mobile?: MobileConfig;
}

export const thresholds: Thresholds = loadJson<Thresholds>('thresholds.json');

export function getTriggerThreshold(): number {
  const env = process.env.TRIGGER_THRESHOLD;
  if (env !== undefined) { const v = parseFloat(env); if (!isNaN(v) && v > 0) return v; }
  return thresholds.trigger_threshold ?? 0.4;
}

export function getTriggerSustainSeconds(): number {
  const env = process.env.TRIGGER_SUSTAIN_S;
  if (env !== undefined) { const v = parseFloat(env); if (!isNaN(v) && v > 0) return v; }
  return thresholds.trigger_sustain_seconds ?? 2.0;
}

export function getEmaHalfLifeSeconds(): number {
  const env = process.env.EMA_HALF_LIFE_S;
  if (env !== undefined) { const v = parseFloat(env); if (!isNaN(v) && v > 0) return v; }
  return thresholds.ema_half_life_seconds ?? 7;
}


