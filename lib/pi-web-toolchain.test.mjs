import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  EXPECTED_NODE_VERSION,
  EXPECTED_NPM_VERSION,
  MAX_ERROR_LENGTH,
  assertLifecycleToolchain,
  assertNodeToolchain,
  observeNpmVersion,
  runLifecyclePreflight,
  sanitizeObservedVersion,
} = require("../bin/pi-web-toolchain.js");

const PROJECT_ROOT = join(import.meta.dirname, "..");

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  assert.fail("expected callback to throw");
}

test("ordinary toolchain constants and repository declarations are exact", () => {
  assert.equal(EXPECTED_NODE_VERSION, "v22.23.2");
  assert.equal(EXPECTED_NPM_VERSION, "10.9.8");
  assert.equal(readFileSync(join(PROJECT_ROOT, "mise.toml"), "utf8"), '[tools]\nnode = "22.23.2"\n');

  const manifest = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8"));
  assert.equal(manifest.packageManager, "npm@10.9.8");
  assert.equal(manifest.scripts.predev, "node bin/pi-web-toolchain.js dev");
  assert.equal(manifest.scripts.prebuild, "node bin/pi-web-toolchain.js build");
  assert.equal(manifest.scripts.prestart, "node bin/pi-web-toolchain.js start");
  assert.equal(manifest.scripts["build:local-pi-fork"], "node scripts/build-local-pi-fork.mjs");
  assert.equal(
    manifest.scripts["install:local-pi-fork"],
    "node scripts/build-local-pi-fork.mjs --verify-only && npm ci --ignore-scripts --include=dev",
  );
  assert.equal(manifest.scripts["prebuild:local-pi-fork"], undefined);
  assert.equal(manifest.scripts["preinstall:local-pi-fork"], undefined);
});

test("observed versions are either short printable public versions or unknown", () => {
  assert.equal(sanitizeObservedVersion("v22.23.2"), "v22.23.2");
  assert.equal(sanitizeObservedVersion("10.9.8"), "10.9.8");
  for (const value of [
    undefined,
    null,
    22,
    "",
    " 10.9.8",
    "10.9.8 ",
    "10.9.8\nprivate",
    "10.9.8\u001b[31m",
    "版本10.9.8",
    "1".repeat(33),
    "private/path",
  ]) {
    assert.equal(sanitizeObservedVersion(value), "unknown");
  }
  assert.equal(
    sanitizeObservedVersion({ get length() { throw new Error("private getter"); } }),
    "unknown",
  );
});

test("direct and lifecycle assertions accept only the exact approved versions", () => {
  assert.doesNotThrow(() => assertNodeToolchain(EXPECTED_NODE_VERSION));
  assert.doesNotThrow(() => {
    assertLifecycleToolchain("dev", EXPECTED_NODE_VERSION, EXPECTED_NPM_VERSION);
    assertLifecycleToolchain("build", EXPECTED_NODE_VERSION, EXPECTED_NPM_VERSION);
    assertLifecycleToolchain("start", EXPECTED_NODE_VERSION, EXPECTED_NPM_VERSION);
  });
  assert.throws(
    () => assertLifecycleToolchain("release", EXPECTED_NODE_VERSION, EXPECTED_NPM_VERSION),
    /Unsupported Pi Web lifecycle preflight/u,
  );
});

test("direct mismatch errors are fixed, bounded, and omit arbitrary launch arguments", () => {
  const error = captureError(() => assertNodeToolchain("v24.20.0"));
  assert.equal(error.code, "pi_web_toolchain_mismatch");
  assert.equal(
    error.message,
    "[pi-web] Toolchain mismatch: expected Node 22.23.2; observed Node v24.20.0. " +
      "Run: mise exec -C <pi-web-root> node@22.23.2 -- node ./bin/pi-web.js",
  );
  assert.ok(error.message.length <= MAX_ERROR_LENGTH);
  assert.equal(error.message.includes("--tailscale-serve"), false);

  const malformed = captureError(() => assertNodeToolchain("x".repeat(10_000)));
  assert.match(malformed.message, /observed Node unknown/u);
  assert.ok(malformed.message.length <= MAX_ERROR_LENGTH);
});

test("lifecycle mismatch errors use only fixed command identities and sanitized versions", () => {
  for (const command of ["dev", "build", "start"]) {
    const error = captureError(() => assertLifecycleToolchain(
      command,
      "v24.20.0\nprivate",
      "private/path/" + "x".repeat(10_000),
    ));
    assert.equal(error.code, "pi_web_toolchain_mismatch");
    assert.equal(
      error.message,
      `[pi-web] Toolchain mismatch: expected Node 22.23.2 and npm 10.9.8; ` +
        `observed Node unknown and npm unknown. Run: ` +
        `mise exec -C <pi-web-root> node@22.23.2 -- npm run ${command}`,
    );
    assert.ok(error.message.length <= MAX_ERROR_LENGTH);
    assert.equal(error.message.includes("private"), false);
  }
});

