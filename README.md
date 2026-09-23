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

- `GET /api/me?route=launchpad[&days=30]` — the whole launchpad calendar (`/v2/launchpad/collections`),
  split into live / upcoming / past, with floor + listed count for launched collections so you can
  see if a mint trades above or below mint price. Cached 2 min.
- `GET /api/me?route=wallet&address=` — NFTs grouped by collection (`/wallets/{w}/tokens`), floor per
  collection → estimated portfolio value, recent activity (`/wallets/{w}/activities`) and escrow
  balance. Magic Eden's collection categories (pfps, gaming, art, …) are attached for grouping.
- `GET /api/me?route=trending&range=1h|1d|7d|30d` — `/marketplace/popular_collections` enriched with
  live stats and categories. Cached 5 min.
- `GET /api/me?route=collection&symbol=<symbol or magiceden.io URL>[&address=]` — one collection in
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
- **USD everywhere**: `/api/config?what=prices` (CoinGecko, cached 60 s) puts a ≈ $ figure next to every
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
(`/api/me?route=launchpad`), grouped by chain (Ethereum, Base, …, Solana) with Magic Eden and OpenSea
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

## MY NFTS — browse a wallet and save the art

A separate panel (header → **MY NFTS**), deliberately not folded into the radar: different job,
its own scan box, its own state. Paste a wallet, optionally narrow it to one collection, get a grid
of everything it holds grouped by collection, tick what you want, hit **DOWNLOAD .ZIP**.

**The collection field is optional** and takes the same input as the CHECK box on the main page —
a bare slug (`the-puyo-paradox`), a full OpenSea URL (`https://opensea.io/collection/the-puyo-paradox?status=ownedByYou`),
or a Magic Eden URL. Filled in, it's passed to OpenSea as `&collection=`, so the filtering happens
upstream: far fewer requests, and the paging cap stops mattering for a targeted lookup. Left empty,
you get the whole wallet.

**Grouping.** Items are grouped by collection by default (switchable to chain, or off), biggest
group first. Each group header carries its item count, how many are picked, a SELECT/UNSELECT ALL
for that collection alone, and a fold arrow; COLLAPSE ALL / EXPAND ALL handles the lot. Folding is
a CSS class rather than a re-render, so scroll position and already-loaded images survive it.
Collection slugs are prettified for display (`the-puyo-paradox` → "The Puyo Paradox"); items with
no collection group by contract but are labelled "No collection" rather than a raw 0x address.

Files are named `collection_tokenid_name.ext`, sanitized for Windows (illegal characters, reserved
device names like `CON`, trailing dots, and duplicates all handled). Bytes are passed through
untouched, so what lands on disk is the original file the collection published. The zip writer is
~90 lines inlined in `index.html` (store-only: NFT images are already compressed, so deflate would
burn CPU for nothing) — no CDN library, no build step.

### Not losing items

The first cut of this quietly returned short lists. Three causes, all fixed, all worth remembering:

1. **`limit=50` when OpenSea's documented maximum is 200** — just 4x the round trips for the same data.
2. **A hard 20-page stop per chain** with no indication anything had been cut.
3. **An `is_suspicious` filter** that silently dropped items — and that field isn't even documented
   on this endpoint.

Now: `limit=200`, up to 50 pages per chain, a 40 s wall-clock budget so we stop before Vercel's 60 s
ceiling, and **nothing is ever dropped silently**. The response carries `byChain` (per-chain count,
`truncated`, `error`), a top-level `truncated`, and a `flagged` count; the panel prints the per-chain
counts in its header and shows a banner if the list is partial. Flagged items are shown, not hidden.

### Endpoints

- `GET /api/nfts?route=list&address=<0x… | base58>[&collection=slug][&chains=ethereum,base][&debug=1]`
  — everything the wallet holds, flattened to one shape. EVM goes through OpenSea (`/chain/{chain}/account/{address}/nfts`,
  paginated, across ethereum · base · matic · arbitrum · optimism · zora · blast, needs
  `OPENSEA_API_KEY`); Solana goes through Magic Eden (`/wallets/{address}/tokens`, no key). Cached
  60 s. Suspicious/spam NFTs flagged by OpenSea are dropped.
