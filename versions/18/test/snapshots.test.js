const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../wasm/index.cjs');

// Each corpus is copied from pgsql-parser's __fixtures__ and maps a statement
// name to its SQL; the snapshot beside it holds what this build returns for
// each one. An output that changes fails here; when the change is intended,
// regenerate with
//   UPDATE_SNAPSHOTS=1 node --test test/snapshots.test.js
// and say in the release notes what changed for users.
//
// corpus.json (generated/generated.json, every kitchen-sink statement) ->
//   pg18.json: the fingerprint, then a hash of the parse tree, of the
//   normalized query and of the scan tokens.
// plpgsql-corpus.json (plpgsql-generated/generated.json) ->
//   plpgsql-pg18.json: the parsePlPgSQL result itself.
const dir = path.join(__dirname, 'snapshots');
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const attempt = (run) => {
  try {
    return run();
  } catch (error) {
    return `error: ${error.message}`;
  }
};
const withoutVersion = ({ version, ...rest }) => JSON.stringify(rest);

const SQL = {
  fingerprint: (sql) => lib.fingerprintSync(sql),
  parse: (sql) => hash(withoutVersion(lib.parseSync(sql))),
  normalize: (sql) => hash(lib.normalizeSync(sql)),
  scan: (sql) => hash(withoutVersion(lib.scanSync(sql))),
};
const PLPGSQL = {
  parsePlPgSQL: (sql) => lib.parsePlPgSQLSync(sql),
};

function check(corpusFile, snapshotFile, fns) {
  const corpus = JSON.parse(fs.readFileSync(path.join(dir, corpusFile), 'utf8'));
  const actual = {};
  for (const [name, sql] of Object.entries(corpus)) {
    actual[name] = Object.values(fns).map((fn) => attempt(() => fn(sql)));
  }

  if (process.env.UPDATE_SNAPSHOTS) {
    const lines = Object.entries(actual).map(([name, row]) => `${JSON.stringify(name)}: ${JSON.stringify(row)}`);
    fs.writeFileSync(path.join(dir, snapshotFile), `{\n${lines.join(',\n')}\n}\n`);
    return;
  }

  const expected = JSON.parse(fs.readFileSync(path.join(dir, snapshotFile), 'utf8'));
  assert.deepEqual(Object.keys(actual), Object.keys(expected), `${corpusFile} and ${snapshotFile} list different statements`);
  const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
  const changed = [];
  for (const [name, row] of Object.entries(actual)) {
    Object.keys(fns).forEach((fn, i) => {
      const [was, now] = [text(expected[name][i]), text(row[i])];
      if (was !== now) changed.push(`${name} ${fn}: ${was.slice(0, 200)} -> ${now.slice(0, 200)}`);
    });
  }
  assert.equal(changed.length, 0, `${changed.length} outputs changed:\n${changed.slice(0, 50).join('\n')}`);
}

describe('Committed outputs', { timeout: 300000 }, () => {
  before(async () => {
    await lib.loadModule();
  });

  it('match for every kitchen-sink statement', () => check('corpus.json', 'pg18.json', SQL));
  it('match for every PL/pgSQL fixture', () => check('plpgsql-corpus.json', 'plpgsql-pg18.json', PLPGSQL));
});
