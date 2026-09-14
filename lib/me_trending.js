// GET /api/me_trending[?range=1h|1d|7d|30d]
// Magic Eden's most-traded Solana collections for the window, with live floor / listed /
// volume and the categories ME files them under (pfps, gaming, art, …) so the UI can group.
// Docs: GET /v2/marketplace/popular_collections, /v2/collections/{symbol}, /stats
import { meFetch, cached, sol, collectionStats, collectionInfo, mapLimit, meCollectionUrl } from "./magiceden.js";
import { signalFor } from "./signal.js";

const RANGES = new Set(["1h", "1d", "7d", "30d"]);

export default async function handler(req, res) {
  const range = RANGES.has(req.query.range) ? req.query.range : "1d";
  try {
    const list = await cached(`popular:${range}`, 5 * 60_000, async () => {
      let { ok, body } = await meFetch(`/marketplace/popular_collections?timeRange=${range}`);
      // Fall back to a wider window if ME has nothing for the short one.
      if (ok && Array.isArray(body) && !body.length && range !== "7d") ({ ok, body } = await meFetch(`/marketplace/popular_collections?timeRange=7d`));
      if (!ok) throw new Error(body.error || body.raw || "Trending collections request failed");
      return (Array.isArray(body) ? body : body.collections || []).slice(0, 24);
    });

    const items = list.map((c) => ({
      symbol: c.symbol,
      name: c.name || c.symbol,
      image: c.image || null,
      description: c.description || "",
      floor: sol(c.floorPrice),
      volumeAll: sol(c.volumeAll),
      hasCNFTs: c.hasCNFTs === true,
      categories: [],
      url: meCollectionUrl(c.symbol),
    })).filter((c) => c.symbol);

    const [stats, infos] = await Promise.all([
      mapLimit(items, 2, (c) => collectionStats(c.symbol)),
      mapLimit(items, 2, (c) => collectionInfo(c.symbol)),
    ]);
    items.forEach((c, i) => {
      if (stats[i]) { c.floor = stats[i].floor ?? c.floor; c.listed = stats[i].listed; c.avg24h = stats[i].avg24h; c.volume7d = stats[i].volume7d; }
      if (infos[i]) { c.categories = infos[i].categories; c.badged = infos[i].badged; c.twitter = infos[i].twitter; c.links = infos[i].links; if (!c.image) c.image = infos[i].image; }
    });
    const sigs = await mapLimit(items, 4, (c) => signalFor({ links: c.links, image: c.image, verified: c.badged, verifiedLabel: "marketplace verified" }));
    items.forEach((c, i) => { c.signal = sigs[i] || null; });

    res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=900");
    res.status(200).json({ chain: "solana", source: "magiceden", range, collections: items });
  } catch (err) {
    res.setHeader("cache-control", "no-store");
    res.status(502).json({ error: err.message });
  }
}
