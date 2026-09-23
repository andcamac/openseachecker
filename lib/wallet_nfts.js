// Every NFT a wallet holds, flattened to one shape the downloader can work with.
//
//   EVM     → OpenSea  GET /chain/{chain}/account/{address}/nfts   (needs OPENSEA_API_KEY)
//   Solana  → Magic Eden GET /wallets/{address}/tokens             (no key needed)
//
// Read-only. We return image URLs, never the bytes — /api/nfts?route=img streams those,
// because most NFT image hosts send no CORS headers and the browser can't zip what it can't read.
//
// Two rules learned the hard way, both about NOT losing items:
//   1. limit=200 is OpenSea's documented maximum. Asking for 50 just means 4x the round trips.
//   2. Never drop an NFT silently. Anything skipped is counted and reported so the UI can say so.
import { apiKey, osFetch } from "./opensea.js";
import { meFetch, isSolAddress, pick, cached } from "./magiceden.js";

// Chains OpenSea indexes that this app offers. Solana is handled separately.
export const EVM_CHAINS = ["ethereum", "base", "matic", "arbitrum", "optimism", "zora", "blast"];
const isEvm = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || ""));
const PAGE = 200;              // OpenSea's documented maximum
const MAX_PAGES = 50;          // 10,000 per chain
const BUDGET_MS = 40_000;      // stop paging before Vercel's 60 s ceiling, and say we stopped
const CHAIN_CONCURRENCY = 3;   // the pacer caps the real rate; this just bounds queue depth
const DEFAULT_CHAIN = "ethereum";   // scanning every chain is opt-in, never the default

// Run tasks a few at a time, preserving input order in the results.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

function normEvm(n, chain) {
  const img = pick(n, "image_url", "display_image_url");
  return {
    id: `${chain}:${n.contract}:${n.identifier}`,
    chain,
    tokenId: String(n.identifier ?? ""),
    contract: n.contract || "",
    name: n.name || `#${n.identifier}`,
    collection: n.collection || "",
    kind: n.token_standard || "",
    image: img || null,                                      // original first…
    thumb: pick(n, "display_image_url", "image_url") || null, // …CDN copy as the fallback
    animation: n.animation_url || null,
    url: n.opensea_url || null,
    updated: n.updated_at || null,
    flagged: !!n.is_suspicious,     // reported, never silently removed
  };
}

async function evmChain(key, address, chain, deadline, collection) {
  const out = [];
  let next = "", pages = 0, truncated = false;
  for (; pages < MAX_PAGES; pages++) {
    if (Date.now() > deadline) { truncated = true; break; }
    // Filtering server-side is far cheaper than pulling the whole wallet and discarding —
    // and it sidesteps the paging cap entirely for a targeted lookup.
    const q = `?limit=${PAGE}` + (collection ? `&collection=${encodeURIComponent(collection)}` : "") + (next ? `&next=${encodeURIComponent(next)}` : "");
    const { ok, status, body } = await osFetch(key, `/chain/${chain}/account/${address}/nfts${q}`);
    if (!ok) {
      // A chain the account has never touched 404s; that isn't an error worth surfacing.
      if (status === 404) break;
      return { chain, error: body.detail || body.error || body.raw || `OpenSea HTTP ${status}`, nfts: out, pages, truncated: false };
    }
    for (const n of body.nfts || []) out.push(normEvm(n, chain));
    next = body.next || "";
    if (!next) break;
    if (pages === MAX_PAGES - 1) truncated = true;
  }
  return { chain, error: null, nfts: out, pages, truncated };
}

