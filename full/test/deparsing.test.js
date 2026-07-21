const query = require("../");
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe("Query Deparsing", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  describe("Sync Deparsing", () => {
    it("should deparse a simple query", () => {
      const sql = 'SELECT * FROM users';
      const parseTree = query.parseSync(sql);
      const deparsed = query.deparseSync(parseTree);
      assert.equal(deparsed, sql);
    });

    it("should deparse a complex query", () => {
      const sql = 'SELECT a, b, c FROM t1 JOIN t2 ON t1.id = t2.id WHERE t1.x > 10';
      const parseTree = query.parseSync(sql);
      const deparsed = query.deparseSync(parseTree);
      assert.equal(deparsed, sql);
    });

    it("should fail to deparse without protobuf data", () => {
      assert.throws(() => query.deparseSync({}), /No parseTree provided/);
    });
  });

  describe("Async Deparsing", () => {
    it("should return a promise resolving to same result", async () => {
      const sql = 'SELECT * FROM users';
      const parseTree = await query.parse(sql);
      const deparsed = await query.deparse(parseTree);
      assert.equal(deparsed, sql);
    });

    it("should reject when no protobuf data", async () => {
      try {
        await query.deparse({});
        throw new Error('should have rejected');
      } catch (err) {
        assert.equal(err.message, 'No parseTree provided');
      }
    });
  });

  describe("Round-trip parsing and deparsing", () => {
    it("should maintain query semantics through round-trip", async () => {
      const sql = 'SELECT a, b, c FROM t1 JOIN t2 ON t1.id = t2.id WHERE t1.x > 10';
      const parseTree = await query.parse(sql);
      const deparsed = await query.deparse(parseTree);
      assert.equal(deparsed, sql);
    });
  });

  it('should deparse a parse tree', async () => {
    const sql = 'SELECT * FROM users';
    const parseTree = await query.parse(sql);
    const deparsed = await query.deparse(parseTree);
    assert.equal(deparsed, sql);
  });

  it('should throw on invalid parse tree', () => {
    try {
      query.deparseSync({});
    } catch (err) { }
    assert.throws(() => query.deparseSync({}), /No parseTree provided/);
  });
});
