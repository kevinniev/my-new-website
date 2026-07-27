/**
 * Missing Step Detector — runs every hour
 * Scans all technicians for missing onboarding steps and logs them.
 * Feeds data into the reminder job.
 */
import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const log = createLogger("missing-step-detector");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    log.info("Starting missing step detection run");

    // Get all technicians with incomplete onboarding
    const listResult = await callAVfreelance("/api/webhooks/onboarding/incomplete-list", {
      method: "GET",
    });

    if (!listResult.ok) {
      return res.status(500).json({ ok: false, error: "Failed to fetch technician list" });
    }

    const { technicians = [] } = listResult.data;
    const report = [];

    for (const tech of technicians) {
      const detectResult = await callAVfreelance("/api/webhooks/onboarding/detect-missing", {
        method: "POST",
        body: { userId: tech.id },
      });

      if (detectResult.ok && detectResult.data?.missingSteps?.length > 0) {
        report.push({
          userId: tech.id,
          name: tech.name,
          email: tech.email,
          missingSteps: detectResult.data.missingSteps,
          joinedDaysAgo: Math.floor((Date.now() - tech.createdAt) / (1000 * 60 * 60 * 24)),
        });
      }
    }

    // Sort by most missing steps first
    report.sort((a, b) => b.missingSteps.length - a.missingSteps.length);

    log.info(`Missing step detection complete: ${report.length} technicians need action`);
    return res.json({
      ok: true,
      totalIncomplete: report.length,
      report,
    });
  } catch (err) {
    log.error("Missing step detector error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
