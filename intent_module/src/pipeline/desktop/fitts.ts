import type { FittsPair, TimedPoint, TargetRect } from '../../types/index.js';

export function computeFittsCorrelation(
  pairs: FittsPair[],
  minPairs: number,
): number | null {
  if (pairs.length < minPairs) return null;

  const n = pairs.length;
  const sumX = pairs.reduce((s, p) => s + p.fitts_x, 0);
  const sumY = pairs.reduce((s, p) => s + p.fitts_y, 0);
  const sumXY = pairs.reduce((s, p) => s + p.fitts_x * p.fitts_y, 0);
  const sumX2 = pairs.reduce((s, p) => s + p.fitts_x ** 2, 0);
  const sumY2 = pairs.reduce((s, p) => s + p.fitts_y ** 2, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt(Math.max(0, (n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2)));
  if (den === 0) return null;

  return num / den;
}
