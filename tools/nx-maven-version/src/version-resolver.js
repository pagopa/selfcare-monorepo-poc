const fs = require('fs');
const path = require('path');

/**
 * Check if a project is a Maven project (has pom.xml)
 * @param {string} projectRoot - Absolute path to project root
 * @returns {boolean}
 */
function isMavenProject(projectRoot) {
  return fs.existsSync(path.join(projectRoot, 'pom.xml'));
}

/**
 * Read version from pom.xml
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string} - Version string
 */
function getVersionFromPom(projectRoot) {
  const pomPath = path.join(projectRoot, 'pom.xml');

  if (!fs.existsSync(pomPath)) {
    throw new Error(`pom.xml not found at ${pomPath}`);
  }

  const pomContent = fs.readFileSync(pomPath, 'utf-8');

  // Match the first <version> tag after <artifactId> (the project version)
  const versionMatch = pomContent.match(/<artifactId>[^<]+<\/artifactId>\s*<version>([^<]+)<\/version>/);

  if (!versionMatch) {
    throw new Error(`Could not find version in pom.xml at ${pomPath}`);
  }

  const version = versionMatch[1];
  console.log(`[Maven] Read version ${version} from ${path.relative(process.cwd(), pomPath)}`);

  return version;
}

/**
 * Read version from package.json
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string} - Version string
 */
function getVersionFromPackageJson(projectRoot) {
  const packagePath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found at ${packagePath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

  if (!packageJson.version) {
    throw new Error(`No version field in package.json at ${packagePath}`);
  }

  console.log(`[Package.json] Read version ${packageJson.version} from ${path.relative(process.cwd(), packagePath)}`);

  return packageJson.version;
}

/**
 * Read version (auto-detect pom.xml or package.json)
 * @param {string} projectRoot - Absolute path to project root
 * @returns {string} - Version string
 */
function getVersion(projectRoot) {
  if (isMavenProject(projectRoot)) {
    return getVersionFromPom(projectRoot);
  } else {
    return getVersionFromPackageJson(projectRoot);
  }
}

/**
 * Write new version to pom.xml
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} newVersion - New version to write
 * @param {object} tree - Nx virtual file system tree (optional)
 */
function setVersionInPom(projectRoot, newVersion, tree) {
  const pomPath = path.join(projectRoot, 'pom.xml');

  // Always check with fs first since pom.xml might not be in tree
  if (!fs.existsSync(pomPath)) {
    throw new Error(`pom.xml not found at ${pomPath}`);
  }

  // Read from tree if available, otherwise from fs
  let pomContent = tree && tree.exists(pomPath)
    ? tree.read(pomPath, 'utf-8')
    : fs.readFileSync(pomPath, 'utf-8');

  // Replace only the first <version> tag (the project version)
  // This pattern matches: <artifactId>...</artifactId><version>...</version>
  pomContent = pomContent.replace(
    /(<artifactId>[^<]+<\/artifactId>\s*<version>)[^<]+(<\/version>)/,
    `$1${newVersion}$2`
  );

  // Write to tree or fs
  if (tree) {
    tree.write(pomPath, pomContent);
  } else {
    fs.writeFileSync(pomPath, pomContent, 'utf-8');
  }

  console.log(`[Maven] Updated ${path.relative(process.cwd(), pomPath)} to version ${newVersion}`);
}

/**
 * Write new version to package.json
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} newVersion - New version to write
 * @param {object} tree - Nx virtual file system tree (optional)
 */
function setVersionInPackageJson(projectRoot, newVersion, tree) {
  const packagePath = path.join(projectRoot, 'package.json');

  // Always check with fs first
  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found at ${packagePath}`);
  }

  // Read from tree if available, otherwise from fs
  const content = tree && tree.exists(packagePath)
    ? tree.read(packagePath, 'utf-8')
    : fs.readFileSync(packagePath, 'utf-8');

  const packageJson = JSON.parse(content);
  packageJson.version = newVersion;

  const newContent = JSON.stringify(packageJson, null, 2) + '\n';

  // Write to tree or fs
  if (tree) {
    tree.write(packagePath, newContent);
  } else {
    fs.writeFileSync(packagePath, newContent, 'utf-8');
  }

  console.log(`[Package.json] Updated ${path.relative(process.cwd(), packagePath)} to version ${newVersion}`);
}

/**
 * Write new version (auto-detect pom.xml or package.json)
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} newVersion - New version to write
 * @param {object} tree - Nx virtual file system tree (optional)
 */
function setVersion(projectRoot, newVersion, tree) {
  if (isMavenProject(projectRoot)) {
    setVersionInPom(projectRoot, newVersion, tree);
  } else {
    setVersionInPackageJson(projectRoot, newVersion, tree);
  }
}

module.exports = {
  getVersion,
  setVersion,
};
