import assert from "node:assert/strict";
import test from "node:test";
import { createProofIdempotencyKey, resetPreviewOidcProofForTests, runPreviewOidcProof } from "../lib/preview-oidc-proof.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return payload; },
  };
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function proofEnv(overrides = {}) {
  return {
    VERCEL_ENV: "preview",
    AUTOMATION_MODE: "dry_run",
    VERCEL_GIT_COMMIT_SHA: "preview-test-commit",
    VERCEL_URL: "preview.example.vercel.app",
    AVF_AUTOMATION_CLIENT_ID: "preview-client",
    AVF_AUTOMATION_SIGNING_KEY: "preview-signing-key",
    ...overrides,
  };
}

const safeManifest = {
  ok: true,
  mode: "dry_run",
  route: "/api/cron/operations-reconcile",
  dispatchAllowed: false,
  sideEffects: [],
  candidateCount: 1,
  limits: { providerDeadlineMs: 8000, workloadDeadlineMs: 25000, maxCandidates: 50 },
};

test.beforeEach(() => resetPreviewOidcProofForTests());

test("the Preview OIDC proof forwards a short-lived identity and verifies a no-dispatch manifest", async () => {
  const calls = [];
  const res = responseRecorder();
  await runPreviewOidcProof({
    req: { method: "GET" },
    res,
    env: proofEnv(),
    now: new Date("2026-09-10T22:00:00.000Z"),
    getOidcToken: async () => "short-lived-test-oidc",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1
        ? response(200, { ok: true, replayed: false })
        : response(200, safeManifest);
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.proof.authentication, "vercel_oidc_and_service_pair");
  assert.equal(res.body.proof.providerCalls.length, 0);
  assert.equal(res.headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers["x-vercel-trusted-oidc-idp-token"], "short-lived-test-oidc");
  assert.equal(calls[1].options.headers["x-avf-automation-client"], "preview-client");
  assert.equal(calls[1].options.redirect, "manual");
});

test("the proof idempotency scope changes for a distinct Preview deployment", () => {
  const now = new Date("2026-09-10T22:00:00.000Z");
  const first = createProofIdempotencyKey({ deploymentId: "preview-a", now });
  const second = createProofIdempotencyKey({ deploymentId: "preview-b", now });
  assert.notEqual(first, second);
});

test("the temporary proof revision contributes to every generated idempotency key", () => {
  const now = new Date("2026-09-10T22:00:00.000Z");
  const key = createProofIdempotencyKey({ deploymentId: "preview-a", now });
  assert.equal(typeof key, "string");
  assert.equal(key.length, 64);
});

test("the proof gateway fails closed outside Preview and when the kill switch is active", async () => {
  const production = responseRecorder();
  await runPreviewOidcProof({ req: { method: "GET" }, res: production, env: proofEnv({ VERCEL_ENV: "production" }) });
  assert.equal(production.statusCode, 403);
  assert.equal(production.body.error, "preview_dry_run_only");

  const killed = responseRecorder();
  await runPreviewOidcProof({ req: { method: "GET" }, res: killed, env: proofEnv({ AUTOMATION_KILL_SWITCH: "enabled" }) });
  assert.equal(killed.statusCode, 503);
  assert.equal(killed.body.error, "automation_kill_switch_enabled");
});

test("the proof gateway accepts Preview's implicit dry-run mode but rejects an explicit non-dry-run mode", async () => {
  const implicit = responseRecorder();
  await runPreviewOidcProof({
    req: { method: "GET" }, res: implicit, env: proofEnv({ AUTOMATION_MODE: undefined }),
    getOidcToken: async () => null,
    fetchImpl: async (_url, _options) => response(200, { ok: true, replayed: false }),
  });
  assert.equal(implicit.statusCode, 503);
  assert.equal(implicit.body.error, "vercel_oidc_token_unavailable");

  const live = responseRecorder();
  await runPreviewOidcProof({
    req: { method: "GET" }, res: live, env: proofEnv({ AUTOMATION_MODE: "live" }),
  });
  assert.equal(live.statusCode, 403);
  assert.equal(live.body.error, "preview_dry_run_only");
});

test("the proof gateway rejects missing OIDC, replay, and unsafe manifests without dispatch", async () => {
  const missingOidc = responseRecorder();
  await runPreviewOidcProof({
    req: { method: "GET" }, res: missingOidc, env: proofEnv(),
    getOidcToken: async () => null,
    fetchImpl: async () => response(200, { ok: true, replayed: false }),
  });
  assert.equal(missingOidc.statusCode, 503);
  assert.equal(missingOidc.body.error, "vercel_oidc_token_unavailable");

  resetPreviewOidcProofForTests();
  const replay = responseRecorder();
  await runPreviewOidcProof({
    req: { method: "GET" }, res: replay, env: proofEnv(),
    getOidcToken: async () => "oidc",
    fetchImpl: async () => response(200, { ok: true, replayed: true }),
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.error, "proof_already_consumed");

  resetPreviewOidcProofForTests();
  const unsafe = responseRecorder();
  let invocation = 0;
  await runPreviewOidcProof({
    req: { method: "GET" }, res: unsafe, env: proofEnv(),
    getOidcToken: async () => "oidc",
    fetchImpl: async () => {
      invocation += 1;
      return invocation === 1
        ? response(200, { ok: true, replayed: false })
        : response(200, { ...safeManifest, dispatchAllowed: true });
    },
  });
  assert.equal(unsafe.statusCode, 502);
  assert.equal(unsafe.body.error, "fixture_handler_proof_rejected");
});

test("the proof gateway distinguishes primary authentication rejection from an idempotency replay", async () => {
  const authentication = responseRecorder();
  await runPreviewOidcProof({
    req: { method: "GET" }, res: authentication, env: proofEnv(),
    fetchImpl: async () => response(401, { ok: false, error: "automation_auth_required" }),
  });
  assert.equal(authentication.statusCode, 502);
  assert.equal(authentication.body.error, "primary_review_auth_rejected");
});
