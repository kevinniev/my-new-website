import { ROUTE_MANIFEST } from "../lib/route-manifest.js";

for (const route of ROUTE_MANIFEST) {
  await import(`../${route.file}`);
}

console.log(`Handler import check passed: ${ROUTE_MANIFEST.length} dry-run modules loaded without execution.`);
