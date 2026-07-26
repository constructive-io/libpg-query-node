/**
 * Record which upstream revisions this build tracks, into package.json's
 * `x-upstream` block. Derived from native/Makefile, which is the source of
 * truth. Run after changing LIBPG_QUERY_TAG:
 *   node scripts/sync-upstream-metadata.mjs [constructive-base-sha]
 */

import { syncUpstreamMetadata } from "./upstream.mjs";

const meta = syncUpstreamMetadata({ baseSha: process.argv[2] });
console.log("Synced x-upstream:", JSON.stringify(meta, null, 2));
