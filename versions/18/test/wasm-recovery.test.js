const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const lib = require('../wasm/index.cjs');
const { parse, parseSync, loadModule } = lib;

const DEEP = 'SELECT 1' + '+1'.repeat(100000);

// An exception out of the WASM parser skips libpg_query's cleanup. Before the
// wrapper replaced the instance, enough of them made even `SELECT 1` trap.
describe('Recovery after the WASM parser throws', { timeout: 120000 }, () => {
  before(async () => {
    await loadModule();
  });

  it('stays usable after repeated stack overflows on deeply nested SQL', async () => {
    for (let i = 0; i < 60; i++) {
      await loadModule();
      assert.throws(() => parseSync(DEEP));
    }
    await loadModule();
    assert.equal(parseSync('SELECT 1').stmts.length, 1);
  });

  // libpg_query checks stack depth itself, so deeply nested SQL is a clean error
  // and the instance is kept. The 10-failure cap on a stale instance is covered
  // by the injected throws in 'Recovery from a throw in each entry point'.
  it('returns a stack depth error for deeply nested SQL and keeps the instance', async () => {
    await loadModule();
    for (let i = 0; i < 60; i++) {
      assert.throws(() => parseSync(DEEP), /stack depth limit exceeded/);
    }
    assert.equal(parseSync('SELECT 1').stmts.length, 1);
  });

  it('frees each replaced instance, so WASM memory stays at one instance', () => {
    const script = `const lib = require(${JSON.stringify(require.resolve('../wasm/index.cjs'))});
      (async () => {
        await lib.loadModule();
        lib.parseSync('SELECT 1');
        gc(); gc();
        const base = process.memoryUsage().external;
        const deep = 'SELECT 1' + '+1'.repeat(100000);
        for (let i = 0; i < 30; i++) {
          try { lib.parseSync(deep); } catch {}
          await lib.loadModule();
        }
        const huge = 'SELECT 1;\\n'.repeat(5000000);
        for (let i = 0; i < 2; i++) {
          try { await lib.parse(huge); } catch {}
        }
        await lib.loadModule();
        lib.parseSync('SELECT 1');
        // V8 frees a dropped instance's memory on a later task, not in the same microtask run.
        await new Promise((resolve) => setTimeout(resolve, 0));
        gc(); gc();
        process.stdout.write('\\ngrown=' + (process.memoryUsage().external - base));
      })();`;
    // A non-zero exit code (libpg_query's exit() leaking out) makes execFileSync throw.
    // libpg_query prints a memory dump to stdout on out-of-memory, so read the last line.
    const output = execFileSync(process.execPath, ['--expose-gc', '-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const grown = Number(output.match(/^grown=(-?\d+)$/m)?.[1]);
    assert.ok(grown < 32 * 1024 * 1024, `WASM memory grew by ${grown} bytes after 32 replacements`);
  });

  it('lets a call queued behind a failing one wait for the fresh instance', async () => {
    await loadModule();
    const [failed, queued] = await Promise.allSettled([
      parse(DEEP),
      parse('SELECT 1'),
    ]);
    assert.equal(failed.status, 'rejected');
    assert.equal(queued.status, 'fulfilled', queued.reason?.message);
    assert.equal(queued.value.stmts.length, 1);
  });

  it('throws an Error and keeps process.exitCode when the memory limit is hit', async () => {
    const exitCode = process.exitCode;
    await assert.rejects(parse('SELECT 1;\n'.repeat(5000000)), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /out of WASM memory/);
      return true;
    });
    assert.equal(process.exitCode, exitCode);
    assert.equal((await parse('SELECT 1')).stmts.length, 1);
  });

  for (const name of ['parsePlPgSQL', 'fingerprint', 'normalize', 'scan']) {
    const skip = typeof lib[name] !== 'function' && 'not in this build';
    it(`${name}: rejects a 50 MB input, keeps process.exitCode and recovers`, { skip }, async () => {
      const exitCode = process.exitCode;
      await assert.rejects(lib[name]('SELECT 1;\n'.repeat(5000000)));
      assert.equal(process.exitCode, exitCode);
      assert.ok(await lib[name](name === 'parsePlPgSQL'
        ? 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql'
        : 'SELECT 1'));
      assert.ok(lib[`${name}Sync`]('SELECT 1'));
    });
  }

  it('retries the load when loading a fresh instance fails', async () => {
    let loads = 0;
    const isolated = loadTrapping(() => ++loads === 2);
    await isolated.loadModule();
    isolated.trapNext();
    await assert.rejects(isolated.parse('SELECT 1'), RangeError);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await isolated.parse('SELECT 1')).stmts.length, 1);
    assert.equal(loads, 3);
  });

  it('lets loadModule() reject on a failed reload and retry on the next call', async () => {
    let loads = 0;
    const isolated = loadTrapping(() => ++loads === 2);
    await isolated.loadModule();
    isolated.trapNext();
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    await assert.rejects(isolated.loadModule(), /simulated load failure/);
    await isolated.loadModule();
    assert.equal(isolated.parseSync('SELECT 1').stmts.length, 1);
    assert.equal(loads, 3);
  });

  it('keeps sync calls in the same synchronous loop working after a failure', () => {
    const queries = Array.from({ length: 200 }, (_, i) => `SELECT ${i}, 'x${i}' FROM t${i} WHERE a = ${i}`);
    const expected = queries.map((query) => JSON.stringify(parseSync(query)));
    let failed = 0;
    const results = [];
    for (const [i, query] of queries.entries()) {
      if (i === 10) {
        try { parseSync(DEEP); } catch { failed++; }
      }
      results.push(JSON.stringify(parseSync(query)));
    }
    assert.equal(failed, 1);
    assert.deepEqual(results, expected);
  });

  it('retries a failed fresh load on the next failure, for callers that never await', async () => {
    let loads = 0;
    const isolated = loadTrapping(() => ++loads === 2);
    await isolated.loadModule();
    isolated.trapNext();
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(loads, 2);
    isolated.trapNext();
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    assert.equal(loads, 3);
    await isolated.loadModule();
    assert.equal(isolated.parseSync('SELECT 1').stmts.length, 1);
  });

  it('makes loadModule() wait again when a queued call breaks the fresh instance', async () => {
    await loadModule();
    assert.throws(() => parseSync(DEEP));
    const failing = parse(DEEP);
    const ready = loadModule();
    await assert.rejects(failing);
    await ready;
    assert.equal(parseSync('SELECT 1').stmts.length, 1);
  });

  it('keeps every call queued behind two failures waiting for a working instance', async () => {
    await loadModule();
    const [first, second, queued] = await Promise.allSettled([parse(DEEP), parse(DEEP), parse('SELECT 1')]);
    assert.equal(first.status, 'rejected');
    assert.equal(second.status, 'rejected');
    assert.equal(queued.status, 'fulfilled', queued.reason?.message);
    assert.equal(queued.value.stmts.length, 1);
  });
});

