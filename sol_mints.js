// GET /api/sol_mints[?pages=3][&debug=1]
// Source-agnostic Solana mint radar: reads the chain instead of any launchpad.
//
// Almost every Solana launchpad (LaunchMyNFT, Metaplex Creator Studio, Truffle, custom
// sites…) mints through Metaplex Candy Machine — v3 (Token Metadata) or Core Candy Machine.
// So: pull the latest transactions that touched those two programs, collect every candy
// machine they reference, decode each one plus its Candy Guard (start/end date, SOL price,
// per-wallet limit, allowlist…), and resolve the collection's name and image. Result: what's
// minting on Solana right now, what was just deployed, and what's scheduled — regardless of
// launchpad.
//
// Works with either provider (set one or both in Vercel):
//   HELIUS_API_KEY      — uses Helius's enhanced-transactions API (1 request per 100 txs) + DAS.
//   QUICKNODE_RPC_URL   — any standard Solana RPC (QuickNode, Alchemy, Triton…): uses
//                         getSignaturesForAddress + batched getTransaction; metadata via the
//                         QuickNode DAS add-on if enabled, else read from Metaplex accounts.
//   SOLANA_RPC_URL      — alias for QUICKNODE_RPC_URL.
// Without any of them the route returns {disabled:true}.
// The Metaplex SDKs are loaded lazily so a packaging problem on the host surfaces as a JSON
// error (visible with ?debug=1) instead of a blank 500 from a crashed function.
let createUmi, publicKey, unwrapOption, isSome, base58, CM, CORE, safeFetchMetadataFromSeeds, mplTokenMetadata, fetchCollection, mplCore;
let PROGRAMS = [];
async function loadDeps() {
  if (PROGRAMS.length) return;
  ({ createUmi } = await import("@metaplex-foundation/umi-bundle-defaults"));
  ({ publicKey, unwrapOption, isSome } = await import("@metaplex-foundation/umi"));
  ({ base58 } = await import("@metaplex-foundation/umi/serializers"));
  CM = await import("@metaplex-foundation/mpl-candy-machine");
  CORE = await import("@metaplex-foundation/mpl-core-candy-machine");
  ({ safeFetchMetadataFromSeeds, mplTokenMetadata } = await import("@metaplex-foundation/mpl-token-metadata"));
  ({ fetchCollection, mplCore } = await import("@metaplex-foundation/mpl-core"));
  PROGRAMS = [
    { kind: "cm3", id: String(CM.MPL_CANDY_MACHINE_CORE_PROGRAM_ID), guard: String(CM.MPL_CANDY_GUARD_PROGRAM_ID), sdk: CM },
    { kind: "core", id: String(CORE.MPL_CORE_CANDY_MACHINE_CORE_PROGRAM_ID), guard: String(CORE.MPL_CORE_CANDY_GUARD_PROGRAM_ID), sdk: CORE },
  ];
}

import { signalFor } from "./_signal.js";
const HELIUS = process.env.HELIUS_API_KEY || "";
const RPC_URL = process.env.QUICKNODE_RPC_URL || process.env.SOLANA_RPC_URL || (HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : "");
const PROVIDER = HELIUS ? "helius" : RPC_URL ? (/quiknode|quicknode/i.test(RPC_URL) ? "quicknode" : "rpc") : "none";
const TXAPI = (addr, before) => `https://api.helius.xyz/v0/addresses/${addr}/transactions?api-key=${HELIUS}&limit=100${before ? `&before=${before}` : ""}`;

// Anchor discriminators: sha256("global:<name>")[0..8]
const DISC = { afaf6d1f0d989bed: "init", "4399af27da102620": "init", "3339e12fb69289a6": "mint", "78791792ad6ec7cd": "mint", "9162c076b8937668": "mint" };
const MAX_MACHINES = 40;

