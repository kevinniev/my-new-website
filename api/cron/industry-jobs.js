import { createDryRunHandler } from "../../lib/dry-run-handler.js";
import fixture from "../../fixtures/dry-run/industry-jobs.json" with { type: "json" };
export default createDryRunHandler("/api/cron/industry-jobs", fixture);
