// GET /api/me?route=launchpad|trending|wallet|collection
// One serverless function fronting the four marketplace endpoints (Hobby plan allows 12 functions total).
// Old URLs (/api/me_launchpad, /api/me_trending, /api/me_wallet, /api/me_collection) still work via
// the rewrites in vercel.json, which map them here with the right ?route=.
import launchpad from "../lib/me_launchpad.js";
import trending from "../lib/me_trending.js";
import wallet from "../lib/me_wallet.js";
import collection from "../lib/me_collection.js";

const ROUTES = { launchpad, trending, wallet, collection };

export default async function handler(req, res) {
  const route = String(req.query?.route || "").toLowerCase();
  const fn = ROUTES[route];
  if (!fn) return res.status(400).json({ error: `unknown route "${route}"`, routes: Object.keys(ROUTES) });
  return fn(req, res);
}
