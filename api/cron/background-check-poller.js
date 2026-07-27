/**
 * Background Check Poller — runs every 2 hours
 * Polls for background check status updates from the background check provider
 * and syncs results back to AVfreelance. Notifies technicians when their
 * background check is complete.
 */
import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const log = createLogger("background-check-poller");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    log.info("Starting background check polling run");

    // Get all pending background checks from AVfreelance
    const pendingResult = await callAVfreelance("/api/webhooks/onboarding/pending-background-checks", {
      method: "GET",
    });

    if (!pendingResult.ok) {
      return res.status(500).json({ ok: false, error: "Failed to fetch pending background checks" });
    }

    const { checks = [] } = pendingResult.data;
    log.info(`Found ${checks.length} pending background checks`);

    const updated = [];
    const stillPending = [];

    for (const check of checks) {
      // Check if background check has been manually updated in AVfreelance
      const statusResult = await callAVfreelance(`/api/webhooks/onboarding/background-check-status/${check.userId}`, {
        method: "GET",
      });

      if (!statusResult.ok) {
        stillPending.push({ userId: check.userId, reason: "status_fetch_failed" });
        continue;
      }

      const { status, completedAt } = statusResult.data;

      if (status === "approved" || status === "rejected") {
        // Background check is complete — notify technician
        const notifyResult = await callAVfreelance("/api/webhooks/onboarding/notify-background-check-complete", {
          method: "POST",
          body: {
            userId: check.userId,
            status,
            completedAt,
          },
        });

        updated.push({
          userId: check.userId,
          name: check.name,
          status,
          notified: notifyResult.ok,
        });
        log.info(`Background check ${status} for user ${check.userId} (${check.name})`);
      } else {
        // Check how long it's been pending
        const daysPending = Math.floor((Date.now() - check.requestedAt) / (1000 * 60 * 60 * 24));

        // Send escalation reminder if pending > 5 days
        if (daysPending > 5 && !check.escalationSent) {
          await callAVfreelance("/api/webhooks/onboarding/escalate-background-check", {
            method: "POST",
            body: { userId: check.userId, daysPending },
          });
          log.info(`Escalated background check for user ${check.userId} (${daysPending} days pending)`);
        }

        stillPending.push({ userId: check.userId, daysPending });
      }
    }

    log.info(`Background check polling complete: ${updated.length} updated, ${stillPending.length} still pending`);
    return res.json({
      ok: true,
      total: checks.length,
      updated: updated.length,
      stillPending: stillPending.length,
      updatedDetails: updated,
    });
  } catch (err) {
    log.error("Background check poller error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
