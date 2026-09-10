import { createDryRunHandler } from "../../lib/dry-run-handler.js";
import fixture from "../../fixtures/dry-run/lifecycle-review.json" with { type: "json" };
export default createDryRunHandler("/api/cron/lifecycle-review", fixture);
