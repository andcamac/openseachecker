// GET /api/config?what=status — which integrations the server can actually see.
// Reports booleans only. No secret, and no part of a secret, is ever returned.
import { enabled as alertsEnabled, BOT_USERNAME } from "./alerts.js";

const has = (k) => !!(process.env[k] || "").trim();

export default function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const env = {
    OPENSEA_API_KEY: has("OPENSEA_API_KEY"),
    MAGICEDEN_API_KEY: has("MAGICEDEN_API_KEY"),
    HELIUS_API_KEY: has("HELIUS_API_KEY"),
    QUICKNODE_RPC_URL: has("QUICKNODE_RPC_URL") || has("SOLANA_RPC_URL"),
    PRIVY_APP_ID: has("PRIVY_APP_ID"),
    PRIVY_CLIENT_ID: has("PRIVY_CLIENT_ID"),
    TELEGRAM_BOT_TOKEN: has("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_BOT_USERNAME: has("TELEGRAM_BOT_USERNAME"),
    UPSTASH_REDIS_REST_URL: has("UPSTASH_REDIS_REST_URL"),
    UPSTASH_REDIS_REST_TOKEN: has("UPSTASH_REDIS_REST_TOKEN"),
    ALERTS_SECRET: has("ALERTS_SECRET"),
  };

  const missing = (...keys) => keys.filter((k) => !env[k]);

  const features = {
    evmDrops: { on: env.OPENSEA_API_KEY, missing: missing("OPENSEA_API_KEY") },
    solanaOnChain: {
      on: env.HELIUS_API_KEY || env.QUICKNODE_RPC_URL,
      missing: env.HELIUS_API_KEY || env.QUICKNODE_RPC_URL ? [] : ["HELIUS_API_KEY or QUICKNODE_RPC_URL"],
    },
    signIn: {
      on: env.PRIVY_APP_ID,
      missing: missing("PRIVY_APP_ID"),
      note: env.PRIVY_APP_ID
        ? "Also add this deployment's origin to Privy dashboard → Settings → Allowed origins AND redirect URIs, or Google login will bounce."
        : "Google login and wallet login both run through Privy — without PRIVY_APP_ID neither can work.",
    },
    telegramAlerts: {
      on: alertsEnabled() && !!BOT_USERNAME,
      missing: missing("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"),
      note: "After setting these, register the webhook once: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<this-origin>/api/tg&secret_token=<ALERTS_SECRET>",
    },
    alertScheduler: {
      on: env.ALERTS_SECRET,
      missing: missing("ALERTS_SECRET"),
      note: "Hobby plan can't run sub-daily crons — point an external scheduler (cron-job.org) at /api/alerts_tick?secret=<ALERTS_SECRET> every 5 minutes.",
    },
  };

  res.status(200).json({ env, features, at: new Date().toISOString() });
}
