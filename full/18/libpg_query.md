# libpg_query API Documentation

This document provides comprehensive documentation for the libpg_query API, focusing on the core parsing, scanning, and deparsing functionality.

## Overview

libpg_query is a C library that provides PostgreSQL SQL parsing functionality. It exposes the PostgreSQL parser as a standalone library, allowing you to parse SQL statements into parse trees, scan for tokens, and deparse parse trees back into SQL.

## Core Data Structures

### PgQueryError
```c
typedef struct {
    char* message;     // exception message
    char* funcname;    // source function of exception (e.g. SearchSysCache)
    char* filename;    // source of exception (e.g. parse.l)
    int lineno;        // source of exception (e.g. 104)
    int cursorpos;     // char in query at which exception occurred
    char* context;     // additional context (optional, can be NULL)
} PgQueryError;
```

### PgQueryProtobuf
```c
typedef struct {
    size_t len;
    char* data;
} PgQueryProtobuf;
```

### Parser Options
```c
typedef enum {
    PG_QUERY_PARSE_DEFAULT = 0,
    PG_QUERY_PARSE_TYPE_NAME,
    PG_QUERY_PARSE_PLPGSQL_EXPR,
    PG_QUERY_PARSE_PLPGSQL_ASSIGN1,
    PG_QUERY_PARSE_PLPGSQL_ASSIGN2,
    PG_QUERY_PARSE_PLPGSQL_ASSIGN3
} PgQueryParseMode;
```

### Parser Option Flags
- `PG_QUERY_DISABLE_BACKSLASH_QUOTE` (16) - backslash_quote = off
- `PG_QUERY_DISABLE_STANDARD_CONFORMING_STRINGS` (32) - standard_conforming_strings = off  
- `PG_QUERY_DISABLE_ESCAPE_STRING_WARNING` (64) - escape_string_warning = off

## Core API Functions

### Scanning Functions

#### pg_query_scan
```c
PgQueryScanResult pg_query_scan(const char* input);
```
**Description**: Scans SQL input and returns tokens in protobuf format.

**Parameters**:
- `input`: SQL string to scan

**Returns**: `PgQueryScanResult` containing:
- `pbuf`: Protobuf data with scan results
- `stderr_buffer`: Any stderr output during scanning
- `error`: Error information if scanning failed

**Usage**: Use this when you need to tokenize SQL without full parsing.

## Scanning and Token Processing

### Working with Scan Results

The `pg_query_scan` function returns tokens in protobuf format that need to be unpacked to access individual tokens. Here's the complete workflow:

### Step 1: Scan SQL
```c
const char* sql = "SELECT * FROM users WHERE id = $1";
PgQueryScanResult result = pg_query_scan(sql);

if (result.error) {
    printf("Scan error: %s at position %d\n", 
           result.error->message, result.error->cursorpos);
    pg_query_free_scan_result(result);
    return;
}
```

### Step 2: Unpack Protobuf Data
```c
#include "protobuf/pg_query.pb-c.h"

PgQuery__ScanResult *scan_result = pg_query__scan_result__unpack(
    NULL,                    // Use default allocator
    result.pbuf.len,         // Length of protobuf data
    (void *) result.pbuf.data // Protobuf data
);

printf("Found %zu tokens\n", scan_result->n_tokens);
```

### Step 3: Process Individual Tokens
```c
for (size_t i = 0; i < scan_result->n_tokens; i++) {
    PgQuery__ScanToken *token = scan_result->tokens[i];
    
    // Extract token text from original SQL
    int token_length = token->end - token->start;
    char token_text[token_length + 1];
    strncpy(token_text, &sql[token->start], token_length);
    token_text[token_length] = '\0';
    
    // Get token type name
    const ProtobufCEnumValue *token_kind = 
        protobuf_c_enum_descriptor_get_value(&pg_query__token__descriptor, token->token);
    
    // Get keyword classification
    const ProtobufCEnumValue *keyword_kind = 
        protobuf_c_enum_descriptor_get_value(&pg_query__keyword_kind__descriptor, token->keyword_kind);
    
    printf("Token %zu: \"%s\" [%d-%d] Type: %s, Keyword: %s\n", 
           i, token_text, token->start, token->end,
           token_kind->name, keyword_kind->name);
}
```

### Step 4: Clean Up Memory
```c
// Free the unpacked protobuf data
pg_query__scan_result__free_unpacked(scan_result, NULL);

// Free the original scan result
pg_query_free_scan_result(result);
```

## Token Structure Details

### PgQuery__ScanResult Structure
```c
struct PgQuery__ScanResult {
    ProtobufCMessage base;
    int32_t version;          // Protocol version
    size_t n_tokens;          // Number of tokens
    PgQuery__ScanToken **tokens; // Array of token pointers
};
```

