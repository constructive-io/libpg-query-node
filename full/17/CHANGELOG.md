# 17.2.1
* Add normalize() and normalizeSync() functions for SQL normalization
* Add fingerprint() and fingerprintSync() functions for query fingerprinting
* Add isReady() function to check WASM module initialization status
* Improve memory management and error handling in WASM wrapper
* Remove unused dependencies (lodash, deasync, @launchql/protobufjs)
* Split test suite into separate files for better organization
* Update documentation with comprehensive function examples

# 1.2.1
* Rename package

# 1.2.0
* Add TS typings

# 1.1.2 (07/23/19)
* Fix build script

# 1.1.0 (Republish, 07/23/19)
* Rewrite to use Node-Addons-API (C++ wrapper for the stable N-API)
* Support PL/PGSql Parsing
* Support async parsing

## 0.0.5 (November 19, 2015)
* Update libpg_query to include latest A_CONST fixes

## 0.0.4 (November 16, 2015)
* Update libpg_query to include fix for empty string constants
* Warning fixed in 0.0.3 is back for now until libpg_query has support for custom CFLAGS

## 0.0.3 (November 14, 2015)
* Update OSX static library to include `-mmacosx-version-min=10.5` to fix warnings on installation

## 0.0.2 (November 14, 2015)
* Rename repo to pg-query-native

## 0.0.1 (November 14, 2015)
* First version
