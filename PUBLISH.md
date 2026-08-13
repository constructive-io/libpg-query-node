# Publishing Guide

This repository publishes only the native N-API package and its platform-specific
prebuilds.

## Automated publishing (recommended)

**The committed version in `native/package.json` is the release trigger.** Merging a
version bump to `main` publishes it via `native-release.yml`.

To cut a release manually:

1. Bump `version` in `native/package.json`
2. Commit and merge to `main`

The dist-tag is derived from the version (`0.2.0` → `latest`, `0.2.0-beta.1` →
`beta`). Use `workflow_dispatch` on `native-release.yml` with `dry-run: true` to
rehearse.

## Published packages

| Package | Description |
|---------|-------------|
| `@ashbyhq/libpg-query-native` | Main package with TypeScript API |
| `@ashbyhq/libpg-query-native-darwin-arm64` | macOS Apple Silicon prebuild |
| `@ashbyhq/libpg-query-native-linux-x64` | Linux x64 glibc prebuild |
| `@ashbyhq/libpg-query-native-linux-arm64` | Linux arm64 glibc prebuild |
| `@ashbyhq/libpg-query-native-linux-x64-musl` | Linux x64 musl prebuild |
| `@ashbyhq/libpg-query-native-linux-arm64-musl` | Linux arm64 musl prebuild |

## Trusted publishing

Publishing uses npm trusted publishing (OIDC) — there is no npm token. Each package
needs a trusted publisher configured on npmjs.com:

| Field | Value |
|---|---|
| Organization | `ashbyhq` |
| Repository | `libpg-query-node` |
| Workflow filename | `native-release.yml` |
| Environment | *(none)* |

Requires npm ≥ 11.5.1.

## What triggers releases

| Workflow | Trigger | Cuts a release? |
|---|---|---|
| `libpg-query-sync.yml` | new `pganalyze/libpg_query` release, weekly poll | **Yes** |
| `upstream-tree-sync.yml` | `constructive-io/libpg-query-node` commits, monthly | No |

See [native/README.md](native/README.md) for the full release and upstream-sync
documentation.
