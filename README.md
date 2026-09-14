# Mint Radar

Paste a wallet address and see your mint radar as circles, grouped by status, category or chain:

- **EVM (0x…)** — which OpenSea drops this wallet can mint right now: public stages and
  allowlist phases (GTD / FCFS / WL / team). Uses only OpenSea's documented public API v2.
- **Solana (base58)** — everything Magic Eden knows: launchpad mints (live / upcoming / recent,
  with secondary floor vs mint price), the NFTs you hold with floor-based portfolio value,
  trending collections, and your recent buys / sells / listings. Uses only Magic Eden's
  documented public Solana API v2.

No wallet connection, no signing, no login. Tap any circle for the detail sheet.

## Deploy to Vercel (~3 minutes)

1. Free OpenSea API key: https://docs.opensea.io/reference/api-keys
2. Push this folder to GitHub, or drag it onto https://vercel.com/new
3. Import as a new project — framework "Other", no build command.
4. Environment Variables → add `OPENSEA_API_KEY` = your key. **Then deploy.**
   (If you add the key after deploying, redeploy so the functions pick it up.)
5. Optional: `MAGICEDEN_API_KEY`. Magic Eden's read endpoints work without a key at
   ~120 requests/min (the app throttles itself to stay under that); a key raises the limit
   and makes Solana scans faster. Request one at https://docs.magiceden.io/reference/solana-api-keys

Terminal alternative:

    npm i -g vercel
    vercel
    vercel env add OPENSEA_API_KEY production
    vercel --prod

Recommended for private use: Vercel → Settings → Deployment Protection →
enable Vercel Authentication, so only your login can run scans on your API key.

## How it works

### Magic Eden (Solana)

- `GET /api/me_launchpad[?days=30]` — the whole launchpad calendar (`/v2/launchpad/collections`),
  split into live / upcoming / past, with floor + listed count for launched collections so you can
  see if a mint trades above or below mint price. Cached 2 min.
- `GET /api/me_wallet?address=` — NFTs grouped by collection (`/wallets/{w}/tokens`), floor per
  collection → estimated portfolio value, recent activity (`/wallets/{w}/activities`) and escrow
  balance. Magic Eden's collection categories (pfps, gaming, art, …) are attached for grouping.
- `GET /api/me_trending?range=1h|1d|7d|30d` — `/marketplace/popular_collections` enriched with
  live stats and categories. Cached 5 min.
- `GET /api/me_collection?symbol=<symbol or magiceden.io URL>[&address=]` — one collection in
  depth: stats, cheapest listings, latest sales, and how many the wallet holds.

The scan auto-detects the address type; pick **Solana** in the chain menu to browse the
launchpad and trending without an address. `?address=…` or `?sol=1` in the URL runs a scan on load.

### OpenSea (EVM)

- `GET /api/drops` — OpenSea's featured + upcoming + recently-minted calendars,
  de-duped, live drops first. Cached 2 min at the edge.
- `GET /api/check?address=&slug=` — one drop: reads its stages, then asks OpenSea to
  *build* a mint transaction for that address. If OpenSea can build it, the address can
  mint. The transaction is never sent.
- The page loops through the calendar 4 at a time, renders hits as they land, runs live
  countdowns, and re-checks a drop automatically the moment its next phase opens.

## Mint calendar

Its own collapsible widget: every phase OpenSea has scheduled that hasn't started yet,
in chronological order, grouped by day, with live countdowns. OpenSea's drops API has no
date-range parameter — there is no "next N days" option to ask for — so the calendar shows
the entire horizon the API returns and reports how many days that turned out to be
(typically 2-4 weeks). The 7D / 30D / ALL pills narrow the view locally.

Phases on a list this address is confirmed on are highlighted orange and marked
"YOU'RE ON THIS LIST"; **MINE ONLY** filters down to just those. Public phases are never
marked as yours — anyone can mint those.

## Reading the UI

Every drop / collection is a circle. The ring colour is the status, the ring fill is mint
progress (OpenSea drops), share of your portfolio (Solana holdings) or rank (trending).
**GROUP BY** switches between status, category (phase type for OpenSea: GTD / FCFS / WL /
PUBLIC; Magic Eden's own categories for Solana) and chain. The layout is responsive — on
phones the detail sheet slides up from the bottom, on desktop it docks on the right.

- **Orange** = yours: an allowlist stage this address can mint (OpenSea), NFTs you hold or a
  launchpad minting now (Magic Eden).
- **Light** = public stage, open to anyone.
- **Struck through** = closed, or address not on that list.
- **"?"** = phase not open yet. OpenSea can only confirm eligibility for a *currently
  open* stage, so future allowlist phases stay unknown until they start — leave the tab
  open and the page fills them in.
- **NEEDS FUNDS** = the stage is open and the address may be eligible, but the wallet
  can't cover price + gas on that chain, so OpenSea refuses to build the transaction.
  Keep a little native token in the wallet for clean yes/no answers.

## Debugging

    /api/drops?debug=1
    /api/check?address=0x...&slug=some-collection&debug=1

    /api/me_launchpad?debug=1
    /api/me_wallet?address=<solana address>&debug=1

All return the raw upstream payloads.
