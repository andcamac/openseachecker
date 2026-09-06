# Mint Radar

Paste a wallet address, see which OpenSea drops it can mint right now — public stages
and allowlist phases (GTD / FCFS / WL / team). No wallet connection, no signing, no
OpenSea login. Uses only OpenSea's documented public API v2.

## Deploy to Vercel (~3 minutes)

1. Free OpenSea API key: https://docs.opensea.io/reference/api-keys
2. Push this folder to GitHub, or drag it onto https://vercel.com/new
3. Import as a new project — framework "Other", no build command.
4. Environment Variables → add `OPENSEA_API_KEY` = your key. **Then deploy.**
   (If you add the key after deploying, redeploy so the functions pick it up.)

Terminal alternative:

    npm i -g vercel
    vercel
    vercel env add OPENSEA_API_KEY production
    vercel --prod

Recommended for private use: Vercel → Settings → Deployment Protection →
enable Vercel Authentication, so only your login can run scans on your API key.

## How it works

- `GET /api/drops` — OpenSea's featured + upcoming + recently-minted calendars,
  de-duped, live drops first. Cached 2 min at the edge.
- `GET /api/check?address=&slug=` — one drop: reads its stages, then asks OpenSea to
  *build* a mint transaction for that address. If OpenSea can build it, the address can
  mint. The transaction is never sent.
- The page loops through the calendar 4 at a time, renders hits as they land, runs live
  countdowns, and re-checks a drop automatically the moment its next phase opens.

## Reading the UI

- **Orange** = an allowlist stage this address can mint, confirmed by OpenSea.
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

Both return the raw OpenSea payloads.
