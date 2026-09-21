/** One shape on a map: a country on the world map, or a region inside a country. */
export type GeoFeature = {
  /** Unique within its map; the key for probabilities. */
  id: string;
  name: string;
  /** Extra context shown next to the name, e.g. the region's parent. */
  detail?: string;
  /** SVG path in map units. */
  d: string;
  /** Label anchor on the main landmass. */
  cx: number;
  cy: number;
  /** Bounds of the main landmass, [x0, y0, x1, y1]. */
  box: number[];
  /** Projected area in map units², used to give tiny shapes a dot. */
  area: number;
};

/** A projected map ready to draw. */
export type GeoMap = {
  width: number;
  height: number;
  /** View to frame when nothing is highlighted, [x, y, w, h]. Defaults to the whole map. */
  home?: number[];
  /** Outline of the globe, for the world map only. */
  sphere?: string;
  graticule?: string;
  features: GeoFeature[];
};

/** What a query is asked about: the whole world, or one level of a country's regions. */
export type Scope = { iso3: string; country: string; level: string } | null;

export function scopeKey(scope: Scope): string {
  return scope ? `${scope.iso3}/${scope.level}` : "world";
}
