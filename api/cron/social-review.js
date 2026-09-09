import { createDryRunHandler } from "../../lib/dry-run-handler.js";
import fixture from "../../fixtures/dry-run/social-review.json" with { type: "json" };
export default createDryRunHandler("/api/cron/social-review", fixture);
