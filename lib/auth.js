/**
 * Cron Authentication Guard
 *
 * Vercel cron jobs call your API routes with the header:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * This utility validates that header so only Vercel (or your own callers
 * with the secret) can trigger the cron endpoints.
 *
 * Usage:
 *   import { requireCron } from "../lib/auth.js";
 *   export default async function handler(req, res) {
 *     if (!requireCron(req, res)) return;
 *     // ... your logic
 *   }
 */

import { timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function reject(res, status, error) {
  res.status(status).json({ ok: false, error });
  return false;
}

/** Foundation cron auth fails closed in every environment. */
export function requireCron(req, res) {
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!secret) return reject(res, 503, "automation_cron_secret_not_configured");
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(token, secret)) return reject(res, 401, "unauthorized_cron_request");
  return true;
}

/** Future AVfreelance service calls must use a separate signed identity. */
export function requireServiceAuth(req, res) {
  const expectedClient = process.env.AVF_AUTOMATION_CLIENT_ID;
  const expectedSignature = process.env.AVF_AUTOMATION_SIGNING_KEY;
  if (!expectedClient || !expectedSignature) return reject(res, 503, "automation_service_auth_not_configured");
  if (!safeEqual(req.headers["x-avf-automation-client"] || "", expectedClient) || !safeEqual(req.headers["x-avf-automation-signature"] || "", expectedSignature)) {
    return reject(res, 401, "unauthorized_service_request");
  }
  return true;
}

/**
 * Validate an inbound webhook from AVfreelance.
 * AVfreelance signs webhook payloads with AVFREELANCE_WEBHOOK_SECRET.
 * @param {import("@vercel/node").VercelRequest} req
 * @param {import("@vercel/node").VercelResponse} res
 */
export function requireWebhookAuth(req, res) {
  const secret = process.env.AVFREELANCE_WEBHOOK_SECRET;
  if (!secret) return true; // optional — only enforce if secret is set
  const sig = req.headers["x-avfreelance-signature"] || "";
  if (sig !== secret) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return false;
  }
  return true;
}

export default { requireCron, requireServiceAuth, requireWebhookAuth };
