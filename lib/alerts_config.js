// GET /api/config?what=alerts — tells the page whether Telegram alerts are on and which bot to deep-link.
// When they're off it also says which piece is missing, so the popover can be specific instead of vague.
import { enabled, BOT_USERNAME } from "./alerts.js";

const has = (k) => !!(process.env[k] || "").trim();

export default function handler(req, res) {
  res.setHeader("cache-control", "s-maxage=300");
  const on = enabled() && !!BOT_USERNAME;
  let why = "";
  if (!on) {
    const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"].filter((k) => !has(k));
    why = missing.length ? `Missing on the server: ${missing.join(", ")}.` : "The bot and storage are configured but not reporting ready.";
  }
  res.status(200).json({ enabled: on, bot: BOT_USERNAME || null, why: why || null });
}
