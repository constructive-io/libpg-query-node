// Inputs the fixtures don't cover: deep nesting, long lists and large scripts,
// at sizes on both sides of the parser's depth and memory limits. A build that
// rejects an input the last release parsed (or the reverse) shows up here.
const DEPTHS = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
const SIZES = [1000, 10000, 50000];

const nest = (open, inner, close, n) => open.repeat(n) + inner + close.repeat(n);

const SQL_DEPTH = {
  'plus-chain': (n) => 'SELECT 1' + '+1'.repeat(n),
  'concat-chain': (n) => "SELECT 'a'" + " || 'a'".repeat(n),
  'and-chain': (n) => 'SELECT 1 WHERE ' + Array(n).fill('a = 1').join(' AND '),
  'or-chain': (n) => 'SELECT 1 WHERE ' + Array(n).fill('a = 1').join(' OR '),
  'parens': (n) => 'SELECT ' + nest('(', '1', ')', n),
  'unary-minus': (n) => 'SELECT ' + '-'.repeat(n) + '1',
  'not-chain': (n) => 'SELECT ' + 'NOT '.repeat(n) + 'true',
  'function-calls': (n) => 'SELECT ' + nest('f(', '1', ')', n),
  'subselects': (n) => 'SELECT ' + nest('(SELECT ', '1', ')', n),
  'arrays': (n) => 'SELECT ' + nest('ARRAY[', '1', ']', n),
  'case': (n) => 'SELECT ' + nest('CASE WHEN a THEN ', '1', ' END', n),
  'casts': (n) => 'SELECT 1' + '::int'.repeat(n),
  'joins': (n) => 'SELECT 1 FROM t0' + Array.from({ length: n }, (_, i) => ` JOIN t${i + 1} ON true`).join(''),
  'set-ops': (n) => Array(n).fill('SELECT 1').join(' UNION ALL '),
  'ctes': (n) => 'WITH ' + Array.from({ length: n }, (_, i) => `c${i} AS (SELECT 1)`).join(', ') + ' SELECT 1',
  'json-path': (n) => "SELECT j" + " -> 'a'".repeat(n),
};

const SQL_SIZE = {
  'in-list': (n) => 'SELECT 1 WHERE a IN (' + Array(n).fill('1').join(', ') + ')',
  'values-rows': (n) => 'VALUES ' + Array(n).fill('(1, 2)').join(', '),
  'select-list': (n) => 'SELECT ' + Array(n).fill('1').join(', '),
  'statements': (n) => 'SELECT 1;\n'.repeat(n),
  'string-literal': (n) => "SELECT '" + 'a'.repeat(n * 10) + "'",
  'comment': (n) => 'SELECT 1 /* ' + 'x'.repeat(n * 10) + ' */',
  'unicode-identifiers': (n) => 'SELECT ' + Array(n).fill('"é漢字🙂"').join(', '),
};

const PLPGSQL_DEPTH = {
  'if-blocks': (n) => nest('IF true THEN ', 'NULL;', ' END IF;', n),
  'begin-blocks': (n) => nest('BEGIN ', 'NULL;', ' END;', n),
  'loops': (n) => nest('LOOP ', 'EXIT;', ' END LOOP;', n),
  'expression': (n) => 'x := 1' + '+1'.repeat(n) + ';',
};

const plpgsql = (body) =>
  `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ DECLARE x int; BEGIN ${body} END $$`;

const SQL_FNS = ['parse', 'fingerprint', 'normalize', 'scan'];

module.exports = function edgeCases() {
  const cases = [];
  for (const [name, make] of Object.entries(SQL_DEPTH)) {
    for (const n of DEPTHS) cases.push({ id: `edge:${name}-${n}`, sql: make(n), fns: SQL_FNS });
  }
  for (const [name, make] of Object.entries(SQL_SIZE)) {
    for (const n of SIZES) cases.push({ id: `edge:${name}-${n}`, sql: make(n), fns: SQL_FNS });
  }
  for (const [name, make] of Object.entries(PLPGSQL_DEPTH)) {
    for (const n of DEPTHS) cases.push({ id: `edge:plpgsql-${name}-${n}`, sql: plpgsql(make(n)), fns: ['parsePlPgSQL'] });
  }
  return cases;
};
