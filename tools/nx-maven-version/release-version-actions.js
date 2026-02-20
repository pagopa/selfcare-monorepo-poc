'use strict';

const { join } = require('node:path');
const { VersionActions } = require('nx/release');

/**
 * VersionActions implementation for Maven projects using pom.xml as the manifest.
 * Expects project names in the format "groupId:artifactId" to determine Maven coordinates.
 *
 * This implementation supports:
 * - Reading the current version from the project's own <version> declaration in pom.xml.
 * - Updating the project's own version in pom.xml.
 * - Reading and updating versions of dependencies declared in pom.xml.
 *
*/

/**
 * Escape special characters in a string for use in a regular expression.
 * @param {*} value
 * @returns
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse Maven coordinates from a project name.
 * Expects the project name to be in the format "groupId:artifactId".
 * @param {string} projectName
 * @returns {{ groupId: string, artifactId: string } | null}
 */
function parseMavenCoords(projectName) {
  // Nx Maven plugin names projects like: groupId:artifactId
  if (!projectName || !projectName.includes(':')) {
    return null;
  }
  const [groupId, artifactId] = projectName.split(':', 2);
  if (!groupId || !artifactId) {
    return null;
  }
  return { groupId, artifactId };
}

/**
 * Read text content of a file from the Nx virtual file system tree.
 * @param {object} tree - Nx virtual file system tree
 * @param {string} filePath - Absolute path to the file
 * @returns {string | null} - File content as string, or null if not found
 */
function readText(tree, filePath) {
  const buf = tree.read(filePath);
  if (!buf) return null;
  return buf.toString('utf-8');
}

/**
 * Write text content to a file in the Nx virtual file system tree.
 * @param {object} tree - Nx virtual file system tree
 * @param {string} filePath - Absolute path to the file
 * @param {string} content - Text content to write
 */
function writeText(tree, filePath, content) {
  tree.write(filePath, content);
}

/**
 * Extract the project version from a Maven POM XML string.
 *
 * It looks for the sequence `<groupId>...<artifactId>...<version>...` matching the
 * provided Maven coordinates and returns the captured `<version>` value.
 *
 * Limitations:
 * - It expects the project to declare its own explicit `<version>`.
 * - It does not resolve parent inheritance or `${property}` indirections.
 *
 * @param {string} pomXml - Full pom.xml content
 * @param {{ groupId: string, artifactId: string }} coords - Maven coordinates of the current project
 * @returns {string | null} - The detected version, or null if not found
 */
function readProjectVersionFromPom(pomXml, coords) {
  // We only support projects where the POM declares its own <version>.
  // Match a <groupId> + <artifactId> pair for this project, then capture the next <version>.
  const groupId = escapeRegExp(coords.groupId);
  const artifactId = escapeRegExp(coords.artifactId);
  const pattern = new RegExp(
    `<groupId>\\s*${groupId}\\s*<\\/groupId>[\\s\\S]*?<artifactId>\\s*${artifactId}\\s*<\\/artifactId>\\s*<version>([^<]+)<\\/version>`,
    'm'
  );
  const match = pomXml.match(pattern);
  return match?.[1] ?? null;
}

/**
 * Update the project version in a Maven POM XML string.
 *
 * It targets the project coordinates (groupId + artifactId) and replaces the `<version>`
 * value that immediately follows them.
 *
 * @param {string} pomXml - Full pom.xml content
 * @param {{ groupId: string, artifactId: string }} coords - Maven coordinates of the current project
 * @param {string} newVersion - Version string to write into the project `<version>`
 * @returns {string | null} - Updated XML, or null if the expected pattern was not found
 */
function updateProjectVersionInPom(pomXml, coords, newVersion) {
  const groupId = escapeRegExp(coords.groupId);
  const artifactId = escapeRegExp(coords.artifactId);

  const pattern = new RegExp(
    `(<groupId>\\s*${groupId}\\s*<\\/groupId>[\\s\\S]*?<artifactId>\\s*${artifactId}\\s*<\\/artifactId>\\s*<version>)([^<]+)(<\\/version>)`,
    'm'
  );

  if (!pattern.test(pomXml)) {
    return null;
  }

  return pomXml.replace(pattern, `$1${newVersion}$3`);
}

/**
 * Read a dependency version from a Maven POM XML string.
 *
 * It searches for a `<dependency>...</dependency>` block matching the dependency
 * coordinates and returns the value of its `<version>` tag if present.
 *
 * Note:
 * - If the dependency has no explicit `<version>`, it returns null.
 * - It does not resolve versions inherited via dependencyManagement/parent/BOM.
 *
 * @param {string} pomXml - Full pom.xml content
 * @param {{ groupId: string, artifactId: string }} dependencyCoords - Maven coordinates of the dependency
 * @returns {string | null} - The dependency version, or null
 */
