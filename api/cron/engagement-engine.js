/**
 * CRON: Engagement Engine
 * Schedule: daily at 7:00 AM UTC (0 7 * * *)
 *
 * Full engagement workflow:
 * 1. industryMatcher — identify AV companies from social activity
 * 2. engagementOutreach — send DMs to detected companies
 * 3. engagementSalesEmail — send partnership pitch emails
 * 4. engagementEngineJob — log all activity to CRM
 */

import { requireCron } from "../../lib/auth.js";
import { runEngagementEngine, getAutomationMode } from "../../lib/avfreelance.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/engagement-engine] Starting full engagement engine run");

  try {
    let automationMode = { enabled: true };
    try {
      automationMode = await getAutomationMode();
    } catch (e) {
      logger.warn("[cron/engagement-engine] Could not check automation mode, proceeding", { error: e.message });
    }

    if (!automationMode?.enabled) {
      logger.info("[cron/engagement-engine] External Automation Mode is OFF — skipping");
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    // Run all engagement steps in sequence
    const steps = [];

    // Step 1: Industry Matcher
    try {
      const matchResult = await runIndustryMatcher();
      steps.push({ step: "industryMatcher", ok: true, ...matchResult });
      logger.info("[cron/engagement-engine] industryMatcher complete", matchResult);
    } catch (e) {
      steps.push({ step: "industryMatcher", ok: false, error: e.message });
      logger.error("[cron/engagement-engine] industryMatcher failed", { error: e.message });
    }

    // Step 2: Engagement Outreach (DMs)
    try {
      const outreachResult = await runEngagementEngine();
      steps.push({ step: "engagementOutreach", ok: true, ...outreachResult });
      logger.info("[cron/engagement-engine] engagementOutreach complete", outreachResult);
    } catch (e) {
      steps.push({ step: "engagementOutreach", ok: false, error: e.message });
      logger.error("[cron/engagement-engine] engagementOutreach failed", { error: e.message });
    }

    // Step 3: Sales Email
    try {
      const emailResult = await runSalesEmailOutreach();
      steps.push({ step: "engagementSalesEmail", ok: true, ...emailResult });
      logger.info("[cron/engagement-engine] engagementSalesEmail complete", emailResult);
    } catch (e) {
      steps.push({ step: "engagementSalesEmail", ok: false, error: e.message });
      logger.error("[cron/engagement-engine] engagementSalesEmail failed", { error: e.message });
    }

    const elapsed = Date.now() - start;
    const successCount = steps.filter((s) => s.ok).length;
    logger.info("[cron/engagement-engine] All steps complete", {
      elapsed_ms: elapsed,
      steps_ok: successCount,
      steps_total: steps.length,
    });

    return res.json({ ok: true, elapsed_ms: elapsed, steps });
  } catch (err) {
    const elapsed = Date.now() - start;
    logger.error("[cron/engagement-engine] Fatal error", { error: err.message, elapsed_ms: elapsed });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Industry Matcher — identify AV companies from Twitter/Instagram/LinkedIn activity
 * and tag them in the AVfreelance CRM for outreach.
 */
async function runIndustryMatcher() {
  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) return { skipped: true, reason: "no_twitter_token" };

  const avCompanyKeywords = [
    "AV company", "audio visual", "event production", "AV rental",
    "AV integration", "live events", "staging company", "production company",
  ];

  let detected = 0;
  for (const keyword of avCompanyKeywords.slice(0, 3)) {
    try {
      const params = new URLSearchParams({
        query: `${keyword} -is:retweet lang:en`,
        max_results: "10",
        "user.fields": "username,name,description,location,public_metrics",
        expansions: "author_id",
      });
      const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      const data = await res.json();
      detected += data?.includes?.users?.length ?? 0;
    } catch (e) {
      logger.warn("[industryMatcher] Query failed", { keyword, error: e.message });
    }
  }
  return { detected_companies: detected };
}

/**
 * Sales Email Outreach — send partnership pitch emails to detected AV companies.
 * Uses AVfreelance's internal email system.
 */
async function runSalesEmailOutreach() {
  const apiUrl = (process.env.AVFREELANCE_API_URL || "").replace(/\/$/, "");
  const apiKey = process.env.AVFREELANCE_API_KEY;
  if (!apiUrl || !apiKey) return { skipped: true, reason: "no_avfreelance_credentials" };

  const res = await fetch(`${apiUrl}/api/webhooks/engagement-sales-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      source: "vercel-cron",
      template: "partnership_pitch",
      subject: "AVfreelance Crewing Partnership — We Can Post Your Gigs For Free",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sales email endpoint returned ${res.status}: ${text}`);
  }
  return res.json();
}
