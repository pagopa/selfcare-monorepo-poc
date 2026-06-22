import { createNodesV2 as baseCreateNodesV2 } from "@nx/docker";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const normalizePath = (value) => value.replaceAll(path.sep, "/");
const copyOrAddInstructionPattern = /^(COPY|ADD)\s+/i;
const shellTokenPattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
const wildcardPattern = /[*?[]/;
const ignoredContextDirectoryNames = new Set([".git", "node_modules"]);

const normalizeArgs = (value) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];

const normalizeEnv = (value) => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry) => typeof entry[1] === "string"),
  );
};

const normalizeMetadata = (value) => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const labels = Array.isArray(value.labels)
    ? value.labels.filter((item) => typeof item === "string")
    : undefined;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((item) => typeof item === "string")
    : undefined;

  if ((!labels || labels.length === 0) && (!tags || tags.length === 0)) {
    return undefined;
  }

  return {
    ...(labels && labels.length > 0 ? { labels } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
};

const cloneTargetOptions = (targetOptions) => {
  if (typeof targetOptions === "string" || targetOptions === undefined) {
    return targetOptions;
  }

  return structuredClone(targetOptions);
};

const parseOptions = (rawOptions) => {
  const parsedOptions = {
    ...rawOptions,
  };

  if (rawOptions?.buildTarget !== undefined) {
    parsedOptions.buildTarget = cloneTargetOptions(rawOptions.buildTarget);
  }

  if (rawOptions?.dockerImageAuthors !== undefined) {
    parsedOptions.dockerImageAuthors = rawOptions.dockerImageAuthors;
  }

  if (rawOptions?.runTarget !== undefined) {
    parsedOptions.runTarget = cloneTargetOptions(rawOptions.runTarget);
  }

  return parsedOptions;
};

const getProjectNameFromPath = (projectRoot, workspaceRoot) => {
  const root = projectRoot === "." ? workspaceRoot : projectRoot;
  const normalizedProjectRoot = root
    .replace(/^[\\/]/, "")
    .replace(/[\\/\s]+/g, "-")
    .toLowerCase();

  return normalizedProjectRoot.length > 128
    ? normalizedProjectRoot.slice(-128)
    : normalizedProjectRoot;
};

const readJsonIfExists = (filePath) => {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${filePath}.`, { cause: error });
  }
};

const getProjectDescriptor = (workspaceRoot, projectRoot, fallbackProjectName) => {
  const packageJson = readJsonIfExists(
    path.join(workspaceRoot, projectRoot, "package.json"),
  );
  const projectJson = readJsonIfExists(
    path.join(workspaceRoot, projectRoot, "project.json"),
  );

  const repositoryUrl =
    normalizeRepositoryUrl(getRepositoryFieldUrl(packageJson?.repository)) ??
    normalizeRepositoryUrl(getRepositoryFieldUrl(projectJson?.repository)) ??
    getGitRemoteUrl(workspaceRoot) ??
    "https://github.com/pagopa/selfcare-monorepo-poc";

  return {
    name:
      projectJson?.name ??
      packageJson?.name ??
      fallbackProjectName,
    description:
      projectJson?.description ??
      packageJson?.description ??
      fallbackProjectName,
    repositoryUrl,
    sourceUrl: `${repositoryUrl}/blob/main/${normalizePath(projectRoot)}`,
  };
};

const getRepositoryFieldUrl = (repository) => {
  if (typeof repository === "string") {
    return repository;
  }

  return repository?.url;
};

const normalizeRepositoryUrl = (url) => {
  if (!url || typeof url !== "string") {
    return null;
  }

  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return null;
  }

  return trimmedUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/^git:\/\/github\.com\//, "https://github.com/");
};

const getGitRemoteUrl = (workspaceRoot) => {
  try {
    return normalizeRepositoryUrl(
      execSync("git config --get remote.origin.url", {
        cwd: workspaceRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
};

const getHeadCommitSha = (workspaceRoot) => {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const getDefaultDockerImageAuthors = (workspaceRoot) => {
  const repositoryUrl = getGitRemoteUrl(workspaceRoot);
  const repositoryMatch = repositoryUrl?.match(
    /^https:\/\/github\.com\/([^/]+)\/[^/]+$/i,
  );

  return repositoryMatch?.[1] ?? "PagoPA";
};

const quoteLabelValue = (value) =>
  JSON.stringify(String(value).replaceAll("\n", " "));

const getAutomaticDockerLabelArgs = (
  workspaceRoot,
  projectRoot,
  projectName,
  authors,
) => {
  const descriptor = getProjectDescriptor(
    workspaceRoot,
    projectRoot,
    projectName,
  );
  const commitSha = getHeadCommitSha(workspaceRoot);
  const labels = [
    `--label org.opencontainers.image.title=${quoteLabelValue(descriptor.name)}`,
    `--label org.opencontainers.image.description=${quoteLabelValue(descriptor.description)}`,
    `--label org.opencontainers.image.authors=${quoteLabelValue(authors)}`,
    `--label org.opencontainers.image.url=${quoteLabelValue(descriptor.repositoryUrl)}`,
    `--label org.opencontainers.image.source=${quoteLabelValue(descriptor.sourceUrl)}`,
  ];

  if (commitSha) {
    labels.push(
      `--label org.opencontainers.image.revision=${quoteLabelValue(commitSha)}`,
    );
  }

  labels.push("--provenance=false");

  return labels;
};

const readDockerfile = (dockerfilePath) =>
  readFileSync(dockerfilePath, "utf8").replaceAll("\r\n", "\n");

const normalizeDockerSourcePath = (sourcePath) => {
  const normalizedSourcePath = normalizePath(sourcePath.trim()).replace(
    /^\.\//,
    "",
  );

  return normalizedSourcePath.length > 0 ? normalizedSourcePath : ".";
};

const getInstructionLines = (dockerfileContent) => {
  const instructions = [];
  let currentInstruction = "";

  for (const rawLine of dockerfileContent.split("\n")) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    currentInstruction = currentInstruction
      ? `${currentInstruction} ${trimmedLine}`
      : trimmedLine;

    if (trimmedLine.endsWith("\\")) {
      currentInstruction = currentInstruction.slice(0, -1).trim();
      continue;
    }

    instructions.push(currentInstruction);
    currentInstruction = "";
  }

  if (currentInstruction) {
    instructions.push(currentInstruction);
  }

  return instructions;
};

const tokenizeShellArguments = (value) =>
  Array.from(value.matchAll(shellTokenPattern), (match) =>
    match[1] ?? match[2] ?? match[3] ?? "",
  );

const hasStageCopyFlag = (tokens) =>
  tokens.some((token) => token === "--from" || token.startsWith("--from="));

const stripCopyFlags = (tokens) => {
  const sourceTokens = [];
  let skipNextToken = false;

  for (const token of tokens) {
    if (skipNextToken) {
      skipNextToken = false;
      continue;
    }

    if (!token.startsWith("--")) {
      sourceTokens.push(token);
      continue;
    }

    if (!token.includes("=")) {
      skipNextToken = true;
    }
  }

  return sourceTokens;
};

const parseJsonInstructionSources = (instructionBody) => {
  const jsonStartIndex = instructionBody.indexOf("[");

  if (jsonStartIndex === -1) {
    return null;
  }

  const flagTokens = tokenizeShellArguments(
    instructionBody.slice(0, jsonStartIndex).trim(),
  );

  if (hasStageCopyFlag(flagTokens)) {
    return [];
  }

  try {
    const parsedInstruction = JSON.parse(instructionBody.slice(jsonStartIndex));

    if (
      !Array.isArray(parsedInstruction) ||
      parsedInstruction.length < 2 ||
      !parsedInstruction.every((value) => typeof value === "string")
    ) {
      return [];
    }

    return parsedInstruction.slice(0, -1);
  } catch {
    return [];
  }
};

const parseShellInstructionSources = (instructionBody) => {
  const tokens = tokenizeShellArguments(instructionBody);

  if (hasStageCopyFlag(tokens)) {
    return [];
  }

  const sourceAndDestinationTokens = stripCopyFlags(tokens);

  return sourceAndDestinationTokens.length >= 2
    ? sourceAndDestinationTokens.slice(0, -1)
    : [];
};

const isRemoteAddSource = (sourcePath) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(sourcePath);

const getLocalBuildSources = (dockerfileContent) =>
  getInstructionLines(dockerfileContent)
    .filter((instruction) => copyOrAddInstructionPattern.test(instruction))
    .flatMap((instruction) => {
      const instructionBody = instruction
        .replace(copyOrAddInstructionPattern, "")
        .trim();
      const jsonInstructionSources = parseJsonInstructionSources(
        instructionBody,
      );

      return jsonInstructionSources ?? parseShellInstructionSources(instructionBody);
    })
    .map(normalizeDockerSourcePath)
    .filter((sourcePath) => !isRemoteAddSource(sourcePath));

const getAncestorCandidateContexts = (workspaceRoot, projectRoot) => {
  const candidateContexts = [];
  const workspaceRootAbsolutePath = path.resolve(workspaceRoot);
  let currentContext = path.resolve(workspaceRoot, projectRoot);

  while (true) {
    candidateContexts.push(currentContext);

    if (currentContext === workspaceRootAbsolutePath) {
      return candidateContexts;
    }

    const parentContext = path.dirname(currentContext);

    if (
      parentContext === currentContext ||
      !parentContext.startsWith(workspaceRootAbsolutePath)
    ) {
      return candidateContexts;
    }

    currentContext = parentContext;
  }
};

const getNestedCandidateContexts = (workspaceRoot, projectRoot) => {
  const projectRootAbsolutePath = path.resolve(workspaceRoot, projectRoot);

  if (!existsSync(projectRootAbsolutePath)) {
    return [];
  }

  return readdirSync(projectRootAbsolutePath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        !ignoredContextDirectoryNames.has(entry.name),
    )
    .map((entry) => path.join(projectRootAbsolutePath, entry.name));
};

const getSourceBasePath = (sourcePath) => {
  if (!wildcardPattern.test(sourcePath)) {
    return sourcePath;
  }

  const firstWildcardIndex = sourcePath.search(wildcardPattern);
  const fixedPrefix = sourcePath.slice(0, firstWildcardIndex).replace(/\/$/, "");

  if (!fixedPrefix) {
    return ".";
  }

  const lastSlashIndex = fixedPrefix.lastIndexOf("/");

  return lastSlashIndex === -1
    ? fixedPrefix
    : fixedPrefix.slice(0, lastSlashIndex);
};

const canResolveSourceFromContext = (candidateContext, sourcePath) => {
  if (sourcePath === ".") {
    return true;
  }

  if (sourcePath.startsWith("../")) {
    return false;
  }

  const sourceBasePath = getSourceBasePath(sourcePath);
  return existsSync(path.join(candidateContext, sourceBasePath));
};

const getPathDepth = (workspaceRoot, directoryPath) => {
  const relativePath = normalizePath(path.relative(workspaceRoot, directoryPath));
  return relativePath.length === 0 ? 0 : relativePath.split("/").length;
};

const toWorkspaceRelativePath = (workspaceRoot, directoryPath) => {
  const relativePath = normalizePath(path.relative(workspaceRoot, directoryPath));
  return relativePath.length > 0 ? relativePath : ".";
};

const selectBuildContext = (workspaceRoot, projectRoot, dockerfileContent) => {
  const localBuildSources = getLocalBuildSources(dockerfileContent);

  if (localBuildSources.length === 0) {
    return normalizePath(projectRoot);
  }

  const candidateContexts = Array.from(
    new Set([
      ...getNestedCandidateContexts(workspaceRoot, projectRoot),
      ...getAncestorCandidateContexts(workspaceRoot, projectRoot),
    ]),
  );
  const validContexts = candidateContexts
    .filter((candidateContext) =>
      localBuildSources.every((sourcePath) =>
        canResolveSourceFromContext(candidateContext, sourcePath),
      ),
    )
    .sort((leftContext, rightContext) => {
      const depthDelta =
        getPathDepth(workspaceRoot, rightContext) -
        getPathDepth(workspaceRoot, leftContext);
      return depthDelta !== 0
        ? depthDelta
        : leftContext.localeCompare(rightContext);
    });

  return validContexts[0]
    ? toWorkspaceRelativePath(workspaceRoot, validContexts[0])
    : normalizePath(projectRoot);
};

const getDockerBuildContext = (workspaceRoot, projectRoot, dockerfilePath) => {
  const resolvedDockerfilePath = path.isAbsolute(dockerfilePath)
    ? dockerfilePath
    : path.join(workspaceRoot, dockerfilePath);
  const dockerfileContent = readDockerfile(resolvedDockerfilePath);

  return selectBuildContext(workspaceRoot, projectRoot, dockerfileContent);
};

const getDockerfileArgument = (buildContext, dockerfilePath) => {
  const relativeDockerfile = normalizePath(
    path.relative(buildContext === "." ? "." : buildContext, dockerfilePath),
  );

  return relativeDockerfile.length > 0 ? relativeDockerfile : "Dockerfile";
};

const normalizeTargetForNx = (target, defaultName) => {
  if (typeof target === "string" || target === undefined) {
    return target;
  }

  return {
    ...target,
    name: target.name ?? defaultName,
  };
};

const stripMetadataFromBuildTarget = (target) => {
  if (typeof target === "string" || target === undefined) {
    return target;
  }

  const { configurations, metadata: _metadata, ...rest } = target;

  if (!configurations) {
    return rest;
  }

  return {
    ...rest,
    configurations: Object.fromEntries(
      Object.entries(configurations).map(
        ([configurationName, configuration]) => {
          const { metadata: _configurationMetadata, ...configurationRest } =
            configuration;
          return [configurationName, configurationRest];
        },
      ),
    ),
  };
};

const getBuildTargetMetadata = (target, configurationName) => {
  if (typeof target === "string" || target === undefined) {
    return undefined;
  }

  if (configurationName) {
    return normalizeMetadata(target.configurations?.[configurationName]?.metadata);
  }

  return normalizeMetadata(target.metadata);
};

const removeExistingFileArgs = (args) =>
  args.filter(
    (arg) =>
      !arg.startsWith("--file ") && !arg.startsWith("-f "),
  );

const removeExistingLabelArgs = (args) =>
  args.filter(
    (arg) =>
      !arg.startsWith("--label org.opencontainers.image.") &&
      arg !== "--provenance=false",
  );

const dockerReleasePublishTargetName = "docker-release-publish";
const dockerBuildExecutor = "@pagopa/nx-dx-docker-plugin:build";
const dockerReleasePublishExecutors = new Set([
  "@nx/docker:release-publish",
  "@pagopa/nx-dx-docker-plugin:release-publish",
]);

const shouldReplaceReleasePublishTarget = (target) =>
  !target?.executor || dockerReleasePublishExecutors.has(target.executor);

const patchBuildTargetOptions = (
  workspaceRoot,
  projectRoot,
  projectName,
  dockerfilePath,
  targetOptions,
  authors,
  metadata,
) => {
  const buildContext = getDockerBuildContext(
    workspaceRoot,
    projectRoot,
    dockerfilePath,
  );
  const dockerfileArgument = getDockerfileArgument(buildContext, dockerfilePath);
  const existingOptions = targetOptions ?? {};
  const existingEnv = normalizeEnv(existingOptions.env);
  const baseArgs = removeExistingLabelArgs(
    removeExistingFileArgs(normalizeArgs(existingOptions.args)),
  );
  const labelArgs = getAutomaticDockerLabelArgs(
    workspaceRoot,
    projectRoot,
    projectName,
    authors,
  );

  return {
    ...existingOptions,
    ...(metadata ? { metadata } : {}),
    args: [...baseArgs, `--file ${dockerfileArgument}`, ...labelArgs],
    cwd: buildContext,
    env: {
      ...existingEnv,
      DOCKER_BUILDKIT: existingEnv.DOCKER_BUILDKIT ?? "1",
    },
  };
};

const patchBuildTarget = (
  workspaceRoot,
  projectRoot,
  projectName,
  dockerfilePath,
  buildTarget,
  authors,
  metadata,
  configurationMetadata,
) => {
  const { command: _command, ...restTarget } = buildTarget;
  const configurations = buildTarget.configurations
    ? Object.fromEntries(
        Object.entries(buildTarget.configurations).map(
          ([configurationName, configurationOptions]) => [
            configurationName,
            patchBuildTargetOptions(
              workspaceRoot,
              projectRoot,
              projectName,
              dockerfilePath,
              configurationOptions,
              authors,
              configurationMetadata[configurationName],
            ),
          ],
        ),
      )
    : undefined;

  return {
    ...restTarget,
    executor: dockerBuildExecutor,
    options: patchBuildTargetOptions(
      workspaceRoot,
      projectRoot,
      projectName,
      dockerfilePath,
      buildTarget.options,
      authors,
      metadata,
    ),
    ...(configurations ? { configurations } : {}),
  };
};

const patchProjects = (result, configFilePath, options, workspaceRoot) => {
  if (!result.projects) {
    return result;
  }

  const dockerImageAuthors =
    options.dockerImageAuthors ?? getDefaultDockerImageAuthors(workspaceRoot);
  const baseBuildTargetMetadata = getBuildTargetMetadata(options.buildTarget);
  const buildTargetConfigurationMetadata =
    typeof options.buildTarget === "string" || options.buildTarget === undefined
      ? {}
      : Object.fromEntries(
          Object.keys(options.buildTarget.configurations ?? {}).map(
            (configurationName) => [
              configurationName,
              getBuildTargetMetadata(options.buildTarget, configurationName),
            ],
          ),
        );

  const patchedProjects = Object.fromEntries(
    Object.entries(result.projects).map(([projectKey, projectConfig]) => {
      const projectRoot = projectConfig.root ?? path.dirname(configFilePath);
      const projectName = getProjectNameFromPath(projectRoot, workspaceRoot);
      const buildTargetName =
        typeof options.buildTarget === "string"
          ? options.buildTarget
          : (options.buildTarget?.name ?? "docker:build");
      const targets = { ...(projectConfig.targets ?? {}) };

      if (targets[buildTargetName]) {
        targets[buildTargetName] = patchBuildTarget(
          workspaceRoot,
          projectRoot,
          projectName,
          configFilePath,
          targets[buildTargetName],
          dockerImageAuthors,
          baseBuildTargetMetadata,
          buildTargetConfigurationMetadata,
        );
      }

      targets[dockerReleasePublishTargetName] = {
        ...(targets[dockerReleasePublishTargetName] ?? {}),
        executor: "@pagopa/nx-dx-docker-plugin:release-publish",
      };

      if (shouldReplaceReleasePublishTarget(targets["nx-release-publish"])) {
        targets["nx-release-publish"] = {
          ...(targets["nx-release-publish"] ?? {}),
          executor: "@pagopa/nx-dx-docker-plugin:release-publish",
        };
      }

      return [
        projectKey,
        {
          ...projectConfig,
          targets,
        },
      ];
    }),
  );

  return {
    ...result,
    projects: patchedProjects,
  };
};

export const createNodesV2 = [
  baseCreateNodesV2[0],
  async (configFilePaths, rawOptions, context) => {
    const options = parseOptions(rawOptions);
    const baseOptions = {
      buildTarget: normalizeTargetForNx(
        stripMetadataFromBuildTarget(options.buildTarget),
        "docker:build",
      ),
      runTarget: normalizeTargetForNx(options.runTarget, "docker:run"),
    };

    const results = await baseCreateNodesV2[1](
      configFilePaths,
      baseOptions,
      context,
    );

    return results.map(([configFilePath, result]) => [
      configFilePath,
      patchProjects(result, configFilePath, options, context.workspaceRoot),
    ]);
  },
];

export default {
  createNodesV2,
};