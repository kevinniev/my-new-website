/**
 * POST /api/webhooks/job-result
 * Receive results from external jobs and forward to AVfreelance.
 * Body: { jobId, status, result, error? }
 */
import { verifyWebhookSecret } from "../../lib/auth.js";
import { AVFreelanceClient } from "../../lib/avfreelance.js";
import { log } from "../../lib/logger.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyWebhookSecret(req)) return res.status(401).json({ error: "Unauthorized" });

  const { jobId, status, result, error } = req.body ?? {};
  if (!jobId || !status) return res.status(400).json({ error: "jobId and status are required" });

  log("info", `[job-result] Job ${jobId} → ${status}`);

  try {
    const client = new AVFreelanceClient();
    await client.post("/api/webhooks/job-result", { jobId, status, result, error });
    return res.status(200).json({ ok: true });
  } catch (err) {
    log("error", "[job-result] Forward failed", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
