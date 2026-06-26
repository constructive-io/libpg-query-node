const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Emscripten MODULARIZE factory; calling it instantiates a fresh, isolated
// WASM instance with its own linear memory.
const createModule = require('../wasm/libpg-query.js');

// Guards the WASM load-time footprint from regressing. The module reserves its
// initial linear memory on instantiation, before any parse — that reservation
// is what inflates load-time memory. Growth is enabled (-sALLOW_MEMORY_GROWTH),
// so the initial size is a footprint knob, not a hard limit. We read the live
// size from the instance (HEAPU8 views the linear memory) instead of parsing
// the binary: no dependency, and it reflects the real allocation.
describe('WASM memory footprint', () => {
  // Ceiling for the initial reservation; the single source of truth. Keep it a
  // bit above -sINITIAL_MEMORY in the Makefile so normal tuning doesn't trip it.
  const MAX_INITIAL_BYTES = 64 * 1024 * 1024;

  it('reserves an initial linear memory within budget', async () => {
    const m = await createModule();
    const initialBytes = m.HEAPU8.buffer.byteLength;
    const mib = (n) => (n / (1024 * 1024)).toFixed(0);
    assert.ok(
      initialBytes <= MAX_INITIAL_BYTES,
      `WASM initial memory ${mib(initialBytes)} MiB exceeds the ${mib(MAX_INITIAL_BYTES)} MiB budget. ` +
        `Lower -sINITIAL_MEMORY in the Makefile (memory grows on demand via -sALLOW_MEMORY_GROWTH).`
    );
  });
});
