import { createDryRunHandler } from "../../lib/dry-run-handler.js";
import fixture from "../../fixtures/dry-run/reminders-review.json" with { type: "json" };
export default createDryRunHandler("/api/cron/reminders-review", fixture);
