/**
 * Consumer contract test.
 *
 * Mirrors how this package is actually consumed downstream. Consumers alias the
 * `libpg-query` dependency key straight to us:
 *
 *   "libpg-query": "npm:@ashbyhq/libpg-query-native@<version>"
 *
 * and then import from it directly — NOT through `pgsql-parser`, which sits in
 * front of upstream's WASM build and is not in this path at all. The AST we
 * return is then handed to `pgsql-deparser` to render back to SQL.
 *
 *   import { parseSync } from "libpg-query";
 *   import { deparseSync } from "pgsql-deparser";
 *
 * So there are two distinct things to protect, and only one of them is about us:
 *
 *   1. The symbol contract — the exports consumers import by name. Small today
 *      (`parseSync`), and breaking it is squarely our fault.
 *   2. The AST contract — whether the tree we emit is one `pgsql-deparser` can
 *      still render. This is the load-bearing one and it is invisible to
 *      TypeScript: `ParseResult` is identical across @pgsql/types majors, so a
 *      PG-major bump on our side can only ever fail here at runtime.
 *
 * Run from a scratch project with `libpg-query` aliased to this package:
 *   node consumer-contract.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TARGET = "libpg-query";

// Imported by name in consumer code. Adding to this list is fine; removing from
// it is a breaking change for anyone doing `import { x } from "libpg-query"`.
const REQUIRED_SYMBOLS = ["parseSync"];

// Our full documented surface. Guards against silently narrowing the API — a
// removal here breaks consumers even though nothing in this repo would notice.
const PUBLIC_SURFACE = [
  "parse", "parseSync",
  "parsePlPgSQL", "parsePlPgSQLSync",
  "fingerprint", "fingerprintSync",
  "normalize", "normalizeSync",
  "scan", "scanSync",
  "loadModule", "SqlError", "hasSqlDetails",
];

// SQL shaped like the real call sites: migrations (DDL), index definitions, and
// filter predicates. Each must survive parse -> deparse -> parse unchanged.
const ROUND_TRIP_SQL = [
  "SELECT id, name FROM users WHERE age > 21 ORDER BY name",
  "CREATE TABLE foo (id uuid PRIMARY KEY, org_id uuid NOT NULL, created_at timestamptz DEFAULT now())",
  "CREATE UNIQUE INDEX CONCURRENTLY foo_org_id_id_uniq_idx ON foo (org_id, id) WHERE org_id IS NOT NULL",
  "ALTER TABLE foo ADD COLUMN bar text NOT NULL DEFAULT ''",
  "ALTER TABLE foo DROP CONSTRAINT IF EXISTS foo_pkey",
  "SELECT a.id FROM foo a LEFT JOIN bar b ON a.id = b.foo_id WHERE b.x IS NOT DISTINCT FROM 1",
  "CREATE INDEX foo_created_idx ON foo USING btree (created_at DESC NULLS LAST)",
];

let failures = 0;
const ok = (name, extra = "") => console.log(`  ok  ${name}${extra ? " — " + extra : ""}`);
const fail = (name, why) => {
  failures++;
  console.log(`  FAIL ${name}\n       ${why}`);
};

console.log(`Node: ${process.version}\n`);

// --- 1. The alias is in effect ----------------------------------------------
// Read from disk rather than require(TARGET/package.json): that subpath is
// itself under test below, so this check must not depend on it.
const targetDir = join(process.cwd(), "node_modules", TARGET);
const resolved = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8"));
if (resolved.name === "@ashbyhq/libpg-query-native") {
  ok("alias in effect", `${TARGET} -> ${resolved.name}@${resolved.version}`);
} else {
  fail("alias in effect", `${TARGET} resolved to ${resolved.name}, not our package`);
  process.exit(1);
}

// Upstream's libpg-query ships no `exports` field, so every subpath is
// importable there. Ours restricts to `.`, a deliberate narrowing — but tooling
// routinely reads package.json, so that subpath must stay reachable.
try {
  require(`${TARGET}/package.json`);
  ok("package.json subpath importable");
} catch (e) {
  fail("package.json subpath importable", `${e.code} — add "./package.json" to the exports map`);
}

// --- 2. Symbol contract ------------------------------------------------------
const ours = await import(TARGET);

const missingRequired = REQUIRED_SYMBOLS.filter((s) => typeof ours[s] === "undefined");
missingRequired.length === 0
  ? ok("required symbols present", REQUIRED_SYMBOLS.join(", "))
  : fail("required symbols present", `consumers import ${missingRequired.join(", ")} — not exported`);

const missingSurface = PUBLIC_SURFACE.filter((s) => typeof ours[s] === "undefined");
missingSurface.length === 0
  ? ok("public surface intact", `${PUBLIC_SURFACE.length} exports`)
  : fail("public surface intact", `no longer exported: ${missingSurface.join(", ")}`);

// --- 3. parseSync behaves ----------------------------------------------------
const { parseSync } = ours;
const sample = parseSync("SELECT id FROM users WHERE org_id = $1");

sample?.stmts?.[0]?.stmt?.SelectStmt
  ? ok("parseSync returns a ParseResult")
  : fail("parseSync returns a ParseResult", "no SelectStmt in stmts[0].stmt");

// The PG major is a property of the C library, so this pins which parser is live
// and makes an accidental major bump loud rather than silent.
String(sample?.version).startsWith("18")
  ? ok("parser is PG 18", `version ${sample.version}`)
  : fail("parser is PG 18", `version ${sample?.version}`);

try {
  parseSync("SELECT FROM WHERE ;;");
  fail("errors propagate", "expected a throw");
} catch (e) {
  e?.message && e.constructor?.name === "SqlError"
    ? ok("errors propagate", "SqlError")
    : fail("errors propagate", `got ${e?.constructor?.name}: ${e?.message}`);
}

// --- 4. AST contract: our tree must still render through pgsql-deparser ------
// The real integration risk, and the one types cannot express.
let deparseSync;
try {
  ({ deparseSync } = await import("pgsql-deparser"));
  const dv = require("pgsql-deparser/package.json").version;
  ok("pgsql-deparser loaded", `v${dv}`);
} catch (e) {
  fail("pgsql-deparser loaded", e.message);
}

// Byte offsets into the source text. The deparser pretty-prints, so these
// necessarily shift on re-parse and say nothing about structural equivalence.
const POSITION_KEYS = new Set(["location", "stmt_len", "stmt_location"]);

function stripPositions(node) {
  if (Array.isArray(node)) return node.map(stripPositions);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !POSITION_KEYS.has(k))
        .map(([k, v]) => [k, stripPositions(v)])
    );
  }
  return node;
}

if (deparseSync) {
  const broken = [];
  for (const sql of ROUND_TRIP_SQL) {
    try {
      const first = parseSync(sql);
      const rendered = deparseSync(first);
      // Compare ASTs, not strings: the deparser legitimately normalises casing,
      // quoting and whitespace, so only structural equivalence is meaningful.
      const second = parseSync(rendered);
      const a = JSON.stringify(stripPositions(first.stmts));
      const b = JSON.stringify(stripPositions(second.stmts));
      if (a !== b) {
        broken.push(`${sql}\n         rendered: ${rendered.replace(/\s+/g, " ").trim()}`);
      }
    } catch (e) {
      broken.push(`${sql}\n         ${e.constructor?.name}: ${e.message}`);
    }
  }
  broken.length === 0
    ? ok("AST round-trips through pgsql-deparser", `${ROUND_TRIP_SQL.length} statements`)
    : fail(
        "AST round-trips through pgsql-deparser",
        `${broken.length}/${ROUND_TRIP_SQL.length} failed:\n       - ${broken.join("\n       - ")}`
      );
}

// --- 5. Known PG18-vs-deparser divergences (reported, not failed) -----------
// Our parser is PG 18; pgsql-deparser is still on its 17 line. Constructs added
// in PG 18 parse correctly here and are then silently dropped or rewritten on
// the way back out — no error is raised by either side.
//
// This is not a defect in this package and cannot be fixed here, so it warns
// rather than fails. It matters because consumers round-trip migration SQL
// through parse -> deparse: anything listed below must be kept out of migrations
// until pgsql-deparser moves to an 18.x line.
const PG18_ONLY = [
  ["WITHOUT OVERLAPS", "CREATE TABLE t (id int, valid_at daterange, PRIMARY KEY (id, valid_at WITHOUT OVERLAPS))"],
  ["RETURNING OLD/NEW", "UPDATE t SET x = 1 RETURNING OLD.x, NEW.x"],
  ["VIRTUAL generated column", "CREATE TABLE t (a int, b int GENERATED ALWAYS AS (a * 2) VIRTUAL)"],
];

if (deparseSync) {
  const lossy = [];
  for (const [label, sql] of PG18_ONLY) {
    try {
      const first = parseSync(sql);
      const second = parseSync(deparseSync(first));
      if (JSON.stringify(stripPositions(first.stmts)) !== JSON.stringify(stripPositions(second.stmts))) {
        lossy.push(label);
      }
    } catch {
      lossy.push(`${label} (threw)`);
    }
  }
  if (lossy.length) {
    console.log(
      `\n  warn  ${lossy.length} PG18 construct(s) do not survive pgsql-deparser: ${lossy.join(", ")}` +
        `\n        Expected while the deparser is on 17.x. Keep these out of migration SQL.`
    );
  } else {
    console.log("\n  note  all tracked PG18 constructs now survive the deparser — it may have caught up.");
  }
}

console.log(failures === 0 ? "\nConsumer contract holds." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
