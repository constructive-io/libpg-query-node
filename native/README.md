# @ashbyhq/libpg-query-native

Native N-API PostgreSQL query parser — a memory-efficient alternative to the WASM build.

## Why native?

The WASM build (`@libpg-query/parser`) carries a structural memory cost: WebAssembly
linear memory only ever grows. Once a large parse expands the heap, that memory is
never returned to the OS, so a process that parses one big query keeps the high-water
mark for its lifetime, and repeated large parses ratchet RSS upward monotonically.
No allocator choice can change this — it's a property of the WASM memory model.

The native build removes that ceiling: it uses the host allocator, so freed memory can
actually be returned to the OS. Pairing it with **jemalloc** (via `LD_PRELOAD` /
`DYLD_INSERT_LIBRARIES`) roughly halves peak RSS and, more importantly, keeps it
*stable* across repeated large parses instead of ratcheting.

### Measured: native vs WASM

Parsing a 3.31 MB SQL query (1500× `UNION ALL`, ~65 MB JSON parse tree), 3 parse/free
cycles, `darwin-arm64`, Node 24. Each backend measured in its own process. "Retained"
is RSS after the result is dropped and GC settles; throughput is a small query ×10k.

| Backend | idle RSS | peak RSS (max of 3) | retained after free | throughput |
|---------|---------|---------------------|---------------------|------------|
| WASM (`@libpg-query/parser`) | 93 MB | 1359 MB | **+1202 MB** (never shrinks) | 125k/s |
| Native — system malloc | 53 MB | 932 MB | +812 MB (ratchets up) | 139k/s |
| Native — **jemalloc** | 55 MB | **498 MB** | **+377 MB** (stabilizes) | 139k/s |

Per-cycle peak progression:

```
WASM:            1261 → 1359 → 1359 MB   (plateaus at a high permanent floor)
Native system:    649 →  867 →  932 MB   (fragments, still climbing)
Native jemalloc:  381 →  497 →  498 MB   (flat after cycle 2)
```

WASM linear memory only ever grows, so ~1.2 GB from one big parse is held for the
process lifetime. Native + system malloc is lower but still ratchets. Native +
jemalloc has ~2.7× lower peak than WASM, returns freed pages to the OS, and stabilizes.
`MALLOC_CONF=dirty_decay_ms:0,muzzy_decay_ms:0` trims peak a little further (~477 MB).
Throughput is identical across allocators — jemalloc is a pure memory win.

Reproduce with `node --expose-gc benchmark/memory.mjs --all --cycles 3` (with
`@libpg-query/parser` installed) and `bash benchmark/compare-allocators.sh --cycles 3`.

## Installation

```bash
npm install @ashbyhq/libpg-query-native
```

Platform-specific binaries ship as separate packages and are installed
automatically via optional dependencies. Each declares `os`/`cpu`/`libc`, so
npm and Yarn install **only** the one matching the host:

| Package | `os` | `cpu` | `libc` |
|---------|------|-------|--------|
| `@ashbyhq/libpg-query-native-darwin-arm64` | darwin | arm64 | — |
| `@ashbyhq/libpg-query-native-darwin-x64` | darwin | x64 | — |
| `@ashbyhq/libpg-query-native-linux-x64` | linux | x64 | glibc |
| `@ashbyhq/libpg-query-native-linux-arm64` | linux | arm64 | glibc |
| `@ashbyhq/libpg-query-native-linux-x64-musl` | linux | x64 | musl |
| `@ashbyhq/libpg-query-native-linux-arm64-musl` | linux | arm64 | musl |

glibc and musl builds are marked mutually exclusive, so an Alpine host pulls the
musl binary and a Debian/Ubuntu host pulls the glibc one — never both.

No node-gyp or compiler toolchain needed at install time.

### Cross-architecture installs

When building for a target that differs from the install host (e.g. a Linux
Docker image built on an Apple Silicon Mac), tell the package manager which
architectures to fetch:

```bash
# npm
npm install --os=linux --cpu=x64 --libc=glibc

# Yarn Berry — in .yarnrc.yml
supportedArchitectures:
  os: [linux]
  cpu: [x64]
  libc: [glibc]
```

> Note: Yarn Classic (1.x) honors `os`/`cpu` but not `libc`. On musl hosts it may
> install both Linux variants; the runtime loader still selects the correct one
> via musl detection.

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

# Full benchmark (large query, ~3.31 MB SQL)
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
