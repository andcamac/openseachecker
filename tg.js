// POST /api/tg — Telegram bot webhook.
// Register once: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>/api/tg&secret_token=<ALERTS_SECRET>
// Commands: /start [payload] · /watch <id> · /unwatch <id> · /list · /new · /wallet <addr> · /help
import { enabled, redis, pipeline, tgSend, K, decodeStart, esc, SECRET } from "./_alerts.js";

const HELP = `<b>Mint Radar alerts</b>
Tap 🔔 on any mint on the site — it opens this chat and starts the watch. Or:
/watch &lt;id&gt; — watch a mint (ids look like os:slug, me:lp:symbol, cm:address)
/unwatch &lt;id&gt; — stop
/list — what you're watching
/new — toggle alerts for every new on-chain Solana deployment
/wallet &lt;0x…&gt; — toggle "this wallet became eligible" alerts (OpenSea)
You'll get a ping 10 minutes before a phase opens, when it opens, and when a watched wallet turns eligible.`;

async function addWatch(chat, id, meta) {
  const cmds = [["SADD", K.item(id), String(chat)], ["SADD", K.chat(chat), id]];
  if (meta) cmds.push(["SET", K.meta(id), JSON.stringify(meta)]);
  await pipeline(cmds);
}
async function delWatch(chat, id) { await pipeline([["SREM", K.item(id), String(chat)], ["SREM", K.chat(chat), id]]); }
const okId = (id) => /^(os:[a-z0-9._-]+|me:lp:[a-z0-9._-]+|cm:[1-9A-HJ-NP-Za-km-z]{32,44}|new|wallet:(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}))$/i.test(id);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true, enabled: enabled() });
  if (!enabled()) return res.status(200).json({ ok: false, reason: "alerts not configured" });
  if (SECRET && req.headers["x-telegram-bot-api-secret-token"] !== SECRET) return res.status(401).end();
  const msg = req.body?.message || req.body?.edited_message;
  const chat = msg?.chat?.id;
  const text = String(msg?.text || "").trim();
  if (!chat || !text) return res.status(200).json({ ok: true });
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();
  try {
    if (cmd === "/start") {
      const id = arg ? decodeStart(arg) : "";
      if (id && okId(id)) {
        await addWatch(chat, id);
        await tgSend(chat, `🔔 Watching <b>${esc(id)}</b>. You'll hear from me 10 min before it opens and at open.\n\n/list to see everything, /help for commands.`);
      } else await tgSend(chat, HELP);
    } else if (cmd === "/help") await tgSend(chat, HELP);
    else if (cmd === "/watch" && okId(arg)) { await addWatch(chat, arg); await tgSend(chat, `🔔 Watching <b>${esc(arg)}</b>.`); }
    else if (cmd === "/unwatch" && okId(arg)) { await delWatch(chat, arg); await tgSend(chat, `🔕 Stopped watching <b>${esc(arg)}</b>.`); }
    else if (cmd === "/new") {
      const on = await redis("SISMEMBER", K.item("new"), String(chat));
      if (on) { await delWatch(chat, "new"); await tgSend(chat, "🔕 New on-chain deployments: off."); }
      else { await addWatch(chat, "new"); await tgSend(chat, "🆕 New on-chain deployments: on. Expect a few per hour on busy days."); }
    } else if (cmd === "/wallet" && /^0x[0-9a-fA-F]{40}$/.test(arg)) {
      const id = "wallet:" + arg.toLowerCase();
      const on = await redis("SISMEMBER", K.item(id), String(chat));
      if (on) { await delWatch(chat, id); await tgSend(chat, `🔕 Wallet alerts off for <code>${esc(arg.slice(0, 6))}…${esc(arg.slice(-4))}</code>.`); }
      else { await addWatch(chat, id); await tgSend(chat, `👛 Wallet alerts on for <code>${esc(arg.slice(0, 6))}…${esc(arg.slice(-4))}</code> — I'll ping you when it becomes eligible for a live OpenSea drop.`); }
    } else if (cmd === "/list") {
      const ids = (await redis("SMEMBERS", K.chat(chat))) || [];
      if (!ids.length) return void await tgSend(chat, "Nothing watched yet. Tap 🔔 on a mint on the site, or /help.");
      const metas = await pipeline(ids.map((id) => ["GET", K.meta(id)]));
      const lines = ids.map((id, i) => { let m = null; try { m = JSON.parse(metas[i]); } catch {} return `• <b>${esc(m?.name || id)}</b>${m?.name ? ` <code>${esc(id)}</code>` : ""}${m?.url ? ` — <a href="${esc(m.url)}">open</a>` : ""}`; });
      await tgSend(chat, `<b>Watching ${ids.length}:</b>\n${lines.join("\n")}\n\n/unwatch &lt;id&gt; to remove one.`);
    } else await tgSend(chat, "Didn't get that. " + HELP);
  } catch (e) {
    await tgSend(chat, "Something broke on my side: " + esc(e.message));
  }
  res.status(200).json({ ok: true });
}
