// versions/<major>/release-diff.allow.json: the differences a release intends.
//
//   { "reference": "18.1.5",                // compared too, besides the last release
//     "allow": [{
//       "id": "kitchen-sink:*:fingerprint",  // input:function, `*` matches anything; or a list
//       "reason": "why the release changes this",
//       "baseline": "18.1.5",                // optional: only against this release
//       "published": "ok", "candidate": "ok" // optional: `ok`, `pass` or the error message
//       "ignoreKeys": ["arg_location"]       // optional: outputs equal without these keys
//   }] }
//
// An entry only allows what it names: without `published` / `candidate` any
// change to the matched outputs passes, so give them whenever the change is a
// new or lost error, and prefer `ignoreKeys` to allowing a whole output.
const fs = require('node:fs');

function globToRegExp(glob) {
  return new RegExp('^' + glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's');
}

function loadAllowlist(file, baselineVersion) {
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')).allow || [])
    .filter((entry) => !entry.baseline || entry.baseline === baselineVersion)
    .map((entry) => {
      if (!entry.id || !entry.reason) throw new Error(`${file}: every entry needs an id and a reason`);
      const optional = (glob) => (glob === undefined ? null : globToRegExp(glob));
      return { ...entry, idPatterns: [].concat(entry.id).map(globToRegExp), publishedPattern: optional(entry.published), candidatePattern: optional(entry.candidate), used: 0 };
    });
}

const summary = (outcome) => ('ok' in outcome ? 'ok' : outcome.error);

function allows(entry, diff) {
  return entry.idPatterns.some((pattern) => pattern.test(diff.id))
    && (!entry.publishedPattern || entry.publishedPattern.test(summary(diff.baseline)))
    && (!entry.candidatePattern || entry.candidatePattern.test(summary(diff.candidate)));
}

function withoutKeys(json, keys) {
  return JSON.stringify(JSON.parse(json), (key, value) => (keys.has(key) ? undefined : value));
}

module.exports = { loadAllowlist, allows, withoutKeys };
