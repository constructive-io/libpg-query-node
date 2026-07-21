# Scan API Documentation

## Overview

The scan API provides detailed tokenization of PostgreSQL SQL queries, returning information about each token including its position, type, and keyword classification. This document explains how to use the scan functionality and how it relates to the parsing API.

## Basic Usage

### Async Scanning
```typescript
import { scan } from 'libpg-query';

const result = await scan('SELECT id, name FROM users WHERE active = true');
console.log(result.tokens);
```

### Sync Scanning
```typescript
import { scanSync, loadModule } from 'libpg-query';

// Initialize WASM module first
await loadModule();

const result = scanSync('SELECT id, name FROM users WHERE active = true');
console.log(result.tokens);
```

## Token Information

Each token in the scan result contains:

```typescript
interface ScanToken {
  start: number;          // Starting position in the SQL string (0-based)
  end: number;            // Ending position in the SQL string (exclusive)
  text: string;           // The actual token text extracted from SQL
  tokenType: number;      // Numeric token type identifier
  tokenName: string;      // Human-readable token type name
  keywordKind: number;    // Numeric keyword classification
  keywordName: string;    // Human-readable keyword classification
}
```

## Token Types

### Common Token Types

| tokenName | Description | Example |
|-----------|-------------|---------|
| `IDENT` | Regular identifier | `users`, `id`, `column_name` |
| `SCONST` | String constant | `'hello world'`, `'value'` |
| `ICONST` | Integer constant | `42`, `123`, `0` |
| `FCONST` | Float constant | `3.14`, `2.718` |
| `PARAM` | Parameter marker | `$1`, `$2`, `$3` |
| `ASCII_40` | Left parenthesis | `(` |
| `ASCII_41` | Right parenthesis | `)` |
| `ASCII_42` | Asterisk | `*` |
| `ASCII_44` | Comma | `,` |
| `ASCII_59` | Semicolon | `;` |
| `ASCII_61` | Equals sign | `=` |
| `TYPECAST` | Type casting operator | `::` |
| `GREATER_EQUALS` | Greater than or equal | `>=` |
| `LESS_EQUALS` | Less than or equal | `<=` |
| `NOT_EQUALS` | Not equal operator | `<>`, `!=` |
| `SQL_COMMENT` | SQL comment | `-- comment` |
| `C_COMMENT` | C-style comment | `/* comment */` |
| `UNKNOWN` | Keywords and other tokens | `SELECT`, `FROM`, `WHERE` |

### Keyword Classifications

| keywordName | Description | Examples |
|-------------|-------------|----------|
| `NO_KEYWORD` | Not a keyword | identifiers, operators, literals |
| `UNRESERVED_KEYWORD` | Unreserved keyword | `INSERT`, `UPDATE`, `name` |
| `COL_NAME_KEYWORD` | Column name keyword | `VALUES`, `BETWEEN` |
| `TYPE_FUNC_NAME_KEYWORD` | Type/function name keyword | `INNER`, `JOIN`, `IS` |
| `RESERVED_KEYWORD` | Reserved keyword | `SELECT`, `FROM`, `WHERE` |

## Relationship with Parse Tree

The scan token positions directly correspond to `location` fields in the Abstract Syntax Tree (AST) produced by the parse API. This allows you to map between tokens and AST nodes.

### Example Mapping

Given this SQL:
```sql
SELECT id, name FROM users WHERE active = true
```

**Scan tokens:**
```
[0] "SELECT" (0-6)
[1] "id" (7-9)
[2] "," (9-10)
[3] "name" (11-15)
[4] "FROM" (16-20)
[5] "users" (21-26)
[6] "WHERE" (27-32)
[7] "active" (33-39)
[8] "=" (40-41)
[9] "true" (42-46)
```

