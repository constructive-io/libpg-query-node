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

  it('keeps sync calls working through 60 overflows in one synchronous loop', async () => {
    await loadModule();
    const results = [];
    for (let i = 0; i < 60; i++) {
      for (const query of [DEEP, 'SELECT 1']) {
        try {
          results.push(parseSync(query).stmts.length);
        } catch (error) {
          results.push(error instanceof RangeError ? 'overflow' : error.message);
        }
      }
    }
    assert.deepEqual(results, Array(60).fill(['overflow', 1]).flat());
  });

  it('gives the next sync call a fresh instance after the memory limit is hit', () => {
    assert.throws(() => parseSync('SELECT 1;\n'.repeat(5000000)), /out of WASM memory/);
    assert.equal(parseSync('SELECT 1;\n'.repeat(1000000)).stmts.length, 1000000);
  });

  // Each replaced instance stays allocated until the synchronous run yields.
  it('stops replacing after repeated out-of-memory failures in one synchronous run, and recovers after an await', () => {
    const script = `const lib = require(${JSON.stringify(require.resolve('../wasm/index.cjs'))});
      (async () => {
        await lib.loadModule();
        const huge = 'SELECT 1;\\n'.repeat(5000000);
        const messages = [];
        let peak = 0;
        for (let i = 0; i < 10; i++) {
          try { lib.parseSync(huge); } catch (error) { messages.push(error.message + ' / ' + error.cause?.message); }
          peak = Math.max(peak, process.memoryUsage().rss);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        const after = lib.parseSync('SELECT 1').stmts.length;
        process.stdout.write('\\nresult=' + JSON.stringify({ messages, peak, after }));
      })();`;
    const output = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const { messages, peak, after } = JSON.parse(output.match(/^result=(.*)$/m)[1]);
    assert.equal(messages.length, 10);
    assert.match(messages[0], /out of WASM memory/);
    assert.match(messages[1], /out of WASM memory/);
    for (const message of messages.slice(2)) {
      assert.match(message, /^WASM memory limit hit repeatedly in one synchronous run; yield \(await\) to free memory \/ .*out of WASM memory/);
    }
    assert.ok(peak < 2.5 * 1024 ** 3, `peak RSS ${Math.round(peak / 1024 ** 2)} MiB`);
    assert.equal(after, 1);
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
    const isolated = loadIsolated((real, ...args) =>
      ++loads === 2 ? Promise.reject(new Error('simulated load failure')) : real(...args));
    await isolated.loadModule();
    await assert.rejects(isolated.parse(DEEP));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await isolated.parse('SELECT 1')).stmts.length, 1);
    assert.equal(loads, 3);
  });

  it('names the cause when a fresh instance cannot start, and loadModule() retries', async () => {
    let loads = 0;
    const isolated = loadIsolated((real, options) => {
      if (++loads === 2 || loads === 3) failInstantiate(options);
      return real(options);
    });
    await isolated.loadModule();
    assert.throws(() => isolated.parseSync(DEEP), RangeError);
    assert.throws(() => isolated.parseSync('SELECT 1'), (error) => {
      assert.match(error.message, /Could not start a fresh WASM instance/);
      assert.match(error.cause.message, /simulated instantiate failure/);
      return true;
    });
    await isolated.loadModule();
    assert.equal(isolated.parseSync('SELECT 1').stmts.length, 1);
    assert.equal(loads, 4);
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

  it('retries a fresh instance that failed to start on the next sync call', async () => {
    let loads = 0;
    const isolated = loadIsolated((real, options) => {
      if (++loads === 2) failInstantiate(options);
      return real(options);
    });
    await isolated.loadModule();
    assert.throws(() => isolated.parseSync(DEEP), RangeError);
    assert.equal(isolated.parseSync('SELECT 1').stmts.length, 1);
    assert.equal(loads, 3);
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
  const isolated = loadIsolated((real, options) => {
    const id = ++loads;
    const ready = real(options);
    // A replacement instance is built synchronously; the first load is async.
    if (typeof options._malloc === 'function') return instrument(options, id) && ready;
    return ready.then((module) => instrument(module, id));
  });

  function instrument(module, id) {
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
  }

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
    const syncName = name.endsWith('Sync') ? name : 'parseSync';
    assert.ok(isolated[syncName](query), `${syncName} failed right after the failure`);
    assert.equal(used, loads, `${syncName} ran on the instance that threw`);
    assert.ok(frees > freesBefore, 'a successful call did not free its memory');
    assert.ok(await isolated[name](query), `${name} failed after recovery`);
    assert.equal(used, loads, `${name} ran on the instance that threw`);
    return caught;
  }

  it('starts a fresh instance for every failure in one synchronous loop', async () => {
    await isolated.loadModule();
    const loadsBefore = loads;
    for (let i = 0; i < 30; i++) {
      throwNext = new RangeError('Maximum call stack size exceeded');
      assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
      assert.ok(isolated.parseSync('SELECT 1'));
      assert.equal(used, loads, 'a sync call ran on the instance that threw');
    }
    assert.equal(loads, loadsBefore + 30);
  });

  it('never runs a queued call on the instance that threw', async () => {
    await isolated.loadModule();
    throwNext = new RangeError('Maximum call stack size exceeded');
    const failing = isolated.parse('SELECT 1');
    const after = isolated.parse('SELECT 1');
    await assert.rejects(failing, RangeError);
    assert.ok(await after);
    assert.equal(used, loads, 'a queued call ran on the instance that threw');
    await isolated.loadModule();
    assert.ok(isolated.parseSync('SELECT 1'));
    assert.equal(used, loads);
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
      assert.deepEqual(caught.cause, thrown);
    });
  }
});

// Makes the loader's synchronous instantiation fail, as if the new instance's memory could not be allocated.
function failInstantiate(options) {
  const instantiateWasm = options.instantiateWasm;
  if (!instantiateWasm) return;
  options.instantiateWasm = (imports) =>
    instantiateWasm(imports, () => { throw new Error('simulated instantiate failure'); });
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
