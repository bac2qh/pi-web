#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const SOURCE_COMMIT = "734502cb86eaf631e1ceeb403dbd717e3b78404f";
export const SOURCE_COMMIT_SHORT = "734502cb8";
export const OFFICIAL_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const FORK_PACKAGE_NAME = "@bac2qh/pi-coding-agent";
export const OFFICIAL_VERSION = "0.84.0";
export const OFFICIAL_AI_PACKAGE_NAME = "@earendil-works/pi-ai";
export const OFFICIAL_AI_INTEGRITY = "sha512-N9RDk8q0eglGiy+NqTZ3Ev2j+6oFNXSAJa8b0CYhvWB9HGiKZjsoCESXkUvMDLybrn0wXp75sdsoBzEtHxk9kA==";
export const FORK_VERSION = `0.84.0-bac2qh.${SOURCE_COMMIT_SHORT}`;
export const EXPECTED_NODE_VERSION = "v24.19.0";
export const EXPECTED_NPM_VERSION = "11.17.0";
export const FORK_REPOSITORY = Object.freeze({
  type: "git",
  url: "git+https://github.com/bac2qh/pi.git",
  directory: "packages/coding-agent",
});
export const ARTIFACT_FILE_NAME = `bac2qh-pi-coding-agent-${FORK_VERSION}.tgz`;
export const ARTIFACT_RELATIVE_TO_MAIN = join(
  "..",
  "pi",
  ".artifacts",
  "pi-web",
  SOURCE_COMMIT_SHORT,
  ARTIFACT_FILE_NAME,
);
export const MANIFEST_DEPENDENCY = `file:${ARTIFACT_RELATIVE_TO_MAIN.replaceAll(sep, "/")}`;

const scriptFile = fileURLToPath(import.meta.url);
const scriptProjectRoot = resolve(dirname(scriptFile), "..");
const STAGE_CHANGED_FILES = Object.freeze(["npm-shrinkwrap.json", "package.json"]);
const EXPECTED_CRLF_PATHS = Object.freeze(["pi-test.bat", "pi-test.ps1"]);

class LocalPiForkError extends Error {
  constructor(category, message) {
    super(`[${category}] ${message}`);
    this.name = "LocalPiForkError";
    this.category = category;
  }
}

function fail(category, message) {
  throw new LocalPiForkError(category, message);
}

function log(stage, message) {
  process.stdout.write(`[local-pi-fork] ${stage}: ${message}\n`);
}

function bounded(text, limit = 2000) {
  const value = String(text ?? "").trim();
  return value.length <= limit ? value : `…${value.slice(-limit)}`;
}

export function withGitReplacementProtection(environment = {}) {
  return { ...environment, GIT_NO_REPLACE_OBJECTS: "1" };
}

