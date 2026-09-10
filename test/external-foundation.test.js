import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewEnvelope } from "../cloudflare/avfreelance-review-gateway/src/index.js";

test("cloudflare review gateway produces a zero-dispatch envelope", () => {
  const envelope = buildReviewEnvelope("social-review", "2026-09-10T00:00:00.000Z");
  assert.equal(envelope.ok, true);
  assert.equal(envelope.mode, "dry_run");
  assert.equal(envelope.dispatchAllowed, false);
  assert.deepEqual(envelope.sideEffects, []);
  assert.deepEqual(envelope.providerCalls, []);
  assert.deepEqual(envelope.dataMutations, []);
});

test("cloudflare review gateway fails closed for an unknown operation", () => {
  const envelope = buildReviewEnvelope("publish-now");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.dispatchAllowed, false);
  assert.equal(envelope.error, "operation_not_allowed");
});
