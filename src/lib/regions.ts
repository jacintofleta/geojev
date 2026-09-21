import "server-only";

import {
  geoArea,
  geoAzimuthalEqualArea,
  geoBounds,
  geoCentroid,
  geoContains,
  geoPath,
} from "d3-geo";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { topology } from "topojson-server";
import {
  filter,
  filterWeight,
  planarRingArea,
  presimplify,
  quantile,
  simplify,
} from "topojson-simplify";
import mainlands from "@/data/mainlands.json";
import { trimRegion } from "@/lib/borders";
import { WORLD } from "@/lib/countries";
import type { GeoFeature, GeoMap } from "@/lib/geo";

// Regions are projected so the country's mainland is this many units wide.
const WIDTH = 1000;
// Points kept after simplification; crisp borders while keeping payloads small.
const MAX_POINTS = 20_000;
// Islands smaller than this share of the country's total area are dropped.
const MIN_RING_SHARE = 2e-5;
// Regions this close to the mainland (as a share of its size) frame the view
// too, so Ceuta, Melilla and the Balearics show up in Spain.
const NEAR_MAINLAND = 0.1;

type Shape = Feature<Polygon | MultiPolygon, { shapeName?: string }>;

export type RegionMap = GeoMap & {
  iso3: string;
  country: string;
  level: string;
};

/** Returns the drillable country and level, or null if it isn't one we support. */
export function findLevel(iso3: string, level: string) {
  const country = WORLD.countries.find((c) => c.iso3 === iso3);
  if (!country?.levels.some((l) => l.level === level)) return null;
  return country;
}

const cache = new Map<string, Promise<RegionMap>>();