function readDependencyVersionFromPom(pomXml, dependencyCoords) {
  const groupId = escapeRegExp(dependencyCoords.groupId);
  const artifactId = escapeRegExp(dependencyCoords.artifactId);

  // Narrow to a single <dependency> block (non-greedy).
  const depBlockPattern = new RegExp(
    `<dependency>\\s*[\\s\\S]*?<groupId>\\s*${groupId}\\s*<\\/groupId>\\s*[\\s\\S]*?<artifactId>\\s*${artifactId}\\s*<\\/artifactId>[\\s\\S]*?<\\/dependency>`,
    'm'
  );
  const depBlockMatch = pomXml.match(depBlockPattern);
  if (!depBlockMatch) return null;

  const depBlock = depBlockMatch[0];
  const versionMatch = depBlock.match(/<version>\s*([^<]+)\s*<\/version>/m);
  return versionMatch?.[1] ?? null;
}

/**
 * Update (or keep) a dependency version within a Maven POM XML string.
 *
 * If the matching dependency block has an explicit `<version>`, it replaces it.
 * If the dependency block exists but has no `<version>`, it leaves it unchanged.
 *
 * @param {string} pomXml - Full pom.xml content
 * @param {{ groupId: string, artifactId: string }} dependencyCoords - Maven coordinates of the dependency
 * @param {string} newVersion - New version to set
 * @returns {string | null} - Updated XML, or null if the dependency block was not found
 */
function updateDependencyVersionInPom(pomXml, dependencyCoords, newVersion) {
  const groupId = escapeRegExp(dependencyCoords.groupId);
  const artifactId = escapeRegExp(dependencyCoords.artifactId);

  const depBlockPattern = new RegExp(
    `(<dependency>\\s*[\\s\\S]*?<groupId>\\s*${groupId}\\s*<\\/groupId>\\s*[\\s\\S]*?<artifactId>\\s*${artifactId}\\s*<\\/artifactId>[\\s\\S]*?<\\/dependency>)`,
    'm'
  );
  const depBlockMatch = pomXml.match(depBlockPattern);
  if (!depBlockMatch) return null;

  const depBlock = depBlockMatch[1];

  // Replace existing version if present.
  if (/<version>\s*[^<]+\s*<\/version>/m.test(depBlock)) {
    const updatedBlock = depBlock.replace(
      /(<version>\s*)([^<]+)(\s*<\/version>)/m,
      `$1${newVersion}$3`
    );
    return pomXml.replace(depBlock, updatedBlock);
  }

  // If no <version> is specified, we leave it unchanged.
  // (It may be inherited via dependencyManagement or parent POM.)
  return pomXml;
}

/**
 * Nx Release VersionActions implementation for Maven projects.
 *
 * This class allows Nx Release to treat `pom.xml` as the source manifest for versioning,
 * avoiding any requirement for `package.json` in Maven-only apps.
 */
class MavenVersionActions extends VersionActions {
  /**
   * Create a new MavenVersionActions instance for a specific project.
   *
   * @param {object} releaseGroup - Nx release group config
   * @param {import('nx/src/config/project-graph').ProjectGraphProjectNode} projectGraphNode - Project node
   * @param {object} finalConfigForProject - Resolved per-project release config
   */
  constructor(releaseGroup, projectGraphNode, finalConfigForProject) {
    super(releaseGroup, projectGraphNode, finalConfigForProject);
    this.validManifestFilenames = ['pom.xml'];
  }

  /**
   * Read the current version from the project's source manifest (pom.xml).
   *
   * @param {object} tree - Nx virtual file system tree
   * @returns {Promise<{ manifestPath: string, currentVersion: string }>} Current version info
   */
  async readCurrentVersionFromSourceManifest(tree) {
    const coords = parseMavenCoords(this.projectGraphNode.name);
    const pomPath = join(this.projectGraphNode.data.root, 'pom.xml');

    const pomXml = readText(tree, pomPath);
    if (!pomXml) {
      throw new Error(
        `Unable to determine the current version for project "${this.projectGraphNode.name}" because ${pomPath} does not exist or could not be read.`
      );
    }

    if (!coords) {
      throw new Error(
        `Unable to determine Maven coordinates for project "${this.projectGraphNode.name}". Expected project name in the form "groupId:artifactId".`
      );
    }

    const currentVersion = readProjectVersionFromPom(pomXml, coords);
    if (!currentVersion) {
      throw new Error(
        `Unable to determine the current version for project "${this.projectGraphNode.name}" from ${pomPath}. Ensure the POM declares <groupId>, <artifactId>, and an explicit <version>.`
      );
    }

    return {
      manifestPath: pomPath,
      currentVersion,
    };
  }