// Every entry point, with the next WASM call made to throw: a RangeError
// stands for a stack overflow, a non-Error object for Emscripten's ExitStatus.
describe('Recovery from a throw in each entry point', { timeout: 120000 }, () => {
  const PLPGSQL = 'CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END $$ LANGUAGE plpgsql';
  const entryPoints = [
    ['parse', 'SELECT 1'],
    ['parseSync', 'SELECT 1'],
    ['parsePlPgSQL', PLPGSQL],
    ['parsePlPgSQLSync', PLPGSQL],
    ['fingerprint', 'SELECT 1'],
    ['fingerprintSync', 'SELECT 1'],
    ['normalize', 'SELECT 1'],
    ['normalizeSync', 'SELECT 1'],
    ['scan', 'SELECT 1'],
    ['scanSync', 'SELECT 1'],
  ];

  // Instances are numbered by load; `used` is the one the last WASM call ran on.
  let loads = 0;
  let used;
  let frees = 0;
  let throwNext;
  const isolated = loadIsolated(async (real, ...args) => {
    const id = ++loads;
    const module = await real(...args);
    const free = module._free;
    module._free = (ptr) => {
      frees++;
      return free(ptr);
    };
    for (const name of Object.keys(module).filter((key) => key.startsWith('_wasm_'))) {
      const call = module[name];
      module[name] = (...callArgs) => {
        used = id;
        if (throwNext === undefined) return call(...callArgs);
        const thrown = throwNext;
        throwNext = undefined;
        process.exitCode = 7;
        throw thrown;
      };
    }
    return module;
  });

  async function failOnce(name, query, thrown) {
    await isolated.loadModule();
    const loadsBefore = loads;
    const exitCode = process.exitCode;
    process.exitCode = 0;
    const freesBefore = frees;
    throwNext = thrown;
    let caught;
    try {
      await isolated[name](query);
    } catch (error) {
      caught = error;
    } finally {
      var exitCodeAfter = process.exitCode;
      process.exitCode = exitCode;
    }
    assert.equal(exitCodeAfter, 0, `${name} changed process.exitCode`);
    assert.equal(frees, freesBefore, `${name} freed memory in the instance that threw`);
    assert.equal(loads, loadsBefore + 1, `${name} did not start a fresh instance`);
    const stale = used;
    const syncName = name.endsWith('Sync') ? name : 'parseSync';
    assert.ok(isolated[syncName](query), `${syncName} failed while the fresh instance loads`);
    assert.equal(used, stale, 'a sync call did not run on the stale instance');
    assert.ok(frees > freesBefore, 'a successful call did not free its memory');
    // A sync caller gets the fresh instance once it awaits loadModule(); async calls wait by themselves.
    if (name.endsWith('Sync')) await isolated.loadModule();
    assert.ok(await isolated[name](query), `${name} failed after recovery`);
    assert.equal(used, loads, `${name} ran on the stale instance, not the fresh one`);
    return caught;
  }

  it('starts one fresh instance for many failures in one synchronous loop', async () => {
    await isolated.loadModule();
    const loadsBefore = loads;
    for (let i = 0; i < 5; i++) {
      throwNext = new RangeError('Maximum call stack size exceeded');
      assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    }
    assert.equal(loads, loadsBefore + 1);
    await isolated.loadModule();
    assert.ok(isolated.parseSync('SELECT 1'));
    assert.equal(used, loads);
  });

  it('stops sync calls on a stale instance after 10 failures until the fresh one loads', async () => {
    await isolated.loadModule();
    for (let i = 0; i < 9; i++) {
      throwNext = new RangeError('Maximum call stack size exceeded');
      assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    }
    assert.ok(isolated.parseSync('SELECT 1'));
    throwNext = new RangeError('Maximum call stack size exceeded');
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    assert.throws(() => isolated.parseSync('SELECT 1'), /Call `?loadModule\(\)`? first/);
    await isolated.loadModule();
    assert.ok(isolated.parseSync('SELECT 1'));
    assert.equal(used, loads);
  });

  it('makes loadModule() and queued calls wait again when a queued call breaks the fresh instance', async () => {
    await isolated.loadModule();
    throwNext = new RangeError('Maximum call stack size exceeded');
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    const failing = isolated.parse('SELECT 1');
    throwNext = new RangeError('Maximum call stack size exceeded');
    const ready = isolated.loadModule();
    const after = isolated.parse('SELECT 1');
    await assert.rejects(failing, RangeError);
    assert.ok(await after);
    assert.equal(used, loads, 'a queued call ran on the instance that just threw');
    await ready;
    assert.ok(isolated.parseSync('SELECT 1'));
    assert.equal(used, loads, 'loadModule() resolved before the fresh instance loaded');
  });

  it('makes loadModule() wait again when a call queued ahead of it breaks the fresh instance', async () => {
    await isolated.loadModule();
    throwNext = new RangeError('Maximum call stack size exceeded');
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    const failing = isolated.parse('SELECT 1');
    throwNext = new RangeError('Maximum call stack size exceeded');
    const ready = isolated.loadModule();
    await assert.rejects(failing, RangeError);
    await ready;
    assert.ok(isolated.parseSync('SELECT 1'));
    assert.equal(used, loads, 'loadModule() resolved before the fresh instance loaded');
  });

  it('names a thrown object that has no message', async () => {
    class EmscriptenSjLj {}
    const caught = await failOnce('parseSync', 'SELECT 1', new EmscriptenSjLj());
    assert.match(caught.message, /libpg_query terminated \(EmscriptenSjLj\)/);
  });

  for (const [name, query] of entryPoints) {
    const skip = typeof isolated[name] !== 'function' && 'not in this build';

    it(`${name}: rethrows the original Error and recovers`, { skip }, async () => {
      const thrown = new RangeError('Maximum call stack size exceeded');
      assert.equal(await failOnce(name, query, thrown), thrown);
    });

    it(`${name}: wraps a non-Error throw in an Error and recovers`, { skip }, async () => {
      const thrown = { name: 'ExitStatus', message: 'Program terminated with exit(1)', status: 1 };
      const caught = await failOnce(name, query, thrown);
      assert.ok(caught instanceof Error);
      assert.match(caught.message, /out of WASM memory/);
      assert.equal(caught.cause, thrown);
    });
  }
});

