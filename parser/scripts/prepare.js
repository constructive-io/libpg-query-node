// run "pnpm build:parser:full" in root 
const fs = require('fs');
const path = require('path');

// Build configurations for different tags
const BUILD_CONFIGS = {
  'full': {
    versions: ['13', '14', '15', '16', '17', '18'],
    description: 'Full build with all PostgreSQL versions (13-18)'
  },
  'lts': {
    versions: ['15', '16', '17', '18'],  
    description: 'LTS (Long Term Support)'
  }
};

// Get build type from environment or default to 'full'
const buildType = process.env.PARSER_BUILD_TYPE || 'full';
const config = BUILD_CONFIGS[buildType];

if (!config) {
  console.error(`Invalid build type: ${buildType}`);
  console.error('Available build types:', Object.keys(BUILD_CONFIGS).join(', '));
  process.exit(1);
}

console.log(`Building parser package: ${buildType}`);
console.log(`Description: ${config.description}`);
console.log(`Versions: ${config.versions.join(', ')}`);
console.log('');

// Ensure wasm directory exists
const wasmDir = path.join(__dirname, '../wasm');
if (!fs.existsSync(wasmDir)) {
  fs.mkdirSync(wasmDir, { recursive: true });
}

// Helper function to generate template variables
function generateTemplateVars(versions) {
  const defaultVersion = versions[versions.length - 1]; // Use highest version as default
  
  // For JavaScript array: [13, 14, 15, 16, 17]
  const versionsArray = versions.join(', ');
  
  // For TypeScript union: 13 | 14 | 15 | 16 | 17
  const versionUnion = versions.join(' | ');
  
  // For ESM exports: export * as v13 from './v13/index.js';
  const versionExports = versions.map(v => `export * as v${v} from './v${v}/index.js';`).join('\n');
  
  // For CommonJS requires: v13: require('./v13/index.cjs'),
  const versionRequires = versions.map(v => `  v${v}: require('./v${v}/index.cjs')`).join(',\n');
  
  // For TypeScript exports: export * as v13 from './v13/index';
  const versionTypeExports = versions.map(v => `export * as v${v} from './v${v}/index';`).join('\n');
  
  // For TypeScript type imports
  const versionTypeImports = versions.map(v => 
    `import type { ParseResult as ParseResult${v}, Node as Node${v} } from './v${v}/types';`
  ).join('\n');
  
  // For ParseResult version map
  const versionParseResultMap = versions.map(v => `  ${v}: ParseResult${v};`).join('\n');
  
  // For Node version map
  const versionNodeMap = versions.map(v => `  ${v}: Node${v};`).join('\n');
  
  return {
    DEFAULT_VERSION: defaultVersion,
    VERSIONS: versionsArray,
    VERSION_UNION: versionUnion,
    VERSION_EXPORTS: versionExports,
    VERSION_REQUIRES: versionRequires,
    VERSION_TYPE_EXPORTS: versionTypeExports,
    VERSION_TYPE_IMPORTS: versionTypeImports,
    VERSION_PARSE_RESULT_MAP: versionParseResultMap,
    VERSION_NODE_MAP: versionNodeMap
  };
}

// Process template file
function processTemplate(templatePath, outputPath, vars) {
  let content = fs.readFileSync(templatePath, 'utf8');
  
  // Replace all template variables
  Object.entries(vars).forEach(([key, value]) => {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    content = content.replace(regex, value);
  });
  
  fs.writeFileSync(outputPath, content);
  console.log(`Generated ${path.basename(outputPath)} from template`);
}

