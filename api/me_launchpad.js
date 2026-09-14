// GET /api/me_launchpad[?days=30][&debug=1]
// Magic Eden Launchpad calendar for Solana: every launch ME lists (upcoming, live, past).
// Docs: GET /v2/launchpad/collections — no date filter, so we pull the whole list and sort it.
// Launched collections that already trade on the marketplace get a floor price attached,
// so you can see at a glance whether a mint is already above/below its mint price.
import { meFetch, cached, toMs, pick, collectionStats, collectionInfo, mapLimit, meLaunchpadUrl, meCollectionUrl } from "./_magiceden.js";
import { signalFor } from "./_signal.js";

const LIVE_WINDOW = 48 * 3600_000;   // a launch is "live" for two days after its start (ME has no sold-out flag)

async function loadAll() {
  return cached("launchpad:all", 2 * 60_000, async () => {
    const out = [];
    for (let offset = 0; offset < 2000; offset += 500) {
      const { ok, status, body } = await meFetch(`/launchpad/collections?offset=${offset}&limit=500`);
      if (!ok) { if (!out.length) throw new Error(body.error || body.raw || `Magic Eden HTTP ${status}`); break; }
      const list = Array.isArray(body) ? body : body.collections || [];
      out.push(...list);
      if (list.length < 500) break;
    }
    return out;
  });
}

export default async function handler(req, res) {
  const debug = req.query.debug === "1";
  const days = Math.max(0, Math.min(365, Number(req.query.days) || 30));
  const now = Date.now();
  try {
    const raw = await loadAll();
    const seen = new Set();
    const drops = [];
    for (const d of raw) {
      const symbol = pick(d, "symbol", "collectionSymbol");
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      if ((d.chainId || "solana") !== "solana") continue;
      const launchAt = toMs(pick(d, "launchDatetime", "launchDate", "launchTime"));
      let status = "unknown";
      if (launchAt) status = launchAt > now ? "upcoming" : now - launchAt < LIVE_WINDOW ? "live" : "past";
      drops.push({
        symbol,
        name: d.name || symbol,
        description: d.description || "",
        image: d.image || null,
        price: d.price ?? null,            // SOL
        size: d.size ?? null,
        featured: d.featured === true,
        launchAt,
        status,
        contract: d.contractAddress || null,
        url: meLaunchpadUrl(symbol),
        marketUrl: meCollectionUrl(symbol),
      });
    }
    // Everything upcoming, everything live, and past launches inside the window.
    const cutoff = now - days * 86400_000;
    const kept = drops.filter((d) => d.status !== "past" || (d.launchAt && d.launchAt >= cutoff));
    kept.sort((a, b) => {
      const rank = { live: 0, upcoming: 1, past: 2, unknown: 3 };
      return rank[a.status] - rank[b.status] || (a.status === "past" ? b.launchAt - a.launchAt : (a.launchAt || Infinity) - (b.launchAt || Infinity));
    });

    // Secondary-market floor for launched collections — tells you if the mint "worked".
    // Also pick up the categories ME files the collection under, so the UI can group by them.
    const launched = kept.filter((d) => d.status === "live" || d.status === "past").slice(0, 10);
    const withInfo = [...kept.filter((d) => d.status === "upcoming").slice(0, 10), ...launched];
    const [stats, infos] = await Promise.all([
      mapLimit(launched, 2, (d) => collectionStats(d.symbol)),
      mapLimit(withInfo, 2, (d) => collectionInfo(d.symbol)),
    ]);
    launched.forEach((d, i) => { if (stats[i]) { d.floor = stats[i].floor; d.listed = stats[i].listed; d.volume7d = stats[i].volume7d; } });
    withInfo.forEach((d, i) => { if (infos[i]) { d.categories = infos[i].categories; d.badged = infos[i].badged; d.links = infos[i].links; } });
    const sigs = await mapLimit(withInfo, 4, (d) => signalFor({ links: d.links, image: d.image, verified: d.badged, verifiedLabel: "Magic Eden badge" }));
    withInfo.forEach((d, i) => { d.signal = sigs[i] || null; });

    res.setHeader("cache-control", "s-maxage=120, stale-while-revalidate=600");
    res.status(200).json({
      chain: "solana",
      source: "magiceden",
      drops: kept,
      counts: {
        total: kept.length,
        live: kept.filter((d) => d.status === "live").length,
        upcoming: kept.filter((d) => d.status === "upcoming").length,
        past: kept.filter((d) => d.status === "past").length,
        horizonDays: kept.length ? Math.ceil((Math.max(...kept.map((d) => d.launchAt || now)) - now) / 86400_000) : 0,
      },
      ...(debug ? { sample: raw[0], rawCount: raw.length } : {}),
    });
  } catch (err) {
    res.setHeader("cache-control", "no-store");
    res.status(502).json({ error: err.message });
  }
}
