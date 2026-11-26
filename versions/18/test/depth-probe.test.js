const { it } = require('node:test');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const forms = {
  'function calls': (n) => 'SELECT ' + 'f('.repeat(n) + '1' + ')'.repeat(n),
  'subqueries': (n) => 'SELECT ' + '(SELECT '.repeat(n) + '1' + ')'.repeat(n),
  'chained +1': (n) => 'SELECT 1' + '+1'.repeat(n),
  'plpgsql IF': (n) => 'CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN ' + 'IF true THEN '.repeat(n) + 'NULL;' + ' END IF;'.repeat(n) + ' END $$',
};
const fns = { 'function calls': ['parseSync', 'normalizeSync'], 'subqueries': ['parseSync', 'normalizeSync'], 'chained +1': ['parseSync', 'normalizeSync'], 'plpgsql IF': ['parsePlPgSQLSync'] };

async function measure(lib) {
  await lib.loadModule();
  const rows = [];
  for (const [form, make] of Object.entries(forms)) {
    for (const fn of fns[form]) {
      let lo = 1, hi = 20000, err = '';
      const ok = (n) => { try { lib[fn](make(n)); return true; } catch (e) { err = `${e.name}: ${e.message}`.slice(0, 50); return false; } };
      if (ok(hi)) { rows.push(`${form} ${fn}: >= ${hi}`); continue; }
      ok(hi);
      const top = err;
      while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; }
      ok(hi);
      rows.push(`${form} ${fn}: max ${lo} (at ${hi}: ${err}; at 20000: ${top})`);
      await lib.loadModule();
    }
  }
  return rows;
}

it('probe', async () => {
  const dir = path.join(__dirname, '..', '.probe');
  fs.mkdirSync(dir, { recursive: true });
  execSync('npm pack libpg-query@18.1.5 --silent', { cwd: dir });
  execSync('tar xzf libpg-query-18.1.5.tgz', { cwd: dir });
  const old = require(path.join(dir, 'package', 'wasm', 'index.cjs'));
  const cur = require('../wasm/index.cjs');
  const out = [`node ${process.version} ${process.platform} ${process.arch}`];
  for (const [name, lib] of [['18.1.5', old], ['main', cur]]) {
    for (const row of await measure(lib)) out.push(`PROBE ${name} | ${row}`);
  }
  console.log(out.join('\n'));
});
