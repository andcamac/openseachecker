// GET /api/alerts_tick?secret=<ALERTS_SECRET> — run every 5 minutes (Vercel Cron or cron-job.org).
// Looks at everything the page can see (OpenSea calendar, Magic Eden launchpad, on-chain mints),
// finds watched items whose phase opens within 10 minutes or has just opened, new on-chain
// deployments for /new subscribers, and OpenSea drops a watched wallet just became eligible for,
// then messages the right Telegram chats. Dedupes with short-lived Redis markers.
import { enabled, redis, pipeline, tgSend, K, esc, SECRET, selfBase } from "./_alerts.js";

const T_SOON = 10 * 60_000;
const toMs = (t) => { if (t == null) return null; if (typeof t === "number") return t < 1e12 ? t * 1000 : t; const n = Number(t); if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n; const d = Date.parse(t); return Number.isNaN(d) ? null : d; };
const cd = (ms) => { let s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const sol = (n) => (n == null ? "" : n === 0 ? "FREE" : `◎${Number(n) >= 1 ? Number(n).toFixed(2) : Number(n).toFixed(3)}`);
const eth = (wei) => { const n = Number(wei); return Number.isFinite(n) ? (n === 0 ? "FREE" : (n / 1e18).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " ETH") : ""; };

export default async function handler(req, res) {
  if (!enabled()) return res.status(200).json({ ok: false, reason: "alerts not configured" });
  const CRON = process.env.CRON_SECRET || "";
  const auth = req.headers.authorization || "";
  const okSecret = (!SECRET && !CRON) || req.query.secret === SECRET || (SECRET && auth === `Bearer ${SECRET}`) || (CRON && auth === `Bearer ${CRON}`);
  if (!okSecret) return res.status(401).json({ error: "bad secret" });
  const base = selfBase(req);
  const now = Date.now();
  const get = async (p) => { try { const r = await fetch(base + p, { signal: AbortSignal.timeout(25_000) }); return r.ok ? r.json() : null; } catch { return null; } };
  const [os, me, oc] = await Promise.all([get("/api/drops"), get("/api/me_launchpad?days=1"), get("/api/sol_mints")]);

  // Unified view: id -> {name, url, nextStart, live, price, extra}
  const items = new Map();
  for (const d of os?.drops || []) items.set("os:" + d.slug, { name: d.name, url: d.url, nextStart: toMs(d.nextStage?.start), live: d.isMinting || !!d.activeStage, phase: d.nextStage?.label || d.activeStage?.label || "", chain: d.chain });
  for (const l of me?.drops || []) items.set("me:lp:" + l.symbol, { name: l.name, url: l.url, nextStart: l.status === "upcoming" ? l.launchAt : null, live: l.status === "live", price: sol(l.price), chain: "solana" });
  for (const m of oc?.mints || []) items.set("cm:" + m.candyMachine, { name: m.name, url: m.collectionUrl || m.url, nextStart: m.nextStart, live: m.status === "live", price: m.phase?.priceSol != null ? sol(m.phase.priceSol) : "", chain: "solana", deployedNow: m.deployedNow, minted: `${m.itemsRedeemed}/${m.itemsAvailable || "?"}`, risk: !(m.links?.website || m.links?.twitter || m.links?.discord) });

  const sends = [];   // {chat, key, ttl, text}
  const queue = (chat, key, ttl, text) => sends.push({ chat, key, ttl, text });

  // 1. Watched items: 10-min warning and "opened" (also refresh /list metadata).
  const watchedKeys = await redis("KEYS", "w:item:*");
  const metaUpdates = [];
  for (const k of watchedKeys || []) {
    const id = k.slice("w:item:".length);
    if (id === "new" || id.startsWith("wallet:")) continue;
    const it = items.get(id); if (!it) continue;
    metaUpdates.push(["SET", K.meta(id), JSON.stringify({ name: it.name, url: it.url })]);
    const chats = await redis("SMEMBERS", k);
    if (!chats?.length) continue;
    const link = `<a href="${esc(it.url)}">${esc(it.name)}</a>`;
    if (it.nextStart && it.nextStart > now && it.nextStart - now <= T_SOON) for (const c of chats) queue(c, `soon:${id}:${Math.floor(it.nextStart / 60000)}`, 3600, `⏰ <b>${link}</b> opens in ${cd(it.nextStart - now)}${it.phase ? ` — ${esc(it.phase)}` : ""}${it.price ? ` · ${esc(it.price)}` : ""}`);
    if (it.live) for (const c of chats) queue(c, `live:${id}`, 6 * 3600, `🟢 <b>${link}</b> is minting now${it.price ? ` · ${esc(it.price)}` : ""}${it.minted ? ` · ${esc(it.minted)}` : ""}`);
  }
  if (metaUpdates.length) await pipeline(metaUpdates);

  // 2. New on-chain deployments for /new subscribers.
  const newSubs = await redis("SMEMBERS", K.item("new"));
  if (newSubs?.length) for (const [id, it] of items) if (id.startsWith("cm:") && it.deployedNow) for (const c of newSubs) queue(c, `new:${id}`, 24 * 3600, `🆕 New Solana candy machine: <b><a href="${esc(it.url)}">${esc(it.name)}</a></b>${it.price ? ` · ${esc(it.price)}` : ""} · ${esc(it.minted)}${it.risk ? " · ⚠ no site/socials" : ""}\n<code>/watch ${esc(id)}</code>`);

  // 3. Wallet eligibility: only against drops with a stage open right now (cheap, and that's when it matters).
  const walletKeys = (watchedKeys || []).filter((k) => k.startsWith("w:item:wallet:0x"));
  if (walletKeys.length) {
    const liveOs = (os?.drops || []).filter((d) => d.isMinting || d.activeStage).slice(0, 40);
    for (const k of walletKeys) {
      const addr = k.slice("w:item:wallet:".length);
      const chats = await redis("SMEMBERS", k); if (!chats?.length) continue;
      for (const d of liveOs) {
        const r = await get(`/api/check?address=${addr}&slug=${encodeURIComponent(d.slug)}`);
        if (r?.status === "eligible" && !r.looksPublic) {
          const st = (r.openStages || [])[0];
          for (const c of chats) queue(c, `elig:${addr}:${d.slug}:${st?.startTime || 0}`, 24 * 3600, `✅ <code>${esc(addr.slice(0, 6))}…${esc(addr.slice(-4))}</code> can mint <b><a href="${esc(r.url)}">${esc(r.name)}</a></b> — ${esc(st?.label || "allowlist")}${st?.price != null ? ` · ${esc(eth(st.price))}` : ""}${st?.endTime ? ` · ends in ${cd(st.endTime - now)}` : ""}`);
        }
      }
    }
  }

  // Send with dedupe.
  let sent = 0;
  for (const s of sends) {
    const fresh = await redis("SET", K.sent(s.chat, s.key), "1", "NX", "EX", s.ttl);
    if (fresh === "OK") { if (await tgSend(s.chat, s.text)) sent++; }
  }
  res.setHeader("cache-control", "no-store");
  res.status(200).json({ ok: true, items: items.size, watched: (watchedKeys || []).length, queued: sends.length, sent, at: new Date(now).toISOString() });
}
