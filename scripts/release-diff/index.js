#!/usr/bin/env node
// Release diff: runs the version's test suite and the pgsql-parser fixtures
// through the last published libpg-query and the candidate build in
// versions/<major>/wasm, and fails on any difference the allowlist doesn't name.
//
//   node scripts/release-diff [--major 18] [--baseline pg18|18.1.5]
//     [--fixtures ../pgsql-parser] [--allow versions/18/release-diff.allow.json]
//     [--skip-tests]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const edgeCases = require('./edge-cases');
const { loadAllowlist, allows } = require('./allowlist');

const ROOT = path.resolve(__dirname, '../..');
const SQL_FNS = ['parse', 'fingerprint', 'normalize', 'scan'];
const INPUT_TIMEOUT_MS = 120000;
const TEST_FILE_TIMEOUT_MS = 300000;
// A bigger JS stack than Node's default (~1 MB, still inside the 8 MB thread
// stack), so deep JSON from either build reaches the comparison instead of a
// RangeError whose depth depends on the machine.
const JS_STACK_KB = 4000;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'skip-tests') args.skipTests = true;
    else args[key] = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const major = args.major || process.env.RELEASE_DIFF_MAJOR || '18';
const versionDir = path.join(ROOT, 'versions', major);
const workDir = path.join(versionDir, '.release-diff');
const pkg = JSON.parse(fs.readFileSync(path.join(versionDir, 'package.json'), 'utf8'));
const publishName = pkg['x-publish'].publishName;
const baselineSpec = args.baseline || process.env.RELEASE_DIFF_BASELINE || pkg['x-publish'].distTag;
const allowFile = path.resolve(args.allow || path.join(versionDir, 'release-diff.allow.json'));

const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', ...opts }).trim();

function fetchBaseline() {
  const version = JSON.parse(sh('npm', ['view', `${publishName}@${baselineSpec}`, 'version', '--json', '--loglevel=error']));
  const dir = path.join(workDir, `baseline-${version}`);
  if (!fs.existsSync(path.join(dir, 'wasm', 'index.cjs'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tarball = sh('npm', ['pack', `${publishName}@${version}`, '--pack-destination', workDir, '--loglevel=error']).split('\n').pop();
    sh('tar', ['-xzf', path.join(workDir, tarball), '-C', dir, '--strip-components=1']);
    fs.rmSync(path.join(workDir, tarball));
  }
  return { version, dir };
}

function fixturesDir() {
  const dir = args.fixtures || process.env.PGSQL_PARSER_DIR;
  if (dir) return path.resolve(dir);
  const clone = path.join(workDir, 'pgsql-parser');
  if (!fs.existsSync(clone)) {
    sh('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/constructive-io/pgsql-parser.git', clone]);
    sh('git', ['-C', clone, 'sparse-checkout', 'set', '__fixtures__/generated', '__fixtures__/plpgsql-generated']);
  }
  return clone;
}

function loadInputs(fixtures) {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(fixtures, '__fixtures__', file), 'utf8'));
  const inputs = [];
  for (const [name, sql] of Object.entries(read('generated/generated.json'))) {
    inputs.push({ id: `kitchen-sink:${name}`, sql, fns: SQL_FNS });
  }
  for (const [name, sql] of Object.entries(read('plpgsql-generated/generated.json'))) {
    inputs.push({ id: `plpgsql:${name}`, sql, fns: ['parsePlPgSQL'] });
  }
  return inputs.concat(edgeCases());
}

function runCollector(baselineDir, baselineVersion, inputsFile, start) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--stack-size=${JS_STACK_KB}`, path.join(__dirname, 'collect.js'), baselineDir, versionDir, inputsFile, String(start), allowFile, baselineVersion], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = [];
    let buffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const part of parts) if (part) lines.push(JSON.parse(part));
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let timer;
    const idle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => child.kill('SIGKILL'), INPUT_TIMEOUT_MS);
    };
    idle();
    child.stdout.on('data', idle);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      testGroups.delete(child.pid);
      resolve({ lines, code, signal, stderr });
    });
  });
}

async function diffCorpus(baseline, inputs) {
  const inputsFile = path.join(workDir, 'inputs.json');
  fs.writeFileSync(inputsFile, JSON.stringify(inputs));
  const diffs = [];
  let compared = 0;
  let start = 0;
  while (start < inputs.length) {
    const { lines, code, signal, stderr } = await runCollector(baseline.dir, baseline.version, inputsFile, start);
    let at = start;
    let next = null;
    for (const line of lines) {
      if (line.type === 'at') at = line.i;
      else if (line.type === 'diff') diffs.push(line);
      else if (line.type === 'compared') compared += line.count;
      else if (line.type === 'restart') next = line.next;
      else if (line.type === 'done') next = inputs.length;
    }
    if (next === null) {
      // The process died inside an input: count it as a difference, since a
      // release that crashes on it is one, and carry on after it.
      if (at === start && !lines.length && code) throw new Error(`collector failed to start:\n${stderr}`);
      const reason = signal === 'SIGKILL' ? `no result after ${INPUT_TIMEOUT_MS / 1000}s` : signal ? `signal ${signal}` : `exit code ${code}`;
      diffs.push({ id: `${inputs[at].id}:*`, baseline: { error: 'unknown' }, candidate: { error: `process died (${reason})` } });
      next = at + 1;
    }
    start = next;
  }
  return { diffs, compared };
}

function testFiles() {
  return pkg.scripts.test.split(/\s+/).filter((arg) => /^test\/.*\.js$/.test(arg));
}

// One file at a time with a wall-clock limit: a WASM call that never returns
// blocks the event loop, so node:test's own timeouts can't stop it. The file
// runs in its own process group so a timeout kills node:test's workers too.
const testGroups = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const pid of testGroups) {
      try { process.kill(-pid, 'SIGKILL'); } catch (e) {}
    }
    process.exit(1);
  });
}

function runTestFile(cwd, file, out) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--test',
      `--test-reporter=${path.join(__dirname, 'reporter.js')}`,
      `--test-reporter-destination=${out}`,
      file,
    ], { cwd, stdio: 'ignore', detached: true });
    testGroups.add(child.pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
    }, TEST_FILE_TIMEOUT_MS);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      testGroups.delete(child.pid);
      resolve({
        status: timedOut ? 'timeout' : code === 0 ? 'pass' : `exit ${code}`,
        output: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '',
      });
    });
  });
}

// Each file also gets a `<file>` entry with its exit status, so a file that
// times out or fails outside a test is a difference too.
async function runTests(cwd, files, label) {
  const results = new Map();
  for (const file of files) {
    const out = path.join(workDir, `tests-${label}-${path.basename(file)}.jsonl`);
    fs.rmSync(out, { force: true });
    const { status, output } = await runTestFile(cwd, file, out);
    results.set(file, status);
    for (const line of output.split('\n')) {
      if (!line) continue;
      const { key, status } = JSON.parse(line);
      let unique = key;
      for (let n = 2; results.has(unique); n++) unique = `${key} #${n}`;
      results.set(unique, status);
    }
  }
  return results;
}

