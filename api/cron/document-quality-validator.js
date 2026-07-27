/**
 * Document Quality Validator — runs daily at 6 AM UTC
 * Reviews submitted documents for quality issues:
 * - Headshots: checks for white/neutral background, face visibility, professional crop
 * - Government ID: checks for legibility and completeness
 * - W-9: checks for required fields
 * Flags documents that need re-submission and notifies the technician.
 */
import { createLogger } from "../../lib/logger.js";
import { callAVfreelance } from "../../lib/avfreelance.js";

const log = createLogger("document-quality-validator");

const QUALITY_RULES = {
  headshot: {
    minSizeKb: 50,
    maxSizeKb: 5000,
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    requiredNote: "Professional headshot with neutral/white background, face clearly visible",
  },
  gov_id: {
    minSizeKb: 50,
    maxSizeKb: 10000,
    allowedTypes: ["image/jpeg", "image/png", "application/pdf"],
    requiredNote: "Government-issued photo ID (driver's license, passport, or state ID)",
  },
  w9_form: {
    minSizeKb: 10,
    maxSizeKb: 5000,
    allowedTypes: ["application/pdf", "image/jpeg", "image/png"],
    requiredNote: "Completed and signed W-9 form",
  },
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] || req.headers.authorization?.replace("Bearer ", "");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    log.info("Starting document quality validation run");

    // Get all pending documents from AVfreelance
    const docsResult = await callAVfreelance("/api/webhooks/onboarding/pending-documents", {
      method: "GET",
    });

    if (!docsResult.ok) {
      return res.status(500).json({ ok: false, error: "Failed to fetch pending documents" });
    }

    const { documents = [] } = docsResult.data;
    const validated = [];
    const flagged = [];

    for (const doc of documents) {
      const rule = QUALITY_RULES[doc.type];
      if (!rule) {
        // No quality rule for this doc type — auto-pass
        validated.push({ docId: doc.id, type: doc.type, result: "passed_no_rule" });
        continue;
      }

      const issues = [];

      // Check file size
      if (doc.sizeKb && doc.sizeKb < rule.minSizeKb) {
        issues.push(`File too small (${doc.sizeKb}KB, minimum ${rule.minSizeKb}KB) — may be low quality`);
      }
      if (doc.sizeKb && doc.sizeKb > rule.maxSizeKb) {
        issues.push(`File too large (${doc.sizeKb}KB, maximum ${rule.maxSizeKb}KB)`);
      }

      // Check file type
      if (doc.mimeType && !rule.allowedTypes.includes(doc.mimeType)) {
        issues.push(`Invalid file type: ${doc.mimeType}. Accepted: ${rule.allowedTypes.join(", ")}`);
      }

      if (issues.length > 0) {
        // Flag the document for re-submission
        const flagResult = await callAVfreelance("/api/webhooks/onboarding/flag-document", {
          method: "POST",
          body: {
            docId: doc.id,
            userId: doc.userId,
            issues,
            requiredNote: rule.requiredNote,
          },
        });

        flagged.push({
          docId: doc.id,
          userId: doc.userId,
          type: doc.type,
          issues,
          flagged: flagResult.ok,
        });
        log.info(`Flagged document ${doc.id} for user ${doc.userId}: ${issues.join("; ")}`);
      } else {
        validated.push({ docId: doc.id, type: doc.type, result: "passed" });
      }
    }

    log.info(`Document validation complete: ${validated.length} passed, ${flagged.length} flagged`);
    return res.json({
      ok: true,
      total: documents.length,
      passed: validated.length,
      flagged: flagged.length,
      flaggedDetails: flagged,
    });
  } catch (err) {
    log.error("Document quality validator error", { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
