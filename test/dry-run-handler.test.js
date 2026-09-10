import assert from "node:assert/strict";
import test from "node:test";
import { createDryRunHandler } from "../lib/dry-run-handler.js";
import { resetDryRunStateForTests } from "../lib/dry-run-foundation.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return payload; },
  };
}

test.beforeEach(() => {
  process.env.AUTOMATION_MODE = "dry_run";
  process.env.AVF_AUTOMATION_CLIENT_ID = "test-preview-client";
  process.env.AVF_AUTOMATION_SIGNING_KEY = "test-preview-signature";
  delete process.env.AUTOMATION_KILL_SWITCH;
  delete process.env.VERCEL_ENV;
  resetDryRunStateForTests();
});

test("fixture handlers require the matched service pair and never dispatch", async () => {
  const handler = createDryRunHandler("/api/cron/operations-reconcile", { name: "operations-reconcile", brand: "avfreelance", candidates: [{ ref: "fixture-1" }] });
  const unauthorized = responseRecorder();
  await handler({ method: "GET", headers: {} }, unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error, "unauthorized_service_request");

  const authorized = responseRecorder();
  await handler({
    method: "GET",
    headers: {
      "x-avf-automation-client": "test-preview-client",
      "x-avf-automation-signature": "test-preview-signature",
    },
  }, authorized);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body.mode, "dry_run");
  assert.equal(authorized.body.dispatchAllowed, false);
  assert.deepEqual(authorized.body.sideEffects, []);
  assert.equal(authorized.body.candidateCount, 1);
});
