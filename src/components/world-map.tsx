"use client";

import { useEffect, useRef, useState } from "react";
import { WORLD, type Country } from "@/lib/countries";
import { formatPercent, heat } from "@/lib/heat";

// Countries smaller than this (projected px²) get a dot so they stay visible.
const TINY_AREA = 6;
const LABEL_COUNT = 3;
const LABEL_MIN_PROBABILITY = 0.04;
// Countries at least this share of the top answer decide where the map zooms.
const FOCUS_MIN_INTENSITY = 0.3;
const FOCUS_PADDING = 60;
const MIN_FOCUS_WIDTH = 340;
const ZOOM_MS = 1100;

type Box = { x: number; y: number; w: number; h: number };
type Hover = { country: Country; x: number; y: number };

const FULL: Box = { x: 0, y: 0, w: WORLD.width, h: WORLD.height };
const ASPECT = WORLD.width / WORLD.height;

/** Smallest world-aspect box around the focus countries, kept inside the map. */
function focusBox(countries: Country[]): Box {
  if (countries.length === 0) return FULL;
  let [x0, y0, x1, y1] = countries[0].box;
  for (const { box } of countries) {
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  let w = Math.max(x1 - x0 + FOCUS_PADDING * 2, MIN_FOCUS_WIDTH);
  let h = y1 - y0 + FOCUS_PADDING * 2;
  if (w / h > ASPECT) h = w / ASPECT;
  else w = h * ASPECT;
  if (w >= FULL.w) return FULL;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return {
    x: clamp((x0 + x1) / 2 - w / 2, FULL.w - w),
    y: clamp((y0 + y1) / 2 - h / 2, FULL.h - h),
    w,
    h,
  };
}

/** Largest map-aspect size that fits the container. */
function useFittedSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: FULL.w, height: FULL.h });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.min(width, height * ASPECT);
      if (w > 0) setSize({ width: w, height: w / ASPECT });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function useAnimatedBox(target: Box): Box {
  const [box, setBox] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - start) / ZOOM_MS);
      const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
      const next = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      };
      current.current = next;
      setBox(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y, target.w, target.h]);

  return box;
}

type Label = { country: Country; x: number; y: number; width: number };

/**
 * Places labels right of each centroid (left when they'd run off the view),
 * nudging down until they stop overlapping.
 */
function placeLabels(
  countries: Country[],
  text: (c: Country) => string,
  s: number,
  box: Box,
): Label[] {
  const size = 11 * s;
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  return countries.map((country) => {
    const t = text(country);
    const width = t.length * size * 0.62;
    const right = country.cx + 7 * s;
    const x = right + width > box.x + box.w - 12 * s ? country.cx - 7 * s - width : right;
    let y = country.cy + 4 * s;
    const hits = () =>
      placed.some((b) => x < b.x1 && x + width > b.x0 && y - size < b.y1 && y > b.y0);
    for (let i = 0; i < 12 && hits(); i++) y += size * 1.35;
    placed.push({ x0: x, y0: y - size, x1: x + width, y1: y });
    return { country, x, y, width };
  });
}

