// GET /api/check?address=0x...&slug=<collection-slug>[&debug=1]
// Checks ONE drop: which stages are open, and can OpenSea build a mint tx for this address?
// Uses only OpenSea's documented public API. Never sends a transaction.
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
const sameStage = (a, b) => a.label === b.label && a.startTime === b.startTime;

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
  const base = {
    slug,
    name: drop.collection_name || pick(drop, "collectionName", "name") || slug,
    chain: drop.chain || null,
    image: drop.image_url || null,
    contract: drop.contract_address || null,
    url: drop.opensea_url || `https://opensea.io/collection/${slug}`,
    ...(debug ? { raw: drop } : {}),
  };
  if (!det.ok) return res.status(200).json({ ...base, status: det.status === 404 ? "not_a_drop" : "skipped", reason: drop.error || drop.detail || `HTTP ${det.status}` });

  // Every stage, in time order — the card renders the whole timeline, not just what's open.
  const all = (drop.stages || []).map(fmtStage).sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  const isOpen = (s) => (s.startTime == null || s.startTime <= now) && (s.endTime == null || s.endTime > now);
  const open = [];
  if (drop.active_stage) open.push(fmtStage(drop.active_stage));            // OpenSea's own view first
  for (const s of all) if (isOpen(s) && !open.some((o) => sameStage(o, s))) open.push(s); // plus anything else live now

  const minted = Number(drop.total_supply ?? NaN);
  const max = Number(drop.max_supply ?? NaN);
  const soldOut = !Number.isNaN(minted) && !Number.isNaN(max) && max > 0 && minted >= max;
  const nextStage = drop.next_stage ? fmtStage(drop.next_stage) : all.filter((s) => s.startTime && s.startTime > now)[0] || null;
  const common = {
    ...base,
    minted: Number.isNaN(minted) ? null : minted,
    max: Number.isNaN(max) ? null : max,
    isMinting: drop.is_minting === true,
    allStages: all,
    openStages: open,
    nextStage,
    nextStart: nextStage?.startTime || null,
  };

  if (open.length === 0) return res.status(200).json({ ...common, status: "not_open" });
  if (soldOut) return res.status(200).json({ ...common, status: "sold_out" });

  const mint = await osFetch(key, `/drops/${slug}/mint`, { method: "POST", body: JSON.stringify({ minter: address, quantity: 1 }) });
  const tx = mint.body || {};
  const built = mint.ok && (pick(tx, "calldata", "data") || pick(tx, "target", "to"));
  const looksPublic = open.some((s) => s.type === "public_sale" || /public/i.test(String(s.label)));

  if (built) return res.status(200).json({ ...common, status: "eligible", looksPublic, value: tx.value ?? null, ...(debug ? { mintRaw: tx } : {}) });

  // OpenSea validates the whole transaction (allowlist AND balance AND limits), so read the refusal.
  const reason = tx.error || tx.detail || tx.message || (tx.errors && JSON.stringify(tx.errors)) || tx.raw || `HTTP ${mint.status}`;
  const r = String(reason).toLowerCase();
  let status = "not_eligible";
  if (/insufficient (balance|funds)|not enough (eth|balance|funds)/.test(r)) status = looksPublic ? "eligible_unfunded" : "allowlist_unfunded";
  else if (/limit|max(imum)? per wallet|already minted|exceed/.test(r)) status = "limit_reached";
  else if (looksPublic) status = "public_error";

  return res.status(200).json({ ...common, status, looksPublic, httpStatus: mint.status, reason, ...(debug ? { mintRaw: tx } : {}) });
}
