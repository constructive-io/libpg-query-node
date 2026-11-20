import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

// Node 18 and Node 20 before 20.19 load a `.js` file in a package without
// "type": "module" as CommonJS. Turning off syntax detection reproduces that
// on current Node, so this fails if an ESM entry point is not `.mjs`.
describe('ESM entry points without module syntax detection', () => {
  const flags = process.allowedNodeEnvironmentFlags.has('--experimental-detect-module')
    ? ['--no-experimental-detect-module']
    : [];
  const specifiers = ['@pgsql/parser', ...versions.map((v) => `@pgsql/parser/v${v}`)];
  for (const specifier of specifiers) {
    it(`imports ${specifier}`, () => {
      const script = `const m = await import(${JSON.stringify(specifier)});
        const lib = m.Parser ? new m.Parser() : m;
        if (m.loadModule) await m.loadModule();
        const result = m.Parser ? await lib.parse('SELECT 1') : lib.parseSync('SELECT 1');
        if (result.stmts.length !== 1) throw new Error('bad parse');`;
      const { status, stderr } = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
      });
      assert.equal(status, 0, stderr);
    });
  }
});
