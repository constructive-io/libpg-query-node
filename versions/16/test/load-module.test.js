const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WASM = path.join(__dirname, '../wasm/libpg-query.wasm');
const RESULT = 'RESULT ';

// Runs `body` in a fresh process whose copy of the wrapper has no
// libpg-query.wasm next to it, like a host that cannot read its own files.
function withoutWasmFile(body) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.no-wasm-'));
  try {
    for (const file of ['index.cjs', 'libpg-query.js']) {
      fs.copyFileSync(path.join(__dirname, '../wasm', file), path.join(dir, file));
    }
    const script = `
      const fs = require('node:fs');
      const lib = require(${JSON.stringify(path.join(dir, 'index.cjs'))});
      const bytes = fs.readFileSync(${JSON.stringify(WASM)});
      const DEEP = 'SELECT 1' + '+1'.repeat(100000);
      (async () => { ${body} })().then(
        (result) => console.log(${JSON.stringify(RESULT)} + JSON.stringify(result)),
        (error) => { console.log(${JSON.stringify(RESULT)} + JSON.stringify({ error: String(error && error.message || error) })); }
      );
    `;
    const run = spawnSync(process.execPath, ['--max-old-space-size=4096', '-e', script], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
    });
    const line = (run.stdout || '').split('\n').reverse().find((l) => l.startsWith(RESULT));
    if (!line) {
      const how = run.error ? run.error.message : run.signal ? `signal ${run.signal}` : `exit ${run.status}`;
      throw new Error(`child process gave no result (${how}):\n${(run.stderr || '').slice(-4000)}`);
    }
    return JSON.parse(line.slice(RESULT.length));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadModule({ wasm }) when the wrapper cannot read libpg-query.wasm', { timeout: 300000 }, () => {
  it('fails to load without it', () => {
    const result = withoutWasmFile(`await lib.loadModule(); return { ok: true };`);
    assert.ok(result.error, 'expected loadModule() to reject without the .wasm file');
  });

  it('loads from the bytes and recovers after a failed call without the file', () => {
    const result = withoutWasmFile(`
      await lib.loadModule({ wasm: bytes });
      const first = lib.parseSync('SELECT 1').stmts.length;
      let threw = false;
      try { lib.parseSync(DEEP); } catch { threw = true; }
      const afterSync = lib.parseSync('SELECT 2').stmts.length;
      let threwAsync = false;
      try { await lib.parse(DEEP); } catch { threwAsync = true; }
      const afterAsync = (await lib.parse('SELECT 3')).stmts.length;
      return { first, threw, afterSync, threwAsync, afterAsync };
    `);
    assert.deepEqual(result, { first: 1, threw: true, afterSync: 1, threwAsync: true, afterAsync: 1 });
  });

  it('accepts a compiled WebAssembly.Module and a typed array view', () => {
    const result = withoutWasmFile(`
      await lib.loadModule({ wasm: new WebAssembly.Module(bytes) });
      const fromModule = lib.parseSync('SELECT 1').stmts.length;
      await lib.loadModule({ wasm: new Uint8Array(bytes) });
      return { fromModule, fromView: (await lib.parse('SELECT 1; SELECT 2')).stmts.length };
    `);
    assert.deepEqual(result, { fromModule: 1, fromView: 2 });
  });

  it('creates the replacement from the bytes after out-of-memory failures', () => {
    const result = withoutWasmFile(`
      await lib.loadModule({ wasm: bytes });
      const huge = 'SELECT 1;\\n'.repeat(5000000);
      const messages = [];
      for (let i = 0; i < 3; i++) {
        try { lib.parseSync(huge); } catch (e) { messages.push(e.message); }
      }
      return { messages, after: (await lib.parse('SELECT 1')).stmts.length };
    `);
    assert.equal(result.messages.length, 3);
    assert.equal(result.after, 1);
  });

  it('rejects input that is not WebAssembly', () => {
    const result = withoutWasmFile(`await lib.loadModule({ wasm: new Uint8Array([1, 2, 3]) }); return { ok: true };`);
    assert.ok(result.error);
  });
});

// Cloudflare Workers with `nodejs_compat` define `process.versions.node` and
// `WorkerGlobalScope`, but no `__dirname`, `__filename` or `self.location`.
// Loads the wrapper and the glue as plain functions, so neither sees a module
// scope, in a process that also has those two markers.
function inWorkerLikeHost(body) {
  const dir = path.join(__dirname, '../wasm');
  const script = `
    globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
    globalThis.self = globalThis;
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = ${JSON.stringify(dir)};
    const load = (file, req) => {
      const module = { exports: {} };
      new Function('module', 'exports', 'require', fs.readFileSync(path.join(dir, file), 'utf8'))(module, module.exports, req);
      return module.exports;
    };
    const glue = load('libpg-query.js', (id) => { throw new Error('the glue required ' + id); });
    const lib = load('index.cjs', (id) => id === './libpg-query.js' ? glue : require(require.resolve(id, { paths: [dir] })));
    const bytes = fs.readFileSync(path.join(dir, 'libpg-query.wasm'));
    (async () => { ${body} })().then(
      (result) => console.log(${JSON.stringify(RESULT)} + JSON.stringify(result)),
      (error) => { console.log(${JSON.stringify(RESULT)} + JSON.stringify({ error: String(error && error.message || error) })); }
    );
  `;
  // A file, not `-e`: eval code gets `__dirname` and `__filename` as globals.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-like-'));
  const file = path.join(tmp, 'host.js');
  fs.writeFileSync(file, script);
  let run;
  try {
    run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 120000 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const line = (run.stdout || '').split('\n').reverse().find((l) => l.startsWith(RESULT));
  if (!line) {
    const how = run.error ? run.error.message : run.signal ? `signal ${run.signal}` : `exit ${run.status}`;
    throw new Error(`child process gave no result (${how}):\n${(run.stderr || '').slice(-4000)}`);
  }
  return JSON.parse(line.slice(RESULT.length));
}

describe('loadModule({ wasm }) in a host without __dirname or self.location', { timeout: 300000 }, () => {
  it('loads from the bytes and parses', () => {
    const result = inWorkerLikeHost(`
      await lib.loadModule({ wasm: bytes });
      return { stmts: (await lib.parse('SELECT 1')).stmts.length };
    `);
    assert.deepEqual(result, { stmts: 1 });
  });
});

describe('loadModule() arity', () => {
  it('stays 0 so test runners can pass it directly as a hook', () => {
    assert.equal(require('../wasm/index.cjs').loadModule.length, 0);
  });
});
