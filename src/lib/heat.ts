/**
 * Maps a relative intensity (0–1, share of the top country's probability)
 * to a fill: land → ember → deep ember. The square root lifts the long
 * tail so runner-up countries stay visible next to a dominant answer.
 */
export function heat(t: number): string {
  if (t < 0.01) return "var(--land)";
  const s = Math.sqrt(Math.min(1, t));
  if (s < 0.6) {
    const mix = Math.round(12 + (s / 0.6) * 88);
    return `color-mix(in oklch, var(--ember) ${mix}%, var(--land))`;
  }
  const mix = Math.round(((s - 0.6) / 0.4) * 75);
  return `color-mix(in oklch, var(--ember-deep) ${mix}%, var(--ember))`;
}

export function formatPercent(p: number): string {
  if (p >= 0.995) return "100%";
  if (p >= 0.1) return `${Math.round(p * 100)}%`;
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  return "<1%";
}
