/**
 * Extract the exported surface of a TypeScript module as a sorted name list.
 *
 * Regex-based on purpose: this repo has no TS parser dependency, and the two
 * files it compares are plain export declarations with no namespace or
 * conditional-export trickery. It reports what it could not classify rather
 * than silently dropping it.
 */

import { readFileSync } from "fs";

const PATTERNS = [
  // export function foo / export async function foo
  [/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, (m) => [m[1]]],
  [/^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, (m) => [m[1]]],
  [/^export\s+interface\s+([A-Za-z0-9_$]+)/, (m) => [m[1]]],
  [/^export\s+enum\s+([A-Za-z0-9_$]+)/, (m) => [m[1]]],
  [/^export\s+type\s+([A-Za-z0-9_$]+)\s*[=<]/, (m) => [m[1]]],
  [/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/, (m) => [m[1]]],
  // export * from "mod"  /  export * as ns from "mod"
  [/^export\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/, (m) => [`* as ${m[1]} from ${m[2]}`]],
  [/^export\s+\*\s+from\s+['"]([^'"]+)['"]/, (m) => [`* from ${m[1]}`]],
  // export { a, b as c } [from "mod"]  /  export type { A } from "mod"
  [
    /^export\s+(?:type\s+)?\{([^}]*)\}/,
    (m) =>
      m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        // `a as b` exports the name `b`.
        .map((s) => {
          const parts = s.split(/\s+as\s+/);
          return (parts[1] || parts[0]).trim();
        })
        .filter((s) => s !== "type"),
  ],
];

export function extractExports(source) {
  const names = new Set();
  const unclassified = [];

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("export")) continue;
    // `export default` and re-export-all-with-default are out of scope here.
    if (/^export\s+default\b/.test(line)) {
      names.add("default");
      continue;
    }

    let matched = false;
    for (const [re, extract] of PATTERNS) {
      const m = re.exec(line);
      if (m) {
        for (const n of extract(m)) names.add(n);
        matched = true;
        break;
      }
    }
    if (!matched) unclassified.push(line);
  }

  return { names: [...names].sort(), unclassified };
}

export function extractExportsFromFile(path) {
  return extractExports(readFileSync(path, "utf8"));
}

// CLI: node scripts/api-surface.mjs <file> [<file> ...]
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) {
    const { names, unclassified } = extractExportsFromFile(file);
    console.log(`\n${file} — ${names.length} exports`);
    for (const n of names) console.log(`  ${n}`);
    if (unclassified.length) {
      console.log(`  [unclassified: ${unclassified.length}]`);
      for (const u of unclassified) console.log(`    ? ${u}`);
    }
  }
}
