import type { TimedPoint } from '../../types/index.js';

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ─── Curve segmentation ──────────────────────────────────────

export interface SegmentationResult {
  finalized: TimedPoint[][];
  remaining: TimedPoint[];
}

export function finalizeCurves(
  buffer: TimedPoint[],
  now: number,
  maxGapMs: number,
  maxCurveDurationMs: number,
): SegmentationResult {
  if (buffer.length === 0) return { finalized: [], remaining: [] };

  const curves: TimedPoint[][] = [];
  let start = 0;

  for (let i = 1; i < buffer.length; i++) {
    const lastT = buffer[i - 1].t;
    const currT = buffer[i].t;
    if (currT - lastT > maxGapMs) {
      const curve = buffer.slice(start, i);
      if (curve.length >= 2) curves.push(curve);
      start = i;
    }
  }

  const remainingStartT = buffer[start].t;
  if (remainingStartT > 0 && now - remainingStartT > maxCurveDurationMs) {
    const curve = buffer.slice(start);
    if (curve.length >= 2) curves.push(curve);
    return { finalized: curves, remaining: [] };
  }

  return { finalized: curves, remaining: buffer.slice(start) };
}

// ─── Curve feature extraction ────────────────────────────────

export interface CurveFeatures {
  E: number | null;
  R: number | null;
  jerk_variance: number | null;
}

export function extractCurveFeatures(
  curve: TimedPoint[],
  minPathLengthPx: number,
  minPointsForJerk: number,
): CurveFeatures {
  if (curve.length < 2) return { E: null, R: null, jerk_variance: null };

  let pathLength = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    pathLength += dist(curve[i], curve[i + 1]);
  }

  const displacement = dist(curve[0], curve[curve.length - 1]);
  if (pathLength < minPathLengthPx) return { E: null, R: null, jerk_variance: null };

  const E = displacement / pathLength;

  let R: number | null = null;
  if (curve.length >= 3) {
    let reversals = 0;
    for (let i = 0; i < curve.length - 2; i++) {
      const vx1 = curve[i + 1].x - curve[i].x;
      const vy1 = curve[i + 1].y - curve[i].y;
      const vx2 = curve[i + 2].x - curve[i + 1].x;
      const vy2 = curve[i + 2].y - curve[i + 1].y;
      if (Math.sign(vx1) !== 0 && Math.sign(vx2) !== 0 && Math.sign(vx1) !== Math.sign(vx2)) reversals++;
      if (Math.sign(vy1) !== 0 && Math.sign(vy2) !== 0 && Math.sign(vy1) !== Math.sign(vy2)) reversals++;
    }
    R = reversals;
  }

  let jerk_variance: number | null = null;
  if (curve.length >= minPointsForJerk) {
    const v: { x: number; y: number }[] = [];
    for (let i = 0; i < curve.length - 1; i++) {
      const dt = curve[i + 1].t - curve[i].t;
      if (dt === 0) continue;
      v.push({ x: (curve[i + 1].x - curve[i].x) / dt, y: (curve[i + 1].y - curve[i].y) / dt });
    }

    if (v.length >= 2) {
      const a: { x: number; y: number }[] = [];
      for (let i = 0; i < v.length - 1; i++) {
        const dt = curve[i + 2].t - curve[i + 1].t;
        if (dt === 0) continue;
        a.push({ x: (v[i + 1].x - v[i].x) / dt, y: (v[i + 1].y - v[i].y) / dt });
      }

      if (a.length >= 2) {
        const j: { x: number; y: number }[] = [];
        for (let i = 0; i < a.length - 1; i++) {
          const dt = curve[i + 3].t - curve[i + 2].t;
          if (dt === 0) continue;
          j.push({ x: (a[i + 1].x - a[i].x) / dt, y: (a[i + 1].y - a[i].y) / dt });
        }

        if (j.length >= 2) {
          const jxMean = j.reduce((s, p) => s + p.x, 0) / j.length;
          const jyMean = j.reduce((s, p) => s + p.y, 0) / j.length;
          const jxVar = j.reduce((s, p) => s + (p.x - jxMean) ** 2, 0) / (j.length - 1);
          const jyVar = j.reduce((s, p) => s + (p.y - jyMean) ** 2, 0) / (j.length - 1);
          jerk_variance = jxVar + jyVar;
        }
      }
    }
  }

  return { E, R, jerk_variance };
}
