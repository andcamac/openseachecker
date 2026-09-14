// Shared helpers for the Magic Eden Solana API v2 (public, documented endpoints only).
// Docs: https://docs.magiceden.io/reference/solana-overview
//
// Without a key Magic Eden allows ~120 requests/minute (2 QPS). A key raises that and is
// sent as `Authorization: Bearer <key>`; set MAGICEDEN_API_KEY in Vercel to use one.
// Every read here is cached in-memory (per warm function) and at the edge, so the
// scanner stays well under the unauthenticated limit.
const API = "https://api-mainnet.magiceden.dev/v2";
const LAMPORTS = 1e9;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; };
export const toMs = (t) => {
  if (t == null) return null;
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  const n = Number(t);
  if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n;
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
};
export const sol = (lamports) => (lamports == null || Number.isNaN(Number(lamports)) ? null : Number(lamports) / LAMPORTS);

// Solana addresses are base58, 32–44 chars, no 0 O I l.
export const isSolAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || ""));
export const isSymbol = (s) => /^[a-z0-9._-]{1,64}$/i.test(String(s || ""));

// Tiny TTL cache. Vercel keeps a function warm between calls, so repeated scans of the
// same wallet / calendar reuse these instead of burning rate limit.
const CACHE = new Map();
export async function cached(key, ttlMs, fn) {
  const hit = CACHE.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  if (val !== undefined) CACHE.set(key, { val, exp: Date.now() + ttlMs });
  if (CACHE.size > 2000) for (const k of [...CACHE.keys()].slice(0, 500)) CACHE.delete(k);
  return val;
}

// Serialised request queue: never more than ~2 requests in flight per second.
let lastAt = 0;
async function throttle() {
  const gap = process.env.MAGICEDEN_API_KEY ? 60 : 520;
  const wait = lastAt + gap - Date.now();
  lastAt = Math.max(Date.now(), lastAt + gap);
  if (wait > 0) await sleep(wait);
}

export async function meFetch(path, opts = {}) {
  const headers = { accept: "application/json" };
  if (process.env.MAGICEDEN_API_KEY) headers.authorization = `Bearer ${process.env.MAGICEDEN_API_KEY}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(API + path, { ...opts, headers, signal: AbortSignal.timeout(9000) });
    } catch (e) {
      if (attempt === 2) return { ok: false, status: 0, body: { error: e.message } };
      continue;
    }
    if (res.status === 429) { await sleep(900 * (attempt + 1)); continue; }
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, body };
  }
  return { ok: false, status: 429, body: { error: "Magic Eden rate limit — try again in a moment" } };
}

// Run `fn` over items with a small concurrency cap; failures become null.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length).fill(null);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; } }
  }));
  return out;
}

// GET /collections/{symbol}/stats → { floor (SOL), listed, avg24h (SOL), volume7d / volumeAll (SOL) }
export async function collectionStats(symbol) {
  return cached(`stats:${symbol}`, 3 * 60_000, async () => {
    const { ok, body } = await meFetch(`/collections/${encodeURIComponent(symbol)}/stats`);
    if (!ok) return null;
    return {
      symbol,
      floor: sol(body.floorPrice),
      listed: body.listedCount ?? null,
      avg24h: sol(body.avgPrice24hr),
      volume7d: sol(body.volume7d),
      volumeAll: sol(body.volumeAll),
    };
  });
}

// GET /collections/{symbol} → name, image, categories, socials. 404s are cached too.
export async function collectionInfo(symbol) {
  return cached(`info:${symbol}`, 30 * 60_000, async () => {
    const { ok, body } = await meFetch(`/collections/${encodeURIComponent(symbol)}`);
    if (!ok) return null;
    return {
      symbol,
      name: body.name || symbol,
      image: body.image || null,
      description: body.description || "",
      categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
      twitter: body.twitter || null,
      discord: body.discord || null,
      website: body.website || null,
      badged: body.isBadged === true,
      hasCNFTs: body.hasCNFTs === true,
    };
  });
}

export const meCollectionUrl = (symbol) => `https://magiceden.io/marketplace/${encodeURIComponent(symbol)}`;
export const meLaunchpadUrl = (symbol) => `https://magiceden.io/launchpad/${encodeURIComponent(symbol)}`;
export const meItemUrl = (mint) => `https://magiceden.io/item-details/${encodeURIComponent(mint)}`;
