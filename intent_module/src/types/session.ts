import type { ClientMeta, Source, ElementInfo, ReplayEvent, DOMMutationRecord } from './events.js';
import type { TargetRect, TimedPoint, SinglePoint } from './geometry.js';

export interface WelfordState {
  n: number;
  mean: number;
  M2: number;
}

export interface HysteresisState {
  ema_value: number;
  above_threshold_since: number | null;
  last_trigger: boolean;
}

export interface FittsPair {
  fitts_x: number;
  fitts_y: number;
}

export type ContactType = 'tap' | 'long_press' | 'drag' | 'pinch_zoom';

export interface SessionMeta extends ClientMeta {
  tier0_score: number;
}

export interface DesktopSessionData {
  curve_buffer: TimedPoint[];
  welford_E: WelfordState | null;
  welford_R: WelfordState | null;
  welford_jerk: WelfordState | null;
}

export interface MobileSessionData {
  current_touch_buffer: TimedPoint[];
  gesture_buffer: SinglePoint[][];
  scroll_event_buffer: Array<{ t: number; scroll_y: number }>;
  welford_path_efficiency: WelfordState | null;
  welford_pressure: WelfordState | null;
  welford_radius: WelfordState | null;
  welford_decay_rate: WelfordState | null;
  pressure_quirk_checked: boolean;
}

export interface SalesIntentState {
  ctaHoverCount: number;
  longHoverCount: number;
  productHovers: number;
  cartActions: number;
  priceInteractions: number;
  purchaseCtasSeen: number;
  numHesitations: number;
  maxScrollPercent: number;
  totalTicks: number;
  focusAreas: Record<string, number>;
}

export interface SalesIntentMetrics {
  engagement_score: number;
  purchase_intent_proxy: number;
  friction_indicator: number;
  main_focus_area: string | null;
  num_hesitations: number;
  max_scroll_percent: number;
}

export interface SharedSessionData {
  meta: SessionMeta | null;
  session_start_t: number;
  pricing_rect: TargetRect | null;
  viewport_height: number;
  scroll_y: number;
  scroll_y_history: number[];
  hover_pricing_entered_at: number | null;
  pricing_section_entered_at: number | null;
  pricing_cta_clicked: boolean;
  pinch_zoom_triggered: boolean;
  last_interaction_t: number;
  last_pointer_pos: SinglePoint | null;
  active_signals: string[];
  hysteresis: HysteresisState | null;
  mixed_input: boolean;
  dom_snapshot?: { html: string; css: string } | null;
  dom_mutations?: DOMMutationRecord[];
  last_element_info?: ElementInfo | null;
  replay_buffer?: ReplayEvent[];
  sales_intent_state?: SalesIntentState | null;
  fitts_pairs: FittsPair[];
}

export interface SessionState extends SharedSessionData {
  desktop: DesktopSessionData | null;
  mobile: MobileSessionData | null;
}

export function defaultWelfordState(): WelfordState {
  return { n: 0, mean: 0, M2: 0 };
}

export function defaultHysteresisState(): HysteresisState {
  return { ema_value: 0, above_threshold_since: null, last_trigger: false };
}

export function defaultDesktopData(): DesktopSessionData {
  return {
    curve_buffer: [],
    welford_E: defaultWelfordState(),
    welford_R: defaultWelfordState(),
    welford_jerk: defaultWelfordState(),
  };
}

export function defaultMobileData(): MobileSessionData {
  return {
    current_touch_buffer: [],
    gesture_buffer: [],
    scroll_event_buffer: [],
    welford_path_efficiency: defaultWelfordState(),
    welford_pressure: defaultWelfordState(),
    welford_radius: defaultWelfordState(),
    welford_decay_rate: defaultWelfordState(),
    pressure_quirk_checked: false,
  };
}

export function defaultSharedData(): SharedSessionData {
  return {
    meta: null,
    session_start_t: Date.now(),
    pricing_rect: null,
    viewport_height: 0,
    scroll_y: 0,
    scroll_y_history: [],
    hover_pricing_entered_at: null,
    pricing_section_entered_at: null,
    pricing_cta_clicked: false,
    pinch_zoom_triggered: false,
    last_interaction_t: Date.now(),
    last_pointer_pos: null,
    active_signals: [],
    hysteresis: defaultHysteresisState(),
    mixed_input: false,
    fitts_pairs: [],
  };
}


