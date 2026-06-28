const query = require("../dist/index.js");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("Query Scanning", () => {
  describe("Sync Scanning", () => {
    it("should return a scan result with version and tokens", () => {
      const result = query.scanSync("SELECT 1");
      assert.equal(typeof result, "object");
      assert.ok("version" in result);
      assert.ok("tokens" in result);
      assert.ok(Array.isArray(result.tokens));
    });

    it("should scan a simple SELECT query correctly", () => {
      const result = query.scanSync("SELECT 1");
      assert.equal(result.tokens.length, 2);

      const selectToken = result.tokens[0];
      assert.equal(selectToken.text, "SELECT");
      assert.equal(selectToken.start, 0);
      assert.equal(selectToken.end, 6);
      assert.equal(selectToken.keywordName, "RESERVED_KEYWORD");

      const numberToken = result.tokens[1];
      assert.equal(numberToken.text, "1");
      assert.equal(numberToken.start, 7);
      assert.equal(numberToken.end, 8);
      assert.equal(numberToken.tokenName, "ICONST");
      assert.equal(numberToken.keywordName, "NO_KEYWORD");
    });

    it("should scan tokens with correct positions", () => {
      const sql = "SELECT * FROM users";
      const result = query.scanSync(sql);
      assert.equal(result.tokens.length, 4);
      result.tokens.forEach((token) => {
        const actualText = sql.substring(token.start, token.end);
        assert.equal(token.text, actualText);
      });
    });

    it("should identify different token types", () => {
      const result = query.scanSync(
        "SELECT 'string', 123, 3.14, $1 FROM users"
      );
      const tokenTypes = result.tokens.map((t) => t.tokenName);
      assert.ok(tokenTypes.includes("SCONST"));
      assert.ok(tokenTypes.includes("ICONST"));
      assert.ok(tokenTypes.includes("FCONST"));
      assert.ok(tokenTypes.includes("PARAM"));
    });

    it("should handle complex queries with parameters", () => {
      const result = query.scanSync(
        "SELECT * FROM users WHERE id = $1 AND name = $2"
      );
      const params = result.tokens.filter((t) => t.tokenName === "PARAM");
      assert.equal(params.length, 2);
      assert.equal(params[0].text, "$1");
      assert.equal(params[1].text, "$2");
    });

    it("should handle special PostgreSQL operators", () => {
      const result = query.scanSync("SELECT id::text FROM users");
      const typecast = result.tokens.find((t) => t.text === "::");
      assert.ok(typecast);
      assert.equal(typecast.tokenName, "TYPECAST");
    });

    it("should preserve original token order", () => {
      const result = query.scanSync(
        "SELECT id, name FROM users ORDER BY name"
      );
      for (let i = 1; i < result.tokens.length; i++) {
        assert.ok(result.tokens[i].start >= result.tokens[i - 1].end);
      }
    });
  });

  describe("Async Scanning", () => {
    it("should return a promise resolving to same result as sync", async () => {
      const testQuery = "SELECT * FROM users WHERE id = $1";
      const result = await query.scan(testQuery);
      assert.deepEqual(result, query.scanSync(testQuery));
    });
  });
});