### PgQuery__ScanToken Structure
```c
struct PgQuery__ScanToken {
    ProtobufCMessage base;
    int32_t start;            // Starting position in SQL string
    int32_t end;              // Ending position in SQL string
    PgQuery__Token token;     // Token type enum
    PgQuery__KeywordKind keyword_kind; // Keyword classification
};
```

## Token Types and Classifications

### Keyword Classifications (PgQuery__KeywordKind)
- `PG_QUERY__KEYWORD_KIND__NO_KEYWORD` (0) - Not a keyword
- `PG_QUERY__KEYWORD_KIND__UNRESERVED_KEYWORD` (1) - Unreserved keyword
- `PG_QUERY__KEYWORD_KIND__COL_NAME_KEYWORD` (2) - Column name keyword
- `PG_QUERY__KEYWORD_KIND__TYPE_FUNC_NAME_KEYWORD` (3) - Type/function name keyword
- `PG_QUERY__KEYWORD_KIND__RESERVED_KEYWORD` (4) - Reserved keyword

### Common Token Types (PgQuery__Token)
**Special/Control Tokens:**
- `PG_QUERY__TOKEN__NUL` (0) - Null token

**Single-Character Operators:**
- `PG_QUERY__TOKEN__ASCII_40` (40) - "("
- `PG_QUERY__TOKEN__ASCII_41` (41) - ")"
- `PG_QUERY__TOKEN__ASCII_42` (42) - "*"
- `PG_QUERY__TOKEN__ASCII_44` (44) - ","
- `PG_QUERY__TOKEN__ASCII_59` (59) - ";"
- `PG_QUERY__TOKEN__ASCII_61` (61) - "="

**Named Lexical Tokens:**
- `PG_QUERY__TOKEN__IDENT` (258) - Regular identifier
- `PG_QUERY__TOKEN__SCONST` (261) - String constant
- `PG_QUERY__TOKEN__ICONST` (266) - Integer constant
- `PG_QUERY__TOKEN__FCONST` (260) - Float constant
- `PG_QUERY__TOKEN__PARAM` (267) - Parameter marker ($1, $2, etc.)

**Multi-Character Operators:**
- `PG_QUERY__TOKEN__TYPECAST` (268) - "::"
- `PG_QUERY__TOKEN__DOT_DOT` (269) - ".."
- `PG_QUERY__TOKEN__LESS_EQUALS` (272) - "<="
- `PG_QUERY__TOKEN__GREATER_EQUALS` (273) - ">="
- `PG_QUERY__TOKEN__NOT_EQUALS` (274) - "!=" or "<>"

**Common SQL Keywords:**
- `PG_QUERY__TOKEN__SELECT` - SELECT keyword
- `PG_QUERY__TOKEN__FROM` - FROM keyword
- `PG_QUERY__TOKEN__WHERE` - WHERE keyword
- `PG_QUERY__TOKEN__INSERT` - INSERT keyword
- `PG_QUERY__TOKEN__UPDATE` - UPDATE keyword
- `PG_QUERY__TOKEN__DELETE` - DELETE keyword

**Comments:**
- `PG_QUERY__TOKEN__SQL_COMMENT` (275) - SQL-style comment (-- comment)
- `PG_QUERY__TOKEN__C_COMMENT` (276) - C-style comment (/* comment */)

## Protobuf Helper Functions

### Unpacking Functions
```c
// Unpack scan result
PgQuery__ScanResult *pg_query__scan_result__unpack(
    ProtobufCAllocator *allocator,  // NULL for default
    size_t len,                     // Length of data
    const uint8_t *data            // Protobuf data
);

// Free unpacked scan result
void pg_query__scan_result__free_unpacked(
    PgQuery__ScanResult *message,   // Message to free
    ProtobufCAllocator *allocator   // NULL for default
);
```

### Enum Value Lookup Functions
```c
// Get token type name
const ProtobufCEnumValue *protobuf_c_enum_descriptor_get_value(
    const ProtobufCEnumDescriptor *desc,  // &pg_query__token__descriptor
    int value                            // token->token
);

// Get keyword kind name  
const ProtobufCEnumValue *protobuf_c_enum_descriptor_get_value(
    const ProtobufCEnumDescriptor *desc,  // &pg_query__keyword_kind__descriptor
    int value                            // token->keyword_kind
);
```

## Complete Example: SQL Tokenizer

