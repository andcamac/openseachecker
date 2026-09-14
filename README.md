# Mint Radar

A live mint radar for EVM chains and Solana, assembled from public marketplace APIs and on-chain
data. Nothing is curated by hand and no wallet signature is ever required to read.


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

### Solana marketplace API

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

On page load the app shows Magic Eden's upcoming and live launchpad mints straight away (countdowns, price, supply), before any address is entered; they stay on screen during an OpenSea scan. The scan auto-detects the address type; pick **Solana** in the chain menu to browse the
launchpad and trending without an address. `?address=…` or `?sol=1` in the URL runs a scan on load.

### OpenSea (EVM)

- `GET /api/drops` — OpenSea's featured + upcoming + recently-minted calendars,
  de-duped, live drops first. Cached 2 min at the edge.
- `GET /api/check?address=&slug=` — one drop: reads its stages, then asks OpenSea to
  *build* a mint transaction for that address. If OpenSea can build it, the address can
  mint. The transaction is never sent.
- The page loops through the calendar 4 at a time, renders hits as they land, runs live
  countdowns, and re-checks a drop automatically the moment its next phase opens.

## On-chain Solana mint radar (any launchpad)

`GET /api/sol_mints` reads the chain instead of a launchpad. Nearly every Solana launchpad
(LaunchMyNFT, Metaplex Creator Studio, Truffle, custom sites) mints through Metaplex **Candy
Machine v3** or **Core Candy Machine**, so the route pulls the latest transactions on those two
programs (Helius enhanced transactions API), collects every candy machine they touch, decodes each
one plus its Candy Guard — start/end date, SOL price, per-wallet limit, allowlist, bot tax, phase
groups — and resolves the collection's name and image via Helius DAS. You get what is minting
right now, what was just deployed, and what is scheduled, regardless of where the mint page lives.

Works with either provider — set one (or both) in Vercel:

