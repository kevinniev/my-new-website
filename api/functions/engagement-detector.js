/**
 * Engagement Detector — Serverless Function
 * Scans social platforms for AV-related engagement signals:
 * mentions, hashtags, and inbound messages that indicate
 * a potential client or partner interaction.
 *
 * Triggered by: Vercel cron (every hour) or direct HTTP call
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";
import { searchHashtags, getRecentMentions } from "../../lib/social.js";
import { matchIndustry } from "../../lib/industry-matcher.js";

const logger = createLogger("engagement-detector");

const AV_HASHTAGS = [
  "#AVtechnician", "#AVfreelance", "#audiovisual", "#AVjobs",
  "#liveevent", "#eventtech", "#AVpro", "#stagetechnician",
  "#soundengineer", "#lightingtechnician", "#videotechnician",
  "#AVcrew", "#eventproduction", "#corporateAV",
];

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  logger.info("Starting engagement detection scan");
  const results = { scanned: 0, signals: [], errors: [] };

  try {
    // 1. Scan hashtags across platforms
    for (const tag of AV_HASHTAGS) {
      try {
        const posts = await searchHashtags(tag, { limit: 20 });
        for (const post of posts) {
          const match = await matchIndustry(post.text);
          if (match.isRelevant && match.score >= 0.6) {
            results.signals.push({
              platform: post.platform,
              postId: post.id,
              text: post.text.slice(0, 200),
              score: match.score,
              category: match.category,
              hashtag: tag,
              author: post.author,
              url: post.url,
              detectedAt: new Date().toISOString(),
            });
          }
        }
        results.scanned += posts.length;
      } catch (err) {
        logger.warn(`Hashtag scan failed for ${tag}: ${err.message}`);
        results.errors.push({ hashtag: tag, error: err.message });
      }
    }

    // 2. Check recent mentions of AVfreelance accounts
    try {
      const mentions = await getRecentMentions({ limit: 50 });
      for (const mention of mentions) {
        const match = await matchIndustry(mention.text);
        if (match.isRelevant) {
          results.signals.push({
            platform: mention.platform,
            postId: mention.id,
            text: mention.text.slice(0, 200),
            score: match.score,
            category: match.category,
            type: "mention",
            author: mention.author,
            url: mention.url,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.warn(`Mentions scan failed: ${err.message}`);
      results.errors.push({ type: "mentions", error: err.message });
    }

    // 3. Send signals to AVfreelance platform for CRM ingestion
    if (results.signals.length > 0) {
      try {
        await callAVfreelance("/api/cron/ingest-engagement-signals", {
          method: "POST",
          body: { signals: results.signals, source: "engagement-detector" },
        });
        logger.info(`Sent ${results.signals.length} signals to AVfreelance CRM`);
      } catch (err) {
        logger.error(`Failed to send signals to AVfreelance: ${err.message}`);
        results.errors.push({ type: "crm-ingest", error: err.message });
      }
    }

    logger.info(`Scan complete: ${results.scanned} posts scanned, ${results.signals.length} signals found`);
    return res.status(200).json({
      success: true,
      scanned: results.scanned,
      signalsFound: results.signals.length,
      errors: results.errors.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`Engagement detector failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