// The baseline runs the candidate's tests, so tests for new fixes fail there;
// only a test the published release passes and the candidate fails is a diff.
async function diffTests(baselineDir) {
  const files = testFiles();
  fs.rmSync(path.join(baselineDir, 'test'), { recursive: true, force: true });
  fs.cpSync(path.join(versionDir, 'test'), path.join(baselineDir, 'test'), { recursive: true });
  const [baseline, candidate] = await Promise.all([runTests(baselineDir, files, 'baseline'), runTests(versionDir, files, 'candidate')]);
  const diffs = [];
  for (const [key, status] of baseline) {
    if (status !== 'pass') continue;
    const now = candidate.get(key) || 'missing';
    if (now !== 'pass') diffs.push({ id: `test:${key}`, baseline: { error: 'pass' }, candidate: { error: now } });
  }
  const skipped = files.filter((file) => baseline.get(file) === 'timeout');
  return { diffs, compared: baseline.size, skipped };
}

function show(outcome) {
  return 'ok' in outcome ? outcome.ok : JSON.stringify(outcome);
}

function report(baselineVersion, results, allowlist) {
  const failures = [];
  let allowed = 0;
  for (const diff of results.flatMap((result) => result.diffs)) {
    const entry = diff.allowedBy !== undefined
      ? allowlist[diff.allowedBy]
      : allowlist.find((candidate) => !candidate.ignoreKeys && allows(candidate, diff));
    if (entry) {
      entry.used++;
      allowed++;
    } else {
      failures.push(diff);
    }
  }
  const compared = results.reduce((sum, result) => sum + result.compared, 0);
  const lines = [
    `## Release diff: ${publishName}@${baselineVersion} vs candidate ${pkg.version}`,
    '',
    `${compared} outputs and tests compared, ${allowed} allowed differences, ${failures.length} unexpected.`,
    '',
  ];
  if (failures.length) {
    lines.push('| Input | Published | Candidate |', '| --- | --- | --- |');
    const cell = (text) => '`' + text.replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\n/g, ' ') + '`';
    for (const diff of failures.slice(0, 200)) {
      lines.push(`| ${cell(diff.id)} | ${cell(show(diff.baseline))} | ${cell(show(diff.candidate))} |`);
    }
    if (failures.length > 200) lines.push('', `…and ${failures.length - 200} more in report.json.`);
    lines.push('', `Fix the regression, or add the difference to ${path.relative(ROOT, allowFile)} with the reason it is intended.`);
  }
  const skipped = results.flatMap((result) => result.skipped || []);
  if (skipped.length) {
    lines.push('', `Test files that timed out on ${publishName}@${baselineVersion}, so their tests were not compared: ${skipped.join(', ')}`);
  }
  const stale = allowlist.filter((entry) => !entry.used);
  if (stale.length) {
    lines.push('', 'Allowlist entries that matched nothing (remove them once the release that needed them is the baseline):');
    for (const entry of stale) lines.push(`- \`${entry.id}\``);
  }
  const markdown = lines.join('\n') + '\n';
  process.stdout.write(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  fs.writeFileSync(path.join(workDir, 'report.json'), JSON.stringify({ baseline: baselineVersion, compared, allowed, failures }, null, 2));
  return failures.length;
}

(async () => {
  if (!fs.existsSync(path.join(versionDir, 'wasm', 'index.cjs'))) {
    throw new Error(`No candidate build in ${path.relative(ROOT, versionDir)}/wasm; build it first.`);
  }
  fs.mkdirSync(workDir, { recursive: true });
  const baseline = fetchBaseline();
  console.log(`Comparing ${publishName}@${baseline.version} with the candidate build of ${pkg.name}@${pkg.version}`);
  const inputs = loadInputs(fixturesDir());
  const results = [await diffCorpus(baseline, inputs)];
  if (!args.skipTests) results.push(await diffTests(baseline.dir));
  const failures = report(baseline.version, results, loadAllowlist(allowFile, baseline.version));
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
