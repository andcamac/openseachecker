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

export async function osFetch(key, path, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { "X-API-KEY": key, accept: "application/json", "content-type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 429) { await sleep(700 * (attempt + 1)); continue; }
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, body };
  }
  return { ok: false, status: 429, body: { error: "OpenSea rate limit — try again in a moment" } };
}

export function slugOf(d) {
  return pick(d, "collectionSlug", "collection_slug", "slug") || pick(d.collection || {}, "slug") || pick(d.collection || {}, "collection");
}
