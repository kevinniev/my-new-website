/**
 * CRON: Social Feed Refresh
 * Schedule: every 5 minutes (*/5 * * * *)
 *
 * Triggers the AVfreelance social scan endpoint which:
 * - Searches Twitter/X for AV service requests
 * - Searches LinkedIn Jobs for AV postings
 * - Deduplicates and stores new leads in the database
 * - Updates the live counter on the homepage
 */

import { requireCron } from "../../lib/auth.js";
import { createLogger } from "../../lib/logger.js";

const logger = createLogger("social-feed-refresh-cron");

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.AVFREELANCE_BASE_URL || "http://localhost:3000";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/social-feed-refresh] Starting social feed refresh");

  try {
    // Check if External Automation Mode is ON
    let automationMode = { enabled: true };
    try {
      automationMode = await getAutomationMode();
    } catch (e) {
      logger.warn("[cron/social-feed-refresh] Could not check automation mode, proceeding", { error: e.message });
    }

    if (!automationMode?.enabled) {
      logger.info("[cron/social-feed-refresh] External Automation Mode is OFF — skipping");
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    const result = await triggerSocialScan();

    const elapsed = Date.now() - start;
    logger.info("[cron/social-feed-refresh] Completed", {
      elapsed_ms: elapsed,
      new_leads: result?.newLeads ?? 0,
      scanned: result?.scanned ?? 0,
      errors: result?.errors ?? [],
    });

    return res.json({
      ok: true,
      elapsed_ms: elapsed,
      new_leads: result?.newLeads ?? 0,
      scanned: result?.scanned ?? 0,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.error("[cron/social-feed-refresh] Error", {
      error: err.message,
      elapsed_ms: elapsed,
    });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
