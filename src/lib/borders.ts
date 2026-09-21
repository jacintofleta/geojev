// Shared by the app and scripts/build-geo.mjs, so it only imports types.
import type { MultiPolygon, Polygon, Position } from "geojson";

type Limit = {
  /** Latitude south of which the country's shapes are cut off. */
  lat: number;
  /** Names for what's left of regions that mostly lay beyond the cut. */
  renames: Record<string, string>;
};

/**
 * Countries whose official shapes reach into territory the world map shows
 * on its own. Morocco's regions cover Western Sahara, whose border with
 * Morocco is the 27°40′N parallel. What's left of Laâyoune-Sakia El Hamra
 * north of it is the Tarfaya strip.
 */
export const SOUTH_LIMITS: Record<string, Limit> = {
  MAR: { lat: 27 + 40 / 60, renames: { "Laâyoune-Sakia El Hamra": "Tarfaya" } },
};

// Regions keeping less of their area than this are part of the territory
// beyond the cut, and are dropped rather than left as slivers.
const MIN_SHARE = 0.1;

// Spacing of points added along the cut, in degrees, so it stays on the
// parallel instead of bowing along a great circle.
const STEP = 0.1;

/** Keeps the part of a ring north of `lat` (Sutherland–Hodgman). */
function clipRing(ring: Position[], lat: number): Position[] {
  const out: Position[] = [];
  const push = (p: Position) => {
    const prev = out[out.length - 1];
    if (prev && prev[1] === lat && p[1] === lat) {
      const n = Math.floor(Math.abs(p[0] - prev[0]) / STEP);
      for (let i = 1; i < n; i++) out.push([prev[0] + ((p[0] - prev[0]) * i) / n, lat]);
    }
    out.push(p);
  };
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a[1] >= lat) push(a);
    if (a[1] >= lat !== b[1] >= lat) {
      push([a[0] + ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]), lat]);
    }
  }
  if (out.length < 3) return [];
  // Close the ring; push() densifies the closing edge if it runs along the cut.
  push(out[0]);
  return out;
}

/** The part of a geometry north of `lat`, or null if nothing is left. */
export function keepNorthOf(
  geometry: Polygon | MultiPolygon,
  lat: number,
): Polygon | MultiPolygon | null {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const clipped: Position[][][] = [];
  for (const [outer, ...holes] of polygons) {
    const ring = clipRing(outer, lat);
    if (ring.length === 0) continue;
    clipped.push([ring, ...holes.map((hole) => clipRing(hole, lat)).filter((h) => h.length > 0)]);
  }
  if (clipped.length === 0) return null;
  return clipped.length === 1
    ? { type: "Polygon", coordinates: clipped[0] }
    : { type: "MultiPolygon", coordinates: clipped };
}

/** Outer-ring area in square degrees, whichever way the rings wind. */
function area(geometry: Polygon | MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let sum = 0;
  for (const [ring] of polygons) {
    let twice = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    sum += Math.abs(twice) / 2;
  }
  return sum;
}

/**
 * Cuts a region to its country's limit. Returns null for regions that lie
 * (mostly) beyond it, and renames what's left of the ones listed in `renames`.
 */
export function trimRegion(
  iso3: string,
  name: string | undefined,
  geometry: Polygon | MultiPolygon,
): { name: string | undefined; geometry: Polygon | MultiPolygon } | null {
  const limit = SOUTH_LIMITS[iso3];
  if (!limit) return { name, geometry };
  const kept = keepNorthOf(geometry, limit.lat);
  if (!kept) return null;
  const rename = name ? limit.renames[name.trim()] : undefined;
  if (rename) return { name: rename, geometry: kept };
  return area(kept) >= area(geometry) * MIN_SHARE ? { name, geometry: kept } : null;
}
