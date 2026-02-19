const { getVersion, setVersion } = require('../../version-resolver');
const semver = require('semver');
const path = require('path');
const fs = require('fs');

/**
 * Parse version plans from .nx/version-plans/*.md files
 * Returns a map of projectName -> specifier
 */
function parseVersionPlans(workspaceRoot) {
  const versionPlansDir = path.join(workspaceRoot, '.nx/version-plans');
  const specifierMap = {};

  if (!fs.existsSync(versionPlansDir)) {
    return specifierMap;
  }

  const planFiles = fs.readdirSync(versionPlansDir).filter(f => f.endsWith('.md'));

  for (const file of planFiles) {
    const content = fs.readFileSync(path.join(versionPlansDir, file), 'utf-8');

    // Extract YAML front matter between ---
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) continue;

    const yamlContent = match[1];

    // Simple YAML parser for lines like "'@scope/project': patch"
    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const lineMatch = line.match(/['"]([^'"]+)['"]\s*:\s*(\w+)/);
      if (lineMatch) {
        const [, projectName, specifier] = lineMatch;
        specifierMap[projectName] = specifier;
      }
    }
  }

  return specifierMap;
}

/**
 * Maven version generator for Nx Release
 *
 * This generator handles versioning for projects with pom.xml or package.json files
 */
async function versionGenerator(tree, options) {
  const { specifier, preid, currentVersionResolver, projects, specifierSource } = options;

  console.log('[Maven Generator] OPTIONS RECEIVED:', JSON.stringify({ specifier, preid, specifierSource, projectCount: projects?.length }, null, 2));
  console.log('[Maven Generator] Processing release for', projects ? projects.length : 0, 'project(s)');

  // Nx passes a 'projects' array when invoked during release
  // Each project has: name, type, data (with root, sourceRoot, etc.)
  if (!projects || projects.length === 0) {
    throw new Error('No projects provided to version generator');
  }

  const workspaceRoot = process.cwd();

  // Parse version plans if using version-plans source
  let specifierMap = {};
  if (specifierSource === 'version-plans') {
    console.log('[Maven Generator] Reading version plans from .nx/version-plans/');
    specifierMap = parseVersionPlans(workspaceRoot);
    console.log('[Maven Generator] Version plan specifiers:', JSON.stringify(specifierMap, null, 2));
  }

  const results = {};

  for (const project of projects) {
    const projectName = project.name;
    const projectRoot = project.data.root;
    const resolvedPackageRoot = path.join(workspaceRoot, projectRoot);

    // Get specifier for this specific project (from version plan or global)
    const projectSpecifier = specifierSource === 'version-plans'
      ? (specifierMap[projectName] || '')
      : specifier;

    console.log(`\n[Maven Generator] Processing ${projectName}`);
    console.log(`[Maven Generator] Project root: ${resolvedPackageRoot}`);
    console.log(`[Maven Generator] Specifier: ${projectSpecifier || '(none)'}`);

    // Resolve current version using our custom resolver
    let currentVersion;

    try {
      if (currentVersionResolver === 'disk') {
        // Read from pom.xml or package.json
        currentVersion = getVersion(resolvedPackageRoot);
      } else {
        throw new Error('Only "disk" resolver is supported for Maven projects');
      }
    } catch (error) {
      console.error(`[Maven Generator] Error reading version for ${projectName}:`, error.message);
      throw error;
    }

    console.log(`[Maven Generator] Current version: ${currentVersion}`);

    // Calculate new version using semver
    let newVersion;

    if (semver.valid(projectSpecifier)) {
      // Explicit version specified
      newVersion = projectSpecifier;
    } else if (projectSpecifier) {
      // Increment type specified (patch, minor, major, etc.)
      newVersion = semver.inc(currentVersion, projectSpecifier, preid);
    } else {
      // No specifier - use current version (happens during plan parsing)
      newVersion = currentVersion;
    }

    if (!newVersion && projectSpecifier) {
      throw new Error(`Could not calculate new version from ${currentVersion} with specifier ${projectSpecifier}`);
    }

    console.log(`[Maven Generator] New version: ${newVersion}`);

    // Update version using our custom resolver (only if specifier was provided)
    if (projectSpecifier && newVersion !== currentVersion) {
      try {
        // Pass the Nx tree so changes are tracked in virtual file system
        setVersion(resolvedPackageRoot, newVersion, tree);
        console.log(`[Maven Generator] ✅ Updated ${projectName} to ${newVersion}`);
      } catch (error) {
        console.error(`[Maven Generator] Error updating version for ${projectName}:`, error.message);
        throw error;
      }
    }

    results[projectName] = {
      currentVersion,
      newVersion: newVersion || currentVersion,
      projectRoot: projectRoot,
    };
  }
}

module.exports = versionGenerator;
module.exports.default = versionGenerator;
