const query = require("../");
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe("Query Normalization", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  describe("Sync Normalization", () => {
    it("should normalize a simple query", () => {
      const normalized = query.normalizeSync("select 1");
      assert.equal(typeof normalized, "string");
      assert.ok(normalized.includes("$1"));
    });

    it("should normalize parameter values", () => {
      const normalized1 = query.normalizeSync("select * from users where id = 123");
      const normalized2 = query.normalizeSync("select * from users where id = 456");
      
      assert.equal(normalized1, normalized2);
      assert.ok(normalized1.includes("$1"));
    });

    it("should normalize string literals", () => {
      const normalized1 = query.normalizeSync("select * from users where name = 'john'");
      const normalized2 = query.normalizeSync("select * from users where name = 'jane'");
      
      assert.equal(normalized1, normalized2);
      assert.ok(normalized1.includes("$1"));
    });

    it("should preserve query structure", () => {
      const normalized = query.normalizeSync("SELECT id, name FROM users WHERE active = true ORDER BY name");
      
      assert.ok(normalized.includes("SELECT"));
      assert.ok(normalized.includes("FROM"));
      assert.ok(normalized.includes("WHERE"));
      assert.ok(normalized.includes("ORDER BY"));
    });

    it("should fail on invalid queries", () => {
      assert.throws(() => query.normalizeSync("NOT A QUERY"), Error);
    });
  });

  describe("Async Normalization", () => {
    it("should return a promise resolving to same result", async () => {
      const testQuery = "select * from users where id = 123";
      const normalizedPromise = query.normalize(testQuery);
      const normalized = await normalizedPromise;

      assert.ok(normalizedPromise instanceof Promise);
      assert.equal(normalized, query.normalizeSync(testQuery));
    });

    it("should reject on bogus queries", async () => {
      return query.normalize("NOT A QUERY").then(
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

describe("normalize errors", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  // Errors raised outside the grammar's "syntax error" path used to come back
  // as the normalize result instead of being thrown.
  const failing = [
    ["select percentile_cont(p order by p) within group (order by x) from t", "cannot use multiple ORDER BY clauses with WITHIN GROUP"],
    ["CREATE TABLE p (a int) PARTITION BY MAGIC (a)", 'unrecognized partitioning strategy "magic"'],
  ];

  for (const [sql, message] of failing) {
    it(`normalizeSync throws SqlError for ${sql}`, () => {
      assert.throws(() => query.normalizeSync(sql), (err) => {
        assert.equal(err.name, "SqlError");
        assert.equal(err.message, message);
        assert.equal(typeof err.sqlDetails.cursorPosition, "number");
        return true;
      });
    });

    it(`normalize rejects with SqlError for ${sql}`, async () => {
      await assert.rejects(query.normalize(sql), (err) => {
        assert.equal(err.name, "SqlError");
        assert.equal(err.message, message);
        return true;
      });
    });
  }
});
