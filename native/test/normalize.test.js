const query = require("../dist/index.js");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("Query Normalization", () => {
  describe("Sync Normalization", () => {
    it("should normalize a simple query", () => {
      const normalized = query.normalizeSync("select 1");
      assert.equal(typeof normalized, "string");
      assert.ok(normalized.includes("$1"));
    });

    it("should normalize parameter values", () => {
      const n1 = query.normalizeSync("select * from users where id = 123");
      const n2 = query.normalizeSync("select * from users where id = 456");
      assert.equal(n1, n2);
      assert.ok(n1.includes("$1"));
    });

    it("should normalize string literals", () => {
      const n1 = query.normalizeSync("select * from users where name = 'john'");
      const n2 = query.normalizeSync("select * from users where name = 'jane'");
      assert.equal(n1, n2);
      assert.ok(n1.includes("$1"));
    });

    it("should preserve query structure", () => {
      const normalized = query.normalizeSync(
        "SELECT id, name FROM users WHERE active = true ORDER BY name"
      );
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
      const normalized = await query.normalize(testQuery);
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
