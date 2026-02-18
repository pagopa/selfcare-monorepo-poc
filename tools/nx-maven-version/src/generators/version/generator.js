const { getVersion, setVersion } = require('../../version-resolver');
const semver = require('semver');
const path = require('path');

/**
 * Maven version generator for Nx Release
 *
 * This generator handles versioning for projects with pom.xml or package.json files
 */
async function versionGenerator(tree, options) {
  const { specifier, preid, currentVersionResolver, projects } = options;

  console.log('[Maven Generator] Processing release for', projects ? projects.length : 0, 'project(s)');

  // Nx passes a 'projects' array when invoked during release
  // Each project has: name, type, data (with root, sourceRoot, etc.)
  if (!projects || projects.length === 0) {
    throw new Error('No projects provided to version generator');
  }

  const results = {};

  for (const project of projects) {
    const projectName = project.name;
    const projectRoot = project.data.root;
    const workspaceRoot = process.cwd();
    const resolvedPackageRoot = path.join(workspaceRoot, projectRoot);

    console.log(`\n[Maven Generator] Processing ${projectName}`);
    console.log(`[Maven Generator] Project root: ${resolvedPackageRoot}`);

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

    if (semver.valid(specifier)) {
      // Explicit version specified
      newVersion = specifier;
    } else if (specifier) {
      // Increment type specified (patch, minor, major, etc.)
      newVersion = semver.inc(currentVersion, specifier, preid);
    } else {
      // No specifier - use current version (happens during plan parsing)
      newVersion = currentVersion;
    }

    if (!newVersion && specifier) {
      throw new Error(`Could not calculate new version from ${currentVersion} with specifier ${specifier}`);
    }

    console.log(`[Maven Generator] New version: ${newVersion}`);

    // Update version using our custom resolver (only if specifier was provided)
    if (specifier && newVersion !== currentVersion) {
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

  // Nx expects an object with a 'data' property containing project version data
  // and optionally a 'callback' for cleanup operations

  return {
    data: results,
    callback: async (tree, opts) => {
      // Future: add lockfile updates or version plan cleanup here if needed
      return { changedFiles: [], deletedFiles: [] };
    },
  };
}

module.exports = versionGenerator;
module.exports.default = versionGenerator;
