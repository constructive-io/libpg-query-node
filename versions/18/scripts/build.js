const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Run TypeScript compilation
console.log('Compiling TypeScript...');
const tscPath = path.join(__dirname, '../../../node_modules/.bin/tsc');
execSync(`${tscPath}`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
execSync(`${tscPath} -p tsconfig.esm.json`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });

// Rename files to have correct extensions
const wasmDir = path.join(__dirname, '../wasm');
const cjsDir = path.join(__dirname, '../cjs');
const esmDir = path.join(__dirname, '../esm');

// Ensure wasm directory exists
if (!fs.existsSync(wasmDir)) {
  fs.mkdirSync(wasmDir, { recursive: true });
}

// Rename CommonJS files
fs.renameSync(
  path.join(cjsDir, 'index.js'),
  path.join(wasmDir, 'index.cjs')
);

// Rename ESM files
fs.renameSync(
  path.join(esmDir, 'index.js'),
  path.join(wasmDir, 'index.js')
);

// Rename declaration files
fs.renameSync(
  path.join(cjsDir, 'index.d.ts'),
  path.join(wasmDir, 'index.d.ts')
);

console.log('Build completed successfully!'); 