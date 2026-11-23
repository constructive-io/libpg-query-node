const { execFileSync } = require('child_process');
const fs = require('fs');
const glob = require('glob');
const os = require('os');
const path = require('path');

const versionDir = path.join(__dirname, '../versions/18');
const { libpgQueryCommit: commit } = require(path.join(versionDir, 'package.json'))['x-publish'];
const source = path.join(versionDir, '.cache/emscripten-wasm/libpg_query', commit);

async function main() {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing ${source}; run pnpm build in versions/18 first`);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'libpg-query-native-'));
  try {
    await checkParity(work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function checkParity(work) {
  execFileSync('bash', ['-o', 'pipefail', '-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', '--', source, commit, work]);
  execFileSync('make', ['-j', String(os.availableParallelism()), 'build'], {
    cwd: work,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const driver = path.join(work, 'parity-driver');
  execFileSync('cc', [
    '-O2', '-I', work, path.join(__dirname, 'native-parity.c'),
    path.join(work, 'libpg_query.a'), '-pthread', '-o', driver,
  ]);

  const files = glob.sync('test/{sql/**/*.{sql,psql},plpgsql_samples.sql}', { cwd: work }).sort();
  const statements = [];
  let skippedFiles = 0;
  for (const file of files) {
    const split = JSON.parse(execFileSync(driver, ['split', path.join(work, file)], { maxBuffer: 128 * 1024 ** 2 }));
    if (split.error) {
      skippedFiles++; // Some fixtures intentionally contain unscannable SQL.
      continue;
    }
    split.stmts.forEach((sql, i) => statements.push({ key: `${file}#${i + 1}`, sql }));
  }
  if (!statements.length) throw new Error('No libpg_query test statements found');

  const input = path.join(work, 'statements.bin');
  fs.writeFileSync(input, statements.map(({ sql }) => sql).join('\0') + '\0');
  const output = path.join(work, 'native.jsonl');
  const fd = fs.openSync(output, 'w');
  try {
    execFileSync(driver, ['parse', input], { stdio: ['ignore', fd, 'inherit'] });
  } finally {
    fs.closeSync(fd);
  }
  const native = fs.readFileSync(output, 'utf8').trimEnd().split('\n');
  if (native.length !== statements.length) {
    throw new Error(`Native parser returned ${native.length} results for ${statements.length} statements`);
  }

  const wasm = require(path.join(versionDir, 'wasm/index.cjs'));
  await wasm.loadModule();

  let differences = 0;
  statements.forEach(({ key, sql }, i) => {
    // FETCH_ALL is LONG_MAX: 64-bit on the native runner, 32-bit on wasm32.
    const expected = JSON.parse(native[i].replace(
      /("(?:howMany|how_many)"\s*:\s*)9223372036854775807(?=\s*[,}])/g,
      (_, field) => field + '2147483647',
    ));
    if (expected.error) {
      // SqlError exposes a zero-based cursor and reports a missing cursor as 0.
      expected.error.cursorpos = Math.max(0, expected.error.cursorpos - 1);
    }
    let actual;
    try {
      actual = { parse: wasm.parseSync(sql) };
    } catch (err) {
      actual = { error: { message: err.message, cursorpos: err.sqlDetails?.cursorPosition } };
    }
    const a = JSON.stringify(expected);
    const b = JSON.stringify(actual);
    if (a === b) return;
    differences++;
    if (differences <= 10) console.error(key, { native: a.slice(0, 300), wasm: b.slice(0, 300) });
  });

  console.log(`Native parity: ${statements.length} statements from ${files.length - skippedFiles} files (${skippedFiles} unscannable) @ ${commit.slice(0, 7)}, ${differences} differences`);
  if (differences) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
