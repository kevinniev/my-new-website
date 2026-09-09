export const DRY_RUN_MODE = "dry_run";

export const ROUTE_MANIFEST = Object.freeze([
  { path: "/api/health", file: "api/health.js", mode: DRY_RUN_MODE, maxDurationMs: 5000, purpose: "authenticated health summary" },
  { path: "/api/cron/operations-reconcile", file: "api/cron/operations-reconcile.js", mode: DRY_RUN_MODE, maxDurationMs: 25000, purpose: "operations manifest" },
  { path: "/api/cron/social-review", file: "api/cron/social-review.js", mode: DRY_RUN_MODE, maxDurationMs: 25000, purpose: "held social manifest" },
  { path: "/api/cron/outreach-review", file: "api/cron/outreach-review.js", mode: DRY_RUN_MODE, maxDurationMs: 25000, purpose: "held outreach manifest" },
  { path: "/api/cron/reminders-review", file: "api/cron/reminders-review.js", mode: DRY_RUN_MODE, maxDurationMs: 25000, purpose: "held reminder manifest" },
  { path: "/api/cron/lifecycle-review", file: "api/cron/lifecycle-review.js", mode: DRY_RUN_MODE, maxDurationMs: 25000, purpose: "lifecycle exceptions manifest" },
  { path: "/api/cron/industry-jobs", file: "api/cron/industry-jobs.js", mode: DRY_RUN_MODE, maxDurationMs: 25000, purpose: "future candidate manifest" },
]);

export function getRouteDefinition(path) {
  return ROUTE_MANIFEST.find((entry) => entry.path === path) ?? null;
}
