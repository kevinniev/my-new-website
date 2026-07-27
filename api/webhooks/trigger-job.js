/**
 * POST /api/webhooks/trigger-job
 * AVfreelance → Vercel: trigger a specific automation job on demand.
 * Body: { job: "social-scan" | "engagement" | "post" | "partner-jobs" | "analytics", payload?: object }
 */
import { verifyWebhookSecret } from "../../lib/auth.js";
import { log } from "../../lib/logger.js";

const JOB_HANDLERS = {
  "social-scan": () => import("../cron/social-feed-refresh.js").then(m => m.handler()),
  "engagement":  () => import("../cron/engagement-engine.js").then(m => m.handler()),
  "post":        () => import("../cron/posting-queue.js").then(m => m.handler()),
  "partner-jobs":() => import("../cron/partner-job-pull.js").then(m => m.handler()),
  "analytics":   () => import("../cron/analytics-sync.js").then(m => m.handler()),
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifyWebhookSecret(req)) return res.status(401).json({ error: "Unauthorized" });

  const { job, payload } = req.body ?? {};
  if (!job || !JOB_HANDLERS[job]) {
    return res.status(400).json({ error: `Unknown job: ${job}. Valid: ${Object.keys(JOB_HANDLERS).join(", ")}` });
  }

  log("info", `[trigger-job] Triggered: ${job}`, payload);

  try {
    const result = await JOB_HANDLERS[job]();
    return res.status(200).json({ ok: true, job, result });
  } catch (err) {
    log("error", `[trigger-job] Failed: ${job}`, err);
    return res.status(500).json({ ok: false, job, error: err.message });
  }
}