const CACHE = new Map();
async function cached(key, ttl, fn) {
  const h = CACHE.get(key); if (h && h.exp > Date.now()) return h.val;
  const val = await fn(); CACHE.set(key, { val, exp: Date.now() + ttl }); return val;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, init) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
    if (r.status === 429) { await sleep(600 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${PROVIDER} HTTP ${r.status}`);
    return r.json();
  }
  throw new Error(`${PROVIDER} rate limit`);
}
const rpc = (method, params) => getJson(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => { if (r.error) throw new Error(`${method}: ${r.error.message}`); return r.result; });
const rpcBatch = (calls) => getJson(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }))) }).then((arr) => (Array.isArray(arr) ? arr : [arr]).sort((a, b) => a.id - b.id).map((r) => r.result ?? null));
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length).fill(null); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}

/* ---------- 1. transaction scan (two implementations, one shape) ----------
   Yields {at, ixs:[{programId, accounts[], data}]} per transaction. */
async function* txsHelius(programId, pages) {
  let before = "";
  for (let page = 0; page < pages; page++) {
    const txs = await getJson(TXAPI(programId, before));
    if (!Array.isArray(txs) || !txs.length) return;
    for (const tx of txs) {
      const ixs = [];
      for (const ix of tx.instructions || []) { ixs.push(ix); for (const inner of ix.innerInstructions || []) ixs.push(inner); }
      yield { at: (tx.timestamp || 0) * 1000, ixs };
    }
    before = txs[txs.length - 1].signature;
    if (txs.length < 100) return;
  }
}
async function* txsRpc(programId, pages) {
  let before = undefined;
  for (let page = 0; page < pages; page++) {
    const sigs = await rpc("getSignaturesForAddress", [programId, { limit: 100, ...(before ? { before } : {}) }]);
    if (!sigs?.length) return;
    const ok = sigs.filter((s) => !s.err);
    // Batched getTransaction, 25 per request — well within QuickNode's batch limits.
    for (let i = 0; i < ok.length; i += 25) {
      const chunk = ok.slice(i, i + 25);
      const txs = await rpcBatch(chunk.map((s) => ({ method: "getTransaction", params: [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] })));
      for (let j = 0; j < txs.length; j++) {
        const tx = txs[j];
        if (!tx) continue;
        const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
        const norm = (ix) => ({ programId: ix.programId || keys[ix.programIdIndex], accounts: ix.accounts ? ix.accounts.map((a) => (typeof a === "number" ? keys[a] : a)) : [], data: ix.data || "" });
        const ixs = tx.transaction.message.instructions.map(norm);
        for (const grp of tx.meta?.innerInstructions || []) for (const ix of grp.instructions) ixs.push(norm(ix));
        yield { at: (tx.blockTime || chunk[j].blockTime || 0) * 1000, ixs };
      }
    }
    before = sigs[sigs.length - 1].signature;
    if (sigs.length < 100) return;
  }
}
async function scanProgram(p, pages) {
  const seen = new Map();
  const src = PROVIDER === "helius" ? txsHelius(p.id, pages) : txsRpc(p.id, pages);
  for await (const tx of src) {
    for (const ix of tx.ixs) {
      if (ix.programId !== p.id && ix.programId !== p.guard) continue;
      let disc = "";
      try { disc = Buffer.from(base58.serialize(ix.data || "")).subarray(0, 8).toString("hex"); } catch {}
      const op = DISC[disc];
      if (!op) continue;
      // Candy Guard mint ixs: accounts[0]=guard, [1]=candy machine program, [2]=candy machine.
      // Candy Machine ixs (init or direct mint): accounts[0]=candy machine.
      const cm = ix.programId === p.guard ? ix.accounts?.[2] : ix.accounts?.[0];
      if (!cm) continue;
      const e = seen.get(cm) || { cm, kind: p.kind, inits: 0, mints: 0, firstAt: tx.at, lastAt: tx.at };
      if (op === "init") e.inits++; else e.mints++;
      e.firstAt = Math.min(e.firstAt, tx.at); e.lastAt = Math.max(e.lastAt, tx.at);
      seen.set(cm, e);
    }
  }
  return [...seen.values()];
}

/* ---------- 2. decode candy machine + guard ---------- */
const lamports = (x) => (x == null ? null : Number(x) / 1e9);
function guardSummary(g) {
  if (!g) return {};
  const o = (v) => (v && isSome(v) ? unwrapOption(v) : null);
  const sd = o(g.startDate), ed = o(g.endDate), sp = o(g.solPayment), ml = o(g.mintLimit), al = o(g.allowList), tp = o(g.tokenPayment), bt = o(g.botTax);
  return {
    startAt: sd ? Number(sd.date) * 1000 : null,
    endAt: ed ? Number(ed.date) * 1000 : null,
    priceSol: sp ? lamports(sp.lamports?.basisPoints ?? sp.lamports) : (tp ? null : 0),
    tokenPayment: tp ? { mint: String(tp.mint), amount: Number(tp.amount) } : null,
    perWallet: ml ? Number(ml.limit) : null,
    allowList: !!al,
    botTax: bt ? lamports(bt.lamports?.basisPoints ?? bt.lamports) : null,
  };
}
async function decode(entry, umis) {
  const p = PROGRAMS.find((x) => x.kind === entry.kind);
  const umi = umis[entry.kind];
  const cm = await p.sdk.fetchCandyMachine(umi, publicKey(entry.cm));
  const guard = await p.sdk.safeFetchCandyGuard(umi, cm.mintAuthority).catch(() => null);
  const groups = (guard?.groups || []).map((g) => ({ label: g.label, ...guardSummary(g.guards) }));
  const def = guardSummary(guard?.guards);
  const phases = groups.length ? groups.map((g) => ({ ...g, startAt: g.startAt ?? def.startAt, endAt: g.endAt ?? def.endAt, priceSol: g.priceSol ?? def.priceSol, perWallet: g.perWallet ?? def.perWallet, allowList: g.allowList || def.allowList })) : [{ label: "public", ...def }];
  return {
    candyMachine: entry.cm, kind: entry.kind,
    collectionMint: String(cm.collectionMint), authority: String(cm.authority),
    itemsAvailable: Number(cm.data?.itemsAvailable ?? cm.itemsAvailable ?? 0),
    itemsRedeemed: Number(cm.itemsRedeemed ?? 0),
    symbol: cm.data?.symbol || "",
    hidden: !!(cm.data?.hiddenSettings && isSome(cm.data.hiddenSettings)),
    hasGuard: !!guard, phases,
    recentMints: entry.mints, deployedNow: entry.inits > 0, firstSeen: entry.firstAt, lastSeen: entry.lastAt,
  };
}

/* ---------- 3. collection name/image: DAS if the provider has it, else Metaplex accounts ---------- */
async function assetsDas(mints) {
  const r = await rpc("getAssetBatch", { ids: mints });
  const out = {};
  for (const a of r || []) if (a) out[a.id] = { name: a.content?.metadata?.name || "", image: a.content?.links?.image || a.content?.files?.[0]?.cdn_uri || a.content?.files?.[0]?.uri || null, description: a.content?.metadata?.description || "", uri: a.content?.json_uri || null, website: a.content?.links?.external_url || null };
  return out;
}
async function assetsOnchain(items, umis) {
  const out = {};
  await mapLimit(items, 4, async ({ collectionMint, kind }) => {
    let name = "", uri = "";
    if (kind === "core") { const c = await fetchCollection(umis.core, publicKey(collectionMint)); name = c.name; uri = c.uri; }
    else { const m = await safeFetchMetadataFromSeeds(umis.cm3, { mint: publicKey(collectionMint) }); if (m) { name = m.name; uri = m.uri; } }
    let json = {};
    if (uri) { try { json = await getJson(uri.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/")); } catch {} }
    out[collectionMint] = { name: (name || json.name || "").replace(/\0+$/, ""), image: json.image || null, description: json.description || "", uri, website: json.external_url || null, twitter: json.twitter || json.properties?.twitter || null, discord: json.discord || json.properties?.discord || null };
  });
  return out;
}

export default async function handler(req, res) {
  if (PROVIDER === "none") { res.setHeader("cache-control", "s-maxage=60"); return res.status(200).json({ disabled: true, reason: "Set HELIUS_API_KEY or QUICKNODE_RPC_URL in Vercel to enable the on-chain Solana mint radar.", mints: [] }); }
  const pages = Math.max(1, Math.min(6, Number(req.query.pages) || (PROVIDER === "helius" ? 3 : 2)));
  const debug = req.query.debug === "1";
  const now = Date.now();
  try {
    try { await loadDeps(); } catch (e) { throw new Error(`Solana SDK failed to load on this host: ${e.message}${e.stack ? " | " + String(e.stack).split("\n").slice(0, 3).join(" ") : ""}`); }
    const data = await cached(`solmints:${pages}`, 90_000, async () => {
      const scans = await Promise.all(PROGRAMS.map((p) => scanProgram(p, pages)));
      const entries = scans.flat().sort((a, b) => (b.inits - a.inits) || (b.mints - a.mints) || b.lastAt - a.lastAt).slice(0, MAX_MACHINES);
      const umis = { cm3: createUmi(RPC_URL).use(CM.mplCandyMachine()).use(mplTokenMetadata()), core: createUmi(RPC_URL).use(CORE.mplCandyMachine()).use(mplCore()) };
      const decoded = (await mapLimit(entries, 4, (e) => decode(e, umis))).filter(Boolean);
      const uniq = [...new Map(decoded.map((d) => [d.collectionMint, { collectionMint: d.collectionMint, kind: d.kind }])).values()];
      let meta = {};
      try { meta = await assetsDas(uniq.map((u) => u.collectionMint)); } catch { meta = await assetsOnchain(uniq, umis).catch(() => ({})); }
      const sigs = await mapLimit(decoded, 4, (d) => { const m = meta[d.collectionMint] || {}; return signalFor({ links: { website: m.website || null, twitter: m.twitter || null, discord: m.discord || null }, image: m.image, verified: false }); });
      return decoded.map((d, di) => {
        const m = meta[d.collectionMint] || {};
        const nowPhase = d.phases.find((p) => (p.startAt == null || p.startAt <= now) && (p.endAt == null || p.endAt > now));
        const nextPhase = d.phases.filter((p) => p.startAt && p.startAt > now).sort((a, b) => a.startAt - b.startAt)[0];
        const soldOut = d.itemsAvailable > 0 && d.itemsRedeemed >= d.itemsAvailable;
        const status = soldOut ? "sold_out" : nowPhase ? "live" : nextPhase ? "upcoming" : d.phases.some((p) => p.endAt && p.endAt <= now) ? "ended" : "live";
        return {
          ...d,
          name: m.name || d.symbol || `Candy Machine ${d.candyMachine.slice(0, 4)}…`,
          image: m.image || null, description: m.description || "",
          links: { website: m.website || null, twitter: m.twitter || null, discord: m.discord || null },
          signal: sigs[di] || null,
          status, phase: nowPhase || nextPhase || d.phases[0] || null, nextStart: nextPhase?.startAt || null,
          url: `https://solscan.io/account/${d.candyMachine}`,
          collectionUrl: `https://magiceden.io/item-details/${d.collectionMint}`,
        };
      }).sort((a, b) => ({ live: 0, upcoming: 1, sold_out: 2, ended: 3 }[a.status] - { live: 0, upcoming: 1, sold_out: 2, ended: 3 }[b.status]) || b.recentMints - a.recentMints);
    });
    res.setHeader("cache-control", "s-maxage=90, stale-while-revalidate=300");
    res.status(200).json({
      chain: "solana", source: "candy-machine", provider: PROVIDER, mints: data,
      counts: { total: data.length, live: data.filter((d) => d.status === "live").length, upcoming: data.filter((d) => d.status === "upcoming").length, newDeploys: data.filter((d) => d.deployedNow).length },
      ...(debug ? { pages, rpcHost: (() => { try { return new URL(RPC_URL).host; } catch { return null; } })() } : {}),
    });
  } catch (err) {
    res.setHeader("cache-control", "no-store");
    res.status(502).json({ error: err.message, provider: PROVIDER });
  }
}
