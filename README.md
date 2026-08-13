# libpg-query-node

Native N-API PostgreSQL query parser for Node.js.

This repository builds and publishes [`@ashbyhq/libpg-query-native`](native/) — a
native Node.js addon targeting PostgreSQL 18. There are no WASM, browser, Deno, or
Worker builds.

```bash
npm install @ashbyhq/libpg-query-native
```

```js
const { parseSync } = require('@ashbyhq/libpg-query-native');

const result = parseSync('SELECT id, name FROM users WHERE active = true');
```

## Documentation

- **[native/README.md](native/README.md)** — installation, API, platform support, jemalloc tuning, benchmarks, and release process
- **[PUBLISH.md](PUBLISH.md)** — publishing reference

## Building and testing

```bash
cd native
npm ci
make build
npm run build:ts
npm test
```

## Upstream relationship

This fork shares git history with [constructive-io/libpg-query-node](https://github.com/constructive-io/libpg-query-node)
but does not build or publish upstream's WASM packages. The native addon is a
hand-written reimplementation of upstream's exported API, built against
[pganalyze/libpg_query](https://github.com/pganalyze/libpg_query) release tags.

## License

MIT
