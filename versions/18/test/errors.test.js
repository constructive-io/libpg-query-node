const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { parseSync, loadModule, formatSqlError, hasSqlDetails } = require('../wasm/index.cjs');

describe('Enhanced Error Handling', () => {
  before(async () => {
    await loadModule();
  });

  describe('Error Details Structure', () => {
    it('should include sqlDetails property on parse errors', () => {
      assert.throws(() => {
        parseSync('SELECT * FROM users WHERE id = @');
      });

      try {
        parseSync('SELECT * FROM users WHERE id = @');
      } catch (error) {
        assert.ok('sqlDetails' in error);
        assert.ok('message' in error.sqlDetails);
        assert.ok('cursorPosition' in error.sqlDetails);
        assert.ok('fileName' in error.sqlDetails);
        assert.ok('functionName' in error.sqlDetails);
        assert.ok('lineNumber' in error.sqlDetails);
      }
    });

    it('should have correct cursor position (0-based)', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 32);
      }
    });

    it('should identify error source file', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.fileName, 'scan.l');
        assert.equal(error.sqlDetails.functionName, 'scanner_yyerror');
      }
    });
  });

  describe('Error Position Accuracy', () => {
    const positionTests = [
      { query: '@ SELECT * FROM users', expectedPos: 0, desc: 'error at start' },
      { query: 'SELECT @ FROM users', expectedPos: 9, desc: 'error after SELECT' },
      { query: 'SELECT * FROM users WHERE @ = 1', expectedPos: 28, desc: 'error after WHERE' },
      { query: 'SELECT * FROM users WHERE id = @', expectedPos: 32, desc: 'error at end' },
      { query: 'INSERT INTO users (id, name) VALUES (1, @)', expectedPos: 41, desc: 'error in VALUES' },
      { query: 'UPDATE users SET name = @ WHERE id = 1', expectedPos: 26, desc: 'error in SET' },
      { query: 'CREATE TABLE test (id INT, name @)', expectedPos: 32, desc: 'error in CREATE TABLE' },
    ];

    positionTests.forEach(({ query, expectedPos, desc }) => {
      it(`should correctly identify position for ${desc}`, () => {
        try {
          parseSync(query);
          assert.fail('Expected error');
        } catch (error) {
          assert.equal(error.sqlDetails.cursorPosition, expectedPos);
        }
      });
    });
  });

  describe('Error Types', () => {
    it('should handle unterminated string literals', () => {
      try {
        parseSync("SELECT * FROM users WHERE name = 'unclosed");
        assert.fail('Expected error');
      } catch (error) {
        assert.ok(error.message.includes('unterminated quoted string'));
        assert.equal(error.sqlDetails.cursorPosition, 33);
      }
    });

    it('should handle unterminated quoted identifiers', () => {
      try {
        parseSync('SELECT * FROM users WHERE name = "unclosed');
        assert.fail('Expected error');
      } catch (error) {
        assert.ok(error.message.includes('unterminated quoted identifier'));
        assert.equal(error.sqlDetails.cursorPosition, 33);
      }
    });

    it('should handle invalid tokens', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = $');
        assert.fail('Expected error');
      } catch (error) {
        assert.ok(error.message.includes('syntax error at or near "$"'));
        assert.equal(error.sqlDetails.cursorPosition, 31);
      }
    });

    it('should handle reserved keywords', () => {
      try {
        parseSync('SELECT * FROM table');
        assert.fail('Expected error');
      } catch (error) {
        assert.ok(error.message.includes('syntax error at or near "table"'));
        assert.equal(error.sqlDetails.cursorPosition, 14);
      }
    });

    it('should handle syntax error in WHERE clause', () => {
      try {
        parseSync('SELECT * FROM users WHERE');
        assert.fail('Expected error');
      } catch (error) {
        assert.ok(error.message.includes('syntax error at end of input'));
        assert.equal(error.sqlDetails.cursorPosition, 25);
      }
    });
  });

  describe('formatSqlError Helper', () => {
    it('should format error with position indicator', () => {
      try {
        parseSync("SELECT * FROM users WHERE id = 'unclosed");
        assert.fail('Expected error');
      } catch (error) {
        const formatted = formatSqlError(error, "SELECT * FROM users WHERE id = 'unclosed");
        assert.ok(formatted.includes('Error: unterminated quoted string'));
        assert.ok(formatted.includes('Position: 31'));
        assert.ok(formatted.includes("SELECT * FROM users WHERE id = 'unclosed"));
        assert.ok(formatted.includes('                               ^'));
      }
    });

    it('should respect showPosition option', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        const formatted = formatSqlError(error, 'SELECT * FROM users WHERE id = @', { 
          showPosition: false 
        });
        assert.ok(!formatted.includes('^'));
        assert.ok(formatted.includes('Position: 32'));
      }
    });

    it('should respect showQuery option', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        const formatted = formatSqlError(error, 'SELECT * FROM users WHERE id = @', { 
          showQuery: false 
        });
        assert.ok(!formatted.includes('SELECT * FROM users'));
        assert.ok(formatted.includes('Error:'));
        assert.ok(formatted.includes('Position:'));
      }
    });

    it('should truncate long queries', () => {
      const longQuery = 'SELECT ' + 'a, '.repeat(50) + 'z FROM users WHERE id = @';
      try {
        parseSync(longQuery);
        assert.fail('Expected error');
      } catch (error) {
        const formatted = formatSqlError(error, longQuery, { maxQueryLength: 50 });
        assert.ok(formatted.includes('...'));
        const lines = formatted.split('\n');
        const queryLine = lines.find(line => line.includes('...'));
        assert.ok(queryLine.length <= 56); // 50 + 2*3 for ellipsis
      }
    });

    it('should handle color option without breaking output', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        const formatted = formatSqlError(error, 'SELECT * FROM users WHERE id = @', { 
          color: true 
        });
        assert.ok(formatted.includes('Error:'));
        assert.ok(formatted.includes('Position:'));
        // Should contain ANSI codes but still be readable
        const cleanFormatted = formatted.replace(/\x1b\[[0-9;]*m/g, '');
        assert.ok(cleanFormatted.includes('syntax error'));
      }
    });
  });

  describe('hasSqlDetails Type Guard', () => {
    it('should return true for SQL parse errors', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(hasSqlDetails(error), true);
      }
    });

    it('should return false for regular errors', () => {
      const regularError = new Error('Regular error');
      assert.equal(hasSqlDetails(regularError), false);
    });

    it('should return false for non-Error objects', () => {
      assert.equal(hasSqlDetails('string'), false);
      assert.equal(hasSqlDetails(123), false);
      assert.equal(hasSqlDetails(null), false);
      assert.equal(hasSqlDetails(undefined), false);
      assert.equal(hasSqlDetails({}), false);
    });

    it('should return false for Error with incomplete sqlDetails', () => {
      const error = new Error('Test');
      error.sqlDetails = { message: 'test' }; // Missing cursorPosition
      assert.equal(hasSqlDetails(error), false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty query', () => {
      assert.throws(() => parseSync(''), {
        message: 'Query cannot be empty'
      });
    });

    it('should handle null query', () => {
      assert.throws(() => parseSync(null), {
        message: 'Query cannot be null or undefined'
      });
    });

    it('should handle undefined query', () => {
      assert.throws(() => parseSync(undefined), {
        message: 'Query cannot be null or undefined'
      });
    });

    it('should handle @ in comments', () => {
      const query = 'SELECT * FROM users /* @ in comment */ WHERE id = 1';
      assert.doesNotThrow(() => parseSync(query));
    });

    it('should handle @ in strings', () => {
      const query = 'SELECT * FROM users WHERE email = \'user@example.com\'';
      assert.doesNotThrow(() => parseSync(query));
    });
  });

  describe('Complex Error Scenarios', () => {
    it('should handle errors in CASE statements', () => {
      try {
        parseSync('SELECT CASE WHEN id = 1 THEN "one" WHEN id = 2 THEN @ ELSE "other" END FROM users');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 54);
      }
    });

    it('should handle errors in subqueries', () => {
      try {
        parseSync('SELECT * FROM users WHERE id IN (SELECT @ FROM orders)');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 42);
      }
    });

    it('should handle errors in function calls', () => {
      try {
        parseSync('SELECT COUNT(@) FROM users');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 14);
      }
    });

    it('should handle errors in second statement', () => {
      try {
        parseSync('SELECT * FROM users; SELECT * FROM orders WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 54);
      }
    });

    it('should handle errors in CTE', () => {
      try {
        parseSync('WITH cte AS (SELECT * FROM users WHERE id = @) SELECT * FROM cte');
        assert.fail('Expected error');
      } catch (error) {
        assert.equal(error.sqlDetails.cursorPosition, 45);
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain Error instance', () => {
      try {
        parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message);
        assert.ok(error.stack);
      }
    });

    it('should work with standard error handling', () => {
      let caught = false;
      try {
        parseSync('SELECT * FROM users WHERE id = @');
      } catch (e) {
        caught = true;
        assert.ok(e.message.includes('syntax error'));
      }
      assert.equal(caught, true);
    });
  });
});