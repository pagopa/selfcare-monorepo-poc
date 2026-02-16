#!/usr/bin/env node

/**
 * Synchronize all pom.xml files with their corresponding package.json versions
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appsDir = path.join(__dirname, '..', 'apps');

console.log('🔄 Synchronizing all pom.xml files...\n');

let syncedCount = 0;
let skippedCount = 0;

// Find all apps directories
const apps = fs.readdirSync(appsDir).filter(item => {
  const itemPath = path.join(appsDir, item);
  return fs.statSync(itemPath).isDirectory();
});

for (const app of apps) {
  const packageJsonPath = path.join(appsDir, app, 'package.json');
  const pomPath = path.join(appsDir, app, 'pom.xml');

  if (fs.existsSync(packageJsonPath) && fs.existsSync(pomPath)) {
    try {
      execSync(`node ${path.join(__dirname, 'sync-pom-version.js')} ${packageJsonPath}`, {
        stdio: 'inherit'
      });
      syncedCount++;
    } catch (error) {
      console.error(`  ❌ Failed to sync ${app}`);
    }
  } else {
    if (!fs.existsSync(pomPath)) {
      console.log(`  ⊘ Skipped ${app} (no pom.xml)`);
      skippedCount++;
    }
  }
}

console.log(`\n✅ Synchronized ${syncedCount} project(s)`);
if (skippedCount > 0) {
  console.log(`ℹ️  Skipped ${skippedCount} project(s) without pom.xml`);
}