/** Loads, simplifies and projects one level of a country's regions (memoized). */
export function getRegions(iso3: string, level: string): Promise<RegionMap> {
  const key = `${iso3}/${level}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = buildRegions(iso3, level);
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

async function fetchBoundaries(iso3: string, level: string): Promise<Shape[]> {
  const meta = await fetch(
    `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/${level}/`,
    { cache: "no-store" },
  );
  if (!meta.ok) throw new Error(`geoBoundaries ${iso3}/${level}: ${meta.status}`);
  const { simplifiedGeometryGeoJSON } = await meta.json();
  const res = await fetch(simplifiedGeometryGeoJSON, { cache: "no-store" });
  if (!res.ok) throw new Error(`geoBoundaries file ${iso3}/${level}: ${res.status}`);
  const collection: FeatureCollection = await res.json();
  return collection.features
    .filter(
      (f): f is Shape =>
        f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon",
    )
    .flatMap((f) => {
      const trimmed = trimRegion(iso3, f.properties?.shapeName, f.geometry);
      if (!trimmed) return [];
      const { name: shapeName, geometry } = trimmed;
      return [rewind({ ...f, geometry, properties: { ...f.properties, shapeName } })];
    });
}

/** Whether a point is on the mainland or just off it. */
function nearMainland(mainland: Polygon, [lon, lat]: [number, number]) {
  if (geoContains(mainland, [lon, lat])) return true;
  const [[x0, y0], [x1, y1]] = geoBounds(mainland);
  // Mainlands that cross the antimeridian only count what's on them.
  if (x0 > x1) return false;
  const pad = Math.max(x1 - x0, y1 - y0) * NEAR_MAINLAND;
  return lon >= x0 - pad && lon <= x1 + pad && lat >= y0 - pad && lat <= y1 + pad;
}

/**
 * geoBoundaries uses GeoJSON's counter-clockwise rings; d3-geo reads those
 * as "everything except this shape". Flip any polygon that covers more than
 * half the globe.
 */
function rewind(f: Shape): Shape {
  const fix = (rings: Position[][]) =>
    geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI
      ? rings.map((ring) => [...ring].reverse())
      : rings;
  const g = f.geometry;
  const geometry: Polygon | MultiPolygon =
    g.type === "Polygon"
      ? { type: "Polygon", coordinates: fix(g.coordinates) }
      : { type: "MultiPolygon", coordinates: g.coordinates.map(fix) };
  return { ...f, geometry };
}

/**
 * Cleans up geoBoundaries names: undoes UTF-8 read as Latin-1 ("RegiÃ³n")
 * and puts trailing articles back in front ("Palmas, Las" → "Las Palmas").
 */
function cleanName<T extends string | undefined>(name: T): T {
  if (!name) return name;
  let clean: string = name;
  if (/[ÃÂ][\u0080-\u00bf]/.test(clean)) {
    clean = new TextDecoder().decode(Uint8Array.from(clean, (c) => c.charCodeAt(0)));
  }
  clean = clean.replace(/^(.+), (La|Las|Le|Les|El|Los|Lo|L'|Il|A|As|O|Os|The)$/i, (_, rest, article) =>
    article.endsWith("'") ? `${article}${rest}` : `${article} ${rest}`,
  );
  return clean as T;
}

/** Area in square degrees, matching topojson-simplify's planar ring weights. */
function planarArea(shape: Shape): number {
  const polygons =
    shape.geometry.type === "Polygon" ? [shape.geometry.coordinates] : shape.geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + planarRingArea(rings[0] as [number, number][]), 0);
}

/** The largest polygon of a shape, so labels and framing ignore small islands. */
function largestPart(f: Shape): Polygon {
  const g = f.geometry;
  if (g.type === "Polygon") return g;
  return g.coordinates
    .map((coordinates): Polygon => ({ type: "Polygon", coordinates }))
    .reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
}

async function buildRegions(iso3: string, level: string): Promise<RegionMap> {
  const country = findLevel(iso3, level);
  if (!country) throw new Error(`Unsupported level ${iso3}/${level}`);

  const [shapes, parents] = await Promise.all([
    fetchBoundaries(iso3, level),
    level === "ADM1" ? Promise.resolve([]) : getRegionsRaw(iso3, "ADM1"),
  ]);

  // Frame the view on regions on or near the mainland; the rest stay reachable by panning.
  const mainland = (mainlands as Record<string, Polygon>)[iso3];
  const centers = shapes.map((s) => geoCentroid(largestPart(s)));
  const onMainland = mainland
    ? shapes.filter((_, i) => nearMainland(mainland, centers[i]))
    : [];
  const frame = onMainland.length > 0 ? onMainland : shapes;
  const frameCollection = { type: "FeatureCollection" as const, features: frame };

  const [lon, lat] = geoCentroid(frameCollection);
  const projection = geoAzimuthalEqualArea()
    .rotate([-lon, -lat])
    .fitWidth(WIDTH, frameCollection);

  // Simplify in lon/lat before projecting.
  const collection: FeatureCollection = { type: "FeatureCollection", features: shapes };
  const topo = presimplify(topology({ regions: collection }) as unknown as Topology<{
    regions: GeometryCollection;
  }>);
  const points = topo.arcs.reduce((n, arc) => n + arc.length, 0);
  const totalArea = shapes.reduce((sum, s) => sum + planarArea(s), 0);
  const reduced = points > MAX_POINTS ? simplify(topo, quantile(topo, MAX_POINTS / points)) : topo;
  const simple = filter(
    reduced,
    filterWeight(reduced, totalArea * MIN_RING_SHARE, planarRingArea),
  );
  const simplified = (
    feature(simple, simple.objects.regions) as unknown as FeatureCollection<Polygon | MultiPolygon>
  ).features;

  // Shift so every region, including far-off ones, has non-negative coordinates.
  const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(collection);
  const [tx, ty] = projection.translate();
  projection.translate([tx - x0, ty - y0]);
  const path = geoPath(projection).digits(2);
  const round = (v: number) => Math.round(v * 100) / 100;

  const features: GeoFeature[] = shapes.map((shape, i) => {
    const main = largestPart(shape);
    const [cx, cy] = path.centroid(main);
    return {
      id: String(i),
      name: cleanName(shape.properties?.shapeName?.trim() || `Region ${i + 1}`),
      detail: cleanName(
        parents.find((p) => geoContains(p, centers[i]))?.properties?.shapeName,
      ),
      d: path(simplified[i]) ?? "",
      cx: round(cx),
      cy: round(cy),
      box: path.bounds(main).flat().map(round),
      area: round(path.area(shape)),
    };
  });

  const [[hx0, hy0], [hx1, hy1]] = path.bounds(frameCollection);
  return {
    iso3,
    country: country.name,
    level,
    width: round(x1 - x0),
    height: round(y1 - y0),
    home: [hx0, hy0, hx1 - hx0, hy1 - hy0].map(round),
    features,
  };
}

const rawCache = new Map<string, Promise<Shape[]>>();

/** Unprojected boundaries, used to find each region's parent. */
function getRegionsRaw(iso3: string, level: string): Promise<Shape[]> {
  const key = `${iso3}/${level}`;
  let pending = rawCache.get(key);
  if (!pending) {
    pending = fetchBoundaries(iso3, level);
    pending.catch(() => rawCache.delete(key));
    rawCache.set(key, pending);
  }
  return pending;
}
