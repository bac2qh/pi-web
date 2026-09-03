import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { browserUrl, openBrowser, publicErrorClass, runPiWebCli } = require("../bin/pi-web.js");

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

  opener.emit("error", new Error("private opener path and attacker payload"));
  assert.deepEqual(warnings, ["Could not open browser automatically."]);
});

test("launcher diagnostics map hostile mutable error names to finite classes", () => {
  const hostile = new Error("private message");
  hostile.name = "private/path/" + "x".repeat(10_000);
  assert.equal(publicErrorClass(hostile), "Error");
  assert.equal(publicErrorClass(new TypeError("private message")), "TypeError");
  assert.equal(publicErrorClass({ get name() { throw new Error("private getter"); } }), "Error");
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
        assert.equal(options.hostname, "127.0.0.1");
        assert.equal(options.port, "30141");
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
    assert.deepEqual(logs, ["[pi-web] Ready on http://127.0.0.1:43210"]);
    assert.deepEqual(spawnCalls, [{
      command: "open",
      args: ["http://127.0.0.1:43210"],
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

test("Serve rejects semantic zero and 443 ports before starting resources", async () => {
  let startCalls = 0;
  for (const port of ["+0", "0.0", " 0 ", "+443", "443.0", " 443 "]) {
    await assert.rejects(
      runPiWebCli({
        args: ["--dev", "--tailscale-serve", `--port=${port}`, "--no-open"],
        startPiWebServer: async () => { startCalls += 1; },
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      }),
      (error) => error?.code === "tailscale_serve_port_not_allowed",
    );
  }
  assert.equal(startCalls, 0);
});

test("Serve starts backend first and delays ready/open until child readiness", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  const serveReady = deferred();
  const serverClose = deferred();
  const childClose = deferred();
  const unexpectedExit = deferred();
  const events = [];
  const spawnCalls = [];
  const opener = fakeOpener();
  const owner = {
    unexpectedExit: unexpectedExit.promise,
    close(signal) {
      events.push(`child_close:${signal}`);
      return childClose.promise;
    },
  };

  try {
    const runningPromise = runPiWebCli({
      args: ["--dev", "--tailscale-serve", "--port", "31051"],
      startPiWebServer: async (options) => {
        events.push("backend_started");
        assert.equal(options.hostname, "127.0.0.1");
        assert.equal(options.port, "31051");
        return {
          ready: true,
          address: { address: "127.0.0.1", family: "IPv4", port: 31051 },
          gateway: {},
          close() {
            events.push("backend_close");
            return serverClose.promise;
          },
        };
      },
      startTailscaleServe: async (options) => {
        events.push("serve_starting");
        assert.equal(options.port, 31051);
        assert.equal(options.signal, undefined);
        return serveReady.promise;
      },
      platform: "darwin",
      spawn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return opener;
      },
      logger: {
        log: (message) => events.push(message),
        warn: () => {},
        error: () => {},
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(events, ["backend_started", "serve_starting"]);
    assert.deepEqual(spawnCalls, []);

    serveReady.resolve(owner);
    const running = await runningPromise;
    assert.deepEqual(events, [
      "backend_started",
      "serve_starting",
      "[pi-web] Ready on http://127.0.0.1:31051",
    ]);
    assert.deepEqual(spawnCalls, [{
      command: "open",
      args: ["http://127.0.0.1:31051"],
      options: { shell: false, stdio: "ignore", detached: true },
    }]);

    const firstClose = running.close("SIGTERM");
    assert.equal(running.close(), firstClose);
    assert.deepEqual(events.slice(-2), ["backend_close", "child_close:SIGTERM"]);
    serverClose.resolve();
    childClose.resolve();
    await firstClose;
  } finally {
    restoreProcessState(previousNodeEnv, previousExitCode);
  }
});

test("Serve startup failure rolls back the backend before rejecting", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  const events = [];
  const startupError = new Error("tailscale_serve_spawn_failed");
  startupError.code = "tailscale_serve_spawn_failed";

  try {
    await assert.rejects(
      runPiWebCli({
        args: ["--dev", "--tailscale-serve", "--no-open"],
        startPiWebServer: async () => ({
          ready: true,
          address: { address: "127.0.0.1", family: "IPv4", port: 30141 },
          gateway: {},
          close: async () => { events.push("backend_closed"); },
        }),
        startTailscaleServe: async () => { throw startupError; },
        logger: {
          log: (message) => events.push(message),
          warn: () => {},
          error: () => {},
        },
      }),
      (error) => error === startupError,
    );
    assert.deepEqual(events, ["backend_closed"]);
  } finally {
    restoreProcessState(previousNodeEnv, previousExitCode);
  }
});

test("startup cancellation closes the backend and exposes a sanitized abort", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  const controller = new AbortController();
  let serverCloseCalls = 0;

  try {
    const runningPromise = runPiWebCli({
      args: ["--dev", "--tailscale-serve", "--no-open"],
      startupSignal: controller.signal,
      startPiWebServer: async () => ({
        ready: true,
        address: { address: "127.0.0.1", family: "IPv4", port: 30141 },
        gateway: {},
        close: async () => { serverCloseCalls += 1; },
      }),
      startTailscaleServe: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("tailscale_serve_startup_aborted");
          error.name = "AbortError";
          error.code = "tailscale_serve_startup_aborted";
          reject(error);
        }, { once: true });
      }),
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await Promise.resolve();
    controller.abort("SIGTERM");
    await assert.rejects(
      runningPromise,
      (error) => error?.name === "AbortError" && error?.code === "pi_web_startup_aborted",
    );
    assert.equal(serverCloseCalls, 1);
  } finally {
    restoreProcessState(previousNodeEnv, previousExitCode);
  }
});

test("unexpected Serve exit warns once and keeps imported runtimes local", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  const processRef = fakeProcess();
  const unexpectedExit = deferred();
  const warnings = [];
  let serverCloseCalls = 0;
  let childCloseCalls = 0;

  try {
    const running = await runPiWebCli({
      args: ["--dev", "--tailscale-serve", "--no-open"],
      process: processRef,
      startPiWebServer: async () => ({
        ready: true,
        address: { address: "127.0.0.1", family: "IPv4", port: 30141 },
        gateway: {},
        close: async () => { serverCloseCalls += 1; },
      }),
      startTailscaleServe: async () => ({
        unexpectedExit: unexpectedExit.promise,
        close: async () => { childCloseCalls += 1; },
      }),
      logger: {
        log: () => {},
        warn: (message) => warnings.push(message),
        error: () => {},
      },
    });

    assert.equal(running.failure instanceof Promise, true);
    unexpectedExit.resolve({ reason: "exited" });
    const failure = await running.failure;
    assert.equal(failure.code, "tailscale_serve_child_exited");
    assert.equal(serverCloseCalls, 0);
    assert.equal(childCloseCalls, 0);
    assert.deepEqual(warnings, [
      "[pi-web] Tailscale command exited; private access may be unavailable.",
    ]);
    assert.equal(processRef.listenerCount("SIGINT"), 0);
    assert.equal(processRef.listenerCount("SIGTERM"), 0);
    assert.deepEqual(processRef.exitCalls, []);
    assert.equal(processRef.exitCode, undefined);

    await running.close();
    assert.equal(serverCloseCalls, 1);
    assert.equal(childCloseCalls, 1);
  } finally {
    restoreProcessState(previousNodeEnv, previousExitCode);
  }
});

test("unconfirmed Serve cleanup rejects imported close without exiting its host", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExitCode = process.exitCode;
  const processRef = fakeProcess();
  const cleanupError = new Error("tailscale_serve_cleanup_unconfirmed");
  cleanupError.code = "tailscale_serve_cleanup_unconfirmed";
  let serverCloseCalls = 0;
  let childCloseCalls = 0;

  try {
    const running = await runPiWebCli({
      args: ["--dev", "--tailscale-serve", "--no-open"],
      process: processRef,
      startPiWebServer: async () => ({
        ready: true,
        address: { address: "127.0.0.1", family: "IPv4", port: 30141 },
        gateway: {},
        close: async () => { serverCloseCalls += 1; },
      }),
      startTailscaleServe: async () => ({
        unexpectedExit: new Promise(() => {}),
        close: async () => {
          childCloseCalls += 1;
          throw cleanupError;
        },
      }),
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    const firstClose = running.close();
    assert.equal(running.close("SIGTERM"), firstClose);
    await assert.rejects(firstClose, (error) => error === cleanupError);
    assert.equal(serverCloseCalls, 1);
    assert.equal(childCloseCalls, 1);
    assert.deepEqual(processRef.exitCalls, []);
    assert.equal(processRef.exitCode, undefined);
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
    assert.equal(running.failure, null);
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
