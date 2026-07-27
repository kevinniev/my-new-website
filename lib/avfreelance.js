/**
 * AVfreelance API Client
 * Shared utility for all Vercel functions to communicate with the AVfreelance platform.
 *
 * Base URL and API key are injected via Vercel Environment Variables:
 *   AVFREELANCE_API_URL  — e.g. https://avtechplat-fvtswbiw.manus.space
 *   AVFREELANCE_API_KEY  — Bearer token for server-to-server calls
 */

const BASE_URL = (process.env.AVFREELANCE_API_URL || "").replace(/\/$/, "");
const API_KEY = process.env.AVFREELANCE_API_KEY || "";

/**
 * Core fetch wrapper — all calls go through here.
 * @param {string} path  tRPC path, e.g. "/api/trpc/socialLeads.count"
 * @param {object} [body] JSON body for mutations
 * @param {"GET"|"POST"} [method]
 */
async function avfetch(path, body, method = body ? "POST" : "GET") {
  const url = `${BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    "X-Automation-Source": "vercel-external-engine",
  };
  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AVfreelance API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Social Leads ─────────────────────────────────────────────────────────────

/** Trigger a social scan (Twitter + LinkedIn) on the AVfreelance server */
export async function triggerSocialScan() {
  return avfetch("/api/webhooks/trigger-social-scan", { source: "vercel-cron" });
}

/** Get the current social leads count + scan status */
export async function getSocialLeadsCount() {
  return avfetch("/api/trpc/socialLeads.count?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D");
}

// ─── Posting / Social Scheduler ───────────────────────────────────────────────

/** Trigger the posting queue processor */
export async function triggerPostingQueue() {
  return avfetch("/api/webhooks/trigger-posting-queue", { source: "vercel-cron" });
}

/** Post content to a specific platform */
export async function postToSocialMedia({ platform, content, imageUrl }) {
  return avfetch("/api/webhooks/social-post", { platform, content, imageUrl });
}

// ─── Engagement Engine ────────────────────────────────────────────────────────

/** Run the engagement detector — finds new leads from social interactions */
export async function runEngagementDetector() {
  return avfetch("/api/webhooks/engagement-detector", { source: "vercel-cron" });
}

/** Run the full engagement engine — outreach, DMs, emails */
export async function runEngagementEngine() {
  return avfetch("/api/webhooks/engagement-engine", { source: "vercel-cron" });
}

/** Send engagement outreach to a specific user */
export async function sendEngagementOutreach({ userId, platform, message }) {
  return avfetch("/api/webhooks/engagement-outreach", { userId, platform, message });
}

// ─── Partner Jobs ─────────────────────────────────────────────────────────────

/** Pull new jobs from partner companies */
export async function pullPartnerJobs() {
  return avfetch("/api/webhooks/partner-job-pull", { source: "vercel-cron" });
}

/** Sync a specific partner's job listings */
export async function syncPartnerJobs({ partnerId }) {
  return avfetch("/api/webhooks/partner-job-sync", { partnerId });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/** Sync analytics data from all social platforms */
export async function syncAnalytics() {
  return avfetch("/api/webhooks/analytics-sync", { source: "vercel-cron" });
}

/** Fetch platform analytics summary */
export async function getAnalyticsSummary() {
  return avfetch("/api/webhooks/analytics-summary");
}

// ─── CRM ──────────────────────────────────────────────────────────────────────

/** Update CRM with latest engagement and conversion data */
export async function updateCRM({ data }) {
  return avfetch("/api/webhooks/crm-update", { data });
}

/** Get the daily CRM summary */
export async function getDailyCRMSummary() {
  return avfetch("/api/webhooks/crm-daily-summary");
}

// ─── Reports ──────────────────────────────────────────────────────────────────

/** Trigger the daily report generation */
export async function generateDailyReport() {
  return avfetch("/api/webhooks/daily-report", { source: "vercel-cron" });
}

// ─── Automation Mode ──────────────────────────────────────────────────────────

/** Check if External Automation Mode is ON in the AVfreelance platform */
export async function getAutomationMode() {
  return avfetch("/api/webhooks/automation-mode");
}

/** Unified fetch wrapper — alias for new function architecture */
export const callAVfreelance = avfetch;

export default {
  triggerSocialScan,
  getSocialLeadsCount,
  triggerPostingQueue,
  postToSocialMedia,
  runEngagementDetector,
  runEngagementEngine,
  sendEngagementOutreach,
  pullPartnerJobs,
  syncPartnerJobs,
  syncAnalytics,
  getAnalyticsSummary,
  updateCRM,
  getDailyCRMSummary,
  generateDailyReport,
  getAutomationMode,
  callAVfreelance,
};
