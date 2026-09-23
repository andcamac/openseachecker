// GET /api/nfts?route=list|img
//   route=list&address=…[&chains=ethereum,base]  → every NFT the wallet holds
//   route=img&url=…                              → same-origin image bytes, so the page can save them
// One function, because Vercel's Hobby plan allows 12 and every api/*.js counts.
import list from "../lib/wallet_nfts.js";
import img from "../lib/img_proxy.js";

const ROUTES = { list, img };

export default async function handler(req, res) {
  const route = String(req.query?.route || "").toLowerCase();
  const fn = ROUTES[route];
  if (!fn) return res.status(400).json({ error: `unknown route "${route}"`, routes: Object.keys(ROUTES) });
  return fn(req, res);
}
