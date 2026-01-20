#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Read all version packages and extract x-publish metadata
function getVersionMappings() {
  const versionsDir = path.join(__dirname, '..', 'versions');
  const mappings = [];
  
  for (const version of ['13', '14', '15', '16', '17', '18']) {
    const packagePath = path.join(versionsDir, version, 'package.json');
    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      if (pkg['x-publish']) {
        mappings.push({
          pgVersion: pkg['x-publish'].pgVersion,
          packageVersion: pkg.version,
          distTag: pkg['x-publish'].distTag,
          libpgQueryTag: pkg['x-publish'].libpgQueryTag
        });
      }
    }
  }
  
  return mappings;
}

// Download file from URL
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    console.log('Downloading', url, 'to', dest);
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
      }
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Main function
async function fetchProtos() {
  const mappings = getVersionMappings();
  const protosDir = path.join(__dirname, '..', 'protos');
  
  // Create protos directory if it doesn't exist
  if (!fs.existsSync(protosDir)) {
    fs.mkdirSync(protosDir, { recursive: true });
  }
  
  console.log('Fetching protobuf files for all versions...\n');
  
  for (const mapping of mappings) {
    const { pgVersion, libpgQueryTag } = mapping;
    const versionDir = path.join(protosDir, pgVersion);
    
    // Create version directory
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }
    
    // Use the libpgQueryTag from the Makefile
    // For dev branches (containing 'dev'), use refs/heads/, otherwise use refs/tags/
    const refType = libpgQueryTag.includes('dev') ? 'heads' : 'tags';
    const url = `https://raw.githubusercontent.com/pganalyze/libpg_query/refs/${refType}/${libpgQueryTag}/protobuf/pg_query.proto`;
    const destPath = path.join(versionDir, 'pg_query.proto');
    
    console.log(`Fetching protobuf for PostgreSQL ${pgVersion} with tag ${libpgQueryTag}...`);
    
    try {
      await downloadFile(url, destPath);
      console.log(`✅ Successfully downloaded protobuf for PostgreSQL ${pgVersion}`);
      console.log(`   Source: ${url}`);
      console.log(`   Saved to: ${destPath}\n`);
    } catch (error) {
      console.log(`❌ Failed to fetch protobuf for PostgreSQL ${pgVersion}: ${error.message}\n`);
    }
  }
  
  console.log('Protobuf fetch completed!');
}

// Run the script
if (require.main === module) {
  fetchProtos().catch(console.error);
}

module.exports = { fetchProtos, getVersionMappings };
