import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("route parity rejects no dry-run foundation mismatch", () => {
  const output = execFileSync(process.execPath, ["scripts/check-route-parity.mjs"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.match(output, /zero cron declarations/);
});
