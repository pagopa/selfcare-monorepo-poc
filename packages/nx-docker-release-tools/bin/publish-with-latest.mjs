#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  let projectRoot;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--project-root' || arg === '--projectRoot') {
      projectRoot = argv[i + 1];
      i += 1;
      continue;
    }

    if (!projectRoot && !arg.startsWith('-')) {
      projectRoot = arg;
    }
  }

  return { projectRoot };
}

function getLatestRef(imageRef) {
  const lastSlash = imageRef.lastIndexOf('/');
  const lastColon = imageRef.lastIndexOf(':');

  if (lastColon <= lastSlash) {
    throw new Error(`Image reference '${imageRef}' does not include an explicit tag.`);
  }

  return `${imageRef.slice(0, lastColon)}:latest`;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const { projectRoot } = parseArgs(process.argv);

if (!projectRoot) {
  console.error('Usage: dx-docker-release-publish-with-latest --project-root <project-root>');
  process.exit(1);
}

const workspaceRoot = process.cwd();
const versionFilePath = resolve(workspaceRoot, 'tmp', projectRoot, '.docker-version');

if (!existsSync(versionFilePath)) {
  console.error(`Could not find ${versionFilePath}. Did you run 'nx release version'?`);
  process.exit(1);
}

const imageRef = readFileSync(versionFilePath, 'utf8').trim();
if (!imageRef) {
  console.error(`The file ${versionFilePath} is empty.`);
  process.exit(1);
}

const latestRef = getLatestRef(imageRef);

if (process.env.NX_DRY_RUN === 'true') {
  console.log(`Dry run enabled: would push '${imageRef}' and '${latestRef}'`);
  process.exit(0);
}

const inspectResult = spawnSync('docker', ['image', 'inspect', imageRef], {
  stdio: 'ignore',
});

if (inspectResult.status !== 0) {
  console.error(`Could not find local Docker image '${imageRef}'. Did you run 'nx release version'?`);
  process.exit(inspectResult.status ?? 1);
}

console.log(`Pushing version image: ${imageRef}`);
runCommand('docker', ['push', imageRef]);

console.log(`Tagging latest image: ${latestRef}`);
runCommand('docker', ['tag', imageRef, latestRef]);

console.log(`Pushing latest image: ${latestRef}`);
runCommand('docker', ['push', latestRef]);
