// node:test reporter for index.js: one JSON line per finished test, keyed by
// its file and the names of the suites it is nested in.
const path = require('node:path');

module.exports = async function* reporter(source) {
  const stacks = new Map();
  for await (const event of source) {
    if (!['test:start', 'test:pass', 'test:fail'].includes(event.type)) continue;
    const { name, nesting, file, skip, todo } = event.data;
    const fileKey = file ? path.basename(file) : '';
    if (!stacks.has(fileKey)) stacks.set(fileKey, []);
    const stack = stacks.get(fileKey);
    if (event.type === 'test:start') {
      stack.length = nesting;
      stack[nesting] = name;
      continue;
    }
    const key = [fileKey, ...stack.slice(0, nesting), name].join(' > ');
    const status = skip || todo ? 'skip' : event.type === 'test:pass' ? 'pass' : 'fail';
    yield JSON.stringify({ key, status }) + '\n';
  }
};
