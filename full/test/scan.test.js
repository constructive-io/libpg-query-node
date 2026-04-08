const query = require("../");
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe("Query Scanning", () => {
  before(async () => {
    await query.parse("SELECT 1");
  });

  describe("Sync Scanning", () => {
    it("should return a scan result with version and tokens", () => {
      const result = query.scanSync("SELECT 1");
      
      assert.equal(typeof result, "object");
      assert.ok("version" in result);
      assert.ok("tokens" in result);
      assert.equal(typeof result.version, "number");
      assert.ok(Array.isArray(result.tokens));
    });

    it("should scan a simple SELECT query correctly", () => {
      const result = query.scanSync("SELECT 1");
      
      assert.equal(result.tokens.length, 2);
      
      // First token should be SELECT
      const selectToken = result.tokens[0];
      assert.equal(selectToken.text, "SELECT");
      assert.equal(selectToken.start, 0);
      assert.equal(selectToken.end, 6);
      assert.equal(selectToken.tokenName, "UNKNOWN"); // SELECT is mapped as UNKNOWN in our simplified mapping
      assert.equal(selectToken.keywordName, "RESERVED_KEYWORD");
      
      // Second token should be 1
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
      
      // Verify each token position matches the original SQL
      result.tokens.forEach(token => {
        const actualText = sql.substring(token.start, token.end);
        assert.equal(token.text, actualText);
      });
    });

    it("should identify different token types", () => {
      const result = query.scanSync("SELECT 'string', 123, 3.14, $1 FROM users");
      
      const tokenTypes = result.tokens.map(t => t.tokenName);
      assert.ok(tokenTypes.includes("SCONST"));  // String constant
      assert.ok(tokenTypes.includes("ICONST"));  // Integer constant  
      assert.ok(tokenTypes.includes("FCONST"));  // Float constant
      assert.ok(tokenTypes.includes("PARAM"));   // Parameter marker
      // Note: keywords like FROM may be tokenized as UNKNOWN in our simplified mapping
      assert.ok(tokenTypes.includes("UNKNOWN")); // Keywords and identifiers
    });

    it("should identify operators and punctuation", () => {
      const result = query.scanSync("SELECT * FROM users WHERE id = 1");
      
      const operators = result.tokens.filter(t => 
        t.tokenName.startsWith("ASCII_") || t.text === "="
      );
      
      assert.ok(operators.length > 0);
      assert.equal(operators.some(t => t.text === "*"), true);
      assert.equal(operators.some(t => t.text === "="), true);
    });

    it("should classify keyword types correctly", () => {
      const result = query.scanSync("SELECT COUNT(*) FROM users WHERE active = true");
      
      const reservedKeywords = result.tokens.filter(t => 
        t.keywordName === "RESERVED_KEYWORD"
      );
      const unreservedKeywords = result.tokens.filter(t => 
        t.keywordName === "UNRESERVED_KEYWORD"
      );
      
      assert.ok(reservedKeywords.length > 0);
      // SELECT, FROM, WHERE should be reserved keywords
      assert.equal(reservedKeywords.some(t => t.text === "SELECT"), true);
      assert.equal(reservedKeywords.some(t => t.text === "FROM"), true);
      assert.equal(reservedKeywords.some(t => t.text === "WHERE"), true);
    });

    it("should handle complex queries with parameters", () => {
      const result = query.scanSync("SELECT * FROM users WHERE id = $1 AND name = $2");
      
      const params = result.tokens.filter(t => t.tokenName === "PARAM");
      assert.equal(params.length, 2);
      assert.equal(params[0].text, "$1");
      assert.equal(params[1].text, "$2");
    });

    it("should handle string escaping in JSON output", () => {
      const result = query.scanSync("SELECT 'text with \"quotes\" and \\backslash'");
      
      const stringToken = result.tokens.find(t => t.tokenName === "SCONST");
      assert.ok(stringToken);
      assert.ok(stringToken.text.includes('"'));
      assert.ok(stringToken.text.includes('\\'));
    });

    it("should scan INSERT statements", () => {
      const result = query.scanSync("INSERT INTO table VALUES (1, 'text', 3.14)");
      
      assert.equal(result.tokens.some(t => t.text === "INSERT"), true);
      assert.equal(result.tokens.some(t => t.text === "INTO"), true);
      assert.equal(result.tokens.some(t => t.text === "VALUES"), true);
      assert.equal(result.tokens.some(t => t.tokenName === "ICONST"), true);
      assert.equal(result.tokens.some(t => t.tokenName === "SCONST"), true);
      assert.equal(result.tokens.some(t => t.tokenName === "FCONST"), true);
    });

    it("should scan UPDATE statements", () => {
      const result = query.scanSync("UPDATE users SET name = 'John' WHERE id = 1");
      
      assert.equal(result.tokens.some(t => t.text === "UPDATE"), true);
      assert.equal(result.tokens.some(t => t.text === "SET"), true);
      assert.equal(result.tokens.some(t => t.text === "="), true);
    });

    it("should scan DELETE statements", () => {
      const result = query.scanSync("DELETE FROM users WHERE active = false");
      
      assert.equal(result.tokens.some(t => t.text === "DELETE"), true);
      assert.equal(result.tokens.some(t => t.text === "FROM"), true);
      assert.equal(result.tokens.some(t => t.text === "WHERE"), true);
    });

    it("should handle empty or whitespace-only input", () => {
      const result = query.scanSync("   ");
      assert.equal(result.tokens.length, 0);
    });

    it("should handle unusual input gracefully", () => {
      // The scanner is more permissive than the parser and may tokenize unusual input
      const result = query.scanSync("$$$INVALID$$$");
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.tokens));
      // Scanner may still produce tokens even for unusual input
    });

    it("should preserve original token order", () => {
      const sql = "SELECT id, name FROM users ORDER BY name";
      const result = query.scanSync(sql);
      
      // Tokens should be in order of appearance
      for (let i = 1; i < result.tokens.length; i++) {
        assert.ok(result.tokens[i].start >= result.tokens[i-1].end);
      }
    });
  });

  describe("Async Scanning", () => {
    it("should return a promise resolving to same result as sync", async () => {
      const testQuery = "SELECT * FROM users WHERE id = $1";
      const resultPromise = query.scan(testQuery);
      const result = await resultPromise;

      assert.ok(resultPromise instanceof Promise);
      assert.deepEqual(result, query.scanSync(testQuery));
    });

    it("should handle complex queries asynchronously", async () => {
      const testQuery = "SELECT COUNT(*) as total FROM orders WHERE status = 'completed' AND created_at > '2023-01-01'";
      const result = await query.scan(testQuery);
      
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.tokens));
      assert.ok(result.tokens.length > 10);
    });

    it("should handle unusual input asynchronously", async () => {
      // Scanner is more permissive than parser
      const result = await query.scan("$$$INVALID$$$");
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.tokens));
    });
  });

  describe("Edge Cases", () => {
    it("should handle queries with comments", () => {
      const result = query.scanSync("SELECT 1 -- this is a comment");
      
      // Should have at least SELECT and 1 tokens
      assert.ok(result.tokens.length >= 2);
      assert.equal(result.tokens.some(t => t.text === "SELECT"), true);
      assert.equal(result.tokens.some(t => t.text === "1"), true);
    });

    it("should handle very long identifiers", () => {
      const longIdentifier = "a".repeat(100);
      const result = query.scanSync(`SELECT ${longIdentifier} FROM table`);
      
      const identToken = result.tokens.find(t => t.text === longIdentifier);
      assert.ok(identToken);
      assert.equal(identToken.tokenName, "IDENT");
    });

    it("should handle special PostgreSQL operators", () => {
      const result = query.scanSync("SELECT id::text FROM users");
      
      assert.equal(result.tokens.some(t => t.text === "::"), true);
      const typecastToken = result.tokens.find(t => t.text === "::");
      assert.equal(typecastToken?.tokenName, "TYPECAST");
    });

    it("should provide consistent version information", () => {
      const result1 = query.scanSync("SELECT 1");
      const result2 = query.scanSync("INSERT INTO table VALUES (1)");
      
      assert.equal(result1.version, result2.version);
      assert.equal(typeof result1.version, "number");
      assert.ok(result1.version > 0);
    });

    it("should handle multi-line dollar-quoted strings without JSON errors", () => {
      // This tests that the JSON serialization properly escapes control
      // characters (newlines, tabs) inside token text fields.
      const sql = `CREATE FUNCTION test() RETURNS void AS $$
BEGIN
  RAISE NOTICE 'hello';
END;
$$ LANGUAGE plpgsql`;
      
      const result = query.scanSync(sql);
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.tokens));
      assert.ok(result.tokens.length > 0);
      
      // Find the dollar-quoted string token
      const dollarToken = result.tokens.find(t => t.text.includes('BEGIN'));
      assert.ok(dollarToken, "should have a token containing the function body");
      assert.ok(dollarToken.text.includes('\n'), "token text should contain newlines");
    });

    it("should handle multi-line tokens with tabs", () => {
      const sql = "SELECT $$line1\n\tindented\nline3$$";
      
      const result = query.scanSync(sql);
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.tokens));
      
      const dollarToken = result.tokens.find(t => t.text.includes('indented'));
      assert.ok(dollarToken, "should have a token containing the tabbed content");
    });

    it("should handle multi-line SQL comments", () => {
      const sql = "SELECT 1; /* multi\nline\ncomment */ SELECT 2";
      
      const result = query.scanSync(sql);
      assert.equal(typeof result, "object");
      assert.ok(Array.isArray(result.tokens));
      
      const commentToken = result.tokens.find(t => t.tokenName === "C_COMMENT");
      assert.ok(commentToken, "should have a C_COMMENT token");
      assert.ok(commentToken.text.includes('\n'), "comment text should contain newlines");
    });
  });
});
