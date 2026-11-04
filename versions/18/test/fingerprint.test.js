const query = require("../");
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe("Query Fingerprinting", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  describe("Sync Fingerprinting", () => {
    it("should return a fingerprint for a simple query", () => {
      const fingerprint = query.fingerprintSync("select 1");
      assert.equal(typeof fingerprint, "string");
      assert.equal(fingerprint.length, 16);
    });

    it("should return same fingerprint for equivalent queries", () => {
      const fp1 = query.fingerprintSync("select 1");
      const fp2 = query.fingerprintSync("SELECT 1");
      const fp3 = query.fingerprintSync("select   1");
      
      assert.equal(fp1, fp2);
      assert.equal(fp1, fp3);
    });

    it("should return different fingerprints for different queries", () => {
      const fp1 = query.fingerprintSync("select name from users");
      const fp2 = query.fingerprintSync("select id from customers");
      
      assert.notEqual(fp1, fp2);
    });

    it("should normalize parameter values", () => {
      const fp1 = query.fingerprintSync("select * from users where id = 123");
      const fp2 = query.fingerprintSync("select * from users where id = 456");
      
      assert.equal(fp1, fp2);
    });

    it("should fail on invalid queries", () => {
      assert.throws(() => query.fingerprintSync("NOT A QUERY"), Error);
    });
  });

  describe("Async Fingerprinting", () => {
    it("should return a promise resolving to same result", async () => {
      const testQuery = "select * from users";
      const fpPromise = query.fingerprint(testQuery);
      const fp = await fpPromise;

      assert.ok(fpPromise instanceof Promise);
      assert.equal(fp, query.fingerprintSync(testQuery));
    });

    it("should reject on bogus queries", async () => {
      return query.fingerprint("NOT A QUERY").then(
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

describe("fingerprint errors", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  // Errors raised outside the grammar's "syntax error" path used to come back
  // as the fingerprint result instead of being thrown.
  const failing = [
    ["select percentile_cont(p order by p) within group (order by x) from t", "cannot use multiple ORDER BY clauses with WITHIN GROUP"],
    ["CREATE TABLE p (a int) PARTITION BY MAGIC (a)", 'unrecognized partitioning strategy "magic"'],
    ["SELECT 'abc", "unterminated quoted string at or near \"'abc\""],
  ];

  it("throws SqlError for empty input", async () => {
    assert.throws(() => query.fingerprintSync(""), { name: "SqlError", message: /^Invalid input/ });
    await assert.rejects(query.fingerprint(""), { name: "SqlError", message: /^Invalid input/ });
  });

  for (const [sql, message] of failing) {
    it(`fingerprintSync throws SqlError for ${sql}`, () => {
      assert.throws(() => query.fingerprintSync(sql), (err) => {
        assert.equal(err.name, "SqlError");
        assert.equal(err.message, message);
        assert.equal(typeof err.sqlDetails.cursorPosition, "number");
        assert.equal(typeof err.sqlDetails.fileName, "string");
        assert.equal(typeof err.sqlDetails.functionName, "string");
        assert.ok(err.sqlDetails.lineNumber > 0);
        return true;
      });
    });

    it(`fingerprint rejects with SqlError for ${sql}`, async () => {
      await assert.rejects(query.fingerprint(sql), (err) => {
        assert.equal(err.name, "SqlError");
        assert.equal(err.message, message);
        return true;
      });
    });
  }
});
