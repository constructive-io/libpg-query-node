# @ashbyhq/libpg-query-native

Native N-API PostgreSQL query parser — a memory-efficient alternative to the WASM build.

## Why native?

The WASM build (`@libpg-query/parser`) has unavoidable memory behavior for large queries:
- Peak RSS ~935 MB for a 2.74 MB query (vs ~70 MB native with jemalloc)
- WebAssembly linear memory never shrinks — RSS ratchets up permanently
- No allocator can fix this within WASM constraints

The native build eliminates both problems. With jemalloc preloaded, RSS tracks the live set and returns to baseline after each parse.

```
                  idle     big-query peak   ratchet     throughput
WASM (today)      32 MB    935 MB           permanent   126k/s
Native            ~4 MB    ~70 MB*          none*       259k/s
```

\* With jemalloc. Without jemalloc, macOS libmalloc retains ~274 MB (still 3.5x better than WASM).

## Installation

```bash
npm install @ashbyhq/libpg-query-native
```

Platform-specific binaries are installed automatically via optional dependencies:
- `@ashbyhq/libpg-query-native-darwin-arm64`
- `@ashbyhq/libpg-query-native-darwin-x64`
- `@ashbyhq/libpg-query-native-linux-x64`
- `@ashbyhq/libpg-query-native-linux-arm64`
- `@ashbyhq/libpg-query-native-linux-x64-musl`
- `@ashbyhq/libpg-query-native-linux-arm64-musl`

No node-gyp or compiler toolchain needed at install time.

## Usage

Drop-in replacement for `@libpg-query/parser`:

```js
const { parse, parseSync, fingerprint, normalize, scan } = require('@ashbyhq/libpg-query-native');

// Sync (no init needed — native loads instantly)
const result = parseSync('SELECT id, name FROM users WHERE active = true');

// Async (same result, just wrapped in a promise)
const result2 = await parse('SELECT id, name FROM users WHERE active = true');
```

### API

| Function | Sync | Async | Returns |
|----------|------|-------|---------|
| `parseSync(sql)` / `parse(sql)` | ✓ | ✓ | `ParseResult` (JSON AST) |
| `parsePlPgSQLSync(sql)` / `parsePlPgSQL(sql)` | ✓ | ✓ | PL/pgSQL parse tree |
| `fingerprintSync(sql)` / `fingerprint(sql)` | ✓ | ✓ | 16-char hex fingerprint |
| `normalizeSync(sql)` / `normalize(sql)` | ✓ | ✓ | Normalized query string |
| `scanSync(sql)` / `scan(sql)` | ✓ | ✓ | `ScanResult` with tokens |

## Using jemalloc for optimal memory

The native addon uses the system allocator by default. For optimal memory behavior
(especially with large queries), preload jemalloc:

```bash
# Linux
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2 node app.js

# macOS (brew install jemalloc)
DYLD_INSERT_LIBRARIES=$(brew --prefix jemalloc)/lib/libjemalloc.dylib node app.js
```

Or in your Dockerfile:
```dockerfile
RUN apt-get install -y libjemalloc2
ENV LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2
```

## Benchmarks

```bash
# Quick sanity check
node --expose-gc benchmark/memory.mjs --small

# Full benchmark (large query, ~2.74 MB SQL)
node --expose-gc benchmark/memory.mjs

# Compare with/without jemalloc
bash benchmark/run-with-jemalloc.sh

# Throughput benchmark
node --expose-gc benchmark/memory.mjs --throughput

# Compare against WASM (requires @libpg-query/parser installed)
node --expose-gc benchmark/memory.mjs --all
```

## Building from source

```bash
cd native
npm install
make build    # builds libpg_query + the .node addon
npm run build:ts  # compiles TypeScript
npm test
```

### Generating platform packages

After building:
```bash
node scripts/package-platforms.mjs
```

This creates `packages/libpg-query-native-<platform>/` directories ready for `npm publish`.

## License

MIT
