/**
 * Onboarding Checker — runs every 30 minutes
 * Fetches all technicians with incomplete onboarding from AVfreelance,
 * then calls the missing-step detector for each one.
 */
import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const log = createLogger("onboarding-checker");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify cron secret
  const secret = req.headers["x-cron-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    log.info("Starting onboarding checker run");

    // Fetch all technicians with incomplete onboarding
    const result = await callAVfreelance("/api/webhooks/onboarding/incomplete-list", {
      method: "GET",
    });

    if (!result.ok) {
      log.error("Failed to fetch incomplete technicians", { status: result.status });
      return res.status(500).json({ ok: false, error: "Failed to fetch incomplete technicians" });
    }

    const { technicians = [] } = result.data;
    log.info(`Found ${technicians.length} technicians with incomplete onboarding`);

    const results = [];
    for (const tech of technicians) {
      try {
        const detectResult = await callAVfreelance("/api/webhooks/onboarding/detect-missing", {
          method: "POST",
          body: { userId: tech.id },
        });
        results.push({
          userId: tech.id,
          name: tech.name,
          ok: detectResult.ok,
          missingSteps: detectResult.data?.missingSteps ?? [],
        });
      } catch (err) {
        log.error(`Failed to detect missing steps for user ${tech.id}`, { error: err.message });
        results.push({ userId: tech.id, name: tech.name, ok: false, error: err.message });
      }
    }

    const processed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    log.info(`Onboarding checker complete: ${processed} processed, ${failed} failed`);
    return res.json({ ok: true, processed, failed, total: technicians.length, results });
  } catch (err) {
    log.error("Onboarding checker error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
