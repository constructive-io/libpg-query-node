/**
 * CI regression benchmark.
 *
 * Emits results in the github-action-benchmark `customSmallerIsBetter` format
 * so the difference vs. the stored baseline is reported on every PR and a
 * conservative threshold can fail the build on a real regression.
 *
 * All metrics are normalized to "smaller is better":
 *   - large-query parse time (ms)
 *   - large-query peak RSS (MB)
 *   - large-query retained RSS after free (MB)
 *   - small-query latency (µs per parse)  [inverse of throughput]
 *
 * Run with: node --expose-gc benchmark/ci-bench.mjs --out results.json
 * For meaningful, stable memory numbers, preload jemalloc (see workflow).
 */

import { argv } from "process";
import { writeFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const MB = 1024 * 1024;

function rss() {
  return process.memoryUsage.rss();
}

function generateBigQuery(unions = 1500, cols = 400) {
  const colList = Array.from({ length: cols }, (_, i) => `c${i}`).join(", ");
  const select = `SELECT ${colList} FROM t`;
  return Array.from({ length: unions }, () => select).join(" UNION ALL ");
}

async function gcSettle(ms = 300) {
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, ms));
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, ms));
}

function detectAllocator() {
  const preload =
    process.env.LD_PRELOAD || process.env.DYLD_INSERT_LIBRARIES || "";
  if (preload.includes("jemalloc")) return "jemalloc";
  if (preload.includes("mimalloc")) return "mimalloc";
  if (preload.includes("tcmalloc")) return "tcmalloc";
  return "system";
}

async function main() {
  const outIdx = argv.indexOf("--out");
  const outFile = outIdx !== -1 ? argv[outIdx + 1] : "benchmark-results.json";

  const lib = require("../dist/index.js");
  const allocator = detectAllocator();

  const bigQuery = generateBigQuery();
  const smallQuery = "SELECT id, name FROM users WHERE id = $1 AND active = true";

  // Warm up
  for (let i = 0; i < 5; i++) lib.parseSync(bigQuery.slice(0, 200));

  // --- Large query: parse time, peak RSS, retained RSS (3 cycles) ---
  await gcSettle();
  const idleRss = rss();
  let peakRss = 0;
  let totalParse = 0;
  const cycles = 3;
  for (let c = 0; c < cycles; c++) {
    const start = performance.now();
    let result = lib.parseSync(bigQuery);
    totalParse += performance.now() - start;
    const cur = rss();
    if (cur > peakRss) peakRss = cur;
    result = null;
    await gcSettle();
  }
  await gcSettle();
  const retainedRss = rss() - idleRss;
  const avgParseMs = totalParse / cycles;

  // --- Small query: throughput -> µs/parse ---
  const iterations = 20000;
  for (let i = 0; i < 1000; i++) lib.parseSync(smallQuery); // warm
  const tStart = performance.now();
  for (let i = 0; i < iterations; i++) lib.parseSync(smallQuery);
  const elapsedMs = performance.now() - tStart;
  const usPerParse = (elapsedMs * 1000) / iterations;

  const results = [
    {
      name: "Large query parse time",
      unit: "ms",
      value: round(avgParseMs),
    },
    {
      name: "Large query peak RSS",
      unit: "MB",
      value: round(peakRss / MB),
    },
    {
      name: "Large query retained RSS",
      unit: "MB",
      value: round(retainedRss / MB),
    },
    {
      name: "Small query latency",
      unit: "us/parse",
      value: round(usPerParse, 3),
    },
  ];

  console.log(`Allocator: ${allocator}`);
  console.table(results);
  writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");
  console.log(`Wrote ${outFile}`);
}

function round(n, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