- `HELIUS_API_KEY` (free tier: https://dashboard.helius.dev) — uses Helius's enhanced-transactions
  API (one request per 100 transactions) and DAS for collection metadata. Fastest.
- `QUICKNODE_RPC_URL` (your QuickNode Solana mainnet endpoint URL, free tier works; `SOLANA_RPC_URL`
  is accepted as an alias and any standard Solana RPC will do) — uses plain JSON-RPC:
  `getSignaturesForAddress` + batched `getTransaction` (25 per request). Collection name/image
  come from the QuickNode **Metaplex DAS API add-on** if you've enabled it, otherwise they're read
  from the Metaplex Token Metadata / Core collection accounts and the metadata JSON.
  Default scan depth is 2 pages per program (≈ 400 transactions ≈ 18 RPC requests).

If both are set, Helius handles the transaction scan and QuickNode serves account reads. Without
either, the section stays off and the app says so. Results cache 90 s. `?pages=1..6` controls how
far back the scan looks (100 transactions per page per program); `?debug=1` shows which provider
answered.

## LaunchMyNFT widget

LaunchMyNFT has no public API and no upcoming-mints calendar (collections go live the moment a
creator deploys them), so the app embeds its live explore page — LATEST / HOT — in a collapsible
panel. The frame only loads while the panel is open. It's also linked from the Solana section of
CALENDARS.

## Terms gate

First visit shows a full-screen terms & disclaimer page: the app fetches nothing until it is
accepted, and the acceptance is stored per browser (`mintradar:terms:v1`). The text states plainly
that the tool only relays public API and on-chain data, curates nothing, gives no financial advice,
never takes custody or asks for a key, and carries no liability for losses. ⌘K → *View terms*
re-opens it read-only.

## Telegram button

A **🔔 TELEGRAM** button sits in the header at all times. Configured, it opens the bot, offers a
one-tap "alert me when this wallet is eligible" link for the scanned address, and lists the bot
commands. Unconfigured, it says so and names the environment variables the operator needs — so the
feature is never invisible.

## Themes, layout and sign-in

**Themes.** The **◐ THEME** button switches the whole palette: **Ember** (the original), **Midnight**,
**Matrix**, **Grape** and **Paper** (light). Every colour in the app is a CSS variable, so a theme is
one block of tokens — add your own by copying a `[data-theme="…"]` block in the `<style>` head. The
choice is remembered per device.

**Arrange.** **⠿ ARRANGE** turns on drag mode: drag circles into whatever order you want, inside any
group, on desktop or touch. The order is saved on the device and applied on every later scan;
⌘K → *Reset layout* puts it back to the default sort.

**Sign in (optional).** With `PRIVY_APP_ID` (and optionally `PRIVY_CLIENT_ID`) set in Vercel, a
**SIGN IN** button appears offering:

- **Continue with Google** — Privy OAuth; returns to the app, links (and can create) an embedded
  wallet, and scans it.
- **Connect EVM wallet** — sign-in-with-Ethereum through the browser wallet.
- **Use Phantom (read-only)** — reads the public key with no signature at all, shown when Phantom
  is present.

Signed in, the account menu lists every linked wallet; tap one to scan it or **Scan all wallets**.
The app only ever reads public addresses — it never asks for a key and never builds or sends a
transaction. Without the env var the button stays hidden and pasting addresses works exactly as
before. Privy's vanilla SDK (`@privy-io/js-sdk-core`) is loaded from a CDN only when someone clicks
sign in, so the page stays light.

## Telegram alerts

The radar works with the tab closed. Optional — the 🔔 buttons only appear once it's configured.

1. **Create a bot**: message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token and the
   bot's username.
2. **Create a free Redis**: [Upstash](https://console.upstash.com) → Create database → copy the
   **REST URL** and **REST token** (the free tier is far more than enough).
3. **Vercel → Settings → Environment Variables**, then redeploy:
   - `TELEGRAM_BOT_TOKEN` — from BotFather
   - `TELEGRAM_BOT_USERNAME` — e.g. `MintRadarBot` (no `@`)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `ALERTS_SECRET` — any long random string
4. **Register the webhook** once (replace the placeholders):

       curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>/api/tg&secret_token=<ALERTS_SECRET>"

5. **Schedule the tick** every ~5 minutes with a free external scheduler such as
   [cron-job.org](https://cron-job.org), pointed at
   `https://<your-app>/api/alerts_tick?secret=<ALERTS_SECRET>`.

   > **Two `vercel.json` gotchas, both of which break the deployment silently:**
   >
   > 1. Patterns in `functions` must not overlap. Each function is claimed by the first matching
   >    pattern, so a general `api/*.js` plus a specific `api/alerts_tick.js` makes the specific one
   >    match nothing and the build fails with *"doesn't match any Serverless Functions"*. One
   >    pattern covering everything is the safe form.
   > 2. **Do not put a sub-daily `crons` block in `vercel.json` on a Hobby plan.** Vercel Hobby allows
   > cron jobs only once per day, and a more frequent expression makes the **deployment itself fail**
   > — the site keeps serving the previous build with no obvious error on the page. That is why
   > `vercel.json` here declares no crons. On a Pro plan you can add:
   >
   >     "crons": [{ "path": "/api/alerts_tick", "schedule": "*/5 * * * *" }]
   >
   > Vercel's own `CRON_SECRET` bearer header is accepted by the route as well as `?secret=`.

**What users get.** In the app, every mint's detail sheet has a **🔔 TELEGRAM ALERT** button — it
deep-links into the bot and starts the watch with one tap. In the bot: `/watch <id>`, `/unwatch`,
`/list`, `/new` (ping on every new on-chain Solana candy machine) and `/wallet 0x…` (ping when that
wallet becomes eligible for a live OpenSea drop). Alerts fire 10 minutes before a phase opens, when
it opens, on new deployments, and on wallet eligibility; each is de-duplicated in Redis so a repeated
tick never spams.

## Signal score

Every project gets a 0-100 **signal** from free public data — no paid X API:

- **Discord**: live member and online counts through the public invite API (a dead invite is a
  negative), plus verified/partnered servers.
- **Marketplace verification**: OpenSea safelist status, Magic Eden badge.
- **Completeness**: website, X, artwork present.

Tiers are **COLD → WARM → HOT → BLAZING**, shown as a chip under each circle and as a sortable
column in the table, with the reasoning in the detail sheet. **HOT+ ONLY** in the toolbar filters the
board down to projects with a real community behind them.

## Multi-wallet scanning

Paste several addresses separated by commas (up to 10) — all EVM or all Solana. Each drop is checked
for every wallet, the board shows the best result with a **YOU'RE IN · 2/5** count, and the detail
sheet breaks it down per wallet. Solana holdings, portfolio value and activity merge across wallets.
No wallet connection or signature at any point — the app only ever reads public addresses.

## Live feed, table view, prices, trust signals

- **LIVE ticker** under the header: new on-chain deployments, newly listed mints and phase
  openings stream in as chips (tap one to open its sheet). Solana sources auto-refresh — on-chain
  every 60 s, Magic Eden launchpad every 2.5 min (both edge-cached, so it costs nothing upstream);
  "updated Ns ago" shows freshness and turns orange when stale. When a countdown hits zero the
  circle pulses and, with **🔔 SOUND** on, the page beeps.
- **VIEW: CIRCLES / TABLE** — same items as a dense sortable table (click a column header):
  collection, source · chain, status, phase, price, minted with progress bar, opens/ends, links.
- **USD everywhere**: `/api/prices` (CoinGecko, cached 60 s) puts a ≈ $ figure next to every
  SOL / ETH price; launched Magic Eden collections show **floor vs mint** as a % badge.
- **Trust signals**: ✔ = verified on Magic Eden; **⚠ UNVERIFIED** greys out on-chain candy
  machines with no website, no socials and no image (the classic rug shape); **?** flags missing
  socials or hidden metadata. Signal dots on each circle: light = OpenSea, orange = Magic Eden,
  grey = on-chain.
- **⌘K / Ctrl+K / `/`** opens a command palette: search any loaded collection, paste an address or
  URL to scan/check, switch view, grouping, filters, open Calendars.
- **DENSE** shrinks circles and hides link rows for a tighter desktop grid.

## Calendars

The **CALENDARS** button opens a full view built from both APIs with no wallet needed:
OpenSea's featured / upcoming / live drop calendars (`/api/drops`) and Magic Eden's launchpad
(`/api/me_launchpad`), grouped by chain (Ethereum, Base, …, Solana) with Magic Eden and OpenSea
listed as separate categories under each chain. Live mints first, then soonest. ALL / 24H / 7D / 30D
narrow the window; REFRESH re-pulls (results are cached 2 min).

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
Under every circle a row of small link bubbles gives the project's website, X, Discord (and Instagram /
Telegram when OpenSea lists them) plus its marketplace page — pulled from OpenSea collection info,
Magic Eden collection info, or the on-chain metadata JSON for candy machines. **GROUP BY** switches between **chain** (the default — Ethereum, Base, Solana…), **status**, and
**phase** (Public / GTD / FCFS / Whitelist / Team, with unrecognised creator stage labels collected
into "Other phases" rather than one group each). Solana **on-chain** mints sit in their own
collapsible section below the board, so raw Candy Machine discoveries never crowd out the
marketplace drops. Anything a scanned wallet is confirmed eligible to mint gets an **orange
background** — in both the circle and table views. The layout is responsive — on
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
