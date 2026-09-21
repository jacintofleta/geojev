# Geojev

Type anything and see which countries it most likely points to.

A Next.js app on top of [Jev](https://typesafe.ai), TypeSafe's System One model. Each query sends a single request with
one [Noul](https://docs.typesafe.ai/primitives/noul) (yes/no) question per country: "Is `query` strongly associated with
`country`?". Every country gets its own calibrated probability, so countries don't compete: "football" lights up
dozens of countries, while "sushi" lights up Japan. The map shades countries by probability and zooms to the matches
(countries at 50% or more).

Put `vs` between two things ("tea vs coffee") to compare them on one map. Each side is asked separately (and cached
separately), then the map blends them: ember for the first, blue for the second, purple where both are strong.

Click a country to ask about its regions instead. Boundaries come from
[geoBoundaries](https://www.geoboundaries.org) (open license, up to five administrative levels per country). The server
fetches a level on first use, simplifies and projects it, and serves it with long CDN caching. Levels with more than
1,000 regions are skipped, and bigger levels are split into parallel Jev requests of 400 questions.

## Run it

```sh
cp .env.example .env.local   # add your TYPESAFE_API_KEY
pnpm install
pnpm dev
```

## Deploy

1. Import the repo in Vercel.
2. Add **Upstash Redis** from the Vercel Marketplace (Storage tab) and connect it to the project. This sets the Redis
   env vars.
3. Set `TYPESAFE_API_KEY` (use a production-only key) and optionally `DAILY_BUDGET_USD` (default `10`).

### Safeguards

With Redis connected, `/api/locate` enforces:

- **Daily spend cap**: every request reserves its estimated Jev cost before calling Jev and settles it with the real
  token count afterwards. Once the day's total (UTC) would pass `DAILY_BUDGET_USD`, requests get a friendly "come back
  tomorrow" instead. If Redis is unreachable, Jev isn't called at all.
- **Per-IP rate limits**: 20 questions per minute and 200 per day.
- **Answer cache**: identical questions (same place and level, ignoring case and spacing) are served from Redis for
  24 hours without calling Jev.

Also worth turning on in the Vercel dashboard: Spend Management (with pausing), and Bot Protection in the Firewall.

## How it's built

- `src/app/api/locate/route.ts`: the Jev call (`@typesafe-ai/sdk`).
- `src/components/map-view.tsx`: SVG map (world or regions) with heat fills, pan/zoom, zoom-to-answer and labels.
- `src/lib/guard.ts`: spend cap, rate limits and answer cache (Upstash Redis).
- `src/lib/regions.ts` + `src/app/api/regions/[iso3]/[level]`: loads, simplifies and projects a country's regions.
- `src/components/atlas.tsx`: page layout and chat.
- `scripts/build-geo.mjs` (`pnpm geo`): projects Natural Earth 1:50m countries (Equal Earth) into
  `src/data/world.json` as precomputed SVG paths, along with each country's available geoBoundaries levels. There are 236 countries and territories, one question each,
  or about 8k input tokens per query.
