#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const VERSIONS = ['18', '17', '16', '15', '14', '13'];

function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (status.trim()) {
      console.error('❌ Error: You have uncommitted changes. Please commit or stash them before publishing.');
      console.error('Uncommitted files:');
      console.error(status);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error checking git status:', error.message);
    process.exit(1);
  }
}

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase().trim());
    });
  });
}

async function selectVersions() {
  console.log('Available versions:', VERSIONS.join(', '));
  const answer = await askQuestion('Which versions do you want to publish? (comma-separated, or "all" for all versions): ');
  
  if (answer === 'all') {
    return VERSIONS;
  }
  
  const selected = answer.split(',').map(v => v.trim()).filter(v => VERSIONS.includes(v));
  if (selected.length === 0) {
    console.error('❌ No valid versions selected.');
    process.exit(1);
  }
  
  return selected;
}

async function selectBumpType() {
  const answer = await askQuestion('Version bump type? (patch/minor): ');
  
  if (!['patch', 'minor'].includes(answer)) {
    console.error('❌ Invalid bump type. Only "patch" or "minor" are allowed.');
    process.exit(1);
  }
  
  return answer;
}

async function confirmPublish(versions, bumpType) {
  console.log('\n📋 Summary:');
  console.log(`  - Versions to publish: ${versions.join(', ')}`);
  console.log(`  - Bump type: ${bumpType}`);
  
  const answer = await askQuestion('\nProceed with publishing? (yes/no): ');
  return answer === 'yes' || answer === 'y';
}

function publishVersion(version, bumpType) {
  const packageDir = path.join(__dirname, '..', 'enums', version);
  
  console.log(`\n📦 Publishing @libpg-query/enums${version}...`);
  
  try {
    // Change to package directory
    process.chdir(packageDir);
    
    // Bump version
    console.log(`  - Bumping ${bumpType} version...`);
    execSync(`pnpm version ${bumpType}`, { stdio: 'inherit' });
    
    // Get the new version
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const newVersion = packageJson.version;
    
    // Commit the version bump
    console.log(`  - Committing version bump...`);
    execSync(`git add package.json`, { stdio: 'inherit' });
    execSync(`git commit -m "release: bump @libpg-query/enums${version} to ${newVersion}"`, { stdio: 'inherit' });
    
    // Build
    console.log(`  - Building...`);
    execSync('pnpm build', { stdio: 'inherit' });
    
    // Prepare for publishing
    console.log(`  - Preparing for publish...`);
    execSync('pnpm prepare:enums', { stdio: 'inherit' });
    
    // Publish
    console.log(`  - Publishing to npm with tag pg${version}...`);
    execSync(`pnpm publish --tag pg${version} --no-git-checks`, { stdio: 'inherit' });
    
    console.log(`✅ Successfully published @pgsql/enums@${newVersion} with tag pg${version}`);
    
  } catch (error) {
    console.error(`❌ Error publishing version ${version}:`, error.message);
    throw error;
  }
}

async function main() {
  console.log('🚀 Enums Package Publisher\n');
  
  // Check git status
  checkGitStatus();
  
  // Select versions
  const versions = await selectVersions();
  
  // Select bump type
  const bumpType = await selectBumpType();
  
  // Confirm
  const confirmed = await confirmPublish(versions, bumpType);
  if (!confirmed) {
    console.log('❌ Publishing cancelled.');
    rl.close();
    process.exit(0);
  }
  
  // Publish each version
  for (const version of versions) {
    try {
      publishVersion(version, bumpType);
    } catch (error) {
      console.error(`\n❌ Failed to publish version ${version}. Stopping.`);
      rl.close();
      process.exit(1);
    }
  }
  
  console.log('\n✅ All versions published successfully!');
  
  // Ask about promoting to latest
  if (versions.includes('17')) {
    const promoteAnswer = await askQuestion('\nDo you want to promote pg17 to latest? (yes/no): ');
    if (promoteAnswer === 'yes' || promoteAnswer === 'y') {
      try {
        console.log('Promoting pg17 to latest...');
        execSync('npm dist-tag add @pgsql/enums@pg17 latest', { stdio: 'inherit' });
        console.log('✅ Successfully promoted pg17 to latest');
      } catch (error) {
        console.error('❌ Error promoting to latest:', error.message);
      }
    }
  }
  
  rl.close();
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  rl.close();
  process.exit(1);
});