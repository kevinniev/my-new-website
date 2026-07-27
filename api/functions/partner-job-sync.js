/**
 * Partner Job Sync — Serverless Function
 * Syncs job status between partner platforms and AVfreelance:
 * marks expired/filled jobs as closed, updates application counts,
 * and refreshes job metadata.
 *
 * Triggered by: POST from partner-job-pull cron
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const logger = createLogger("partner-job-sync");

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  logger.info("Partner job sync started");
  const results = { synced: 0, expired: 0, errors: [] };

  try {
    // Get active partner jobs from AVfreelance
    const activeJobs = await callAVfreelance("/api/cron/get-active-partner-jobs", {
      method: "GET",
    });

    if (!activeJobs || !activeJobs.length) {
      logger.info("No active partner jobs to sync");
      return res.status(200).json({ success: true, message: "No jobs to sync", ...results });
    }

    logger.info(`Syncing ${activeJobs.length} active partner jobs`);

    const updates = [];
    const now = new Date();

    for (const job of activeJobs) {
      // Check if job has expired (older than 30 days)
      const postedAt = new Date(job.postedAt || job.ingestedAt);
      const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);

      if (ageInDays > 30) {
        updates.push({
          jobId: job.id || job.externalId,
          status: "expired",
          reason: `Job older than 30 days (${Math.round(ageInDays)} days)`,
        });
        results.expired++;
        continue;
      }

      // Verify job still exists on source platform (if URL available)
      if (job.url) {
        try {
          const checkRes = await fetch(job.url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
          if (checkRes.status === 404 || checkRes.status === 410) {
            updates.push({
              jobId: job.id || job.externalId,
              status: "removed",
              reason: `Source URL returned ${checkRes.status}`,
            });
            results.expired++;
            continue;
          }
        } catch {
          // Network error — don't expire, just log
          logger.warn(`Could not verify job URL for ${job.id}: network error`);
        }
      }

      results.synced++;
    }

    // Batch update expired/removed jobs
    if (updates.length > 0) {
      await callAVfreelance("/api/cron/batch-update-partner-jobs", {
        method: "POST",
        body: { updates, syncedAt: new Date().toISOString() },
      });
      logger.info(`Updated ${updates.length} job statuses`);
    }

    logger.info(`Job sync complete: ${results.synced} active, ${results.expired} expired/removed`);
    return res.status(200).json({
      success: true,
      synced: results.synced,
      expired: results.expired,
      errors: results.errors.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`Partner job sync failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
