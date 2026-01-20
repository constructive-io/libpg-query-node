/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

#include <emscripten.h>
#include <pg_query.h>
#include <stdlib.h>
#include <string.h>

static int validate_input(const char* input) {
    return input != NULL && strlen(input) > 0;
}

static void* safe_malloc(size_t size) {
    void* ptr = malloc(size);
    if (!ptr && size > 0) {
        return NULL;
    }
    return ptr;
}

// Raw struct access functions for parse
EMSCRIPTEN_KEEPALIVE
PgQueryParseResult* wasm_parse_query_raw(const char* input) {
    if (!validate_input(input)) {
        return NULL;
    }
    
    PgQueryParseResult* result = (PgQueryParseResult*)safe_malloc(sizeof(PgQueryParseResult));
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