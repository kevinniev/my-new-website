import { createDryRunHandler } from "../../lib/dry-run-handler.js";
import fixture from "../../fixtures/dry-run/operations-reconcile.json" with { type: "json" };
export default createDryRunHandler("/api/cron/operations-reconcile", fixture);