async function solana(address, deadline, collection) {
  const out = [];
  let truncated = false;
  for (let offset = 0; offset < 10000; offset += 500) {
    if (Date.now() > deadline) { truncated = true; break; }
    const { ok, status, body } = await meFetch(`/wallets/${address}/tokens?offset=${offset}&limit=500&listStatus=both`);
    if (!ok) {
      if (!out.length) return { chain: "solana", error: body.error || body.message || `Marketplace HTTP ${status}`, nfts: [], truncated: true };
      truncated = true; break;
    }
    const list = Array.isArray(body) ? body : body.tokens || [];
    for (const t of list) {
      const mint = t.mintAddress || t.mint;
      if (!mint) continue;
      // Magic Eden has no collection filter on this endpoint, so scope it here.
      if (collection && String(t.collection || t.collectionName || "").toLowerCase() !== collection) continue;
      out.push({
        id: `solana:${mint}`,
        chain: "solana",
        tokenId: mint,
        contract: t.collection || "",
        name: t.name || t.title || mint.slice(0, 8),
        collection: t.collection || t.collectionName || "",
        kind: "",
        image: t.image || t.img || null,
        thumb: t.image || t.img || null,
        animation: t.animationUrl || null,
        url: `https://magiceden.io/item-details/${encodeURIComponent(mint)}`,
        updated: null,
        flagged: false,
      });
    }
    if (list.length < 500) break;
  }
  return { chain: "solana", error: null, nfts: out, truncated };
}

// GET /api/nfts?route=list&address=<0x… or base58>[&collection=slug][&chains=all|ethereum,base][&debug=1]
// chains defaults to ethereum alone; "all" opts into every chain we index.
export default async function handler(req, res) {
  const address = String(req.query?.address || "").trim();
  if (!address) return res.status(400).json({ error: "address is required" });
  const debug = req.query?.debug === "1";
  const collection = String(req.query?.collection || "").trim().toLowerCase();
  if (collection && !/^[a-z0-9._-]{1,120}$/.test(collection)) return res.status(400).json({ error: "collection must be a slug" });
  const deadline = Date.now() + BUDGET_MS;

  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");

  const finish = (results) => {
    const nfts = results.flatMap((r) => r.nfts);
    nfts.sort((a, b) =>
      (a.collection || "zzz").localeCompare(b.collection || "zzz") ||
      (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }));
    const byChain = results.map((r) => ({ chain: r.chain, count: r.nfts.length, truncated: !!r.truncated, error: r.error || null }));
    return res.status(200).json({
      address,
      collection: collection || null,
      chains: results.map((r) => r.chain),
      scannedAll: results.length === EVM_CHAINS.length,
      nfts,
      count: nfts.length,
      flagged: nfts.filter((n) => n.flagged).length,   // shown by default; the UI can hide them
      truncated: results.some((r) => r.truncated),   // we stopped paging: page cap or time budget
      partial: results.some((r) => r.error),         // a chain failed: its items are missing
      byChain,
      errors: byChain.filter((c) => c.error),
      ...(debug ? { debug: { page: PAGE, maxPages: MAX_PAGES, budgetMs: BUDGET_MS } } : {}),
    });
  };

  try {
    if (isSolAddress(address) && !isEvm(address)) {
      return finish([await cached(`wnfts:sol:${address}:${collection}`, 60_000, () => solana(address, deadline, collection))]);
    }
    if (!isEvm(address)) return res.status(400).json({ error: "Not a recognisable EVM (0x…) or Solana address" });

    const key = apiKey(res);
    if (!key) return;                               // apiKey() already wrote the 500

    // One chain by default. Scanning all seven is a deliberate choice (chains=all), not the
    // fallback — it is seven times the requests, and it is how we used to trip the rate limit.
    const want = String(req.query?.chains || "").trim().toLowerCase();
    const chains = !want ? [DEFAULT_CHAIN]
      : want === "all" ? EVM_CHAINS
      : want.split(",").map((c) => c.trim()).filter((c) => EVM_CHAINS.includes(c));
    if (!chains.length) return res.status(400).json({ error: `chains must be "all" or some of: ${EVM_CHAINS.join(", ")}` });

    return finish(await pool(chains, CHAIN_CONCURRENCY, (c) => cached(`wnfts:${c}:${address}:${collection}`, 60_000, () => evmChain(key, address, c, deadline, collection))));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
