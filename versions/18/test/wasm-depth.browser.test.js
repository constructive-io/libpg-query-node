const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { appendFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { build } = require('esbuild-wasm');
const { firefox, webkit } = require('playwright');
const { chained, subqueries, calls, blocks } = require('./wasm-depth-cases');

const baseline = require('libpg-query-baseline/package.json').version;
const builds = {
  [baseline]: path.dirname(require.resolve('libpg-query-baseline')),
  candidate: path.resolve(__dirname, '../wasm'),
};
const cases = [
  ['Chained operators', 'parseSync', chained, 4000, 32000],
  ['Nested subqueries', 'parseSync', subqueries, 1000, 10000],
  ['Nested function calls', 'parseSync', calls, 2000, 10000],
  ...Object.entries(blocks).map(([name, sql]) => [name, 'parsePlPgSQLSync', sql, 1000, 10000]),
  ['Normalize operators', 'normalizeSync', chained, 100, 32000],
  // PostgreSQL's grammar caps nested subqueries at just over 3300.
  ['Normalize subqueries', 'normalizeSync', subqueries, 100, 3400],
];

async function bundleParser(dir) {
  const { outputFiles } = await build({
    entryPoints: [path.join(dir, 'index.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['node:*'],
    write: false,
  });
  return outputFiles[0].text;
}

async function openParser(browser, version, dir, script) {
  const page = await browser.newPage();
  const origin = 'http://libpg-query.test';
  await page.route(origin + '/**', (route) => {
    switch (new URL(route.request().url()).pathname) {
      case '/': return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      case '/parser.js': return route.fulfill({ contentType: 'text/javascript', body: script });
      case '/libpg-query.wasm': return route.fulfill({
        contentType: 'application/wasm', path: path.join(dir, 'libpg-query.wasm'),
      });
      default: return route.abort();
    }
  });
  await page.goto(origin + '/?build=' + version);
  return page;
}

async function probe(page, { method, query, expectedParameters, fresh = false, warmup, depth }) {
  if (fresh) await page.reload();
  const label = `${page.url()} ${method} depth=${depth ?? 'recovery'}`;
  const slow = setTimeout(() => console.log(`Slow browser probe: ${label}`), 15000);
  try {
    if (fresh || warmup) {
      await page.evaluate(async ({ method, warmup }) => {
        globalThis.parser ??= await import('/parser.js');
        await globalThis.parser.loadModule();
        if (warmup) for (let i = 0; i < 20; i++) globalThis.parser[method](warmup);
      }, { method, warmup });
      // Give the engine time to finish background compilation without relying
      // on timers in a potentially backgrounded browser tab.
      if (warmup) await delay(20);
    }
    return await evaluateQuery(page, { method, query, expectedParameters });
  } finally {
    clearTimeout(slow);
  }
}

async function evaluateQuery(page, { method, query, expectedParameters }) {
  return page.evaluate(async ({ method, query, expectedParameters }) => {
    if (!globalThis.parser) {
      globalThis.parser = await import('/parser.js');
      await globalThis.parser.loadModule();
    }
    const lib = globalThis.parser;
    let error = null;
    let result;
    try {
      result = await lib[method](query);
    } catch (e) {
      error = { name: e.name, message: e.message, sqlError: e instanceof lib.SqlError };
    }
    assertRecovered(lib.parseSync('SELECT 1'));
    assertRecovered(await lib.parse('SELECT 1'));
    if (error) return error;
    // 18.1.5 can return a diagnostic string from normalize rather than throw it.
    if (typeof result === 'string' &&
        (result.startsWith('memory exhausted at or near ') || result === 'stack depth limit exceeded')) {
      return { message: result, sqlError: false };
    }
    const valid = method.startsWith('normalize')
      ? typeof result === 'string' && result.startsWith('SELECT ') &&
        (expectedParameters === undefined || (result.match(/\$/g) || []).length === expectedParameters)
      : method.startsWith('parsePlPgSQL') ? result.plpgsql_funcs?.length === 1 : result.stmts?.length === 1;
    if (!valid) throw new Error(`${method} returned an unexpected result`);
    return null;

    function assertRecovered(result) {
      if (result.stmts.length !== 1) throw new Error('Parser did not recover');
    }
  }, { method, query, expectedParameters });
}

const grammarLimit = /^memory exhausted at or near /;
const depthStep = 100;

function assertLimit(error, version, name, publishedError) {
  assert.ok(error, `${version}: ${name} unexpectedly succeeded`);
  if (version === 'candidate') {
    // For the fixed grammar stack limit, preserve PostgreSQL's own diagnostic.
    const message = grammarLimit.test(error.message) && grammarLimit.test(publishedError?.message)
      ? publishedError.message : 'stack depth limit exceeded';
    assert.equal(error.message, message, name);
    assert.equal(error.sqlError, true, name);
  } else {
    assert.ok(grammarLimit.test(error.message) ||
      /call stack|too much recursion|stack depth limit exceeded/i.test(error.message), `${name}: ${error.message}`);
  }
}

async function measure(page, version, name, method, sql, floor, ceiling) {
  const tryDepth = (depth, warmup) => probe(page, {
    depth,
    method,
    query: sql(depth),
    expectedParameters: sql === chained ? depth + 1 : 1,
    fresh: true,
    warmup,
  });
  assert.equal(await tryDepth(floor), null, `${version}: ${name} at depth ${floor}`);

  // Warm each instance before probing: tiering changes host frame sizes.
  // Report the resulting estimates on a 100-level grid.
  let low = floor / depthStep;
  let high = ceiling / depthStep;
  const warmup = sql(floor);
  const limit = await tryDepth(ceiling, warmup);
  let error = limit;
  assert.ok(limit, `${version}: ${name} exceeded the depth search ceiling ${ceiling}`);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const result = await tryDepth(mid * depthStep, warmup);
    if (!result) low = mid;
    else {
      error = result;
      high = mid;
    }
  }
  return { depth: low * depthStep, error, limit };
}

const engines = { firefox, webkit };
const selected = process.env.WASM_TEST_BROWSER;
if (selected && !Object.hasOwn(engines, selected)) throw new Error(`Unknown browser: ${selected}`);

for (const [name, engine] of Object.entries(engines)) {
  if (selected && name !== selected) continue;
  // The published normalizer's subquery probes can each take over 15s on
  // macOS WebKit. Leave time for those probes without relaxing their checks.
  test(name, { timeout: 600000 }, async (t) => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const bundles = await Promise.all(Object.entries(builds).map(async ([version, dir]) =>
      [version, dir, await bundleParser(dir)]));
    const openPages = async (subtest) => Object.fromEntries(await Promise.all(
      bundles.map(async ([version, dir, script]) => {
        const page = await openParser(browser, version, dir, script);
        subtest.after(() => page.context().close());
        return [version, page];
      })
    ));
    const rows = [`| ${name} ${browser.version()} | ${baseline} | Candidate |`, '| --- | ---: | ---: |'];
    for (const [label, method, sql, floor, ceiling] of cases) {
      await t.test(label, async (subtest) => {
        // Don't retain browser resources from earlier searches. Each search
        // reloads the page and instantiates a fresh WASM heap for each probe.
        const pages = await openPages(subtest);
        const run = version => measure(pages[version], version, label, method, sql, floor, ceiling);
        let published = await run(baseline);
        let candidate = await run('candidate');
        if (candidate.depth < published.depth - depthStep) {
          // A single measurement can straddle WebKit's concurrent WASM tier-up.
          // Require the loss to reproduce in the median of three searches.
          const median = results => results.sort((a, b) => a.depth - b.depth)[1];
          published = median([published, await run(baseline), await run(baseline)]);
          candidate = median([candidate, await run('candidate'), await run('candidate')]);
        }
        rows.push(`| ${label} | ${published.depth} | ${candidate.depth} |`);
        assertLimit(published.error, baseline, label);
        assertLimit(published.limit, baseline, label);
        let publishedDiagnostic = published.limit;
        if (method === 'normalizeSync' && grammarLimit.test(candidate.limit.message) &&
            !grammarLimit.test(publishedDiagnostic.message)) {
          // The old normalizer may overflow before the underlying SQL grammar does.
          publishedDiagnostic = await probe(pages[baseline], {
            method: 'parseSync', query: sql(ceiling), fresh: true,
          });
        }
        assertLimit(candidate.error, 'candidate', label, publishedDiagnostic);
        assertLimit(candidate.limit, 'candidate', label, publishedDiagnostic);
        assert.ok(candidate.depth >= published.depth - depthStep,
          `${label}: depth fell from ${published.depth} to ${candidate.depth}`);
        if (method === 'normalizeSync') {
          const page = pages.candidate;
          const warmup = sql(floor);
          assert.equal(await probe(page, { method, query: warmup, warmup, fresh: true }), null);
          // A grammar error may leave the original instance intact. Force a
          // host overflow after warming the code, then exercise the replacement.
          const overflow = await probe(page, { method: 'parseSync', query: chained(32000) });
          assertLimit(overflow, 'candidate', label);
          const depth = Math.max(floor, published.depth - depthStep);
          const afterOverflow = await probe(page, {
            method, query: sql(depth), expectedParameters: sql === chained ? depth + 1 : 1,
          });
          assert.equal(afterOverflow, null, `${label}: cannot reach published depth after overflow`);
        }
      });
    }
    const summary = rows.join('\n') + '\n';
    console.log('\n' + summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    await t.test('recovers after synchronous and asynchronous overflows', async (subtest) => {
      const pages = await openPages(subtest);
      for (const [version, page] of Object.entries(pages)) {
        const query = chained(32000);
        // 18.1.5 reuses an instance after a host overflow. Measure recovery from
        // one overflow there, then repeat on the candidate across browser tasks.
        const attempts = version === 'candidate' ? 8 : 1;
        for (let i = 0; i < attempts; i++) {
          const error = await probe(page, { query, method: 'parseSync', fresh: i === 0 });
          assertLimit(error, version, 'parseSync');
        }
        const error = await probe(page, { query, method: 'normalize', fresh: version !== 'candidate' });
        assertLimit(error, version, 'normalize');
      }
    });
  });
}
