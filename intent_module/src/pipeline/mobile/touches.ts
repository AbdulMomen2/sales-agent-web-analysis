import type { TimedPoint, ContactType } from '../../types/index.js';

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ─── Touch segmentation ──────────────────────────────────────

export interface TouchSegment {
  points: TimedPoint[];
  start_t: number;
  end_t: number;
  contact_type: ContactType;
  duration_ms: number;
  displacement: number;
  path_length: number;
}

export function classifyTouch(
  points: TimedPoint[],
  start_t: number,
  end_t: number,
  tapMaxDurationMs: number,
  tapMaxDisplacementPx: number,
  longPressMinDurationMs: number,
): TouchSegment | null {
  if (points.length < 2) return null;

  const duration_ms = end_t - start_t;
  const first = points[0];
  const last = points[points.length - 1];
  const displacement = dist(first, last);

  let path_length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    path_length += dist(points[i], points[i + 1]);
  }

  let contact_type: ContactType;
  if (duration_ms < tapMaxDurationMs && displacement < tapMaxDisplacementPx) {
    contact_type = 'tap';
  } else if (duration_ms > longPressMinDurationMs && displacement < tapMaxDisplacementPx) {
    contact_type = 'long_press';
  } else {
    contact_type = 'drag';
  }

  return { points, start_t, end_t, contact_type, duration_ms, displacement, path_length };
}

// ─── Touch feature extraction ────────────────────────────────

export interface TouchFeatures {
  path_efficiency: number | null;
  peak_velocity: number | null;
  pressure_mean: number | null;
  radius_mean: number | null;
}

export function extractTouchFeatures(segment: TouchSegment, minPathForEfficiencyPx: number): TouchFeatures {
  const points = segment.points;
  const { path_length } = segment;

  let path_efficiency: number | null = null;
  if (path_length > minPathForEfficiencyPx) {
    const displacement = dist(points[0], points[points.length - 1]);
    path_efficiency = displacement / path_length;
  }

  let peak_velocity: number | null = null;
  if (points.length >= 2) {
    for (let i = 0; i < points.length - 1; i++) {
      const dt = points[i + 1].t - points[i].t;
      if (dt === 0) continue;
      const v = dist(points[i], points[i + 1]) / dt;
      if (peak_velocity === null || v > peak_velocity) peak_velocity = v;
    }
  }

  let pressure_mean: number | null = null;
  const pressures = points
    .map((p) => p.pressure)
    .filter((p): p is number => p !== undefined && p > 0);
  if (pressures.length > 0) {
    pressure_mean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
  }

  let radius_mean: number | null = null;
  const radii = points
    .map((p) => {
      if (p.radius_x !== undefined && p.radius_y !== undefined) {
        return Math.sqrt(p.radius_x * p.radius_y);
      }
      return undefined;
    })
    .filter((r): r is number => r !== undefined && r > 0);
  if (radii.length > 0) {
    radius_mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  }

  return { path_efficiency, peak_velocity, pressure_mean, radius_mean };
}
