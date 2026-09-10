import { requireServiceAuth } from "../lib/auth.js";
import { ROUTE_MANIFEST } from "../lib/route-manifest.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  if (!requireServiceAuth(req, res)) return;
  return res.status(200).json({ ok: true, mode: "dry_run", cronEnabled: false, routeCount: ROUTE_MANIFEST.length, externalProvidersEnabled: false, actionDispatchEnabled: false });
}
