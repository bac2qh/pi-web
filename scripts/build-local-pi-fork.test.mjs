import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ARTIFACT_FILE_NAME,
  EXPECTED_NODE_VERSION,
  EXPECTED_NPM_VERSION,
  FORK_PACKAGE_NAME,
  FORK_REPOSITORY,
  FORK_VERSION,
  MANIFEST_DEPENDENCY,
  OFFICIAL_AI_INTEGRITY,
  OFFICIAL_PACKAGE_NAME,
  OFFICIAL_VERSION,
  SOURCE_COMMIT,
  applyIdentityOverlay,
  assertExpectedIntegrity,
  assertToolchain,
  canonicalPathWithExistingAncestor,
  expectedLockIntegrity,
  inspectForkArtifact,
  isExpectedForkOrigin,
  parseArguments,
  publishArtifact,
  readTarballEntries,
  withGitReplacementProtection,
} from "./build-local-pi-fork.mjs";

function json(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createOfficialStage(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-local-fork-helper-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "dist", "core"), { recursive: true });
  writeFileSync(join(root, "dist", "index.js"), "export const fixture = true;\n");
  writeFileSync(
    join(root, "dist", "core", "agent-session.js"),
    "export class AgentSession { _checkCompactionBetweenTurns() {} }\n",
  );
  json(join(root, "package.json"), {
    name: OFFICIAL_PACKAGE_NAME,
    version: OFFICIAL_VERSION,
    type: "module",
    files: ["dist", "npm-shrinkwrap.json"],
    main: "./dist/index.js",
    dependencies: {
      "@earendil-works/pi-ai": "^0.84.0",
      "@earendil-works/pi-tui": "^0.84.0",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/earendil-works/pi.git",
      directory: "packages/coding-agent",
    },
  });
  json(join(root, "npm-shrinkwrap.json"), {
    name: OFFICIAL_PACKAGE_NAME,
    version: OFFICIAL_VERSION,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: OFFICIAL_PACKAGE_NAME,
        version: OFFICIAL_VERSION,
        dependencies: {
          "@earendil-works/pi-ai": "^0.84.0",
          "@earendil-works/pi-tui": "^0.84.0",
        },
      },
    },
  });
  return root;
}

function pack(t, stage) {
  const destination = mkdtempSync(join(tmpdir(), "pi-local-fork-helper-pack-"));
  t.after(() => rmSync(destination, { recursive: true, force: true }));
  const result = spawnSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: stage, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packed = JSON.parse(result.stdout)[0];
  return join(destination, packed.filename);
}

test("helper constants pin the approved identity, toolchain, and sibling artifact path", () => {
  assert.equal(process.version, EXPECTED_NODE_VERSION);
  assert.equal(EXPECTED_NPM_VERSION, "11.17.0");
  assert.equal(FORK_PACKAGE_NAME, "@bac2qh/pi-coding-agent");
  assert.equal(FORK_VERSION, "0.84.0-bac2qh.734502cb8");
  assert.equal(SOURCE_COMMIT, "734502cb86eaf631e1ceeb403dbd717e3b78404f");
  assert.equal(ARTIFACT_FILE_NAME, "bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz");
  assert.equal(
    OFFICIAL_AI_INTEGRITY,
    "sha512-N9RDk8q0eglGiy+NqTZ3Ev2j+6oFNXSAJa8b0CYhvWB9HGiKZjsoCESXkUvMDLybrn0wXp75sdsoBzEtHxk9kA==",
  );
  assert.equal(
    MANIFEST_DEPENDENCY,
    "file:../pi/.artifacts/pi-web/734502cb8/bac2qh-pi-coding-agent-0.84.0-bac2qh.734502cb8.tgz",
  );
});

