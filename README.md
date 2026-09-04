# Mint Check

Paste a wallet address, see which OpenSea drops it can mint right now.
No wallet connection, no signing. Uses only OpenSea's documented public API.

## Deploy to Vercel (about 3 minutes)

1. Get a free OpenSea API key: https://docs.opensea.io/reference/api-keys
2. Push this folder to a GitHub repo (or drag-and-drop it on vercel.com/new).
3. On vercel.com: **Add New → Project → Import** the repo. Leave framework as "Other".
4. Before clicking Deploy, open **Environment Variables** and add:
   - Name: `OPENSEA_API_KEY`   Value: your key
5. Deploy. Your site is at `https://<project>.vercel.app`.

Or from a terminal:

    npm i -g vercel
    vercel                      # first deploy, answer the prompts
    vercel env add OPENSEA_API_KEY production
    vercel --prod

## Notes

- The key stays server-side in `api/check.js`; the browser never sees it.
- `vercel.json` raises the function timeout to 60s (a full scan is 15–45s).
- Optional: in Vercel → Settings → Deployment Protection, turn on
  "Vercel Authentication" so only you can open the page.
