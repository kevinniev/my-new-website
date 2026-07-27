/**
 * Cron Authentication Guard
 *
 * Vercel cron jobs call your API routes with the header:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * This utility validates that header so only Vercel (or your own callers
 * with the secret) can trigger the cron endpoints.
 *
 * Usage:
 *   import { requireCron } from "../lib/auth.js";
 *   export default async function handler(req, res) {
 *     if (!requireCron(req, res)) return;
 *     // ... your logic
 *   }
 */

/**
 * Validate the cron secret.
 * Returns true if valid; writes a 401 and returns false if not.
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 */
export function requireCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // If no secret is set, allow in development but warn
    if (process.env.VERCEL_ENV !== "production") return true;
    res.status(500).json({ error: "CRON_SECRET not configured" });
    return false;
  }
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/**
 * Validate an inbound webhook from AVfreelance.
 * AVfreelance signs webhook payloads with AVFREELANCE_WEBHOOK_SECRET.
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 */
export function requireWebhookAuth(req, res) {
  const secret = process.env.AVFREELANCE_WEBHOOK_SECRET;
  if (!secret) return true; // optional — only enforce if secret is set
  const sig = req.headers["x-avfreelance-signature"] || "";
  if (sig !== secret) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return false;
  }
  return true;
}

export default { requireCron, requireWebhookAuth };
