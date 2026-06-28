#!/bin/bash
# Compare allocator behavior for the native libpg-query addon.
#
# Tests: system malloc, jemalloc, mimalloc, tcmalloc
# Measures: idle RSS, peak RSS, post-free RSS, throughput
#
# Usage:
#   bash benchmark/compare-allocators.sh              # large query (default)
#   bash benchmark/compare-allocators.sh --small      # small query sanity check
#   bash benchmark/compare-allocators.sh --throughput  # include throughput numbers

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCHMARK="$SCRIPT_DIR/memory.mjs"
ARGS=("$@")

# Detect allocator libraries
JEMALLOC_LIB=""
MIMALLOC_LIB=""
TCMALLOC_LIB=""

if [[ "$(uname)" == "Darwin" ]]; then
  JEMALLOC_LIB="$(brew --prefix jemalloc 2>/dev/null)/lib/libjemalloc.dylib"
  MIMALLOC_LIB="$(brew --prefix mimalloc 2>/dev/null)/lib/libmimalloc.dylib"
  TCMALLOC_LIB="$(brew --prefix gperftools 2>/dev/null)/lib/libtcmalloc.dylib"
  PRELOAD_VAR="DYLD_INSERT_LIBRARIES"
else
  for candidate in \
    /usr/lib/x86_64-linux-gnu/libjemalloc.so.2 \
    /usr/lib/aarch64-linux-gnu/libjemalloc.so.2 \
    /usr/lib64/libjemalloc.so.2 \
    /usr/lib/libjemalloc.so; do
    [[ -f "$candidate" ]] && JEMALLOC_LIB="$candidate" && break
  done
  for candidate in \
    /usr/lib/x86_64-linux-gnu/libmimalloc.so \
    /usr/lib/aarch64-linux-gnu/libmimalloc.so \
    /usr/lib64/libmimalloc.so \
    /usr/lib/libmimalloc.so; do
    [[ -f "$candidate" ]] && MIMALLOC_LIB="$candidate" && break
  done
  for candidate in \
    /usr/lib/x86_64-linux-gnu/libtcmalloc.so \
    /usr/lib/aarch64-linux-gnu/libtcmalloc.so \
    /usr/lib64/libtcmalloc.so \
    /usr/lib/libtcmalloc.so; do
    [[ -f "$candidate" ]] && TCMALLOC_LIB="$candidate" && break
  done
  PRELOAD_VAR="LD_PRELOAD"
fi

echo "============================================="
echo "  Allocator Comparison Benchmark"
echo "  $(uname -s) $(uname -m), Node $(node -v)"
echo "============================================="
echo ""
echo "Allocators found:"
echo "  system malloc: yes (always available)"
[[ -f "$JEMALLOC_LIB" ]] && echo "  jemalloc:      $JEMALLOC_LIB" || echo "  jemalloc:      not found"
[[ -f "$MIMALLOC_LIB" ]] && echo "  mimalloc:      $MIMALLOC_LIB" || echo "  mimalloc:      not found"
[[ -f "$TCMALLOC_LIB" ]] && echo "  tcmalloc:      $TCMALLOC_LIB" || echo "  tcmalloc:      not found"
echo ""

run_benchmark() {
  local name="$1"
  local preload="$2"

  echo ">>> $name"
  if [[ -n "$preload" ]]; then
    env "$PRELOAD_VAR=$preload" node --expose-gc "$BENCHMARK" "${ARGS[@]}" 2>&1
  else
    node --expose-gc "$BENCHMARK" "${ARGS[@]}" 2>&1
  fi
  echo ""
}

run_benchmark "System malloc (default)" ""

[[ -f "$JEMALLOC_LIB" ]] && run_benchmark "jemalloc" "$JEMALLOC_LIB"
[[ -f "$MIMALLOC_LIB" ]] && run_benchmark "mimalloc" "$MIMALLOC_LIB"
[[ -f "$TCMALLOC_LIB" ]] && run_benchmark "tcmalloc" "$TCMALLOC_LIB"

# jemalloc with aggressive decay
if [[ -f "$JEMALLOC_LIB" ]]; then
  echo ">>> jemalloc (aggressive decay: dirty=0, muzzy=0)"
  env "$PRELOAD_VAR=$JEMALLOC_LIB" MALLOC_CONF="dirty_decay_ms:0,muzzy_decay_ms:0" \
    node --expose-gc "$BENCHMARK" "${ARGS[@]}" 2>&1
  echo ""
fi

echo "============================================="
echo "  Done. Compare Peak RSS and Retained columns."
echo "============================================="
