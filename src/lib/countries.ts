import world from "@/data/world.json";
import type { GeoMap } from "@/lib/geo";

export type Country = (typeof world.countries)[number];

export const WORLD = world;

/** The world map, with countries keyed by name. */
export const WORLD_MAP: GeoMap = {
  ...world,
  features: world.countries.map((c) => ({ ...c, id: c.name })),
};

/** A shape counts as a match when Jev says yes with at least this probability. */
export const MATCH = 0.5;

export type Ranked = { id: string; name: string; detail?: string; probability: number };

export type LocateResult = {
  query: string;
  /** Independent per-shape probabilities, highest first. */
  ranked: Ranked[];
  /** Shapes at or above MATCH. */
  matches: number;
  /** The emoji Jev thinks best fits the question, thrown as confetti. */
  emoji?: string;
  model: string;
  latencyMs: number;
  /** Served from the shared answer cache instead of a fresh Jev call. */
  cached?: boolean;
};
