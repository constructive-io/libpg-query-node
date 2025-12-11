# @pgsql/enums

<p align="center" width="100%">
  <img height="120" src="https://github.com/constructive-io/pgsql-parser/assets/545047/6440fa7d-918b-4a3b-8d1b-755d85de8bea" />
</p>

<p align="center" width="100%">
  <a href="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml">
    <img height="20" src="https://github.com/constructive-io/libpg-query-node/actions/workflows/ci.yml/badge.svg" />
  </a>
   <a href="https://www.npmjs.com/package/@pgsql/enums"><img height="20" src="https://img.shields.io/npm/dt/@pgsql/enums"></a>
   <a href="https://www.npmjs.com/package/@pgsql/enums"><img height="20" src="https://img.shields.io/npm/dw/@pgsql/enums"/></a>
   <a href="https://github.com/constructive-io/libpg-query-node/blob/main/LICENSE-MIT"><img height="20" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
   <a href="https://www.npmjs.com/package/@pgsql/enums"><img height="20" src="https://img.shields.io/github/package-json/v/constructive-io/libpg-query-node?filename=enums%2F14%2Fpackage.json"/></a>
</p>

`@pgsql/enums` is a TypeScript library providing enum definitions for PostgreSQL AST nodes, primarily used in conjunction with [`pgsql-parser`](https://github.com/constructive-io/pgsql-parser). It offers a comprehensive and type-safe way to work with PostgreSQL enum values in query parsing and AST manipulation.


## Installation

Install the package via npm:

```bash
npm install @pgsql/enums
```

## Usage

Here's a simple example showing how to work with enums, converting between enum names and their numeric values:

```ts
import { ObjectType } from '@pgsql/enums';

// Get the numeric value of an enum
const tableValue = ObjectType.OBJECT_TABLE;
console.log(tableValue); // 41

// Convert from value back to enum name
const enumName = ObjectType[41];
console.log(enumName); // "OBJECT_TABLE"

// Use in comparisons
if (someNode.objectType === ObjectType.OBJECT_TABLE) {
  console.log("This is a table object");
}
```

## Versions

Our latest is built with PostgreSQL 17 enum definitions.

| PG Major Version | libpg_query | npm dist-tag 
|--------------------------|-------------|---------|
| 17                       | 17-6.1.0    | [`pg17`](https://www.npmjs.com/package/@pgsql/enums/v/latest)
| 16                       | 16-5.2.0    | [`pg16`](https://www.npmjs.com/package/@pgsql/enums/v/pg16)
| 15                       | 15-4.2.4    | [`pg15`](https://www.npmjs.com/package/@pgsql/enums/v/pg15)
| 14                       | 14-3.0.0    | [`pg14`](https://www.npmjs.com/package/@pgsql/enums/v/pg14)
| 13                       | 13-2.2.0    | [`pg13`](https://www.npmjs.com/package/@pgsql/enums/v/pg13)

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