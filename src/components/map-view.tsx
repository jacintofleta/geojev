"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MATCH } from "@/lib/countries";
import type { GeoFeature, GeoMap } from "@/lib/geo";
import { formatPercent, heat, intensity, versusHeat, type Hue } from "@/lib/heat";

// Shapes smaller than this (map units²) get a dot so they stay visible.
const TINY_AREA = 6;
const LABEL_COUNT = 3;
// Framing around highlighted shapes, as a share of the map's home width.
const FOCUS_PADDING = 0.06;
const MIN_FOCUS_WIDTH = 0.34;
// Narrowest view, as a share of the home width (about 16x zoom).
const MIN_VIEW_WIDTH = 1 / 16;
const ZOOM_MS = 1100;
// Reveal: shapes light up in a wave from the top match, starting mid-flight.
const IGNITE_DELAY_MS = 380;
const RIPPLE_MS = 900;
// Most shapes that get the ignite flash, to keep huge answers cheap.
const FLASH_COUNT = 16;
// Pointer travel (px) below which a press counts as a click, not a drag.
const TAP_SLOP = 5;

type Box = { x: number; y: number; w: number; h: number };
type Hover = { feature: GeoFeature; x: number; y: number };

/** The map's full extent, home view and zoom limits. */
type Frame = { full: Box; home: Box; aspect: number; minWidth: number };

function frameOf(map: GeoMap): Frame {
  const full = { x: 0, y: 0, w: map.width, h: map.height };
  const aspect = map.width / map.height;
  const home = map.home ? fitAspect(map.home, aspect, full) : full;
  return { full, home, aspect, minWidth: home.w * MIN_VIEW_WIDTH };
}

/** Grows [x, y, w, h] to the map's aspect ratio around its center, kept inside the map. */
function fitAspect([x, y, w0, h0]: number[], aspect: number, full: Box): Box {
  let w = w0;
  let h = h0;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  if (w >= full.w) return full;
  return clampBox(
    { x: x + w0 / 2 - w / 2, y: y + h0 / 2 - h / 2, w, h },
    { full, aspect, minWidth: 0 },
  );
}

/** Keeps a box inside the map and within the allowed zoom range. */
function clampBox(
  { x, y, w }: Box,
  { full, aspect, minWidth }: Pick<Frame, "full" | "aspect" | "minWidth">,
): Box {
  w = Math.min(Math.max(w, minWidth), full.w);
  const h = w / aspect;
  return {
    x: Math.min(Math.max(x, 0), full.w - w),
    y: Math.min(Math.max(y, 0), full.h - h),
    w,
    h,
  };
}

/** Scales a box by `factor` around a fixed point (in map units). */
function zoomAround(box: Box, factor: number, ux: number, uy: number, frame: Frame): Box {
  const w = Math.min(Math.max(box.w * factor, frame.minWidth), frame.full.w);
  const k = w / box.w;
  return clampBox({ x: ux - (ux - box.x) * k, y: uy - (uy - box.y) * k, w, h: 0 }, frame);
}

