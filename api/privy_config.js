// GET /api/privy_config — tells the page whether Privy login is configured.
// Set PRIVY_APP_ID (and PRIVY_CLIENT_ID, from Privy dashboard → Settings → Clients) in Vercel.
// Both values are public by design — they identify the app to Privy, they are not secrets.
export default function handler(req, res) {
  const appId = process.env.PRIVY_APP_ID || "";
  const clientId = process.env.PRIVY_CLIENT_ID || "";
  res.setHeader("cache-control", "s-maxage=300");
  res.status(200).json({ enabled: !!appId, appId: appId || null, clientId: clientId || null });
}
