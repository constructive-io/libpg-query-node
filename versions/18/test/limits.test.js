const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../wasm/index.cjs');

const nest = (open, inner, close) => (n) => open.repeat(n) + inner + close.repeat(n);
const list = (item, separator) => (n) => Array.from({ length: n }, (_, i) => item(i)).join(separator);

// The depth each function must handle for each shape of SQL: about half of
// what 18.1.5 and this build handle on Linux, so a build that loses depth
// fails here whatever the last release did. Raise a number when the build
// gains depth; lower one only for a change the release notes describe.
const SQL = {
  'chained +': [(n) => 'SELECT 1' + '+1'.repeat(n), { parse: 4000, fingerprint: 5000, normalize: 1500 }],
  'chained ||': [(n) => "SELECT 'a'" + " || 'a'".repeat(n), { parse: 2500, fingerprint: 5000, normalize: 1500 }],
  'chained AND': [(n) => 'SELECT 1 WHERE ' + list(() => 'a = 1', ' AND ')(n), { parse: 5000, fingerprint: 5000, normalize: 5000 }],
  'chained OR': [(n) => 'SELECT 1 WHERE ' + list(() => 'a = 1', ' OR ')(n), { parse: 5000, fingerprint: 5000, normalize: 5000 }],
  'chained casts': [(n) => 'SELECT 1' + '::int'.repeat(n), { parse: 2500, fingerprint: 5000, normalize: 1000 }],
  'chained ->': [(n) => 'SELECT j' + " -> 'a'".repeat(n), { parse: 2500, fingerprint: 5000, normalize: 1000 }],
  'chained unary minus': [(n) => 'SELECT ' + '- '.repeat(n) + 'a', { parse: 2500, fingerprint: 4000, normalize: 1000 }],
  'chained NOT': [(n) => 'SELECT ' + 'NOT '.repeat(n) + 'true', { parse: 2500, fingerprint: 4000, normalize: 500 }],
  'nested parentheses': [(n) => 'SELECT ' + nest('(', '1', ')')(n), { parse: 4000, fingerprint: 4000, normalize: 4000 }],
  'nested function calls': [(n) => 'SELECT ' + nest('f(', '1', ')')(n), { parse: 2000, fingerprint: 2000, normalize: 750 }],
  'nested COALESCE': [(n) => 'SELECT ' + nest('COALESCE(', '1', ')')(n), { parse: 2000, fingerprint: 2000, normalize: 750 }],
  'nested ROW': [(n) => 'SELECT ' + nest('ROW(', '1', ')')(n), { parse: 2000, fingerprint: 2000, normalize: 500 }],
  'nested arrays': [(n) => 'SELECT ' + nest('ARRAY[', '1', ']')(n), { parse: 2000, fingerprint: 2000, normalize: 500 }],
  'nested CASE': [(n) => 'SELECT ' + nest('CASE WHEN a THEN ', '1', ' END')(n), { parse: 1000, fingerprint: 1000, normalize: 1000 }],
  'nested subqueries': [(n) => 'SELECT ' + nest('(SELECT ', '1', ')')(n), { parse: 1000, fingerprint: 1500, normalize: 250 }],
  'nested FROM subqueries': [(n) => 'SELECT * FROM ' + nest('(SELECT * FROM ', 't', ') s')(n), { parse: 750, fingerprint: 750, normalize: 250 }],
  'nested CTEs': [(n) => nest('WITH c AS (', 'SELECT 1', ') SELECT * FROM c')(n), { parse: 750, fingerprint: 750, normalize: 250 }],
  'joins': [(n) => 'SELECT 1 FROM t0' + list((i) => ` JOIN t${i + 1} ON true`, '')(n), { parse: 2500, fingerprint: 5000, normalize: 1000 }],
  'UNION ALL': [list(() => 'SELECT 1', ' UNION ALL '), { parse: 4000, fingerprint: 5000, normalize: 1000 }],
  'CTE list': [(n) => 'WITH ' + list((i) => `c${i} AS (SELECT 1)`, ', ')(n) + ' SELECT 1', { parse: 5000, fingerprint: 5000, normalize: 5000 }],
};

const PLPGSQL = {
  'nested IF blocks': [nest('IF true THEN ', 'NULL;', ' END IF;'), 2000],
  'nested BEGIN blocks': [nest('BEGIN ', 'NULL;', ' END;'), 2000],
  'nested loops': [nest('LOOP ', 'EXIT;', ' END LOOP;'), 2000],
  'nested CASE blocks': [nest('CASE WHEN true THEN ', 'NULL;', ' END CASE;'), 1000],
  'chained + in an assignment': [(n) => 'x := 1' + '+1'.repeat(n) + ';', 5000],
};
const plpgsql = (body) =>
  `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE x int; BEGIN ${body} END $$`;

describe('Depth every exported function handles', { timeout: 300000 }, () => {
  before(async () => {
    await lib.loadModule();
  });

  for (const [shape, [make, depth]] of Object.entries(SQL)) {
    it(`parse and parseSync: ${shape}, ${depth.parse} deep`, async () => {
      const sql = make(depth.parse);
      assert.equal(lib.parseSync(sql).stmts.length, 1);
      assert.equal((await lib.parse(sql)).stmts.length, 1);
    });

    it(`fingerprint and fingerprintSync: ${shape}, ${depth.fingerprint} deep`, async () => {
      const sql = make(depth.fingerprint);
      assert.match(lib.fingerprintSync(sql), /^[0-9a-f]{16}$/);
      assert.match(await lib.fingerprint(sql), /^[0-9a-f]{16}$/);
    });

    it(`normalize and normalizeSync: ${shape}, ${depth.normalize} deep`, async () => {
      const sql = make(depth.normalize);
      assert.ok(lib.normalizeSync(sql).length > 0);
      assert.ok((await lib.normalize(sql)).length > 0);
    });

    it(`scan and scanSync: ${shape}, 10000 deep`, async () => {
      const sql = make(10000);
      assert.ok(lib.scanSync(sql).tokens.length > 10000);
      assert.ok((await lib.scan(sql)).tokens.length > 10000);
    });
  }

  for (const [shape, [make, depth]] of Object.entries(PLPGSQL)) {
    it(`parsePlPgSQL and parsePlPgSQLSync: ${shape}, ${depth} deep`, async () => {
      const sql = plpgsql(make(depth));
      assert.equal(lib.parsePlPgSQLSync(sql).plpgsql_funcs.length, 1);
      assert.equal((await lib.parsePlPgSQL(sql)).plpgsql_funcs.length, 1);
    });
  }
});
