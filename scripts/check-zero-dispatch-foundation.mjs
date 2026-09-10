import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReviewEnvelope } from "../cloudflare/avfreelance-review-gateway/src/index.js";
import { ROUTE_MANIFEST } from "../lib/route-manifest.js";

const activeConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const candidateConfig = JSON.parse(await readFile(new URL("../automation/vercel-read-only-crons.json", import.meta.url), "utf8"));

assert.equal(activeConfig.crons, undefined, "root Vercel config must not declare active cron jobs");
assert.ok(candidateConfig.crons.length > 0, "read-only candidate must preserve reviewed schedules");

for (const cron of candidateConfig.crons) {
  assert.ok(ROUTE_MANIFEST.some((route) => route.path === cron.path), `cron path must be fixture-only: ${cron.path}`);
  const envelope = buildReviewEnvelope(cron.path.split("/").at(-1));
  assert.equal(envelope.dispatchAllowed, false, `dispatch must stay disabled: ${cron.path}`);
  assert.deepEqual(envelope.sideEffects, [], `side effects must stay empty: ${cron.path}`);
  assert.deepEqual(envelope.providerCalls, [], `provider calls must stay empty: ${cron.path}`);
  assert.deepEqual(envelope.dataMutations, [], `data mutations must stay empty: ${cron.path}`);
}

assert.equal(buildReviewEnvelope("unknown").ok, false, "worker must reject unknown operations");
console.log(`zero-dispatch foundation validated for ${candidateConfig.crons.length} candidate routes`);
