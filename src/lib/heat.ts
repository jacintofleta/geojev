// Probabilities under this stay unshaded; weak associations are mostly noise.
const FLOOR = 0.2;

/** The two color ramps: ember for an answer (or the first side of a "vs"), tide for its rival. */
export type Hue = "ember" | "tide";

/** Maps a country's probability (0–1) to a shading intensity (0–1). */
export function intensity(p: number): number {
  return Math.min(1, Math.max(0, (p - FLOOR) / (0.95 - FLOOR)));
}

/** Maps an intensity (0–1) to a fill: land → hue → deep hue. */
export function heat(t: number, hue: Hue = "ember"): string {
  if (t <= 0) return "var(--land)";
  if (t < 0.6) {
    const mix = Math.round(12 + (t / 0.6) * 88);
    return `color-mix(in oklch, var(--${hue}) ${mix}%, var(--land))`;
  }
  const mix = Math.round(((t - 0.6) / 0.4) * 75);
  return `color-mix(in oklch, var(--${hue}-deep) ${mix}%, var(--${hue}))`;
}

/**
 * Fill for two answers compared on one map: depth follows the stronger one,
 * hue leans toward whoever is ahead. Where both are strong they meet in purple.
 */
export function versusHeat(a: number, b: number): string {
  const ta = intensity(a);
  const tb = intensity(b);
  const t = Math.max(ta, tb);
  if (t <= 0) return "var(--land)";
  const share = Math.round((ta / (ta + tb)) * 100);
  return `color-mix(in oklch, ${heat(t)} ${share}%, ${heat(t, "tide")})`;
}

export function formatPercent(p: number): string {
  if (p >= 0.995) return "100%";
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  return "<1%";
}
