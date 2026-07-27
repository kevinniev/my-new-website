/**
 * Partner Job Ingest — Serverless Function
 * Pulls AV job listings from partner platforms and job boards,
 * normalizes them, and ingests them into the AVfreelance database.
 *
 * Triggered by: Vercel cron (partner-job-pull) or direct POST
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";
import { matchIndustry } from "../../lib/industry-matcher.js";

const logger = createLogger("partner-job-ingest");

// Partner job sources — extend as partnerships grow
const JOB_SOURCES = [
  {
    name: "Indeed AV Jobs",
    url: "https://api.indeed.com/ads/apisearch",
    params: { q: "AV technician OR audio visual OR sound engineer", format: "json", limit: 25 },
    enabled: false, // Enable when Indeed API key is configured
    envKey: "INDEED_API_KEY",
  },
  {
    name: "ZipRecruiter AV",
    url: "https://api.ziprecruiter.com/jobs/v1",
    params: { search: "AV technician freelance", jobs_per_page: 20 },
    enabled: false,
    envKey: "ZIPRECRUITER_API_KEY",
  },
  {
    name: "AVfreelance Partner Feed",
    url: `${process.env.AVFREELANCE_BASE_URL}/api/partner-jobs/feed`,
    params: {},
    enabled: true,
    envKey: "AVFREELANCE_API_KEY",
  },
];

/**
 * Normalize a raw job listing to AVfreelance schema.
 */
function normalizeJob(raw, source) {
  return {
    externalId: raw.id || raw.jobId || raw.job_id,
    source: source.name,
    title: raw.title || raw.jobtitle || raw.job_title,
    company: raw.company || raw.companyName || raw.employer,
    location: raw.location || raw.formattedLocation || raw.city,
    description: (raw.description || raw.snippet || raw.summary || "").slice(0, 2000),
    url: raw.url || raw.jobUrl || raw.apply_url,
    salary: raw.salary || raw.salaryMin || null,
    jobType: raw.jobType || raw.employment_type || "contract",
    postedAt: raw.date || raw.datePosted || new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
  };
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

  logger.info("Partner job ingestion started");
  const results = { ingested: 0, skipped: 0, errors: [] };

  for (const source of JOB_SOURCES) {
    if (!source.enabled) {
      logger.info(`Skipping ${source.name} (disabled)`);
      continue;
    }

    const apiKey = source.envKey ? process.env[source.envKey] : null;
    if (source.envKey && !apiKey) {
      logger.warn(`${source.name}: API key ${source.envKey} not configured`);
      continue;
    }

    try {
      const url = new URL(source.url);
      Object.entries(source.params).forEach(([k, v]) => url.searchParams.set(k, v));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: apiKey ? `Bearer ${apiKey}` : undefined,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const rawJobs = data.jobs || data.results || data.listings || data || [];

      const normalizedJobs = [];
      for (const raw of rawJobs) {
        const normalized = normalizeJob(raw, source);
        // Verify it's actually an AV job
        const match = await matchIndustry(`${normalized.title} ${normalized.description}`);
        if (match.isRelevant) {
          normalizedJobs.push({ ...normalized, industryScore: match.score, category: match.category });
        } else {
          results.skipped++;
        }
      }

      if (normalizedJobs.length > 0) {
        await callAVfreelance("/api/cron/ingest-partner-jobs", {
          method: "POST",
          body: { jobs: normalizedJobs, source: source.name },
        });
        results.ingested += normalizedJobs.length;
        logger.info(`Ingested ${normalizedJobs.length} jobs from ${source.name}`);
      }
    } catch (err) {
      logger.error(`Job ingestion failed for ${source.name}: ${err.message}`);
      results.errors.push({ source: source.name, error: err.message });
    }
  }

  logger.info(`Job ingestion complete: ${results.ingested} ingested, ${results.skipped} filtered out`);
  return res.status(200).json({
    success: true,
    ingested: results.ingested,
    skipped: results.skipped,
    errors: results.errors.length,
    timestamp: new Date().toISOString(),
  });
}
