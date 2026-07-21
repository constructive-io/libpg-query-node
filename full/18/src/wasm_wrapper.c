#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

static int validate_input(const char* input) {
    return input != NULL && strlen(input) > 0;
}

static char* safe_strdup(const char* str) {
    if (!str) return NULL;
    char* result = strdup(str);
    if (!result) {
        return NULL;
    }
    return result;
}

static void* safe_malloc(size_t size) {
    void* ptr = malloc(size);
    if (!ptr && size > 0) {
        return NULL;
    }
    return ptr;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_parse_query(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryParseResult result = pg_query_parse(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_parse_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    char* parse_tree = safe_strdup(result.parse_tree);
    pg_query_free_parse_result(result);
    return parse_tree;
}

EMSCRIPTEN_KEEPALIVE
PgQueryParseResult* wasm_parse_query_raw(const char* input) {
    PgQueryParseResult* result = (PgQueryParseResult*)malloc(sizeof(PgQueryParseResult));
    if (!result) {
        return NULL;
    }
    
    *result = pg_query_parse(input);
    return result;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_parse_result(PgQueryParseResult* result) {
    if (result) {
        pg_query_free_parse_result(*result);
        free(result);
    }
}

EMSCRIPTEN_KEEPALIVE
char* wasm_parse_plpgsql(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryPlpgsqlParseResult result = pg_query_parse_plpgsql(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_plpgsql_parse_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    if (!result.plpgsql_funcs) {
        pg_query_free_plpgsql_parse_result(result);
        return safe_strdup("{\"plpgsql_funcs\":[]}");
    }
    
    size_t funcs_len = strlen(result.plpgsql_funcs);
    size_t json_len = strlen("{\"plpgsql_funcs\":}") + funcs_len + 1;
    char* wrapped_result = safe_malloc(json_len);
    
    if (!wrapped_result) {
        pg_query_free_plpgsql_parse_result(result);
        return safe_strdup("Memory allocation failed");
    }
    
    int written = snprintf(wrapped_result, json_len, "{\"plpgsql_funcs\":%s}", result.plpgsql_funcs);
    
    if (written >= json_len) {
        free(wrapped_result);
        pg_query_free_plpgsql_parse_result(result);
        return safe_strdup("Buffer overflow prevented");
    }
    
    pg_query_free_plpgsql_parse_result(result);
    return wrapped_result;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_fingerprint(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryFingerprintResult result = pg_query_fingerprint(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_fingerprint_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    char* fingerprint_str = safe_strdup(result.fingerprint_str);
    pg_query_free_fingerprint_result(result);
    return fingerprint_str;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_normalize_query(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryNormalizeResult result = pg_query_normalize(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_normalize_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    char* normalized = safe_strdup(result.normalized_query);
    pg_query_free_normalize_result(result);
    
    if (!normalized) {
        return safe_strdup("Memory allocation failed");
    }
    
    return normalized;
}





typedef struct {
    int has_error;
    char* message;
    char* funcname;
    char* filename;
    int lineno;
    int cursorpos;
    char* context;
    char* data;
    size_t data_len;
} WasmDetailedResult;

EMSCRIPTEN_KEEPALIVE
WasmDetailedResult* wasm_parse_query_detailed(const char* input) {
    WasmDetailedResult* result = safe_malloc(sizeof(WasmDetailedResult));
    if (!result) {
        return NULL;
    }
    memset(result, 0, sizeof(WasmDetailedResult));
    
    if (!validate_input(input)) {
        result->has_error = 1;
        result->message = safe_strdup("Invalid input: query cannot be null or empty");
        return result;
    }
    
    PgQueryParseResult parse_result = pg_query_parse(input);
    
    if (parse_result.error) {
        result->has_error = 1;
        size_t message_len = strlen("Parse error:  at line , position ") + strlen(parse_result.error->message) + 20;
        char* prefixed_message = safe_malloc(message_len);
        if (!prefixed_message) {
            result->has_error = 1;
            result->message = safe_strdup("Memory allocation failed");
            pg_query_free_parse_result(parse_result);
            return result;
        }
        snprintf(prefixed_message, message_len, 
                "Parse error: %s at line %d, position %d", 
                parse_result.error->message, 
                parse_result.error->lineno, 
                parse_result.error->cursorpos);
        result->message = prefixed_message;
        char* funcname_copy = parse_result.error->funcname ? safe_strdup(parse_result.error->funcname) : NULL;
        char* filename_copy = parse_result.error->filename ? safe_strdup(parse_result.error->filename) : NULL;
        char* context_copy = parse_result.error->context ? safe_strdup(parse_result.error->context) : NULL;
        
        result->funcname = funcname_copy;
        result->filename = filename_copy;
        result->lineno = parse_result.error->lineno;
        result->cursorpos = parse_result.error->cursorpos;
        result->context = context_copy;
    } else {
        result->data = safe_strdup(parse_result.parse_tree);
        if (result->data) {
            result->data_len = strlen(result->data);
        } else {
            result->has_error = 1;
            result->message = safe_strdup("Memory allocation failed");
        }
    }
    
    pg_query_free_parse_result(parse_result);
    return result;
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_detailed_result(WasmDetailedResult* result) {
    if (result) {
        free(result->message);
        free(result->funcname);
        free(result->filename);
        free(result->context);
        free(result->data);
        free(result);
    }
}

static const char* get_token_name(PgQuery__Token token_type) {
    // Map some common token types to readable names
    // Note: This is a simplified mapping - full enum lookup would require more complexity
    switch(token_type) {
        case 258: return "IDENT";
        case 261: return "SCONST"; 
        case 266: return "ICONST";
        case 260: return "FCONST";
        case 267: return "PARAM";
        case 40: return "ASCII_40"; // (
        case 41: return "ASCII_41"; // )
        case 42: return "ASCII_42"; // *
        case 44: return "ASCII_44"; // ,
        case 59: return "ASCII_59"; // ;
        case 61: return "ASCII_61"; // =
        case 268: return "TYPECAST";
        case 272: return "LESS_EQUALS";
        case 273: return "GREATER_EQUALS";
        case 274: return "NOT_EQUALS";
        case 275: return "SQL_COMMENT";
        case 276: return "C_COMMENT";
        default: return "UNKNOWN";
    }
}

static const char* get_keyword_name(PgQuery__KeywordKind keyword_kind) {
    switch(keyword_kind) {
        case 0: return "NO_KEYWORD";
        case 1: return "UNRESERVED_KEYWORD";
        case 2: return "COL_NAME_KEYWORD";
        case 3: return "TYPE_FUNC_NAME_KEYWORD";
        case 4: return "RESERVED_KEYWORD";
        default: return "UNKNOWN_KEYWORD";
    }
}

static char* build_scan_json(PgQuery__ScanResult *scan_result, const char* original_sql) {
    if (!scan_result || !original_sql) {
        return safe_strdup("{\"version\":0,\"tokens\":[]}");
    }
    
    // Calculate rough JSON size estimate
    size_t estimated_size = 1024 + (scan_result->n_tokens * 200);
    char* json = safe_malloc(estimated_size);
    if (!json) {
        return safe_strdup("{\"version\":0,\"tokens\":[]}");
    }
    
    // Start building JSON
    int pos = snprintf(json, estimated_size, "{\"version\":%d,\"tokens\":[", scan_result->version);
    
    for (size_t i = 0; i < scan_result->n_tokens; i++) {
        PgQuery__ScanToken *token = scan_result->tokens[i];
        
        // Extract token text from original SQL
        int token_length = token->end - token->start;
        if (token_length < 0) token_length = 0; // Safety check
        
        char* token_text = safe_malloc(token_length + 1);
        if (!token_text) continue;
        
        if (token_length > 0) {
            strncpy(token_text, &original_sql[token->start], token_length);
        }
        token_text[token_length] = '\0';
        
        // Escape token text for JSON
        char* escaped_text = safe_malloc(token_length * 2 + 1);
        if (!escaped_text) {
            free(token_text);
            continue;
        }
        
        int escaped_pos = 0;
        for (int j = 0; j < token_length; j++) {
            char c = token_text[j];
            if (c == '"' || c == '\\') {
                escaped_text[escaped_pos++] = '\\';
                escaped_text[escaped_pos++] = c;
            } else if (c == '\n') {
                escaped_text[escaped_pos++] = '\\';
                escaped_text[escaped_pos++] = 'n';
            } else if (c == '\r') {
                escaped_text[escaped_pos++] = '\\';
                escaped_text[escaped_pos++] = 'r';
            } else if (c == '\t') {
                escaped_text[escaped_pos++] = '\\';
                escaped_text[escaped_pos++] = 't';
            } else {
                escaped_text[escaped_pos++] = c;
            }
        }
        escaped_text[escaped_pos] = '\0';
        
        // Get token type name and keyword kind name
        const char* token_name = get_token_name(token->token);
        const char* keyword_name = get_keyword_name(token->keyword_kind);
        
        // Add comma if not first token
        if (i > 0) {
            pos += snprintf(json + pos, estimated_size - pos, ",");
        }
        
        // Add token object to JSON
        pos += snprintf(json + pos, estimated_size - pos,
            "{\"start\":%d,\"end\":%d,\"text\":\"%s\",\"tokenType\":%d,\"tokenName\":\"%s\",\"keywordKind\":%d,\"keywordName\":\"%s\"}",
            token->start, token->end, escaped_text, token->token, token_name, token->keyword_kind, keyword_name);
        
        free(token_text);
        free(escaped_text);
        
        // Check if we're running out of space
        if (pos >= estimated_size - 200) {
            char* new_json = realloc(json, estimated_size * 2);
            if (!new_json) break;
            json = new_json;
            estimated_size *= 2;
        }
    }
    
    // Close JSON
    snprintf(json + pos, estimated_size - pos, "]}");
    
    return json;
}

EMSCRIPTEN_KEEPALIVE
char* wasm_scan(const char* input) {
    if (!validate_input(input)) {
        return safe_strdup("Invalid input: query cannot be null or empty");
    }
    
    PgQueryScanResult result = pg_query_scan(input);
    
    if (result.error) {
        char* error_msg = safe_strdup(result.error->message);
        pg_query_free_scan_result(result);
        return error_msg ? error_msg : safe_strdup("Memory allocation failed");
    }
    
    // Unpack protobuf data
    PgQuery__ScanResult *scan_result = pg_query__scan_result__unpack(
        NULL, result.pbuf.len, (void *) result.pbuf.data);
    
    if (!scan_result) {
        pg_query_free_scan_result(result);
        return safe_strdup("Failed to unpack scan result");
    }
    
    // Convert to JSON
    char* json_result = build_scan_json(scan_result, input);
    
    // Clean up
    pg_query__scan_result__free_unpacked(scan_result, NULL);
    pg_query_free_scan_result(result);
    
    return json_result ? json_result : safe_strdup("{\"version\":0,\"tokens\":[]}");
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_string(char* str) {
    free(str);
}
