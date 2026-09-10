import { createHash, randomUUID } from "node:crypto";

export const FOUNDATION_LIMITS = Object.freeze({
  mode: "dry_run",
  providerDeadlineMs: 8000,
  workloadDeadlineMs: 25000,
  maxCandidates: 50,
  brand: "avfreelance",
});

const runs = new Map();
const locks = new Map();

function assertFoundationMode() {
  if (process.env.AUTOMATION_MODE && process.env.AUTOMATION_MODE !== FOUNDATION_LIMITS.mode) throw new Error("automation_mode_must_be_dry_run");
}

function assertRollbackSwitch() {
  if (process.env.AUTOMATION_KILL_SWITCH === "enabled") throw new Error("automation_kill_switch_enabled");
}

function assertProductionStateStore() {
  if (process.env.VERCEL_ENV === "production" && !process.env.AUTOMATION_STATE_DATABASE_URL) throw new Error("durable_state_store_required_in_production");
}

export function createIdempotencyKey({ route, scope = {}, window = "manual" }) {
  return createHash("sha256").update(JSON.stringify({ route, scope, window, mode: FOUNDATION_LIMITS.mode })).digest("hex");
}

export function acquireLock(lockKey) {
  if (locks.has(lockKey)) return false;
  locks.set(lockKey, Date.now());
  return true;
}

export function releaseLock(lockKey) {
  locks.delete(lockKey);
}

export async function createDryRunManifest({ route, fixture = {}, scope = {}, now = new Date() }) {
  assertFoundationMode();
  assertRollbackSwitch();
  assertProductionStateStore();
  if (fixture.brand && fixture.brand !== FOUNDATION_LIMITS.brand) throw new Error("brand_boundary_rejected");
  const idempotencyKey = createIdempotencyKey({ route, scope, window: now.toISOString().slice(0, 13) });
  const existing = runs.get(idempotencyKey);
  if (existing) return { ...existing, replayed: true };
  const lockKey = `${route}:${idempotencyKey}`;
  if (!acquireLock(lockKey)) return { ok: true, mode: FOUNDATION_LIMITS.mode, route, skipped: true, reason: "already_running" };
  try {
    const candidates = Array.isArray(fixture.candidates) ? fixture.candidates.slice(0, FOUNDATION_LIMITS.maxCandidates) : [];
    const manifest = {
      ok: true,
      mode: FOUNDATION_LIMITS.mode,
      route,
      manifestId: `dryrun_${randomUUID()}`,
      idempotencyKey,
      generatedAt: now.toISOString(),
      brand: FOUNDATION_LIMITS.brand,
      candidateCount: candidates.length,
      truncated: Array.isArray(fixture.candidates) && fixture.candidates.length > candidates.length,
      exclusionReasons: fixture.exclusionReasons ?? [],
      limits: { providerDeadlineMs: FOUNDATION_LIMITS.providerDeadlineMs, workloadDeadlineMs: FOUNDATION_LIMITS.workloadDeadlineMs, maxCandidates: FOUNDATION_LIMITS.maxCandidates },
      sideEffects: [],
      dispatchAllowed: false,
    };
    runs.set(idempotencyKey, manifest);
    return manifest;
  } finally {
    releaseLock(lockKey);
  }
}

export function resetDryRunStateForTests() {
  runs.clear();
  locks.clear();
}
