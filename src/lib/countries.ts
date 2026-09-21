import world from "@/data/world.json";

export type Country = (typeof world.countries)[number];

export const WORLD = world;
export const COUNTRY_NAMES = world.countries.map((c) => c.name);

/** A country counts as a match when Jev says yes with at least this probability. */
export const MATCH = 0.5;

export type Ranked = { name: string; probability: number };

export type LocateResult = {
  query: string;
  /** Independent per-country probabilities, highest first. */
  ranked: Ranked[];
  /** Countries at or above MATCH. */
  matches: number;
  model: string;
  latencyMs: number;
};
