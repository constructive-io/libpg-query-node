/*
 * Native side of scripts/native-parity.js.
 *   driver split <file>   -> {"stmts":["...", ...]} or {"error":"..."}
 *   driver parse <file>   -> one JSON line per NUL-separated statement:
 *                            {"parse":<tree>} or {"error":{"message":"...","cursorpos":N}}
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "pg_query.h"

static void print_json_string(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *) s; p && *p; p++) {
    if (*p == '"' || *p == '\\') {
      putchar('\\');
      putchar(*p);
    } else if (*p < 0x20) {
      printf("\\u%04x", *p);
    } else {
      putchar(*p);
    }
  }
  putchar('"');
}

static char *read_file(const char *path, size_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) {
    perror(path);
    exit(2);
  }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *buf = malloc(n + 1);
  if (fread(buf, 1, n, f) != (size_t) n) {
    perror(path);
    exit(2);
  }
  buf[n] = 0;
  fclose(f);
  *len = n;
  return buf;
}

int main(int argc, char **argv) {
  size_t len;
  if (argc != 3) {
    fprintf(stderr, "usage: driver split|parse <file>\n");
    return 1;
  }
  char *buf = read_file(argv[2], &len);

  if (strcmp(argv[1], "split") == 0) {
    PgQuerySplitResult r = pg_query_split_with_scanner(buf);
    if (r.error) {
      printf("{\"error\":");
      print_json_string(r.error->message);
      printf("}\n");
    } else {
      printf("{\"stmts\":[");
      for (int i = 0; i < r.n_stmts; i++) {
        int n = r.stmts[i]->stmt_len;
        char *stmt = malloc(n + 1);
        memcpy(stmt, buf + r.stmts[i]->stmt_location, n);
        stmt[n] = 0;
        if (i) putchar(',');
        print_json_string(stmt);
        free(stmt);
      }
      printf("]}\n");
    }
    pg_query_free_split_result(r);
    return 0;
  }

  if (strcmp(argv[1], "parse") == 0) {
    for (char *p = buf; p < buf + len; p += strlen(p) + 1) {
      PgQueryParseResult r = pg_query_parse(p);
      if (r.error) {
        printf("{\"error\":{\"message\":");
        print_json_string(r.error->message);
        printf(",\"cursorpos\":%d}}\n", r.error->cursorpos);
      } else {
        printf("{\"parse\":%s}\n", r.parse_tree);
      }
      pg_query_free_parse_result(r);
    }
    return 0;
  }

  fprintf(stderr, "unknown mode %s\n", argv[1]);
  return 1;
}
