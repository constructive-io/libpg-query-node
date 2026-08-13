# Repository Notes

This fork builds only the native N-API addon in `native/`. Upstream's WASM packages
(`versions/`, `parser/`, `full/`, etc.) have been removed.

## Upstream sync

`upstream-tree-sync.yml` merges from `constructive-io/libpg-query-node` for tree
hygiene. WASM directories reintroduced by upstream merges are stripped automatically.
API drift is checked against upstream's `versions/18/src/index.ts` via a remote fetch.

## C library pin

The libpg_query revision is pinned in `native/Makefile` (`LIBPG_QUERY_REPO`,
`LIBPG_QUERY_TAG`). Releases track immutable pganalyze release tags, not upstream's
moving `*-constructive` branches.
