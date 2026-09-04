// GET /api/drops?chains=ethereum,base[&debug=1]
// Returns the list of drop slugs on OpenSea's calendar (featured + upcoming + recently minted).
import { apiKey, osFetch, pick, slugOf } from "./_opensea.js";

const MAX = 250;

export default async function handler(req, res) {
  const key = apiKey(res); if (!key) return;
  const chains = String(req.query.chains || "").replace(/[^a-z0-9,_-]/gi, "");
  const debug = req.query.debug === "1";

  const bySlug = new Map();
  const errors = [];
  let sample = null;

  for (const type of ["featured", "upcoming", "recently_minted"]) {
    let cursor = "";
    do {
      const q = new URLSearchParams({ type, limit: "100" });
      if (chains) q.set("chains", chains);
      if (cursor) q.set("cursor", cursor);
      const { ok, status, body } = await osFetch(key, `/drops?${q}`);
      if (!ok) { errors.push({ type, status, error: body.error || body.detail || body.errors || body.raw || "request failed" }); break; }
      const list = body.drops || body.results || [];
      if (!sample && list[0]) sample = list[0];
      for (const d of list) {
        const slug = slugOf(d);
        if (slug && !bySlug.has(slug)) bySlug.set(slug, { slug, name: pick(d, "collectionName", "collection_name", "name") || slug, chain: pick(d, "chain") || null });
      }
      cursor = pick(body, "next", "next_cursor") || "";
    } while (cursor && bySlug.size < MAX);
  }

  res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({
    drops: [...bySlug.values()].slice(0, MAX),
    errors,
    ...(debug ? { sample } : {}),
  });
}
