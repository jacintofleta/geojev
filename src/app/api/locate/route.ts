import { APIError, TypeSafeClient, noul } from "@typesafe-ai/sdk";
import { COUNTRY_NAMES, MATCH, type LocateResult } from "@/lib/countries";

const MAX_QUERY_LENGTH = 400;
// Below this, a country is noise and not worth sending to the client.
const MIN_PROBABILITY = 0.02;

// One independent yes/no question per country, all answered in a single
// request. Unlike a Choice, countries don't compete for one 100%, so twenty
// countries can all score high.
const questions = Object.fromEntries(
  COUNTRY_NAMES.map((country, i) => [
    `c${i}`,
    noul({
      country,
      question: "Is `query` strongly associated with `country`?",
    }),
  ]),
);

let client: TypeSafeClient | undefined;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";

  if (!query) {
    return Response.json({ error: "Ask something." }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { error: `Keep it under ${MAX_QUERY_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (!process.env.TYPESAFE_API_KEY) {
    return Response.json(
      { error: "TYPESAFE_API_KEY is not set on the server." },
      { status: 500 },
    );
  }

  client ??= new TypeSafeClient();
  const started = performance.now();

  try {
    const { model, answers } = await client.systemOne({
      state: { query },
      questions,
    });

    const scored = COUNTRY_NAMES.map((name, i) => ({
      name,
      probability: answers[`c${i}`].noul,
    }));

    const result: LocateResult = {
      query,
      ranked: scored
        .filter((c) => c.probability >= MIN_PROBABILITY)
        .sort((a, b) => b.probability - a.probability),
      matches: scored.filter((c) => c.probability >= MATCH).length,
      model,
      latencyMs: Math.round(performance.now() - started),
    };
    return Response.json(result);
  } catch (error) {
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
