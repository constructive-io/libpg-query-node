⚠️ Due to the managing of many versions, we do have some duplication, please beware!

There is a templates/ dir to solve some of this.

Versions with `x-publish.fullApi: true` (currently 18) are generated from the
full-API templates in `templates/full/` and export the full API
(parse, parsePlPgSQL, scan, fingerprint, normalize + sync variants);
the other versions use the slim (parse-only) templates.
⚠️ Note: the Makefiles for 15/17/18 have been hand-edited to point at
constructive-io/libpg_query branches; `copy:templates` regenerates Makefiles
with the pganalyze repo URL, so re-apply the repo override if you regenerate.

## Code Duplication 📋

### 1. Identical Test Files
- All `versions/*/test/errors.test.js` files are identical (324 lines each)
- All `versions/*/test/parsing.test.js` files are identical (89 lines each)
- **Recommendation**: Consider using the template approach mentioned by the user

### 2. Nearly Identical Source Files
- `versions/*/src/index.ts` are nearly identical except for version numbers
- `versions/*/src/wasm_wrapper.c` are identical
- `versions/*/Makefile` differ only in:
  - `LIBPG_QUERY_TAG` version
  - Version 13 has an extra emscripten patch

## Consistency Issues 🔧

### 1. Version 13 Makefile Difference
- Version 13 applies an extra patch: `emscripten_disable_spinlocks.patch`
- Other versions don't have this patch
- **Status**: Patch file exists and is likely needed for v13 compatibility