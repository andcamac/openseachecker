// GET /api/nfts?route=img&url=<encoded image url>
//
// Why this exists: NFT art is hosted all over the place (OpenSea's CDN, IPFS gateways, Arweave,
// random S3 buckets) and almost none of it sends Access-Control-Allow-Origin. Without CORS the
// page can read the bytes for a <img> tag but NOT for a zip or a file write, so the browser
// cannot save what the user selected. This streams the bytes back same-origin.
//
// It is a proxy, so it is also an SSRF risk, and it is locked down accordingly:
//   - https only
//   - the hostname must resolve to a public unicast address (no localhost, no RFC1918,
//     no link-local — which is what blocks the 169.254.169.254 cloud metadata endpoint)
//   - redirects are followed manually so every hop is re-checked, not just the first
//   - only image/*, video/* and model/* come back, capped in size
import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_HOPS = 4;
const OK_TYPE = /^(image|video|model)\//i;

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
const AR_GATEWAY = "https://arweave.net/";

export function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("ipfs://")) return IPFS_GATEWAY + s.slice(7).replace(/^ipfs\//, "");
  if (s.startsWith("ar://")) return AR_GATEWAY + s.slice(5);
  return s;
}

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 ||
           (a === 169 && b === 254) ||                 // link-local, incl. cloud metadata
           (a === 172 && b >= 16 && b <= 31) ||
           (a === 192 && b === 168) ||
           (a === 100 && b >= 64 && b <= 127) ||       // CGNAT
           a >= 224;                                    // multicast / reserved
  }
  if (v === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true;                            // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;  // ::1
    const first = g[0];
    if ((first & 0xffc0) === 0xfe80) return true;                        // fe80::/10 link-local
    if ((first & 0xfe00) === 0xfc00) return true;                        // fc00::/7 unique-local
    if ((first & 0xff00) === 0xff00) return true;                        // ff00::/8 multicast
    // IPv4-mapped (::ffff:a.b.c.d) — Node may hand it back in hex form, so rebuild the v4
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return isPrivateIp(`${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`);
    }
    return false;
  }
  return true;   // not an IP we understand → refuse
}

// "::ffff:a00:1" -> [0,0,0,0,0,0xffff,0x0a00,1]; null if it isn't parseable.
function expandV6(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);            // trailing dotted quad form
  if (v4) {
    const p = v4[1].split(".").map(Number);
    if (p.some((n) => !(n >= 0 && n <= 255))) return null;
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":").filter(Boolean) : [];
  const t = tail ? tail.split(":").filter(Boolean) : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) return null;
  const out = groups.map((x) => parseInt(x, 16));
  return out.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff) ? null : out;
}

async function assertPublic(rawHost) {
  // URL keeps IPv6 literals bracketed ("[::1]"); strip them so net.isIP can see the address.
  const hostname = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("blocked: private address");
    return;
  }
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); }
  catch { throw new Error("blocked: host does not resolve"); }
  if (!addrs.length) throw new Error("blocked: host does not resolve");
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error("blocked: private address");
}

export default async function handler(req, res) {
  const target = normalizeUrl(req.query?.url);
  if (!target) return res.status(400).json({ error: "url is required" });

  let url;
  try { url = new URL(target); } catch { return res.status(400).json({ error: "not a url" }); }

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (url.protocol !== "https:") return res.status(400).json({ error: "https only" });
      await assertPublic(url.hostname);

      const upstream = await fetch(url.toString(), {
        redirect: "manual",                       // re-validate every hop ourselves
        headers: { accept: "image/*,video/*,*/*;q=0.8", "user-agent": "MintRadar/1.0" },
        signal: AbortSignal.timeout(25000),
      });

      if ([301, 302, 303, 307, 308].includes(upstream.status)) {
        const loc = upstream.headers.get("location");
        if (!loc) return res.status(502).json({ error: "redirect without a location" });
        url = new URL(loc, url);
        continue;
      }
      if (!upstream.ok) return res.status(upstream.status).json({ error: `upstream HTTP ${upstream.status}` });

      const type = upstream.headers.get("content-type") || "application/octet-stream";
      if (!OK_TYPE.test(type)) return res.status(415).json({ error: `refusing content-type ${type}` });

      const len = Number(upstream.headers.get("content-length") || 0);
      if (len && len > MAX_BYTES) return res.status(413).json({ error: "file too large" });

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: "file too large" });

      res.setHeader("content-type", type);
      res.setHeader("content-length", String(buf.length));
      res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-disposition", "inline");
      return res.status(200).send(buf);
    }
    return res.status(508).json({ error: "too many redirects" });
  } catch (err) {
    const msg = err.message || "fetch failed";
    return res.status(msg.startsWith("blocked:") ? 403 : 502).json({ error: msg });
  }
}
