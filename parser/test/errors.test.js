const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Parser } = require('../wasm/index.cjs');

describe('Parser Error Handling', () => {
  describe('Error propagation across versions', () => {
    const versions = [13, 14, 15, 16, 17];
    const invalidQuery = 'SELECT * FROM users WHERE id = @';

    for (const version of versions) {
      it(`should handle parse errors in PostgreSQL v${version}`, async () => {
        const parser = new Parser({version});
        
        // Test async parse
        await assert.rejects(
          async () => await parser.parse(invalidQuery),
          (error) => {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('syntax error'));
            // Check that sqlDetails are preserved
            assert.ok('sqlDetails' in error);
            assert.ok(error.sqlDetails.cursorPosition >= 0);
            return true;
          }
        );

        // Load parser for sync test
        await parser.loadParser();
        
        // Test sync parse
        assert.throws(
          () => parser.parseSync(invalidQuery),
          (error) => {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('syntax error'));
            // Check that sqlDetails are preserved
            assert.ok('sqlDetails' in error);
            assert.ok(error.sqlDetails.cursorPosition >= 0);
            return true;
          }
        );
      });
    }
  });

  describe('Error details preservation', () => {
    it('should preserve error details from underlying parser', async () => {
      const parser = new Parser({ version: 17 });
      await parser.loadParser();
      
      try {
        parser.parseSync('SELECT * FROM users WHERE id = @');
        assert.fail('Expected error');
      } catch (error) {
        // Check that the error is preserved as-is
        assert.ok(error.message.includes('syntax error'));
        assert.ok('sqlDetails' in error);
        assert.equal(error.sqlDetails.cursorPosition, 32);
        assert.equal(error.sqlDetails.fileName, 'scan.l');
        assert.equal(error.sqlDetails.functionName, 'scanner_yyerror');
      }
    });
  });

  describe('Invalid version handling', () => {
    it('should throw error for unsupported version', () => {
      assert.throws(
        () => new Parser({ version: 12 }),
        {
          message: 'Unsupported PostgreSQL version: 12. Supported versions are 13, 14, 15, 16, 17, 18.'
        }
      );
    });
  });

  describe('Parser not loaded error', () => {
    it('should throw error when using parseSync without loading', () => {
      const parser = new Parser({ version: 17 });
      
      assert.throws(
        () => parser.parseSync('SELECT 1'),
        {
          message: 'Parser not loaded. Call loadParser() first or use parse() for automatic loading.'
        }
      );
    });
  });
});