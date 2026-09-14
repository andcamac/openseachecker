// GET /api/holdings?address=0x...&chain=ethereum&slug=<collection-slug>
// Does this wallet already hold anything from this collection?
// Used to tell "you minted this" apart from "you missed it" on a finished drop.
// Docs: GET /api/v2/chain/{chain}/account/{address}/nfts?collection=
import { apiKey, osFetch } from "./_opensea.js";

export default async function handler(req, res) {
  const key = apiKey(res); if (!key) return;
  const address = String(req.query.address || "").trim();
  const chain = String(req.query.chain || "ethereum").replace(/[^a-z0-9_]/gi, "");
  const slug = String(req.query.slug || "").trim().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: "Provide a valid 0x address" });
  if (!/^[a-z0-9._-]+$/.test(slug)) return res.status(400).json({ error: "Provide a collection slug" });

  const q = new URLSearchParams({ collection: slug, limit: "50" });
  const { ok, status, body } = await osFetch(key, `/chain/${chain}/account/${address}/nfts?${q}`);

  res.setHeader("cache-control", "no-store");
  if (!ok) return res.status(200).json({ slug, chain, owned: null, unknown: true, reason: body.error || body.detail || `HTTP ${status}` });

  const nfts = body.nfts || [];
  res.status(200).json({
    slug,
    chain,
    owned: nfts.length,                       // capped at 50; enough to answer "did you get one"
    more: !!(body.next && nfts.length >= 50),
    identifiers: nfts.slice(0, 5).map((n) => n.identifier),
  });
}
