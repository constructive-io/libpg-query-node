#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "pg_query.h"

static void print_json_string(const char *s, size_t len) {
  putchar('"');
  for (size_t i = 0; i < len; i++) {
    unsigned char c = s[i];
    if (c == '"' || c == '\\') {
      putchar('\\');
      putchar(c);
    } else if (c < 0x20) {
      printf("\\u%04x", c);
    } else {
      putchar(c);
    }
  }
  putchar('"');
}

static char *read_file(const char *path, size_t *len) {
  FILE *file = fopen(path, "rb");
  if (!file || fseek(file, 0, SEEK_END) != 0) return NULL;
  long size = ftell(file);
  if (size < 0 || fseek(file, 0, SEEK_SET) != 0) return NULL;
  char *buf = malloc((size_t)size + 1);
  if (!buf || fread(buf, 1, (size_t)size, file) != (size_t)size) return NULL;
  fclose(file);
  *len = (size_t)size;
  buf[*len] = '\0';
  return buf;
}

static void split(const char *buf) {
  PgQuerySplitResult result = pg_query_split_with_scanner(buf);
  if (result.error) {
    puts("{\"error\":true}");
  } else {
    printf("{\"stmts\":[");
    for (int i = 0; i < result.n_stmts; i++) {
      if (i) putchar(',');
      print_json_string(buf + result.stmts[i]->stmt_location, result.stmts[i]->stmt_len);
    }
    puts("]}");
  }
  pg_query_free_split_result(result);
}

static void parse(const char *buf, size_t len) {
  for (const char *p = buf; p < buf + len; p += strlen(p) + 1) {
    PgQueryParseResult result = pg_query_parse(p);
    if (result.error) {
      printf("{\"error\":{\"message\":");
      print_json_string(result.error->message, strlen(result.error->message));
      printf(",\"cursorpos\":%d}}\n", result.error->cursorpos);
    } else {
      printf("{\"parse\":%s}\n", result.parse_tree);
    }
    pg_query_free_parse_result(result);
  }
}

int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[1], "split") && strcmp(argv[1], "parse"))) {
    fprintf(stderr, "usage: %s split|parse <file>\n", argv[0]);
    return 1;
  }
  size_t len;
  char *buf = read_file(argv[2], &len);
  if (!buf) {
    perror(argv[2]);
    return 1;
  }
  if (strcmp(argv[1], "split") == 0) {
    split(buf);
  } else {
    parse(buf, len);
  }
  free(buf);
  return 0;
}
