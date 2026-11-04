#include "pg_query.h"
#include "protobuf/pg_query.pb-c.h"
#include <emscripten.h>
#include <emscripten/stack.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>

/* libpg_query's check_stack_depth() needs a reference point and a limit per
 * entry: the shadow stack left after the previous call, minus a 512 KiB
 * margin for the frames between here and the recursion. */
extern void pg_query_set_stack_limit(size_t bytes) __attribute__((weak));
static void set_stack_guard(void) {
    if (!pg_query_set_stack_limit) return; /* libpg_query without the guard (upstream pins) */
    size_t free_bytes = emscripten_stack_get_free();
    pg_query_set_stack_limit(free_bytes > 524288 ? free_bytes - 524288 : 0);
}

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
    set_stack_guard();
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
    set_stack_guard();
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
    set_stack_guard();
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
    set_stack_guard();
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

static WasmDetailedResult* detailed_result_new(void) {
    WasmDetailedResult* result = safe_malloc(sizeof(WasmDetailedResult));
    if (result) {
        memset(result, 0, sizeof(WasmDetailedResult));
    }
    return result;
}

static WasmDetailedResult* detailed_set_error(WasmDetailedResult* result, PgQueryError* error) {
    result->has_error = 1;
    result->message = safe_strdup(error->message);
    result->funcname = error->funcname ? safe_strdup(error->funcname) : NULL;
    result->filename = error->filename ? safe_strdup(error->filename) : NULL;
    result->context = error->context ? safe_strdup(error->context) : NULL;
    result->lineno = error->lineno;
    result->cursorpos = error->cursorpos;
    return result;
}

static WasmDetailedResult* detailed_set_message(WasmDetailedResult* result, const char* message) {
    result->has_error = 1;
    result->message = safe_strdup(message);
    return result;
}

// Out of memory returns NULL, which the JS side reports as out of WASM memory.
static WasmDetailedResult* detailed_set_data(WasmDetailedResult* result, char* data) {
    if (!data) {
        wasm_free_detailed_result(result);
        return NULL;
    }
    result->data = data;
    result->data_len = strlen(data);
    return result;
}

EMSCRIPTEN_KEEPALIVE
WasmDetailedResult* wasm_fingerprint(const char* input) {
    set_stack_guard();
    WasmDetailedResult* result = detailed_result_new();
    if (!result) {
        return NULL;
    }
    if (!validate_input(input)) {
        return detailed_set_message(result, "Invalid input: query cannot be null or empty");
    }

    PgQueryFingerprintResult fingerprint_result = pg_query_fingerprint(input);
    if (fingerprint_result.error) {
        detailed_set_error(result, fingerprint_result.error);
    } else {
        result = detailed_set_data(result, safe_strdup(fingerprint_result.fingerprint_str));
    }
    pg_query_free_fingerprint_result(fingerprint_result);
    return result;
}

