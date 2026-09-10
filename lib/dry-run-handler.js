import { requireCron } from "./auth.js";
import { createDryRunManifest } from "./dry-run-foundation.js";

export function createDryRunHandler(route, fixture) {
  return async function handler(req, res) {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
    if (!requireCron(req, res)) return;
    try {
      return res.status(200).json(await createDryRunManifest({ route, fixture, scope: { fixture: fixture.name ?? route } }));
    } catch (error) {
      return res.status(503).json({ ok: false, mode: "dry_run", error: error.message });
    }
  };
}
