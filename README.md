# Geojev

Type anything and see which countries it most likely points to.

A Next.js app on top of [Jev](https://typesafe.ai), TypeSafe's System One model. Each query sends a single request with a
[Choice](https://docs.typesafe.ai/primitives/choice) question: every country is one option, so Jev returns a calibrated
probability for each. The map shades countries by those probabilities and zooms to the most likely region. A second
[Noul](https://docs.typesafe.ai/primitives/noul) question checks whether the query is about a place at all.

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
  `src/data/world.json` as precomputed SVG paths. There are 236 countries and territories, which fits Jev's
  255-option limit per Choice.
