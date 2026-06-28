/**
 * Generate per-platform npm packages from prebuilds.
 * Each package contains just the .node binary and a package.json.
 *
 * Run after `make build` to create packages/ directory:
 *   node scripts/package-platforms.mjs
 */

import { readdirSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join, basename } from "path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const VERSION = pkg.version;
const SCOPE = "@ashbyhq";
const BASE_NAME = "libpg-query-native";
const PREBUILDS_DIR = "prebuilds";
const OUT_DIR = "packages";

const PLATFORMS = JSON.parse(readFileSync("platforms.json", "utf8"));

if (!existsSync(PREBUILDS_DIR)) {
  console.error(`No ${PREBUILDS_DIR}/ directory found. Run 'make build' first.`);
  process.exit(1);
}

const platforms = readdirSync(PREBUILDS_DIR);

for (const platform of platforms) {
  const meta = PLATFORMS[platform];
  if (!meta) {
    console.warn(`Skipping unknown platform: ${platform}`);
    continue;
  }

  const pkgName = `${SCOPE}/${BASE_NAME}-${platform}`;
  const pkgDir = join(OUT_DIR, `${BASE_NAME}-${platform}`);

  mkdirSync(pkgDir, { recursive: true });

  // Copy the .node file
  const nodeFile = join(PREBUILDS_DIR, platform, "libpg_query_native.node");
  if (!existsSync(nodeFile)) {
    console.warn(`No .node file for ${platform}, skipping`);
    continue;
  }
  copyFileSync(nodeFile, join(pkgDir, "libpg_query_native.node"));

  // Write index.js that just re-exports the binary
  writeFileSync(
    join(pkgDir, "index.js"),
    `module.exports = require('./libpg_query_native.node');\n`
  );

  // Write package.json
  const pkg = {
    name: pkgName,
    version: VERSION,
    description: `libpg-query native addon for ${platform}`,
    main: "index.js",
    files: ["index.js", "libpg_query_native.node"],
    os: meta.os,
    cpu: meta.cpu,
    ...(meta.libc ? { libc: meta.libc } : {}),
    license: "MIT",
    repository: {
      type: "git",
      url: "git://github.com/ashbyhq/libpg-query-node.git",
      directory: `native/packages/${BASE_NAME}-${platform}`,
    },
    publishConfig: {
      access: "public",
    },
  };

  writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");

  console.log(`Created ${pkgName} (${nodeFile})`);
}

console.log(`\nDone. Platform packages in ${OUT_DIR}/`);
