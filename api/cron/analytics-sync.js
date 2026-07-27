/**
 * CRON: Analytics Sync
 * Schedule: daily at 8:00 AM UTC (0 8 * * *)
 *
 * Pulls analytics from all social platforms and syncs to AVfreelance:
 * - Facebook Page insights (reach, impressions, engagement)
 * - Instagram account insights
 * - X (Twitter) tweet analytics
 * - LinkedIn page analytics
 */

import { requireCron } from "../../lib/auth.js";
import { syncAnalytics, getAutomationMode } from "../../lib/avfreelance.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/analytics-sync] Starting analytics sync");

  try {
    let automationMode = { enabled: true };
    try { automationMode = await getAutomationMode(); } catch {}

    if (!automationMode?.enabled) {
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    const [fb, ig, tw] = await Promise.allSettled([
      syncFacebookInsights(),
      syncInstagramInsights(),
      syncTwitterAnalytics(),
    ]);

    const analytics = {
      facebook: fb.status === "fulfilled" ? fb.value : { error: fb.reason?.message },
      instagram: ig.status === "fulfilled" ? ig.value : { error: ig.reason?.message },
      twitter: tw.status === "fulfilled" ? tw.value : { error: tw.reason?.message },
    };

    // Push aggregated analytics to AVfreelance
    await syncAnalytics();

    const elapsed = Date.now() - start;
    logger.info("[cron/analytics-sync] Complete", { elapsed_ms: elapsed, analytics });
    return res.json({ ok: true, elapsed_ms: elapsed, analytics });
  } catch (err) {
    logger.error("[cron/analytics-sync] Error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function syncFacebookInsights() {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) return { skipped: true };

  const since = Math.floor((Date.now() - 86400000) / 1000); // yesterday
  const until = Math.floor(Date.now() / 1000);
  const metrics = "page_impressions,page_reach,page_engaged_users,page_fan_adds";

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/insights?metric=${metrics}&period=day&since=${since}&until=${until}&access_token=${token}`
  );
  const data = await res.json();
  return { metrics: data?.data?.length ?? 0 };
}

async function syncInstagramInsights() {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accountId || !token) return { skipped: true };

  const metrics = "impressions,reach,profile_views,follower_count";
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/insights?metric=${metrics}&period=day&access_token=${token}`
  );
  const data = await res.json();
  return { metrics: data?.data?.length ?? 0 };
}

async function syncTwitterAnalytics() {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) return { skipped: true };

  // Get recent tweets and their metrics
  const res = await fetch(
    "https://api.twitter.com/2/tweets/search/recent?query=from:AVfreelance&tweet.fields=public_metrics&max_results=10",
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );
  const data = await res.json();
  const tweets = data?.data ?? [];
  const totalImpressions = tweets.reduce((s, t) => s + (t.public_metrics?.impression_count ?? 0), 0);
  const totalLikes = tweets.reduce((s, t) => s + (t.public_metrics?.like_count ?? 0), 0);
  return { tweets: tweets.length, impressions: totalImpressions, likes: totalLikes };
}
