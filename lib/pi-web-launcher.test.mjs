import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { browserUrl, openBrowser, runPiWebCli } = require("../bin/pi-web.js");

function fakeOpener() {
  const opener = new EventEmitter();
  opener.unrefCalled = false;
  opener.unref = () => { opener.unrefCalled = true; };
  return opener;
}

function restoreProcessState(nodeEnv, exitCode) {
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  process.exitCode = exitCode;
}

function fakeProcess() {
  const processRef = new EventEmitter();
  processRef.argv = ["node", "pi-web"];
  processRef.env = {};
  processRef.exitCode = undefined;
  processRef.exitCalls = [];
  processRef.exit = (exitCode) => processRef.exitCalls.push(exitCode);
  return processRef;
}

test("formats browser URLs for default, named, and IPv6 hosts", () => {
  assert.equal(browserUrl(null, 30141), "http://localhost:30141");
  assert.equal(browserUrl("127.0.0.1", 30142), "http://127.0.0.1:30142");
  assert.equal(browserUrl("::1", 30143), "http://[::1]:30143");
});

test("preserves platform browser opening and nonfatal opener errors", () => {
  const calls = [];
  const warnings = [];
  const opener = fakeOpener();
  const returned = openBrowser("http://localhost:30141", {
    platform: "win32",
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return opener;
    },
    warn: (message) => warnings.push(message),
  });

  assert.equal(returned, opener);
  assert.deepEqual(calls, [{
    command: "start",
    args: ["http://localhost:30141"],
    options: { shell: true, stdio: "ignore", detached: true },
  }]);
  assert.equal(opener.unrefCalled, true);

  opener.emit("error", new Error("opener unavailable"));
  assert.deepEqual(warnings, ["Could not open browser automatically: opener unavailable"]);
});

test("loads the server after selecting development mode and opens only after readiness", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  let finishStart;
  let closeCalls = 0;
  const spawnCalls = [];
  const logs = [];
  const opener = fakeOpener();
  const startPromise = new Promise((resolve) => { finishStart = resolve; });

  try {
    const runPromise = runPiWebCli({
      args: ["--dev"],
      startPiWebServer: async (options) => {
        assert.equal(process.env.NODE_ENV, "development");
        assert.equal(options.dev, true);
        assert.equal(options.lifecycleOwner, "programmatic");
        return startPromise;
      },
      platform: "darwin",
      spawn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return opener;
      },
      logger: {
        log: (message) => logs.push(message),
        warn: () => {},
        error: () => {},
      },
    });

    await Promise.resolve();
    assert.equal(spawnCalls.length, 0);
    finishStart({
      ready: true,
      address: { address: "127.0.0.1", family: "IPv4", port: 43210 },
      gateway: {},
      close: async () => { closeCalls += 1; },
    });

    const running = await runPromise;
    assert.deepEqual(logs, ["[pi-web] Ready on http://localhost:43210"]);
    assert.deepEqual(spawnCalls, [{
      command: "open",
      args: ["http://localhost:43210"],
      options: { shell: false, stdio: "ignore", detached: true },
    }]);
    assert.equal(opener.unrefCalled, true);

    const firstClose = running.close();
    assert.equal(running.close(), firstClose);
    await firstClose;
    assert.equal(closeCalls, 1);
  } finally {
    restoreProcessState(previousNodeEnv, previousExitCode);
  }
});

test("requires build artifacts only in production mode", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-launcher-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  await assert.rejects(
    runPiWebCli({ args: ["--no-open"], dir: directory }),
    (error) => error?.code === "build_artifacts_missing",
  );

  mkdirSync(join(directory, ".next"));
  const running = await runPiWebCli({
    args: ["--no-open"],
    dir: directory,
    startPiWebServer: async (options) => {
      assert.equal(options.dev, false);
      assert.equal(options.lifecycleOwner, "programmatic");
      assert.equal(process.env.NODE_ENV, "production");
      return {
        ready: true,
        address: { address: "127.0.0.1", family: "IPv4", port: 30141 },
        gateway: {},
        close: async () => {},
      };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });
  await running.close();
});

test("imported launcher APIs never install signal handlers or exit their caller", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  const processRef = fakeProcess();
  let closeCalls = 0;

  try {
    const running = await runPiWebCli({
      args: ["--dev", "--no-open"],
      process: processRef,
      startPiWebServer: async () => ({
        ready: true,
        address: { address: "127.0.0.1", family: "IPv4", port: 30141 },
        gateway: {},
        close: async () => {
          closeCalls += 1;
          throw new Error("synthetic close failure");
        },
      }),
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    assert.equal(processRef.listenerCount("SIGINT"), 0);
    assert.equal(processRef.listenerCount("SIGTERM"), 0);
    const firstClose = running.close();
    assert.equal(running.close(), firstClose);
    await assert.rejects(firstClose, /synthetic close failure/);
    assert.equal(closeCalls, 1);
    assert.deepEqual(processRef.exitCalls, []);
    assert.equal(processRef.exitCode, undefined);
  } finally {
    restoreProcessState(previousNodeEnv, previousExitCode);
  }
});
