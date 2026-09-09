import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_LIMITS, createDryRunManifest, resetDryRunStateForTests } from "../lib/dry-run-foundation.js";

test.beforeEach(() => {
  resetDryRunStateForTests();
  delete process.env.VERCEL_ENV;
  process.env.AUTOMATION_MODE = "dry_run";
});

test("dry-run manifests never enable dispatch and enforce candidate caps", async () => {
  const manifest = await createDryRunManifest({
    route: "/api/cron/social-review",
    fixture: { brand: "avfreelance", candidates: Array.from({ length: 55 }, (_, id) => ({ id })) },
    scope: { test: true },
  });
  assert.equal(manifest.mode, "dry_run");
  assert.equal(manifest.dispatchAllowed, false);
  assert.deepEqual(manifest.sideEffects, []);
  assert.equal(manifest.candidateCount, FOUNDATION_LIMITS.maxCandidates);
  assert.equal(manifest.truncated, true);
});

test("same dry-run scope replays the idempotent manifest", async () => {
  const input = {
    route: "/api/cron/outreach-review",
    fixture: { brand: "avfreelance", candidates: [] },
    scope: { fixture: "outreach-review" },
    now: new Date("2026-09-09T00:00:00.000Z"),
  };
  const first = await createDryRunManifest(input);
  const second = await createDryRunManifest(input);
  assert.equal(second.replayed, true);
  assert.equal(second.manifestId, first.manifestId);
});

test("brand contamination and production memory state are rejected", async () => {
  await assert.rejects(createDryRunManifest({ route: "/api/cron/social-review", fixture: { brand: "communitycut" } }), /brand_boundary_rejected/);
  process.env.VERCEL_ENV = "production";
  delete process.env.AUTOMATION_STATE_DATABASE_URL;
  await assert.rejects(createDryRunManifest({ route: "/api/cron/social-review", fixture: { brand: "avfreelance" } }), /durable_state_store_required_in_production/);
});

test("kill switch blocks every dry-run manifest before work begins", async () => {
  process.env.AUTOMATION_KILL_SWITCH = "enabled";
  await assert.rejects(
    createDryRunManifest({ route: "/api/cron/operations-reconcile", fixture: { brand: "avfreelance" } }),
    /automation_kill_switch_enabled/,
  );
  delete process.env.AUTOMATION_KILL_SWITCH;
});
