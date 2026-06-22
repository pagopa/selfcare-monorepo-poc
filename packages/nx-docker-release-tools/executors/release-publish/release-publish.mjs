import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  buildMetadataTagArguments,
  getRuntimeContext,
} from "../build/build.mjs";

const normalizeImageReference = (imageReference) =>
  imageReference.startsWith("docker.io/")
    ? imageReference.slice("docker.io/".length)
    : imageReference;

const dockerBuildExecutor = "@pagopa/nx-dx-docker-plugin:build";

const normalizeTagList = (value) =>
  Array.isArray(value)
    ? value.filter((tag) => typeof tag === "string")
    : undefined;

const getTargetMetadataTags = (target, configurationName) => {
  if (!target || typeof target !== "object") {
    return undefined;
  }

  const configurationTags = normalizeTagList(
    target.configurations?.[configurationName]?.metadata?.tags,
  );

  if (configurationTags?.length) {
    return configurationTags;
  }

  const targetTags = normalizeTagList(target.options?.metadata?.tags);
  return targetTags?.length ? targetTags : undefined;
};

const getLatestImageReference = (imageReference) => {
  const lastSlashIndex = imageReference.lastIndexOf("/");
  const lastColonIndex = imageReference.lastIndexOf(":");

  if (lastColonIndex <= lastSlashIndex) {
    throw new Error(
      `Image reference '${imageReference}' does not contain an explicit version tag.`,
    );
  }

  return `${imageReference.slice(0, lastColonIndex)}:latest`;
};

const getExplicitImageTag = (imageReference) => {
  const lastSlashIndex = imageReference.lastIndexOf("/");
  const lastColonIndex = imageReference.lastIndexOf(":");

  return lastColonIndex > lastSlashIndex
    ? imageReference.slice(lastColonIndex + 1)
    : undefined;
};

const getBuildMetadataTags = (projectNode, buildTargetName, buildTargetConfiguration) => {
  const configuredBuildTarget = projectNode.data.targets?.[buildTargetName];

  if (configuredBuildTarget) {
    const configuredTags =
      getTargetMetadataTags(configuredBuildTarget, buildTargetConfiguration) ??
      getTargetMetadataTags(configuredBuildTarget, "ci") ??
      getTargetMetadataTags(configuredBuildTarget);

    if (configuredTags?.length) {
      return configuredTags;
    }
  }

  const legacyBuildTarget = Object.values(projectNode.data.targets ?? {}).find(
    (target) => target.executor === dockerBuildExecutor,
  );

  return (
    getTargetMetadataTags(legacyBuildTarget, buildTargetConfiguration) ??
    getTargetMetadataTags(legacyBuildTarget, "ci") ??
    getTargetMetadataTags(legacyBuildTarget)
  );
};

const getImageReferencesToPublish = (
  workspaceRoot,
  projectName,
  projectNode,
  imageReference,
  buildTargetName,
  buildTargetConfiguration,
) => {
  const metadataTags = getBuildMetadataTags(
    projectNode,
    buildTargetName,
    buildTargetConfiguration,
  );

  if (!metadataTags || metadataTags.length === 0) {
    return [imageReference, getLatestImageReference(imageReference)];
  }

  const runtimeContext = getRuntimeContext(
    workspaceRoot,
    projectName,
    getExplicitImageTag(imageReference),
  );
  const additionalImageReferences = buildMetadataTagArguments(
    [`--tag ${imageReference}`],
    { tags: metadataTags },
    runtimeContext,
  ).map((tagArgument) => tagArgument.replace(/^--tag\s+/u, ""));

  return [imageReference, ...additionalImageReferences];
};

const getDockerVersionDirectoryPath = (workspaceRoot, projectRoot) =>
  path.join(workspaceRoot, "tmp", projectRoot);

const getDockerVersionFilePath = (workspaceRoot, projectRoot) =>
  path.join(getDockerVersionDirectoryPath(workspaceRoot, projectRoot), ".docker-version");

const parseReleasePublishOptions = (rawOptions) => {
  const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};

  return {
    buildTargetConfiguration:
      typeof options.buildTargetConfiguration === "string"
        ? options.buildTargetConfiguration
        : undefined,
    buildTargetName:
      typeof options.buildTargetName === "string"
        ? options.buildTargetName
        : "docker:build",
    dryRun: options.dryRun === true,
    quiet: options.quiet === true,
  };
};

const readImageReference = (workspaceRoot, projectRoot) => {
  const dockerVersionFilePath = getDockerVersionFilePath(workspaceRoot, projectRoot);

  if (!existsSync(dockerVersionFilePath)) {
    throw new Error(
      `Could not find ${dockerVersionFilePath}. Did you run 'nx release version'?`,
    );
  }

  const imageReference = readFileSync(dockerVersionFilePath, {
    encoding: "utf8",
  }).trim();

  if (!imageReference) {
    throw new Error(`The file ${dockerVersionFilePath} is empty.`);
  }

  return imageReference;
};

const assertLocalImageExists = (imageReference) => {
  try {
    execSync(`docker image inspect ${normalizeImageReference(imageReference)}`, {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
  } catch {
    throw new Error(
      `Could not find local Docker image '${imageReference}'. Did you run 'nx release version'?`,
    );
  }
};

const runDockerCommand = (command, quiet) => {
  execSync(command, {
    stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    windowsHide: true,
  });
};

const runPublish = (imageReference, imageReferencesToPublish, quiet) => {
  console.info(`Pushing Docker image ${imageReference}`);
  runDockerCommand(`docker push ${imageReference}`, quiet);

  for (const additionalImageReference of imageReferencesToPublish.slice(1)) {
    console.info(`Tagging Docker image ${additionalImageReference}`);
    runDockerCommand(`docker tag ${imageReference} ${additionalImageReference}`, quiet);

    console.info(`Pushing Docker image ${additionalImageReference}`);
    runDockerCommand(`docker push ${additionalImageReference}`, quiet);
  }
};

const cleanupDockerVersionDirectory = (workspaceRoot, projectRoot) => {
  rmSync(getDockerVersionDirectoryPath(workspaceRoot, projectRoot), {
    force: true,
    recursive: true,
  });
};

export const releasePublishExecutor = async (rawOptions, context) => {
  const options = parseReleasePublishOptions(rawOptions);
  const projectName = context.projectName;
  const projectNode =
    projectName && context.projectGraph
      ? context.projectGraph.nodes[projectName]
      : undefined;

  if (!projectName || !projectNode) {
    throw new Error("Could not resolve the current project for Docker publish.");
  }

  const projectRoot = projectNode.data.root;
  const imageReference = readImageReference(context.root, projectRoot);
  const imageReferencesToPublish = getImageReferencesToPublish(
    context.root,
    projectName,
    projectNode,
    imageReference,
    options.buildTargetName,
    options.buildTargetConfiguration,
  );
  const dryRun = process.env.NX_DRY_RUN === "true" || options.dryRun === true;

  if (dryRun) {
    console.info(
      `Dry run enabled: would push ${imageReferencesToPublish.map((ref) => `'${ref}'`).join(", ")}.`,
    );
    return { success: true };
  }

  assertLocalImageExists(imageReference);
  runPublish(imageReference, imageReferencesToPublish, options.quiet);
  cleanupDockerVersionDirectory(context.root, projectRoot);

  return { success: true };
};

export default releasePublishExecutor;