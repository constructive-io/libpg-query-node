# Publishing Guide

## Automated Publishing (Recommended)

### Version Packages (libpg-query)
```bash
pnpm run publish:versions
```

This interactive script will:
- Check for uncommitted changes (will error if any exist)
- Let you select which versions to publish (or all)
- Also includes the full package versions (@libpg-query/parser, full/17 and full/18)
- Ask for version bump type (patch or minor only)
- Ask if you want to skip the build step (useful if already built)
- Always run tests (even if build is skipped)
- Publish each selected version
- Optionally promote pg17 to latest

### Types Packages
```bash
pnpm run publish:types
```

This interactive script will:
- Check for uncommitted changes (will error if any exist)
- Let you select which versions to publish (or all)
- Ask for version bump type (patch or minor only)
- Build, prepare, and publish each selected version
- Optionally promote pg17 to latest

### Enums Packages
```bash
pnpm run publish:enums
```

This interactive script will:
- Check for uncommitted changes (will error if any exist)
- Let you select which versions to publish (or all)
- Ask for version bump type (patch or minor only)
- Build, prepare, and publish each selected version
- Optionally promote pg17 to latest

### Parser Package

The parser package supports multiple build configurations:

#### Full Build (all versions 13-18)
```bash
pnpm run publish:parser
# or with specific build type
PARSER_BUILD_TYPE=full pnpm run publish:parser
```

#### LTS Build (versions 15-18)
```bash
PARSER_BUILD_TYPE=lts pnpm run publish:parser
```

#### Latest Only (version 17)
```bash
PARSER_BUILD_TYPE=latest pnpm run publish:parser
```

#### Legacy Build (versions 13-15)
```bash
PARSER_BUILD_TYPE=legacy pnpm run publish:parser
```

This command will:
- Navigate to the parser directory
- Build the parser with the specified configuration
- Publish the @pgsql/parser package to npm with appropriate dist-tag
- Note: You should manually bump the version and commit changes before running this
- **Prerequisite**: The version packages must be built first as the parser copies their WASM files during build

## Manual Publishing

### Types Packages

```bash
# Set the version (e.g. 17, 16, 15, etc.)
VERSION=18

cd types/${VERSION}
pnpm version patch
git add . && git commit -m "release: bump @pgsql/types${VERSION} version"
pnpm build
pnpm prepare:types
pnpm publish --tag pg${VERSION}
```

Promote to latest (optional)

```bash
# Set the version (e.g. 17, 16, 15, etc.)
VERSION=18

# Promote pg${VERSION} tag to latest
npm dist-tag add @pgsql/types@pg${VERSION} latest
```

### What it does
- Transforms `@libpg-query/types17` → `@pgsql/types` with tag `pg17`
- Transforms `@libpg-query/types16` → `@pgsql/types` with tag `pg16`
- etc.

### Enums Packages

```bash
# Set the version (e.g. 17, 16, 15, etc.)
VERSION=18

cd enums/${VERSION}
pnpm version patch
git add . && git commit -m "release: bump @pgsql/enums${VERSION} version"
pnpm build
pnpm prepare:enums
pnpm publish --tag pg${VERSION}
```

Promote to latest (optional)

```bash
# Set the version (e.g. 17, 16, 15, etc.)
VERSION=18

# Promote pg${VERSION} tag to latest
npm dist-tag add @pgsql/enums@pg${VERSION} latest
```

### What it does
- Transforms `@libpg-query/enums17` → `@pgsql/enums` with tag `pg17`
- Transforms `@libpg-query/enums16` → `@pgsql/enums` with tag `pg16`
- etc.

## Version Packages

### Quick Publish
```bash
# Set the version (e.g. 17, 16, 15, etc.)
VERSION=18

# Build and publish a specific version
cd versions/${VERSION}
pnpm version patch
git add . && git commit -m "release: bump libpg-query${VERSION} version"
pnpm build
pnpm test
pnpm run publish:pkg
```

### What it does
- Transforms `@libpg-query/v17` → `libpg-query` with tag `pg17`
- Transforms `@libpg-query/v16` → `libpg-query` with tag `pg16`
- Uses `x-publish.publishName` and `x-publish.distTag` from package.json
- Temporarily modifies package.json during publish, then restores it

### Install published packages
```bash
npm install libpg-query@pg17   # PostgreSQL 17 specific
npm install libpg-query@pg16   # PostgreSQL 16 specific
npm install libpg-query        # Latest/default version
```

## Full Package (@libpg-query/parser)

