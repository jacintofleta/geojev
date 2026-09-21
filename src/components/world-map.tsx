"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MATCH, WORLD, type Country } from "@/lib/countries";
import { formatPercent, heat, intensity as shade } from "@/lib/heat";

// Countries smaller than this (projected px²) get a dot so they stay visible.
const TINY_AREA = 6;
const LABEL_COUNT = 3;
const FOCUS_PADDING = 60;
const MIN_FOCUS_WIDTH = 340;
const ZOOM_MS = 1100;
// Narrowest view the user can zoom to, in map units (about 12x).
const MIN_VIEW_WIDTH = 80;

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

/** Keeps a box inside the world and within the allowed zoom range. */
function clampBox({ x, y, w }: Box): Box {
  w = Math.min(Math.max(w, MIN_VIEW_WIDTH), FULL.w);
  const h = w / ASPECT;
  return {
    x: Math.min(Math.max(x, 0), FULL.w - w),
    y: Math.min(Math.max(y, 0), FULL.h - h),
    w,
    h,
  };
}

/** Scales a box by `factor` around a fixed point (in map units). */
function zoomAround(box: Box, factor: number, ux: number, uy: number): Box {
  const w = Math.min(Math.max(box.w * factor, MIN_VIEW_WIDTH), FULL.w);
  const k = w / box.w;
  return clampBox({ x: ux - (ux - box.x) * k, y: uy - (uy - box.y) * k, w, h: 0 });
}

/**
 * The visible part of the map. Animates to `target` for every new answer
 * (`answerKey`), and lets gestures jump or animate it anywhere.
 */
function useViewBox(target: Box, answerKey: unknown) {
  const [box, setBox] = useState(target);
  const current = useRef(target);
  const frame = useRef(0);

  const jumpTo = useCallback((next: Box) => {
    cancelAnimationFrame(frame.current);
    current.current = next;
    setBox(next);
  }, []);

  const animateTo = useCallback((to: Box) => {
    cancelAnimationFrame(frame.current);
    const from = current.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const tick = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - start) / ZOOM_MS);
      const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
      const next = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
      };
      current.current = next;
      setBox(next);
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    animateTo({ x: target.x, y: target.y, w: target.w, h: target.h });
    return () => cancelAnimationFrame(frame.current);
  }, [animateTo, answerKey, target.x, target.y, target.w, target.h]);

  return { box, current, jumpTo, animateTo };
}

/** Drag to pan, wheel or pinch to zoom, double-click to zoom in. */
function useGestures(
  svgRef: React.RefObject<SVGSVGElement | null>,
  view: ReturnType<typeof useViewBox>,
  onStart: () => void,
) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [dragging, setDragging] = useState(false);
  const { current, jumpTo, animateTo } = view;

  /** Converts a screen point to map units in the current view. */
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const b = current.current;
      return {
        ux: b.x + ((clientX - rect.left) / rect.width) * b.w,
        uy: b.y + ((clientY - rect.top) / rect.height) * b.h,
        scale: b.w / rect.width,
      };
    },
    [svgRef, current],
  );

  // Wheel needs a non-passive listener to stop the page from handling it.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { ux, uy } = toMap(event.clientX, event.clientY);
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      jumpTo(zoomAround(current.current, Math.exp(delta * 0.0025), ux, uy));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef, toMap, jumpTo, current]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);
    onStart();
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const points = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (points.length === 1) {
      const { scale } = toMap(event.clientX, event.clientY);
      const b = current.current;
      jumpTo(
        clampBox({
          ...b,
          x: b.x - (event.clientX - previous.x) * scale,
          y: b.y - (event.clientY - previous.y) * scale,
        }),
      );
    } else if (points.length === 2) {
      const other = points.find((p) => p !== previous)!;
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const { ux, uy } = toMap((event.clientX + other.x) / 2, (event.clientY + other.y) / 2);
      if (before > 0 && after > 0) jumpTo(zoomAround(current.current, before / after, ux, uy));
    }
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const { ux, uy } = toMap(event.clientX, event.clientY);
    animateTo(zoomAround(current.current, 0.5, ux, uy));
  };

  /** Zooms around the center of the view, for the +/− buttons. */
  const zoomBy = (factor: number) => {
    const b = current.current;
    animateTo(zoomAround(b, factor, b.x + b.w / 2, b.y + b.h / 2));
  };

  return {
    dragging,
    zoomBy,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
    },
  };
}

/** Whether a country's label anchor is inside the visible part of the map. */
function inView({ cx, cy }: Country, box: Box): boolean {
  return cx > box.x && cx < box.x + box.w && cy > box.y && cy < box.y + box.h;
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
  answerKey,
}: {
  probabilities: Map<string, number>;
  /** Changes whenever a different answer is shown, to re-frame the map. */
  answerKey: unknown;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendered = useFittedSize(containerRef);

  const probability = (c: Country) => probabilities.get(c.name) ?? 0;
  const intensity = (c: Country) => shade(probability(c));

  const view = useViewBox(
    focusBox(WORLD.countries.filter((c) => probability(c) >= MATCH)),
    answerKey,
  );
  const { box } = view;
  const gestures = useGestures(svgRef, view, () => setHover(null));
  // Map units per screen pixel; keeps labels and markers a constant size at any zoom.
  const s = box.w / rendered.width;
  const zoomed = box.w < FULL.w - 1;

  const ranked = WORLD.countries
    .filter((c) => probability(c) >= MATCH && inView(c, box))
    .sort((a, b) => probability(b) - probability(a))
    .slice(0, LABEL_COUNT);
  const labels = placeLabels(ranked, (c) => `${c.name} ${formatPercent(probability(c))}`, s, box);

  const onHover = (country: Country) => (event: React.PointerEvent) => {
    if (!gestures.dragging) setHover({ country, x: event.clientX, y: event.clientY });
  };

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
      <svg
        ref={svgRef}
        {...gestures.handlers}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        width={rendered.width}
        height={rendered.height}
        className={`shrink-0 touch-none select-none ${zoomed ? "map-fade" : ""} ${
          gestures.dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
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
                className="country"
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
              const lit = t > 0;
              return (
                <circle
                  key={country.name}
                  cx={country.cx}
                  cy={country.cy}
                  r={(lit ? 3.5 : 1.6) * s}
                  className="country"
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

      <div className="absolute right-0 bottom-0 flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-paper-raised/80 font-mono text-ink shadow-sm backdrop-blur">
        <MapButton label="Zoom in" onClick={() => gestures.zoomBy(0.5)} disabled={box.w <= MIN_VIEW_WIDTH + 1}>
          <path d="M8 3.5v9M3.5 8h9" />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => gestures.zoomBy(2)} disabled={!zoomed}>
          <path d="M3.5 8h9" />
        </MapButton>
        <MapButton label="Show the whole world" onClick={() => view.animateTo(FULL)} disabled={!zoomed}>
          <circle cx="8" cy="8" r="5" />
          <path d="M3 8h10M8 3c-2.2 2.8-2.2 7.2 0 10M8 3c2.2 2.8 2.2 7.2 0 10" />
        </MapButton>
      </div>

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

function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center border-ink/10 transition not-last:border-b hover:bg-paper hover:text-ember-deep disabled:text-ink/25 disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  );
}
