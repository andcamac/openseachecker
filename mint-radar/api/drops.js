// GET /api/drops?chains=ethereum,base[&debug=1]
// Returns drops on OpenSea's calendar (featured + upcoming + recently minted).
import { apiKey, osFetch, pick, slugOf } from "./_opensea.js";

const MAX = 2000;
const TYPES = ["featured", "upcoming", "recently_minted"];

export default async function handler(req, res) {
  const key = apiKey(res); if (!key) return;
  const chains = String(req.query.chains || "").replace(/[^a-z0-9,_-]/gi, "");
  const debug = req.query.debug === "1";

  const bySlug = new Map();
  const errors = [];
  const pages = {};
  let sample = null;

  for (const type of TYPES) {
    let cursor = "";
    pages[type] = 0;
    do {
      const q = new URLSearchParams({ type, limit: "100" });
      if (chains) q.set("chains", chains);
      if (cursor) q.set("cursor", cursor);
      const { ok, status, body } = await osFetch(key, `/drops?${q}`);
      if (!ok) { errors.push({ type, status, error: body.error || body.detail || body.errors || body.raw || "request failed" }); break; }
      pages[type]++;
      const list = body.drops || body.results || [];
      if (!sample && list[0]) sample = list[0];
      for (const d of list) {
        const slug = slugOf(d);
        if (!slug) continue;
        const cur = bySlug.get(slug);
        const entry = {
          slug,
          name: pick(d, "collection_name", "collectionName", "name") || slug,
          chain: d.chain || null,
          image: d.image_url || null,
          contract: d.contract_address || null,
          url: d.opensea_url || `https://opensea.io/collection/${slug}`,
          isMinting: d.is_minting === true,
          activeStage: d.active_stage ? { type: d.active_stage.stage_type, label: d.active_stage.label, end: d.active_stage.end_time } : null,
          nextStage: d.next_stage ? { type: d.next_stage.stage_type, label: d.next_stage.label, start: d.next_stage.start_time } : null,
          lists: [...(cur?.lists || []), type],
        };
        bySlug.set(slug, entry);
      }
      cursor = pick(body, "next", "next_cursor") || "";
    } while (cursor && bySlug.size < MAX);
  }

  const drops = [...bySlug.values()];
  // Check live drops first so hits appear quickly, then drops with a stage coming, then the rest.
  drops.sort((a, b) => (b.isMinting - a.isMinting) || ((b.activeStage ? 1 : 0) - (a.activeStage ? 1 : 0)));

  res.setHeader("cache-control", "s-maxage=120, stale-while-revalidate=600");
  res.status(200).json({
    drops,
    counts: { total: drops.length, minting: drops.filter((d) => d.isMinting).length, withActiveStage: drops.filter((d) => d.activeStage).length },
    errors,
    ...(debug ? { pages, sample } : {}),
  });
}