EMSCRIPTEN_KEEPALIVE
WasmDetailedResult* wasm_normalize_query(const char* input) {
    set_stack_guard();
    WasmDetailedResult* result = detailed_result_new();
    if (!result) {
        return NULL;
    }
    if (!validate_input(input)) {
        return detailed_set_message(result, "Invalid input: query cannot be null or empty");
    }

    PgQueryNormalizeResult normalize_result = pg_query_normalize(input);
    if (normalize_result.error) {
        detailed_set_error(result, normalize_result.error);
    } else {
        result = detailed_set_data(result, safe_strdup(normalize_result.normalized_query));
    }
    pg_query_free_normalize_result(normalize_result);
    return result;
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

// Returns NULL when out of memory: a partial token list must never pass as a result.
static char* build_scan_json(PgQuery__ScanResult *scan_result, const char* original_sql) {
    if (!scan_result || !original_sql) {
        return NULL;
    }
    
    // Size the buffer from token text length, not token count: each token
    // contributes at most ~170 bytes of fixed JSON plus up to 6 bytes per input
    // byte once escaped (\\u00XX for control characters).
    size_t estimated_size = 1024;
    for (size_t i = 0; i < scan_result->n_tokens; i++) {
        PgQuery__ScanToken *token = scan_result->tokens[i];
        int token_length = token->end - token->start;
        if (token_length < 0) token_length = 0;
        if ((size_t) token_length > (SIZE_MAX - 200 - estimated_size) / 6) {
            return NULL;
        }
        estimated_size += (size_t) token_length * 6 + 200;
    }
    char* json = safe_malloc(estimated_size);
    if (!json) {
        return NULL;
    }
    
    // Start building JSON
    size_t pos = snprintf(json, estimated_size, "{\"version\":%d,\"tokens\":[", scan_result->version);
    
    for (size_t i = 0; i < scan_result->n_tokens; i++) {
        PgQuery__ScanToken *token = scan_result->tokens[i];
        
        // Extract token text from original SQL
        int token_length = token->end - token->start;
        if (token_length < 0) token_length = 0; // Safety check
        
        char* token_text = safe_malloc((size_t) token_length + 1);
        if (!token_text) {
            free(json);
            return NULL;
        }
        
        if (token_length > 0) {
            strncpy(token_text, &original_sql[token->start], token_length);
        }
        token_text[token_length] = '\0';
        
        // Escape token text for JSON
        char* escaped_text = safe_malloc((size_t) token_length * 6 + 1);
        if (!escaped_text) {
            free(token_text);
            free(json);
            return NULL;
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
            } else if ((unsigned char) c < 0x20) {
                escaped_pos += snprintf(escaped_text + escaped_pos, 7, "\\u%04x", (unsigned char) c);
            } else {
                escaped_text[escaped_pos++] = c;
            }
        }
        escaped_text[escaped_pos] = '\0';
        
        // Get token type name and keyword kind name
        const char* token_name = get_token_name(token->token);
        const char* keyword_name = get_keyword_name(token->keyword_kind);
        
        // Add comma if not first token
        if (i > 0 && pos < estimated_size) {
            int n = snprintf(json + pos, estimated_size - pos, ",");
            pos += (n > 0) ? (size_t) n : 0;
        }
        
        // Add token object to JSON
        if (pos < estimated_size) {
            int n = snprintf(json + pos, estimated_size - pos,
                "{\"start\":%d,\"end\":%d,\"text\":\"%s\",\"tokenType\":%d,\"tokenName\":\"%s\",\"keywordKind\":%d,\"keywordName\":\"%s\"}",
                token->start, token->end, escaped_text, token->token, token_name, token->keyword_kind, keyword_name);
            pos += (n > 0) ? (size_t) n : 0;
        }
        
        free(token_text);
        free(escaped_text);
        
        // snprintf returns the would-be length; never let pos run past the buffer
        if (pos >= estimated_size) pos = estimated_size - 1;
    }
    
    // Close JSON
    snprintf(json + pos, estimated_size - pos, "]}");
    
    return json;
}

EMSCRIPTEN_KEEPALIVE
WasmDetailedResult* wasm_scan(const char* input) {
    set_stack_guard();
    WasmDetailedResult* result = detailed_result_new();
    if (!result) {
        return NULL;
    }
    if (!validate_input(input)) {
        return detailed_set_message(result, "Invalid input: query cannot be null or empty");
    }

    PgQueryScanResult scan_result = pg_query_scan(input);
    if (scan_result.error) {
        detailed_set_error(result, scan_result.error);
        pg_query_free_scan_result(scan_result);
        return result;
    }

    PgQuery__ScanResult *unpacked = pg_query__scan_result__unpack(
        NULL, scan_result.pbuf.len, (void *) scan_result.pbuf.data);
    if (!unpacked) {
        pg_query_free_scan_result(scan_result);
        wasm_free_detailed_result(result);
        return NULL;
    }

    char* json = build_scan_json(unpacked, input);
    pg_query__scan_result__free_unpacked(unpacked, NULL);
    pg_query_free_scan_result(scan_result);
    return detailed_set_data(result, json);
}

EMSCRIPTEN_KEEPALIVE
void wasm_free_string(char* str) {
    free(str);
}