function run(command, args, options = {}) {
  if (options.stage) log(options.stage, options.message ?? `${command} ${args.join(" ")}`);
  const commandEnvironment = command === "git"
    ? withGitReplacementProtection(options.env ?? process.env)
    : options.env;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: commandEnvironment,
    encoding: "utf8",
    input: options.input,
    shell: false,
    stdio: options.capture
      ? [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
      : options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  });
  if (result.error) {
    fail(options.category ?? "command failure", `${command} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = options.capture ? bounded(result.stderr || result.stdout) : "see command output above";
    fail(
      options.category ?? "command failure",
      `${command} ${args.join(" ")} exited ${result.status ?? "without a status"}: ${detail}`,
    );
  }
  return options.capture ? String(result.stdout ?? "").trim() : "";
}

function readJson(path, category = "metadata mismatch") {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(category, `cannot read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function deepEqualJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha(buffer, algorithm, encoding = "hex") {
  return createHash(algorithm).update(buffer).digest(encoding);
}

function digestFile(path) {
  const bytes = readFileSync(path);
  return {
    bytes,
    size: bytes.length,
    sha256: sha(bytes, "sha256"),
    sha512: sha(bytes, "sha512", "base64"),
    integrity: `sha512-${sha(bytes, "sha512", "base64")}`,
  };
}

function parseOctal(buffer) {
  const text = buffer.toString("utf8").replaceAll("\0", "").trim();
  if (!text) return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail("artifact mismatch", `invalid tar size ${JSON.stringify(text)}`);
  return value;
}

function parsePax(buffer) {
  const values = {};
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number.parseInt(buffer.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > buffer.length) {
      fail("artifact mismatch", "invalid extended tar header");
    }
    const record = buffer.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

/** Read regular files from an npm-generated gzip tarball using Node standard library only. */
export function readTarballEntries(tarballPath) {
  let archive;
  try {
    archive = gunzipSync(readFileSync(tarballPath));
  } catch (error) {
    fail("artifact mismatch", `cannot decompress ${tarballPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries = new Map();
  let offset = 0;
  let nextPax = {};
  let nextLongName;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/su, "");
    const rawPrefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/su, "");
    const type = String.fromCharCode(header[156] || 0x30);
    const size = parseOctal(header.subarray(124, 136));
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > archive.length) fail("artifact mismatch", "truncated tar entry");
    const body = archive.subarray(bodyStart, bodyEnd);
    const defaultName = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;
    if (type === "x" || type === "g") {
      const parsed = parsePax(body);
      nextPax = type === "g" ? { ...nextPax, ...parsed } : parsed;
    } else if (type === "L") {
      nextLongName = body.toString("utf8").replace(/\0.*$/su, "").trimEnd();
    } else {
      const name = nextPax.path ?? nextLongName ?? defaultName;
      if ((type === "0" || type === "\0" || type === "") && name) entries.set(name, Buffer.from(body));
      nextPax = {};
      nextLongName = undefined;
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function parseTarballJson(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) fail("artifact mismatch", `tarball is missing ${path}`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("artifact mismatch", `${path} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertRepository(value) {
  if (!deepEqualJson(value, FORK_REPOSITORY)) {
    fail("overlay mismatch", `repository metadata must identify bac2qh/pi`);
  }
}

export function inspectForkArtifact(tarballPath) {
  if (!existsSync(tarballPath)) fail("artifact missing", `run node scripts/build-local-pi-fork.mjs to create ${tarballPath}`);
  const digest = digestFile(tarballPath);
  const entries = readTarballEntries(tarballPath);
  const packageJson = parseTarballJson(entries, "package/package.json");
  const shrinkwrap = parseTarballJson(entries, "package/npm-shrinkwrap.json");
  if (packageJson.name !== FORK_PACKAGE_NAME || packageJson.version !== FORK_VERSION) {
    fail("artifact mismatch", `package identity is ${packageJson.name}@${packageJson.version}, expected ${FORK_PACKAGE_NAME}@${FORK_VERSION}`);
  }
  assertRepository(packageJson.repository);
  if (packageJson.gitHead !== SOURCE_COMMIT) {
    fail("artifact mismatch", `gitHead must be ${SOURCE_COMMIT}`);
  }
  if (
    shrinkwrap.name !== FORK_PACKAGE_NAME ||
    shrinkwrap.version !== FORK_VERSION ||
    shrinkwrap.packages?.[""]?.name !== FORK_PACKAGE_NAME ||
    shrinkwrap.packages?.[""]?.version !== FORK_VERSION
  ) {
    fail("artifact mismatch", "npm-shrinkwrap root identity does not match the fork package");
  }
  const files = [...entries.keys()].sort();
  if (!files.some((path) => path.startsWith("package/dist/"))) fail("artifact mismatch", "tarball has no dist files");
  const agentSession = entries.get("package/dist/core/agent-session.js");
  if (!agentSession || !agentSession.toString("utf8").includes("_checkCompactionBetweenTurns")) {
    fail("artifact mismatch", "installed dist does not contain the fork between-turn compaction implementation");
  }
  return { ...digest, files, packageJson, shrinkwrap };
}

export function assertToolchain(nodeVersion, npmVersion, pathNodeVersion = nodeVersion) {
  if (nodeVersion !== EXPECTED_NODE_VERSION) {
    fail("toolchain mismatch", `Node ${EXPECTED_NODE_VERSION} is required; found ${nodeVersion}`);
  }
  if (pathNodeVersion !== EXPECTED_NODE_VERSION) {
    fail(
      "toolchain mismatch",
      `PATH-resolved Node ${EXPECTED_NODE_VERSION} is required for npm scripts; found ${pathNodeVersion}`,
    );
  }
  if (npmVersion !== EXPECTED_NPM_VERSION) {
    fail("toolchain mismatch", `npm ${EXPECTED_NPM_VERSION} is required; found ${npmVersion}`);
  }
}

function findMainProjectRoot(projectRoot) {
  const common = run("git", ["-C", projectRoot, "rev-parse", "--git-common-dir"], {
    capture: true,
    category: "project mismatch",
  });
  const commonDirectory = resolve(projectRoot, common);
  const mainRoot = basename(commonDirectory) === ".git" ? dirname(commonDirectory) : projectRoot;
  const manifest = readJson(join(mainRoot, "package.json"), "project mismatch");
  if (manifest.name !== "@agegr/pi-web") fail("project mismatch", `${mainRoot} is not the retained Pi Web main checkout`);
  return mainRoot;
}

function assertPathOutside(path, roots) {
  const resolvedPath = resolve(path);
  for (const root of roots) {
    const rel = relative(resolve(root), resolvedPath);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      fail("path mismatch", `disposable build path must be outside ${root}`);
    }
  }
}

export function canonicalPathWithExistingAncestor(path) {
  let existing = resolve(path);
  const suffix = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) fail("path mismatch", `cannot resolve an existing ancestor for ${path}`);
    suffix.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...suffix);
}

export function isExpectedForkOrigin(origin) {
  const value = String(origin).trim();
  return [
    /^https?:\/\/github\.com\/bac2qh\/pi(?:\.git)?$/u,
    /^git:\/\/github\.com\/bac2qh\/pi(?:\.git)?$/u,
    /^ssh:\/\/(?:git@)?github\.com\/bac2qh\/pi(?:\.git)?$/u,
    /^(?:git@)?github\.com:bac2qh\/pi(?:\.git)?$/u,
  ].some((pattern) => pattern.test(value));
}

function verifyForkCheckout(forkRoot) {
  if (!existsSync(join(forkRoot, ".git"))) fail("fork missing", `expected sibling bac2qh/pi checkout at ${forkRoot}`);
  const origin = run("git", ["-C", forkRoot, "remote", "get-url", "origin"], {
    capture: true,
    category: "fork mismatch",
  });
  if (!isExpectedForkOrigin(origin)) {
    fail("fork mismatch", `origin does not identify bac2qh/pi`);
  }
  run("git", ["-C", forkRoot, "cat-file", "-e", `${SOURCE_COMMIT}^{commit}`], {
    capture: true,
    category: "object missing",
  });
  const head = run("git", ["-C", forkRoot, "rev-parse", "HEAD"], { capture: true, category: "commit mismatch" });
  if (head !== SOURCE_COMMIT) fail("commit mismatch", `sibling fork HEAD is ${head}; expected ${SOURCE_COMMIT}`);
  const status = run("git", ["-C", forkRoot, "status", "--porcelain=v1", "--untracked-files=all"], {
    capture: true,
    category: "fork dirty",
  });
  if (status) fail("fork dirty", "sibling fork has tracked or untracked changes; preserve them and use a clean exact-commit checkout");
  const infoAttributes = run("git", ["-C", forkRoot, "rev-parse", "--git-path", "info/attributes"], {
    capture: true,
    category: "fork mismatch",
  });
  const infoAttributesPath = resolve(forkRoot, infoAttributes);
  if (existsSync(infoAttributesPath)) {
    const info = lstatSync(infoAttributesPath);
    if (!info.isFile() || info.isSymbolicLink() || readFileSync(infoAttributesPath).length !== 0) {
      fail("fork mismatch", "sibling fork .git/info/attributes must be absent or empty for exact checkout materialization");
    }
  }
  return run("git", ["-C", forkRoot, "show", "-s", "--format=%ct", SOURCE_COMMIT], {
    capture: true,
    category: "object missing",
  });
}

function findExecutableOnPath(name) {
  for (const directory of String(process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without invoking a shell.
    }
  }
  fail("toolchain mismatch", `cannot resolve ${name} on PATH`);
}

function verifyCurrentToolchain() {
  const pathNode = findExecutableOnPath("node");
  const pathNodeVersion = run(pathNode, ["--version"], { capture: true, category: "toolchain mismatch" });
  const npmVersion = run("npm", ["--version"], { capture: true, category: "toolchain mismatch" });
  assertToolchain(process.version, npmVersion, pathNodeVersion);
  return npmVersion;
}

function isolatedBuildEnvironment(runRoot, sourceEpoch) {
  const home = join(runRoot, "home");
  const agentDir = join(runRoot, "pi-agent");
  const npmCache = join(runRoot, "npm-cache");
  const npmUserConfig = join(runRoot, "npmrc");
  const temporary = join(runRoot, "tmp");
  for (const path of [home, agentDir, npmCache, temporary, join(runRoot, "xdg-config"), join(runRoot, "xdg-data")]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(npmUserConfig, "");
  const inherited = {};
  for (const key of ["PATH", "SHELL", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  return {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    LOGNAME: "pi-local-fork",
    USER: "pi-local-fork",
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    XDG_CONFIG_HOME: join(runRoot, "xdg-config"),
    XDG_CACHE_HOME: join(runRoot, "xdg-cache"),
    XDG_DATA_HOME: join(runRoot, "xdg-data"),
    PI_CODING_AGENT_DIR: agentDir,
    PI_NO_LOCAL_LLM: "1",
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    AWS_EC2_METADATA_DISABLED: "true",
    CI: "1",
    TZ: "UTC",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    SOURCE_DATE_EPOCH: sourceEpoch,
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
  };
}

function hydratePinnedModelData(sourceRoot, runRoot, env) {
  const destination = join(runRoot, "official-ai");
  mkdirSync(destination, { recursive: true });
  const output = run(
    "npm",
    ["pack", `${OFFICIAL_AI_PACKAGE_NAME}@${OFFICIAL_VERSION}`, "--ignore-scripts", "--json", "--pack-destination", destination],
    { env, capture: true, stage: "model data", message: `fetch immutable ${OFFICIAL_AI_PACKAGE_NAME}@${OFFICIAL_VERSION}`, category: "model data failure" },
  );
  let packed;
  try {
    packed = JSON.parse(output)?.[0];
  } catch {
    fail("model data failure", `npm pack returned invalid JSON: ${bounded(output)}`);
  }
  if (!packed?.filename) fail("model data failure", "npm pack did not report the official pi-ai tarball");
  const tarball = join(destination, packed.filename);
  const officialDigest = digestFile(tarball);
  if (officialDigest.integrity !== OFFICIAL_AI_INTEGRITY) {
    fail("model data failure", `official pi-ai 0.84.0 integrity ${officialDigest.integrity} does not match the pinned input`);
  }
  const entries = readTarballEntries(tarball);
  const packageJson = parseTarballJson(entries, "package/package.json");
  if (packageJson.name !== OFFICIAL_AI_PACKAGE_NAME || packageJson.version !== OFFICIAL_VERSION) {
    fail("model data failure", `registry artifact is ${packageJson.name}@${packageJson.version}, expected ${OFFICIAL_AI_PACKAGE_NAME}@${OFFICIAL_VERSION}`);
  }
  const prefix = "package/dist/providers/data/";
  const dataEntries = [...entries].filter(([path]) => path.startsWith(prefix));
  if (!dataEntries.some(([path]) => path === `${prefix}.manifest.json`) || dataEntries.length < 2) {
    fail("model data failure", "official pi-ai artifact has no validated generated model-data set");
  }
  const dataDirectory = join(sourceRoot, "packages", "ai", "src", "providers", "data");
  rmSync(dataDirectory, { recursive: true, force: true });
  mkdirSync(dataDirectory, { recursive: true });
  for (const [path, bytes] of dataEntries) {
    const relativePath = path.slice(prefix.length);
    if (!relativePath || relativePath.includes("/") || relativePath === "." || relativePath === "..") {
      fail("model data failure", `unexpected model-data archive path ${path}`);
    }
    writeFileSync(join(dataDirectory, relativePath), bytes, { mode: 0o644 });
  }
  return { tarball, files: dataEntries.map(([path]) => path).sort() };
}

function verifyMaterializedSource(sourceRoot) {
  const attributesEnv = { ...process.env, GIT_ATTR_NOSYSTEM: "1" };
  const listing = run("git", ["-C", sourceRoot, "ls-tree", "-r", "-z", "--full-tree", SOURCE_COMMIT], {
    capture: true,
    category: "source materialization failure",
  });
  const entries = listing.split("\0").filter(Boolean).map((record) => {
    const match = /^(\d{6}) (\S+) ([0-9a-f]{40,64})\t([\s\S]+)$/u.exec(record);
    if (!match || match[2] !== "blob") {
      fail("source materialization failure", "exact source tree contains an unsupported Git entry");
    }
    const [, mode, , object, path] = match;
    if (path.includes("\n") || path.includes("\r")) {
      fail("source materialization failure", "exact source tree contains a newline-bearing path");
    }
    return { mode, object, path };
  });
  if (entries.length === 0) fail("source materialization failure", "exact source tree contains no tracked files");
  const pathInput = `${entries.map(({ path }) => path).join("\n")}\n`;
  const actual = run("git", ["-C", sourceRoot, "hash-object", "--no-filters", "--stdin-paths"], {
    capture: true,
    input: pathInput,
    category: "source materialization failure",
  }).split("\n");
  const filtered = run(
    "git",
    ["-c", "core.attributesFile=/dev/null", "-C", sourceRoot, "hash-object", "--stdin-paths"],
    {
      capture: true,
      env: attributesEnv,
      input: pathInput,
      category: "source materialization failure",
    },
  ).split("\n");
  const attributeLines = run(
    "git",
    [
      "-c",
      "core.attributesFile=/dev/null",
      "-C",
      sourceRoot,
      "check-attr",
      "--stdin",
      "filter",
      "ident",
      "eol",
      "working-tree-encoding",
    ],
    {
      capture: true,
      env: attributesEnv,
      input: pathInput,
      category: "source materialization failure",
    },
  ).split("\n");
  if (
    actual.length !== entries.length ||
    filtered.length !== entries.length ||
    attributeLines.length !== entries.length * 4
  ) {
    fail("source materialization failure", "materialized file or attribute count does not match the exact Git tree");
  }
  const crlfPaths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const attributeOffset = index * 4;
    const expectedAttributeLines = [
      `${entry.path}: filter: unspecified`,
      `${entry.path}: ident: unspecified`,
      `${entry.path}: working-tree-encoding: unspecified`,
    ];
    if (
      attributeLines[attributeOffset] !== expectedAttributeLines[0] ||
      attributeLines[attributeOffset + 1] !== expectedAttributeLines[1] ||
      attributeLines[attributeOffset + 3] !== expectedAttributeLines[2]
    ) {
      fail("source materialization failure", `unsupported checkout attributes apply to ${entry.path}`);
    }
    const eolPrefix = `${entry.path}: eol: `;
    if (!attributeLines[attributeOffset + 2].startsWith(eolPrefix)) {
      fail("source materialization failure", `cannot determine checkout EOL policy for ${entry.path}`);
    }
    const eol = attributeLines[attributeOffset + 2].slice(eolPrefix.length);
    if (eol === "crlf") crlfPaths.push(entry.path);
    else if (eol !== "lf" && eol !== "unspecified") {
      fail("source materialization failure", `unsupported checkout EOL policy applies to ${entry.path}`);
    }

    const info = lstatSync(join(sourceRoot, entry.path));
    if (!info.isFile() || info.isSymbolicLink() || !["100644", "100755"].includes(entry.mode)) {
      fail("source materialization failure", `unsupported materialized file type or Git mode at ${entry.path}`);
    }
    const executable = (info.mode & 0o111) !== 0;
    if (executable !== (entry.mode === "100755")) {
      fail("source materialization failure", `materialized executable mode differs from Git at ${entry.path}`);
    }

    if (actual[index] === entry.object) continue;
    if (eol !== "crlf" || filtered[index] !== entry.object) {
      fail(
        "source materialization failure",
        `materialized bytes differ from the Git object at ${entry.path}`,
      );
    }
  }
  if (!deepEqualJson(crlfPaths.sort(), [...EXPECTED_CRLF_PATHS].sort())) {
    fail("source materialization failure", `declared CRLF checkout paths are ${crlfPaths.join(", ") || "missing"}`);
  }
  return { files: entries.length, normalizedEolFiles: crlfPaths.length };
}

function createPinnedNpmPath(runRoot, realNpm, originalPath) {
  if (process.platform === "win32") fail("toolchain mismatch", "the pinned npm command shim is not implemented on Windows");
  const shimDirectory = join(runRoot, "command-shim");
  mkdirSync(shimDirectory, { recursive: true });
  const shim = join(shimDirectory, "npm");
  const source = `#!/usr/bin/env node\nimport { spawnSync } from "node:child_process";\nconst args = process.argv.slice(2);\nif (args.length === 2 && args[0] === "run" && args[1] === "generate:models") {\n  console.log("Using pinned generated model data from @earendil-works/pi-ai@0.84.0");\n  process.exit(0);\n}\nconst result = spawnSync(${JSON.stringify(realNpm)}, args, { stdio: "inherit", env: { ...process.env, PATH: ${JSON.stringify(originalPath)} } });\nif (result.error) { console.error(result.error.message); process.exit(1); }\nprocess.exit(result.status ?? 1);\n`;
  writeFileSync(shim, source, { mode: 0o755 });
  return `${shimDirectory}${delimiter}${originalPath}`;
}

function copyPackageStage(sourcePackage, stage) {
  cpSync(sourcePackage, stage, {
    recursive: true,
    filter(path) {
      const name = basename(path);
      return name !== "node_modules" && name !== ".git";
    },
  });
}

function snapshotTree(root) {
  const snapshot = new Map();
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const rel = relative(root, path).replaceAll(sep, "/");
      const info = lstatSync(path);
      if (info.isDirectory()) {
        snapshot.set(rel, `directory:${info.mode & 0o777}`);
        walk(path);
      } else if (info.isSymbolicLink()) {
        snapshot.set(rel, `symlink:${readlinkSync(path)}`);
      } else if (info.isFile()) {
        snapshot.set(rel, `file:${info.mode & 0o777}:${sha(readFileSync(path), "sha256")}`);
      } else {
        fail("staging mismatch", `unsupported stage entry ${rel}`);
      }
    }
  };
  walk(root);
  return snapshot;
}

function changedTreePaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

export function applyIdentityOverlay(stage) {
  const packagePath = join(stage, "package.json");
  const shrinkwrapPath = join(stage, "npm-shrinkwrap.json");
  const originalPackage = readJson(packagePath);
  const originalShrinkwrap = readJson(shrinkwrapPath);
  if (originalPackage.name !== OFFICIAL_PACKAGE_NAME || originalPackage.version !== OFFICIAL_VERSION) {
    fail("overlay mismatch", `built target is ${originalPackage.name}@${originalPackage.version}, expected ${OFFICIAL_PACKAGE_NAME}@${OFFICIAL_VERSION}`);
  }
  if (
    originalShrinkwrap.name !== OFFICIAL_PACKAGE_NAME ||
    originalShrinkwrap.version !== OFFICIAL_VERSION ||
    originalShrinkwrap.packages?.[""]?.name !== OFFICIAL_PACKAGE_NAME ||
    originalShrinkwrap.packages?.[""]?.version !== OFFICIAL_VERSION
  ) {
    fail("overlay mismatch", "built target shrinkwrap root is not the official 0.84.0 identity");
  }

  const expectedPackage = structuredClone(originalPackage);
  expectedPackage.name = FORK_PACKAGE_NAME;
  expectedPackage.version = FORK_VERSION;
  expectedPackage.repository = structuredClone(FORK_REPOSITORY);
  expectedPackage.gitHead = SOURCE_COMMIT;

  const expectedShrinkwrap = structuredClone(originalShrinkwrap);
  expectedShrinkwrap.name = FORK_PACKAGE_NAME;
  expectedShrinkwrap.version = FORK_VERSION;
  expectedShrinkwrap.packages[""].name = FORK_PACKAGE_NAME;
  expectedShrinkwrap.packages[""].version = FORK_VERSION;

  writeJson(packagePath, expectedPackage);
  writeJson(shrinkwrapPath, expectedShrinkwrap);

  const actualPackage = readJson(packagePath);
  const actualShrinkwrap = readJson(shrinkwrapPath);
  if (!deepEqualJson(actualPackage, expectedPackage) || !deepEqualJson(actualShrinkwrap, expectedShrinkwrap)) {
    fail("overlay mismatch", "identity overlay changed undeclared metadata");
  }
  const packageDependencies = structuredClone(originalPackage.dependencies ?? {});
  const shrinkwrapDependencies = structuredClone(originalShrinkwrap.packages?.[""]?.dependencies ?? {});
  if (
    !deepEqualJson(actualPackage.dependencies ?? {}, packageDependencies) ||
    !deepEqualJson(actualShrinkwrap.packages?.[""]?.dependencies ?? {}, shrinkwrapDependencies)
  ) {
    fail("overlay mismatch", "identity overlay changed runtime dependency ranges");
  }
  return { originalPackage, originalShrinkwrap, expectedPackage, expectedShrinkwrap };
}

function pack(directory, destination, env, stage) {
  mkdirSync(destination, { recursive: true });
  const output = run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: directory, env, capture: true, stage, category: "pack failure" },
  );
  let result;
  try {
    result = JSON.parse(output)?.[0];
  } catch {
    fail("pack failure", `npm pack returned invalid JSON: ${bounded(output)}`);
  }
  if (!result?.filename) fail("pack failure", "npm pack did not report a tarball filename");
  return { path: join(destination, result.filename), result };
}

function locateOfficialCodingAgentTarball(tarballDirectory) {
  const expected = join(tarballDirectory, "earendil-works-pi-coding-agent-0.84.0.tgz");
  if (!existsSync(expected)) fail("build failure", `fork local-release did not create ${expected}`);
  return expected;
}

function assertOfficialArtifact(path) {
  const entries = readTarballEntries(path);
  const packageJson = parseTarballJson(entries, "package/package.json");
  const shrinkwrap = parseTarballJson(entries, "package/npm-shrinkwrap.json");
  if (
    packageJson.name !== OFFICIAL_PACKAGE_NAME ||
    packageJson.version !== OFFICIAL_VERSION ||
    shrinkwrap.name !== OFFICIAL_PACKAGE_NAME ||
    shrinkwrap.version !== OFFICIAL_VERSION
  ) {
    fail("build failure", "fork local-release coding-agent tarball has unexpected official build identity");
  }
  if (!entries.has("package/dist/core/agent-session.js")) fail("build failure", "fork local-release coding-agent tarball has no built agent session");
}

function buildOnce({ forkRoot, parentRoot, sourceEpoch, index }) {
  const runRoot = join(parentRoot, `build-${index}`);
  const sourceRoot = join(runRoot, "source");
  const releaseRoot = join(runRoot, "release");
  const stage = join(runRoot, "stage");
  const referencePack = join(runRoot, "reference-pack");
  const finalPack = join(runRoot, "final-pack");
  mkdirSync(runRoot, { recursive: true });
  assertPathOutside(runRoot, [forkRoot, scriptProjectRoot]);
  const env = isolatedBuildEnvironment(runRoot, sourceEpoch);
  const realNpm = findExecutableOnPath("npm");
  let worktreeAttempted = false;
  let primaryError;
  try {
    const disabledHooks = join(runRoot, "disabled-git-hooks");
    mkdirSync(disabledHooks, { recursive: true });
    worktreeAttempted = true;
    run(
      "git",
      [
        "-c",
        `core.hooksPath=${disabledHooks}`,
        "-c",
        "core.attributesFile=/dev/null",
        "-C",
        forkRoot,
        "worktree",
        "add",
        "--detach",
        sourceRoot,
        SOURCE_COMMIT,
      ],
      {
        capture: true,
        env: { ...process.env, GIT_ATTR_NOSYSTEM: "1" },
        stage: `build ${index}`,
        message: "materialize exact-commit source with checkout hooks and external attributes disabled",
        category: "source materialization failure",
      },
    );
    const head = run("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { capture: true, category: "commit mismatch" });
    if (head !== SOURCE_COMMIT) fail("commit mismatch", `materialized source is ${head}, expected ${SOURCE_COMMIT}`);
    const initialStatus = run("git", ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=all"], {
      capture: true,
      category: "source materialization failure",
    });
    if (initialStatus) fail("source materialization failure", "fresh exact-commit worktree is not clean");
    const materialized = verifyMaterializedSource(sourceRoot);
    log(
      `build ${index}`,
      `verified ${materialized.files} tracked files against exact Git objects (${materialized.normalizedEolFiles} declared CRLF checkouts)`,
    );

    run("npm", ["ci", "--ignore-scripts"], {
      cwd: sourceRoot,
      env,
      stage: `build ${index}`,
      message: "hydrate exact source with scripts disabled",
      category: "hydrate failure",
    });
    const pinnedModelData = hydratePinnedModelData(sourceRoot, runRoot, env);
    log(`build ${index}`, `hydrated ${pinnedModelData.files.length} generated model-data files from official pi-ai 0.84.0`);
    const releaseEnv = { ...env, PATH: createPinnedNpmPath(runRoot, realNpm, env.PATH) };
    run(process.execPath, ["scripts/local-release.mjs", "--out", releaseRoot, "--skip-install", "--skip-bun-install"], {
      cwd: sourceRoot,
      env: releaseEnv,
      stage: `build ${index}`,
      message: "run fork checks, tests, builds, and local-release packing",
      category: "fork validation failure",
    });
    // npm ci intentionally runs with lifecycle scripts disabled. The fork release
    // path hydrates the checked model data before its own full suite, after which
    // this explicit focused rerun can load the faux-provider harness.
    run("npm", ["exec", "--", "vitest", "--run", "test/suite/agent-session-between-turn-compaction.test.ts"], {
      cwd: join(sourceRoot, "packages", "coding-agent"),
      env: releaseEnv,
      stage: `build ${index}`,
      message: "rerun focused faux-provider between-turn compaction regression",
      category: "focused regression failure",
    });

    const sourceDiff = run("git", ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=no"], {
      capture: true,
      category: "source mutation",
    });
    if (sourceDiff) fail("source mutation", "fork validation changed tracked exact-commit source");
    verifyMaterializedSource(sourceRoot);

    const officialTarball = locateOfficialCodingAgentTarball(join(releaseRoot, "tarballs"));
    assertOfficialArtifact(officialTarball);
    copyPackageStage(join(sourceRoot, "packages", "coding-agent"), stage);
    const reference = pack(stage, referencePack, releaseEnv, `build ${index} reference pack`);
    if (!digestFile(reference.path).bytes.equals(digestFile(officialTarball).bytes)) {
      fail("staging mismatch", "fresh packaging stage does not reproduce the fork local-release coding-agent tarball");
    }

    const before = snapshotTree(stage);
    applyIdentityOverlay(stage);
    const after = snapshotTree(stage);
    const changed = changedTreePaths(before, after);
    if (!deepEqualJson(changed, STAGE_CHANGED_FILES)) {
      fail("staging mismatch", `metadata overlay changed ${changed.join(", ") || "no declared files"}`);
    }

    const packed = pack(stage, finalPack, releaseEnv, `build ${index} fork pack`);
    if (basename(packed.path) !== ARTIFACT_FILE_NAME) {
      fail("pack failure", `npm produced ${basename(packed.path)}, expected ${ARTIFACT_FILE_NAME}`);
    }
    const inspection = inspectForkArtifact(packed.path);
    if (packed.result.integrity && packed.result.integrity !== inspection.integrity) {
      fail("artifact mismatch", "npm pack integrity does not match independently computed SHA-512");
    }
    return { path: packed.path, inspection, changed };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (worktreeAttempted) {
      try {
        const canonicalSourceRoot = canonicalPathWithExistingAncestor(sourceRoot);
        const registered = run("git", ["-C", forkRoot, "worktree", "list", "--porcelain"], {
          capture: true,
          category: "cleanup failure",
        }).split("\n").find(
          (line) => line.startsWith("worktree ") &&
            canonicalPathWithExistingAncestor(line.slice(9)) === canonicalSourceRoot,
        )?.slice(9);
        if (registered) {
          run("git", ["-C", forkRoot, "worktree", "remove", "--force", registered], {
            capture: true,
            category: "cleanup failure",
          });
        } else {
          rmSync(sourceRoot, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
        process.stderr.write(`[local-pi-fork] cleanup warning: ${bounded(cleanupError instanceof Error ? cleanupError.message : cleanupError)}\n`);
      }
    }
  }
}

export function expectedLockIntegrity(projectRoot, options = {}) {
  const lockPath = join(projectRoot, "package-lock.json");
  if (!existsSync(lockPath)) {
    if (options.required) fail("lock mismatch", `${lockPath} is required for artifact verification`);
    return null;
  }
  const lock = readJson(lockPath, "lock mismatch");
  const rootSpec = lock.packages?.[""]?.dependencies?.[OFFICIAL_PACKAGE_NAME];
  if (rootSpec !== MANIFEST_DEPENDENCY) {
    if (options.required) fail("lock mismatch", "package-lock root does not adopt the approved local fork artifact");
    return null;
  }
  const installed = lock.packages?.[`node_modules/${OFFICIAL_PACKAGE_NAME}`];
  if (
    installed?.name !== FORK_PACKAGE_NAME ||
    installed?.version !== FORK_VERSION ||
    installed?.resolved !== MANIFEST_DEPENDENCY ||
    typeof installed?.integrity !== "string"
  ) {
    fail("lock mismatch", "adopted package-lock entry does not pin the local fork identity, file path, and integrity");
  }
  return installed.integrity;
}

export function assertExpectedIntegrity(actualIntegrity, expectedIntegrity) {
  if (expectedIntegrity && actualIntegrity !== expectedIntegrity) {
    fail("digest mismatch", `rebuilt artifact integrity ${actualIntegrity} does not match package-lock ${expectedIntegrity}`);
  }
}

function ensureArtifactParent(forkRoot, destination) {
  const relativeDestination = relative(resolve(forkRoot), resolve(destination));
  if (!relativeDestination || relativeDestination.startsWith("..") || isAbsolute(relativeDestination)) {
    fail("path mismatch", "artifact destination must remain beneath the sibling fork root");
  }
  const parent = dirname(destination);
  const relativeParent = relative(resolve(forkRoot), resolve(parent));
  let current = resolve(forkRoot);
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink()) fail("path mismatch", `artifact path component is a symlink: ${current}`);
      if (!info.isDirectory()) fail("path mismatch", `artifact path component is not a directory: ${current}`);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
      try {
        mkdirSync(current);
      } catch (mkdirError) {
        if (!(mkdirError instanceof Error) || mkdirError.code !== "EEXIST") throw mkdirError;
      }
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        fail("path mismatch", `artifact path component could not be created safely: ${current}`);
      }
    }
  }
  const canonicalFork = realpathSync(forkRoot);
  const canonicalParent = realpathSync(parent);
  const canonicalRelative = relative(canonicalFork, canonicalParent);
  if (canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
    fail("path mismatch", "canonical artifact parent escaped the sibling fork root");
  }
  return parent;
}

