#!/usr/bin/env node
/**
 * Checks that a built versions/<n>/wasm parses exactly like libpg_query compiled natively
 * from the same commit, over libpg_query's test SQL: test/sql/postgres_regress and
 * plpgsql_regress (the PostgreSQL regression suite) plus its own deparse tests.
 *
 *   node scripts/native-parity.js versions/18     (after `pnpm build` in that directory)
 *
 * Reuses the libpg_query checkout the WASM build cloned into .cache, so it needs no network.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const glob = require('glob');
const os = require('os');
const path = require('path');

// FETCH_ALL is LONG_MAX, which is 32-bit on wasm32
const FETCH_ALL_NATIVE = 9223372036854775807;
const FETCH_ALL_WASM = 2147483647;

async function main() {
  const versionDir = path.resolve(process.argv[2] || '.');
  const commit = require(path.join(versionDir, 'package.json'))['x-publish'].libpgQueryCommit;
  const [source] = glob.sync(`.cache/*/libpg_query/${commit}`, { cwd: versionDir, absolute: true });
  if (!source) throw new Error(`no libpg_query checkout for ${commit} under ${versionDir}/.cache; run pnpm build first`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'libpg-query-native-'));
  try {
    await checkParity(versionDir, source, commit, work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function checkParity(versionDir, source, commit, work) {
  execFileSync('sh', ['-c', `git -C "${source}" archive ${commit} | tar -x -C "${work}"`]);
  // glibc >= 2.38 declares strchrnul, which PG <= 14's vendored snprintf.c would otherwise redefine
  const cppflags = process.platform === 'linux' ? 'CPPFLAGS=-DHAVE_STRCHRNUL=' : 'CPPFLAGS=';
  execFileSync('make', ['-j', String(os.cpus().length), cppflags, 'build'], { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
  const driver = path.join(work, 'parity-driver');
  execFileSync('cc', ['-O2', '-I', work, path.join(__dirname, 'native-parity/driver.c'), path.join(work, 'libpg_query.a'), '-lpthread', '-o', driver]);

  const files = glob.sync('test/{sql/**/*.{sql,psql},plpgsql_samples.sql}', { cwd: work }).sort();
  const statements = [];
  for (const file of files) {
    const split = JSON.parse(execFileSync(driver, ['split', path.join(work, file)], { maxBuffer: 1 << 28 }).toString());
    if (split.error) continue; // e.g. strings.sql: intentionally invalid escapes the scanner rejects
    split.stmts.forEach((sql, i) => statements.push({ key: `${file}#${i}`, sql }));
  }

  const input = path.join(work, 'statements.bin');
  fs.writeFileSync(input, Buffer.concat(statements.map(({ sql }) => Buffer.from(sql + '\0'))));
  const output = path.join(work, 'native.jsonl');
  const fd = fs.openSync(output, 'w');
  execFileSync(driver, ['parse', input], { stdio: ['ignore', fd, 'inherit'] });
  fs.closeSync(fd);
  const native = fs.readFileSync(output, 'utf8').trimEnd().split('\n');

  const wasm = require(path.join(versionDir, 'wasm/index.cjs'));
  await wasm.loadModule();

  const diffs = [];
  statements.forEach(({ key, sql }, i) => {
    const expected = JSON.parse(native[i]);
    let actual;
    try {
      actual = { parse: wasm.parseSync(sql) };
    } catch (err) {
      actual = { error: { message: err.message, cursorpos: err.sqlDetails ? err.sqlDetails.cursorPosition + 1 : undefined } };
    }
    if (expected.error && actual.error && expected.error.cursorpos === 0) expected.error.cursorpos = 1;
    const normalize = (value) =>
      JSON.stringify(value, (k, v) => ((k === 'howMany' || k === 'how_many') && v === FETCH_ALL_NATIVE ? FETCH_ALL_WASM : v));
    const a = normalize(expected);
    const b = JSON.stringify(actual);
    if (a !== b) diffs.push({ key, native: a.slice(0, 300), wasm: b.slice(0, 300) });
  });

  console.log(`native parity: ${statements.length} statements from ${files.length} files @ ${commit.slice(0, 7)}, ${diffs.length} differences`);
  for (const d of diffs.slice(0, 10)) console.log(JSON.stringify(d, null, 2));
  if (diffs.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
