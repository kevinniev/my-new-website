/**
 * POST /api/webhooks/crm-update
 * Push CRM updates (new leads, contacts, engagement events) to AVfreelance.
 * Body: { type: "lead" | "contact" | "engagement", data: object }
 */
import { verifyWebhookSecret } from "../../lib/auth.js";
import { AVFreelanceClient } from "../../lib/avfreelance.js";
import { log } from "../../lib/logger.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyWebhookSecret(req)) return res.status(401).json({ error: "Unauthorized" });

  const { type, data } = req.body ?? {};
  if (!type || !data) return res.status(400).json({ error: "type and data are required" });

  log("info", `[crm-update] type=${type}`, { count: Array.isArray(data) ? data.length : 1 });

  try {
    const client = new AVFreelanceClient();
    await client.post("/api/webhooks/crm-update", { type, data });
    return res.status(200).json({ ok: true });
  } catch (err) {
    log("error", "[crm-update] Failed", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
