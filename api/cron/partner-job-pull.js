/**
 * CRON: Partner Job Pull
 * Schedule: daily at 9:00 AM UTC (0 9 * * *)
 *
 * Pulls new job listings from all active crewing partners and:
 * 1. Ingests them into the AVfreelance job board
 * 2. Posts them to social media
 * 3. Notifies matching technicians
 */

import { requireCron } from "../../lib/auth.js";
import { pullPartnerJobs, getAutomationMode } from "../../lib/avfreelance.js";
import { autopost } from "../../functions/autopost.js";
import logger from "../../lib/logger.js";

export default async function handler(req, res) {
  if (!requireCron(req, res)) return;

  const start = Date.now();
  logger.info("[cron/partner-job-pull] Starting partner job pull");

  try {
    let automationMode = { enabled: true };
    try { automationMode = await getAutomationMode(); } catch {}

    if (!automationMode?.enabled) {
      return res.json({ ok: true, skipped: true, reason: "automation_mode_off" });
    }

    // Pull new partner jobs from AVfreelance
    const pullResult = await pullPartnerJobs();
    const newJobs = pullResult?.newJobs ?? [];

    logger.info("[cron/partner-job-pull] Jobs pulled", { count: newJobs.length });

    // Auto-post new jobs to social media
    const postResults = [];
    for (const job of newJobs.slice(0, 5)) { // cap at 5 posts per run to avoid spam
      try {
        const content = buildJobPostContent(job);
        const result = await autopost({
          content,
          imageUrl: job.imageUrl,
          platforms: ["facebook", "instagram", "x", "linkedin"],
        });
        postResults.push({ jobId: job.id, ok: true, platforms: result });
        logger.info("[cron/partner-job-pull] Job posted to social", { jobId: job.id });
      } catch (e) {
        postResults.push({ jobId: job.id, ok: false, error: e.message });
        logger.error("[cron/partner-job-pull] Failed to post job", { jobId: job.id, error: e.message });
      }
    }

    // Also pull from LinkedIn Jobs API via RapidAPI
    let linkedInJobs = [];
    try {
      linkedInJobs = await pullLinkedInAVJobs();
      logger.info("[cron/partner-job-pull] LinkedIn jobs pulled", { count: linkedInJobs.length });
    } catch (e) {
      logger.warn("[cron/partner-job-pull] LinkedIn pull failed", { error: e.message });
    }

    const elapsed = Date.now() - start;
    return res.json({
      ok: true,
      elapsed_ms: elapsed,
      partner_jobs: newJobs.length,
      linkedin_jobs: linkedInJobs.length,
      posted: postResults.filter((r) => r.ok).length,
      post_results: postResults,
    });
  } catch (err) {
    logger.error("[cron/partner-job-pull] Fatal error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function buildJobPostContent(job) {
  const emoji = "🎬";
  const lines = [
    `${emoji} NEW AV GIG POSTED on AVfreelance!`,
    ``,
    `📍 ${job.city || job.location || "Location TBD"}`,
    `🎭 Role: ${job.role || "AV Technician"}`,
    `📅 Date: ${job.eventDate ? new Date(job.eventDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "TBD"}`,
    job.dayRate ? `💰 Rate: $${Math.round(job.dayRate)}/day` : "",
    ``,
    `Apply now → avfreelance.com/jobs`,
    ``,
    `#AVFreelance #AVTech #AudioVisual #EventProduction #AVJobs #Freelance`,
  ].filter(Boolean);
  return lines.join("\n");
}

async function pullLinkedInAVJobs() {
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (!rapidApiKey) return [];

  const keywords = ["AV technician", "audio visual technician", "video engineer"];
  const allJobs = [];

  for (const keyword of keywords.slice(0, 2)) {
    try {
      const res = await fetch(
        `https://linkedin-jobs-search.p.rapidapi.com/search?keywords=${encodeURIComponent(keyword)}&location=United+States&dateSincePosted=past24Hours&jobType=contract&limit=10`,
        {
          headers: {
            "X-RapidAPI-Key": rapidApiKey,
            "X-RapidAPI-Host": "linkedin-jobs-search.p.rapidapi.com",
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        allJobs.push(...(data ?? []));
      }
    } catch (e) {
      logger.warn("[partner-job-pull] LinkedIn API call failed", { keyword, error: e.message });
    }
  }
  return allJobs;
}
