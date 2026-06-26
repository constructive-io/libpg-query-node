const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const query = require('../');

// Pairs with the reduced STACK_SIZE in the Makefile. Parsing and serializing a
// deeply nested tree recurses on the WASM C stack; if that stack is too small,
// deep input crashes the module with a hard WebAssembly trap instead of failing
// gracefully. This test asserts the parser always either succeeds or throws a
// clean, catchable error (e.g. SqlError "memory exhausted") — never a WASM trap.
// CI rebuilds the WASM from source, so a stack that's too small fails here.
describe('Deep nesting fails gracefully', () => {
  // Nested function calls build a genuinely deep parse tree (FuncCall nodes) —
  // the shape that recurses hardest during tree->JSON serialization. Depths span
  // the band that parses today through where it fails cleanly.
  const nestedFuncs = (depth) => 'SELECT ' + 'f('.repeat(depth) + '1' + ')'.repeat(depth);

  for (const depth of [1000, 4000, 7000, 10000]) {
    it(`depth ${depth}: parses or fails cleanly, never a WASM trap`, async () => {
      try {
        await query.parse(nestedFuncs(depth));
      } catch (err) {
        assert.ok(
          !(err instanceof WebAssembly.RuntimeError),
          `deep input crashed with a WASM trap (stack too small?): ${err && err.message}`
        );
      }
    });
  }
});
