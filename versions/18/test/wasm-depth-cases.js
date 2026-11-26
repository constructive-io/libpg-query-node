const chained = (depth) => 'SELECT 1' + '+1'.repeat(depth);
const subqueries = (depth) => 'SELECT ' + '(SELECT '.repeat(depth) + '1' + ')'.repeat(depth);
const calls = (depth) => 'SELECT ' + 'f('.repeat(depth) + '1' + ')'.repeat(depth);

const blocks = Object.fromEntries(Object.entries({
  'IF blocks': ['IF true THEN ', 'NULL;', ' END IF;'],
  'BEGIN blocks': ['BEGIN ', 'NULL;', ' END;'],
  loops: ['LOOP ', 'EXIT;', ' END LOOP;'],
}).map(([name, [open, body, close]]) => [name, (depth) =>
  'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ' +
  open.repeat(depth) + body + close.repeat(depth) + ' END $$']));

module.exports = { chained, subqueries, calls, blocks };
