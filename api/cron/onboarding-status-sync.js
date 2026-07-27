/**
 * Onboarding Status Sync — runs every 15 minutes
 * Syncs the onboarding completion status from AVfreelance to Vercel's
 * internal tracking, ensuring the reminder job has fresh data.
 * Also marks technicians as fully onboarded when all steps are complete.
 */
import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const log = createLogger("onboarding-status-sync");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    log.info("Starting onboarding status sync");

    // Get all technicians with incomplete onboarding
    const listResult = await callAVfreelance("/api/webhooks/onboarding/incomplete-list", {
      method: "GET",
    });

    if (!listResult.ok) {
      return res.status(500).json({ ok: false, error: "Failed to fetch technician list" });
    }

    const { technicians = [] } = listResult.data;
    const synced = [];
    const completed = [];

    for (const tech of technicians) {
      // Check current status
      const statusResult = await callAVfreelance(`/api/webhooks/onboarding/status/${tech.id}`, {
        method: "GET",
      });

      if (!statusResult.ok) continue;

      const { allComplete, steps, completionPct } = statusResult.data;

      if (allComplete) {
        // Mark as fully onboarded
        const completeResult = await callAVfreelance("/api/webhooks/onboarding/mark-complete", {
          method: "POST",
          body: { userId: tech.id },
        });
        if (completeResult.ok) {
          completed.push({ userId: tech.id, name: tech.name });
          log.info(`Marked ${tech.name} as fully onboarded`);
        }
      } else {
        synced.push({
          userId: tech.id,
          name: tech.name,
          completionPct,
          missingCount: steps?.filter((s) => !s.done)?.length ?? 0,
        });
      }
    }

    log.info(`Status sync complete: ${synced.length} synced, ${completed.length} newly completed`);
    return res.json({
      ok: true,
      synced: synced.length,
      newlyCompleted: completed.length,
      completedUsers: completed,
    });
  } catch (err) {
    log.error("Onboarding status sync error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
