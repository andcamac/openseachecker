// Every NFT a wallet holds, flattened to one shape the downloader can work with.
//
//   EVM     → OpenSea  GET /chain/{chain}/account/{address}/nfts   (needs OPENSEA_API_KEY)
//   Solana  → Magic Eden GET /wallets/{address}/tokens             (no key needed)
//
// Read-only. We return image URLs, never the bytes — /api/nfts?route=img streams those,
// because most NFT image hosts send no CORS headers and the browser can't zip what it can't read.
import { apiKey, osFetch } from "./opensea.js";
import { meFetch, isSolAddress, pick, cached } from "./magiceden.js";

// Chains OpenSea indexes that this app offers. Solana is handled separately.
export const EVM_CHAINS = ["ethereum", "base", "matic", "arbitrum", "optimism", "zora", "blast"];
const isEvm = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || ""));
const PAGE = 50;
const MAX_PAGES = 20;          // 1000 NFTs per chain is plenty and keeps us inside the 60 s budget

function normEvm(n, chain) {
  const img = pick(n, "image_url", "display_image_url");
  return {
    id: `${chain}:${n.contract}:${n.identifier}`,
    chain,
    tokenId: String(n.identifier ?? ""),
    contract: n.contract || "",
    name: n.name || `#${n.identifier}`,
    collection: n.collection || "",
    // full-resolution original first, OpenSea's resized copy as the fallback
    image: img || null,
    thumb: pick(n, "display_image_url", "image_url") || null,
    animation: n.animation_url || null,
    url: n.opensea_url || null,
    updated: n.updated_at || null,
  };
}

async function evmChain(key, address, chain) {
  const out = [];
  let next = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `?limit=${PAGE}` + (next ? `&next=${encodeURIComponent(next)}` : "");
    const { ok, status, body } = await osFetch(key, `/chain/${chain}/account/${address}/nfts${q}`);
    if (!ok) {
      // A chain the account has never touched 404s; that isn't an error worth surfacing.
      if (status === 404) break;
      return { chain, error: body.detail || body.error || body.raw || `OpenSea HTTP ${status}`, nfts: out };
    }
    for (const n of body.nfts || []) if (!n.is_suspicious) out.push(normEvm(n, chain));
    next = body.next || "";
    if (!next) break;
  }
  return { chain, error: null, nfts: out };
}

async function solana(address) {
  const out = [];
  for (let offset = 0; offset < 1500; offset += 500) {
    const { ok, status, body } = await meFetch(`/wallets/${address}/tokens?offset=${offset}&limit=500&listStatus=both`);
    if (!ok) {
      if (!out.length) return { chain: "solana", error: body.error || body.message || `Marketplace HTTP ${status}`, nfts: [] };
      break;
    }
    const list = Array.isArray(body) ? body : body.tokens || [];
    for (const t of list) {
      const mint = t.mintAddress || t.mint;
      if (!mint) continue;
      out.push({
        id: `solana:${mint}`,
        chain: "solana",
        tokenId: mint,
        contract: t.collection || "",
        name: t.name || t.title || mint.slice(0, 8),
        collection: t.collection || t.collectionName || "",
        image: t.image || t.img || null,
        thumb: t.image || t.img || null,
        animation: t.animationUrl || null,
        url: mint ? `https://magiceden.io/item-details/${encodeURIComponent(mint)}` : null,
        updated: null,
      });
    }
    if (list.length < 500) break;
  }
  return { chain: "solana", error: null, nfts: out };
}

// GET /api/nfts?route=list&address=<0x… or base58>[&chains=ethereum,base]
export default async function handler(req, res) {
  const address = String(req.query?.address || "").trim();
  if (!address) return res.status(400).json({ error: "address is required" });

  res.setHeader("cache-control", "s-maxage=60, stale-while-revalidate=300");

  try {
    if (isSolAddress(address) && !isEvm(address)) {
      const r = await cached(`wnfts:sol:${address}`, 60_000, () => solana(address));
      return res.status(200).json({ address, chains: ["solana"], nfts: r.nfts, errors: r.error ? [r] : [], count: r.nfts.length });
    }
    if (!isEvm(address)) return res.status(400).json({ error: "Not a recognisable EVM (0x…) or Solana address" });

    const key = apiKey(res);
    if (!key) return;                               // apiKey() already wrote the 500

    const want = String(req.query?.chains || "").trim();
    const chains = want ? want.split(",").map((c) => c.trim()).filter((c) => EVM_CHAINS.includes(c)) : EVM_CHAINS;
    if (!chains.length) return res.status(400).json({ error: `chains must be some of: ${EVM_CHAINS.join(", ")}` });

    const results = await Promise.all(chains.map((c) => cached(`wnfts:${c}:${address}`, 60_000, () => evmChain(key, address, c))));
    const nfts = results.flatMap((r) => r.nfts);
    const errors = results.filter((r) => r.error).map((r) => ({ chain: r.chain, error: r.error }));
    nfts.sort((a, b) => (a.collection || "").localeCompare(b.collection || "") || (a.name || "").localeCompare(b.name || "", undefined, { numeric: true }));
    return res.status(200).json({ address, chains, nfts, errors, count: nfts.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
