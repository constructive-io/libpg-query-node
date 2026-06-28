#!/bin/bash
# Run the memory benchmark with jemalloc preloaded.
#
# Prerequisites:
#   macOS:  brew install jemalloc
#   Linux:  apt install libjemalloc-dev  OR  yum install jemalloc-devel

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find jemalloc
if [[ "$(uname)" == "Darwin" ]]; then
  JEMALLOC_LIB="${JEMALLOC_LIB:-$(brew --prefix jemalloc 2>/dev/null)/lib/libjemalloc.dylib}"
  if [[ ! -f "$JEMALLOC_LIB" ]]; then
    echo "jemalloc not found. Install with: brew install jemalloc"
    echo "Or set JEMALLOC_LIB=/path/to/libjemalloc.dylib"
    exit 1
  fi
  echo "Using jemalloc: $JEMALLOC_LIB"
  echo ""

  echo "=== Without jemalloc ==="
  node --expose-gc "$SCRIPT_DIR/memory.mjs" "$@"
  echo ""
  echo "=== With jemalloc (DYLD_INSERT_LIBRARIES) ==="
  DYLD_INSERT_LIBRARIES="$JEMALLOC_LIB" node --expose-gc "$SCRIPT_DIR/memory.mjs" "$@"
else
  JEMALLOC_LIB="${JEMALLOC_LIB:-}"
  if [[ -z "$JEMALLOC_LIB" ]]; then
    for candidate in \
      /usr/lib/x86_64-linux-gnu/libjemalloc.so.2 \
      /usr/lib/aarch64-linux-gnu/libjemalloc.so.2 \
      /usr/lib64/libjemalloc.so.2 \
      /usr/lib/libjemalloc.so.2 \
      /usr/lib/x86_64-linux-gnu/libjemalloc.so \
      /usr/lib/libjemalloc.so; do
      if [[ -f "$candidate" ]]; then
        JEMALLOC_LIB="$candidate"
        break
      fi
    done
  fi
  if [[ -z "$JEMALLOC_LIB" || ! -f "$JEMALLOC_LIB" ]]; then
    echo "jemalloc not found. Install with: apt install libjemalloc-dev"
    echo "Or set JEMALLOC_LIB=/path/to/libjemalloc.so"
    exit 1
  fi
  echo "Using jemalloc: $JEMALLOC_LIB"
  echo ""

  echo "=== Without jemalloc ==="
  node --expose-gc "$SCRIPT_DIR/memory.mjs" "$@"
  echo ""
  echo "=== With jemalloc (LD_PRELOAD) ==="
  LD_PRELOAD="$JEMALLOC_LIB" node --expose-gc "$SCRIPT_DIR/memory.mjs" "$@"
fi
