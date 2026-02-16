#!/usr/bin/env node

/**
 * Preview what would change with nx release, including pom.xml files
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Preview Release Changes\n');
console.log('='.repeat(60));
console.log();

// Run nx release dry-run
console.log('📦 Running Nx Release preview...\n');
try {
  execSync('npx nx release --dry-run', { stdio: 'inherit' });
} catch (error) {
  // Dry-run might exit with non-zero on no changes
}

console.log();
console.log('='.repeat(60));
console.log('\n📝 Additional changes for Maven projects:\n');

// Check what would happen to pom.xml files
const appsDir = path.join(__dirname, '..', 'apps');
const apps = fs.readdirSync(appsDir).filter(item => {
  const itemPath = path.join(appsDir, item);
  return fs.statSync(itemPath).isDirectory();
});

let foundPomProjects = false;

for (const app of apps) {
  const packageJsonPath = path.join(appsDir, app, 'package.json');
  const pomPath = path.join(appsDir, app, 'pom.xml');

  if (fs.existsSync(packageJsonPath) && fs.existsSync(pomPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const pomContent = fs.readFileSync(pomPath, 'utf-8');

    // Extract current pom.xml version
    const versionMatch = pomContent.match(/<version>([\d\.\-a-zA-Z]+)<\/version>/);

    if (versionMatch) {
      const pomVersion = versionMatch[1];
      const pkgVersion = pkg.version;

      if (pomVersion !== pkgVersion) {
        foundPomProjects = true;
        console.log(`  ${app}/pom.xml`);
        console.log(`    Current: ${pomVersion}`);
        console.log(`    Will sync to: ${pkgVersion}`);
        console.log();
      }
    }
  }
}

if (!foundPomProjects) {
  console.log('  ℹ️  All pom.xml files are already in sync\n');
}

console.log('='.repeat(60));
console.log('\n💡 Tip: Run `npm run release` to apply these changes\n');
