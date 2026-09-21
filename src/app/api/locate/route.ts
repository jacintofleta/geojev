import { APIError, TypeSafeClient, noul } from "@typesafe-ai/sdk";
import { ipAddress } from "@vercel/functions";
import { MATCH, WORLD_MAP, type LocateResult } from "@/lib/countries";
import { scopeKey, type GeoFeature } from "@/lib/geo";
import { allowRequest, cacheAnswer, getCachedAnswer, reserveSpend } from "@/lib/guard";
import { findLevel, getRegions } from "@/lib/regions";

const MAX_QUERY_LENGTH = 400;
// Below this, a shape is noise and not worth sending to the client.
const MIN_PROBABILITY = 0.02;
// Questions per Jev request; bigger levels are split into parallel requests.
const BATCH_SIZE = 400;
// Generous per-question token estimate, used to reserve budget before calling Jev.
const TOKENS_PER_QUESTION = 45;

let client: TypeSafeClient | undefined;

/**
 * One independent yes/no question per country (or region). Unlike a Choice,
 * shapes don't compete for one 100%, so twenty of them can all score high.
 */
function questionFor(shape: GeoFeature, country: string | null) {
  if (!country) {
    return noul({
      country: shape.name,
      question: "Is `query` strongly associated with `country`?",
    });
  }
  return noul({
    region: shape.name,
    ...(shape.detail && shape.detail !== shape.name ? { part_of: shape.detail } : {}),
    country,
    question: "Is `query` strongly associated with `region`, a region of `country`?",
  });
}

async function scoreShapes(query: string, shapes: GeoFeature[], country: string | null) {
  const batches: GeoFeature[][] = [];
  for (let i = 0; i < shapes.length; i += BATCH_SIZE) {
    batches.push(shapes.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.all(
    batches.map((batch) =>
      client!.systemOne({
        state: { query },
        questions: Object.fromEntries(batch.map((s, i) => [`q${i}`, questionFor(s, country)])),
      }),
    ),
  );
  const scores = results.flatMap(({ answers }, b) =>
    batches[b].map((shape, i) => {
      const answer = answers[`q${i}`];
      return {
        id: shape.id,
        name: shape.name,
        detail: shape.detail,
        probability: answer.type === "noul" ? answer.noul : 0,
      };
    }),
  );
  const inputTokens = results.reduce((sum, r) => sum + r.usage.input_tokens, 0);
  return { scores, model: results[0].model, inputTokens };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const scope = body?.scope;

  if (!query) {
    return Response.json({ error: "Ask something." }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `Keep it under ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (scope && !findLevel(String(scope.iso3), String(scope.level))) {
    return Response.json({ error: "No regions for that country." }, { status: 400 });
  }
  if (!process.env.TYPESAFE_API_KEY) {
    return Response.json(
      { error: "TYPESAFE_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  const ip = ipAddress(request) ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  if (!(await allowRequest(ip))) {
    return Response.json(
      { error: "That's a lot of questions. Take a breather and try again in a minute." },
      { status: 429 },
    );
  }

  const where = scopeKey(scope ? { iso3: scope.iso3, country: "", level: scope.level } : null);
  const cached = await getCachedAnswer(query, where);
  if (cached) return Response.json({ ...cached, cached: true });

  client ??= new TypeSafeClient();
  const started = performance.now();
  let settle: ((tokens: number) => Promise<void>) | null = null;

  try {
    const regions = scope ? await getRegions(scope.iso3, scope.level) : null;
    const shapes = regions?.features ?? WORLD_MAP.features;

    const reservation = await reserveSpend(shapes.length * TOKENS_PER_QUESTION + query.length);
    if (reservation === "spent" || reservation === "unavailable") {
      return Response.json(
        {
          error:
            reservation === "spent"
              ? "Geojev has used up today's Jev budget. Come back tomorrow!"
              : "Geojev is taking a short break. Try again in a moment.",
        },
        { status: 503 },
      );
    }
    settle = reservation;

    const { scores, model, inputTokens } = await scoreShapes(
      query,
      shapes,
      regions?.country ?? null,
    );
    await settle(inputTokens);
    settle = null;

    const result: LocateResult = {
      query,
      ranked: scores
        .filter((c) => c.probability >= MIN_PROBABILITY)
        .sort((a, b) => b.probability - a.probability),
      matches: scores.filter((c) => c.probability >= MATCH).length,
      model,
      latencyMs: Math.round(performance.now() - started),
    };
    await cacheAnswer(query, where, result);
    return Response.json(result);
  } catch (error) {
    // Release the reservation; failed requests aren't billed.
    await settle?.(0);
    const status = error instanceof APIError ? error.status : 502;
    const message =
      status === 429 || status === 529
        ? "Jev is busy. Try again in a moment."
        : status === 401
          ? "The TypeSafe API key was rejected."
          : "Jev couldn't answer that one.";
    console.error("[locate]", error);
    return Response.json({ error: message }, { status });
  }
}
