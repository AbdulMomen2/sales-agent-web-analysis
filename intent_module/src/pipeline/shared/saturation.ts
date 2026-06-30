export function score(v: number | null, k: number): number {
  if (v === null) return 0.5;
  if (v < 0) return 0;
  if (k <= 0) return 1;
  return v / (v + k);
}

export function corr_score(r: number | null, scale: number): number {
  if (r === null) return 0.5;
  return 1 / (1 + Math.exp(-r / scale));
}

export function weighted_score(
  inputs: { value: number | null; weight: number }[],
  fallback = 0.5,
): number {
  let sum = 0;
  let weightSum = 0;
  for (const { value, weight } of inputs) {
    if (value !== null && weight > 0) {
      sum += value * weight;
      weightSum += weight;
    }
  }
  if (weightSum === 0) return fallback;
  return sum / weightSum;
}
