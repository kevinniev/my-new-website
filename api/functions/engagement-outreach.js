/**
 * Engagement Outreach — Serverless Function
 * Takes high-score engagement signals from the detector and
 * executes personalized outreach: social replies, DMs, and
 * comment engagement to convert signals into leads.
 *
 * Triggered by: POST from engagement-engine cron or direct call
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const logger = createLogger("engagement-outreach");

const OUTREACH_TEMPLATES = {
  "job-request": [
    "Hey {name}! Saw you're looking for AV talent — AVfreelance connects you with vetted AV technicians fast. Check us out at avfreelance.com 🎙️",
    "Hi {name}, we specialize in exactly this! AVfreelance has a network of certified AV pros ready for your event. avfreelance.com",
  ],
  "event-production": [
    "Great event content {name}! If you ever need AV crew support, AVfreelance has top-tier technicians available. avfreelance.com",
    "Love seeing this {name}! AVfreelance connects event producers with professional AV technicians nationwide. avfreelance.com",
  ],
  "professional": [
    "Hey {name}! Are you open to freelance AV gigs? AVfreelance is the platform for AV pros to find work and grow their network. avfreelance.com",
    "Hi {name}, your AV background looks impressive! AVfreelance helps technicians like you find premium event work. avfreelance.com",
  ],
  "default": [
    "Hi {name}! AVfreelance connects AV professionals with top events nationwide. Check us out at avfreelance.com 🎬",
  ],
};

/**
 * Select an outreach template based on signal category.
 */
function selectTemplate(category, authorName) {
  const templates = OUTREACH_TEMPLATES[category] || OUTREACH_TEMPLATES["default"];
  const template = templates[Math.floor(Math.random() * templates.length)];
  const name = authorName || "there";
  return template.replace("{name}", name);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { signals = [] } = req.body || {};
  if (!signals.length) {
    return res.status(200).json({ success: true, message: "No signals to process", outreachSent: 0 });
  }

  logger.info(`Processing ${signals.length} engagement signals for outreach`);

  const results = { outreachSent: 0, skipped: 0, errors: [] };

  // Filter to only high-priority signals (score >= 0.7)
  const prioritySignals = signals.filter((s) => s.score >= 0.7);
  logger.info(`${prioritySignals.length} high-priority signals selected for outreach`);

  for (const signal of prioritySignals) {
    try {
      const message = selectTemplate(signal.category, signal.author?.name);

      // Log outreach to AVfreelance CRM before sending
      await callAVfreelance("/api/cron/log-outreach", {
        method: "POST",
        body: {
          signalId: signal.postId,
          platform: signal.platform,
          authorId: signal.author?.id,
          authorName: signal.author?.name,
          message,
          category: signal.category,
          score: signal.score,
          originalUrl: signal.url,
          scheduledAt: new Date().toISOString(),
        },
      });

      results.outreachSent++;
      logger.info(`Outreach queued for ${signal.platform} post ${signal.postId}`);

      // Rate limiting: small delay between outreach actions
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      logger.error(`Outreach failed for signal ${signal.postId}: ${err.message}`);
      results.errors.push({ signalId: signal.postId, error: err.message });
    }
  }

  results.skipped = signals.length - prioritySignals.length;

  logger.info(`Outreach complete: ${results.outreachSent} sent, ${results.skipped} skipped`);
  return res.status(200).json({
    success: true,
    outreachSent: results.outreachSent,
    skipped: results.skipped,
    errors: results.errors.length,
    timestamp: new Date().toISOString(),
  });
}