The full package is versioned per PostgreSQL major version, mirroring `versions/`:
- `full/17` — built from `17-constructive`, published as `@libpg-query/parser` with tag `pg17`
- `full/18` — built from `18-constructive`, published as `@libpg-query/parser` with tag `pg18`

### Quick Publish (per version)
```bash
cd full/17   # or full/18
pnpm version patch
git add . && git commit -m "release: bump @libpg-query/parser version"
pnpm build
pnpm test
pnpm run publish:pkg
```

`publish:pkg` uses `x-publish.publishName` (`@libpg-query/parser`) and `x-publish.distTag`
(`pg17` / `pg18`) from each package.json, temporarily renaming the package during publish.

### Promote to latest (optional)
```bash
npm dist-tag add @libpg-query/parser@pg17 latest
```

### What it does
- Publishes `@libpg-query/parser` with tag `pg17` (from `full/17`) or `pg18` (from `full/18`)
- Includes full parser with all features (parse, parsePlPgSQL, scan, fingerprint, normalize + sync variants)

### Install published package
```bash
npm install @libpg-query/parser@pg18   # PostgreSQL 18 specific
npm install @libpg-query/parser@pg17   # PostgreSQL 17 specific
npm install @libpg-query/parser        # Latest version
```

## Parser Package (@pgsql/parser)

### Quick Publish
```bash
cd parser
pnpm version patch
git add . && git commit -m "release: bump @pgsql/parser version"
pnpm build
pnpm test
pnpm publish
```

### Build Configurations

The parser package is now a simple distribution package that copies pre-built WASM files. No TypeScript compilation needed!

#### Available Build Types:
- **full**: All versions (13, 14, 15, 16, 17) - Default
- **lts**: LTS versions only (16, 17)
- **latest**: Latest version only (17)
- **legacy**: Legacy versions (13, 14, 15)

```bash
# Full build (default)
npm run build

# Specific builds
npm run build:lts
npm run build:latest
npm run build:legacy

# Or using environment variable
PARSER_BUILD_TYPE=lts npm run build
```

### Build Process
The simplified parser package:
1. Copies WASM files from the `versions/*/wasm/` directories
2. Copies TypeScript type definitions from the `types/*/dist/` directories
3. Updates import paths to use local types instead of `@pgsql/types`
4. Generates index files from templates based on the build configuration
5. Creates version-specific export files
6. Creates a `build-info.json` file documenting what was included

The templates automatically adjust to include only the versions specified in the build configuration, ensuring proper TypeScript types and runtime validation. The package is completely self-contained with all necessary types bundled.

**Note**: Build scripts use `cross-env` for Windows compatibility.

**Important**: Before building the parser package, ensure that the version packages are built first:
```bash
# Build all version packages first
pnpm build  # builds libpg-query versions

# Then build the parser with desired configuration
cd parser
npm run build:lts  # or build:full, build:latest, etc.
```

### Types Bundling
The parser build process automatically:
1. Copies TypeScript type definitions from `types/*/dist/` directories
2. Places them in `wasm/v*/types/` for each version
3. Updates all import references from `@pgsql/types` to `./types`
4. Makes the package self-contained without external type dependencies

### Publishing with Different Tags

```bash
# Publish full version as latest
npm run build:full
npm publish

# Publish LTS version with lts tag
npm run build:lts
npm publish --tag lts

# Publish legacy version with legacy tag
npm run build:legacy
npm publish --tag legacy
```

### What it does
- Publishes `@pgsql/parser` - a multi-version PostgreSQL parser with dynamic version selection
- Provides a unified interface to work with multiple PostgreSQL versions
- Supports different build configurations for different use cases
- Includes both CommonJS and ESM builds
- Exports version-specific parsers via subpaths (e.g., `@pgsql/parser/v17`)
- **Self-contained**: Bundles TypeScript types locally (no external @pgsql/types dependency)

### Install published package
```bash
# Install latest (full build)
npm install @pgsql/parser

# Install LTS version
npm install @pgsql/parser@lts

# Install legacy version
npm install @pgsql/parser@legacy

# Use version-specific imports:
# import { parse } from '@pgsql/parser/v17'
# import { parse } from '@pgsql/parser/v16'
# import { parse } from '@pgsql/parser/v13'
```

### Alternative: Using npm scripts from root
```bash
# From the repository root:
pnpm build:parser    # Build the parser package (full build)
PARSER_BUILD_TYPE=lts pnpm build:parser  # Build LTS version
pnpm publish:parser  # Publish the parser package
```