const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../wasm/index.cjs');

// corpus.json is pgsql-parser's __fixtures__/generated/generated.json: every
// kitchen-sink statement by name. pg18.json holds what this build returns for
// each one: the fingerprint, then a hash of the parse tree, of the normalized
// query and of the scan tokens. An output that changes fails here; when the
// change is intended, regenerate with
//   UPDATE_SNAPSHOTS=1 node --test test/snapshots.test.js
// and say in the release notes what changed for users.
const corpus = require('./snapshots/corpus.json');
const snapshotFile = path.join(__dirname, 'snapshots', 'pg18.json');
const COLUMNS = ['fingerprint', 'parse', 'normalize', 'scan'];

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const attempt = (run) => {
  try {
    return run();
  } catch (error) {
    return `error: ${error.message}`;
  }
};
const withoutVersion = ({ version, ...rest }) => JSON.stringify(rest);

function outputs(sql) {
  return [
    attempt(() => lib.fingerprintSync(sql)),
    attempt(() => hash(withoutVersion(lib.parseSync(sql)))),
    attempt(() => hash(lib.normalizeSync(sql))),
    attempt(() => hash(withoutVersion(lib.scanSync(sql)))),
  ];
}

describe('Outputs for every kitchen-sink statement', { timeout: 300000 }, () => {
  before(async () => {
    await lib.loadModule();
  });

  it('match the committed snapshot', () => {
    const actual = {};
    for (const [name, sql] of Object.entries(corpus)) actual[name] = outputs(sql);

    if (process.env.UPDATE_SNAPSHOTS) {
      const lines = Object.entries(actual).map(([name, row]) => `${JSON.stringify(name)}: ${JSON.stringify(row)}`);
      fs.writeFileSync(snapshotFile, `{\n${lines.join(',\n')}\n}\n`);
      return;
    }

    const expected = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    assert.deepEqual(Object.keys(actual), Object.keys(expected), 'corpus.json and pg18.json list different statements');
    const changed = [];
    for (const [name, row] of Object.entries(actual)) {
      row.forEach((value, i) => {
        if (value !== expected[name][i]) changed.push(`${name} ${COLUMNS[i]}: ${expected[name][i]} -> ${value}`);
      });
    }
    assert.equal(changed.length, 0, `${changed.length} outputs changed:\n${changed.slice(0, 50).join('\n')}`);
  });
});