test("npm observation executes the invoking CLI with the current Node and rejects malformed output", () => {
  const npmExecPath = join(tmpdir(), "synthetic-npm", "bin", "npm-cli.js");
  const calls = [];
  const observe = (result) => observeNpmVersion({
    npmExecPath,
    spawnNpm(command, args, options) {
      calls.push({ command, args, options });
      if (result instanceof Error) throw result;
      return result;
    },
  });

  assert.equal(observe({ status: 0, stdout: "10.9.8\n", stderr: "private diagnostic" }), EXPECTED_NPM_VERSION);
  assert.deepEqual(calls, [{
    command: process.execPath,
    args: [npmExecPath, "--version"],
    options: {
      encoding: "utf8",
      maxBuffer: 4096,
      shell: false,
      timeout: 5000,
      windowsHide: true,
    },
  }]);

  calls.length = 0;
  assert.equal(observe({ status: 0, stdout: "10.9.8\r\n" }), "10.9.8");
  assert.equal(observe({ status: 0, stdout: "10.9.8" }), "10.9.8");
  assert.equal(observe({ status: 1, stdout: "10.9.8\n" }), "unknown");
  assert.equal(observe({ status: 0, stdout: "10.9.8\nextra\n" }), "unknown");
  assert.equal(observe({ error: new Error("private"), status: null, stdout: "" }), "unknown");
  assert.equal(observe(new Error("private")), "unknown");

  let invalidPathSpawns = 0;
  for (const invalidPath of [
    null,
    "npm",
    join(tmpdir(), "not-npm.js"),
    `${npmExecPath}\nprivate`,
    `/${"x".repeat(4097)}/npm-cli.js`,
  ]) {
    assert.equal(observeNpmVersion({
      npmExecPath: invalidPath,
      spawnNpm: () => {
        invalidPathSpawns += 1;
        return { status: 0, stdout: "10.9.8\n" };
      },
    }), "unknown");
  }
  assert.equal(invalidPathSpawns, 0);
});

test("lifecycle preflight binds to the invoking npm instead of a different PATH npm", () => {
  const npmExecPath = join(tmpdir(), "invoking-npm-11", "bin", "npm-cli.js");
  let probes = 0;
  assert.doesNotThrow(() => runLifecyclePreflight("dev", {
    nodeVersion: EXPECTED_NODE_VERSION,
    npmExecPath,
    spawnNpm: (command, args) => {
      probes += 1;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [npmExecPath, "--version"]);
      return { status: 0, stdout: `${EXPECTED_NPM_VERSION}\n` };
    },
  }));
  assert.equal(probes, 1);

  const error = captureError(() => runLifecyclePreflight("start", {
    nodeVersion: EXPECTED_NODE_VERSION,
    npmExecPath,
    spawnNpm: (command, args) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [npmExecPath, "--version"]);
      return { status: 0, stdout: "11.19.0\n" };
    },
  }));
  assert.match(error.message, /observed Node v22\.23\.2 and npm 11\.19\.0/u);
  assert.match(error.message, /npm run start$/u);
});

test("terminal entry rejects a wrong runtime before installing signal listeners", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-toolchain-entry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preload = join(directory, "wrong-runtime.cjs");
  writeFileSync(preload, String.raw`Object.defineProperty(process, "version", { value: "v24.20.0" });
const originalOn = process.on;
process.on = function (event, ...args) {
  if (event === "SIGINT" || event === "SIGTERM") {
    process.stderr.write("SIGNAL_LISTENER_TOUCHED\n");
    throw new Error("signal listener installed before preflight");
  }
  return originalOn.call(this, event, ...args);
};
`);

  const result = spawnSync(
    process.execPath,
    ["--require", preload, join(PROJECT_ROOT, "bin", "pi-web.js"), "--tailscale-serve", "--private-argument"],
    {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "[pi-web] Toolchain mismatch: expected Node 22.23.2; observed Node v24.20.0. " +
      "Run: mise exec -C <pi-web-root> node@22.23.2 -- node ./bin/pi-web.js\n",
  );
  assert.equal(result.stderr.includes("SIGNAL_LISTENER_TOUCHED"), false);
  assert.equal(result.stderr.includes("private-argument"), false);
});
