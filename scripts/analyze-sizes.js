const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper to format bytes to human readable
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper to get file size
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (e) {
    return 0;
  }
}

// Helper to get gzipped size
function getGzippedSize(filePath) {
  try {
    const result = execSync(`gzip -c "${filePath}" | wc -c`).toString().trim();
    return parseInt(result);
  } catch (e) {
    return 0;
  }
}

// Analyze a package
function analyzePackage(packagePath, packageName) {
  const wasmPath = path.join(packagePath, 'wasm');
  const files = {
    'WASM Binary': 'libpg-query.wasm',
    'WASM Loader': 'libpg-query.js',
    'ES Module': 'index.js',
    'CommonJS': 'index.cjs'
  };

  const results = {
    name: packageName,
    files: {}
  };

  let totalSize = 0;
  let totalGzipped = 0;

  for (const [label, filename] of Object.entries(files)) {
    const filePath = path.join(wasmPath, filename);
    const size = getFileSize(filePath);
    const gzipped = getGzippedSize(filePath);
    
    results.files[label] = {
      size,
      gzipped,
      exists: size > 0
    };

    totalSize += size;
    totalGzipped += gzipped;
  }

  results.totalSize = totalSize;
  results.totalGzipped = totalGzipped;

  return results;
}

// Get all version packages dynamically
function getVersionPackages() {
  const versionsDir = './versions';
  const packages = [];

  if (fs.existsSync(versionsDir)) {
    const versions = fs.readdirSync(versionsDir)
      .filter(dir => fs.statSync(path.join(versionsDir, dir)).isDirectory())
      .sort((a, b) => parseInt(b) - parseInt(a)); // Sort versions descending

    versions.forEach(version => {
      const packageJsonPath = path.join(versionsDir, version, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packages.push({
          path: path.join(versionsDir, version),
          name: packageJson.name || `v${version}`,
          version: version
        });
      }
    });
  }

  return packages;
}

// Main analysis
function analyze() {
  const packages = getVersionPackages();
  const results = packages.map(pkg => analyzePackage(pkg.path, pkg.name));

  // Generate markdown report
  let markdown = `# Build Size Analysis Report

Generated on: ${new Date().toISOString()}

## Summary

| Package | Total Size | Total Gzipped | Reduction |
|---------|------------|---------------|-----------|
`;

  const original = results.find(r => r.name.includes('Original'));
  
  results.forEach(result => {
    const reduction = original && result !== original 
      ? `${((1 - result.totalSize / original.totalSize) * 100).toFixed(1)}%`
      : 'Baseline';
    
    markdown += `| ${result.name} | ${formatBytes(result.totalSize)} | ${formatBytes(result.totalGzipped)} | ${reduction} |\n`;
  });

  markdown += `\n## Detailed Breakdown\n\n`;

  results.forEach(result => {
    markdown += `### ${result.name}\n\n`;
    markdown += `| File | Size | Gzipped | Gzip Ratio |\n`;
    markdown += `|------|------|---------|------------|\n`;
    
    for (const [label, data] of Object.entries(result.files)) {
      if (data.exists) {
        const ratio = ((1 - data.gzipped / data.size) * 100).toFixed(1);
        markdown += `| ${label} | ${formatBytes(data.size)} | ${formatBytes(data.gzipped)} | ${ratio}% |\n`;
      }
    }
    
    markdown += `\n`;
  });

  // Add comparison section
  if (results.length > 1) {
    markdown += `## Size Comparison\n\n`;
    markdown += `### WASM Binary Comparison\n\n`;
    markdown += `| Package | WASM Size | Difference |\n`;
    markdown += `|---------|-----------|------------|\n`;
    
    const originalWasm = original?.files['WASM Binary']?.size || 0;
    
    results.forEach(result => {
      const wasmSize = result.files['WASM Binary']?.size || 0;
      const diff = result === original 
        ? 'Baseline' 
        : `${((wasmSize - originalWasm) / 1024).toFixed(1)} KB (${((wasmSize / originalWasm - 1) * 100).toFixed(1)}%)`;
      
      markdown += `| ${result.name} | ${formatBytes(wasmSize)} | ${diff} |\n`;
    });
    
    markdown += `\n### JavaScript Bundle Comparison\n\n`;
    markdown += `| Package | ES Module | CommonJS | Combined |\n`;
    markdown += `|---------|-----------|----------|----------|\n`;
    
    results.forEach(result => {
      const esSize = result.files['ES Module']?.size || 0;
      const cjsSize = result.files['CommonJS']?.size || 0;
      const combined = esSize + cjsSize;
      
      markdown += `| ${result.name} | ${formatBytes(esSize)} | ${formatBytes(cjsSize)} | ${formatBytes(combined)} |\n`;
    });
  }

  markdown += `\n## Notes\n\n`;
  markdown += `- Gzipped sizes represent the approximate size when served with compression\n`;
  markdown += `- The WASM binary is the largest component and is shared across all API methods\n`;
  markdown += `- JavaScript wrapper size varies based on the number of exported functions\n`;
  markdown += `- @libpg-query/v17 only exports parse/parseSync, reducing JavaScript bundle size\n`;

  return markdown;
}

// Run analysis and save report
const report = analyze();
const reportPath = path.join(__dirname, '..', 'BUILD_SIZE_REPORT.md');
fs.writeFileSync(reportPath, report);
console.log(`Build size report generated: ${reportPath}`);

// Also output to console
console.log('\n' + report);