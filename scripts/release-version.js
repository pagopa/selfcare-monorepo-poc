#!/usr/bin/env node

/**
 * Custom release script that properly handles:
 * 1. Apply version plans (update pom.xml/package.json)
 * 2. Generate changelogs with correct versions
 * 3. Delete version plans
 * 4. No git commit (let GitHub Actions create PR)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const workspaceRoot = process.cwd();
const versionPlansDir = path.join(workspaceRoot, '.nx/version-plans');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const preid = args.includes('--preid') ? args[args.indexOf('--preid') + 1] : undefined;

console.log('🚀 Custom Release Script Starting...');
console.log(`📋 Mode: ${isDryRun ? 'DRY RUN' : 'REAL'}`);
if (preid) console.log(`🧪 Prerelease ID: ${preid}`);

// Step 1: Check if version plans exist
if (!fs.existsSync(versionPlansDir)) {
  console.log('❌ No version plans directory found');
  process.exit(1);
}

const planFiles = fs.readdirSync(versionPlansDir).filter(f => f.endsWith('.md'));
if (planFiles.length === 0) {
  console.log('❌ No version plans found');
  process.exit(1);
}

console.log(`\n📦 Found ${planFiles.length} version plan(s)`);

// Step 2: Parse version plans to know which projects will be updated
const projectsToRelease = new Map(); // project -> specifier

for (const file of planFiles) {
  const content = fs.readFileSync(path.join(versionPlansDir, file), 'utf-8');
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);

  if (match) {
    const yamlContent = match[1];
    const lines = yamlContent.split('\n');

    for (const line of lines) {
      const lineMatch = line.match(/['"]([^'"]+)['"]\s*:\s*(\w+)/);
      if (lineMatch) {
        const [, projectName, specifier] = lineMatch;
        projectsToRelease.set(projectName, specifier);
        console.log(`   - ${projectName}: ${specifier}`);
      }
    }
  }
}

if (projectsToRelease.size === 0) {
  console.log('❌ No projects found in version plans');
  process.exit(1);
}

// Step 3: Apply version changes (without commit)
console.log('\n📝 Step 1: Applying version changes...');

const versionCmd = preid
  ? `npx nx release version --preid ${preid} --git-commit=false --stage-changes=false`
  : `npx nx release version --git-commit=false --stage-changes=false`;

try {
  if (!isDryRun) {
    execSync(versionCmd, { stdio: 'inherit', cwd: workspaceRoot });
    console.log('✅ Version changes applied');
  } else {
    console.log(`   [DRY RUN] Would execute: ${versionCmd}`);
  }
} catch (error) {
  console.error('❌ Error applying version changes:', error.message);
  process.exit(1);
}

// Step 4: Read updated versions from disk
console.log('\n📖 Step 2: Reading updated versions...');

const updatedVersions = new Map(); // project -> new version

for (const [projectName] of projectsToRelease) {
  try {
    // Find project root
    let projectRoot = null;

    // Check apps/
    const appPath = path.join(workspaceRoot, 'apps', projectName.replace('@selfcare/', ''));
    if (fs.existsSync(appPath)) {
      projectRoot = appPath;
    }

    // Check infra/
    if (!projectRoot) {
      const infraMatch = projectName.match(/@selfcare\/infra-(\w+)-(.+)/);
      if (infraMatch) {
        const [, env, msName] = infraMatch;
        const infraPath = path.join(workspaceRoot, 'infra/resources', env, msName);
        if (fs.existsSync(infraPath)) {
          projectRoot = infraPath;
        }
      }
    }

    if (!projectRoot) {
      console.warn(`   ⚠️  Could not find project root for ${projectName}`);
      continue;
    }

    // Read version from pom.xml or package.json
    let version = null;
    const pomPath = path.join(projectRoot, 'pom.xml');
    const pkgPath = path.join(projectRoot, 'package.json');

    if (fs.existsSync(pomPath)) {
      const pomContent = fs.readFileSync(pomPath, 'utf-8');
      const versionMatch = pomContent.match(/<artifactId>[^<]+<\/artifactId>\s*<version>([^<]+)<\/version>/);
      if (versionMatch) {
        version = versionMatch[1];
      }
    } else if (fs.existsSync(pkgPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      version = pkgJson.version;
    }

    if (version) {
      updatedVersions.set(projectName, version);
      console.log(`   - ${projectName}: ${version}`);
    } else {
      console.warn(`   ⚠️  Could not read version for ${projectName}`);
    }
  } catch (error) {
    console.error(`   ❌ Error reading version for ${projectName}:`, error.message);
  }
}

// Step 5: Generate changelogs for each updated project
console.log('\n📝 Step 3: Generating changelogs...');

for (const [projectName, version] of updatedVersions) {
  try {
    const changelogCmd = `npx nx release changelog ${version} --projects="${projectName}" --git-commit=false`;

    if (!isDryRun) {
      console.log(`   Generating changelog for ${projectName} v${version}...`);
      execSync(changelogCmd, { stdio: 'pipe', cwd: workspaceRoot });
      console.log(`   ✅ ${projectName}`);
    } else {
      console.log(`   [DRY RUN] Would execute: ${changelogCmd}`);
    }
  } catch (error) {
    // Changelog command might fail if no commits found, that's ok
    console.warn(`   ⚠️  Changelog generation warning for ${projectName}: ${error.message}`);
  }
}

// Step 6: Delete version plans
console.log('\n🗑️  Step 4: Deleting version plans...');

if (!isDryRun) {
  for (const file of planFiles) {
    const planPath = path.join(versionPlansDir, file);
    fs.unlinkSync(planPath);
    console.log(`   ✅ Deleted ${file}`);
  }
} else {
  for (const file of planFiles) {
    console.log(`   [DRY RUN] Would delete ${file}`);
  }
}

// Step 7: Regenerate package-lock.json
console.log('\n🔄 Step 5: Regenerating package-lock.json...');

try {
  if (!isDryRun) {
    execSync('npm install --package-lock-only', { stdio: 'inherit', cwd: workspaceRoot });
    console.log('✅ package-lock.json updated');
  } else {
    console.log('   [DRY RUN] Would regenerate package-lock.json');
  }
} catch (error) {
  console.error('❌ Error regenerating package-lock.json:', error.message);
  process.exit(1);
}

// Done!
console.log('\n✅ Release script completed successfully!');
console.log('\nChanged files:');
console.log('   - Version files (pom.xml/package.json)');
console.log('   - CHANGELOG.md files');
console.log('   - package-lock.json');
console.log('   - Deleted version plans');

if (isDryRun) {
  console.log('\n⚠️  This was a DRY RUN - no changes were made');
}

process.exit(0);
