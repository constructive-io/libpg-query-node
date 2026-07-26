/**
 * Detect upstream API drift.
 *
 * native/src/index.ts is a hand-written reimplementation of the API that
 * constructive-io ships in versions/<pg>/src/index.ts. Upstream changes to that
 * file therefore do NOT ride along with a git merge — someone has to port them.
 * This compares upstream's current exported surface against the snapshot taken
 * at the last sync, and reports the parity gap against our own surface.
 *
 *   node scripts/check-api-drift.mjs            # check, exit 0/1
 *   node scripts/check-api-drift.mjs --update   # accept current state as the baseline
 */

import { existsSync, appendFileSync, writeFileSync, readFileSync } from "fs";
import { extractExportsFromFile } from "./api-surface.mjs";

const SNAPSHOT = ".upstream-api-snapshot.json";
const UPSTREAM_INDEX = "../versions/18/src/index.ts";
const NATIVE_INDEX = "src/index.ts";

const update = process.argv.includes("--update");

if (!existsSync(UPSTREAM_INDEX)) {
  // Upstream restructures directories (they deleted full/ outright); a missing
  // path is itself drift worth a human look, not a crash.
  console.error(`::error::Upstream index not found at ${UPSTREAM_INDEX} — upstream layout changed.`);
  process.exit(1);
}

const upstream = extractExportsFromFile(UPSTREAM_INDEX);
const native = extractExportsFromFile(NATIVE_INDEX);

if (upstream.unclassified.length) {
  console.log(`::warning::${upstream.unclassified.length} unparsed export line(s) upstream; drift detection may be incomplete.`);
}

if (update) {
  writeFileSync(
    SNAPSHOT,
    JSON.stringify({ source: UPSTREAM_INDEX, exports: upstream.names }, null, 2) + "\n"
  );
  console.log(`Snapshot updated: ${upstream.names.length} exports from ${UPSTREAM_INDEX}`);
  process.exit(0);
}

const prev = existsSync(SNAPSHOT)
  ? JSON.parse(readFileSync(SNAPSHOT, "utf8")).exports
  : null;

const added = prev ? upstream.names.filter((n) => !prev.includes(n)) : [];
const removed = prev ? prev.filter((n) => !upstream.names.includes(n)) : [];
const drifted = added.length > 0 || removed.length > 0;

// Informational: what upstream exports that we do not. Never a hard failure —
// the native API is deliberately a superset in places (scan, fingerprint,
// normalize, plpgsql) and a subset in others.
const missing = upstream.names.filter(
  (n) => !native.names.includes(n) && !n.startsWith("* ")
);

const lines = [];
if (!prev) {
  lines.push("No API snapshot recorded yet — run `node scripts/check-api-drift.mjs --update`.");
} else if (drifted) {
  lines.push("**Upstream's exported API changed since the last sync.**");
  lines.push("");
  lines.push("`native/src/index.ts` is a hand-written reimplementation, so these do *not*");
  lines.push("update via the merge. Port anything that matters before merging.");
  lines.push("");
  if (added.length) {
    lines.push("Added upstream:");
    for (const n of added) lines.push(`- \`${n}\``);
    lines.push("");
  }
  if (removed.length) {
    lines.push("Removed upstream:");
    for (const n of removed) lines.push(`- \`${n}\``);
    lines.push("");
  }
} else {
  lines.push("Upstream's exported API is unchanged since the last sync.");
}

if (missing.length) {
  lines.push("");
  lines.push(`<details><summary>Upstream exports not present in the native API (${missing.length})</summary>`);
  lines.push("");
  for (const n of missing) lines.push(`- \`${n}\``);
  lines.push("");
  lines.push("</details>");
}

const report = lines.join("\n");
console.log(report);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `drift=${drifted}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Upstream API drift\n\n${report}\n`);
}
writeFileSync("/tmp/api-drift.md", report + "\n");

process.exit(drifted ? 1 : 0);
