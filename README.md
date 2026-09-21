# Geojev

Type anything and see which countries it most likely points to.

A Next.js app on top of [Jev](https://typesafe.ai), TypeSafe's System One model. Each query sends a single request with
one [Noul](https://docs.typesafe.ai/primitives/noul) (yes/no) question per country: "Is `query` strongly associated with
`country`?". Every country gets its own calibrated probability, so countries don't compete: "football" lights up
dozens of countries, while "sushi" lights up Japan. The map shades countries by probability and zooms to the matches
(countries at 50% or more).

## Run it

```sh
cp .env.example .env.local   # add your TYPESAFE_API_KEY
pnpm install
pnpm dev
```

## Deploy

Import the repo in Vercel and set `TYPESAFE_API_KEY` as an environment variable. No other configuration is needed.

## How it's built

- `src/app/api/locate/route.ts`: the Jev call (`@typesafe-ai/sdk`).
- `src/components/world-map.tsx`: SVG map with heat fills, zoom-to-answer and labels.
- `src/components/atlas.tsx`: page layout and chat.
- `scripts/build-geo.mjs` (`pnpm geo`): projects Natural Earth 1:50m countries (Equal Earth) into
  `src/data/world.json` as precomputed SVG paths. There are 236 countries and territories, one question each,
  or about 8k input tokens per query.
