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

  // PG 18 reports deep nesting as a regular SQL error rather than a WASM trap.
  it('returns a stack depth error for deeply nested SQL and keeps the instance', async () => {
    await loadModule();
    for (let i = 0; i < 60; i++) {
      assert.throws(() => parseSync(DEEP), /stack depth limit exceeded/);
    }
    assert.equal(parseSync('SELECT 1').stmts.length, 1);
  });

  // 18.2.x left the WASM build at the 100kB default limit, so it rejected nesting
  // that 18.1.x and native builds parse.
  it('parses nesting within the stack depth limit', async () => {
    await loadModule();
    const nested = {
      'chained operators': 'SELECT 1' + '+1'.repeat(2000),
      'nested subqueries': 'SELECT ' + '(SELECT '.repeat(1000) + '1' + ')'.repeat(1000),
      'nested function calls': 'SELECT ' + 'f('.repeat(2000) + '1' + ')'.repeat(2000),
    };
    for (const [name, sql] of Object.entries(nested)) {
      assert.equal(parseSync(sql).stmts.length, 1, name);
    }
  });

  // 18.1.5 parsed these; 18.2.7's 512kB WASM limit rejected them.
  it('parses nesting that 18.1.5 parsed', async () => {
    await loadModule();
    const nested = {
      'chained operators': 'SELECT 1' + '+1'.repeat(4000),
      'nested function calls': 'SELECT ' + 'f('.repeat(3200) + '1' + ')'.repeat(3200),
    };
    for (const [name, sql] of Object.entries(nested)) {
      assert.doesNotThrow(() => assert.equal(parseSync(sql).stmts.length, 1), name);
    }
    const blocks = {
      'nested IF blocks': ['IF true THEN ', 'NULL;', ' END IF;'],
      'nested BEGIN blocks': ['BEGIN ', 'NULL;', ' END;'],
      'nested loops': ['LOOP ', 'EXIT;', ' END LOOP;'],
    };
    for (const [name, [open, body, close]] of Object.entries(blocks)) {
      const sql = 'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ' +
        open.repeat(1000) + body + close.repeat(1000) + ' END $$';
      assert.doesNotThrow(() => assert.equal(lib.parsePlPgSQLSync(sql).plpgsql_funcs.length, 1), name);
    }
  });

  // Each nesting level of normalize used to cross from WASM into JS and back,
  // which V8 only makes cheap once an instance is warm: a fresh instance, like
  // the one that replaces an overflowed one, stopped at about 770 terms.
  it('normalizes deep nesting on an instance that just replaced an overflowed one', async () => {
    await loadModule();
    const chained = 'SELECT 1' + '+1'.repeat(3000);
    const normalized = 'SELECT $1' + Array.from({ length: 3000 }, (_, i) => `+$${i + 2}`).join('');
    for (let i = 0; i < 3; i++) {
      assert.throws(() => lib.normalizeSync(DEEP), /stack depth limit exceeded/);
      assert.equal(lib.normalizeSync(chained), normalized);
    }
  });

  // V8's native stack can run out inside a WASM call before libpg_query's own
  // check, e.g. in normalize, whose frames are larger there.
  it('reports a stack depth error, not a RangeError, for nesting too deep to parse', async () => {
    await loadModule();
    const subqueries = (n) => 'SELECT ' + '(SELECT '.repeat(n) + '1' + ')'.repeat(n);
    const tooDeep = [
      ['parseSync', DEEP],
      ['parseSync', subqueries(3000)],
      ['normalizeSync', DEEP],
      ['normalizeSync', subqueries(1000)],
    ];
    for (const [name, sql] of tooDeep) {
      assert.throws(() => lib[name](sql), (error) => {
        assert.ok(error instanceof lib.SqlError, `${name}: ${error}`);
        assert.equal(error.message, 'stack depth limit exceeded');
        return true;
      });
      assert.equal(parseSync('SELECT 1').stmts.length, 1);
    }
    await assert.rejects(lib.normalize(DEEP), lib.SqlError);
    assert.equal((await parse('SELECT 1')).stmts.length, 1);
  });

  it('frees replaced WASM heaps even when callers keep the errors', () => {
    const script = `const lib = require(${JSON.stringify(require.resolve('../wasm/index.cjs'))});
      (async () => {
        await lib.loadModule();
        lib.parseSync('SELECT 1');
        gc(); gc();
        const base = process.memoryUsage().external;
        const deep = 'SELECT 1' + '+1'.repeat(100000);
        const kept = [];
        for (let i = 0; i < 30; i++) {
          try { lib.parseSync(deep); } catch (error) { kept.push(error); }
          await lib.loadModule();
        }
        const huge = 'SELECT 1;\\n'.repeat(5000000);
        let yielded = false;
        setTimeout(() => { yielded = true; }, 0);
        const errors = [];
        try { await lib.parse(huge); } catch (error) { errors.push(error); }
        await lib.loadModule();
        if (!yielded) throw new Error('Async recovery did not yield after a large heap failure');
        try { lib.normalizeSync(huge); } catch (error) { errors.push(error); }
        lib.parseSync('SELECT 1');
        // V8 frees a dropped instance's memory on a later task, not in the same microtask run.
        await new Promise((resolve) => setTimeout(resolve, 0));
        gc(); gc();
        if (errors.length !== 2 || errors.some((error) => !error.message.includes('out of WASM memory'))) {
          throw new Error('Expected two WASM memory failures');
        }
        process.stdout.write('\\ngrown=' + (process.memoryUsage().external - base));
      })();`;
    // A non-zero exit code (libpg_query's exit() leaking out) makes execFileSync throw.
    // libpg_query prints a memory dump to stdout on out-of-memory, so read the last line.
    const output = execFileSync(process.execPath, ['--expose-gc', '-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const grown = Number(output.match(/^grown=(-?\d+)$/m)?.[1]);
    assert.ok(grown < 32 * 1024 * 1024, `WASM memory grew by ${grown} bytes after recovery`);
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

  it('waits for a large heap when sync parsing fails after async recovery is queued', async () => {
    const isolated = loadTrapping();
    await isolated.loadModule();
    isolated.trapNext();
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    const queued = isolated.parse('SELECT 1');

    let yielded = false;
    setTimeout(() => { yielded = true; }, 0);
    isolated.trapNext(1024 ** 3);
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);

    assert.equal((await queued).stmts.length, 1);
    assert.equal(yielded, true, 'async recovery skipped the large-heap yield');
  });

  it('throws an Error and recovers synchronously when the memory limit is hit', () => {
    const exitCode = process.exitCode;
    assert.throws(() => parseSync('SELECT 1;\n'.repeat(5000000)), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /out of WASM memory/);
      return true;
    });
    assert.equal(process.exitCode, exitCode);
    assert.equal(parseSync('SELECT 1').stmts.length, 1);
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
    await assert.rejects(isolated.parse('SELECT 1'), /Could not start a fresh WASM instance/);
    assert.equal((await isolated.parse('SELECT 1')).stmts.length, 1);
    assert.equal(loads, 3);
  });

  it('lets loadModule() reject on a failed reload and retry on the next call', async () => {
    let loads = 0;
    const isolated = loadTrapping(() => ++loads === 2);
    await isolated.loadModule();
    isolated.trapNext();
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    await assert.rejects(isolated.loadModule(), (error) => error.cause?.message === 'simulated load failure');
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

  it('retries a failed fresh load on the next sync call without awaiting', async () => {
    let loads = 0;
    const isolated = loadTrapping(() => ++loads === 2);
    await isolated.loadModule();
    isolated.trapNext();
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    assert.throws(() => isolated.parseSync('SELECT 1'), (error) => error.cause?.message === 'simulated load failure');
    assert.equal(loads, 2);
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
// stands for a trap or a stack overflow, a non-Error object for Emscripten's ExitStatus.
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
  const isolated = loadIsolated((module) => {
    const id = ++loads;
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
      if (name.endsWith('Sync')) isolated[name](query);
      else await isolated[name](query);
    } catch (error) {
      caught = error;
    } finally {
      var exitCodeAfter = process.exitCode;
      process.exitCode = exitCode;
    }
    assert.equal(exitCodeAfter, 0, `${name} changed process.exitCode`);
    assert.equal(frees, freesBefore, `${name} freed memory in the instance that threw`);
    const stale = used;
    const syncName = name.endsWith('Sync') ? name : 'parseSync';
    assert.ok(isolated[syncName](query), `${syncName} failed immediately after a trap`);
    assert.notEqual(used, stale, 'a sync call ran on the failed instance');
    assert.equal(loads, loadsBefore + 1, 'expected exactly one replacement');
    assert.ok(frees > freesBefore, 'a successful call did not free its memory');
    assert.ok(await isolated[name](query), `${name} failed after recovery`);
    assert.equal(used, loads, `${name} ran on the stale instance, not the fresh one`);
    return caught;
  }

  it('replaces each failed instance in one synchronous loop', async () => {
    await isolated.loadModule();
    const loadsBefore = loads;
    for (let i = 0; i < 60; i++) {
      throwNext = new RangeError('WASM trap');
      assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
      const failed = used;
      assert.equal(isolated.parseSync('SELECT 1').stmts.length, 1);
      assert.notEqual(used, failed);
    }
    assert.equal(loads, loadsBefore + 60);
  });

  it('makes loadModule() and queued calls wait again when a queued call breaks the fresh instance', async () => {
    await isolated.loadModule();
    throwNext = new RangeError('WASM trap');
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    const failing = isolated.parse('SELECT 1');
    throwNext = new RangeError('WASM trap');
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
    throwNext = new RangeError('WASM trap');
    assert.throws(() => isolated.parseSync('SELECT 1'), RangeError);
    const failing = isolated.parse('SELECT 1');
    throwNext = new RangeError('WASM trap');
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

  for (const name of ['fingerprintSync', 'normalizeSync', 'scanSync']) {
    it(`${name}: throws SqlError on a fresh instance without discarding it`, async () => {
      await isolated.loadModule();
      const loadsBefore = loads;
      throwNext = new RangeError('WASM trap');
      assert.throws(() => isolated[name]('SELECT 1'), RangeError);
      assert.throws(() => isolated[name]("SELECT 'abc"), isolated.SqlError);
      assert.equal(used, loadsBefore + 1);
      assert.ok(isolated[name]('SELECT 1'));
      assert.equal(loads, loadsBefore + 1);
    });
  }

  for (const [name, query] of entryPoints) {
    const skip = typeof isolated[name] !== 'function' && 'not in this build';

    it(`${name}: rethrows the original Error and recovers`, { skip }, async () => {
      const thrown = new RangeError('WASM trap');
      assert.equal(await failOnce(name, query, thrown), thrown);
    });

    it(`${name}: reports a V8 stack overflow as a stack depth error and recovers`, { skip }, async () => {
      const thrown = new RangeError('Maximum call stack size exceeded');
      const caught = await failOnce(name, query, thrown);
      assert.ok(caught instanceof isolated.SqlError);
      assert.equal(caught.message, 'stack depth limit exceeded');
      assert.equal(caught.cause, thrown);
    });

    it(`${name}: wraps a non-Error throw in an Error and recovers`, { skip }, async () => {
      const thrown = { name: 'ExitStatus', message: 'Program terminated with exit(1)', status: 1 };
      const caught = await failOnce(name, query, thrown);
      assert.ok(caught instanceof Error);
      assert.match(caught.message, /out of WASM memory/);
      assert.notEqual(caught.cause, thrown);
      assert.deepEqual(caught.cause, thrown);
    });
  }
});

// An isolated copy whose parse export throws once after trapNext(), standing in
// for a WASM trap now that libpg_query returns stack depth errors instead.
// failLoad() is called on each load; a true result rejects that load.
function loadTrapping(failLoad) {
  let trapHeapSize;
  const isolated = loadIsolated((module) => {
    const parseRaw = module._wasm_parse_query_raw;
    module._wasm_parse_query_raw = (...callArgs) => {
      if (trapHeapSize === undefined) return parseRaw(...callArgs);
      if (trapHeapSize) module.HEAPU8 = { length: trapHeapSize };
      trapHeapSize = undefined;
      throw new RangeError('WASM trap');
    };
  }, failLoad);
  isolated.trapNext = (heapSize = 0) => { trapHeapSize = heapSize; };
  return isolated;
}

// A copy of the wrapper whose WASM factory is wrapped, leaving the shared copy alone.
function loadIsolated(decorate, failLoad = () => false) {
  const indexPath = require.resolve('../wasm/index.cjs');
  const factory = require.cache[require.resolve('../wasm/libpg-query.js')];
  const shared = require.cache[indexPath];
  const realFactory = factory.exports;
  factory.exports = (options = {}) => {
    if (failLoad()) {
      options.initError = new Error('simulated load failure');
      return Promise.reject(options.initError);
    }
    const loading = realFactory(options);
    if (options.readySync) {
      decorate(options);
      return loading;
    }
    return loading.then((module) => {
      decorate(module);
      return module;
    });
  };
  delete require.cache[indexPath];
  try {
    return require(indexPath);
  } finally {
    factory.exports = realFactory;
    require.cache[indexPath] = shared;
  }
}
