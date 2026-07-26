/**
 * Check whether pganalyze/libpg_query has a newer release than the tag pinned
 * in native/Makefile, for the PG major we target.
 *
 * Prints a JSON summary, and appends key=value lines to $GITHUB_OUTPUT when run
 * under Actions. Exits 0 whether or not an update exists — "no update" is a
 * normal outcome, not a failure.
 *
 *   node scripts/check-libpg-query-release.mjs
 */

import { appendFileSync } from "fs";
import { currentPin, pickLatestForMajor } from "./upstream.mjs";

const RELEASES_URL =
  "https://api.github.com/repos/pganalyze/libpg_query/releases?per_page=100";

async function fetchTags() {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "ashbyhq-libpg-query-native-sync",
  };
  // Authenticate when we can — unauthenticated GitHub API is 60 req/hr per IP,
  // which shared runners can exhaust.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(RELEASES_URL, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const releases = await res.json();
  // Drafts are not real releases; prereleases are deliberately excluded too.
  return releases
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => r.tag_name);
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

let pin;
try {
  pin = currentPin();
} catch (err) {
  // Most likely cause: the pin was pointed at a moving branch such as
  // `18-constructive`. That is a deliberate choice, but it means this poller
  // cannot work — say so plainly instead of dumping a stack trace.
  console.error(`::error::${err.message}`);
  console.error(
    "Release polling requires LIBPG_QUERY_TAG to be an immutable pganalyze " +
      "release tag (e.g. 18.0.0 or 17-6.2.2)."
  );
  process.exit(1);
}

const tags = await fetchTags();
const latest = pickLatestForMajor(tags, pin.pgMajor);

if (!latest) {
  // Better to fail than to silently report "up to date" when the query is wrong.
  console.error(
    `No pganalyze release found for PG major ${pin.pgMajor}. ` +
      `Tags seen: ${tags.slice(0, 10).join(", ")}`
  );
  process.exit(1);
}

const changed = latest.tag !== pin.tag;

console.log(
  JSON.stringify({ current: pin.tag, latest: latest.tag, pgMajor: pin.pgMajor, changed }, null, 2)
);

setOutput("current", pin.tag);
setOutput("latest", latest.tag);
setOutput("pg-major", String(pin.pgMajor));
setOutput("changed", String(changed));

if (!changed) {
  console.log(`Up to date: pinned at ${pin.tag}, newest PG ${pin.pgMajor} release is ${latest.tag}.`);
} else {
  console.log(`Update available: ${pin.tag} -> ${latest.tag}`);
}
