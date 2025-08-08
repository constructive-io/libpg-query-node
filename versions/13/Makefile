# DO NOT MODIFY MANUALLY — this is generated from the templates dir
# 
# To make changes, edit the files in the templates/ directory and run:
# npm run copy:templates

WASM_OUT_DIR := wasm
WASM_OUT_NAME := libpg-query
WASM_MODULE_NAME := PgQueryModule
LIBPG_QUERY_REPO := https://github.com/pganalyze/libpg_query.git
LIBPG_QUERY_TAG := 13-2.2.0

CACHE_DIR := .cache

OS ?= $(shell uname -s)
ARCH ?= $(shell uname -m)

ifdef EMSCRIPTEN
PLATFORM := emscripten
else ifeq ($(OS),Darwin)
PLATFORM := darwin
else ifeq ($(OS),Linux)
PLATFORM := linux
else
$(error Unsupported platform: $(OS))
endif

ifdef EMSCRIPTEN
ARCH := wasm
endif

PLATFORM_ARCH := $(PLATFORM)-$(ARCH)
SRC_FILES := src/wasm_wrapper.c
LIBPG_QUERY_DIR := $(CACHE_DIR)/$(PLATFORM_ARCH)/libpg_query/$(LIBPG_QUERY_TAG)
LIBPG_QUERY_ARCHIVE := $(LIBPG_QUERY_DIR)/libpg_query.a
LIBPG_QUERY_HEADER := $(LIBPG_QUERY_DIR)/pg_query.h
CXXFLAGS := -O3 -flto

ifdef EMSCRIPTEN
OUT_FILES := $(foreach EXT,.js .wasm,$(WASM_OUT_DIR)/$(WASM_OUT_NAME)$(EXT))
else
$(error Native builds are no longer supported. Use EMSCRIPTEN=1 for WASM builds only.)
endif

# Clone libpg_query source (lives in CACHE_DIR) 
$(LIBPG_QUERY_DIR):
	mkdir -p $(CACHE_DIR)
	git clone -b $(LIBPG_QUERY_TAG) --single-branch $(LIBPG_QUERY_REPO) $(LIBPG_QUERY_DIR)
ifdef EMSCRIPTEN
	cd $(LIBPG_QUERY_DIR); patch -p1 < $(shell pwd)/patches/emscripten_disable_spinlocks.patch
endif
	
$(LIBPG_QUERY_HEADER): $(LIBPG_QUERY_DIR)

# Build libpg_query
$(LIBPG_QUERY_ARCHIVE): $(LIBPG_QUERY_DIR)
	cd $(LIBPG_QUERY_DIR); $(MAKE) build

# Build libpg-query-node WASM module
$(OUT_FILES): $(LIBPG_QUERY_ARCHIVE) $(LIBPG_QUERY_HEADER) $(SRC_FILES)
ifdef EMSCRIPTEN
	mkdir -p $(WASM_OUT_DIR)
	$(CC) \
		-v \
		$(CXXFLAGS) \
		-I$(LIBPG_QUERY_DIR) \
		-I$(LIBPG_QUERY_DIR)/vendor \
		-L$(LIBPG_QUERY_DIR) \
		-sEXPORTED_FUNCTIONS="['_malloc','_free','_wasm_parse_query_raw','_wasm_free_parse_result']" \
		-sEXPORTED_RUNTIME_METHODS="['lengthBytesUTF8','stringToUTF8','getValue','UTF8ToString','HEAPU8','HEAPU32']" \
		-sEXPORT_NAME="$(WASM_MODULE_NAME)" \
		-sENVIRONMENT="web,node" \
		-sMODULARIZE=1 \
		-sEXPORT_ES6=0 \
		-sALLOW_MEMORY_GROWTH=1 \
		-sINITIAL_MEMORY=134217728 \
		-sMAXIMUM_MEMORY=1073741824 \
        -sSTACK_SIZE=33554432 \
		-lpg_query \
		-o $@ \
		$(SRC_FILES)
else
$(error Native builds are no longer supported. Use EMSCRIPTEN=1 for WASM builds only.)
endif

# Commands
build: $(OUT_FILES)

build-cache: $(LIBPG_QUERY_ARCHIVE) $(LIBPG_QUERY_HEADER)

rebuild: clean build

rebuild-cache: clean-cache build-cache

clean:
	-@ rm -r $(OUT_FILES) > /dev/null 2>&1

clean-cache:
	-@ rm -rf $(LIBPG_QUERY_DIR)

.PHONY: build build-cache rebuild rebuild-cache clean clean-cache
