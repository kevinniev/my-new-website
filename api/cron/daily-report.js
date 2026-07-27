/**
 * CRON: Daily Report
 * Schedule: daily at 12:00 PM UTC (0 12 * * *)
 *
 * Generates and delivers the daily engagement summary:
 * - New social leads
 * - Engagement metrics across all platforms
 * - New job applications
 * - Revenue from crewing partnerships
 * - CRM pipeline updates
 */

import { requireCron } from "../../lib/auth.js";
import { generateDailyReport, getAutomationMode } from "../../lib/avfreelance.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/daily-report] Generating daily report");

  try {
    let automationMode = { enabled: true };
    try { automationMode = await getAutomationMode(); } catch {}

    if (!automationMode?.enabled) {
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    const result = await generateDailyReport();

    const elapsed = Date.now() - start;
    logger.info("[cron/daily-report] Complete", { elapsed_ms: elapsed, result });
    return res.json({ ok: true, elapsed_ms: elapsed, report: result });
  } catch (err) {
    logger.error("[cron/daily-report] Error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
