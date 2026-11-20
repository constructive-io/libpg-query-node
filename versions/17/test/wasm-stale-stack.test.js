const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// A V8 stack overflow inside the parser unwinds the JS frames but not the C
// shadow stack. Sync calls in the same tick must keep using that instance until
// its replacement arrives, and used to start half-way down the stack: with a
// smaller native stack (--stack-size=8000) the third or fourth one overran the
// shadow stack and trapped instead of throwing RangeError.
const child = `
  const lib = require(process.argv[1]);
  const deep = 'SELECT 1' + '+1'.repeat(100000);
  (async () => {
    await lib.loadModule();
    const seen = [];
    for (let i = 0; i < 10; i++) {
      try { lib.parseSync(deep); seen.push('ok'); } catch (error) { seen.push(error.constructor.name); }
    }
    await lib.loadModule();
    seen.push(lib.parseSync('SELECT 1').stmts.length);
    console.log(JSON.stringify(seen));
  })();
`;

describe('Sync calls on a stale instance after a stack overflow', { timeout: 120000 }, () => {
  it('throw RangeError (or an error from libpg_query), never a WebAssembly trap', () => {
    const stdout = execFileSync(
      process.execPath,
      ['--stack-size=8000', '-e', child, path.join(__dirname, '..', 'wasm', 'index.cjs')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const seen = JSON.parse(stdout.trim().split('\n').pop());
    assert.equal(seen.pop(), 1, 'the replacement instance parses');
    assert.ok(!seen.includes('ok'), 'the deep expression must not parse');
    for (const name of seen) assert.notEqual(name, 'RuntimeError', `trap: ${JSON.stringify(seen)}`);
  });
});
