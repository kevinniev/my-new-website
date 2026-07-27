/**
 * Social Feed Refresh — Serverless Function
 * Three-in-one social media refresh engine:
 * 1. Pull LIVE AV requests from social platforms
 * 2. Refresh the social feed cache
 * 3. Sync platform insights/analytics
 *
 * Triggered by: Vercel cron (every 5 minutes) or direct call
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const logger = createLogger("social-feed-refresh");

// AV request signals to monitor in real-time
const LIVE_AV_REQUEST_SIGNALS = [
  "need av tech today", "need av tech tonight", "need av tech asap",
  "need sound engineer today", "need lighting tech today",
  "av tech needed today", "av tech needed tonight",
  "last minute av", "emergency av", "av help needed",
  "looking for av tech", "anyone know an av tech",
  "#needavtech", "#avhelp", "#avjobs",
];

/**
 * Pull LIVE AV requests from social platforms.
 */
async function pullLiveAVRequests() {
  const requests = [];

  // Check Facebook for AV requests in relevant groups
  const fbToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (fbToken) {
    try {
      // Search public posts for AV request signals
      for (const signal of LIVE_AV_REQUEST_SIGNALS.slice(0, 5)) {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/search?q=${encodeURIComponent(signal)}&type=post&access_token=${fbToken}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.data) {
            requests.push(...data.data.map((p) => ({
              platform: "facebook",
              id: p.id,
              text: p.message || "",
              createdAt: p.created_time,
              signal,
            })));
          }
        }
      }
    } catch (err) {
      logger.warn(`Facebook AV request pull failed: ${err.message}`);
    }
  }

  // Check X/Twitter for AV request signals
  const twitterBearer = process.env.TWITTER_BEARER_TOKEN;
  if (twitterBearer) {
    try {
      const query = LIVE_AV_REQUEST_SIGNALS.slice(0, 3).join(" OR ");
      const res = await fetch(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,author_id`,
        {
          headers: { Authorization: `Bearer ${twitterBearer}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          requests.push(...data.data.map((t) => ({
            platform: "twitter",
            id: t.id,
            text: t.text,
            createdAt: t.created_at,
            authorId: t.author_id,
          })));
        }
      }
    } catch (err) {
      logger.warn(`Twitter AV request pull failed: ${err.message}`);
    }
  }

  return requests;
}

/**
 * Refresh Instagram feed cache.
 */
async function refreshInstagramFeed() {
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!igToken || !igAccountId) return null;

  try {
    const res = await fetch(
      `https://graph.instagram.com/v18.0/${igAccountId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=20&access_token=${igToken}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    logger.warn(`Instagram feed refresh failed: ${err.message}`);
    return null;
  }
}

/**
 * Sync platform insights.
 */
async function syncInsights() {
  const insights = {};

  // Facebook page insights
  const fbToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const fbPageId = process.env.FACEBOOK_PAGE_ID;
  if (fbToken && fbPageId) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${fbPageId}/insights?metric=page_impressions,page_reach,page_engaged_users&period=day&access_token=${fbToken}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        insights.facebook = await res.json();
      }
    } catch (err) {
      logger.warn(`Facebook insights sync failed: ${err.message}`);
    }
  }

  // Instagram insights
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (igToken && igAccountId) {
    try {
      const res = await fetch(
        `https://graph.instagram.com/v18.0/${igAccountId}/insights?metric=impressions,reach,profile_views&period=day&access_token=${igToken}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        insights.instagram = await res.json();
      }
    } catch (err) {
      logger.warn(`Instagram insights sync failed: ${err.message}`);
    }
  }

  return insights;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  logger.info("Social feed refresh started");
  const results = { liveRequests: 0, feedRefreshed: false, insightsSynced: false, errors: [] };

  try {
    // Run all three operations in parallel
    const [liveRequests, igFeed, insights] = await Promise.allSettled([
      pullLiveAVRequests(),
      refreshInstagramFeed(),
      syncInsights(),
    ]);

    // Process live AV requests
    if (liveRequests.status === "fulfilled" && liveRequests.value.length > 0) {
      results.liveRequests = liveRequests.value.length;
      try {
        await callAVfreelance("/api/cron/ingest-live-av-requests", {
          method: "POST",
          body: { requests: liveRequests.value, pulledAt: new Date().toISOString() },
        });
      } catch (err) {
        results.errors.push({ type: "live-requests-ingest", error: err.message });
      }
    }

    // Send feed refresh to AVfreelance
    if (igFeed.status === "fulfilled" && igFeed.value) {
      try {
        await callAVfreelance("/api/cron/update-ig-feed-cache", {
          method: "POST",
          body: { feed: igFeed.value, refreshedAt: new Date().toISOString() },
        });
        results.feedRefreshed = true;
      } catch (err) {
        results.errors.push({ type: "feed-cache-update", error: err.message });
      }
    }

    // Send insights to AVfreelance
    if (insights.status === "fulfilled" && insights.value) {
      try {
        await callAVfreelance("/api/cron/update-social-insights", {
          method: "POST",
          body: { insights: insights.value, syncedAt: new Date().toISOString() },
        });
        results.insightsSynced = true;
      } catch (err) {
        results.errors.push({ type: "insights-sync", error: err.message });
      }
    }

    logger.info(`Feed refresh complete: ${results.liveRequests} live requests, feed=${results.feedRefreshed}, insights=${results.insightsSynced}`);
    return res.status(200).json({
      success: true,
      ...results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`Social feed refresh failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}