- `GET /api/nfts?route=img&url=<image url>` — streams the image back same-origin.

**Why the image proxy has to exist:** NFT art lives wherever the collection put it — IPFS gateways,
Arweave, S3 buckets, marketplace CDNs — and almost none of those send `Access-Control-Allow-Origin`.
Without CORS a browser can *display* an image but cannot *read its bytes*, so it can't be zipped or
written to disk. The proxy makes the bytes same-origin.

**It's a proxy, so it's an SSRF surface, and it's locked down accordingly:** https only; the
hostname must resolve to a public unicast address (loopback, RFC1918, CGNAT, link-local — which is
what blocks the `169.254.169.254` cloud-metadata endpoint — multicast, and the IPv6 equivalents
including IPv4-mapped addresses in either notation are all refused); redirects are followed manually
so *every* hop is re-checked rather than just the first; only `image/*`, `video/*` and `model/*`
come back; responses are capped at 40 MB. `ipfs://` and `ar://` are rewritten to public gateways.

## Layout — the rail

The shell is a 58px vertical icon rail plus a single content column. It replaced a stack of nine
full-width bars that put ~450px of chrome above the first mint circle.

The rail exists because the old toolbar mixed three different classes of control at the same visual
weight. They're now on separate planes:

| Class | Where it lives now |
|---|---|
| **Destinations** — radar, calendars, my NFTs, LaunchMyNFT, on-chain | Rail, top group |
| **Set once** — theme, dense, arrange, HOT+ only, hide-what-I-can't-mint, sound | Rail gear → `#setpop` |
| **Touched constantly** — status filters, group by, circles/table | The one toolbar row, and `#viewseg` on the scan line |
| **Session** — Telegram, command palette, sign-in | Rail, bottom group |

Other things the rail changed:

- **One line above the grid.** The wallet form and the single-collection form share a row with the
  view switch; they wrap to their own lines under 560px.
- **Secondary panels fold by default** and sit shoulder-to-shoulder in `.strips`; opening one gives
  it the full row. Long explanatory copy moved into `title` tooltips instead of wrapping to two lines.
- **Sign-in is an icon.** `renderAuth()` renders an initial in a disc once you're signed in, not a
  truncated address.
- **Under 820px the rail becomes a bottom tab bar**, padded for the phone's home indicator with
  `env(safe-area-inset-bottom)`.

Two CSS traps worth remembering if you touch this:

1. `.wrap` kept `margin: 0 auto` from the old layout. **An auto cross-axis margin cancels
   `align-items: stretch`**, so the column sized to its content and the page scrolled sideways on a
   phone. It's now `margin: 0; width: 100%`.
2. Rail popovers can't use `placePop()` — that drops a panel *below* its anchor, which is off-screen
   for a button at the foot of the rail. `placeRailPop()` opens beside the rail on desktop and
   upward from the tab bar on a phone, clamped to the viewport in both.

## Staying under OpenSea's rate limit

Three things in this app call OpenSea, and the heaviest is the drop scan — 400+ `/api/check`
requests per wallet. Three layers keep that under the ~4 req/s a standard key allows:

1. **One pacer per process** (`lib/opensea.js`). Concurrency limits alone don't bound a *rate*:
   three callers each politely doing one request at a time still burst to three at once. Every
   `osFetch` queues through one scheduler that releases requests no closer than `MIN_GAP_MS`
   (310 ms ≈ 3.2 req/s). A 429 widens the gap for **every** caller and it decays back on clean
   responses. `Retry-After` is honoured when OpenSea sends it.
2. **A gate in the browser** (`RATE` in `index.html`). A scan fans out across many serverless
   instances, which don't share the pacer above — the browser is the only place that sees the whole
   scan, so it throttles itself and backs off hard on a 429, then eases back.
3. **`/api/check` passes 429 through** instead of swallowing it. It used to record a rate-limited
   drop as `status: "skipped"` — a wrong answer presented as a real one. Now the browser retries it.

