// Precomputes projected SVG paths for every country so the client ships
// ~150KB of path data instead of a topojson + projection pipeline.
// Run with: pnpm geo
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { feature } from "topojson-client";
import { presimplify, simplify, quantile } from "topojson-simplify";
import { geoEqualEarth, geoPath, geoGraticule10 } from "d3-geo";

const require = createRequire(import.meta.url);
const topo = require("world-atlas/countries-50m.json");

const WIDTH = 1000;
const HEIGHT = 520;

// Not countries, or too obscure to be a useful answer.
const EXCLUDE = new Set([
  "Antarctica",
  "Siachen Glacier",
  "Indian Ocean Ter.",
  "Ashmore and Cartier Is.",
  "Heard I. and McDonald Is.",
]);

// Natural Earth abbreviates many names; Jev reads the option labels,
// so spell them out.
const FULL_NAMES = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "Democratic Republic of the Congo",
  Congo: "Republic of the Congo",
  "Central African Rep.": "Central African Republic",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "S. Sudan": "South Sudan",
  "W. Sahara": "Western Sahara",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  Macedonia: "North Macedonia",
  "N. Cyprus": "Northern Cyprus",
  "Solomon Is.": "Solomon Islands",
  "Falkland Is.": "Falkland Islands",
  "Fr. S. Antarctic Lands": "French Southern and Antarctic Lands",
  "Fr. Polynesia": "French Polynesia",
  "Marshall Is.": "Marshall Islands",
  "N. Mariana Is.": "Northern Mariana Islands",
  "U.S. Virgin Is.": "U.S. Virgin Islands",
  "British Virgin Is.": "British Virgin Islands",
  "S. Geo. and the Is.": "South Georgia and the South Sandwich Islands",
  "Br. Indian Ocean Ter.": "British Indian Ocean Territory",
  "Pitcairn Is.": "Pitcairn Islands",
  "Cayman Is.": "Cayman Islands",
  "Turks and Caicos Is.": "Turks and Caicos Islands",
  "Cook Is.": "Cook Islands",
  "Faeroe Is.": "Faroe Islands",
  "Wallis and Futuna Is.": "Wallis and Futuna",
  "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
  "St. Kitts and Nevis": "Saint Kitts and Nevis",
  "St. Pierre and Miquelon": "Saint Pierre and Miquelon",
  "St-Martin": "Saint Martin",
  "St-Barthélemy": "Saint Barthélemy",
  "Antigua and Barb.": "Antigua and Barbuda",
  "São Tomé and Principe": "São Tomé and Príncipe",
  eSwatini: "Eswatini",
  Vatican: "Vatican City",
};

let simplified = presimplify(topo);
simplified = simplify(simplified, quantile(simplified, 0.1));

const original = feature(topo, topo.objects.countries).features.filter(
  (f) => !EXCLUDE.has(f.properties.name),
);
const byName = new Map(
  feature(simplified, simplified.objects.countries).features.map((f) => [
    f.properties.name,
    f,
  ]),
);

const projection = geoEqualEarth().fitExtent(
  [
    [8, 8],
    [WIDTH - 8, HEIGHT - 8],
  ],
  { type: "Sphere" },
);
const path = geoPath(projection).digits(1);

// Anchor labels on the largest landmass so France sits in Europe,
// not halfway to French Guiana.
function mainland(f) {
  if (f.geometry.type !== "MultiPolygon") return f;
  const polygons = f.geometry.coordinates.map((coordinates) => ({
    type: "Polygon",
    coordinates,
  }));
  return polygons.reduce((a, b) => (path.area(b) > path.area(a) ? b : a));
}

const countries = original
  .map((f) => {
    const name = f.properties.name;
    const main = mainland(f);
    const [cx, cy] = path.centroid(main);
    const box = path.bounds(main).flat().map((v) => Math.round(v * 10) / 10);
    return {
      id: f.id ?? name.toLowerCase().replace(/\W+/g, "-"),
      name: FULL_NAMES[name] ?? name,
      d: path(byName.get(name)) ?? "",
      cx: Math.round(cx * 10) / 10,
      cy: Math.round(cy * 10) / 10,
      // Bounds of the main landmass, [x0, y0, x1, y1]; used to zoom to answers.
      box,
      // Projected area in px²; tiny countries get a dot marker instead.
      area: Math.round(path.area(f) * 10) / 10,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const names = new Set(countries.map((c) => c.name));
if (names.size !== countries.length) throw new Error("Duplicate country names");
if (countries.length > 255) throw new Error("Jev Choice allows 255 options max");

writeFileSync(
  new URL("../src/data/world.json", import.meta.url),
  JSON.stringify({
    width: WIDTH,
    height: HEIGHT,
    sphere: path({ type: "Sphere" }),
    graticule: path(geoGraticule10()),
    countries,
  }),
);

console.log(`Wrote ${countries.length} countries`);
