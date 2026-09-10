import fs from "node:fs";
import path from "node:path";
import { createDryRunManifest } from "../lib/dry-run-foundation.js";
import { ROUTE_MANIFEST } from "../lib/route-manifest.js";

const route = process.argv[2] ?? "/api/cron/operations-reconcile";
const definition = ROUTE_MANIFEST.find((entry) => entry.path === route);
if (!definition || route === "/api/health") throw new Error("Provide one dry-run cron route from the route manifest.");
const fixtureName = path.basename(definition.file, ".js");
const fixturePath = path.resolve(import.meta.dirname, "..", "fixtures", "dry-run", `${fixtureName}.json`);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const manifest = await createDryRunManifest({ route, fixture, scope: { fixture: fixture.name } });
if (manifest.dispatchAllowed || manifest.sideEffects.length !== 0) throw new Error("Dry-run safety violation: manifest contains a dispatch path.");
console.log(JSON.stringify(manifest, null, 2));
