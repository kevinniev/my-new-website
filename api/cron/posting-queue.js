/**
 * CRON: Posting Queue Processor
 * Schedule: daily at 10:00 AM UTC (0 10 * * *)
 *
 * Fetches all posts scheduled for today from AVfreelance and publishes them
 * to all configured social platforms.
 */

import { requireCron } from "../../lib/auth.js";
import { triggerPostingQueue, getAutomationMode } from "../../lib/avfreelance.js";
import { autopost } from "../../functions/autopost.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/posting-queue] Starting posting queue processor");

  try {
    let automationMode = { enabled: true };
    try {
      automationMode = await getAutomationMode();
    } catch (e) {
      logger.warn("[cron/posting-queue] Could not check automation mode, proceeding", { error: e.message });
    }

    if (!automationMode?.enabled) {
      logger.info("[cron/posting-queue] External Automation Mode is OFF — skipping");
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    // Fetch today's scheduled posts from AVfreelance
    const apiUrl = (process.env.AVFREELANCE_API_URL || "").replace(/\/$/, "");
    const apiKey = process.env.AVFREELANCE_API_KEY;

    let scheduledPosts = [];
    if (apiUrl && apiKey) {
      try {
        const res2 = await fetch(`${apiUrl}/api/webhooks/scheduled-posts-today`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res2.ok) {
          const data = await res2.json();
          scheduledPosts = data?.posts ?? [];
        }
      } catch (e) {
        logger.warn("[cron/posting-queue] Could not fetch scheduled posts", { error: e.message });
      }
    }

    logger.info("[cron/posting-queue] Fetched scheduled posts", { count: scheduledPosts.length });

    // Also trigger the internal AVfreelance posting queue
    let internalResult = {};
    try {
      internalResult = await triggerPostingQueue();
    } catch (e) {
      logger.warn("[cron/posting-queue] Internal posting queue trigger failed", { error: e.message });
    }

    // Post each scheduled item
    const postResults = [];
    for (const post of scheduledPosts) {
      try {
        const result = await autopost({
          content: post.content,
          imageUrl: post.imageUrl,
          platforms: post.platforms || ["facebook", "instagram", "x", "linkedin", "threads"],
        });
        postResults.push({ id: post.id, ok: true, platforms: result });

        // Mark as posted in AVfreelance
        if (apiUrl && apiKey) {
          await fetch(`${apiUrl}/api/webhooks/mark-post-published`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ postId: post.id, publishedAt: Date.now() }),
          }).catch(() => {});
        }
      } catch (e) {
        postResults.push({ id: post.id, ok: false, error: e.message });
        logger.error("[cron/posting-queue] Failed to post item", { postId: post.id, error: e.message });
      }
    }

    const elapsed = Date.now() - start;
    const successCount = postResults.filter((r) => r.ok).length;
    logger.info("[cron/posting-queue] Complete", {
      elapsed_ms: elapsed,
      posted: successCount,
      total: postResults.length,
    });

    return res.json({
      ok: true,
      elapsed_ms: elapsed,
      posted: successCount,
      total: postResults.length,
      internal: internalResult,
      results: postResults,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.error("[cron/posting-queue] Fatal error", { error: err.message, elapsed_ms: elapsed });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
