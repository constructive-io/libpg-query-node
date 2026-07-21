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
