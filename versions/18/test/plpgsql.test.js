const query = require("../");
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe("PL/pgSQL Parsing", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  describe("Sync PL/pgSQL Parsing", () => {
    it("should parse a simple PL/pgSQL function", () => {
      const funcSql = `
        CREATE OR REPLACE FUNCTION test_func()
        RETURNS INTEGER AS $$
        BEGIN
          RETURN 42;
        END;
        $$ LANGUAGE plpgsql;
      `;
      
      const result = query.parsePlPgSQLSync(funcSql);
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.plpgsql_funcs));
    });

    it("should parse function with parameters", () => {
      const funcSql = `
        CREATE OR REPLACE FUNCTION add_numbers(a INTEGER, b INTEGER)
        RETURNS INTEGER AS $$
        BEGIN
          RETURN a + b;
        END;
        $$ LANGUAGE plpgsql;
      `;
      
      const result = query.parsePlPgSQLSync(funcSql);
      assert.ok(result.plpgsql_funcs.length > 0);
    });

    it("should fail on invalid PL/pgSQL", () => {
      assert.throws(() => query.parsePlPgSQLSync("NOT A FUNCTION"), Error);
    });
  });

  describe("Async PL/pgSQL Parsing", () => {
    it("should return a promise resolving to same result", async () => {
      const funcSql = `
        CREATE OR REPLACE FUNCTION test_func()
        RETURNS INTEGER AS $$
        BEGIN
          RETURN 42;
        END;
        $$ LANGUAGE plpgsql;
      `;
      
      const resultPromise = query.parsePlPgSQL(funcSql);
      const result = await resultPromise;

      assert.ok(resultPromise instanceof Promise);
      assert.deepEqual(result, query.parsePlPgSQLSync(funcSql));
    });

    it("should reject on invalid PL/pgSQL", async () => {
      return query.parsePlPgSQL("NOT A FUNCTION").then(
        () => {
          throw new Error("should have rejected");
        },
        (e) => {
          assert.ok(e instanceof Error);
          assert.match(e.message, /NOT/);
        }
      );
    });
  });
});
