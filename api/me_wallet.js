// GET /api/me_wallet?address=<solana address>[&debug=1]
// Everything Magic Eden knows about a Solana wallet, in one call:
//   - NFTs it holds, grouped by collection (GET /wallets/{address}/tokens)
//   - floor price per collection → estimated portfolio value (GET /collections/{symbol}/stats)
//   - recent marketplace activity: buys, sells, listings, bids (GET /wallets/{address}/activities)
//   - SOL sitting in the ME escrow (GET /wallets/{address}/escrow_balance)
// Read-only. Nothing is signed or sent.
import { meFetch, cached, isSolAddress, pick, toMs, sol, collectionStats, collectionInfo, mapLimit, meCollectionUrl, meItemUrl } from "./_magiceden.js";
import { signalFor } from "./_signal.js";

const MAX_TOKENS = 1500;
const STATS_FOR = 20;   // collections to price (largest holdings first)

async function tokens(address) {
  return cached(`tokens:${address}`, 90_000, async () => {
    const out = [];
    for (let offset = 0; offset < MAX_TOKENS; offset += 500) {
      const { ok, status, body } = await meFetch(`/wallets/${address}/tokens?offset=${offset}&limit=500&listStatus=both`);
      if (!ok) { if (!out.length) throw new Error(body.error || body.message || body.raw || `Marketplace HTTP ${status}`); break; }
      const list = Array.isArray(body) ? body : body.tokens || [];
      out.push(...list);
      if (list.length < 500) break;
    }
    return out;
  });
}

async function activities(address) {
  return cached(`acts:${address}`, 90_000, async () => {
    const { ok, body } = await meFetch(`/wallets/${address}/activities?offset=0&limit=100`);
    return ok && Array.isArray(body) ? body : [];
  });
}

async function escrow(address) {
  return cached(`escrow:${address}`, 90_000, async () => {
    const { ok, body } = await meFetch(`/wallets/${address}/escrow_balance`);
    if (!ok) return null;
    const b = Number(body.balance ?? body.escrowBalance);
    if (!Number.isFinite(b)) return null;
    return b > 1e6 ? sol(b) : b;   // ME reports SOL; guard in case it ever switches to lamports
  });
}

const ACT_LABEL = {
  buyNow: "bought", bid: "bid", cancelBid: "bid cancelled", list: "listed", delist: "delisted",
  mint: "minted", auctionSettled: "auction settled", acceptBid: "bid accepted", transfer: "transferred",
};

export default async function handler(req, res) {
  const address = String(req.query.address || "").trim();
  const debug = req.query.debug === "1";
  if (!isSolAddress(address)) return res.status(400).json({ error: "Provide a valid Solana wallet address" });
  res.setHeader("cache-control", "no-store");

  try {
    const [toks, acts, escrowSol] = await Promise.all([tokens(address), activities(address), escrow(address)]);

    // Group NFTs by collection.
    const byCol = new Map();
    for (const t of toks) {
      const symbol = pick(t, "collection", "collectionSymbol") || "__uncollected";
      if (!byCol.has(symbol)) byCol.set(symbol, { symbol, name: pick(t, "collectionName", "collectionTitle") || (symbol === "__uncollected" ? "No collection" : symbol), image: null, count: 0, listed: 0, items: [] });
      const g = byCol.get(symbol);
      g.count++;
      if (t.listStatus === "listed") g.listed++;
      if (!g.image && t.image) g.image = t.image;
      if (g.items.length < 12) g.items.push({
        mint: t.mintAddress, name: t.name || "", image: t.image || null,
        listed: t.listStatus === "listed", price: t.price ?? null,
        url: t.mintAddress ? meItemUrl(t.mintAddress) : null,
      });
    }
    const collections = [...byCol.values()].sort((a, b) => b.count - a.count);

    // Price the biggest collections; pull ME categories so the UI can group holdings by category.
    const priced = collections.filter((c) => c.symbol !== "__uncollected").slice(0, STATS_FOR);
    const [stats, infos] = await Promise.all([
      mapLimit(priced, 2, (c) => collectionStats(c.symbol)),
      mapLimit(priced, 2, (c) => collectionInfo(c.symbol)),
    ]);
    let valueSol = 0, pricedCount = 0;
    priced.forEach((c, i) => {
      if (stats[i]) {
        c.floor = stats[i].floor; c.listedCount = stats[i].listed; c.volume7d = stats[i].volume7d;
        if (c.floor != null) { c.value = c.floor * c.count; valueSol += c.value; pricedCount++; }
      }
      if (infos[i]) { c.categories = infos[i].categories; c.badged = infos[i].badged; c.links = infos[i].links; if (!c.image) c.image = infos[i].image; if (infos[i].name) c.name = infos[i].name; }
      c.url = meCollectionUrl(c.symbol);
    });
    const sigs = await mapLimit(priced, 4, (c) => signalFor({ links: c.links, image: c.image, verified: c.badged, verifiedLabel: "marketplace verified" }));
    priced.forEach((c, i) => { c.signal = sigs[i] || null; });

    const activity = acts.map((a) => ({
      type: a.type || "unknown",
      label: ACT_LABEL[a.type] || String(a.type || "activity").replace(/([A-Z])/g, " $1").toLowerCase(),
      collection: pick(a, "collectionSymbol", "collection") || null,
      mint: a.tokenMint || null,
      price: a.price ?? null,              // SOL
      at: toMs(a.blockTime),
      image: a.image || null,
      signature: a.signature || null,
      buyer: a.buyer || null,
      seller: a.seller || null,
      side: a.buyer === address ? "buy" : a.seller === address ? "sell" : null,
      url: a.tokenMint ? meItemUrl(a.tokenMint) : null,
    })).sort((a, b) => (b.at || 0) - (a.at || 0));

    res.status(200).json({
      address,
      chain: "solana",
      source: "magiceden",
      nfts: toks.length,
      more: toks.length >= MAX_TOKENS,
      collections,
      portfolio: { valueSol, pricedCollections: pricedCount, unpricedCollections: collections.length - pricedCount, escrowSol },
      activity,
      ...(debug ? { sampleToken: toks[0], sampleActivity: acts[0] } : {}),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}
