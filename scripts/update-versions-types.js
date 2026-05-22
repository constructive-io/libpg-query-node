#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔄 Updating @pgsql/types versions in versions/* packages...\n');

// Fetch dist-tags for @pgsql/types from npm
console.log('📡 Fetching latest @pgsql/types versions from npm dist-tags...');
let distTags;
try {
  const npmOutput = execSync('npm view @pgsql/types dist-tags --json', { encoding: 'utf8' });
  distTags = JSON.parse(npmOutput);
} catch (error) {
  console.error('❌ Failed to fetch npm data:', error.message);
  process.exit(1);
}

// Extract versions for PostgreSQL 13-17
const typeVersions = {};
for (let pgVersion = 13; pgVersion <= 18; pgVersion++) {
  const tag = `pg${pgVersion}`;
  if (distTags[tag]) {
    typeVersions[pgVersion.toString()] = distTags[tag];
  }
}

console.log('\n📦 Found latest versions from npm:');
Object.entries(typeVersions).sort(([a], [b]) => parseInt(a) - parseInt(b)).forEach(([major, version]) => {
  console.log(`   PostgreSQL ${major} → @pgsql/types@${version}`);
});
console.log();

// Get all version directories
const versionsDir = path.join(__dirname, '..', 'versions');
const versionDirs = fs.readdirSync(versionsDir)
  .filter(dir => /^\d+$/.test(dir))
  .sort((a, b) => parseInt(a) - parseInt(b));

let updatedCount = 0;

versionDirs.forEach(version => {
  const packageJsonPath = path.join(versionsDir, version, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`⚠️  No package.json found for version ${version}`);
    return;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const targetTypeVersion = typeVersions[version];
  
  if (!targetTypeVersion) {
    console.log(`⚠️  No type version mapping found for PostgreSQL ${version}`);
    return;
  }
  
  const currentTypeVersion = packageJson.dependencies?.['@pgsql/types'];
  const expectedTypeVersion = `^${targetTypeVersion}`;
  
  if (currentTypeVersion === expectedTypeVersion) {
    console.log(`✅ Version ${version}: @pgsql/types already up to date (${currentTypeVersion})`);
    return;
  }
  
  // Update the dependency
  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }
  
  packageJson.dependencies['@pgsql/types'] = expectedTypeVersion;
  
  // Write back the updated package.json
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf8'
  );
  
  console.log(`📦 Version ${version}: Updated @pgsql/types from ${currentTypeVersion || 'none'} to ${expectedTypeVersion}`);
  updatedCount++;
});

// Also update the full package (which uses PostgreSQL 17)
console.log('\n📦 Checking full package...');
const fullPackageJsonPath = path.join(__dirname, '..', 'full', 'package.json');

if (fs.existsSync(fullPackageJsonPath)) {
  const fullPackageJson = JSON.parse(fs.readFileSync(fullPackageJsonPath, 'utf8'));
  const targetTypeVersion = typeVersions['17']; // Full package uses PG 17
  
  if (targetTypeVersion) {
    const currentTypeVersion = fullPackageJson.dependencies?.['@pgsql/types'];
    const expectedTypeVersion = `^${targetTypeVersion}`;
    
    if (currentTypeVersion === expectedTypeVersion) {
      console.log(`✅ Full package: @pgsql/types already up to date (${currentTypeVersion})`);
    } else {
      // Update the dependency
      if (!fullPackageJson.dependencies) {
        fullPackageJson.dependencies = {};
      }
      
      fullPackageJson.dependencies['@pgsql/types'] = expectedTypeVersion;
      
      // Write back the updated package.json
      fs.writeFileSync(
        fullPackageJsonPath,
        JSON.stringify(fullPackageJson, null, 2) + '\n',
        'utf8'
      );
      
      console.log(`📦 Full package: Updated @pgsql/types from ${currentTypeVersion || 'none'} to ${expectedTypeVersion}`);
      updatedCount++;
    }
  }
}

console.log(`\n✨ Updated ${updatedCount} package(s)`);

if (updatedCount > 0) {
  console.log('\n💡 Next steps:');
  console.log('   1. Run "pnpm install" to update lockfile');
  console.log('   2. Test the changes');
  console.log('   3. Commit the updates');
}