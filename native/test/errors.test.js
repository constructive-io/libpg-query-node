const { parseSync, hasSqlDetails } = require("../dist/index.js");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("Error Handling", () => {
  describe("Error Details Structure", () => {
    it("should include sqlDetails property on parse errors", () => {
      try {
        parseSync("SELECT * FROM users WHERE id = @");
        assert.fail("Expected error");
      } catch (error) {
        assert.ok("sqlDetails" in error);
        assert.ok("message" in error.sqlDetails);
        assert.ok("cursorPosition" in error.sqlDetails);
      }
    });

    it("should have correct cursor position (0-based)", () => {
      try {
        parseSync("SELECT * FROM users WHERE id = @");
        assert.fail("Expected error");
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 32);
      }
    });

    it("should identify error source file", () => {
      try {
        parseSync("SELECT * FROM users WHERE id = @");
        assert.fail("Expected error");
      } catch (error) {
        assert.equal(error.sqlDetails.fileName, "scan.l");
        assert.equal(error.sqlDetails.functionName, "scanner_yyerror");
      }
    });
  });

  describe("Error Position Accuracy", () => {
    const positionTests = [
      { query: "@ SELECT * FROM users", expectedPos: 0, desc: "error at start" },
      { query: "SELECT @ FROM users", expectedPos: 9, desc: "error after SELECT" },
      { query: "SELECT * FROM users WHERE id = @", expectedPos: 32, desc: "error at end" },
    ];

    positionTests.forEach(({ query, expectedPos, desc }) => {
      it(`should correctly identify position for ${desc}`, () => {
        try {
          parseSync(query);
          assert.fail("Expected error");
        } catch (error) {
          assert.equal(error.sqlDetails.cursorPosition, expectedPos);
        }
      });
    });
  });

  describe("Error Types", () => {
    it("should handle unterminated string literals", () => {
      try {
        parseSync("SELECT * FROM users WHERE name = 'unclosed");
        assert.fail("Expected error");
      } catch (error) {
        assert.ok(error.message.includes("unterminated quoted string"));
      }
    });

    it("should handle reserved keywords", () => {
      try {
        parseSync("SELECT * FROM table");
        assert.fail("Expected error");
      } catch (error) {
        assert.ok(error.message.includes('syntax error at or near "table"'));
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty query", () => {
      assert.throws(() => parseSync(""), {
        message: "Query cannot be empty",
      });
    });

    it("should handle @ in strings", () => {
      const query = "SELECT * FROM users WHERE email = 'user@example.com'";
      assert.doesNotThrow(() => parseSync(query));
    });
  });

  describe("hasSqlDetails Type Guard", () => {
    it("should return true for SQL parse errors", () => {
      try {
        parseSync("SELECT * FROM users WHERE id = @");
        assert.fail("Expected error");
      } catch (error) {
        assert.equal(hasSqlDetails(error), true);
      }
    });

    it("should return false for regular errors", () => {
      assert.equal(hasSqlDetails(new Error("Regular error")), false);
    });

    it("should return false for non-Error objects", () => {
      assert.equal(hasSqlDetails("string"), false);
      assert.equal(hasSqlDetails(null), false);
      assert.equal(hasSqlDetails(undefined), false);
    });
  });

  describe("Backward Compatibility", () => {
    it("should maintain Error instance", () => {
      try {
        parseSync("SELECT * FROM users WHERE id = @");
        assert.fail("Expected error");
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message);
        assert.ok(error.stack);
      }
    });
  });
});
