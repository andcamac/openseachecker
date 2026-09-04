// GET /api/check?address=0x...&slug=<collection-slug>[&debug=1]
// Checks ONE drop: is a stage open, and can OpenSea build a mint tx for this address?
import { apiKey, osFetch, pick, toMs } from "./_opensea.js";

const fmtStage = (s) => s && ({
  type: s.stage_type || null,
  label: s.label || s.stage_type || "stage",
  price: s.price ?? null,
  maxPerWallet: s.max_per_wallet ?? null,
  allowlistCount: s.allowlist_wallet_count ?? null,
  startTime: toMs(s.start_time),
  endTime: toMs(s.end_time),
});

export default async function handler(req, res) {
  const key = apiKey(res); if (!key) return;
  const address = String(req.query.address || "").trim();
  const slug = String(req.query.slug || "").trim().toLowerCase();
  const debug = req.query.debug === "1";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: "Provide a valid 0x address" });
  if (!/^[a-z0-9._-]+$/.test(slug)) return res.status(400).json({ error: "Provide a collection slug" });

  res.setHeader("cache-control", "no-store");
  const now = Date.now();

  const det = await osFetch(key, `/drops/${slug}`);
  const drop = det.body || {};
  const name = drop.collection_name || pick(drop, "collectionName", "name") || slug;
  const base = { slug, name, chain: drop.chain || null, url: drop.opensea_url || `https://opensea.io/collection/${slug}`, ...(debug ? { raw: drop } : {}) };
  if (!det.ok) return res.status(200).json({ ...base, status: det.status === 404 ? "not_a_drop" : "skipped", reason: drop.error || drop.detail || `HTTP ${det.status}` });

  const stages = (drop.stages || []).map(fmtStage);
  // Prefer OpenSea's own view of what's active; fall back to our clock if it's missing.
  let open = drop.active_stage ? [fmtStage(drop.active_stage)] : stages.filter((s) => (s.startTime == null || s.startTime <= now) && (s.endTime == null || s.endTime > now));
  // Some drops have an allowlist stage running alongside the "active" one; include any other stage that's open now.
  for (const s of stages) if (!open.some((o) => o.label === s.label && o.startTime === s.startTime) && (s.startTime == null || s.startTime <= now) && (s.endTime == null || s.endTime > now)) open.push(s);

  const minted = Number(drop.total_supply ?? NaN);
  const max = Number(drop.max_supply ?? NaN);
  const soldOut = !Number.isNaN(minted) && !Number.isNaN(max) && max > 0 && minted >= max;
  const supply = { minted: Number.isNaN(minted) ? null : minted, max: Number.isNaN(max) ? null : max, isMinting: drop.is_minting === true };

  if (open.length === 0) {
    const nextStage = drop.next_stage ? fmtStage(drop.next_stage) : stages.filter((s) => s.startTime && s.startTime > now).sort((a, b) => a.startTime - b.startTime)[0] || null;
    return res.status(200).json({ ...base, ...supply, status: "not_open", nextStart: nextStage?.startTime || null, nextStage });
  }
  if (soldOut) return res.status(200).json({ ...base, ...supply, status: "sold_out", stages: open });

  const mint = await osFetch(key, `/drops/${slug}/mint`, { method: "POST", body: JSON.stringify({ minter: address, quantity: 1 }) });
  const tx = mint.body || {};
  const built = mint.ok && (pick(tx, "calldata", "data") || pick(tx, "target", "to"));
  const looksPublic = open.some((s) => s.type === "public_sale" || /public/i.test(String(s.label)));

  if (built) {
    return res.status(200).json({ ...base, ...supply, status: "eligible", stages: open, looksPublic, value: tx.value ?? null, ...(debug ? { mintRaw: tx } : {}) });
  }
  return res.status(200).json({
    ...base, ...supply, status: "not_eligible", stages: open, looksPublic,
    httpStatus: mint.status,
    reason: tx.error || tx.detail || tx.message || (tx.errors && JSON.stringify(tx.errors)) || tx.raw || `HTTP ${mint.status}`,
    ...(debug ? { mintRaw: tx } : {}),
  });
}
