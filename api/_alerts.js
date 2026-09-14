// Shared plumbing for Telegram alerts.
// Storage is Upstash Redis over REST (free tier is plenty): set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN. Bot: TELEGRAM_BOT_TOKEN (+ TELEGRAM_BOT_USERNAME for deep links).
// ALERTS_SECRET protects the webhook and the cron tick.
const R_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const TG = process.env.TELEGRAM_BOT_TOKEN || "";
export const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "";
export const SECRET = process.env.ALERTS_SECRET || "";
export const enabled = () => !!(R_URL && R_TOK && TG);

export async function redis(...cmd) {
  const r = await fetch(R_URL, { method: "POST", headers: { authorization: `Bearer ${R_TOK}`, "content-type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (j.error) throw new Error("redis: " + j.error);
  return j.result;
}
export async function pipeline(cmds) {
  const r = await fetch(R_URL + "/pipeline", { method: "POST", headers: { authorization: `Bearer ${R_TOK}`, "content-type": "application/json" }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(8000) });
  return (await r.json()).map((x) => x.result);
}

export async function tgSend(chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }),
    signal: AbortSignal.timeout(8000),
  });
  return r.ok;
}

// Watch keys: item ids as used by the UI ("os:<slug>", "me:lp:<symbol>", "cm:<candyMachine>"),
// plus the pseudo-items "new" (every new on-chain deployment) and "wallet:<address>".
export const K = {
  item: (id) => `w:item:${id}`,          // set of chat ids
  chat: (c) => `w:chat:${c}`,            // set of ids
  sent: (c, k) => `sent:${c}:${k}`,      // dedupe marker with TTL
  meta: (id) => `meta:${id}`,            // last known name/url for /list
};

// Telegram deep-link payloads must be [A-Za-z0-9_-]{1,64}: base64url of the id.
export const encodeStart = (id) => Buffer.from(id).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const decodeStart = (s) => { try { return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch { return ""; } };
export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Where our own API lives (for the cron tick to reuse the same routes the page uses).
export const selfBase = (req) => process.env.PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://${req.headers.host}`);
