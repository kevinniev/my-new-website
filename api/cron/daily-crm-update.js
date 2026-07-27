/**
 * CRON: Daily CRM Update
 * Schedule: daily at 11:00 AM UTC (0 11 * * *)
 *
 * Syncs all engagement, conversion, and pipeline data into the AVfreelance CRM:
 * - New leads from social scans
 * - Engagement touchpoints (likes, comments, DMs)
 * - Pipeline stage changes
 * - Conversion events (signup, application, hire)
 */

import { requireCron } from "../../lib/auth.js";
import { updateCRM, getDailyCRMSummary, getAutomationMode } from "../../lib/avfreelance.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/daily-crm-update] Starting CRM update");

  try {
    let automationMode = { enabled: true };
    try { automationMode = await getAutomationMode(); } catch {}

    if (!automationMode?.enabled) {
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    // Get yesterday's summary
    const summary = await getDailyCRMSummary();

    // Push update to AVfreelance CRM
    const updateResult = await updateCRM({
      data: {
        date: new Date().toISOString().split("T")[0],
        source: "vercel-cron",
        summary,
      },
    });

    const elapsed = Date.now() - start;
    logger.info("[cron/daily-crm-update] Complete", { elapsed_ms: elapsed });
    return res.json({ ok: true, elapsed_ms: elapsed, summary, update: updateResult });
  } catch (err) {
    logger.error("[cron/daily-crm-update] Error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
