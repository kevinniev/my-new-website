const ALLOWED_OPERATIONS = Object.freeze([
  "operations-reconcile",
  "social-review",
  "outreach-review",
  "reminders-review",
  "lifecycle-review",
  "industry-jobs",
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function buildReviewEnvelope(operation, now = new Date().toISOString()) {
  if (!ALLOWED_OPERATIONS.includes(operation)) {
    return { ok: false, error: "operation_not_allowed", mode: "dry_run", dispatchAllowed: false };
  }

  return {
    ok: true,
    mode: "dry_run",
    operation,
    dispatchAllowed: false,
    sideEffects: [],
    providerCalls: [],
    dataMutations: [],
    generatedAt: now,
  };
}

export default {
  async fetch(request) {
    if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);

    const url = new URL(request.url);
    const operation = url.searchParams.get("operation") || "operations-reconcile";
    const envelope = buildReviewEnvelope(operation);
    return json(envelope, envelope.ok ? 200 : 404);
  },

  async scheduled() {
    // Intentionally no-op: this source has no deployed trigger and never dispatches work.
    return buildReviewEnvelope("operations-reconcile");
  },
};
