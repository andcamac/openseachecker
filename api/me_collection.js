// GET /api/me_collection?symbol=<me symbol or magiceden.io URL>[&address=<wallet>]
// One Solana collection in depth: info + categories, live stats, cheapest listings, latest
// sales, and (optionally) how many of it a wallet holds.
// Docs: /v2/collections/{symbol}, /stats, /listings, /activities, /wallets/{w}/tokens?collection_symbol=
import { meFetch, cached, isSolAddress, isSymbol, sol, toMs, collectionStats, collectionInfo, meCollectionUrl, meItemUrl } from "./_magiceden.js";

export default async function handler(req, res) {
  let symbol = String(req.query.symbol || "").trim();
  const m = symbol.match(/magiceden\.io\/(?:marketplace|launchpad)\/([a-z0-9._-]+)/i);
  if (m) symbol = m[1];
  if (!isSymbol(symbol)) return res.status(400).json({ error: "Provide a Magic Eden collection symbol or URL" });
  const address = String(req.query.address || "").trim();

  try {
    const [info, stats, listings, acts, held] = await Promise.all([
      collectionInfo(symbol),
      collectionStats(symbol),
      cached(`listings:${symbol}`, 60_000, async () => {
        const { ok, body } = await meFetch(`/collections/${encodeURIComponent(symbol)}/listings?offset=0&limit=8&sort=listPrice&sort_direction=asc`);
        return ok && Array.isArray(body) ? body : [];
      }),
      cached(`colacts:${symbol}`, 60_000, async () => {
        const { ok, body } = await meFetch(`/collections/${encodeURIComponent(symbol)}/activities?offset=0&limit=20`);
        return ok && Array.isArray(body) ? body : [];
      }),
      isSolAddress(address)
        ? cached(`held:${address}:${symbol}`, 90_000, async () => {
            const { ok, body } = await meFetch(`/wallets/${address}/tokens?collection_symbol=${encodeURIComponent(symbol)}&offset=0&limit=100`);
            return ok && Array.isArray(body) ? body.length : null;
          })
        : Promise.resolve(null),
    ]);
    if (!info && !stats) return res.status(404).json({ error: `Magic Eden has no collection "${symbol}"` });

    res.setHeader("cache-control", "no-store");
    res.status(200).json({
      symbol,
      chain: "solana",
      source: "magiceden",
      ...(info || { name: symbol, categories: [] }),
      floor: stats?.floor ?? null,
      listed: stats?.listed ?? null,
      avg24h: stats?.avg24h ?? null,
      volume7d: stats?.volume7d ?? null,
      volumeAll: stats?.volumeAll ?? null,
      url: meCollectionUrl(symbol),
      cheapest: listings.map((l) => ({ mint: l.tokenMint, price: l.price ?? null, seller: l.seller || null, image: l.token?.image || l.extra?.img || null, name: l.token?.name || null, url: l.tokenMint ? meItemUrl(l.tokenMint) : null })),
      sales: acts.filter((a) => a.type === "buyNow" || a.type === "acceptBid" || a.type === "auctionSettled").slice(0, 10)
        .map((a) => ({ mint: a.tokenMint, price: a.price ?? null, at: toMs(a.blockTime), buyer: a.buyer, seller: a.seller, image: a.image || null, url: a.tokenMint ? meItemUrl(a.tokenMint) : null })),
      recentListings: acts.filter((a) => a.type === "list").length,
      held,
    });
  } catch (err) {
    res.setHeader("cache-control", "no-store");
    res.status(502).json({ error: err.message });
  }
}