/** Smallest map-aspect box around the highlighted shapes; the home view if there are none. */
function focusBox(features: GeoFeature[], frame: Frame): Box {
  if (features.length === 0) return frame.home;
  let [x0, y0, x1, y1] = features[0].box;
  for (const { box } of features) {
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  const pad = frame.home.w * FOCUS_PADDING;
  let w = Math.max(x1 - x0 + pad * 2, frame.home.w * MIN_FOCUS_WIDTH);
  let h = y1 - y0 + pad * 2;
  if (w / h > frame.aspect) h = w / frame.aspect;
  else w = h * frame.aspect;
  if (w >= frame.full.w) return frame.full;
  return clampBox({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }, frame);
}

/** Delay (ms) before a shape lights up: further from the epicenter, later. */
function igniteDelay(feature: GeoFeature, epicenter: GeoFeature | undefined, frame: Frame) {
  if (!epicenter) return 0;
  const distance = Math.hypot(feature.cx - epicenter.cx, feature.cy - epicenter.cy);
  return Math.round(IGNITE_DELAY_MS + Math.min(1, distance / frame.home.w) * RIPPLE_MS);
}

/** Largest map-aspect size that fits the container. */
function useFittedSize(ref: React.RefObject<HTMLDivElement | null>, aspect: number) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  const width = Math.min(box.width, box.height * aspect);
  return { width: width || 1000, height: (width || 1000) / aspect };
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

/** Drag to pan, wheel or pinch to zoom, double-click to zoom in, click to select. */
function useGestures(
  svgRef: React.RefObject<SVGSVGElement | null>,
  view: ReturnType<typeof useViewBox>,
  frame: Frame,
  { onStart, onTap }: { onStart: () => void; onTap: (id: string) => void },
) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{ x: number; y: number; id: string | null; moved: boolean } | null>(null);
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
      jumpTo(zoomAround(current.current, Math.exp(delta * 0.0025), ux, uy, frame));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef, toMap, jumpTo, current, frame]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    // Read the shape under the pointer before capture retargets later events to the svg.
    const id = (event.target as Element).closest("[data-id]")?.getAttribute("data-id") ?? null;
    press.current =
      pointers.current.size === 0
        ? { x: event.clientX, y: event.clientY, id, moved: false }
        : null;
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
    if (
      press.current &&
      Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > TAP_SLOP
    ) {
      press.current.moved = true;
    }

    if (points.length === 1) {
      const { scale } = toMap(event.clientX, event.clientY);
      const b = current.current;
      jumpTo(
        clampBox(
          {
            ...b,
            x: b.x - (event.clientX - previous.x) * scale,
            y: b.y - (event.clientY - previous.y) * scale,
          },
          frame,
        ),
      );
    } else if (points.length === 2) {
      const other = points.find((p) => p !== previous)!;
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const { ux, uy } = toMap((event.clientX + other.x) / 2, (event.clientY + other.y) / 2);
      if (before > 0 && after > 0) {
        jumpTo(zoomAround(current.current, before / after, ux, uy, frame));
      }
    }
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) return;
    setDragging(false);
    const tap = press.current;
    press.current = null;
    if (event.type === "pointerup" && tap && !tap.moved && tap.id) onTap(tap.id);
  };

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const { ux, uy } = toMap(event.clientX, event.clientY);
    animateTo(zoomAround(current.current, 0.5, ux, uy, frame));
  };

  /** Zooms around the center of the view, for the +/− buttons. */
  const zoomBy = (factor: number) => {
    const b = current.current;
    animateTo(zoomAround(b, factor, b.x + b.w / 2, b.y + b.h / 2, frame));
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

/** Whether a shape's label anchor is inside the visible part of the map. */
function inView({ cx, cy }: GeoFeature, box: Box): boolean {
  return cx > box.x && cx < box.x + box.w && cy > box.y && cy < box.y + box.h;
}

type Label = { feature: GeoFeature; x: number; y: number; width: number };

/**
 * Places labels right of each anchor (left when they'd run off the view),
 * nudging down until they stop overlapping.
 */
function placeLabels(
  features: GeoFeature[],
  text: (f: GeoFeature) => string,
  s: number,
  box: Box,
): Label[] {
  const size = 11 * s;
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  return features.map((feature) => {
    const width = text(feature).length * size * 0.62;
    const right = feature.cx + 7 * s;
    const x = right + width > box.x + box.w - 12 * s ? feature.cx - 7 * s - width : right;
    let y = feature.cy + 4 * s;
    const hits = () =>
      placed.some((b) => x < b.x1 && x + width > b.x0 && y - size < b.y1 && y > b.y0);
    for (let i = 0; i < 12 && hits(); i++) y += size * 1.35;
    placed.push({ x0: x, y0: y - size, x1: x + width, y1: y });
    return { feature, x, y, width };
  });
}

export function MapView({
  map,
  probabilities,
  versus,
  answerKey,
  label,
  canSelect,
  onSelect,
  selectHint,
}: {
  map: GeoMap;
  /** Probability per feature id. */
  probabilities: Map<string, number>;
  /** A rival answer's probabilities ("tea vs coffee"), compared on the same map in its own hue. */
  versus?: Map<string, number>;
  /** Changes whenever a different answer is shown, to re-frame the map. */
  answerKey: unknown;
  label: string;
  canSelect?: (feature: GeoFeature) => boolean;
  onSelect?: (feature: GeoFeature) => void;
  /** Shown in the tooltip of selectable shapes. */
  selectHint?: string;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [frame] = useState(() => frameOf(map));
  const rendered = useFittedSize(containerRef, frame.aspect);

  const first = (f: GeoFeature) => probabilities.get(f.id) ?? 0;
  const second = (f: GeoFeature) => versus?.get(f.id) ?? 0;
  // The stronger side decides framing, labels and whether a shape is lit.
  const probability = (f: GeoFeature) => Math.max(first(f), second(f));
  const lit = (f: GeoFeature) => intensity(probability(f)) > 0;
  const fill = (f: GeoFeature) =>
    versus ? versusHeat(first(f), second(f)) : heat(intensity(first(f)));
  // The hue of whichever side leads, for labels and the reveal.
  const lead = (f: GeoFeature): Hue => (second(f) > first(f) ? "tide" : "ember");
  const leadColor = (f: GeoFeature) => `var(--${lead(f)}-deep)`;
  const selectable = (f: GeoFeature) => !!onSelect && (canSelect?.(f) ?? true);

  const matches = map.features
    .filter((f) => probability(f) >= MATCH)
    .sort((a, b) => probability(b) - probability(a));
  const epicenter = matches[0];
  const epicenterHue = epicenter ? lead(epicenter) : "ember";
  const delay = (f: GeoFeature) =>
    ({ "--d": `${igniteDelay(f, epicenter, frame)}ms` }) as React.CSSProperties;

  const view = useViewBox(focusBox(matches, frame), answerKey);
  const { box } = view;
  const gestures = useGestures(svgRef, view, frame, {
    onStart: () => setHover(null),
    onTap: (id) => {
      const feature = map.features.find((f) => f.id === id);
      if (feature && selectable(feature)) onSelect!(feature);
    },
  });
  // Map units per screen pixel; keeps labels and markers a constant size at any zoom.
  const s = box.w / rendered.width;
  const zoomed = box.w < frame.full.w - 1;
  const atHome =
    Math.abs(box.w - frame.home.w) < 1 &&
    Math.abs(box.x - frame.home.x) < 1 &&
    Math.abs(box.y - frame.home.y) < 1;

  const ranked = matches.filter((f) => inView(f, box)).slice(0, LABEL_COUNT);
  const labels = placeLabels(ranked, (f) => `${f.name} ${formatPercent(probability(f))}`, s, box);

  const onHover = (feature: GeoFeature) => (event: React.PointerEvent) => {
    if (!gestures.dragging) setHover({ feature, x: event.clientX, y: event.clientY });
  };

  const shapeProps = (feature: GeoFeature) => ({
    "data-id": feature.id,
    className: `country ${selectable(feature) && !gestures.dragging ? "cursor-pointer" : ""}`,
    style: delay(feature),
    onPointerMove: onHover(feature),
  });

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
        aria-label={label}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          {map.sphere && (
            <clipPath id="sphere">
              <path d={map.sphere} />
            </clipPath>
          )}
          <radialGradient id="flare">
            <stop offset="0%" stopColor={`var(--${epicenterHue})`} stopOpacity={0.55} />
            <stop offset="45%" stopColor={`var(--${epicenterHue})`} stopOpacity={0.18} />
            <stop offset="100%" stopColor={`var(--${epicenterHue})`} stopOpacity={0} />
          </radialGradient>
        </defs>
        {map.sphere && <path d={map.sphere} fill="var(--paper-raised)" />}
        {map.graticule && (
          <path
            d={map.graticule}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth={0.6}
            strokeDasharray="1 3"
            vectorEffect="non-scaling-stroke"
            clipPath={map.sphere ? "url(#sphere)" : undefined}
          />
        )}

        <g>
          {map.features.map((feature) => {
            const isHovered = hover?.feature.id === feature.id;
            return (
              <path
                key={feature.id}
                d={feature.d}
                {...shapeProps(feature)}
                fill={fill(feature)}
                stroke={isHovered ? "var(--ink)" : "var(--paper-raised)"}
                strokeWidth={isHovered ? 1.2 : 0.6}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>

        <g>
          {map.features
            .filter((f) => f.area < TINY_AREA)
            .map((feature) => {
              const on = lit(feature);
              return (
                <circle
                  key={feature.id}
                  cx={feature.cx}
                  cy={feature.cy}
                  r={(on ? 3.5 : 1.6) * s}
                  {...shapeProps(feature)}
                  fill={fill(feature)}
                  stroke="var(--paper-raised)"
                  strokeWidth={0.6}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
        </g>

        {/* One-shot reveal, replayed whenever a new answer lands. */}
        {epicenter && (
          <g key={`${String(answerKey)}-${epicenter.id}`} className="pointer-events-none">
            <circle
              cx={epicenter.cx}
              cy={epicenter.cy}
              r={60 * s}
              fill="url(#flare)"
              className="flare"
              style={delay(epicenter)}
            />
            {matches.slice(0, FLASH_COUNT).map((feature) => (
              <path
                key={feature.id}
                d={feature.d}
                className="ignite"
                style={{ ...delay(feature), "--flash": `var(--${lead(feature)})` } as React.CSSProperties}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {[0, 220].map((lag, i) => (
              <circle
                key={lag}
                cx={epicenter.cx}
                cy={epicenter.cy}
                r={6 * s}
                fill="none"
                stroke={`var(--${epicenterHue}${i === 0 ? "" : "-deep"})`}
                strokeWidth={i === 0 ? 2 : 1}
                vectorEffect="non-scaling-stroke"
                className="shockwave"
                style={{ "--d": `${IGNITE_DELAY_MS + lag}ms` } as React.CSSProperties}
              />
            ))}
          </g>
        )}

        {map.sphere && (
          <path
            d={map.sphere}
            fill="none"
            stroke="var(--ink)"
            strokeOpacity={zoomed ? 0 : 0.35}
            strokeWidth={0.8}
            className="transition-[stroke-opacity] duration-700"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <g className="pointer-events-none">
          {labels.map(({ feature, x, y, width }, rank) => (
            <g
              key={`${String(answerKey)}-${feature.id}-${rank}`}
              className="label-in"
              style={
                { "--d": `${igniteDelay(feature, epicenter, frame) + 250}ms` } as React.CSSProperties
              }
            >
              {rank === 0 && (
                <circle
                  cx={feature.cx}
                  cy={feature.cy}
                  r={5 * s}
                  fill="none"
                  stroke={leadColor(feature)}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="pulse"
                />
              )}
              <circle
                cx={feature.cx}
                cy={feature.cy}
                r={2.5 * s}
                fill="var(--ink)"
                stroke="var(--paper-raised)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {y - feature.cy > 8 * s && (
                <line
                  x1={feature.cx}
                  y1={feature.cy}
                  x2={x < feature.cx ? x + width : x - 2 * s}
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
                {feature.name}{" "}
                <tspan fill={leadColor(feature)}>{formatPercent(probability(feature))}</tspan>
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className="absolute right-0 bottom-0 flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-paper-raised/80 font-mono text-ink shadow-sm backdrop-blur">
        <MapButton
          label="Zoom in"
          onClick={() => gestures.zoomBy(0.5)}
          disabled={box.w <= frame.minWidth + 1}
        >
          <path d="M8 3.5v9M3.5 8h9" />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => gestures.zoomBy(2)} disabled={!zoomed}>
          <path d="M3.5 8h9" />
        </MapButton>
        <MapButton label="Reset the view" onClick={() => view.animateTo(frame.home)} disabled={atHome}>
          <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />
        </MapButton>
      </div>

      {hover && (
        <div
          className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-full rounded-2xl border border-ink/10 bg-paper-raised/95 px-3 py-1.5 font-mono text-[11px] whitespace-nowrap text-ink shadow-sm backdrop-blur"
          style={{ left: hover.x, top: hover.y - 12 }}
        >
          {hover.feature.name}
          {hover.feature.detail && hover.feature.detail !== hover.feature.name && (
            <span className="text-muted">, {hover.feature.detail}</span>
          )}
          {versus ? (
            <span className="ml-2">
              <span className="text-ember-deep">{formatPercent(first(hover.feature))}</span>
              <span className="text-muted"> vs </span>
              <span className="text-tide-deep">{formatPercent(second(hover.feature))}</span>
            </span>
          ) : (
            probabilities.size > 0 && (
              <span className="ml-2 text-ember-deep">
                {formatPercent(first(hover.feature))}
              </span>
            )
          )}
          {selectHint && selectable(hover.feature) && (
            <span className="block text-[10px] tracking-wider text-muted uppercase">
              {selectHint}
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
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
