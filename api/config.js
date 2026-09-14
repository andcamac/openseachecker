// GET /api/config?what=prices|privy|alerts|status
// One serverless function fronting the three small config/price endpoints (Hobby plan: 12 functions).
// Old URLs (/api/prices, /api/privy_config, /api/alerts_config) still work via vercel.json rewrites.
import prices from "../lib/prices.js";
import privy from "../lib/privy_config.js";
import alerts from "../lib/alerts_config.js";
import status from "../lib/status.js";

const WHAT = { prices, privy, alerts, status };

export default async function handler(req, res) {
  const what = String(req.query?.what || "").toLowerCase();
  const fn = WHAT[what];
  if (!fn) return res.status(400).json({ error: `unknown what "${what}"`, what: Object.keys(WHAT) });
  return fn(req, res);
}
