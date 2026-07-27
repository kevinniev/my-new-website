/**
 * Partner Job Post — Serverless Function
 * Takes approved partner jobs from AVfreelance and cross-posts
 * them to social media channels to increase visibility and
 * attract AV technicians to apply.
 *
 * Triggered by: POST from partner-job-pull cron
 */

import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";
import { postToFacebook, postToX, postToThreads } from "../../lib/social.js";

const logger = createLogger("partner-job-post");

function formatJobPost(job) {
  const location = job.location ? ` in ${job.location}` : "";
  const salary = job.salary ? ` | ${job.salary}` : "";
  const type = job.jobType ? ` (${job.jobType})` : "";

  return `🎙️ AV JOB ALERT${location}!

${job.title}${type}
${job.company ? `Company: ${job.company}` : ""}${salary}

${job.description ? job.description.slice(0, 200) + "..." : ""}

Apply & find more AV gigs at: https://avfreelance.com/jobs

#AVjobs #AVtechnician #audiovisual #freelanceAV #eventtech`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { jobs = [] } = req.body || {};
  if (!jobs.length) {
    return res.status(200).json({ success: true, message: "No jobs to post", posted: 0 });
  }

  logger.info(`Cross-posting ${jobs.length} partner jobs to social media`);
  const results = { posted: 0, failed: 0, errors: [] };

  // Only post a limited number per run to avoid spam
  const jobsToPost = jobs.slice(0, 5);

  for (const job of jobsToPost) {
    const postText = formatJobPost(job);
    const platformResults = {};

    // Post to Facebook
    try {
      await postToFacebook(postText);
      platformResults.facebook = "success";
    } catch (err) {
      platformResults.facebook = `failed: ${err.message}`;
      results.errors.push({ jobId: job.externalId, platform: "facebook", error: err.message });
    }

    // Post to X (Twitter)
    try {
      // X has 280 char limit — use shortened version
      const xText = `🎙️ AV Job Alert: ${job.title} ${job.location ? "in " + job.location : ""}\n\nApply at avfreelance.com/jobs\n\n#AVjobs #AVtechnician #eventtech`;
      await postToX(xText);
      platformResults.twitter = "success";
    } catch (err) {
      platformResults.twitter = `failed: ${err.message}`;
      results.errors.push({ jobId: job.externalId, platform: "twitter", error: err.message });
    }

    // Post to Threads
    try {
      await postToThreads(postText);
      platformResults.threads = "success";
    } catch (err) {
      platformResults.threads = `failed: ${err.message}`;
      results.errors.push({ jobId: job.externalId, platform: "threads", error: err.message });
    }

    // Update job post status in AVfreelance
    try {
      await callAVfreelance("/api/cron/update-partner-job-status", {
        method: "POST",
        body: {
          jobId: job.externalId || job.id,
          socialPosted: true,
          platformResults,
          postedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error(`Failed to update job status: ${err.message}`);
    }

    const anySuccess = Object.values(platformResults).some((v) => v === "success");
    if (anySuccess) results.posted++;
    else results.failed++;

    // Rate limiting between posts
    await new Promise((r) => setTimeout(r, 3000));
  }

  logger.info(`Job cross-posting complete: ${results.posted} posted, ${results.failed} failed`);
  return res.status(200).json({
    success: true,
    posted: results.posted,
    failed: results.failed,
    errors: results.errors.length,
    timestamp: new Date().toISOString(),
  });
}
