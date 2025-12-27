# @pgsql/parser

<p align="center" width="100%">
    <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" alt="constructive.io">
</p>

<p align="center" width="100%">
   <a href="https://github.com/constructive-io/libpg-query/blob/main/LICENSE-MIT"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/libpg-query"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/libpg-query-node?filename=versions%2F17%2Fpackage.json"/></a><br />
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml/badge.svg" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/macOS-available-333333?logo=apple&logoColor=white" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/Windows-available-333333?logo=windows&logoColor=white" /></a>
   <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml"><img height="20" src="https://img.shields.io/badge/Linux-available-333333?logo=linux&logoColor=white" /></a>
</p>

Multi-version PostgreSQL parser with dynamic version selection. This package provides a unified interface to parse PostgreSQL queries using different parser versions (13, 14, 15, 16, 17).

## Installation

```bash
# Install latest (full build with all versions)
npm install @pgsql/parser

# Install LTS version (PostgreSQL 15-17 only)
npm install @pgsql/parser@lts
```

## Usage

### Dynamic Version Selection

```javascript
import Parser from '@pgsql/parser';
// or: import { Parser } from '@pgsql/parser';

// Create parser with default version (17)
const parser = new Parser();
const result = await parser.parse('SELECT 1+1 as sum');
console.log(result);
// { version: 170004, stmts: [...] }

// Create parser with specific version
const parser15 = new Parser({ version: 15 });
const result15 = await parser15.parse('SELECT 1+1 as sum');
console.log(result15);
// { version: 150007, stmts: [...] }

// Check supported versions
import { isSupportedVersion, getSupportedVersions } from '@pgsql/parser';
console.log(getSupportedVersions()); // [13, 14, 15, 16, 17]
console.log(isSupportedVersion(15)); // true
```

### CommonJS Usage

```javascript
const { Parser, isSupportedVersion, getSupportedVersions } = require('@pgsql/parser');

async function parseSQL() {
  const parser = new Parser({ version: 16 });
  const result = await parser.parse('SELECT * FROM users');
  console.log(result);
}
```

### Static Version Imports

For better tree-shaking and when you know which version you need:

```javascript
// Import specific version
import { parse } from '@pgsql/parser/v17';

const result = await parse('SELECT 1');
console.log(result);
// { version: 170004, stmts: [...] }

// Or access via the main module
import { v17 } from '@pgsql/parser';
const result2 = await v17.parse('SELECT 1');
```

### Error Handling

The parser throws errors directly (not wrapped in result objects):

```javascript
import Parser from '@pgsql/parser';

const parser = new Parser();
try {
  const result = await parser.parse('INVALID SQL');
} catch (error) {
  console.error(error.name); // 'SqlError'
  console.error(error.message); // 'syntax error at or near "INVALID"'
  console.error(error.sqlDetails); // { cursorPosition: 0, ... }
}
```

## API

### `Parser`

The main parser class for parsing SQL with a specific PostgreSQL version.

```typescript
import Parser from '@pgsql/parser';

const parser = new Parser(options?: { version?: 13 | 14 | 15 | 16 | 17 });
```

#### Properties
- `version`: The PostgreSQL version used by this parser instance
- `ready`: A promise that resolves when the parser is fully loaded

#### Methods

##### `parse(query: string): Promise<ParseResult>`
Parse a SQL query asynchronously. Automatically loads the parser if needed.

```javascript
const result = await parser.parse('SELECT 1');
// Returns: { version: 170004, stmts: [...] }
```

##### `parseSync(query: string): ParseResult`
Parse a SQL query synchronously. Requires the parser to be loaded first.

```javascript
await parser.loadParser(); // or await parser.ready
const result = parser.parseSync('SELECT 1');
```

##### `loadParser(): Promise<void>`
Explicitly load the parser. Usually not needed as `parse()` loads automatically.

### Utility Functions

##### `isSupportedVersion(version: number): boolean`
Check if a PostgreSQL version is supported.

##### `getSupportedVersions(): number[]`
Get an array of all supported PostgreSQL versions.

### Error Handling

All parsing errors throw `SqlError` with the following structure:

```typescript
class SqlError extends Error {
  name: 'SqlError';
  message: string;
  sqlDetails?: {
    cursorPosition?: number;
    fileName?: string;
    functionName?: string;
    lineNumber?: number;
  };
}
```

## Version Exports

Each PostgreSQL version can be imported directly for better tree-shaking:

- `@pgsql/parser/v13` - PostgreSQL 13 parser
- `@pgsql/parser/v14` - PostgreSQL 14 parser
- `@pgsql/parser/v15` - PostgreSQL 15 parser
- `@pgsql/parser/v16` - PostgreSQL 16 parser  
- `@pgsql/parser/v17` - PostgreSQL 17 parser

Each version export provides:
- `parse(query: string): Promise<ParseResult>` - Parse a query asynchronously
- `parseSync(query: string): ParseResult` - Parse a query synchronously (auto-loads if needed)
- `SqlError` - The error class for parsing errors
- All TypeScript types for that PostgreSQL version

Example:
```javascript
import { parse, parseSync } from '@pgsql/parser/v17';

// Async parsing
const result = await parse('SELECT 1');

// Sync parsing (auto-loads on first use)
const result2 = parseSync('SELECT 2');
```

## Build Configurations

This package supports different build configurations for different use cases:

- **full** (default): All versions (13, 14, 15, 16, 17) - Provides maximum compatibility
- **lts**: LTS (Long Term Support) versions only (15, 16, 17) - Recommended for production use with stable PostgreSQL versions

When installing from npm, you can choose the appropriate build using tags:
- `npm install @pgsql/parser` - Full build with all versions
- `npm install @pgsql/parser@lts` - LTS build 

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