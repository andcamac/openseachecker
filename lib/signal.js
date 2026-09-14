// Signal score: how "real" a project looks, from free public signals only.
// - Discord server size and online ratio (discord.com invite API, no key)
// - Marketplace verification (OpenSea safelist status / Magic Eden badge)
// - Presence of website / X / Discord / artwork
// Deliberately cheap: no X API (paid), no Moni. Tiers: COLD < WARM < HOT < BLAZING.
const CACHE = new Map();
const TTL = 60 * 60_000;

export async function discordCounts(url) {
  const m = String(url || "").match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/i);
  if (!m) return null;
  const code = m[1];
  const hit = CACHE.get(code);
  if (hit && hit.exp > Date.now()) return hit.val;
  let val = null;
  try {
    const r = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const j = await r.json();
      val = { members: j.approximate_member_count ?? null, online: j.approximate_presence_count ?? null, name: j.guild?.name || null, boosts: j.guild?.premium_subscription_count ?? null, verified: !!(j.guild?.features || []).some((f) => f === "VERIFIED" || f === "PARTNERED") };
    } else if (r.status === 404 || r.status === 400) val = { dead: true };
  } catch {}
  CACHE.set(code, { val, exp: Date.now() + TTL });
  return val;
}

// inputs: { links:{website,twitter,discord}, image, verified (marketplace), discord:{members,online,dead} }
export function scoreSignal(x) {
  let s = 0; const why = [];
  const L = x.links || {};
  if (L.website) { s += 10; why.push("website"); }
  if (L.twitter) { s += 10; why.push("X"); }
  if (x.image) { s += 5; }
  if (x.verified) { s += 20; why.push(x.verifiedLabel || "verified"); }
  const d = x.discord;
  if (L.discord) {
    if (d?.dead) { s -= 10; why.push("dead Discord invite"); }
    else {
      s += 10; why.push("Discord");
      const m = d?.members || 0, o = d?.online || 0;
      if (m >= 10000) { s += 30; why.push(`${fmt(m)} members`); }
      else if (m >= 2000) { s += 20; why.push(`${fmt(m)} members`); }
      else if (m >= 500) { s += 10; why.push(`${fmt(m)} members`); }
      else if (m) why.push(`${fmt(m)} members`);
      if (m >= 300 && o / m >= 0.12) { s += 10; why.push(`${Math.round((o / m) * 100)}% online`); }
      if (d?.verified) { s += 10; why.push("verified server"); }
    }
  }
  s = Math.max(0, Math.min(100, s));
  const tier = s >= 70 ? "BLAZING" : s >= 45 ? "HOT" : s >= 20 ? "WARM" : "COLD";
  return { score: s, tier, why, discord: d && !d.dead ? { members: d.members, online: d.online } : null };
}
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

// One call does it all: looks up Discord (cached) and scores.
export async function signalFor({ links, image, verified, verifiedLabel }) {
  const discord = links?.discord ? await discordCounts(links.discord) : null;
  return scoreSignal({ links, image, verified, verifiedLabel, discord });
}
