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

> The `libjemalloc.so.2` path above is for Debian/Ubuntu on x86_64. It differs by
> distro and architecture (e.g. `/usr/lib/aarch64-linux-gnu/libjemalloc.so.2` on
> arm64, `/usr/lib64/libjemalloc.so.2` on RHEL/Fedora). Find it with
> `ldconfig -p | grep jemalloc`.

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

# CI regression benchmark (emits github-action-benchmark JSON)
node --expose-gc benchmark/ci-bench.mjs --out results.json
```

### Regression tracking in CI

The `Native Benchmark` workflow runs `ci-bench.mjs` on a fixed runner
(ubuntu-24.04, under jemalloc) for every PR and push to `main`. It tracks four
smaller-is-better metrics — large-query parse time, peak RSS, retained RSS, and
small-query latency — against a baseline stored on the `gh-pages` branch. Each
run posts the per-metric difference to the job summary; a regression beyond
**2× the baseline** comments on the PR and fails the check. The threshold is
deliberately conservative (`alert-threshold: 200%`) to tolerate shared-runner
noise — tune it in `.github/workflows/native-benchmark.yml`.

## Building from source

```bash
cd native
npm ci
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

## Releasing

**The committed version in `package.json` is the release trigger.** Merging a
version bump to the release branch publishes it; nothing else does. Re-pushes,
reverts and re-runs are safe — `native-release.yml` skips any version already on
npm.

To cut a release by hand: bump `version` in `native/package.json`, commit, merge.
The dist-tag is derived from the version (`0.2.0` → `latest`, `0.2.0-beta.1` →
`beta`), and publishing a prerelease to `latest` is refused outright.
`native-release.yml` also accepts a `workflow_dispatch` with `dry-run` for
rehearsals.

### What tracks what

Two independent automations, deliberately split:

| Workflow | Trigger | Cuts a release? |
|---|---|---|
| `libpg-query-sync.yml` | new `pganalyze/libpg_query` release, weekly poll | **Yes** |
| `upstream-tree-sync.yml` | `constructive-io/libpg-query-node` commits, monthly | No |

The split follows from what actually ships. This package is built from exactly
three inputs: `src/addon.cc` + `src/index.ts`, the `libpg_query` C library, and
`@pgsql/types` (types only, zero runtime). **The C library is 100% of parsing
behaviour, and nothing from `constructive-io/libpg-query-node` is compiled into
the published artifact** — the fork shares a git tree with it and borrowed the
shape of its API, and that is the whole relationship.

So a new pganalyze release is what changes what consumers get, and it is what
triggers a release. Upstream's npm publishes are a lagging proxy for something
that never reaches this package: upstream builds PG 18 from their own
`constructive-io/libpg_query` fork at the moving branch `18-constructive`, so
their `18.1.x` versions are their private patches, not new pganalyze releases.
This fork stays on immutable pganalyze tags. `upstream-tree-sync.yml` flags it in
the PR body if that ever changes, so the choice gets revisited on purpose.

`x-upstream` in `package.json` records what a given build tracks:

```json
"x-upstream": {
  "libpgQueryRepo": "https://github.com/pganalyze/libpg_query.git",
  "libpgQueryTag": "18.0.0",
  "pgMajor": "18",
  "constructiveBaseSha": "74ed197..."
}
```

### Upstream API drift

`src/index.ts` is a hand-written reimplementation of upstream's
`versions/18/src/index.ts`, so **upstream API changes do not arrive via a merge**
— someone has to port them. `upstream-tree-sync.yml` compares upstream's exported
surface against `.upstream-api-snapshot.json` and labels the PR `api-drift` when
it moves. After porting, accept the new baseline:

```bash
cd native && node scripts/check-api-drift.mjs --update
```

### Setup

- **`NPM_TOKEN`** — required to publish.
- **`SYNC_PAT`** — recommended. A PR opened with the default `GITHUB_TOKEN` does
  not trigger other workflows, so sync PRs would arrive with no CI. Without it
  both sync workflows still run, but warn in the PR body; closing and reopening
  the PR triggers CI manually.

### Why `optionalDependencies` is not in `package.json`

The five platform packages pin this package's own version, so committing them
desyncs the lockfile on every bump and `npm ci` fails with `EUSAGE` before it can
install anything. They are a publish-time construct — `src/index.ts` prefers the
local `prebuilds/<platform>/` binary, and CI installs platform tarballs
explicitly. `scripts/sync-optional-deps.mjs` injects them at publish time.

**`npm ci` must run before `sync-optional-deps.mjs`, never after.**

## License

MIT
