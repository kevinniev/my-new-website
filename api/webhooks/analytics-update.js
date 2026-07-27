/**
 * POST /api/webhooks/analytics-update
 * Push analytics data (impressions, reach, engagement rates) to AVfreelance.
 * Body: { platform, metrics: object, date: ISO string }
 */
import { verifyWebhookSecret } from "../../lib/auth.js";
import { AVFreelanceClient } from "../../lib/avfreelance.js";
import { log } from "../../lib/logger.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyWebhookSecret(req)) return res.status(401).json({ error: "Unauthorized" });

  const { platform, metrics, date } = req.body ?? {};
  if (!platform || !metrics) return res.status(400).json({ error: "platform and metrics are required" });

  log("info", `[analytics-update] platform=${platform} date=${date}`);

  try {
    const client = new AVFreelanceClient();
    await client.post("/api/webhooks/analytics-update", { platform, metrics, date });
    return res.status(200).json({ ok: true });
  } catch (err) {
    log("error", "[analytics-update] Failed", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
