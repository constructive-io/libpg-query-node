/**
 * Measure where time is spent: native parse vs string copy vs JSON.parse.
 *
 * Usage:
 *   node benchmark/breakdown.mjs           # large query
 *   node benchmark/breakdown.mjs --small   # small query
 */

import { argv } from "process";

const MB = 1024 * 1024;

function generateBigQuery(unions = 1500, cols = 400) {
  const colList = Array.from({ length: cols }, (_, i) => `c${i}`).join(", ");
  const select = `SELECT ${colList} FROM t`;
  return Array.from({ length: unions }, () => select).join(" UNION ALL ");
}

async function main() {
  const small = argv.includes("--small");
  const addon = (await import("../dist/index.js")).default || await import("../dist/index.js");

  // Raw addon for string-level measurement
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const raw = require("../prebuilds/" + process.platform + "-" + process.arch + "/libpg_query_native.node");

  const query = small
    ? "SELECT id, name FROM users WHERE id = $1"
    : generateBigQuery();

  console.log(`Query size: ${(query.length / MB).toFixed(2)} MB`);
  console.log("");

  // Warmup
  for (let i = 0; i < 5; i++) raw.parseSync(query);

  const iterations = small ? 10000 : 3;

  // 1. Raw native call (parse + JSON serialize in C + string copy to V8)
  let jsonStr;
  {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const res = raw.parseSync(query);
      jsonStr = res.result;
    }
    const elapsed = performance.now() - start;
    const avg = elapsed / iterations;
    console.log(`Native (parse + JSON serialize + string copy): ${avg < 1 ? (avg * 1000).toFixed(1) + ' μs' : avg.toFixed(2) + ' ms'}`);
    console.log(`  JSON string size: ${Buffer.byteLength(jsonStr) < MB ? (Buffer.byteLength(jsonStr) / 1024).toFixed(1) + ' KB' : (Buffer.byteLength(jsonStr) / MB).toFixed(2) + ' MB'}`);
  }

  // 2. JSON.parse only
  {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      JSON.parse(jsonStr);
    }
    const elapsed = performance.now() - start;
    const avg = elapsed / iterations;
    console.log(`JSON.parse:                                     ${avg < 1 ? (avg * 1000).toFixed(1) + ' μs' : avg.toFixed(2) + ' ms'}`);
  }

  // 3. End-to-end (native + JSON.parse)
  {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const res = raw.parseSync(query);
      JSON.parse(res.result);
    }
    const elapsed = performance.now() - start;
    const avgE2e = elapsed / iterations;
    console.log(`End-to-end (native + JSON.parse):               ${avgE2e < 1 ? (avgE2e * 1000).toFixed(1) + ' μs' : avgE2e.toFixed(2) + ' ms'}`);
  }

  // 4. Raw native call returning string only (no JSON.parse) — to isolate
  let nativeOnly, jsonParseOnly, e2e;
  {
    const s1 = performance.now();
    for (let i = 0; i < iterations; i++) raw.parseSync(query);
    nativeOnly = (performance.now() - s1) / iterations;

    const s2 = performance.now();
    for (let i = 0; i < iterations; i++) JSON.parse(jsonStr);
    jsonParseOnly = (performance.now() - s2) / iterations;

    const s3 = performance.now();
    for (let i = 0; i < iterations; i++) { const r = raw.parseSync(query); JSON.parse(r.result); }
    e2e = (performance.now() - s3) / iterations;
  }

  const fmt = v => v < 1 ? (v * 1000).toFixed(1) + ' μs' : v.toFixed(2) + ' ms';
  console.log("");
  console.log(`Breakdown (second run, warmed up):`);
  console.log(`  Native (parse+serialize+copy): ${(nativeOnly / e2e * 100).toFixed(0)}%  ${fmt(nativeOnly)}`);
  console.log(`  JSON.parse:                    ${(jsonParseOnly / e2e * 100).toFixed(0)}%  ${fmt(jsonParseOnly)}`);
  console.log(`  Total e2e:                                 ${fmt(e2e)}`);
}

main().catch(console.error);