  /**
   * Read the current version from an external registry.
   *
   * For this Maven implementation we do not integrate with Maven registries, so we
   * always return `null` and a logText marker.
   *
   * @returns {Promise<{ currentVersion: null, logText: string }>} Registry version info
   */
  async readCurrentVersionFromRegistry() {
    // Not applicable for Maven within this workspace's release process.
    return { currentVersion: null, logText: 'maven:registry-not-supported' };
  }

  /**
   * Read the version specifier of a dependency as declared in the current project's pom.xml.
   *
   * Nx uses this information when deciding whether/how to update local dependencies.
   *
   * @param {object} tree - Nx virtual file system tree
   * @param {import('nx/src/config/project-graph').ProjectGraph} projectGraph - Project graph
   * @param {string} dependencyProjectName - Nx project name of the dependency
   * @returns {Promise<{ currentVersion: string|null, dependencyCollection: string|null }>}
   */
  async readCurrentVersionOfDependency(tree, projectGraph, dependencyProjectName) {
    const dependencyCoords = parseMavenCoords(dependencyProjectName);
    if (!dependencyCoords) {
      return { currentVersion: null, dependencyCollection: null };
    }

    const pomPath = join(this.projectGraphNode.data.root, 'pom.xml');
    const pomXml = readText(tree, pomPath);
    if (!pomXml) {
      return { currentVersion: null, dependencyCollection: null };
    }

    const currentVersion = readDependencyVersionFromPom(pomXml, dependencyCoords);
    return { currentVersion, dependencyCollection: 'dependencies' };
  }

  /**
   * Update the project's own version across all resolved manifest paths.
   *
   * Nx may resolve multiple manifests to update (e.g. if configured via manifestRootsToUpdate).
   *
   * @param {object} tree - Nx virtual file system tree
   * @param {string} newVersion - New version to write
   * @returns {Promise<string[]>} Log messages describing performed updates
   */
  async updateProjectVersion(tree, newVersion) {
    const coords = parseMavenCoords(this.projectGraphNode.name);
    if (!coords) {
      throw new Error(
        `Unable to update version for project "${this.projectGraphNode.name}". Expected project name in the form "groupId:artifactId".`
      );
    }

    const logMessages = [];
    for (const manifestToUpdate of this.manifestsToUpdate) {
      const pomXml = readText(tree, manifestToUpdate.manifestPath);
      if (!pomXml) {
        throw new Error(`Unable to read manifest: ${manifestToUpdate.manifestPath}`);
      }

      const updated = updateProjectVersionInPom(pomXml, coords, newVersion);
      if (!updated) {
        throw new Error(
          `Unable to update project version for "${this.projectGraphNode.name}" in ${manifestToUpdate.manifestPath}. Ensure the POM declares an explicit <version> for this artifact.`
        );
      }

      writeText(tree, manifestToUpdate.manifestPath, updated);
      logMessages.push(
        `✍️  New version ${newVersion} written to manifest: ${manifestToUpdate.manifestPath}`
      );
    }

    return logMessages;
  }

  /**
   * Update local dependency versions in pom.xml where they are explicitly declared.
   *
   * This is best-effort: if a dependency doesn't declare a `<version>` tag (e.g. managed
   * via dependencyManagement/BOM), we leave it unchanged.
   *
   * @param {object} tree - Nx virtual file system tree
   * @param {import('nx/src/config/project-graph').ProjectGraph} projectGraph - Project graph
   * @param {Record<string, string>} dependenciesToUpdate - Map: dependencyProjectName -> newVersion
   * @returns {Promise<string[]>} Log messages describing performed updates
   */
  async updateProjectDependencies(tree, projectGraph, dependenciesToUpdate) {
    const deps = Object.entries(dependenciesToUpdate);
    if (deps.length === 0) {
      return [];
    }

    const logMessages = [];

    for (const manifestToUpdate of this.manifestsToUpdate) {
      let pomXml = readText(tree, manifestToUpdate.manifestPath);
      if (!pomXml) {
        throw new Error(`Unable to read manifest: ${manifestToUpdate.manifestPath}`);
      }

      let updatedCount = 0;
      for (const [depProjectName, newVersion] of deps) {
        const depCoords = parseMavenCoords(depProjectName);
        if (!depCoords) continue;

        const updatedPom = updateDependencyVersionInPom(pomXml, depCoords, newVersion);
        if (updatedPom !== null && updatedPom !== pomXml) {
          pomXml = updatedPom;
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        writeText(tree, manifestToUpdate.manifestPath, pomXml);
        const depText = updatedCount === 1 ? 'dependency' : 'dependencies';
        logMessages.push(
          `✍️  Updated ${updatedCount} ${depText} in manifest: ${manifestToUpdate.manifestPath}`
        );
      }
    }

    return logMessages;
  }
}

module.exports = MavenVersionActions;
