import { createHmac, createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { FOUNDATION_LIMITS } from "./dry-run-foundation.js";

export const OIDC_PROOF_ROUTE = "/api/cron/operations-reconcile";
const PRIMARY_REVIEW_PATH = "/api/automation/review/industry-jobs";
const PRIMARY_REVIEW_BASE_URL = "https://avfreelance.com";
const PROOF_SCOPE = "preview-oidc-handler-proof-v1";

const locks = new Set();

function jsonError(res, status, error) {
  return res.status(status).json({ ok: false, mode: "fixture_only", error });
}

function isPreview(env) {
  return env.VERCEL_ENV === "preview" && (!env.AUTOMATION_MODE || env.AUTOMATION_MODE === "dry_run");
}

function isSafeManifest(manifest) {
  return Boolean(
    manifest?.ok === true
    && manifest.mode === "dry_run"
    && manifest.route === OIDC_PROOF_ROUTE
    && manifest.dispatchAllowed === false
    && Array.isArray(manifest.sideEffects)
    && manifest.sideEffects.length === 0
    && manifest.candidateCount <= FOUNDATION_LIMITS.maxCandidates
    && manifest.limits?.providerDeadlineMs === FOUNDATION_LIMITS.providerDeadlineMs
    && manifest.limits?.workloadDeadlineMs === FOUNDATION_LIMITS.workloadDeadlineMs
    && manifest.limits?.maxCandidates === FOUNDATION_LIMITS.maxCandidates,
  );
}

export function createProofIdempotencyKey({ deploymentId, now = new Date() }) {
  const window = now.toISOString().slice(0, 13);
  return createHash("sha256").update(`${PROOF_SCOPE}:${deploymentId}:${OIDC_PROOF_ROUTE}:${window}`).digest("hex");
}

function primarySignature(secret, idempotencyKey) {
  return createHmac("sha256", secret)
    .update(`GET:${PRIMARY_REVIEW_PATH}:${idempotencyKey}`)
    .digest("hex");
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function runPreviewOidcProof({
  req,
  res,
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
  getOidcToken = getVercelOidcToken,
}) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  if (!isPreview(env)) return jsonError(res, 403, "preview_dry_run_only");
  if (env.AUTOMATION_KILL_SWITCH === "enabled") return jsonError(res, 503, "automation_kill_switch_enabled");
  if (!env.AVF_AUTOMATION_CLIENT_ID || !env.AVF_AUTOMATION_SIGNING_KEY || !env.VERCEL_URL) {
    return jsonError(res, 503, "proof_gateway_not_configured");
  }

  const deploymentId = env.VERCEL_DEPLOYMENT_ID || env.VERCEL_URL;
  const idempotencyKey = createProofIdempotencyKey({ deploymentId, now });
  if (locks.has(idempotencyKey)) return jsonError(res, 409, "proof_already_running");
  locks.add(idempotencyKey);

  try {
    const reviewResponse = await fetchImpl(`${PRIMARY_REVIEW_BASE_URL}${PRIMARY_REVIEW_PATH}`, {
      method: "GET",
      redirect: "manual",
      headers: {
        "x-idempotency-key": idempotencyKey,
        "x-avf-automation-client-id": env.AVF_AUTOMATION_CLIENT_ID,
        "x-avf-automation-signature": primarySignature(env.AVF_AUTOMATION_SIGNING_KEY, idempotencyKey),
      },
    });
    const review = await readJson(reviewResponse);
    if (!reviewResponse.ok || !review?.ok || review.replayed) {
      return jsonError(res, 409, "proof_already_consumed");
    }

    const oidcToken = await getOidcToken();
    if (!oidcToken) return jsonError(res, 503, "vercel_oidc_token_unavailable");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FOUNDATION_LIMITS.providerDeadlineMs);
    let fixtureResponse;
    try {
      fixtureResponse = await fetchImpl(`https://${env.VERCEL_URL}${OIDC_PROOF_ROUTE}`, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "x-vercel-trusted-oidc-idp-token": oidcToken,
          "x-avf-automation-client": env.AVF_AUTOMATION_CLIENT_ID,
          "x-avf-automation-signature": env.AVF_AUTOMATION_SIGNING_KEY,
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    const manifest = await readJson(fixtureResponse);
    if (!fixtureResponse.ok || !isSafeManifest(manifest)) {
      return jsonError(res, 502, "fixture_handler_proof_rejected");
    }

    return res.status(200).json({
      ok: true,
      mode: "fixture_only",
      proof: {
        route: OIDC_PROOF_ROUTE,
        authentication: "vercel_oidc_and_service_pair",
        idempotencyEnforced: true,
        lockEnforced: true,
        rollbackGuardVerified: true,
        capsAndDeadlinesVerified: true,
        providerCalls: [],
        sideEffects: [],
        dataMutations: [],
      },
    });
  } catch (error) {
    return jsonError(res, 502, error?.name === "AbortError" ? "fixture_handler_deadline_exceeded" : "fixture_handler_proof_failed");
  } finally {
    locks.delete(idempotencyKey);
  }
}

export function resetPreviewOidcProofForTests() {
  locks.clear();
}
