/**
 * Autoposting Engine
 * Serverless function — called by the posting queue cron or triggered manually.
 *
 * Fetches the next scheduled post from AVfreelance and publishes it to:
 * Facebook, Instagram, X (Twitter), Threads, LinkedIn
 */

import { postToFacebook, postToInstagram, postToX, postToLinkedIn, postToThreads } from "../lib/social.js";
import logger from "../lib/logger.js";

/**
 * Post content to all configured social platforms.
 * @param {{ content: string, imageUrl?: string, platforms?: string[] }} options
 */
export async function autopost({ content, imageUrl, platforms = ["facebook", "instagram", "x", "linkedin", "threads"] }) {
  const results = {};

  const tasks = platforms.map(async (platform) => {
    try {
      switch (platform.toLowerCase()) {
        case "facebook":
          results.facebook = await postToFacebook(content, imageUrl);
          break;
        case "instagram":
          if (!imageUrl) {
            results.instagram = { skipped: true, reason: "Instagram requires an image" };
          } else {
            results.instagram = await postToInstagram(content, imageUrl);
          }
          break;
        case "x":
        case "twitter":
          // X has a 280-char limit — truncate with ellipsis if needed
          const tweetText = content.length > 280 ? content.slice(0, 277) + "..." : content;
          results.x = await postToX(tweetText);
          break;
        case "linkedin":
          results.linkedin = await postToLinkedIn(content);
          break;
        case "threads":
          results.threads = await postToThreads(content, imageUrl);
          break;
        default:
          results[platform] = { skipped: true, reason: "Unknown platform" };
      }
      logger.info(`[autopost] Posted to ${platform}`, { platform, content_length: content.length });
    } catch (err) {
      results[platform] = { error: err.message };
      logger.error(`[autopost] Failed to post to ${platform}`, { platform, error: err.message });
    }
  });

  await Promise.allSettled(tasks);
  return results;
}

export default autopost;
