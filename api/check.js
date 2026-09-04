// GET /api/check?address=0x...&slug=<collection-slug>[&debug=1]
// Checks ONE drop: is there an open stage, and can OpenSea build a mint tx for this address?
import { apiKey, osFetch, pick, toMs } from "./_opensea.js";

export default async function handler(req, res) {
  const key = apiKey(res); if (!key) return;
  const address = String(req.query.address || "").trim();
  const slug = String(req.query.slug || "").trim();
  const debug = req.query.debug === "1";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: "Provide a valid 0x address" });
  if (!/^[a-z0-9._-]+$/i.test(slug)) return res.status(400).json({ error: "Provide a slug" });

  res.setHeader("cache-control", "no-store");
  const now = Date.now();

  const det = await osFetch(key, `/drops/${slug}`);
  const drop = det.body || {};
  const name = pick(drop, "collectionName", "collection_name", "name") || slug;
  if (!det.ok) return res.status(200).json({ slug, name, status: "skipped", reason: drop.error || drop.detail || `HTTP ${det.status}`, ...(debug ? { raw: drop } : {}) });

  const stages = (drop.stages || []).map((s) => ({
    label: pick(s, "label", "name", "stage", "stage_type") || "stage",
    price: pick(s, "price", "mint_price") ?? null,
    maxPerWallet: pick(s, "maxPerWallet", "max_per_wallet", "per_wallet_limit") ?? null,
    startTime: toMs(pick(s, "startTime", "start_time")),
    endTime: toMs(pick(s, "endTime", "end_time")),
  }));
  const open = stages.filter((s) => (s.startTime == null || s.startTime <= now) && (s.endTime == null || s.endTime > now));
  const minted = Number(pick(drop, "totalSupply", "total_supply") ?? NaN);
  const max = Number(pick(drop, "maxSupply", "max_supply") ?? NaN);
  const soldOut = !Number.isNaN(minted) && !Number.isNaN(max) && max > 0 && minted >= max;
  const base = { slug, name, chain: pick(drop, "chain") || null, url: `https://opensea.io/collection/${slug}/overview`, ...(debug ? { raw: drop } : {}) };

  if (open.length === 0) {
    const next = stages.map((s) => s.startTime).filter((t) => t && t > now).sort((a, b) => a - b)[0] || null;
    return res.status(200).json({ ...base, status: "not_open", nextStart: next });
  }
  if (soldOut) return res.status(200).json({ ...base, status: "sold_out" });

  const mint = await osFetch(key, `/drops/${slug}/mint`, { method: "POST", body: JSON.stringify({ minter: address, quantity: 1 }) });
  const tx = mint.body || {};
  const built = mint.ok && (pick(tx, "calldata", "data") || pick(tx, "target", "to"));

  if (built) {
    return res.status(200).json({
      ...base, status: "eligible", stages: open,
      looksPublic: open.some((s) => /public/i.test(String(s.label))),
      minted: Number.isNaN(minted) ? null : minted, max: Number.isNaN(max) ? null : max,
      value: tx.value ?? null,
    });
  }
  return res.status(200).json({ ...base, status: "not_eligible", stages: open, reason: tx.error || tx.detail || tx.message || (tx.errors && JSON.stringify(tx.errors)) || `HTTP ${mint.status}`, ...(debug ? { mintRaw: tx } : {}) });
}
