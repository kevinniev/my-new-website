/**
 * CRON: Engagement Detector
 * Schedule: every hour (0 * * * *)
 *
 * Scans social media for:
 * - Likes, comments, follows on AVfreelance content
 * - Mentions of @AVfreelance or #AVFreelance
 * - AV companies that engaged with posts
 * - Technicians who interacted but haven't signed up
 *
 * Results are fed into the engagement pipeline for outreach.
 */

import { requireCron } from "../../lib/auth.js";
import { runEngagementDetector, getAutomationMode } from "../../lib/avfreelance.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/engagement-detector] Starting engagement detection");

  try {
    let automationMode = { enabled: true };
    try {
      automationMode = await getAutomationMode();
    } catch (e) {
      logger.warn("[cron/engagement-detector] Could not check automation mode, proceeding", { error: e.message });
    }

    if (!automationMode?.enabled) {
      logger.info("[cron/engagement-detector] External Automation Mode is OFF — skipping");
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    // Detect engagements across all platforms
    const [twitterResult, instagramResult, facebookResult] = await Promise.allSettled([
      detectTwitterEngagements(),
      detectInstagramEngagements(),
      detectFacebookEngagements(),
    ]);

    const detected = {
      twitter: twitterResult.status === "fulfilled" ? twitterResult.value : { error: twitterResult.reason?.message },
      instagram: instagramResult.status === "fulfilled" ? instagramResult.value : { error: instagramResult.reason?.message },
      facebook: facebookResult.status === "fulfilled" ? facebookResult.value : { error: facebookResult.reason?.message },
    };

    // Send detected engagements to AVfreelance for processing
    await runEngagementDetector();

    const elapsed = Date.now() - start;
    logger.info("[cron/engagement-detector] Completed", { elapsed_ms: elapsed, detected });

    return res.json({ ok: true, elapsed_ms: elapsed, detected });
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.error("[cron/engagement-detector] Error", { error: err.message, elapsed_ms: elapsed });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function detectTwitterEngagements() {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) return { skipped: true, reason: "no_bearer_token" };

  // Search for mentions and relevant hashtags
  const queries = [
    "@AVfreelance",
    "#AVFreelance",
    "#AVTech hiring",
    "#AVCrew needed",
  ];

  let totalMentions = 0;
  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        query: q,
        max_results: "10",
        "tweet.fields": "author_id,created_at,public_metrics",
        "user.fields": "username,name,location",
        expansions: "author_id",
      });
      const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      const data = await res.json();
      totalMentions += data?.data?.length ?? 0;
    } catch (e) {
      logger.warn("[engagement-detector] Twitter query failed", { query: q, error: e.message });
    }
  }
  return { mentions: totalMentions };
}

async function detectInstagramEngagements() {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accountId || !token) return { skipped: true, reason: "no_instagram_credentials" };

  // Get recent media and their engagement
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media?fields=id,like_count,comments_count,timestamp&access_token=${token}&limit=10`
  );
  const data = await res.json();
  const posts = data?.data ?? [];
  const totalLikes = posts.reduce((sum, p) => sum + (p.like_count ?? 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.comments_count ?? 0), 0);
  return { posts: posts.length, likes: totalLikes, comments: totalComments };
}

async function detectFacebookEngagements() {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) return { skipped: true, reason: "no_facebook_credentials" };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,likes.summary(true),comments.summary(true),created_time&access_token=${token}&limit=10`
  );
  const data = await res.json();
  const posts = data?.data ?? [];
  const totalLikes = posts.reduce((sum, p) => sum + (p.likes?.summary?.total_count ?? 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.comments?.summary?.total_count ?? 0), 0);
  return { posts: posts.length, likes: totalLikes, comments: totalComments };
}
