// GET /api/alerts_config — tells the page whether Telegram alerts are on and which bot to deep-link.
import { enabled, BOT_USERNAME } from "./alerts.js";
export default function handler(req, res) {
  res.setHeader("cache-control", "s-maxage=300");
  res.status(200).json({ enabled: enabled() && !!BOT_USERNAME, bot: BOT_USERNAME || null });
}
