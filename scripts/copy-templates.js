#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const HEADER = `/**
 * DO NOT MODIFY MANUALLY — this is generated from the templates dir
 * 
 * To make changes, edit the files in the templates/ directory and run:
 * npm run copy:templates
 */

`;

const MAKEFILE_HEADER = `# DO NOT MODIFY MANUALLY — this is generated from the templates dir
# 
# To make changes, edit the files in the templates/ directory and run:
# npm run copy:templates

`;

// Load version configurations from package.json files
function loadVersionConfigs() {
  const configs = {};
  const packageFiles = glob.sync('versions/*/package.json');
  
  console.log(`Found ${packageFiles.length} package.json files\n`);
  
  packageFiles.forEach(packageFile => {
    try {
      const packageData = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      const version = packageData['x-publish']?.pgVersion;
      const libpgQueryTag = packageData['x-publish']?.libpgQueryTag;
      const fullApi = packageData['x-publish']?.fullApi === true;
      
      if (version && libpgQueryTag) {
        configs[version] = {
          tag: libpgQueryTag,
          hasEmscriptenPatch: version === '13', // Only version 13 needs the patch
          fullApi
        };
        console.log(`  Version ${version}: tag ${libpgQueryTag}${fullApi ? ' (full API)' : ''}`);
      } else {
        console.warn(`  Warning: Missing x-publish data in ${packageFile}`);
      }
    } catch (error) {
      console.error(`  Error reading ${packageFile}: ${error.message}`);
    }
  });
  
  console.log(''); // Empty line for readability
  return configs;
}

// Load configurations
const VERSION_CONFIGS = loadVersionConfigs();

// Files to copy from templates. Full-API versions use the variants in
// templates/full/ for the source files.
const TEMPLATE_FILES = [
  { src: 'LICENSE', dest: 'LICENSE', header: false, hasFullVariant: false },
  { src: 'wasm_wrapper.c', dest: 'src/wasm_wrapper.c', header: HEADER, hasFullVariant: true },
  { src: 'libpg-query.d.ts', dest: 'src/libpg-query.d.ts', header: HEADER, hasFullVariant: true },
  { src: 'index.ts', dest: 'src/index.ts', header: HEADER, hasFullVariant: true }
];

const SLIM_EXPORTED_FUNCTIONS = "['_malloc','_free','_wasm_parse_query_raw','_wasm_free_parse_result']";
const FULL_EXPORTED_FUNCTIONS = "['_malloc','_free','_wasm_parse_query','_wasm_parse_plpgsql','_wasm_fingerprint','_wasm_normalize_query','_wasm_scan','_wasm_parse_query_detailed','_wasm_free_detailed_result','_wasm_free_string','_wasm_parse_query_raw','_wasm_free_parse_result']";

function copyTemplates() {
  const templatesDir = path.join(__dirname, '..', 'templates');
  const versionsDir = path.join(__dirname, '..', 'versions');
  
  // Process each version
  for (const [version, config] of Object.entries(VERSION_CONFIGS)) {
    const versionDir = path.join(versionsDir, version);
    console.log(`\nProcessing version ${version}...`);
    
    // Copy template files
    for (const file of TEMPLATE_FILES) {
      const srcPath = (config.fullApi && file.hasFullVariant)
        ? path.join(templatesDir, 'full', file.src)
        : path.join(templatesDir, file.src);
      const destPath = path.join(versionDir, file.dest);
      
      // Ensure destination directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Read template content
      let content = fs.readFileSync(srcPath, 'utf8');
      
      // Add header if specified
      if (file.header) {
        content = file.header + content;
      }
      
      // Write to destination
      fs.writeFileSync(destPath, content);
      console.log(`  ✓ Copied ${file.src} to ${file.dest}`);
    }
    
    // Process Makefile template
    const makefileTemplate = fs.readFileSync(path.join(templatesDir, 'Makefile.template'), 'utf8');
    let makefileContent = makefileTemplate.replace(/{{VERSION_TAG}}/g, config.tag);
    makefileContent = makefileContent.replace(
      /{{EXPORTED_FUNCTIONS}}/g,
      config.fullApi ? FULL_EXPORTED_FUNCTIONS : SLIM_EXPORTED_FUNCTIONS
    );
    
    // Handle the USE_EMSCRIPTEN_PATCH placeholder
    if (config.hasEmscriptenPatch) {
      // For version 13, keep the patch block (remove only the placeholders)
      makefileContent = makefileContent.replace(
        /{{#USE_EMSCRIPTEN_PATCH}}\n?/g,
        ''
      );
      makefileContent = makefileContent.replace(
        /{{\/USE_EMSCRIPTEN_PATCH}}\n?/g,
        ''
      );
    } else {
      // For other versions, remove the entire block including placeholders
      makefileContent = makefileContent.replace(
        /{{#USE_EMSCRIPTEN_PATCH}}[\s\S]*?{{\/USE_EMSCRIPTEN_PATCH}}\n?/g,
        ''
      );
    }
    
    // Write Makefile with header
    fs.writeFileSync(path.join(versionDir, 'Makefile'), MAKEFILE_HEADER + makefileContent);
    console.log(`  ✓ Generated Makefile with tag ${config.tag}`);
  }
  
  console.log('\n✅ Template copying completed!');
}

// Run the script
copyTemplates();