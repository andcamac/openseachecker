// Shared helpers for the OpenSea public API (documented endpoints only).
const API = "https://api.opensea.io/api/v2";

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

export function apiKey(res) {
  const key = process.env.OPENSEA_API_KEY;
  if (!key) { res.status(500).json({ error: "OPENSEA_API_KEY is not set in Vercel → Settings → Environment Variables (redeploy after adding it)" }); return null; }
  return key;
}

// ---- request pacer ----------------------------------------------------------
// OpenSea allows ~4 requests/second on a standard key. Concurrency limits alone don't
// guarantee that — three callers each "politely" doing one request at a time still burst
// to three at once. So every call in this process queues through one pacer that releases
// requests no closer together than MIN_GAP_MS, and a 429 widens the gap for everyone.
const MIN_GAP_MS = 310;          // ~3.2 req/s — safely under OpenSea's 4/s
const MAX_GAP_MS = 4000;
let gap = MIN_GAP_MS;
let nextSlot = 0;

async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await sleep(at - now);
}
// A 429 means we were already too fast: widen the gap for every caller, then let it decay.
function penalise(retryAfterSec) {
  const wanted = retryAfterSec ? Math.min(MAX_GAP_MS, retryAfterSec * 1000) : Math.min(MAX_GAP_MS, gap * 2);
  gap = Math.max(gap, wanted);
  nextSlot = Math.max(nextSlot, Date.now() + gap);
}
function relax() {
  if (gap > MIN_GAP_MS) gap = Math.max(MIN_GAP_MS, gap - 40);   // ease back after clean responses
}
export const paceState = () => ({ gap, queuedUntil: Math.max(0, nextSlot - Date.now()) });

export async function osFetch(key, path, opts = {}) {
  // Retry the transient statuses, not just 429: a 5xx and a dropped connection are both
  // worth another go, and giving up on one silently is how a wallet listing comes back short.
  let last = { ok: false, status: 0, body: { error: "request failed" } };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await slot();
      const res = await fetch(API + path, {
        ...opts,
        headers: { "X-API-KEY": key, accept: "application/json", "content-type": "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after")) || 0;
        if (res.status === 429) penalise(ra);
        last = { ok: false, status: res.status, body: { error: res.status === 429 ? "OpenSea rate limit" : `OpenSea HTTP ${res.status}` } };
        await sleep(Math.max(ra * 1000, 600 * Math.pow(2, attempt)) + Math.random() * 250);
        continue;
      }
      relax();
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      last = { ok: false, status: 0, body: { error: err.name === "TimeoutError" ? "OpenSea timed out" : err.message } };
      await sleep(500 * (attempt + 1));
    }
  }
  return last;
}

export function slugOf(d) {
  return pick(d, "collectionSlug", "collection_slug", "slug") || pick(d.collection || {}, "slug") || pick(d.collection || {}, "collection");
}

// Socials for a collection (GET /collections/{slug}). Cached per warm function — they rarely change.
const LINKS = new Map();
export async function collectionLinks(key, slug) {
  const hit = LINKS.get(slug);
  if (hit && hit.exp > Date.now()) return hit.val;
  let val = null;
  try {
    const { ok, body } = await osFetch(key, `/collections/${slug}`);
    if (ok) val = {
      website: body.project_url || null,
      twitter: body.twitter_username ? `https://x.com/${body.twitter_username}` : null,
      discord: body.discord_url || null,
      instagram: body.instagram_username ? `https://instagram.com/${body.instagram_username}` : null,
      telegram: body.telegram_url || null,
      verified: ["verified", "approved"].includes(String(body.safelist_status || "").toLowerCase()),
      safelist: body.safelist_status || null,
      owners: body.total_supply ?? null,
    };
  } catch {}
  LINKS.set(slug, { val, exp: Date.now() + 6 * 3600_000 });
  return val;
}
