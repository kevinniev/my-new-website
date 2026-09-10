import { createDryRunHandler } from "../../lib/dry-run-handler.js";
import fixture from "../../fixtures/dry-run/outreach-review.json" with { type: "json" };
export default createDryRunHandler("/api/cron/outreach-review", fixture);