```c
#include <pg_query.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "protobuf/pg_query.pb-c.h"

void print_tokens(const char* sql) {
    PgQueryScanResult result = pg_query_scan(sql);
    
    if (result.error) {
        printf("Error: %s at position %d\n", 
               result.error->message, result.error->cursorpos);
        pg_query_free_scan_result(result);
        return;
    }
    
    PgQuery__ScanResult *scan_result = pg_query__scan_result__unpack(
        NULL, result.pbuf.len, (void *) result.pbuf.data);
    
    printf("SQL: %s\n", sql);
    printf("Tokens (%zu):\n", scan_result->n_tokens);
    
    for (size_t i = 0; i < scan_result->n_tokens; i++) {
        PgQuery__ScanToken *token = scan_result->tokens[i];
        
        // Extract token text
        int len = token->end - token->start;
        printf("  [%zu] \"%.*s\" (%d-%d) ", 
               i, len, &sql[token->start], token->start, token->end);
        
        // Get token type
        const ProtobufCEnumValue *token_kind = 
            protobuf_c_enum_descriptor_get_value(&pg_query__token__descriptor, token->token);
        printf("Type: %s", token_kind->name);
        
        // Get keyword classification if applicable
        if (token->keyword_kind != PG_QUERY__KEYWORD_KIND__NO_KEYWORD) {
            const ProtobufCEnumValue *keyword_kind = 
                protobuf_c_enum_descriptor_get_value(&pg_query__keyword_kind__descriptor, token->keyword_kind);
            printf(", Keyword: %s", keyword_kind->name);
        }
        printf("\n");
    }
    
    pg_query__scan_result__free_unpacked(scan_result, NULL);
    pg_query_free_scan_result(result);
}

int main() {
    print_tokens("SELECT * FROM users WHERE id = $1");
    print_tokens("INSERT INTO table VALUES (1, 'text', 3.14)");
    print_tokens("-- Comment\nUPDATE table SET col = col + 1");
    
    pg_query_exit();
    return 0;
}
```

## Build Requirements

To use scanning functionality, compile with:
```bash
gcc -I. -I./protobuf your_program.c -lpg_query -lprotobuf-c
```

Make sure to include:
- `pg_query.h` - Main API header
- `protobuf/pg_query.pb-c.h` - Protobuf definitions

### Parsing Functions

#### pg_query_parse
```c
PgQueryParseResult pg_query_parse(const char* input);
```
**Description**: Parses SQL input into a JSON parse tree.

**Parameters**:
- `input`: SQL string to parse

**Returns**: `PgQueryParseResult` containing:
- `parse_tree`: JSON representation of the parse tree
- `stderr_buffer`: Any stderr output during parsing
- `error`: Error information if parsing failed

#### pg_query_parse_opts
```c
PgQueryParseResult pg_query_parse_opts(const char* input, int parser_options);
```
**Description**: Parses SQL input with custom parser options.

**Parameters**:
- `input`: SQL string to parse
- `parser_options`: Bitwise OR of parser options and flags

**Returns**: Same as `pg_query_parse`

#### pg_query_parse_protobuf
```c
PgQueryProtobufParseResult pg_query_parse_protobuf(const char* input);
```
**Description**: Parses SQL input into protobuf format parse tree.

**Parameters**:
- `input`: SQL string to parse

**Returns**: `PgQueryProtobufParseResult` containing:
- `parse_tree`: Protobuf representation of the parse tree
- `stderr_buffer`: Any stderr output during parsing
- `error`: Error information if parsing failed

#### pg_query_parse_protobuf_opts
```c
PgQueryProtobufParseResult pg_query_parse_protobuf_opts(const char* input, int parser_options);
```
**Description**: Parses SQL input into protobuf format with custom options.

**Parameters**:
- `input`: SQL string to parse
- `parser_options`: Bitwise OR of parser options and flags

**Returns**: Same as `pg_query_parse_protobuf`

#### pg_query_parse_plpgsql
```c
PgQueryPlpgsqlParseResult pg_query_parse_plpgsql(const char* input);
```
**Description**: Parses PL/pgSQL code.

**Parameters**:
- `input`: PL/pgSQL code to parse

**Returns**: `PgQueryPlpgsqlParseResult` containing:
- `plpgsql_funcs`: JSON representation of PL/pgSQL functions
- `error`: Error information if parsing failed

### Deparsing Functions

#### pg_query_deparse_protobuf
```c
PgQueryDeparseResult pg_query_deparse_protobuf(PgQueryProtobuf parse_tree);
```
**Description**: Converts a protobuf parse tree back into SQL.

**Parameters**:
- `parse_tree`: Protobuf parse tree to deparse

**Returns**: `PgQueryDeparseResult` containing:
- `query`: Deparsed SQL string
- `error`: Error information if deparsing failed

**Usage**: Use this to convert parse trees back to SQL, useful for query transformation.

### Utility Functions

#### pg_query_normalize
```c
PgQueryNormalizeResult pg_query_normalize(const char* input);
```
**Description**: Normalizes a SQL query by removing comments and standardizing formatting.

**Parameters**:
- `input`: SQL string to normalize