// An isolated copy whose parse export throws once after trapNext(), standing in
// for a WASM trap now that libpg_query returns stack depth errors instead.
// failLoad() is called on each load; a true result rejects that load.
function loadTrapping(failLoad) {
  let trap = false;
  const isolated = loadIsolated(async (real, ...args) => {
    if (failLoad()) throw new Error('simulated load failure');
    const module = await real(...args);
    const parseRaw = module._wasm_parse_query_raw;
    module._wasm_parse_query_raw = (...callArgs) => {
      if (!trap) return parseRaw(...callArgs);
      trap = false;
      throw new RangeError('Maximum call stack size exceeded');
    };
    return module;
  });
  isolated.trapNext = () => { trap = true; };
  return isolated;
}

// A copy of the wrapper whose WASM factory is wrapped, leaving the shared copy alone.
function loadIsolated(wrapFactory) {
  const indexPath = require.resolve('../wasm/index.cjs');
  const factory = require.cache[require.resolve('../wasm/libpg-query.js')];
  const shared = require.cache[indexPath];
  const realFactory = factory.exports;
  factory.exports = (...args) => wrapFactory(realFactory, ...args);
  delete require.cache[indexPath];
  try {
    return require(indexPath);
  } finally {
    factory.exports = realFactory;
    require.cache[indexPath] = shared;
  }
}
