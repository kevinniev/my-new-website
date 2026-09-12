import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const candidatePath = new URL("../automation/industry-jobs-source-health-review-candidate.json", import.meta.url);
const vercelConfigPath = new URL("../vercel.json", import.meta.url);

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("Industry Jobs source-health candidate is inactive, bounded, and provider-free", async () => {
  const candidate = await loadJson(candidatePath);
  assert.equal(candidate.status, "inactive_review_only_candidate");
  assert.equal(candidate.route, "/api/cron/industry-jobs");
  assert.equal(candidate.schedule, "15 */6 * * *");
  assert.equal(candidate.expiry.durationDays, 7);
  assert.equal(candidate.actionCap.maximumRuns, 1);
  assert.equal(candidate.actionCap.maximumProviderCalls, 0);
  assert.equal(candidate.actionCap.maximumListingWrites, 0);
  assert.equal(candidate.actionCap.maximumDispatches, 0);
  assert.equal(candidate.noDispatchBoundary.providerRequestsAllowed, false);
  assert.equal(candidate.noDispatchBoundary.marketplaceWritesAllowed, false);
  assert.equal(candidate.noDispatchBoundary.externalDispatchAllowed, false);
});

test("Industry Jobs source-health candidate requires a source-level cutover and has a no-retry rollback", async () => {
  const candidate = await loadJson(candidatePath);
  assert.deepEqual(candidate.noCoexistence.retainedCallbacks, ["industry-job-sync-adzuna", "job-sync"]);
  assert.equal(candidate.noCoexistence.activationBlockedUntil.length, 4);
  assert.equal(candidate.concurrency.replayBehavior, "return_prior_redacted_manifest_without_new_work");
  assert.equal(candidate.rollback.externalDisableFirst, true);
  assert.equal(candidate.rollback.automaticRetryAllowed, false);
});

test("rollback drill: the active Vercel configuration exposes no cron surface", async () => {
  const activeConfig = await loadJson(vercelConfigPath);
  assert.equal(Object.hasOwn(activeConfig, "crons"), false);
});
