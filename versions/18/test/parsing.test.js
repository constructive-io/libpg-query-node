const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const query = require("../");

function removeLocationProperties(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => removeLocationProperties(item));
  }
  
  const result = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (key === 'location' || key === 'stmt_len' || key === 'stmt_location') {
        continue; // Skip location-related properties
      }
      result[key] = removeLocationProperties(obj[key]);
    }
  }
  return result;
}

describe("Query Parsing", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  describe("Sync Parsing", () => {
    it("should return a single-item parse result for common queries", () => {
      const queries = ["select 1", "select null", "select ''", "select a, b"];
      const results = queries.map(query.parseSync);
      results.forEach((res) => {
        assert.equal(res.stmts.length, 1);
      });

      const selectedDatas = results.map(
        (it) => it.stmts[0].stmt.SelectStmt.targetList
      );

      assert.equal(selectedDatas[0][0].ResTarget.val.A_Const.ival.ival, 1);
      assert.equal(selectedDatas[1][0].ResTarget.val.A_Const.isnull, true);
      assert.equal(selectedDatas[2][0].ResTarget.val.A_Const.sval.sval, "");
      assert.equal(selectedDatas[3].length, 2);
    });

    it("should support parsing multiple queries", () => {
      const res = query.parseSync("select 1; select null;");
      assert.deepEqual(
        res.stmts.map(removeLocationProperties),
        [
          ...query.parseSync("select 1;").stmts.map(removeLocationProperties),
          ...query.parseSync("select null;").stmts.map(removeLocationProperties),
        ]
      );
    });

    it("should not parse a bogus query", () => {
      assert.throws(
        () => query.parseSync("NOT A QUERY"),
        Error
      );
    });
  });

  describe("Async parsing", () => {
    it("should return a promise resolving to same result", async () => {
      const testQuery = "select * from john;";
      const resPromise = query.parse(testQuery);
      const res = await resPromise;

      assert.ok(resPromise instanceof Promise);
      assert.deepEqual(res, query.parseSync(testQuery));
    });

    it("should reject on bogus queries", async () => {
      await assert.rejects(
        query.parse("NOT A QUERY"),
        (err) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /NOT/);
          return true;
        }
      );
    });
  });
});
