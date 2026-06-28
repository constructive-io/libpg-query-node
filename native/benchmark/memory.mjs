/**
 * Memory benchmark: compare allocator behavior for large SQL parses.
 *
 * Generates a ~3.3 MB SQL query (1500× UNION ALL of SELECT c0..c399 FROM t),
 * parses it, and measures RSS at idle, peak (post-parse), and after free.
 *
 * Usage:
 *   node benchmark/memory.mjs                    # native backend
 *   node benchmark/memory.mjs --wasm             # WASM backend for comparison
 *   node benchmark/memory.mjs --all              # run all available backends
 *   node benchmark/memory.mjs --small            # quick sanity check (small query)
 *   node benchmark/memory.mjs --throughput       # throughput benchmark
 *   node benchmark/memory.mjs --cycles 3         # multiple parse/free cycles
 */

import { argv } from "process";

const MB = 1024 * 1024;

function rss() {
  return process.memoryUsage.rss();
}

function generateBigQuery(unions = 1500, cols = 400) {
  const colList = Array.from({ length: cols }, (_, i) => `c${i}`).join(", ");
  const select = `SELECT ${colList} FROM t`;
  return Array.from({ length: unions }, () => select).join(" UNION ALL ");
}

function generateSmallQuery() {
  return "SELECT id, name, email, created_at FROM users WHERE id = $1 AND active = true";
}

function detectAllocator() {
  const preload = process.env.LD_PRELOAD || process.env.DYLD_INSERT_LIBRARIES || "";
  if (preload.includes("jemalloc")) return "jemalloc";
  if (preload.includes("mimalloc")) return "mimalloc";
  if (preload.includes("tcmalloc")) return "tcmalloc";
  return "system";
}

async function gcAndSettle(ms = 200) {
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, ms));
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, ms));
}

async function benchmarkParse(backend, label, query, cycles = 1) {
  await gcAndSettle();

  const idleRss = rss();
  console.log(`\n--- ${label} ---`);
  console.log(`Query size:    ${(query.length / MB).toFixed(2)} MB`);
  console.log(`Idle RSS:      ${(idleRss / MB).toFixed(1)} MB`);

  let peakRss = 0;
  let totalParseTime = 0;
  let resultSize = 0;

  for (let cycle = 0; cycle < cycles; cycle++) {
    if (cycles > 1) process.stdout.write(`  cycle ${cycle + 1}/${cycles}...`);

    const start = performance.now();
    let result;
    try {
      result = await backend.parse(query);
    } catch (e) {
      console.log(` parse failed: ${e.message}`);
      return null;
    }
    const elapsed = performance.now() - start;
    totalParseTime += elapsed;

    const currentRss = rss();
    if (currentRss > peakRss) peakRss = currentRss;

    if (cycle === 0) {
      const resultJson = JSON.stringify(result);
      resultSize = Buffer.byteLength(resultJson);
    }

    // Drop references and let GC + allocator return memory
    result = null;
    await gcAndSettle(300);

    const afterCycleRss = rss();
    if (cycles > 1) {
      console.log(
        ` peak=${(currentRss / MB).toFixed(0)} MB, after=${(afterCycleRss / MB).toFixed(0)} MB, ${elapsed.toFixed(0)} ms`
      );
    }
  }

  const afterRss = rss();
  const avgParseTime = totalParseTime / cycles;

  console.log(`Parse time:    ${avgParseTime.toFixed(0)} ms${cycles > 1 ? ` (avg of ${cycles})` : ""}`);
  console.log(`Result size:   ${(resultSize / MB).toFixed(1)} MB`);
  console.log(`Peak RSS:      ${(peakRss / MB).toFixed(1)} MB`);
  console.log(`Peak delta:    +${((peakRss - idleRss) / MB).toFixed(1)} MB`);
  console.log(`After free:    ${(afterRss / MB).toFixed(1)} MB`);
  console.log(`Retained:      +${((afterRss - idleRss) / MB).toFixed(1)} MB`);

  return {
    label,
    idleRss,
    peakRss,
    afterRss,
    parseTime: avgParseTime,
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

async function main() {
  const flags = new Set(argv.slice(2));

  const runAll = flags.has("--all");
  const runWasm = flags.has("--wasm") || runAll;
  const runNative = !flags.has("--wasm") || runAll;
  const small = flags.has("--small");
  const throughput = flags.has("--throughput");

  let cycles = 1;
  const cyclesIdx = argv.indexOf("--cycles");
  if (cyclesIdx !== -1 && argv[cyclesIdx + 1]) {
    cycles = parseInt(argv[cyclesIdx + 1], 10) || 1;
  }

  const query = small ? generateSmallQuery() : generateBigQuery();
  const allocator = detectAllocator();

  console.log("=== libpg-query Memory Benchmark ===");
  console.log(`Node ${process.version}, ${process.platform}-${process.arch}`);
  console.log(`Allocator: ${allocator}`);
  console.log(`GC exposed: ${typeof global.gc === "function"}`);
  if (typeof global.gc !== "function") {
    console.log("Hint: run with --expose-gc for more accurate measurements");
  }

  const results = [];

  if (runNative) {
    const native = await loadNative();
    if (native) {
      const label = `Native (${allocator})`;
      results.push(await benchmarkParse(native, label, query, cycles));
      if (throughput) {
        await benchmarkThroughput(native, label);
      }
    }
  }

  if (runWasm) {
    const wasm = await loadWasm();
    if (wasm) {
      results.push(await benchmarkParse(wasm, "WASM (emscripten)", query, cycles));
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
