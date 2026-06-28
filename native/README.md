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

### Measured: native, system malloc vs jemalloc

Parsing a 3.31 MB SQL query (1500× `UNION ALL`, ~65 MB JSON parse tree), 3 parse/free
cycles, `darwin-arm64`, Node 24. Peak is the max RSS during a parse; "after" is RSS
once the result is dropped and GC settles.

| Allocator | cycle 1 peak | cycle 2 peak | cycle 3 peak | retained after |
|-----------|-------------|-------------|-------------|----------------|
| system malloc | 649 MB | 867 MB | **932 MB** | 867 MB |
| jemalloc | 381 MB | 497 MB | **498 MB** | 433 MB |
| jemalloc (`dirty_decay_ms:0,muzzy_decay_ms:0`) | 377 MB | 477 MB | **477 MB** | 411 MB |

System malloc climbs every cycle (649 → 932 MB) — it fragments and holds the freed
arenas. jemalloc stabilizes at ~498 MB by cycle 2 and stays there. Throughput is
identical either way (~140k small-query parses/sec on this machine), so jemalloc is a
pure memory win with no speed cost.

Reproduce with `bash benchmark/compare-allocators.sh --cycles 3`. A side-by-side against
the WASM backend is available via `node --expose-gc benchmark/memory.mjs --all` once
`@libpg-query/parser` is installed.

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
