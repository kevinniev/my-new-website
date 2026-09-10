import fs from "node:fs";
import path from "node:path";
import { ROUTE_MANIFEST } from "../lib/route-manifest.js";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const errors = [];

if ((config.crons ?? []).length !== 0) errors.push("Dry-run foundation requires zero Vercel cron declarations.");

for (const route of ROUTE_MANIFEST) {
  if (!fs.existsSync(path.join(root, route.file))) errors.push(`Missing handler for ${route.path}: ${route.file}`);
  if (route.mode !== "dry_run") errors.push(`Non-dry-run route in foundation manifest: ${route.path}`);
}

const legacy = new Set([
  "analytics-sync.js", "background-check-poller.js", "daily-crm-update.js", "daily-report.js",
  "document-quality-validator.js", "engagement-detector.js", "engagement-engine.js", "missing-step-detector.js",
  "onboarding-checker.js", "onboarding-reminder-job.js", "onboarding-status-sync.js", "partner-job-pull.js",
  "posting-queue.js", "social-feed-refresh.js",
]);
for (const filename of fs.readdirSync(path.join(root, "api", "cron"))) {
  if (legacy.has(filename)) continue;
  if (!ROUTE_MANIFEST.some((route) => route.file === `api/cron/${filename}`)) errors.push(`Unmanifested cron handler: api/cron/${filename}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Route parity passed: ${ROUTE_MANIFEST.length} dry-run routes and zero cron declarations.`);
