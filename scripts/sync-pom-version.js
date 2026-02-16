#!/usr/bin/env node

/**
 * Custom version updater for projects with both package.json and pom.xml
 * This script is called by Nx Release to synchronize versions across both files
 */

const fs = require('fs');
const path = require('path');

function updatePomVersion(projectRoot, newVersion) {
  const pomPath = path.join(projectRoot, 'pom.xml');

  if (!fs.existsSync(pomPath)) {
    console.log(`  ⚠️  No pom.xml found in ${projectRoot}`);
    return;
  }

  let pomContent = fs.readFileSync(pomPath, 'utf-8');

  // Update version tag (first occurrence, which is the project version)
  const versionRegex = /(<version>)([\d\.\-a-zA-Z]+)(<\/version>)/;
  const match = pomContent.match(versionRegex);

  if (match) {
    const oldVersion = match[2];
    pomContent = pomContent.replace(versionRegex, `$1${newVersion}$3`);
    fs.writeFileSync(pomPath, pomContent);
    console.log(`  ✓ Updated pom.xml: ${oldVersion} → ${newVersion}`);
  } else {
    console.log(`  ⚠️  Could not find <version> tag in pom.xml`);
  }
}

// Get project root from package.json path
const packageJsonPath = process.argv[2];
if (!packageJsonPath) {
  console.error('Usage: node sync-pom-version.js <path-to-package.json>');
  process.exit(1);
}

const projectRoot = path.dirname(packageJsonPath);
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

console.log(`\n📦 Syncing pom.xml version for ${pkg.name}...`);
updatePomVersion(projectRoot, pkg.version);
