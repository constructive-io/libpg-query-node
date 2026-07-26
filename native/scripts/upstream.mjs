/**
 * Shared helpers for upstream tracking.
 *
 * native/Makefile is the single source of truth for which libpg_query revision
 * we build against; everything else is derived from it.
 */

import { readFileSync, writeFileSync } from "fs";

const MAKEFILE = "Makefile";
const PACKAGE_JSON = "package.json";

/** Read a `NAME := value` assignment from the Makefile. */
export function readMakefileVar(name, makefile = MAKEFILE) {
  const src = readFileSync(makefile, "utf8");
  // Only match uncommented assignments — the Makefile may carry commented-out
  // alternatives, and picking one of those up would silently build the wrong
  // parser.
  const re = new RegExp(`^${name}\\s*:?=\\s*(.+?)\\s*$`, "m");
  const match = src.match(re);
  if (!match) throw new Error(`${name} not found in ${makefile}`);
  return match[1];
}

/** Rewrite a `NAME := value` assignment in place. */
export function writeMakefileVar(name, value, makefile = MAKEFILE) {
  const src = readFileSync(makefile, "utf8");
  const re = new RegExp(`^(${name}\\s*:?=\\s*).+?(\\s*)$`, "m");
  if (!re.test(src)) throw new Error(`${name} not found in ${makefile}`);
  writeFileSync(makefile, src.replace(re, `$1${value}$2`));
}

/**
 * Parse a pganalyze/libpg_query tag into a comparable form.
 *
 * Two schemes are in play:
 *   PG 13-17:  "17-6.2.2"  -> pgMajor 17, rest 6.2.2
 *   PG 18+:    "18.0.0"    -> pgMajor 18, rest 0.0.0
 *
 * Returns null for anything unrecognised (release candidates, branch names,
 * the `*-constructive` branches upstream uses, etc).
 */
export function parseLibpgQueryTag(tag) {
  let m = /^(\d+)-(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (m) {
    return { tag, pgMajor: Number(m[1]), parts: [Number(m[2]), Number(m[3]), Number(m[4])] };
  }
  m = /^(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (m) {
    return { tag, pgMajor: Number(m[1]), parts: [Number(m[2]), Number(m[3]), Number(m[4])] };
  }
  return null;
}

/** Compare two parsed tags. Assumes the same pgMajor. */
export function compareTags(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  return 0;
}

/**
 * Pick the newest tag for a given PG major from a list of tag names.
 *
 * Deliberately does NOT use the GitHub "latest release" endpoint: pganalyze
 * mixes the two tag schemes above in one repo, so "latest" there can be a
 * PG 17 release even when a PG 18 one exists.
 */
export function pickLatestForMajor(tags, pgMajor) {
  const candidates = tags
    .map(parseLibpgQueryTag)
    .filter((t) => t && t.pgMajor === pgMajor);
  if (candidates.length === 0) return null;
  return candidates.sort(compareTags)[candidates.length - 1];
}

/** The PG major we target, derived from the pinned tag. */
export function currentPin(makefile = MAKEFILE) {
  const tag = readMakefileVar("LIBPG_QUERY_TAG", makefile);
  const repo = readMakefileVar("LIBPG_QUERY_REPO", makefile);
  const parsed = parseLibpgQueryTag(tag);
  if (!parsed) {
    throw new Error(
      `Pinned LIBPG_QUERY_TAG '${tag}' is not a recognised release tag. ` +
        `Refusing to guess a PG major from it.`
    );
  }
  return { tag, repo, pgMajor: parsed.pgMajor };
}

/**
 * Write the x-upstream provenance block into package.json.
 *
 * Mirrors sync-optional-deps.mjs: derive from the source of truth, write, done.
 */
export function syncUpstreamMetadata({ makefile = MAKEFILE, pkgPath = PACKAGE_JSON, baseSha } = {}) {
  const { tag, repo, pgMajor } = currentPin(makefile);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const meta = {
    libpgQueryRepo: repo,
    libpgQueryTag: tag,
    pgMajor: String(pgMajor),
  };
  // Preserve a previously recorded base SHA when the caller does not supply one.
  const existing = pkg["x-upstream"] || {};
  const sha = baseSha || existing.constructiveBaseSha;
  if (sha) meta.constructiveBaseSha = sha;

  pkg["x-upstream"] = meta;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return meta;
}
