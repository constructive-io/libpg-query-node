/**
 * Consumer contract test.
 *
 * This package is consumed transitively: `pgsql-parser` depends on `libpg-query`,
 * and we substitute ourselves for it via an npm `overrides` alias. Its entry point
 * is a pure re-export shim, so the contract we actually owe it is a small set of
 * symbols — currently `loadModule`, `parse`, `parseSync` — not the whole API.
 *
 * The real risk is therefore NOT upstream adding an export. It is `pgsql-parser`
 * starting to consume a symbol we do not implement. So this test derives the
 * required set from the installed `pgsql-parser` rather than hardcoding it, and
 * fails when that set grows beyond what we provide.
 *
 * Run from a scratch project that has `pgsql-parser` installed with `libpg-query`
 * aliased to this package:
 *   node consumer-contract.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TARGET = "libpg-query";

let failures = 0;
const ok = (name, extra = "") => console.log(`  ok  ${name}${extra ? " — " + extra : ""}`);
const fail = (name, why) => {
  failures++;
  console.log(`  FAIL ${name}\n       ${why}`);
};

/** Every .js/.mjs/.cjs/.d.ts file under dir, skipping nested node_modules. */
function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if ([".js", ".mjs", ".cjs", ".ts"].includes(extname(p))) acc.push(p);
  }
  return acc;
}

/**
 * Find which symbols a package pulls from `moduleName`.
 *
 * Handles the three shapes pgsql-parser ships:
 *   export { a, b as c } from 'libpg-query'   -> a, b   (local name, not the alias)
 *   import { a, b } from 'libpg-query'        -> a, b
 *   var X = require("libpg-query"); X.a       -> a
 */
function findConsumedSymbols(pkgDir, moduleName) {
  const found = new Set();
  const mod = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const file of sourceFiles(pkgDir)) {
    const src = readFileSync(file, "utf8");

    // Named import / re-export: take the LOCAL name (left of `as`), which is what
    // is actually pulled from the module.
    const named = new RegExp(
      `(?:import|export)\\s*\\{([^}]*)\\}\\s*from\\s*['"]${mod}['"]`,
      "g"
    );
    for (const m of src.matchAll(named)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && name !== "type") found.add(name);
      }
    }

    // Namespace / default import, then property access.
    const ns = new RegExp(
      `(?:import\\s+(?:\\*\\s+as\\s+)?(\\w+)\\s+from|(?:var|const|let)\\s+(\\w+)\\s*=\\s*require\\()\\s*['"]?${mod}['"]?`,
      "g"
    );
    const binders = new Set();
    for (const m of src.matchAll(ns)) binders.add(m[1] || m[2]);
    for (const b of binders) {
      const use = new RegExp(`\\b${b}\\.(\\w+)`, "g");
      for (const m of src.matchAll(use)) {
        if (!["default", "__esModule"].includes(m[1])) found.add(m[1]);
      }
    }

    // Inline: require('libpg-query').foo
    const inline = new RegExp(`require\\(\\s*['"]${mod}['"]\\s*\\)\\.(\\w+)`, "g");
    for (const m of src.matchAll(inline)) found.add(m[1]);
  }
  return [...found].sort();
}

console.log(`Node: ${process.version}\n`);

// --- 1. The alias is actually in effect -------------------------------------
// Read from disk rather than `require(TARGET/package.json)`: that subpath is
// itself under test below, and this check must not depend on it.
const targetDir = join(process.cwd(), "node_modules", TARGET);
const resolved = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8"));
if (resolved.name === "@ashbyhq/libpg-query-native") {
  ok("alias in effect", `${TARGET} -> ${resolved.name}@${resolved.version}`);
} else {
  fail("alias in effect", `${TARGET} resolved to ${resolved.name}, not our package`);
  process.exit(1);
}

// Upstream libpg-query ships no `exports` field, so every subpath is importable
// there. Ours restricts to `.`, which is a deliberate narrowing — but tooling
// commonly reads package.json, so that subpath must stay reachable.
try {
  require(`${TARGET}/package.json`);
  ok("package.json subpath importable");
} catch (e) {
  fail("package.json subpath importable", `${e.code} — add "./package.json" to the exports map`);
}

// --- 2. The contract pgsql-parser actually requires --------------------------
const parserDir = dirname(require.resolve("pgsql-parser/package.json"));
const parserVersion = require("pgsql-parser/package.json").version;
const required = findConsumedSymbols(parserDir, TARGET);

if (required.length === 0) {
  fail("derive contract", `found no ${TARGET} usage in pgsql-parser@${parserVersion} — scanner may be stale`);
} else {
  ok("derive contract", `pgsql-parser@${parserVersion} uses: ${required.join(", ")}`);
}

const ours = await import(TARGET);
const missing = required.filter((s) => typeof ours[s] === "undefined");
if (missing.length === 0) {
  ok("contract satisfied", `all ${required.length} symbol(s) implemented`);
} else {
  fail(
    "contract satisfied",
    `pgsql-parser needs ${missing.join(", ")} — not exported by @ashbyhq/libpg-query-native.\n` +
      `       Implement them in native/src/index.ts.`
  );
}

// --- 3. It genuinely works through pgsql-parser ------------------------------
const { loadModule, parse, parseSync, deparse } = await import("pgsql-parser");
const SQL = "SELECT id, name FROM users WHERE age > 21 ORDER BY name";

await loadModule(); // upstream's WASM build requires this before parseSync
const sync = parseSync(SQL);
sync?.stmts?.[0]?.stmt?.SelectStmt
  ? ok("parseSync via pgsql-parser", `${sync.stmts[0].stmt.SelectStmt.targetList.length} targets`)
  : fail("parseSync via pgsql-parser", "no SelectStmt in result");

const async_ = await parse(SQL);
JSON.stringify(async_) === JSON.stringify(sync)
  ? ok("parse matches parseSync")
  : fail("parse matches parseSync", "async and sync results differ");

// The PG major is a property of the C library, so this pins which parser is live.
String(sync.version).startsWith("18")
  ? ok("parser is PG 18", `version ${sync.version}`)
  : fail("parser is PG 18", `version ${sync.version}`);

const round = await deparse(sync);
round.replace(/\s+/g, " ").toLowerCase().includes("from users")
  ? ok("deparse round-trip")
  : fail("deparse round-trip", `got: ${round.slice(0, 60)}`);

try {
  parseSync("SELECT FROM WHERE ;;");
  fail("errors propagate", "expected a throw");
} catch (e) {
  e?.message ? ok("errors propagate", e.constructor.name) : fail("errors propagate", "empty error");
}

console.log(failures === 0 ? "\nConsumer contract holds." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
