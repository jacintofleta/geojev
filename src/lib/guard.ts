import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { LocateResult } from "@/lib/countries";

// Protections against a viral spike or abuse, backed by Upstash Redis:
// a global daily spend cap, per-IP rate limits and a shared answer cache.
// Without Redis credentials (local dev) they are all switched off. If Redis
// errors, rate limits and cache step aside rather than take the app down,
// but the spend cap refuses: no counting, no Jev calls.

/** Jev's price per input token, in USD ($0.042 per million; output is free). */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const DAILY_BUDGET_USD = parseBudget(process.env.DAILY_BUDGET_USD);
const CACHE_SECONDS = 60 * 60 * 24;

/**
 * Reads DAILY_BUDGET_USD, falling back to $10 when it's unset, empty or not a
 * positive number. An empty value would otherwise become $0 and block everything.
 */
function parseBudget(raw: string | undefined): number {
  const budget = Number(raw?.replace(/[$\s]/g, ""));
  if (raw?.trim() && Number.isFinite(budget) && budget > 0) return budget;
  if (raw !== undefined) {
    console.warn(`[guard] Ignoring DAILY_BUDGET_USD=${JSON.stringify(raw)}; using $10.`);
  }
  return 10;
}

const redis =
  (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
  (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
    ? Redis.fromEnv()
    : null;

if (!redis) console.warn("[guard] No Redis configured: spend cap, rate limits and cache are off.");

const limiters = redis
  ? [
      new Ratelimit({ redis, prefix: "rl:minute", limiter: Ratelimit.slidingWindow(20, "1 m") }),
      new Ratelimit({ redis, prefix: "rl:day", limiter: Ratelimit.fixedWindow(200, "1 d") }),
    ]
  : [];

/** Whether this client may ask another question right now. */
export async function allowRequest(ip: string): Promise<boolean> {
  try {
    for (const limiter of limiters) {
      const { success } = await limiter.limit(ip);
      if (!success) return false;
    }
  } catch (error) {
    console.error("[guard] rate limit unavailable", error);
  }
  return true;
}

function cacheKey(query: string, scope: string): string {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  return `answer:v1:${scope}:${normalized}`;
}

export async function getCachedAnswer(query: string, scope: string) {
  try {
    return redis ? await redis.get<LocateResult>(cacheKey(query, scope)) : null;
  } catch (error) {
    console.error("[guard] cache unavailable", error);
    return null;
  }
}

export async function cacheAnswer(query: string, scope: string, result: LocateResult) {
  try {
    await redis?.set(cacheKey(query, scope), result, { ex: CACHE_SECONDS });
  } catch (error) {
    console.error("[guard] cache unavailable", error);
  }
}

function spendKey(): string {
  return `spend:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Reserves the estimated cost of a request against today's budget (UTC).
 * Reserving before calling Jev keeps concurrent requests from overshooting.
 * Returns a function to settle the reservation with the actual token count,
 * "spent" if today's budget is used up, or "unavailable" if Redis is down.
 */
export async function reserveSpend(
  estimatedTokens: number,
): Promise<((actualTokens: number) => Promise<void>) | "spent" | "unavailable"> {
  if (!redis) return async () => {};
  const key = spendKey();
  const estimate = estimatedTokens * USD_PER_INPUT_TOKEN;
  try {
    const spent = await redis.incrbyfloat(key, estimate);
    await redis.expire(key, 60 * 60 * 48);
    if (spent > DAILY_BUDGET_USD) {
      await redis.incrbyfloat(key, -estimate);
      console.warn(`[guard] Daily budget reached: $${spent} of $${DAILY_BUDGET_USD}.`);
      return "spent";
    }
  } catch (error) {
    console.error("[guard] spend tracking unavailable", error);
    return "unavailable";
  }
  return async (actualTokens) => {
    try {
      await redis.incrbyfloat(key, actualTokens * USD_PER_INPUT_TOKEN - estimate);
    } catch (error) {
      console.error("[guard] couldn't settle spend", error);
    }
  };
}