test("toolchain and argument validation fail with bounded mismatch categories", () => {
  assert.doesNotThrow(() => assertToolchain(EXPECTED_NODE_VERSION, EXPECTED_NPM_VERSION));
  assert.throws(() => assertToolchain("v22.0.0", EXPECTED_NPM_VERSION), /\[toolchain mismatch\].*Node/);
  assert.throws(() => assertToolchain(EXPECTED_NODE_VERSION, "10.0.0"), /\[toolchain mismatch\].*npm/);
  assert.throws(
    () => assertToolchain(EXPECTED_NODE_VERSION, EXPECTED_NPM_VERSION, "v22.0.0"),
    /\[toolchain mismatch\].*PATH-resolved Node/,
  );
  assert.deepEqual(parseArguments(["--verify-only", "--keep-temporary"]), {
    keepTemporary: true,
    verifyOnly: true,
  });
  assert.throws(() => parseArguments(["--unknown"]), /\[argument error\]/);
});

test("Git commands force replacement objects off without dropping the isolated environment", () => {
  assert.deepEqual(withGitReplacementProtection({ PATH: "/synthetic", GIT_NO_REPLACE_OBJECTS: "0" }), {
    PATH: "/synthetic",
    GIT_NO_REPLACE_OBJECTS: "1",
  });
});

test("worktree cleanup canonicalizes symlinked existing ancestors even after a child disappears", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-local-fork-canonical-path-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const actual = join(root, "actual");
  const alias = join(root, "alias");
  mkdirSync(actual);
  symlinkSync(actual, alias);
  assert.equal(
    canonicalPathWithExistingAncestor(join(alias, "removed", "source")),
    canonicalPathWithExistingAncestor(join(actual, "removed", "source")),
  );
});

test("fork origin validation accepts exact GitHub forms and rejects hostname lookalikes", () => {
  assert.equal(isExpectedForkOrigin("https://github.com/bac2qh/pi.git"), true);
  assert.equal(isExpectedForkOrigin("git@github.com:bac2qh/pi.git"), true);
  assert.equal(isExpectedForkOrigin("ssh://git@github.com/bac2qh/pi"), true);
  assert.equal(isExpectedForkOrigin("https://evilgithub.com/bac2qh/pi.git"), false);
  assert.equal(isExpectedForkOrigin("https://github.com/other/pi.git"), false);
});

test("identity overlay changes only declared root metadata and preserves dependency ranges", (t) => {
  const stage = createOfficialStage(t);
  const originalPackage = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
  const originalShrinkwrap = JSON.parse(readFileSync(join(stage, "npm-shrinkwrap.json"), "utf8"));

  applyIdentityOverlay(stage);

  const packageJson = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
  const shrinkwrap = JSON.parse(readFileSync(join(stage, "npm-shrinkwrap.json"), "utf8"));
  assert.deepEqual(packageJson, {
    ...originalPackage,
    name: FORK_PACKAGE_NAME,
    version: FORK_VERSION,
    repository: FORK_REPOSITORY,
    gitHead: SOURCE_COMMIT,
  });
  assert.deepEqual(shrinkwrap, {
    ...originalShrinkwrap,
    name: FORK_PACKAGE_NAME,
    version: FORK_VERSION,
    packages: {
      ...originalShrinkwrap.packages,
      "": {
        ...originalShrinkwrap.packages[""],
        name: FORK_PACKAGE_NAME,
        version: FORK_VERSION,
      },
    },
  });
  assert.deepEqual(packageJson.dependencies, originalPackage.dependencies);
  assert.deepEqual(shrinkwrap.packages[""].dependencies, originalShrinkwrap.packages[""].dependencies);
});

