// Child process for index.js: runs inputs [start, end) through the baseline and
// the candidate build and prints one JSON line per difference. It stops after
// the first input that throws, so a trapped or half-broken WASM instance never
// leaks into the next input: the parent starts a fresh process from `next`.
const fs = require('node:fs');
const { loadAllowlist, allows, withoutKeys } = require('./allowlist');

const [baselineDir, candidateDir, inputsFile, startArg, allowFile, baselineVersion] = process.argv.slice(2);
const keyRules = loadAllowlist(allowFile, baselineVersion)
  .map((entry, index) => ({ ...entry, index, keys: new Set(entry.ignoreKeys || []) }))
  .filter((entry) => entry.keys.size);
const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
const libs = [require(baselineDir), require(candidateDir)];

const FNS = {
  parse: (lib, sql) => {
    const { version, ...rest } = lib.parseSync(sql);
    return JSON.stringify(rest);
  },
  fingerprint: (lib, sql) => lib.fingerprintSync(sql),
  normalize: (lib, sql) => lib.normalizeSync(sql),
  scan: (lib, sql) => {
    const { version, ...rest } = lib.scanSync(sql);
    return JSON.stringify(rest);
  },
  parsePlPgSQL: (lib, sql) => JSON.stringify(lib.parsePlPgSQLSync(sql)),
};

// Source file and line of a SqlError move with any C change, so only the
// message and cursor position count as behavior.
function describeError(error) {
  const details = error && error.sqlDetails;
  if (details) {
    return { error: details.message, cursorPosition: details.cursorPosition };
  }
  return { error: `${(error && error.name) || 'Error'}: ${(error && error.message) || String(error)}` };
}

function run(lib, fn, sql) {
  try {
    return { ok: FNS[fn](lib, sql) };
  } catch (error) {
    return describeError(error);
  }
}

const same = (a, b) => a.ok === b.ok && a.error === b.error && a.cursorPosition === b.cursorPosition;
// Synchronous, so a line is never lost to the early exit below.
const write = (line) => fs.writeSync(1, JSON.stringify(line) + '\n');

// Outputs that differ only in keys an allowlist entry ignores. Checked here,
// where the whole outputs are at hand.
function ignoredBy(id, baseline, candidate) {
  if (!('ok' in baseline) || !('ok' in candidate)) return undefined;
  const rule = keyRules.find((entry) => allows(entry, { id, baseline, candidate })
    && withoutKeys(baseline.ok, entry.keys) === withoutKeys(candidate.ok, entry.keys));
  return rule && rule.index;
}

// Outputs can be megabytes; report the region around the first difference.
function preview(outcome, other) {
  if (!('ok' in outcome)) return outcome;
  if (!('ok' in other)) return { ok: outcome.ok.slice(0, 180) + (outcome.ok.length > 180 ? '…' : '') };
  const [a, b] = [outcome.ok, other.ok];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return { ok: (from ? '…' : '') + a.slice(from, i + 120) + (i + 120 < a.length ? '…' : '') };
}

(async () => {
  await Promise.all(libs.map((lib) => lib.loadModule()));
  for (let i = Number(startArg); i < inputs.length; i++) {
    const { id, sql, fns } = inputs[i];
    write({ type: 'at', i });
    let threw = false;
    for (const fn of fns) {
      const [baseline, candidate] = libs.map((lib) => run(lib, fn, sql));
      threw = threw || 'error' in baseline || 'error' in candidate;
      if (!same(baseline, candidate)) {
        const diffId = `${id}:${fn}`;
        write({
          type: 'diff',
          id: diffId,
          baseline: preview(baseline, candidate),
          candidate: preview(candidate, baseline),
          allowedBy: ignoredBy(diffId, baseline, candidate),
        });
      }
    }
    write({ type: 'compared', i, count: fns.length });
    if (threw && i + 1 < inputs.length) {
      write({ type: 'restart', next: i + 1 });
      process.exit(0);
    }
  }
  write({ type: 'done' });
})().catch((error) => {
  process.stderr.write(String((error && error.stack) || error) + '\n');
  process.exit(1);
});
