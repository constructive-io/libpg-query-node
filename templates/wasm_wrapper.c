#include <emscripten.h>
#include <emscripten/stack.h>
#include <pg_query.h>
#include <stdlib.h>
#include <string.h>

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
    set_stack_guard();
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