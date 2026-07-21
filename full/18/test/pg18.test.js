const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const { parse, parseSync, parsePlPgSQL, scan, loadModule } = require("../");

describe("PostgreSQL 18 syntax", () => {
  before(async () => {
    await loadModule();
  });

  it("should report parser version 180004", async () => {
    const result = await parse("SELECT 1");
    assert.equal(result.version, 180004);
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
    assert.equal(result.version, 180004);
    const texts = result.tokens.map((t) => t.text);
    assert.ok(texts.includes("OLD"));
    assert.ok(texts.includes("NEW"));
  });
});
