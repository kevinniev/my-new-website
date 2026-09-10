import { runPreviewOidcProof } from "../../lib/preview-oidc-proof.js";

/**
 * Temporary Preview-only handler proof. It is not in vercel.json, has no cron,
 * and is removed after the one authorized proof result is recorded.
 */
export default async function handler(req, res) {
  return runPreviewOidcProof({ req, res });
}
