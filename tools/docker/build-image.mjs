import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeImageRef(projectRoot) {
  const normalized = projectRoot
    .replace(/^[\\/]/, '')
    .replace(/[\\/\s]+/g, '-')
    .toLowerCase();

  return normalized.length > 128 ? normalized.slice(-128) : normalized;
}

function getRepositoryUrl(pkg) {
  if (typeof pkg.repository === 'string') {
    return pkg.repository;
  }

  if (pkg.repository && typeof pkg.repository.url === 'string') {
    return pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }

  return '';
}

function getCommitSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function quote(arg) {
  if (/^[a-zA-Z0-9_./:=,-]+$/.test(arg)) {
    return arg;
  }

  return JSON.stringify(arg);
}

const workspaceRoot = process.cwd();
const projectRoot = process.argv[2];
const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

if (!projectRoot) {
  console.error('Usage: node tools/docker/build-image.mjs <project-root> [--dry-run]');
  process.exit(1);
}

const packageJson = readJson(join(workspaceRoot, projectRoot, 'package.json'));
const nxJson = readJson(join(workspaceRoot, 'nx.json'));

const localImageRef = normalizeImageRef(projectRoot);
const registryUrl = nxJson.release?.docker?.registryUrl;
const repositoryName = packageJson.nx?.release?.docker?.repositoryName;
const latestImageRef = repositoryName
  ? `${registryUrl ? `${registryUrl}/` : ''}${repositoryName}:latest`
  : null;

const sourceUrl = getRepositoryUrl(packageJson);
const commitSha = getCommitSha();
const createdAt = new Date().toISOString();
const platform = process.env.DOCKER_PLATFORM ?? 'linux/arm64,linux/amd64';

const args = ['build', '.', '--platform', platform, '--tag', localImageRef];

if (latestImageRef) {
  args.push('--tag', latestImageRef);
}

const labels = [
  ['org.opencontainers.image.title', packageJson.name],
  ['org.opencontainers.image.description', packageJson.description ?? packageJson.name],
  ['org.opencontainers.image.revision', commitSha],
  ['org.opencontainers.image.created', createdAt],
];

if (sourceUrl) {
  labels.push(['org.opencontainers.image.source', sourceUrl]);
  labels.push(['org.opencontainers.image.url', sourceUrl]);
}

for (const [key, value] of labels) {
  args.push('--label', `${key}=${value}`);
}

args.push('--provenance=false');

const prettyCommand = ['docker', ...args].map(quote).join(' ');
console.log(`Running: ${prettyCommand}`);

if (dryRun) {
  console.log('Dry run enabled, skipping docker build.');
  process.exit(0);
}

const result = spawnSync('docker', args, {
  cwd: join(workspaceRoot, projectRoot),
  stdio: 'inherit',
  env: {
    ...process.env,
    DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT ?? '1',
  },
});

process.exit(result.status ?? 1);