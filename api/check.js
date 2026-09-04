// Vercel serverless function: GET /api/check?address=0x...&chains=ethereum,base
// Uses only OpenSea's documented public API. The API key lives in a Vercel
// environment variable (OPENSEA_API_KEY) and never reaches the browser.

const API = "https://api.opensea.io/api/v2";
const CONCURRENCY = 6;          // parallel requests to OpenSea (keep modest)
const MAX_DROPS = 300;          // safety cap so we stay within the function time limit

// Warm-instance cache for the drop calendar (it changes slowly).
let calendarCache = { at: 0, key: "", drops: [] };
const CALENDAR_TTL_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; };
const toMs = (t) => {
  if (t == null) return null;
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  const n = Number(t);
  if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
};

async function api(key, path, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { "X-API-KEY": key, accept: "application/json", "content-type": "application/json" },
    });
    if (res.status === 429) { await sleep(800 * (attempt + 1)); continue; }
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
  }
  return { ok: false, status: 429, body: { error: "rate limited" } };
}

async function listDrops(key, type, chains) {
  const out = [];
  let cursor = "";
  do {
    const q = new URLSearchParams({ type, limit: "100" });
    if (chains) q.set("chains", chains);
    if (cursor) q.set("cursor", cursor);
    const { ok, body } = await api(key, `/drops?${q}`);
    if (!ok) break;
    out.push(...(body.drops || []));
    cursor = pick(body, "next", "next_cursor", "cursor") || "";
  } while (cursor && out.length < MAX_DROPS);
  return out;
}

async function getCalendar(key, chains) {
  const cacheKey = chains || "*";
  if (calendarCache.key === cacheKey && Date.now() - calendarCache.at < CALENDAR_TTL_MS) return calendarCache.drops;
  const bySlug = new Map();
  for (const type of ["featured", "upcoming", "recently_minted"]) {
    for (const d of await listDrops(key, type, chains)) {
      const slug = pick(d, "collectionSlug", "collection_slug", "slug") || pick(d.collection || {}, "slug");
      if (slug && !bySlug.has(slug)) bySlug.set(slug, d);
    }
  }
  const drops = [...bySlug.entries()].slice(0, MAX_DROPS);
  calendarCache = { at: Date.now(), key: cacheKey, drops };
  return drops;
}

function openStages(drop, now) {
  return (drop.stages || []).filter((s) => {
    const start = toMs(pick(s, "startTime", "start_time"));
    const end = toMs(pick(s, "endTime", "end_time"));
    return (start == null || start <= now) && (end == null || end > now);
  });
}

async function checkOne(key, address, slug, summary, now) {
  const { ok, body: drop } = await api(key, `/drops/${slug}`);
  const name = pick(drop, "collectionName", "collection_name", "name") || pick(summary, "collectionName", "collection_name") || slug;
  if (!ok) return { slug, name, status: "skipped", reason: "details unavailable" };

  const open = openStages(drop, now);
  const minted = Number(pick(drop, "totalSupply", "total_supply") ?? NaN);
  const max = Number(pick(drop, "maxSupply", "max_supply") ?? NaN);
  const soldOut = !Number.isNaN(minted) && !Number.isNaN(max) && max > 0 && minted >= max;

  if (open.length === 0) {
    const next = (drop.stages || []).map((s) => toMs(pick(s, "startTime", "start_time"))).filter((t) => t && t > now).sort((a, b) => a - b)[0];
    return { slug, name, status: "not_open", nextStart: next || null };
  }
  if (soldOut) return { slug, name, status: "sold_out" };

  const mint = await api(key, `/drops/${slug}/mint`, { method: "POST", body: JSON.stringify({ minter: address, quantity: 1 }) });
  const tx = mint.body || {};
  const built = mint.ok && (pick(tx, "calldata", "data") || pick(tx, "target", "to"));

  const stages = open.map((s) => ({
    label: pick(s, "label", "name", "stage") || "stage",
    price: pick(s, "price", "mint_price") ?? null,
    maxPerWallet: pick(s, "maxPerWallet", "max_per_wallet", "per_wallet_limit") ?? null,
    endTime: toMs(pick(s, "endTime", "end_time")),
  }));
  const looksPublic = stages.some((s) => /public/i.test(String(s.label)));

  return built
    ? { slug, name, status: "eligible", chain: pick(drop, "chain") || pick(summary, "chain") || null, stages, looksPublic, minted: Number.isNaN(minted) ? null : minted, max: Number.isNaN(max) ? null : max, value: tx.value ?? null, url: `https://opensea.io/collection/${slug}/overview` }
    : { slug, name, status: "not_eligible", reason: tx.error || tx.detail || tx.message || `HTTP ${mint.status}` };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  }));
  return results;
}

export default async function handler(req, res) {
  const key = process.env.OPENSEA_API_KEY;
  if (!key) return res.status(500).json({ error: "OPENSEA_API_KEY is not set in Vercel environment variables" });

  const address = String(req.query.address || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: "Provide a valid 0x address" });
  const chains = String(req.query.chains || "").replace(/[^a-z0-9,_-]/gi, "");

  const now = Date.now();
  const calendar = await getCalendar(key, chains);
  const results = await mapLimit(calendar, CONCURRENCY, ([slug, summary]) => checkOne(key, address, slug, summary, now));

  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    address,
    scanned: calendar.length,
    checkedAt: now,
    eligible: results.filter((r) => r.status === "eligible"),
    others: results.filter((r) => r.status !== "eligible"),
  });
}
