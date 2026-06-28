/**
 * Sync optionalDependencies in package.json from platforms.json.
 * Run after adding/removing platforms:
 *   node scripts/sync-optional-deps.mjs
 */

import { readFileSync, writeFileSync } from "fs";

const platforms = JSON.parse(readFileSync("platforms.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const optionalDeps = {};
for (const platform of Object.keys(platforms)) {
  optionalDeps[`@ashbyhq/libpg-query-native-${platform}`] = pkg.version;
}

pkg.optionalDependencies = optionalDeps;

writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

console.log(`Synced ${Object.keys(optionalDeps).length} optionalDependencies from platforms.json`);