**Returns**: `PgQueryNormalizeResult` containing:
- `normalized_query`: Normalized SQL string
- `error`: Error information if normalization failed

#### pg_query_normalize_utility
```c
PgQueryNormalizeResult pg_query_normalize_utility(const char* input);
```
**Description**: Normalizes utility statements (DDL, etc.).

**Parameters**:
- `input`: SQL string to normalize

**Returns**: Same as `pg_query_normalize`

#### pg_query_fingerprint
```c
PgQueryFingerprintResult pg_query_fingerprint(const char* input);
```
**Description**: Generates a fingerprint for a SQL query.

**Parameters**:
- `input`: SQL string to fingerprint

**Returns**: `PgQueryFingerprintResult` containing:
- `fingerprint`: 64-bit fingerprint hash
- `fingerprint_str`: String representation of fingerprint
- `stderr_buffer`: Any stderr output
- `error`: Error information if fingerprinting failed

#### pg_query_fingerprint_opts
```c
PgQueryFingerprintResult pg_query_fingerprint_opts(const char* input, int parser_options);
```
**Description**: Generates a fingerprint with custom parser options.

**Parameters**:
- `input`: SQL string to fingerprint
- `parser_options`: Bitwise OR of parser options and flags

**Returns**: Same as `pg_query_fingerprint`

### Statement Splitting Functions

#### pg_query_split_with_scanner
```c
PgQuerySplitResult pg_query_split_with_scanner(const char *input);
```
**Description**: Splits multi-statement SQL using the scanner. Use when statements may contain parse errors.

**Parameters**:
- `input`: SQL string containing multiple statements

**Returns**: `PgQuerySplitResult` containing:
- `stmts`: Array of statement locations and lengths
- `n_stmts`: Number of statements found
- `stderr_buffer`: Any stderr output
- `error`: Error information if splitting failed

#### pg_query_split_with_parser
```c
PgQuerySplitResult pg_query_split_with_parser(const char *input);
```
**Description**: Splits multi-statement SQL using the parser (recommended for better accuracy).

**Parameters**:
- `input`: SQL string containing multiple statements

**Returns**: Same as `pg_query_split_with_scanner`

## Memory Management

### Cleanup Functions
All result structures must be freed using their corresponding cleanup functions:

```c
void pg_query_free_normalize_result(PgQueryNormalizeResult result);
void pg_query_free_scan_result(PgQueryScanResult result);
void pg_query_free_parse_result(PgQueryParseResult result);
void pg_query_free_split_result(PgQuerySplitResult result);
void pg_query_free_deparse_result(PgQueryDeparseResult result);
void pg_query_free_protobuf_parse_result(PgQueryProtobufParseResult result);
void pg_query_free_plpgsql_parse_result(PgQueryPlpgsqlParseResult result);
void pg_query_free_fingerprint_result(PgQueryFingerprintResult result);
```

### Global Cleanup
```c
void pg_query_exit(void);
```
**Description**: Optional cleanup of top-level memory context. Automatically done for threads that exit.

## Error Handling

All functions return result structures that include an `error` field. Always check this field before using other result data:

```c
PgQueryParseResult result = pg_query_parse(sql);
if (result.error) {
    printf("Parse error: %s\n", result.error->message);
    printf("Location: %s:%d\n", result.error->filename, result.error->lineno);
    if (result.error->cursorpos > 0) {
        printf("Position: %d\n", result.error->cursorpos);
    }
} else {
    // Use result.parse_tree
}
pg_query_free_parse_result(result);
```

## Example Usage

### Basic Parsing
```c
#include "pg_query.h"

const char* sql = "SELECT * FROM users WHERE id = $1";
PgQueryParseResult result = pg_query_parse(sql);

if (result.error) {
    printf("Error: %s\n", result.error->message);
} else {
    printf("Parse tree: %s\n", result.parse_tree);
}

pg_query_free_parse_result(result);
```

### Parse and Deparse Cycle
```c
// Parse to protobuf
PgQueryProtobufParseResult parse_result = pg_query_parse_protobuf(sql);
if (!parse_result.error) {
    // Deparse back to SQL
    PgQueryDeparseResult deparse_result = pg_query_deparse_protobuf(parse_result.parse_tree);
    if (!deparse_result.error) {
        printf("Deparsed: %s\n", deparse_result.query);
    }
    pg_query_free_deparse_result(deparse_result);
}
pg_query_free_protobuf_parse_result(parse_result);
```

## Version Information

- PostgreSQL Version: 17.4 (PG_VERSION_NUM: 170004)
- Major Version: 17

## Notes

- The library is thread-safe
- Always free result structures to avoid memory leaks
- Use protobuf format for better performance when doing parse/deparse cycles
- Scanner-based splitting is more robust for malformed SQL
- Parser-based splitting is more accurate for well-formed SQL