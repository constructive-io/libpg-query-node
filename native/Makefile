LIBPG_QUERY_REPO := https://github.com/pganalyze/libpg_query.git
LIBPG_QUERY_TAG := 18.0.0

OS := $(shell uname -s)
ARCH := $(shell uname -m)

ifeq ($(OS),Darwin)
PLATFORM := darwin
else ifeq ($(OS),Linux)
PLATFORM := linux
else
$(error Unsupported platform: $(OS))
endif

ifeq ($(ARCH),x86_64)
NODE_ARCH := x64
else ifeq ($(ARCH),aarch64)
NODE_ARCH := arm64
else ifeq ($(ARCH),arm64)
NODE_ARCH := arm64
else
NODE_ARCH := $(ARCH)
endif

# Detect musl libc (Alpine) by the presence of its dynamic loader.
# More reliable than parsing `ldd --version`, which varies across distros.
ifneq ($(wildcard /lib/ld-musl-*),)
PLATFORM_SUFFIX := -musl
else
PLATFORM_SUFFIX :=
endif

# PLATFORM_KEY can be overridden (e.g. `make build PLATFORM_KEY=linux-x64-musl`)
# so CI can pin the output dir to the known target instead of relying on detection.
PLATFORM_KEY ?= $(PLATFORM)-$(NODE_ARCH)$(PLATFORM_SUFFIX)
CACHE_DIR := .cache/$(PLATFORM_KEY)
LIBPG_QUERY_DIR := $(CACHE_DIR)/libpg_query

LIBPG_QUERY_LIB := $(LIBPG_QUERY_DIR)/libpg_query.a

NODE_ADDON_API_DIR := $(shell node -p "require('node-addon-api').include_dir" 2>/dev/null || echo "node_modules/node-addon-api")
NODE_INCLUDE := $(shell node -p "require('node-api-headers').include_dir" 2>/dev/null || echo "")

OUT_DIR := prebuilds/$(PLATFORM_KEY)
OUT_FILE := $(OUT_DIR)/libpg_query_native.node

CXXFLAGS := -O2 -std=c++17 -fPIC -DNAPI_VERSION=8 -DNODE_ADDON_API_DISABLE_DEPRECATED
LDFLAGS :=

ifeq ($(PLATFORM),darwin)
LDFLAGS += -undefined dynamic_lookup -dynamiclib
else
LDFLAGS += -shared
endif

INCLUDES := \
	-I$(LIBPG_QUERY_DIR) \
	-I$(LIBPG_QUERY_DIR)/vendor \
	-I$(NODE_ADDON_API_DIR) \
	$(if $(NODE_INCLUDE),-I$(NODE_INCLUDE),)

# Clone and build libpg_query
$(LIBPG_QUERY_DIR):
	mkdir -p $(CACHE_DIR)
	git clone -b $(LIBPG_QUERY_TAG) --single-branch --depth 1 $(LIBPG_QUERY_REPO) $(LIBPG_QUERY_DIR)

$(LIBPG_QUERY_LIB): $(LIBPG_QUERY_DIR)
	cd $(LIBPG_QUERY_DIR) && $(MAKE) build

# Build the .node addon
$(OUT_FILE): src/addon.cc $(LIBPG_QUERY_LIB)
	mkdir -p $(OUT_DIR)
	$(CXX) $(CXXFLAGS) $(INCLUDES) \
		src/addon.cc \
		$(LIBPG_QUERY_LIB) \
		$(LDFLAGS) \
		-lpthread \
		-o $(OUT_FILE)
	@echo "Built $(OUT_FILE) ($$(du -h $(OUT_FILE) | cut -f1))"

.PHONY: build clean clean-cache deps info

build: $(OUT_FILE)

deps: $(LIBPG_QUERY_LIB)

clean:
	rm -rf prebuilds

clean-cache:
	rm -rf .cache

info:
	@echo "Platform:     $(PLATFORM_KEY)"
	@echo "libpg_query:  $(LIBPG_QUERY_TAG)"
	@echo "Output:       $(OUT_FILE)"
	@echo "Node API dir: $(NODE_ADDON_API_DIR)"
	@echo ""
	@echo "For jemalloc memory benefits, use LD_PRELOAD:"
	@echo "  Linux:  LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so node app.js"
	@echo "  macOS:  DYLD_INSERT_LIBRARIES=/opt/homebrew/lib/libjemalloc.dylib node app.js"