function existingArtifactDigest(destination) {
  try {
    const info = lstatSync(destination);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail("artifact mismatch", `existing artifact path is not a regular file: ${destination}`);
    }
    return digestFile(destination);
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function publishArtifact(source, destination, forkRoot) {
  const parent = ensureArtifactParent(forkRoot, destination);
  const sourceDigest = digestFile(source);
  const current = existingArtifactDigest(destination);
  if (current) {
    if (!current.bytes.equals(sourceDigest.bytes)) {
      fail("artifact mismatch", `existing ${destination} differs; preserve or remove that exact stale file before rebuilding`);
    }
    return "already-current";
  }
  const temporary = join(parent, `.${basename(destination)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    copyFileSync(source, temporary, fsConstants.COPYFILE_EXCL);
    if (!digestFile(temporary).bytes.equals(sourceDigest.bytes)) fail("artifact mismatch", "temporary publication copy changed bytes");
    try {
      linkSync(temporary, destination);
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "EEXIST") throw error;
      const raced = existingArtifactDigest(destination);
      if (!raced || !raced.bytes.equals(sourceDigest.bytes)) {
        fail("artifact mismatch", `concurrently published ${destination} differs from the verified artifact`);
      }
      return "already-current";
    }
    const canonicalParent = realpathSync(parent);
    const canonicalFork = realpathSync(forkRoot);
    const canonicalRelative = relative(canonicalFork, canonicalParent);
    if (canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)) {
      fail("path mismatch", "artifact parent changed during publication");
    }
    return "published";
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function parseArguments(args) {
  const options = { keepTemporary: false, verifyOnly: false };
  for (const arg of args) {
    if (arg === "--keep-temporary") options.keepTemporary = true;
    else if (arg === "--verify-only") options.verifyOnly = true;
    else if (arg === "--help") options.help = true;
    else fail("argument error", `unknown option ${arg}`);
  }
  return options;
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/build-local-pi-fork.mjs [--verify-only] [--keep-temporary]\n\n`);
  process.stdout.write(`Builds ${FORK_PACKAGE_NAME}@${FORK_VERSION} twice from the exact sibling bac2qh/pi commit,\n`);
  process.stdout.write(`requires byte-identical archives, and publishes ${ARTIFACT_RELATIVE_TO_MAIN}.\n`);
}

export function resolveWorkflowPaths(projectRoot = scriptProjectRoot) {
  const mainRoot = findMainProjectRoot(projectRoot);
  const forkRoot = resolve(mainRoot, "..", "pi");
  const artifact = resolve(mainRoot, ARTIFACT_RELATIVE_TO_MAIN);
  return { projectRoot, mainRoot, forkRoot, artifact };
}

export function verifyExistingWorkflowArtifact(projectRoot = scriptProjectRoot) {
  const paths = resolveWorkflowPaths(projectRoot);
  verifyCurrentToolchain();
  verifyForkCheckout(paths.forkRoot);
  const inspection = inspectForkArtifact(paths.artifact);
  assertExpectedIntegrity(inspection.integrity, expectedLockIntegrity(paths.mainRoot, { required: true }));
  log("verify", `${FORK_PACKAGE_NAME}@${FORK_VERSION}; sha256=${inspection.sha256}; files=${inspection.files.length}`);
  return { ...paths, inspection };
}

export function buildLocalPiFork(projectRoot = scriptProjectRoot, options = {}) {
  const paths = resolveWorkflowPaths(projectRoot);
  const npmVersion = verifyCurrentToolchain();
  const sourceEpoch = verifyForkCheckout(paths.forkRoot);
  if (options.verifyOnly) {
    const inspection = inspectForkArtifact(paths.artifact);
    assertExpectedIntegrity(inspection.integrity, expectedLockIntegrity(paths.mainRoot, { required: true }));
    log("verify", `${FORK_PACKAGE_NAME}@${FORK_VERSION}; sha256=${inspection.sha256}; files=${inspection.files.length}`);
    return { ...paths, inspection, outcome: "verified" };
  }

  // Keep the disposable root short: the fork suite exercises Unix sockets
  // (103-byte path ceiling on macOS) and width-sensitive rendered paths.
  const disposableParent = process.platform === "win32" ? tmpdir() : "/tmp";
  const parentRoot = mkdtempSync(join(disposableParent, `piwpf-${SOURCE_COMMIT_SHORT}-`));
  assertPathOutside(parentRoot, [paths.mainRoot, paths.forkRoot]);
  log("preflight", `exact commit ${SOURCE_COMMIT}, Node ${process.version}, npm ${npmVersion}`);
  let success = false;
  try {
    const first = buildOnce({ forkRoot: paths.forkRoot, parentRoot, sourceEpoch, index: 1 });
    const second = buildOnce({ forkRoot: paths.forkRoot, parentRoot, sourceEpoch, index: 2 });
    if (!first.inspection.bytes.equals(second.inspection.bytes)) {
      fail(
        "reproducibility mismatch",
        `independent archives differ (sha256 ${first.inspection.sha256} versus ${second.inspection.sha256})`,
      );
    }
    if (!deepEqualJson(first.inspection.files, second.inspection.files)) {
      fail("reproducibility mismatch", "independent packed file manifests differ");
    }
    const expectedIntegrity = expectedLockIntegrity(paths.mainRoot);
    assertExpectedIntegrity(first.inspection.integrity, expectedIntegrity);
    const outcome = publishArtifact(first.path, paths.artifact, paths.forkRoot);
    const published = inspectForkArtifact(paths.artifact);
    assertExpectedIntegrity(published.integrity, expectedIntegrity);
    if (!published.bytes.equals(first.inspection.bytes)) fail("artifact mismatch", "published artifact bytes changed");
    success = true;
    log("complete", `${outcome}; sha256=${published.sha256}; integrity=${published.integrity}; files=${published.files.length}`);
    return { ...paths, inspection: published, outcome };
  } finally {
    if (!options.keepTemporary) rmSync(parentRoot, { recursive: true, force: true });
    else log("temporary state", parentRoot);
    if (!success && !options.keepTemporary) log("cleanup", "removed task-owned temporary build state");
  }
}

const directInvocation = process.argv[1] && resolve(process.argv[1]) === resolve(scriptFile);
if (directInvocation) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) printUsage();
    else buildLocalPiFork(scriptProjectRoot, options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