**Chains are opt-in.** `/api/nfts?route=list` scans **ethereum** alone unless you ask otherwise;
`chains=all` opts into all seven. Scanning every chain is seven times the requests, and doing it by
default is what tripped the limit in the first place. The picker in MY NFTS defaults to Ethereum,
offers each chain individually, and lists "All chains — slower" last. The panel says which chain it
scanned, and an empty result names it and points at the All chains option.

## When a source fails

Two rules, both learned from a console full of red:

**A failed chain is not a truncated list.** `evmChain()` used to return `truncated: true` on any
error, so a single rate-limited chain made the panel claim "hit the fetch limit — this is a partial
list", which was both wrong and unactionable. The response now carries them separately:

- `truncated` — we stopped paging (page cap or the 40 s budget). The wallet has more than one
  request can return.
- `partial` + `errors[]` — a chain failed. Its items are missing; everything else is complete.

The panel names the chain and quotes the upstream reason, and the vault has a **chain picker** so
"narrow it and scan again" is advice you can actually follow.

**Don't fire seven chains at once.** That reliably trips OpenSea's rate limit. Chains now run three
at a time (`CHAIN_CONCURRENCY`), and `osFetch` retries 429 *and* 5xx *and* timeouts with jittered
exponential backoff over four attempts, instead of three flat retries on 429 only.

**`/api/sol_mints` answers 200 when the RPC fails**, not 502. The on-chain radar is one panel on a
page that works fine without it; a red 502 in the console reads as "the site is broken" when the
honest answer is "Helius is rate-limiting right now". The reason travels in `error` and the panel
prints it, with a link to `?debug=1` for the raw cause. Free Helius and QuickNode tiers rate-limit
hard — this is the single most common cause.

## Serverless function budget

Vercel's Hobby plan allows **12 serverless functions per deployment**, and every `.js` file under
`api/` counts as one. So shared code lives in `lib/` (not deployed as functions) and the small
endpoints are fronted by two dispatchers:

- `api/me.js` → `?route=launchpad|trending|wallet|collection`
- `api/config.js` → `?what=prices|privy|alerts`

That leaves 9 functions: `check, drops, holdings, sol_mints, tg, alerts_tick, me, config, nfts`. The old
URLs (`/api/me_launchpad`, `/api/prices`, `/api/privy_config`, …) still resolve — `vercel.json`
rewrites them to the dispatchers — so bookmarks and any external cron keep working.

## Is it switched on? — `/api/config?what=status`

Sign-in and Telegram alerts are both **off unless their environment variables are set in Vercel**, and
a missing variable is otherwise invisible. Open `/api/config?what=status` on the deployment: it
reports, as booleans only (never a value, never part of one), which variables the server can see and
which feature each one gates.

| Feature | Needs |
|---|---|
| EVM drops | `OPENSEA_API_KEY` |
| On-chain Solana radar | `HELIUS_API_KEY` **or** `QUICKNODE_RPC_URL` |
| Sign in (Google **and** wallet — both run through Privy) | `PRIVY_APP_ID`, optionally `PRIVY_CLIENT_ID` |
| Telegram alerts | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Alert scheduler | `ALERTS_SECRET` + an external 5-minute cron on `/api/alerts_tick?secret=…` |

Two steps have no environment variable and are easy to miss:

1. **Privy**: add the deployment's origin (e.g. `https://openseachecker.vercel.app`) to *both* Allowed
   origins and Redirect URIs in the Privy dashboard, and enable Google as a login method. Without
   this, Google login redirects out and bounces back rejected even with a valid app id.
2. **Telegram**: register the webhook once, after deploying —
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>/api/tg&secret_token=<ALERTS_SECRET>`.
   Until this runs, the bot receives nothing and `/start` does nothing.

Env vars only take effect on the **next** deployment — setting one does not update a running build.

## Debugging

    /api/drops?debug=1
    /api/check?address=0x...&slug=some-collection&debug=1

    /api/me?route=launchpad&debug=1
    /api/me?route=wallet&address=<solana address>&debug=1

All return the raw upstream payloads.
