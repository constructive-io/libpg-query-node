const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { appendFileSync } = require('node:fs');
const { build } = require('esbuild-wasm');
const { firefox, webkit } = require('playwright');
const { chained, subqueries, calls, blocks } = require('./wasm-depth-cases');

const baseline = require('libpg-query-baseline/package.json').version;
const builds = {
  [baseline]: path.dirname(require.resolve('libpg-query-baseline')),
  candidate: path.resolve(__dirname, '../wasm'),
};
const cases = [
  ['Chained operators', 'parseSync', chained, 4000, 100000],
  ['Nested subqueries', 'parseSync', subqueries, 1000, 10000],
  ['Nested function calls', 'parseSync', calls, 2000, 10000],
  ...Object.entries(blocks).map(([name, sql]) => [name, 'parsePlPgSQLSync', sql, 1000, 10000]),
  ['Normalize operators', 'normalizeSync', chained, 100, 100000],
  ['Normalize subqueries', 'normalizeSync', subqueries, 100, 10000],
];

async function openParser(browser, dir) {
  const { outputFiles } = await build({
    entryPoints: [path.join(dir, 'index.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    external: ['node:*'],
    write: false,
  });
  const page = await browser.newPage();
  const origin = 'http://libpg-query.test';
  await page.route(origin + '/**', (route) => {
    switch (new URL(route.request().url()).pathname) {
      case '/': return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
      case '/parser.js': return route.fulfill({ contentType: 'text/javascript', body: outputFiles[0].text });
      case '/libpg-query.wasm': return route.fulfill({
        contentType: 'application/wasm', path: path.join(dir, 'libpg-query.wasm'),
      });
      default: return route.abort();
    }
  });
  await page.goto(origin);
  return page;
}

async function probe(page, { method, queries, expectedParameters, fresh = false, repeats = 1 }) {
  return page.evaluate(async ({ method, queries, expectedParameters, fresh, repeats }) => {
    // An import with a new URL gives each input family its own WASM instance.
    if (fresh || !globalThis.parser) {
      globalThis.parser = await import('/parser.js?' + (globalThis.instance = (globalThis.instance || 0) + 1));
      await globalThis.parser.loadModule();
    }
    const lib = globalThis.parser;
    const results = [];
    for (let i = 0; i < queries.length; i++) {
      const sql = queries[i];
      for (let j = 0; j < repeats; j++) {
        try {
          const result = await lib[method](sql);
          const valid = method === 'normalizeSync' || method === 'normalize'
            ? typeof result === 'string' && result.startsWith('SELECT ') &&
              (result.match(/\$/g) || []).length === expectedParameters?.[i]
            : method === 'parsePlPgSQLSync' ? result.plpgsql_funcs?.length === 1 : result.stmts?.length === 1;
          results.push(valid ? null : { message: typeof result === 'string' ? result.slice(0, 120) : 'Unexpected result' });
        } catch (error) {
          results.push({ name: error.name, message: error.message, sqlError: error instanceof lib.SqlError });
        }
        if (lib.parseSync('SELECT 1').stmts.length !== 1) throw new Error('Parser did not recover');
      }
    }
    if ((await lib.parse('SELECT 1')).stmts.length !== 1) throw new Error('Async parse did not recover');
    return results;
  }, { method, queries, expectedParameters, fresh, repeats });
}

function assertLimit(error, version, name) {
  assert.ok(error, `${version}: ${name} unexpectedly succeeded`);
  if (version === 'candidate') {
    assert.equal(error.message, 'stack depth limit exceeded', name);
    assert.equal(error.sqlError, true, name);
  } else {
    assert.match(error.message, /call stack|too much recursion|stack depth limit exceeded|^memory exhausted at or near/i, name);
  }
}

async function measure(page, version, name, method, sql, floor, ceiling) {
  const tryDepth = async (depth, fresh) => (await probe(page, {
    method,
    queries: [sql(depth)],
    expectedParameters: [sql === chained ? depth + 1 : 1],
    fresh,
  }))[0];
  assert.equal(await tryDepth(floor, true), null, `${version}: ${name} at depth ${floor}`);

  // WASM tiering can move the host overflow boundary by a few frames. Compare
  // depths at 100-level resolution rather than treating frame counts as an ABI.
  const step = 100;
  let low = floor / step;
  let high = ceiling / step;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const error = await tryDepth(mid * step);
    if (!error) low = mid;
    else high = mid;
  }
  return { depth: low * step, error: await tryDepth(ceiling) };
}

const engines = { firefox, webkit };
const selected = process.env.BROWSER;
if (selected && !Object.hasOwn(engines, selected)) throw new Error(`Unknown browser: ${selected}`);

for (const [name, engine] of Object.entries(engines)) {
  if (selected && name !== selected) continue;
  test(name, { timeout: 240000 }, async (t) => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const pages = Object.fromEntries(await Promise.all(Object.entries(builds).map(async ([version, dir]) =>
      [version, await openParser(browser, dir)])));
    const rows = [`| ${name} ${browser.version()} | ${baseline} | Candidate |`, '| --- | ---: | ---: |'];
    for (const [label, method, sql, floor, ceiling] of cases) {
      await t.test(label, async () => {
        const published = await measure(pages[baseline], baseline, label, method, sql, floor, ceiling);
        const candidate = await measure(pages.candidate, 'candidate', label, method, sql, floor, ceiling);
        rows.push(`| ${label} | ${published.depth} | ${candidate.depth} |`);
        assertLimit(published.error, baseline, label);
        assertLimit(candidate.error, 'candidate', label);
        assert.ok(candidate.depth >= published.depth, `${label}: depth fell from ${published.depth} to ${candidate.depth}`);
      });
    }
    await t.test('recovers after repeated synchronous and asynchronous overflows', async () => {
      for (const [version, page] of Object.entries(pages)) {
        const options = { queries: [chained(100000)] };
        const errors = await probe(page, { ...options, method: 'parseSync', fresh: true, repeats: 60 });
        for (const error of errors) assertLimit(error, version, 'parseSync');
        const [error] = await probe(page, { ...options, method: 'normalize' });
        assertLimit(error, version, 'normalize');
      }
    });
    const summary = rows.join('\n') + '\n';
    console.log('\n' + summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  });
}
