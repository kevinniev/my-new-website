/**
 * Autopost Engine — Serverless Function
 * Fetches scheduled posts from the AVfreelance platform and
 * distributes them across all connected social platforms:
 * Instagram, Facebook, X (Twitter), Threads, and LinkedIn.
 *
 * Triggered by: Vercel cron (posting-queue) or direct POST
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";
import {
  postToFacebook,
  postToInstagram,
  postToX,
  postToLinkedIn,
  postToThreads,
} from "../../lib/social.js";

const logger = createLogger("autopost-engine");

const PLATFORM_HANDLERS = {
  facebook: postToFacebook,
  instagram: postToInstagram,
  twitter: postToX,
  x: postToX,
  linkedin: postToLinkedIn,
  threads: postToThreads,
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  logger.info("Autopost engine started");
  const results = { posted: 0, failed: 0, skipped: 0, errors: [] };

  try {
    // 1. Fetch pending posts from AVfreelance platform
    const pendingPosts = await callAVfreelance("/api/cron/get-pending-posts", {
      method: "GET",
    });

    if (!pendingPosts || !pendingPosts.length) {
      logger.info("No pending posts in queue");
      return res.status(200).json({ success: true, message: "No posts in queue", ...results });
    }

    logger.info(`Processing ${pendingPosts.length} pending posts`);

    for (const post of pendingPosts) {
      const { id, content, platforms = [], imageUrl, scheduledFor } = post;

      // Skip if not yet due
      if (scheduledFor && new Date(scheduledFor) > new Date()) {
        results.skipped++;
        continue;
      }

      const postResults = {};

      for (const platform of platforms) {
        const handler_fn = PLATFORM_HANDLERS[platform.toLowerCase()];
        if (!handler_fn) {
          logger.warn(`Unknown platform: ${platform}`);
          postResults[platform] = { success: false, error: "Unknown platform" };
          continue;
        }

        try {
          const response = await handler_fn(content, imageUrl);
          postResults[platform] = { success: true, response };
          logger.info(`Posted to ${platform}: post ${id}`);
        } catch (err) {
          postResults[platform] = { success: false, error: err.message };
          logger.error(`Failed to post to ${platform} for post ${id}: ${err.message}`);
          results.errors.push({ postId: id, platform, error: err.message });
        }
      }

      // Report results back to AVfreelance
      const allSucceeded = Object.values(postResults).every((r) => r.success);
      const anySucceeded = Object.values(postResults).some((r) => r.success);

      try {
        await callAVfreelance(`/api/cron/update-post-status`, {
          method: "POST",
          body: {
            postId: id,
            status: allSucceeded ? "published" : anySucceeded ? "partial" : "failed",
            platformResults: postResults,
            publishedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        logger.error(`Failed to update post status for ${id}: ${err.message}`);
      }

      if (anySucceeded) results.posted++;
      else results.failed++;

      // Rate limiting between posts
      await new Promise((r) => setTimeout(r, 2000));
    }

    logger.info(`Autopost complete: ${results.posted} posted, ${results.failed} failed, ${results.skipped} skipped`);
    return res.status(200).json({
      success: true,
      posted: results.posted,
      failed: results.failed,
      skipped: results.skipped,
      errors: results.errors.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`Autopost engine failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
