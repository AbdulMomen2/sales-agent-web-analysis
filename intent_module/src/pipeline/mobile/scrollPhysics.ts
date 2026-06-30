export interface FlingResult {
  decay_rate: number | null;
  r_squared: number | null;
}

function velocity(y1: number, y2: number, t1: number, t2: number): number {
  const dt = t2 - t1;
  if (dt <= 0) return 0;
  return Math.abs(y2 - y1) / dt;
}

export function fitFling(
  scrollEvents: { t: number; scroll_y: number }[],
  minSamples: number,
  minRSquared: number,
): FlingResult {
  if (scrollEvents.length < minSamples) return { decay_rate: null, r_squared: null };

  const vel: number[] = [];
  for (let i = 0; i < scrollEvents.length - 1; i++) {
    vel.push(velocity(
      scrollEvents[i].scroll_y,
      scrollEvents[i + 1].scroll_y,
      scrollEvents[i].t,
      scrollEvents[i + 1].t,
    ));
  }

  if (vel.length < minSamples) return { decay_rate: null, r_squared: null };

  // Truncate at first velocity increase (deceleration ended)
  let truncateAt = vel.length;
  for (let i = 0; i < vel.length - 1; i++) {
    if (vel[i + 1] >= vel[i]) {
      truncateAt = i + 1;
      break;
    }
  }
  if (truncateAt < minSamples) return { decay_rate: null, r_squared: null };

  const effectiveVel = vel.slice(0, truncateAt);
  const effectiveEvents = scrollEvents.slice(0, truncateAt);

  // Log-linear regression: ln(v) = a + b * t
  const n = effectiveEvents.length;
  const t0 = effectiveEvents[0].t;

  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = effectiveEvents[i].t - t0;
    const yi = Math.log(effectiveVel[i]);
    if (!isFinite(yi)) continue;
    x.push(xi);
    y.push(yi);
  }

  if (x.length < minSamples) return { decay_rate: null, r_squared: null };
  const m = x.length;

  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i], 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);

  const b = (m * sumXY - sumX * sumY) / (m * sumX2 - sumX * sumX);
  const a = (sumY - b * sumX) / m;

  const decay_rate = -b;

  if (decay_rate <= 0) return { decay_rate: null, r_squared: null };

  // Compute R-squared
  const yMean = sumY / m;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < m; i++) {
    const yPred = a + b * x[i];
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - yPred) ** 2;
  }
  const r_squared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  if (r_squared < minRSquared) return { decay_rate: null, r_squared: null };

  return { decay_rate, r_squared };
}