// Copy WASM files for each version in the config
config.versions.forEach(version => {
  const versionWasmDir = path.join(wasmDir, `v${version}`);
  const sourceWasmDir = path.join(__dirname, `../../versions/${version}/wasm`);
  
  // Create version directory
  if (!fs.existsSync(versionWasmDir)) {
    fs.mkdirSync(versionWasmDir, { recursive: true });
  }
  
  // Check if source WASM files exist
  if (!fs.existsSync(sourceWasmDir)) {
    console.error(`Warning: WASM files for version ${version} not found at ${sourceWasmDir}`);
    console.error(`Please build version ${version} first with: cd versions/${version} && pnpm build`);
    return;
  }
  
  // Copy all files from source wasm directory
  const files = fs.readdirSync(sourceWasmDir);
  files.forEach(file => {
    const sourcePath = path.join(sourceWasmDir, file);
    const destPath = path.join(versionWasmDir, file);
    
    if (fs.statSync(sourcePath).isFile()) {
      console.log(`Copying ${file} for v${version}...`);
      fs.copyFileSync(sourcePath, destPath);
      
      // Update any references to @pgsql/types to use local types
      if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.d.ts')) {
        let content = fs.readFileSync(destPath, 'utf8');
        content = content.replace(/@pgsql\/types/g, './types');
        fs.writeFileSync(destPath, content);
      }
    }
  });
  
  // Copy types files
  const typesSourceDir = path.join(__dirname, `../../types/${version}/dist`);
  const typesTargetDir = path.join(versionWasmDir, 'types');
  
  if (fs.existsSync(typesSourceDir)) {
    // Create types directory
    if (!fs.existsSync(typesTargetDir)) {
      fs.mkdirSync(typesTargetDir, { recursive: true });
    }
    
    // Copy essential type files
    const typeFiles = ['index.d.ts', 'index.js', 'types.d.ts', 'types.js', 'enums.d.ts', 'enums.js'];
    typeFiles.forEach(file => {
      const sourcePath = path.join(typesSourceDir, file);
      const destPath = path.join(typesTargetDir, file);
      
      if (fs.existsSync(sourcePath)) {
        console.log(`Copying types/${file} for v${version}...`);
        fs.copyFileSync(sourcePath, destPath);
      }
    });
  } else {
    console.warn(`Warning: Types for version ${version} not found at ${typesSourceDir}`);
  }
});

// Generate files from templates
const templateDir = path.join(__dirname, '../templates');
const templateVars = generateTemplateVars(config.versions);

// Process each template
const templates = [
  { template: 'index.js.template', output: 'index.js' },
  { template: 'index.cjs.template', output: 'index.cjs' },
  { template: 'index.d.ts.template', output: 'index.d.ts' }
];

templates.forEach(({ template, output }) => {
  const templatePath = path.join(templateDir, template);
  const outputPath = path.join(wasmDir, output);
  
  if (fs.existsSync(templatePath)) {
    processTemplate(templatePath, outputPath, templateVars);
  } else {
    console.error(`Template not found: ${templatePath}`);
  }
});

// Create version-specific export files
config.versions.forEach(version => {
  // ESM version
  const esmContent = `// Re-export everything from the v${version} parser
export * from './v${version}/index.js';
`;
  fs.writeFileSync(path.join(wasmDir, `v${version}.js`), esmContent);
  
  // CJS version
  const cjsContent = `// Re-export everything from the v${version} parser
module.exports = require('./v${version}/index.cjs');
`;
  fs.writeFileSync(path.join(wasmDir, `v${version}.cjs`), cjsContent);
  
  // TypeScript definitions
  const dtsContent = `// Re-export types from the v${version} parser
export * from './v${version}/index';
`;
  fs.writeFileSync(path.join(wasmDir, `v${version}.d.ts`), dtsContent);
});

// Create a build info file
const buildInfo = {
  buildType,
  versions: config.versions,
  description: config.description,
  buildTime: new Date().toISOString()
};

fs.writeFileSync(
  path.join(wasmDir, 'build-info.json'),
  JSON.stringify(buildInfo, null, 2)
);

console.log('\nPrepare completed successfully!');
console.log(`Build info saved to wasm/build-info.json`);