test("packed artifact inspection proves identity, provenance, shrinkwrap, dist, and fork code", (t) => {
  const stage = createOfficialStage(t);
  applyIdentityOverlay(stage);
  const tarball = pack(t, stage);

  assert.equal(tarball.endsWith(ARTIFACT_FILE_NAME), true);
  const inspected = inspectForkArtifact(tarball);
  assert.equal(inspected.packageJson.name, FORK_PACKAGE_NAME);
  assert.equal(inspected.packageJson.version, FORK_VERSION);
  assert.deepEqual(inspected.packageJson.repository, FORK_REPOSITORY);
  assert.equal(inspected.packageJson.gitHead, SOURCE_COMMIT);
  assert.equal(inspected.shrinkwrap.packages[""].name, FORK_PACKAGE_NAME);
  assert.match(inspected.integrity, /^sha512-[A-Za-z0-9+/]+=*$/u);
  assert.match(inspected.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(inspected.files.includes("package/dist/core/agent-session.js"), true);
  assert.equal(readTarballEntries(tarball).has("package/package.json"), true);
});

test("artifact inspection and lock integrity fail clearly for missing or mismatched inputs", (t) => {
  const missing = join(tmpdir(), `missing-local-pi-fork-${Date.now()}.tgz`);
  assert.throws(() => inspectForkArtifact(missing), /\[artifact missing\]/);
  assert.throws(() => assertExpectedIntegrity("sha512-actual", "sha512-expected"), /\[digest mismatch\]/);

  const stage = createOfficialStage(t);
  applyIdentityOverlay(stage);
  const validTarball = pack(t, stage);
  const tamperedDirectory = mkdtempSync(join(tmpdir(), "pi-local-fork-tampered-"));
  t.after(() => rmSync(tamperedDirectory, { recursive: true, force: true }));
  const tamperedTarball = join(tamperedDirectory, ARTIFACT_FILE_NAME);
  copyFileSync(validTarball, tamperedTarball);
  const tamperedBytes = readFileSync(tamperedTarball);
  tamperedBytes[tamperedBytes.length - 1] ^= 1;
  writeFileSync(tamperedTarball, tamperedBytes);
  assert.throws(() => inspectForkArtifact(tamperedTarball), /\[artifact mismatch\]/);

  const project = mkdtempSync(join(tmpdir(), "pi-local-fork-lock-test-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  json(join(project, "package-lock.json"), {
    name: "@agegr/pi-web",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { [OFFICIAL_PACKAGE_NAME]: MANIFEST_DEPENDENCY } },
      [`node_modules/${OFFICIAL_PACKAGE_NAME}`]: {
        name: FORK_PACKAGE_NAME,
        version: FORK_VERSION,
        resolved: MANIFEST_DEPENDENCY,
        integrity: "sha512-expected",
      },
    },
  });
  assert.equal(expectedLockIntegrity(project), "sha512-expected");
  assert.equal(expectedLockIntegrity(project, { required: true }), "sha512-expected");
  const lock = JSON.parse(readFileSync(join(project, "package-lock.json"), "utf8"));
  lock.packages[""].dependencies[OFFICIAL_PACKAGE_NAME] = "^0.84.0";
  json(join(project, "package-lock.json"), lock);
  assert.equal(expectedLockIntegrity(project), null);
  assert.throws(() => expectedLockIntegrity(project, { required: true }), /\[lock mismatch\].*does not adopt/);
  lock.packages[""].dependencies[OFFICIAL_PACKAGE_NAME] = MANIFEST_DEPENDENCY;
  lock.packages[`node_modules/${OFFICIAL_PACKAGE_NAME}`].name = OFFICIAL_PACKAGE_NAME;
  json(join(project, "package-lock.json"), lock);
  assert.throws(() => expectedLockIntegrity(project), /\[lock mismatch\]/);

  const missingLock = mkdtempSync(join(tmpdir(), "pi-local-fork-missing-lock-test-"));
  t.after(() => rmSync(missingLock, { recursive: true, force: true }));
  assert.equal(expectedLockIntegrity(missingLock), null);
  assert.throws(() => expectedLockIntegrity(missingLock, { required: true }), /\[lock mismatch\].*is required/);
});

test("artifact publication is no-replace and rejects symlink redirection", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-local-fork-publish-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const forkRoot = join(root, "pi");
  const source = join(root, "source.tgz");
  const destination = join(forkRoot, ".artifacts", "pi-web", "commit", "artifact.tgz");
  mkdirSync(forkRoot);
  writeFileSync(source, "verified-artifact");

  assert.equal(publishArtifact(source, destination, forkRoot), "published");
  assert.equal(readFileSync(destination, "utf8"), "verified-artifact");
  assert.equal(publishArtifact(source, destination, forkRoot), "already-current");

  const different = join(root, "different.tgz");
  writeFileSync(different, "different-artifact");
  assert.throws(() => publishArtifact(different, destination, forkRoot), /\[artifact mismatch\].*differs/);

  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(forkRoot, "redirect"));
  assert.throws(
    () => publishArtifact(source, join(forkRoot, "redirect", "artifact.tgz"), forkRoot),
    /\[path mismatch\].*symlink/,
  );
});
