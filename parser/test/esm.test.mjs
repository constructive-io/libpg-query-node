import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { versions } = JSON.parse(readFileSync(new URL('../wasm/build-info.json', import.meta.url), 'utf8'));

describe('ESM entry points', () => {
  it('imports the root entry and parses with every bundled version', async () => {
    const { Parser } = await import('@pgsql/parser');
    for (const version of versions) {
      const result = await new Parser({ version: Number(version) }).parse('SELECT 1');
      assert.equal(result.stmts.length, 1, `v${version}`);
    }
  });

  for (const version of versions) {
    it(`imports @pgsql/parser/v${version}`, async () => {
      const mod = await import(`@pgsql/parser/v${version}`);
      await mod.loadModule();
      assert.equal(mod.parseSync('SELECT 1').stmts.length, 1);
    });
  }
});

it('imports the root and v18 without module syntax detection', () => {
  const flags = process.allowedNodeEnvironmentFlags.has('--experimental-detect-module')
    ? ['--no-experimental-detect-module']
    : [];
  execFileSync(process.execPath, [...flags, '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { Parser } from '@pgsql/parser';
    import { loadModule, parseSync } from '@pgsql/parser/v18';

    assert.equal((await new Parser().parse('SELECT 1')).stmts.length, 1);
    await loadModule();
    assert.equal(parseSync('SELECT 1').stmts.length, 1);
  `], { cwd: new URL('..', import.meta.url), stdio: 'inherit' });
});
