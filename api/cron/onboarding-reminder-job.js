/**
 * Onboarding Reminder Job — runs daily at 9 AM UTC
 * Sends reminder emails to technicians who have been stuck on onboarding
 * for more than 24 hours without completing all steps.
 * Respects a 48-hour cooldown between reminders.
 */
import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const log = createLogger("onboarding-reminder-job");

// Reminder schedule: send after N days of inactivity
const REMINDER_SCHEDULE = [
  { daysAfterJoin: 1, subject: "Don't forget — complete your AVfreelance profile" },
  { daysAfterJoin: 3, subject: "Your AVfreelance profile is still incomplete" },
  { daysAfterJoin: 7, subject: "⚠️ Action required: Complete your AVfreelance onboarding" },
  { daysAfterJoin: 14, subject: "Last reminder: Finish your AVfreelance profile to get booked" },
];

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    log.info("Starting onboarding reminder job");

    // Get all technicians with incomplete onboarding
    const listResult = await callAVfreelance("/api/webhooks/onboarding/incomplete-list", {
      method: "GET",
    });

    if (!listResult.ok) {
      return res.status(500).json({ ok: false, error: "Failed to fetch technician list" });
    }

    const { technicians = [] } = listResult.data;
    const now = Date.now();
    const sent = [];
    const skipped = [];

    for (const tech of technicians) {
      const daysAgo = Math.floor((now - tech.createdAt) / (1000 * 60 * 60 * 24));
      const lastReminderDaysAgo = tech.lastReminderAt
        ? Math.floor((now - tech.lastReminderAt) / (1000 * 60 * 60 * 24))
        : null;

      // Find the appropriate reminder tier
      const tier = [...REMINDER_SCHEDULE].reverse().find(r => daysAgo >= r.daysAfterJoin);
      if (!tier) {
        skipped.push({ userId: tech.id, reason: "too_early" });
        continue;
      }

      // Skip if reminder was sent within 48 hours
      if (lastReminderDaysAgo !== null && lastReminderDaysAgo < 2) {
        skipped.push({ userId: tech.id, reason: "cooldown_active" });
        continue;
      }

      // Send reminder via AVfreelance webhook
      const reminderResult = await callAVfreelance("/api/webhooks/onboarding/send-reminder", {
        method: "POST",
        body: { userId: tech.id },
      });

      if (reminderResult.ok) {
        sent.push({
          userId: tech.id,
          name: tech.name,
          daysAgo,
          subject: tier.subject,
        });
        log.info(`Reminder sent to ${tech.name} (day ${daysAgo})`);
      } else {
        log.error(`Failed to send reminder to ${tech.name}`, { error: reminderResult.error });
        skipped.push({ userId: tech.id, reason: "send_failed" });
      }
    }

    log.info(`Reminder job complete: ${sent.length} sent, ${skipped.length} skipped`);
    return res.json({ ok: true, sent: sent.length, skipped: skipped.length, details: sent });
  } catch (err) {
    log.error("Onboarding reminder job error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
