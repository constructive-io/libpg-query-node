import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { versions } = JSON.parse(readFileSync(new URL('../wasm/build-info.json', import.meta.url), 'utf8'));

describe('Parser load retries', () => {
  for (const [format, extension] of [['ESM', 'js'], ['CommonJS', 'cjs']]) {
    it(`retries failed ${format} loads and settles ready for each attempt`, async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'pgsql-parser-'));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      const entry = `index.${extension}`;
      copyFileSync(new URL(`../wasm/${entry}`, import.meta.url), join(dir, entry));

      for (const version of versions) {
        const versionDir = join(dir, `v${version}`);
        mkdirSync(versionDir);
        writeFileSync(join(versionDir, entry), version === '18' ? `
          let attempts = 0;
          async function loadModule() {
            if (++attempts === 1) throw new Error('temporary load failure');
          }
          function parse(query) { return { query, attempts }; }
          ${format === 'ESM' ? 'export { loadModule, parse };' : 'module.exports = { loadModule, parse };'}
        ` : '');
      }

      const mod = await import(pathToFileURL(join(dir, entry)));
      const Parser = format === 'ESM' ? mod.Parser : mod.default.Parser;
      const parser = new Parser({ version: 18 });
      await Promise.all([
        assert.rejects(parser.ready, /temporary load failure/),
        assert.rejects(parser.parse('SELECT 1'), /temporary load failure/),
        assert.rejects(parser.parse('SELECT 2'), /temporary load failure/),
      ]);
      assert.throws(() => parser.parseSync('SELECT 1'), /Parser not loaded/);

      const retry = parser.parse('SELECT 1');
      assert.deepEqual(await retry, { query: 'SELECT 1', attempts: 2 });
      await parser.ready;
    });
  }
});

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
