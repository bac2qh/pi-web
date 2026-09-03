#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("node:child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { basename, isAbsolute } = require("node:path");

const EXPECTED_NODE_VERSION = "v22.23.2";
const EXPECTED_NPM_VERSION = "10.9.8";
const MAX_OBSERVED_VERSION_LENGTH = 32;
const MAX_ERROR_LENGTH = 512;
const LIFECYCLE_COMMANDS = new Set(["dev", "build", "start"]);
const PUBLIC_VERSION_PATTERN = /^v?\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,20})?$/u;

function sanitizeObservedVersion(value) {
  try {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_OBSERVED_VERSION_LENGTH ||
      !PUBLIC_VERSION_PATTERN.test(value)
    ) {
      return "unknown";
    }
    return value;
  } catch {
    return "unknown";
  }
}

function boundedError(message) {
  const error = new Error(message.length <= MAX_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_ERROR_LENGTH - 3)}...`);
  error.code = "pi_web_toolchain_mismatch";
  return error;
}

function assertNodeToolchain(nodeVersion) {
  if (nodeVersion === EXPECTED_NODE_VERSION) return;
  const observed = sanitizeObservedVersion(nodeVersion);
  throw boundedError(
    `[pi-web] Toolchain mismatch: expected Node ${EXPECTED_NODE_VERSION.slice(1)}; ` +
    `observed Node ${observed}. Run: mise exec -C <pi-web-root> node@22.23.2 -- ` +
    "node ./bin/pi-web.js",
  );
}

function assertLifecycleToolchain(command, nodeVersion, npmVersion) {
  if (!LIFECYCLE_COMMANDS.has(command)) {
    throw new Error("Unsupported Pi Web lifecycle preflight.");
  }
  if (nodeVersion === EXPECTED_NODE_VERSION && npmVersion === EXPECTED_NPM_VERSION) return;
  const observedNode = sanitizeObservedVersion(nodeVersion);
  const observedNpm = sanitizeObservedVersion(npmVersion);
  throw boundedError(
    `[pi-web] Toolchain mismatch: expected Node ${EXPECTED_NODE_VERSION.slice(1)} and ` +
    `npm ${EXPECTED_NPM_VERSION}; observed Node ${observedNode} and npm ${observedNpm}. ` +
    `Run: mise exec -C <pi-web-root> node@22.23.2 -- npm run ${command}`,
  );
}

function validatedNpmExecPath(value) {
  try {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 4096 ||
      !isAbsolute(value) ||
      basename(value) !== "npm-cli.js" ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function observeNpmVersion(options = {}) {
  try {
    const npmExecPath = validatedNpmExecPath(
      options.npmExecPath === undefined ? process.env.npm_execpath : options.npmExecPath,
    );
    if (!npmExecPath) return "unknown";
    const spawnNpm = options.spawnNpm ?? spawnSync;
    const nodeExecutable = options.nodeExecutable ?? process.execPath;
    const result = spawnNpm(nodeExecutable, [npmExecPath, "--version"], {
      encoding: "utf8",
      maxBuffer: 4096,
      shell: false,
      timeout: 5000,
      windowsHide: true,
    });
    if (result?.error || result?.status !== 0 || typeof result?.stdout !== "string") {
      return "unknown";
    }
    const output = result.stdout.endsWith("\r\n")
      ? result.stdout.slice(0, -2)
      : result.stdout.endsWith("\n")
        ? result.stdout.slice(0, -1)
        : result.stdout;
    return sanitizeObservedVersion(output);
  } catch {
    return "unknown";
  }
}

function runLifecyclePreflight(command, options = {}) {
  const nodeVersion = options.nodeVersion ?? process.version;
  const npmVersion = options.npmVersion ?? observeNpmVersion({
    nodeExecutable: options.nodeExecutable,
    npmExecPath: options.npmExecPath,
    spawnNpm: options.spawnNpm,
  });
  assertLifecycleToolchain(command, nodeVersion, npmVersion);
}

if (require.main === module) {
  try {
    runLifecyclePreflight(process.argv[2]);
  } catch (error) {
    const message = error?.code === "pi_web_toolchain_mismatch"
      ? error.message
      : "Pi Web lifecycle preflight failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_NODE_VERSION,
  EXPECTED_NPM_VERSION,
  MAX_ERROR_LENGTH,
  assertLifecycleToolchain,
  assertNodeToolchain,
  observeNpmVersion,
  runLifecyclePreflight,
  sanitizeObservedVersion,
};
