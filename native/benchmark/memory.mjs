/**
 * Memory benchmark: compare allocator behavior for large SQL parses.
 *
 * Generates a ~2.74 MB SQL query (1500× UNION ALL of SELECT c0..c399 FROM t),
 * parses it, and measures RSS at idle, peak (post-parse), and after free.
 *
 * Usage:
 *   node benchmark/memory.mjs                    # native (jemalloc)
 *   node benchmark/memory.mjs --wasm             # WASM backend for comparison
 *   node benchmark/memory.mjs --system-malloc    # native without jemalloc
 *   node benchmark/memory.mjs --all              # run all available backends
 *   node benchmark/memory.mjs --small            # quick sanity check (small query)
 *   node benchmark/memory.mjs --throughput       # throughput benchmark
 */

import { argv } from "process";

const MB = 1024 * 1024;

function rss() {
  return process.memoryUsage.rss();
}

function rssMB() {
  return (rss() / MB).toFixed(1);
}

function generateBigQuery(unions = 1500, cols = 400) {
  const colList = Array.from({ length: cols }, (_, i) => `c${i}`).join(", ");
  const select = `SELECT ${colList} FROM t`;
  return Array.from({ length: unions }, () => select).join(" UNION ALL ");
}

function generateSmallQuery() {
  return "SELECT id, name, email, created_at FROM users WHERE id = $1 AND active = true";
}

async function benchmarkParse(backend, label, query) {
  // Force GC if available
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 100));

  const idleRss = rss();
  console.log(`\n--- ${label} ---`);
  console.log(`Query size:    ${(query.length / MB).toFixed(2)} MB`);
  console.log(`Idle RSS:      ${(idleRss / MB).toFixed(1)} MB`);

  const start = performance.now();
  let result;
  try {
    result = await backend.parse(query);
  } catch (e) {
    console.log(`Parse failed:  ${e.message}`);
    return null;
  }
  const parseTime = performance.now() - start;

  const peakRss = rss();
  const resultJson = JSON.stringify(result);
  const resultSize = Buffer.byteLength(resultJson);

  console.log(`Parse time:    ${parseTime.toFixed(0)} ms`);
  console.log(`Result size:   ${(resultSize / MB).toFixed(1)} MB`);
  console.log(`Peak RSS:      ${(peakRss / MB).toFixed(1)} MB`);
  console.log(`Peak delta:    +${((peakRss - idleRss) / MB).toFixed(1)} MB`);

  // Drop references and let GC + allocator return memory
  result = null;
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 500));

  const afterRss = rss();
  console.log(`After free:    ${(afterRss / MB).toFixed(1)} MB`);
  console.log(`Retained:      +${((afterRss - idleRss) / MB).toFixed(1)} MB`);

  return {
    label,
    idleRss,
    peakRss,
    afterRss,
    parseTime,
    resultSize,
    querySize: query.length,
  };
}

async function benchmarkThroughput(backend, label, iterations = 10000) {
  const query = "SELECT id, name FROM users WHERE id = $1";

  // Warmup
  for (let i = 0; i < 100; i++) {
    backend.parseSync(query);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    backend.parseSync(query);
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);

  console.log(`\n--- ${label} throughput ---`);
  console.log(`${iterations} parses in ${elapsed.toFixed(0)} ms`);
  console.log(`${opsPerSec.toLocaleString()} ops/sec`);

  return { label, iterations, elapsed, opsPerSec };
}

async function loadNative() {
  try {
    return await import("../dist/index.js");
  } catch {
    console.error(
      "Native backend not found. Run 'make build && npm run build:ts' first."
    );
    return null;
  }
}

async function loadWasm() {
  try {
    const wasm = await import("@libpg-query/parser");
    if (wasm.loadModule) await wasm.loadModule();
    return wasm;
  } catch {
    console.error(
      "WASM backend not found. Install @libpg-query/parser for comparison."
    );
    return null;
  }
}

function isJemallocLoaded() {
  return !!(process.env.LD_PRELOAD?.includes("jemalloc") ||
            process.env.DYLD_INSERT_LIBRARIES?.includes("jemalloc"));
}

async function main() {
  const flags = new Set(argv.slice(2));

  const runAll = flags.has("--all");
  const runWasm = flags.has("--wasm") || runAll;
  const runNative = !flags.has("--wasm") || runAll;
  const small = flags.has("--small");
  const throughput = flags.has("--throughput");

  const query = small ? generateSmallQuery() : generateBigQuery();

  console.log("=== libpg-query Memory Benchmark ===");
  console.log(`Node ${process.version}, ${process.platform}-${process.arch}`);
  console.log(`GC exposed: ${typeof global.gc === "function"}`);
  if (typeof global.gc !== "function") {
    console.log("Hint: run with --expose-gc for more accurate measurements");
  }

  const results = [];

  if (runNative) {
    const native = await loadNative();
    if (native) {
      const jemallocLoaded = isJemallocLoaded();
      const label = jemallocLoaded ? "Native (jemalloc)" : "Native (system malloc)";
      results.push(await benchmarkParse(native, label, query));
      if (throughput) {
        await benchmarkThroughput(native, label);
      }
    }
  }

  if (runWasm) {
    const wasm = await loadWasm();
    if (wasm) {
      results.push(await benchmarkParse(wasm, "WASM (emscripten)", query));
      if (throughput) {
        await benchmarkThroughput(wasm, "WASM (emscripten)");
      }
    }
  }

  // Summary table
  const valid = results.filter(Boolean);
  if (valid.length > 1) {
    console.log("\n=== Summary ===");
    console.log(
      "Backend".padEnd(25) +
        "Idle".padStart(10) +
        "Peak".padStart(10) +
        "After".padStart(10) +
        "Retained".padStart(10) +
        "Parse ms".padStart(10)
    );
    console.log("-".repeat(75));
    for (const r of valid) {
      console.log(
        r.label.padEnd(25) +
          `${(r.idleRss / MB).toFixed(1)} MB`.padStart(10) +
          `${(r.peakRss / MB).toFixed(1)} MB`.padStart(10) +
          `${(r.afterRss / MB).toFixed(1)} MB`.padStart(10) +
          `+${((r.afterRss - r.idleRss) / MB).toFixed(1)} MB`.padStart(10) +
          `${r.parseTime.toFixed(0)}`.padStart(10)
      );
    }
  }
}

main().catch(console.error);
