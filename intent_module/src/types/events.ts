import type { SinglePoint, TargetRect } from './geometry.js';

export interface ElementInfo {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  selector: string;
  rect: TargetRect | null;
  attributes: Record<string, string>;
}

export interface ReplayEvent {
  t: number;
  type: string;
  x?: number;
  y?: number;
  scroll_y?: number;
  tag?: string;
  selector?: string;
  text?: string;
  intent_p?: number;
}

export interface DOMMutationRecord {
  type: 'childList' | 'attributes' | 'characterData';
  target?: string;
  addedNodes?: string[];
  removedNodes?: string[];
  attributeName?: string;
  attributeValue?: string | null;
  textContent?: string;
}

export type ClientEvent =
  | { type: 'pointer_move' | 'pointer_down'; t: number; point: SinglePoint; target?: TargetRect; element?: ElementInfo | null }
  | { type: 'touch_start' | 'touch_move' | 'touch_end'; t: number; touches: SinglePoint[]; target?: TargetRect; element?: ElementInfo | null }
  | { type: 'scroll'; t: number; scroll_y: number }
  | { type: 'visibility_change'; t: number; visible: boolean }
  | { type: 'orientation_change'; t: number }
  | { type: 'dom_snapshot'; t: number; html: string; css: string }
  | { type: 'dom_snapshot_chunk'; t: number; index: number; total: number; part?: string; html?: string; css_chunk?: string }
  | { type: 'dom_snapshot_complete'; t: number; htmlTotal?: number; cssTotal?: number }
  | { type: 'dom_mutation'; t: number; mutations: DOMMutationRecord[] }
  | { type: 'heartbeat'; t: number };

export interface ClientBatch {
  session_id: string;
  website_id?: string;
  events: ClientEvent[];
}

export type Source = 'mouse' | 'touch';

export interface ClientMeta {
  session_id: string;
  website_id?: string;
  domain?: string;
  navigator_webdriver: boolean;
  plugins_count: number;
  languages: string[];
  webgl_renderer: string;
  source: Source;
  screen_width?: number;
  screen_height?: number;
  timezone?: string;
}

export interface ViewportInfo {
  session_id: string;
  t: number;
  pricing_rect: TargetRect | null;
  viewport_height: number;
  scroll_y: number;
}

export interface ServerTick {
  session_id: string;
  t: number;
  intent_probability: number;
  intent_ema: number;
  humanness_factor: number;
  trigger: boolean;
  signals?: string[];
  trigger_threshold?: number;
  p0?: number;
  ema_half_life_seconds?: number;
}