export function WorldMap({
  probabilities,
}: {
  probabilities: Map<string, number>;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendered = useFittedSize(containerRef);

  const max = Math.max(0, ...probabilities.values());
  const probability = (c: Country) => probabilities.get(c.name) ?? 0;
  const intensity = (c: Country) => (max > 0 ? probability(c) / max : 0);

  const box = useAnimatedBox(
    focusBox(WORLD.countries.filter((c) => intensity(c) >= FOCUS_MIN_INTENSITY)),
  );
  // Map units per screen pixel; keeps labels and markers a constant size at any zoom.
  const s = box.w / rendered.width;
  const zoomed = box.w < FULL.w - 1;

  const ranked = WORLD.countries
    .filter((c) => probability(c) >= LABEL_MIN_PROBABILITY)
    .sort((a, b) => probability(b) - probability(a))
    .slice(0, LABEL_COUNT);
  const labels = placeLabels(ranked, (c) => `${c.name} ${formatPercent(probability(c))}`, s, box);

  const onHover = (country: Country) => (event: React.PointerEvent) =>
    setHover({ country, x: event.clientX, y: event.clientY });

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center">
      <svg
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        width={rendered.width}
        height={rendered.height}
        className={`shrink-0 ${zoomed ? "map-fade" : ""}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="World map with countries shaded by likelihood"
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="sphere">
            <path d={WORLD.sphere} />
          </clipPath>
        </defs>

        <path d={WORLD.sphere} fill="var(--paper-raised)" />
        <path
          d={WORLD.graticule}
          fill="none"
          stroke="var(--hairline)"
          strokeWidth={0.6}
          strokeDasharray="1 3"
          vectorEffect="non-scaling-stroke"
          clipPath="url(#sphere)"
        />

        <g>
          {WORLD.countries.map((country) => {
            const isHovered = hover?.country.name === country.name;
            return (
              <path
                key={country.name}
                d={country.d}
                className="country cursor-crosshair"
                fill={heat(intensity(country))}
                stroke={isHovered ? "var(--ink)" : "var(--paper-raised)"}
                strokeWidth={isHovered ? 1.2 : 0.6}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                onPointerMove={onHover(country)}
              />
            );
          })}
        </g>

        <g>
          {WORLD.countries
            .filter((c) => c.area < TINY_AREA)
            .map((country) => {
              const t = intensity(country);
              const lit = t > 0.02;
              return (
                <circle
                  key={country.name}
                  cx={country.cx}
                  cy={country.cy}
                  r={(lit ? 3.5 : 1.6) * s}
                  className="country cursor-crosshair"
                  fill={lit ? heat(t) : "var(--land)"}
                  stroke="var(--paper-raised)"
                  strokeWidth={0.6}
                  vectorEffect="non-scaling-stroke"
                  onPointerMove={onHover(country)}
                />
              );
            })}
        </g>

        <path
          d={WORLD.sphere}
          fill="none"
          stroke="var(--ink)"
          strokeOpacity={zoomed ? 0 : 0.35}
          strokeWidth={0.8}
          className="transition-[stroke-opacity] duration-700"
          vectorEffect="non-scaling-stroke"
        />

        <g className="pointer-events-none">
          {labels.map(({ country, x, y, width }, rank) => (
            <g key={`${country.name}-${rank}`}>
              {rank === 0 && (
                <circle
                  cx={country.cx}
                  cy={country.cy}
                  r={5 * s}
                  fill="none"
                  stroke="var(--ember-deep)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="pulse"
                />
              )}
              <circle
                cx={country.cx}
                cy={country.cy}
                r={2.5 * s}
                fill="var(--ink)"
                stroke="var(--paper-raised)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {y - country.cy > 8 * s && (
                <line
                  x1={country.cx}
                  y1={country.cy}
                  x2={x < country.cx ? x + width : x - 2 * s}
                  y2={y - 4 * s}
                  stroke="var(--ink)"
                  strokeOpacity={0.5}
                  strokeWidth={0.6}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <text
                x={x}
                y={y}
                className="map-label font-mono"
                fontSize={11 * s}
                strokeWidth={3 * s}
                fill="var(--ink)"
              >
                {country.name}{" "}
                <tspan fill="var(--ember-deep)">
                  {formatPercent(probability(country))}
                </tspan>
              </text>
            </g>
          ))}
        </g>
      </svg>

      {hover && (
        <div
          className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-full rounded-full border border-ink/10 bg-paper-raised/95 px-3 py-1 font-mono text-[11px] whitespace-nowrap text-ink shadow-sm backdrop-blur"
          style={{ left: hover.x, top: hover.y - 12 }}
        >
          {hover.country.name}
          {probabilities.size > 0 && (
            <span className="ml-2 text-ember-deep">
              {formatPercent(probability(hover.country))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
