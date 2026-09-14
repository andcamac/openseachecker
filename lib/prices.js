// GET /api/prices — SOL and ETH in USD for the price labels. CoinGecko public API, cached 60 s.
let cache = { at: 0, val: null };
export default async function handler(req, res) {
  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");
  if (cache.val && Date.now() - cache.at < 60_000) return res.status(200).json(cache.val);
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd&include_24hr_change=true", { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
    const j = await r.json();
    cache = { at: Date.now(), val: { sol: j.solana?.usd ?? null, eth: j.ethereum?.usd ?? null, sol24h: j.solana?.usd_24h_change ?? null, eth24h: j.ethereum?.usd_24h_change ?? null, at: Date.now() } };
    res.status(200).json(cache.val);
  } catch (err) {
    res.status(200).json(cache.val || { sol: null, eth: null, error: err.message });
  }
}