**Corresponding AST locations:**
```json
{
  "SelectStmt": {
    "targetList": [
      {
        "ResTarget": {
          "val": {
            "ColumnRef": {
              "fields": [{"String": {"sval": "id"}}],
              "location": 7  // matches "id" token at position 7-9
            }
          },
          "location": 7
        }
      },
      {
        "ResTarget": {
          "val": {
            "ColumnRef": {
              "fields": [{"String": {"sval": "name"}}],
              "location": 11  // matches "name" token at position 11-15
            }
          },
          "location": 11
        }
      }
    ],
    "fromClause": [
      {
        "RangeVar": {
          "relname": "users",
          "location": 21  // matches "users" token at position 21-26
        }
      }
    ],
    "whereClause": {
      "A_Expr": {
        "lexpr": {
          "ColumnRef": {
            "fields": [{"String": {"sval": "active"}}],
            "location": 33  // matches "active" token at position 33-39
          }
        },
        "rexpr": {
          "A_Const": {
            "boolval": {"boolval": true},
            "location": 42  // matches "true" token at position 42-46
          }
        },
        "location": 40  // matches "=" token at position 40-41
      }
    }
  }
}
```

### Token-to-AST Mapping Function

Here's a utility function to map between scan tokens and AST nodes:

```typescript
import { scan, parse } from 'libpg-query';

interface TokenASTMapping {
  token: ScanToken;
  astNodes: Array<{path: string; node: any}>;
}

async function mapTokensToAST(sql: string): Promise<TokenASTMapping[]> {
  const [scanResult, parseResult] = await Promise.all([
    scan(sql),
    parse(sql)
  ]);
  
  // Collect all AST nodes with locations
  const astNodes: Array<{path: string; location: number; node: any}> = [];
  
  function traverse(obj: any, path: string = '') {
    if (obj && typeof obj === 'object') {
      if (typeof obj.location === 'number') {
        astNodes.push({path, location: obj.location, node: obj});
      }
      
      for (const [key, value] of Object.entries(obj)) {
        const newPath = path ? `${path}.${key}` : key;
        traverse(value, newPath);
      }
    }
  }
  
  traverse(parseResult);
  
  // Map tokens to AST nodes
  return scanResult.tokens.map(token => {
    const matchingNodes = astNodes.filter(astNode => {
      // AST location points to start of token
      return astNode.location >= token.start && astNode.location < token.end;
    });
    
    return {
      token,
      astNodes: matchingNodes.map(n => ({path: n.path, node: n.node}))
    };
  });
}

// Usage
const mappings = await mapTokensToAST('SELECT id FROM users WHERE active = true');
mappings.forEach(({token, astNodes}) => {
  console.log(`Token "${token.text}" (${token.start}-${token.end}):`);
  astNodes.forEach(({path, node}) => {
    console.log(`  AST: ${path} at location ${node.location}`);
  });
});
```

## Use Cases

### 1. Syntax Highlighting

Use scan results to apply syntax highlighting in code editors:

```typescript
function applySyntaxHighlighting(sql: string, tokens: ScanToken[]): string {
  let highlighted = '';
  let lastEnd = 0;
  
  for (const token of tokens) {
    // Add any whitespace between tokens
    highlighted += sql.substring(lastEnd, token.start);
    
    // Apply highlighting based on token type
    const cssClass = getHighlightClass(token);
    highlighted += `<span class="${cssClass}">${token.text}</span>`;
    
    lastEnd = token.end;
  }
  
  // Add remaining SQL
  highlighted += sql.substring(lastEnd);
  
  return highlighted;
}

function getHighlightClass(token: ScanToken): string {
  if (token.keywordName === 'RESERVED_KEYWORD') return 'sql-keyword';
  if (token.tokenName === 'SCONST') return 'sql-string';
  if (token.tokenName === 'ICONST' || token.tokenName === 'FCONST') return 'sql-number';
  if (token.tokenName === 'PARAM') return 'sql-parameter';
  if (token.tokenName === 'SQL_COMMENT' || token.tokenName === 'C_COMMENT') return 'sql-comment';
  return 'sql-default';
}
```

### 2. Parameter Extraction

Extract all parameters from a query:

```typescript
function extractParameters(sql: string): Array<{param: string; position: number}> {
  const result = scanSync(sql);
  return result.tokens
    .filter(token => token.tokenName === 'PARAM')
    .map(token => ({
      param: token.text,
      position: token.start
    }));
}

const params = extractParameters('SELECT * FROM users WHERE id = $1 AND name = $2');
// Returns: [{param: '$1', position: 38}, {param: '$2', position: 52}]
```

### 3. Query Complexity Analysis

Analyze query complexity based on token types:

```typescript
function analyzeQueryComplexity(sql: string): {
  joins: number;
  subqueries: number;
  parameters: number;
  aggregates: string[];
  totalTokens: number;
} {
  const result = scanSync(sql);
  const tokens = result.tokens;
  
  const joins = tokens.filter(t => 
    t.text.toUpperCase() === 'JOIN' || 
    t.text.toUpperCase() === 'INNER' || 
    t.text.toUpperCase() === 'LEFT' ||
    t.text.toUpperCase() === 'RIGHT'
  ).length;
  
  const subqueries = tokens.filter(t => t.text.toUpperCase() === 'SELECT').length - 1;
  
  const parameters = tokens.filter(t => t.tokenName === 'PARAM').length;
  
  const aggregates = tokens
    .filter(t => ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(t.text.toUpperCase()))
    .map(t => t.text.toUpperCase());
  
  return {
    joins,
    subqueries: Math.max(0, subqueries),
    parameters,
    aggregates,
    totalTokens: tokens.length
  };
}
```

### 4. SQL Formatting

Use token positions for intelligent SQL formatting:

```typescript
function formatSQL(sql: string): string {
  const result = scanSync(sql);
  let formatted = '';
  let indentLevel = 0;
  let lastEnd = 0;
  
  for (const token of result.tokens) {
    // Add whitespace between tokens
    const gap = sql.substring(lastEnd, token.start);
    
    // Format based on token type
    if (token.text.toUpperCase() === 'SELECT') {
      formatted += '\\n' + '  '.repeat(indentLevel) + token.text;
    } else if (token.text.toUpperCase() === 'FROM') {
      formatted += '\\n' + '  '.repeat(indentLevel) + token.text;
    } else if (token.text.toUpperCase() === 'WHERE') {
      formatted += '\\n' + '  '.repeat(indentLevel) + token.text;
    } else if (token.text === '(') {
      formatted += token.text;
      indentLevel++;
    } else if (token.text === ')') {
      indentLevel--;
      formatted += token.text;
    } else {
      formatted += (gap.trim() ? ' ' : '') + token.text;
    }
    
    lastEnd = token.end;
  }
  
  return formatted.trim();
}
```

## Performance Considerations

- Scanning is generally faster than full parsing
- For large SQL strings, consider streaming or chunked processing
- Token positions are 0-based and use exclusive end positions
- The scan operation is stateless and thread-safe

## Error Handling

The scan API is more permissive than the parse API and will attempt to tokenize even malformed SQL:

```typescript
try {
  const result = scanSync('SELECT * FROM invalid$$$');
  // May still return tokens for recognizable parts
  console.log(result.tokens);
} catch (error) {
  console.error('Scan error:', error.message);
}
```

## Integration with Other Tools

### ESLint Rules
Create custom ESLint rules for SQL:

```typescript
function createSQLLintRule() {
  return {
    meta: {
      type: 'problem',
      docs: { description: 'Detect SQL injection risks' }
    },
    create(context) {
      return {
        TemplateLiteral(node) {
          if (node.quasiSConst) {
            const sql = node.quasiSConst[0].value.raw;
            const tokens = scanSync(sql);
            
            // Check for unparameterized string concatenation
            const hasStringLiterals = tokens.some(t => t.tokenName === 'SCONST');
            const hasParameters = tokens.some(t => t.tokenName === 'PARAM');
            
            if (hasStringLiterals && !hasParameters) {
              context.report({
                node,
                message: 'Potential SQL injection: use parameterized queries'
              });
            }
          }
        }
      };
    }
  };
}
```

### Database Migration Tools
Analyze schema changes:

```typescript
function detectSchemaChanges(oldSQL: string, newSQL: string): string[] {
  const oldTokens = scanSync(oldSQL);
  const newTokens = scanSync(newSQL);
  
  const changes: string[] = [];
  
  // Detect table name changes
  const oldTables = extractTableNames(oldTokens);
  const newTables = extractTableNames(newTokens);
  
  const addedTables = newTables.filter(t => !oldTables.includes(t));
  const removedTables = oldTables.filter(t => !newTables.includes(t));
  
  changes.push(...addedTables.map(t => `Added table: ${t}`));
  changes.push(...removedTables.map(t => `Removed table: ${t}`));
  
  return changes;
}
```

This comprehensive relationship between scan tokens and AST locations enables powerful SQL analysis, transformation, and tooling capabilities.