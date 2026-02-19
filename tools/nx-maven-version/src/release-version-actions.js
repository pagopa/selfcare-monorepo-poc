'use strict';

const { join } = require('node:path');
const { VersionActions } = require('nx/release');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function readText(tree, filePath) {
  const buf = tree.read(filePath);
  if (!buf) return null;
  return buf.toString('utf-8');
}

function writeText(tree, filePath, content) {
  tree.write(filePath, content);
}

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

class MavenVersionActions extends VersionActions {
  constructor(releaseGroup, projectGraphNode, finalConfigForProject) {
    super(releaseGroup, projectGraphNode, finalConfigForProject);
    this.validManifestFilenames = ['pom.xml'];
  }

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

  async readCurrentVersionFromRegistry() {
    // Not applicable for Maven within this workspace's release process.
    return { currentVersion: null, logText: 'maven:registry-not-supported' };
  }

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
