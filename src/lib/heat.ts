// Probabilities under this stay unshaded; weak associations are mostly noise.
const FLOOR = 0.2;

/** Maps a country's probability (0–1) to a shading intensity (0–1). */
export function intensity(p: number): number {
  return Math.min(1, Math.max(0, (p - FLOOR) / (0.95 - FLOOR)));
}

/** Maps an intensity (0–1) to a fill: land → ember → deep ember. */
export function heat(t: number): string {
  if (t <= 0) return "var(--land)";
  if (t < 0.6) {
    const mix = Math.round(12 + (t / 0.6) * 88);
    return `color-mix(in oklch, var(--ember) ${mix}%, var(--land))`;
  }
  const mix = Math.round(((t - 0.6) / 0.4) * 75);
  return `color-mix(in oklch, var(--ember-deep) ${mix}%, var(--ember))`;
}

export function formatPercent(p: number): string {
  if (p >= 0.995) return "100%";
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  return "<1%";
}
