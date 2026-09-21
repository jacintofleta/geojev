import { findLevel, getRegions } from "@/lib/regions";

export async function GET(_request: Request, ctx: RouteContext<"/api/regions/[iso3]/[level]">) {
  const { iso3, level } = await ctx.params;
  if (!findLevel(iso3, level)) {
    return Response.json({ error: "No regions for that country." }, { status: 404 });
  }
  try {
    const regions = await getRegions(iso3, level);
    return Response.json(regions, {
      // Boundaries rarely change; let the CDN keep the processed result.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("[regions]", error);
    return Response.json({ error: "Couldn't load the regions." }, { status: 502 });
  }
}
