const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const {
  parse, parseSync, parsePlPgSQL, scan, scanSync, loadModule, SqlError,
  fingerprint, fingerprintSync, normalize, normalizeSync
} = require("../");

describe("PostgreSQL 18 syntax", () => {
  before(async () => {
    await loadModule();
  });

  it("should report parser version 180006", async () => {
    const result = await parse("SELECT 1");
    assert.equal(result.version, 180006);
  });

  it("should parse RETURNING OLD/NEW aliases", async () => {
    const result = await parse(
      "UPDATE t SET a = 1 RETURNING OLD.a AS oa, NEW.a AS na"
    );
    const stmt = result.stmts[0].stmt.UpdateStmt;
    const targets = stmt.returningClause.exprs.map(
      (rt) => rt.ResTarget.name
    );
    assert.deepEqual(targets, ["oa", "na"]);
  });

  it("should parse VIRTUAL generated columns", () => {
    const result = parseSync(
      "CREATE TABLE tt (a int, b int GENERATED ALWAYS AS (a * 2) VIRTUAL)"
    );
    const columns = result.stmts[0].stmt.CreateStmt.tableElts;
    const generated = columns[1].ColumnDef.constraints.find(
      (c) => c.Constraint.contype === "CONSTR_GENERATED"
    );
    assert.ok(generated);
    assert.equal(generated.Constraint.generated_kind, "v");
  });

  it("should parse ALTER CONSTRAINT ... NOT ENFORCED", async () => {
    const result = await parse(
      "ALTER TABLE t ALTER CONSTRAINT c NOT ENFORCED"
    );
    const cmd = result.stmts[0].stmt.AlterTableStmt.cmds[0].AlterTableCmd;
    assert.equal(cmd.subtype, "AT_AlterConstraint");
    assert.equal(cmd.def.ATAlterConstraint.conname, "c");
    assert.equal(cmd.def.ATAlterConstraint.alterEnforceability, true);
  });

  it("should parse PL/pgSQL on the 18 build", async () => {
    const result = await parsePlPgSQL(`
      CREATE FUNCTION f() RETURNS int AS $$
      BEGIN
        RETURN 1;
      END;
      $$ LANGUAGE plpgsql;
    `);
    assert.ok(Array.isArray(result.plpgsql_funcs));
    assert.equal(result.plpgsql_funcs.length, 1);
  });

  it("should scan PG18-specific SQL", async () => {
    const result = await scan(
      "UPDATE t SET a = 1 RETURNING OLD.a AS oa, NEW.a AS na"
    );
    assert.equal(result.version, 180006);
    const texts = result.tokens.map((t) => t.text);
    assert.ok(texts.includes("OLD"));
    assert.ok(texts.includes("NEW"));
  });
});

describe("PostgreSQL 18 structured SQL errors", () => {
  before(async () => {
    await loadModule();
  });

  const lexerError = {
    sql: "SELECT 'abc",
    message: /unterminated quoted string/,
    fileName: /scan\.l$/,
    cursorPosition: 7
  };
  const grammarError = {
    sql: "SELECT percentile_cont(p ORDER BY p) WITHIN GROUP (ORDER BY x) FROM t",
    message: /cannot use multiple ORDER BY clauses with WITHIN GROUP/,
    fileName: /gram\.y$/
  };

  for (const [run, runSync, cases] of [
    [fingerprint, fingerprintSync, [lexerError, grammarError]],
    [normalize, normalizeSync, [lexerError, grammarError]],
    [scan, scanSync, [lexerError]]
  ]) {
    it(`${runSync.name} throws and its async counterpart rejects with SqlError`, async () => {
      for (const { sql, message, fileName, cursorPosition } of cases) {
        const checkError = (error) => {
          assert.ok(error instanceof SqlError);
          assert.match(error.message, message);
          const details = error.sqlDetails;
          assert.equal(details.message, error.message);
          assert.match(details.fileName, fileName);
          assert.ok(details.functionName);
          assert.ok(details.lineNumber > 0);
          if (cursorPosition !== undefined) {
            assert.equal(details.cursorPosition, cursorPosition);
          }
          return true;
        };
        assert.throws(() => runSync(sql), checkError);
        await assert.rejects(run(sql), checkError);
      }
    });
  }
});
