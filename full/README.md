# @libpg-query/parser

<p align="center" width="100%">
    <img src="https://github.com/constructive-io/libpg-query-node/assets/545047/5fd420cc-cdc6-4211-9b0f-0eca8321ba72" alt="constructive.io" width="100">
</p>

<p align="center" width="100%">
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/npm/dt/libpg-query"></a>
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/npm/dw/libpg-query"/></a>
   <a href="https://github.com/constructive-io/libpg-query/blob/main/LICENSE-MIT"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/libpg-query-node?filename=full%2Fpackage.json"/></a><br />
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml/badge.svg" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/macOS-available-333333?logo=apple&logoColor=white" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/Windows-available-333333?logo=windows&logoColor=white" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/Linux-available-333333?logo=linux&logoColor=white" /></a>
</p>

# The Real PostgreSQL Parser for JavaScript

### Bring the power of PostgreSQL’s native parser to your JavaScript projects — no native builds, no platform headaches.

This is the official PostgreSQL parser, compiled to WebAssembly (WASM) for seamless, cross-platform compatibility. Use it in Node.js or the browser, on Linux, Windows, or anywhere JavaScript runs.

Built to power [pgsql-parser](https://github.com/constructive-io/pgsql-parser), this library delivers full fidelity with the Postgres C codebase — no rewrites, no shortcuts.

### Features

* 🔧 **Powered by PostgreSQL** – Uses the official Postgres C parser compiled to WebAssembly
* 🖥️ **Cross-Platform** – Runs smoothly on macOS, Linux, and Windows
* 🌐 **Node.js & Browser Support** – Consistent behavior in any JS environment
* 📦 **No Native Builds Required** – No compilation, no system-specific dependencies
* 🧠 **Spec-Accurate Parsing** – Produces faithful, standards-compliant ASTs
* 🚀 **Production-Grade** – Millions of downloads and trusted by countless projects and top teams

## 🚀 For Round-trip Codegen

> 🎯 **Want to parse + deparse (full round trip)?**  
> We highly recommend using [`pgsql-parser`](https://github.com/constructive-io/pgsql-parser) which leverages a pure TypeScript deparser that has been battle-tested against 23,000+ SQL statements and is built on top of libpg-query.

## Installation

```sh
npm install @libpg-query/parser
```

## Usage

### `parse(query: string): Promise<ParseResult>`

Parses the SQL and returns a Promise for the parse tree. May reject with a parse error.

```typescript
import { parse } from '@libpg-query/parser';

const result = await parse('SELECT * FROM users WHERE active = true');
// Returns: ParseResult - parsed query object
```

### `parseSync(query: string): ParseResult`

Synchronous version that returns the parse tree directly. May throw a parse error.

```typescript
import { parseSync } from '@libpg-query/parser';

const result = parseSync('SELECT * FROM users WHERE active = true');
// Returns: ParseResult - parsed query object
```

### `parsePlPgSQL(funcsSql: string): Promise<ParseResult>`

Parses the contents of a PL/pgSQL function from a `CREATE FUNCTION` declaration. Returns a Promise for the parse tree.

```typescript
import { parsePlPgSQL } from '@libpg-query/parser';

const functionSql = `
CREATE FUNCTION get_user_count() RETURNS integer AS $$
BEGIN
    RETURN (SELECT COUNT(*) FROM users);
END;
$$ LANGUAGE plpgsql;
`;

const result = await parsePlPgSQL(functionSql);
```

### `parsePlPgSQLSync(funcsSql: string): ParseResult`

Synchronous version of PL/pgSQL parsing.

```typescript
import { parsePlPgSQLSync } from '@libpg-query/parser';

const result = parsePlPgSQLSync(functionSql);
```

### `deparse(parseTree: ParseResult): Promise<string>`

Converts a parse tree back to SQL string. Returns a Promise for the SQL string.

```typescript
import { parse, deparse } from '@libpg-query/parser';

const parseTree = await parse('SELECT * FROM users WHERE active = true');
const sql = await deparse(parseTree);
// Returns: string - reconstructed SQL query
```

### `deparseSync(parseTree: ParseResult): string`

Synchronous version that converts a parse tree back to SQL string directly.

```typescript
import { parseSync, deparseSync } from '@libpg-query/parser';

const parseTree = parseSync('SELECT * FROM users WHERE active = true');
const sql = deparseSync(parseTree);
// Returns: string - reconstructed SQL query
```

### `fingerprint(sql: string): Promise<string>`

Generates a unique fingerprint for a SQL query that can be used for query identification and caching. Returns a Promise for a 16-character fingerprint string.

```typescript
import { fingerprint } from '@libpg-query/parser';

const fp = await fingerprint('SELECT * FROM users WHERE active = $1');
// Returns: string - unique 16-character fingerprint (e.g., "50fde20626009aba")
```

### `fingerprintSync(sql: string): string`

Synchronous version that generates a unique fingerprint for a SQL query directly.

```typescript
import { fingerprintSync } from '@libpg-query/parser';

const fp = fingerprintSync('SELECT * FROM users WHERE active = $1');
// Returns: string - unique 16-character fingerprint
```

### `normalize(sql: string): Promise<string>`

Normalizes a SQL query by removing comments, standardizing whitespace, and converting to a canonical form. Returns a Promise for the normalized SQL string.

```typescript
import { normalize } from '@libpg-query/parser';

const normalized = await normalize('SELECT * FROM users WHERE active = true');
// Returns: string - normalized SQL query
```

### `normalizeSync(sql: string): string`

Synchronous version that normalizes a SQL query directly.

```typescript
import { normalizeSync } from '@libpg-query/parser';

const normalized = normalizeSync('SELECT * FROM users WHERE active = true');
// Returns: string - normalized SQL query
```

### `scan(sql: string): Promise<ScanResult>`

Scans (tokenizes) a SQL query and returns detailed information about each token. Returns a Promise for a ScanResult containing all tokens with their positions, types, and classifications.

```typescript
import { scan } from '@libpg-query/parser';

const result = await scan('SELECT * FROM users WHERE id = $1');
// Returns: ScanResult - detailed tokenization information
console.log(result.tokens[0]); // { start: 0, end: 6, text: "SELECT", tokenType: 651, tokenName: "UNKNOWN", keywordKind: 4, keywordName: "RESERVED_KEYWORD" }
```

### `scanSync(sql: string): ScanResult`

Synchronous version that scans (tokenizes) a SQL query directly.

```typescript
import { scanSync } from '@libpg-query/parser';

const result = scanSync('SELECT * FROM users WHERE id = $1');
// Returns: ScanResult - detailed tokenization information
```

### Initialization

The library provides both async and sync methods. Async methods handle initialization automatically, while sync methods require explicit initialization.

#### Async Methods (Recommended)

Async methods handle initialization automatically and are always safe to use:

```typescript
import { parse, deparse, scan } from '@libpg-query/parser';

// These handle initialization automatically
const result = await parse('SELECT * FROM users');
const sql = await deparse(result);
const tokens = await scan('SELECT * FROM users');
```

#### Sync Methods

Sync methods require explicit initialization using `loadModule()`:

```typescript
import { loadModule, parseSync, scanSync } from '@libpg-query/parser';

// Initialize first
await loadModule();

// Now safe to use sync methods
const result = parseSync('SELECT * FROM users');
const tokens = scanSync('SELECT * FROM users');
```

### `loadModule(): Promise<void>`

Explicitly initializes the WASM module. Required before using any sync methods.

```typescript
import { loadModule, parseSync, scanSync } from '@libpg-query/parser';

// Initialize before using sync methods
await loadModule();
const result = parseSync('SELECT * FROM users');
const tokens = scanSync('SELECT * FROM users');
```

Note: We recommend using async methods as they handle initialization automatically. Use sync methods only when necessary, and always call `loadModule()` first.

### Type Definitions

```typescript
interface ParseResult {
  version: number;
  stmts: Statement[];
}

interface Statement {
  stmt_type: string;
  stmt_len: number;
  stmt_location: number;
  query: string;
}

interface ScanResult {
  version: number;
  tokens: ScanToken[];
}

interface ScanToken {
  start: number;          // Starting position in the SQL string
  end: number;            // Ending position in the SQL string
  text: string;           // The actual token text
  tokenType: number;      // Numeric token type identifier
  tokenName: string;      // Human-readable token type name
  keywordKind: number;    // Numeric keyword classification
  keywordName: string;    // Human-readable keyword classification
}
```

**Note:** The return value is an array, as multiple queries may be provided in a single string (semicolon-delimited, as PostgreSQL expects).

## Build Instructions

This package uses a **WASM-only build system** for true cross-platform compatibility without native compilation dependencies.

### Prerequisites

- Node.js (version 16 or higher recommended)
- [pnpm](https://pnpm.io/) (v8+ recommended)

### Building WASM Artifacts

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



## Versions

Our latest is built with `17-latest` branch from libpg_query


| PG Major Version | libpg_query | Branch                                                                                         | npm 
|--------------------------|-------------|------------------------------------------------------------------------------------------------|---------|
| 17                       | 17-latest   | [`17-latest`](https://github.com/constructive-io/libpg-query-node/tree/17-latest)                       | [`libpg-query@17.2.0`](https://www.npmjs.com/package/libpg-query/v/latest)
| 16                       | 16-latest   | [`16-latest`](https://github.com/constructive-io/libpg-query-node/tree/16-latest)                       | [`libpg-query@16.2.0`](https://www.npmjs.com/package/libpg-query/v/16.2.0)
| 15                       | 15-latest   | [`15-latest`](https://github.com/constructive-io/libpg-query-node/tree/15-latest)                       | [`libpg-query@15.1.0`](https://www.npmjs.com/package/libpg-query/v/15.1.0)
| 14                       | 14-latest   | [`14-latest`](https://github.com/constructive-io/libpg-query-node/tree/14-latest)                       | [`libpg-query@14.0.0`](https://www.npmjs.com/package/libpg-query/v/14.0.0)
| 13                       | 13-latest   | [`13-latest`](https://github.com/constructive-io/libpg-query-node/tree/13-latest)                       | [`libpg-query@13.3.1`](https://www.npmjs.com/package/libpg-query/v/13.3.1)
| 12                       | (n/a)       |                                                                                                |
| 11                       | (n/a)       |                                                                                                |
| 10                       | 10-latest   |                        | `@1.3.1` ([tree](https://github.com/constructive-io/pgsql-parser/tree/39b7b1adc8914253226e286a48105785219a81ca))      |


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