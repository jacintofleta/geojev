import { APIError, TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { COUNTRY_NAMES, type LocateResult } from "@/lib/countries";

const MAX_QUERY_LENGTH = 400;
// Below this, a country is noise and not worth sending to the client.
const MIN_PROBABILITY = 0.001;

// One option per country; Jev returns a calibrated probability for each.
const criteria = Object.fromEntries(COUNTRY_NAMES.map((name) => [name, null]));

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
      questions: {
        country: choice(
          "Which country does `query` point to? Pick the country the query is about, where it happens, or where its answer is located.",
          criteria,
        ),
        geographic: noul(
          "Does `query` point to a specific country or place in the world?",
          {
            true: "The query names, describes, or asks about something tied to a particular country or place.",
            false: "The query has no connection to any particular place.",
          },
        ),
      },
    });

    const ranked = Object.entries(answers.country.probabilities as Record<string, number>)
      .filter(([, probability]) => probability >= MIN_PROBABILITY)
      .sort((a, b) => b[1] - a[1])
      .map(([name, probability]) => ({ name, probability }));

    const result: LocateResult = {
      query,
      ranked,
      confidence: answers.country.confidence,
      geographic: answers.geographic.noul,
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
