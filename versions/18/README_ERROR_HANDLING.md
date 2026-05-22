# Enhanced Error Handling in libpg-query-node v18

## Overview

Version 18 includes enhanced error handling that provides detailed information about SQL parsing errors, including exact error positions, source file information, and visual error indicators.

## Error Details

When a parsing error occurs, the error object now includes a `sqlDetails` property with the following information:

```typescript
interface SqlErrorDetails {
  message: string;        // Full error message
  cursorPosition: number; // 0-based position in the query
  fileName?: string;      // Source file (e.g., 'scan.l', 'gram.y')
  functionName?: string;  // Internal function name
  lineNumber?: number;    // Line number in source file
  context?: string;       // Additional context
}
```

## Basic Usage

```javascript
const { parseSync, loadModule } = require('@libpg-query/v18');

await loadModule();

try {
  const result = parseSync("SELECT * FROM users WHERE id = 'unclosed");
} catch (error) {
  if (error.sqlDetails) {
    console.log('Error:', error.message);
    console.log('Position:', error.sqlDetails.cursorPosition);
    console.log('Source:', error.sqlDetails.fileName);
  }
}
```

## Error Formatting Helper

The library includes a built-in `formatSqlError()` function for consistent error formatting:

```javascript
const { parseSync, loadModule, formatSqlError } = require('@libpg-query/v18');

await loadModule();

const query = "SELECT * FROM users WHERE id = 'unclosed";

try {
  parseSync(query);
} catch (error) {
  console.log(formatSqlError(error, query));
}
```

Output:
```
Error: unterminated quoted string at or near "'unclosed"
Position: 31
Source: file: scan.l, function: scanner_yyerror, line: 1262
SELECT * FROM users WHERE id = 'unclosed
                               ^
```

## Formatting Options

The `formatSqlError()` function accepts options to customize the output:

```typescript
interface SqlErrorFormatOptions {
  showPosition?: boolean;  // Show the error position marker (default: true)
  showQuery?: boolean;     // Show the query text (default: true)
  color?: boolean;         // Use ANSI colors (default: false)
  maxQueryLength?: number; // Max query length to display (default: no limit)
}
```

### Examples

#### With Colors (for terminal output)
```javascript
console.log(formatSqlError(error, query, { color: true }));
```

#### Without Position Marker
```javascript
console.log(formatSqlError(error, query, { showPosition: false }));
```

#### With Query Truncation (for long queries)
```javascript
console.log(formatSqlError(error, longQuery, { maxQueryLength: 80 }));
```

## Type Guard

Use the `hasSqlDetails()` function to check if an error has SQL details:

```javascript
const { hasSqlDetails } = require('@libpg-query/v18');

try {
  parseSync(query);
} catch (error) {
  if (hasSqlDetails(error)) {
    // TypeScript knows error has sqlDetails property
    console.log('Error at position:', error.sqlDetails.cursorPosition);
  }
}
```

## Error Types

Errors are classified by their source file:
- **Lexer errors** (`scan.l`): Token recognition errors (invalid characters, unterminated strings)
- **Parser errors** (`gram.y`): Grammar violations (syntax errors, missing keywords)

## Examples of Common Errors

### Unterminated String
```sql
SELECT * FROM users WHERE name = 'unclosed
```
Error: `unterminated quoted string at or near "'unclosed"`

### Invalid Character
```sql
SELECT * FROM users WHERE id = @
```
Error: `syntax error at end of input`

### Reserved Keyword
```sql
SELECT * FROM table
```
Error: `syntax error at or near "table"` (use quotes: `"table"`)

### Missing Keyword
```sql
SELECT * WHERE id = 1
```
Error: `syntax error at or near "WHERE"`

## Backward Compatibility

The enhanced error handling is fully backward compatible:
- Existing code that catches errors will continue to work
- The `sqlDetails` property is added without modifying the base Error object
- All existing error properties and methods remain unchanged

## Migration Guide

To take advantage of the new error handling:

1. **Check for sqlDetails**:
   ```javascript
   if (error.sqlDetails) {
     // Use enhanced error information
   }
   ```

2. **Use the formatting helper**:
   ```javascript
   console.log(formatSqlError(error, query));
   ```

3. **Type-safe access** (TypeScript):
   ```typescript
   if (hasSqlDetails(error)) {
     // error.sqlDetails is now typed
   }
   ```