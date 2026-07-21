#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log('🚀 Version Packages Publishing Tool\n');

  // Check for uncommitted changes
  try {
    execSync('git diff --quiet && git diff --cached --quiet');
  } catch (error) {
    console.error('❌ You have uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  // Get all version directories
  const versionsDir = path.join(__dirname, '..', 'versions');
  const versionDirs = fs.readdirSync(versionsDir)
    .filter(dir => /^\d+$/.test(dir))
    .sort((a, b) => parseInt(b) - parseInt(a)); // Sort descending

  // Also check for full package versions (full/17, full/18, ...)
  const fullDir = path.join(__dirname, '..', 'full');
  const fullVersionDirs = fs.existsSync(fullDir)
    ? fs.readdirSync(fullDir)
        .filter(dir => /^\d+$/.test(dir) && fs.existsSync(path.join(fullDir, dir, 'package.json')))
        .sort((a, b) => parseInt(b) - parseInt(a)) // Sort descending
    : [];

  console.log('📦 Available packages:');
  versionDirs.forEach(v => console.log(`   - PostgreSQL ${v} (versions/${v})`));
  fullVersionDirs.forEach(v => console.log(`   - Full package PostgreSQL ${v} (full/${v})`));
  console.log();

  // Ask which versions to publish
  const publishAll = await question('Publish all packages? (y/N): ');
  let selectedVersions = [];
  let selectedFullVersions = [];

  if (publishAll.toLowerCase() === 'y') {
    selectedVersions = versionDirs;
    selectedFullVersions = fullVersionDirs;
  } else {
    // Let user select versions
    for (const version of versionDirs) {
      const publish = await question(`Publish PostgreSQL ${version}? (y/N): `);
      if (publish.toLowerCase() === 'y') {
        selectedVersions.push(version);
      }
    }
    
    for (const version of fullVersionDirs) {
      const publishFull = await question(`Publish full package PostgreSQL ${version} (full/${version})? (y/N): `);
      if (publishFull.toLowerCase() === 'y') {
        selectedFullVersions.push(version);
      }
    }
  }

  if (selectedVersions.length === 0 && selectedFullVersions.length === 0) {
    console.log('\n❌ No packages selected for publishing.');
    rl.close();
    return;
  }

  // Ask for version bump type
  console.log('\n📈 Version bump type:');
  console.log('   1. patch (0.0.x)');
  console.log('   2. minor (0.x.0)');
  const bumpType = await question('Select bump type (1 or 2): ');
  const bump = bumpType === '2' ? 'minor' : 'patch';

  console.log(`\n📋 Will publish:`);
  selectedVersions.forEach(v => console.log(`   - PostgreSQL ${v} (${bump} bump)`));
  selectedFullVersions.forEach(v => console.log(`   - Full package PostgreSQL ${v} (${bump} bump)`));

  // Ask about building
  const skipBuild = await question('\nSkip build step? (y/N): ');
  const shouldBuild = skipBuild.toLowerCase() !== 'y';

  if (!shouldBuild) {
    console.log('⚠️  Build step will be skipped. Make sure packages are already built!');
  }

  const confirm = await question('\nProceed? (y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('❌ Publishing cancelled.');
    rl.close();
    return;
  }

  console.log('\n🔨 Starting publish process...\n');

  // Process each selected version
  for (const version of selectedVersions) {
    console.log(`\n📦 Publishing PostgreSQL ${version}...`);
    const versionPath = path.join(versionsDir, version);
    
    try {
      // Version bump
      console.log(`   📝 Bumping version (${bump})...`);
      execSync(`pnpm version ${bump}`, { cwd: versionPath, stdio: 'inherit' });
      
      // Commit
      console.log(`   💾 Committing version bump...`);
      execSync(`git add package.json`, { cwd: versionPath });
      execSync(`git commit -m "release: bump libpg-query v${version} version"`, { stdio: 'inherit' });
      
      // Build (if not skipped)
      if (shouldBuild) {
        console.log(`   🔨 Building...`);
        execSync('pnpm build', { cwd: versionPath, stdio: 'inherit' });
      } else {
        console.log(`   ⏭️  Skipping build step`);
      }
      
      // Test (always run)
      console.log(`   🧪 Running tests...`);
      execSync('pnpm test', { cwd: versionPath, stdio: 'inherit' });
      
      // Publish
      console.log(`   📤 Publishing to npm...`);
      execSync('pnpm run publish:pkg', { cwd: versionPath, stdio: 'inherit' });
      
      console.log(`   ✅ PostgreSQL ${version} published successfully!`);
    } catch (error) {
      console.error(`   ❌ Failed to publish PostgreSQL ${version}:`, error.message);
      const continuePublish = await question('Continue with other versions? (y/N): ');
      if (continuePublish.toLowerCase() !== 'y') {
        rl.close();
        process.exit(1);
      }
    }
  }

  // Process full package versions if selected
  for (const version of selectedFullVersions) {
    console.log(`\n📦 Publishing full package PostgreSQL ${version}...`);
    const fullPath = path.join(fullDir, version);
    
    try {
      // Version bump
      console.log(`   📝 Bumping version (${bump})...`);
      execSync(`pnpm version ${bump}`, { cwd: fullPath, stdio: 'inherit' });
      
      // Commit
      console.log(`   💾 Committing version bump...`);
      execSync(`git add package.json`, { cwd: fullPath });
      execSync(`git commit -m "release: bump @libpg-query/parser v${version} version"`, { stdio: 'inherit' });
      
      // Build (if not skipped)
      if (shouldBuild) {
        console.log(`   🔨 Building...`);
        execSync('pnpm build', { cwd: fullPath, stdio: 'inherit' });
      } else {
        console.log(`   ⏭️  Skipping build step`);
      }
      
      // Test (always run)
      console.log(`   🧪 Running tests...`);
      execSync('pnpm test', { cwd: fullPath, stdio: 'inherit' });
      
      // Publish with the pg<version> tag (uses x-publish metadata)
      console.log(`   📤 Publishing to npm with pg${version} tag...`);
      execSync('pnpm run publish:pkg', { cwd: fullPath, stdio: 'inherit' });
      
      console.log(`   ✅ Full package published successfully with pg${version} tag!`);
    } catch (error) {
      console.error(`   ❌ Failed to publish full package PostgreSQL ${version}:`, error.message);
      const continuePublish = await question('Continue with other versions? (y/N): ');
      if (continuePublish.toLowerCase() !== 'y') {
        rl.close();
        process.exit(1);
      }
    }
  }

  // Ask about promoting to latest
  if (selectedVersions.includes('17') || selectedFullVersions.includes('17')) {
    console.log('\n🏷️  Tag Management');
    
    if (selectedVersions.includes('17')) {
      const promoteVersions = await question('Promote libpg-query@pg17 to latest? (y/N): ');
      if (promoteVersions.toLowerCase() === 'y') {
        try {
          execSync('npm dist-tag add libpg-query@pg17 latest', { stdio: 'inherit' });
          console.log('✅ libpg-query@pg17 promoted to latest');
        } catch (error) {
          console.error('❌ Failed to promote tag:', error.message);
        }
      }
    }
    
    if (selectedFullVersions.includes('17')) {
      const promoteFullPackage = await question('Promote @libpg-query/parser@pg17 to latest? (y/N): ');
      if (promoteFullPackage.toLowerCase() === 'y') {
        try {
          execSync('npm dist-tag add @libpg-query/parser@pg17 latest', { stdio: 'inherit' });
          console.log('✅ @libpg-query/parser@pg17 promoted to latest');
        } catch (error) {
          console.error('❌ Failed to promote tag:', error.message);
        }
      }
    }
  }

  console.log('\n✨ Publishing complete!');
  rl.close();
}

main().catch(error => {
  console.error('❌ Error:', error);
  rl.close();
  process.exit(1);
});