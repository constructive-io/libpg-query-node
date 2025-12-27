# libpg-query

<p align="center" width="100%">
    <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" alt="constructive.io">
</p>

<p align="center" width="100%">
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/npm/dt/libpg-query"></a>
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/npm/dw/libpg-query"/></a>
   <a href="https://github.com/constructive-io/libpg-query/blob/main/LICENSE-MIT"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/libpg-query-node?filename=versions%2F17%2Fpackage.json"/></a><br />
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml/badge.svg" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/macOS-available-333333?logo=apple&logoColor=white" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/Windows-available-333333?logo=windows&logoColor=white" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/Linux-available-333333?logo=linux&logoColor=white" /></a>
</p>

# The Real PostgreSQL Parser for JavaScript

### Bring the power of PostgreSQL's native parser to your TypeScript projects — no native builds, no platform headaches.

This is the official PostgreSQL parser, compiled to WebAssembly (WASM) for seamless, cross-platform compatibility. Use it in Node.js or the browser, on Linux, Windows, or anywhere JavaScript runs.

Built to power [pgsql-parser](https://github.com/constructive-io/pgsql-parser), this library delivers full fidelity with the Postgres C codebase — no rewrites, no shortcuts.

## Features

* 🔧 **Powered by PostgreSQL** – Uses the official Postgres C parser compiled to WebAssembly
* 🖥️ **Cross-Platform** – Runs smoothly on macOS, Linux, and Windows
* 🌐 **Node.js & Browser Support** – Consistent behavior in any JS environment
* 📦 **No Native Builds Required** – No compilation, no system-specific dependencies
* 🧠 **Spec-Accurate Parsing** – Produces faithful, standards-compliant ASTs
* 🚀 **Production-Grade** – Millions of downloads and trusted by countless projects and top teams

## 🚀 For Round-trip Codegen

> 🎯 **Want to parse + deparse (full round trip)?**  
> We highly recommend using [`pgsql-parser`](https://github.com/constructive-io/pgsql-parser) which leverages a pure TypeScript deparser that has been battle-tested against 23,000+ SQL statements and is built on top of libpg-query.

### 🔀 Multi-Version Support with @pgsql/parser

> **Need to support multiple PostgreSQL versions at runtime?**  
> Use [`@pgsql/parser`](https://github.com/constructive-io/libpg-query-node/tree/main/parser) for dynamic version selection — parse SQL with PostgreSQL 15, 16, or 17 in a single package!
> 
> ```typescript
> import { parse } from '@pgsql/parser';
> 
> // Parse with specific PostgreSQL version
> const result15 = await parse('SELECT * FROM users', 15);
> const result17 = await parse('SELECT * FROM users', 17);
> ```

## Installation

```sh
npm install libpg-query
```

## Example

```typescript
import { parse } from 'libpg-query';

const result = await parse('SELECT * FROM users WHERE active = true');
// {"version":170004,"stmts":[{"stmt":{"SelectStmt":{"targetList":[{"ResTarget" ... "op":"SETOP_NONE"}}}]}
```

## 📦 Packages

This repository contains multiple packages to support different PostgreSQL versions and use cases:

### Available Packages & Versions

| Package | Description | PostgreSQL Versions | npm Package |
|---------|-------------|---------------------|-------------|
| **[libpg-query](https://github.com/constructive-io/libpg-query-node/tree/main/versions)** | Lightweight parser (parse only) | 13, 14, 15, 16, 17 | [`libpg-query`](https://www.npmjs.com/package/libpg-query) |
| **[@pgsql/parser](https://github.com/constructive-io/libpg-query-node/tree/main/parser)** | Multi-version parser (runtime selection) | 15, 16, 17 | [`@pgsql/parser`](https://www.npmjs.com/package/@pgsql/parser) |
| **[@pgsql/types](https://github.com/constructive-io/libpg-query-node/tree/main/types)** | TypeScript type definitions | 13, 14, 15, 16, 17 | [`@pgsql/types`](https://www.npmjs.com/package/@pgsql/types) |
| **[@pgsql/enums](https://github.com/constructive-io/libpg-query-node/tree/main/enums)** | TypeScript enum definitions | 13, 14, 15, 16, 17 | [`@pgsql/enums`](https://www.npmjs.com/package/@pgsql/enums) |
| **[@libpg-query/parser](https://github.com/constructive-io/libpg-query-node/tree/main/full)** | Full parser with all features | 17 only | [`@libpg-query/parser`](https://www.npmjs.com/package/@libpg-query/parser) |

### Version Tags

Each versioned package uses npm dist-tags for PostgreSQL version selection:

```bash
# Install specific PostgreSQL version
npm install libpg-query@pg17      # PostgreSQL 17 (latest)
npm install libpg-query@pg16      # PostgreSQL 16
npm install @pgsql/types@pg17     # Types for PostgreSQL 17
npm install @pgsql/enums@pg15     # Enums for PostgreSQL 15

# Install latest (defaults to pg17)
npm install libpg-query
npm install @pgsql/types
npm install @pgsql/enums
```

### Which Package Should I Use?

- **Just need to parse SQL?** → Use `libpg-query` (lightweight, all PG versions)
- **Need multiple versions at runtime?** → Use `@pgsql/parser` (dynamic version selection)
- **Need TypeScript types?** → Add `@pgsql/types` and/or `@pgsql/enums`
- **Need fingerprint, normalize, or deparse?** → Use `@libpg-query/parser` (PG 17 only)


## API Documentation

For detailed API documentation and usage examples, see the package-specific READMEs:

- **libpg-query** - [Parser API Documentation](https://github.com/constructive-io/libpg-query-node/tree/main/versions/17)
- **@pgsql/parser** - [Multi-Version Parser Documentation](https://github.com/constructive-io/libpg-query-node/tree/main/parser)
- **@pgsql/types** - [Types Documentation](https://github.com/constructive-io/libpg-query-node/tree/main/types/17)
- **@pgsql/enums** - [Enums Documentation](https://github.com/constructive-io/libpg-query-node/tree/main/enums/17)
- **@libpg-query/parser** - [Full Parser Documentation](https://github.com/constructive-io/libpg-query-node/tree/main/full)

## Build Instructions

This package uses a **WASM-only build system** for true cross-platform compatibility without native compilation dependencies.

### Prerequisites

- Node.js (version 16 or higher recommended)
- [pnpm](https://pnpm.io/) (v8+ recommended)

### Building WASM Artifacts

Run these commands from inside a `versions/*` directory (e.g., `versions/17`):

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Build WASM artifacts:**
   
   ```bash
   pnpm run build
   ```

3. **Clean WASM build (if needed):**
   ```bash
   pnpm run clean
   ```

4. **Rebuild WASM artifacts from scratch:**
   ```bash
   pnpm run clean && pnpm run build
   ```

### Build Process Details

The WASM build process:
- Uses Emscripten SDK for compilation
- Compiles C wrapper code to WebAssembly
- Generates `wasm/libpg-query.js` and `wasm/libpg-query.wasm` files
- No native compilation or node-gyp dependencies required

## Testing

### Running Tests

```bash
pnpm run test
```

### Test Requirements

- WASM artifacts must be built before running tests
- If tests fail with "fetch failed" errors, rebuild WASM artifacts:
  ```bash
  pnpm run clean && pnpm run build && pnpm run test
  ```

## Troubleshooting

### Common Issues

**"fetch failed" errors during tests:**
- This indicates stale or missing WASM artifacts
- Solution: `pnpm run clean && pnpm run build`

**"WASM module not initialized" errors:**
- Ensure you call an async method first to initialize the WASM module
- Or use the async versions of methods which handle initialization automatically

**Build environment issues:**
- Ensure Emscripten SDK is properly installed and configured
- Check that all required build dependencies are available

**`.wasm` not found**
- Usually occurs in Next.js/Webpack/Turbopack
- see **[LOADING_WASM.md](./LOADING_WASM.md)**

### Template System

To avoid duplication across PostgreSQL versions, common files are maintained in the `templates/` directory:
- `LICENSE`, `Makefile`, `src/index.ts`, `src/libpg-query.d.ts`, `src/wasm_wrapper.c`

To update version-specific files from templates:
```bash
npm run copy:templates
```

This ensures consistency while allowing version-specific customizations (e.g., patches for version 13).

### Build Artifacts

The build process generates these files:
- `wasm/libpg-query.js` - Emscripten-generated JavaScript loader
- `wasm/libpg-query.wasm` - WebAssembly binary
- `wasm/index.js` - ES module exports
- `wasm/index.cjs` - CommonJS exports with sync wrappers

## Credits

Built on the excellent work of several contributors:

* **[Dan Lynch](https://github.com/pyramation)** — official maintainer since 2018 and architect of the current implementation
* **[Lukas Fittl](https://github.com/lfittl)** for [libpg_query](https://github.com/pganalyze/libpg_query) — the core PostgreSQL parser that powers this project
* **[Greg Richardson](https://github.com/gregnr)** for AST guidance and pushing the transition to WASM and multiple PG runtimes for better interoperability
* **[Ethan Resnick](https://github.com/ethanresnick)** for the original Node.js N-API bindings
* **[Zac McCormick](https://github.com/zhm)** for the foundational [node-pg-query-native](https://github.com/zhm/node-pg-query-native) parser

**🛠 Built by the [Constructive](https://constructive.io) team — creators of modular Postgres tooling for secure, composable backends. If you like our work, contribute on [GitHub](https://github.com/constructive-io).**


## Related

* [pgsql-parser](https://www.npmjs.com/package/pgsql-parser): The real PostgreSQL parser for Node.js, providing symmetric parsing and deparsing of SQL statements with actual PostgreSQL parser integration.
* [pgsql-deparser](https://www.npmjs.com/package/pgsql-deparser): A streamlined tool designed for converting PostgreSQL ASTs back into SQL queries, focusing solely on deparser functionality to complement `pgsql-parser`.
* [@pgsql/parser](https://www.npmjs.com/package/@pgsql/parser): Multi-version PostgreSQL parser with dynamic version selection at runtime, supporting PostgreSQL 15, 16, and 17 in a single package.
* [@pgsql/types](https://www.npmjs.com/package/@pgsql/types): Offers TypeScript type definitions for PostgreSQL AST nodes, facilitating type-safe construction, analysis, and manipulation of ASTs.
* [@pgsql/enums](https://www.npmjs.com/package/@pgsql/enums): Provides TypeScript enum definitions for PostgreSQL constants, enabling type-safe usage of PostgreSQL enums and constants in your applications.
* [@pgsql/utils](https://www.npmjs.com/package/@pgsql/utils): A comprehensive utility library for PostgreSQL, offering type-safe AST node creation and enum value conversions, simplifying the construction and manipulation of PostgreSQL ASTs.
* [pg-proto-parser](https://www.npmjs.com/package/pg-proto-parser): A TypeScript tool that parses PostgreSQL Protocol Buffers definitions to generate TypeScript interfaces, utility functions, and JSON mappings for enums.
* [libpg-query](https://github.com/constructive-io/libpg-query-node): The real PostgreSQL parser exposed for Node.js, used primarily in `pgsql-parser` for parsing and deparsing SQL queries.

## Disclaimer

AS DESCRIBED IN THE LICENSES, THE SOFTWARE IS PROVIDED "AS IS", AT YOUR OWN RISK, AND WITHOUT WARRANTIES OF ANY KIND.

No developer or entity involved in creating Software will be liable for any claims or damages whatsoever associated with your use, inability to use, or your interaction with other users of the Software code or Software CLI, including any direct, indirect, incidental, special, exemplary, punitive or consequential damages, or loss of profits, cryptocurrencies, tokens, or anything else of value.