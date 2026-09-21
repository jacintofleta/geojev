import world from "@/data/world.json";

export type Country = (typeof world.countries)[number];

export const WORLD = world;
export const COUNTRY_NAMES = world.countries.map((c) => c.name);

export type Ranked = { name: string; probability: number };

export type LocateResult = {
  query: string;
  ranked: Ranked[];
  confidence: number;
  /** Probability that the query actually points at a place. */
  geographic: number;
  model: string;
  latencyMs: number;
};
