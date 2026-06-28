/**
 * Smoke test for the packaged native addon.
 * Verifies that the platform package loads and all APIs work.
 *
 * Usage (from a temp directory with the packages installed):
 *   node smoke.mjs
 *
 * Or from the native/ directory with prebuilds in place:
 *   node test/smoke.mjs
 */

import { createRequire } from "module";

const require = createRequire(import.meta.url);

let exitCode = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    exitCode = 1;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL  ${name}: ${e.message}`);
    exitCode = 1;
  }
}

const lib = require("@ashbyhq/libpg-query-native");

console.log(`Platform: ${process.platform}-${process.arch}`);
console.log(`Node: ${process.version}`);
console.log("");

test("parseSync returns parse tree", () => {
  const result = lib.parseSync("SELECT 1");
  assert(result.version > 0, "version should be positive");
  assert(result.stmts.length === 1, "should have 1 statement");
  assert(result.stmts[0].stmt.SelectStmt, "should have SelectStmt");
});

test("parse (async) works", async () => {
  const result = await lib.parse("SELECT 1");
  assert(result.stmts.length === 1, "should have 1 statement");
});

test("fingerprintSync returns hex string", () => {
  const fp = lib.fingerprintSync("SELECT 1");
  assert(typeof fp === "string", "should be string");
  assert(fp.length === 16, "should be 16 chars");
  assert(/^[0-9a-f]+$/.test(fp), "should be hex");
});

test("normalizeSync replaces constants", () => {
  const result = lib.normalizeSync("SELECT 1, 'hello'");
  assert(result.includes("$1"), "should have $1");
  assert(!result.includes("hello"), "should not have literal");
});

test("scanSync returns tokens", () => {
  const result = lib.scanSync("SELECT id FROM users");
  assert(result.tokens.length > 0, "should have tokens");
  assert(result.tokens[0].text === "SELECT", "first token should be SELECT");
});

test("parsePlPgSQLSync works", () => {
  const result = lib.parsePlPgSQLSync(
    "CREATE FUNCTION test() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql"
  );
  assert(result.plpgsql_funcs, "should have plpgsql_funcs");
});

test("parseSync throws SqlError on bad SQL", () => {
  try {
    lib.parseSync("SELECTT");
    assert(false, "should have thrown");
  } catch (e) {
    assert(e.name === "SqlError", `error name should be SqlError, got ${e.name}`);
    assert(e.sqlDetails, "should have sqlDetails");
    assert(typeof e.sqlDetails.message === "string", "should have message");
  }
});

test("loadModule is a no-op", async () => {
  await lib.loadModule();
});

console.log("");
if (exitCode === 0) {
  console.log("All smoke tests passed.");
} else {
  console.error("Some smoke tests failed.");
}
process.exit(exitCode);
