import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const {
  PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES,
  PI_WEB_TRANSPORT_PATH,
} = require("../bin/pi-web-transport-gateway.js");

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CAPTURED_OUTPUT_BYTES = 1024 * 1024;
const REQUIRED_PRODUCTION_MANIFESTS = [
  "BUILD_ID",
  "routes-manifest.json",
  "prerender-manifest.json",
  "required-server-files.json",
  "server/app-paths-manifest.json",
];

function appendBounded(current, chunk) {
  const combined = current + chunk.toString();
  if (Buffer.byteLength(combined) <= MAX_CAPTURED_OUTPUT_BYTES) return combined;
  return combined.slice(-MAX_CAPTURED_OUTPUT_BYTES);
}

function captureChild(child) {
  const changes = new EventEmitter();
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let exitResult = null;

  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.byteLength;
    stdout = appendBounded(stdout, chunk);
    changes.emit("change");
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.byteLength;
    stderr = appendBounded(stderr, chunk);
    changes.emit("change");
  });

  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      exitResult = { code, signal };
      changes.emit("change");
      resolveExit(exitResult);
    });
  });

  const waitForStdout = (marker, label, timeoutMs) => new Promise((resolveWait, rejectWait) => {
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      changes.off("change", check);
      if (error) rejectWait(error);
      else resolveWait();
    };
    const check = () => {
      if (stdout.includes(marker)) {
        finish();
      } else if (exitResult) {
        finish(new Error(
          `child_exited_before_${label}:code=${exitResult.code}:signal=${exitResult.signal ?? "none"}` +
          `:stdoutBytes=${stdoutBytes}:stderrBytes=${stderrBytes}`,
        ));
      }
    };

    changes.on("change", check);
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`child_timeout_waiting_for_${label}`));
    }, timeoutMs);
    check();
  });

  const waitForExit = (label, timeoutMs) => new Promise((resolveWait, rejectWait) => {
    let timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectWait(new Error(`child_timeout_waiting_for_${label}_exit`));
    }, timeoutMs);
    exited.then(
      (result) => {
        clearTimeout(timer);
        timer = null;
        resolveWait(result);
      },
      (error) => {
        clearTimeout(timer);
        timer = null;
        rejectWait(error);
      },
    );
  });

  return {
    child,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get exited() { return exitResult !== null; },
    waitForStdout,
    waitForExit,
  };
}

function spawnNode(args, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return captureChild(child);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function withTimeout(promise, label, timeoutMs = 15_000) {
  return new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => rejectWait(new Error(`${label}_timeout`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolveWait(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectWait(error);
      },
    );
  });
}

async function listenLoopbackServer() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  return { server, port: address.port };
}

function closeLoopbackServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function unusedLoopbackPort() {
  const { server, port } = await listenLoopbackServer();
  await closeLoopbackServer(server);
  return port;
}

function openWebSocket(url, origin) {
  return new Promise((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(url, { origin, handshakeTimeout: 10_000 });
    socket.once("open", () => resolveOpen(socket));
    socket.once("error", rejectOpen);
    socket.once("unexpected-response", (_request, response) => {
      const statusCode = response.statusCode;
      response.resume();
      rejectOpen(new Error(`unexpected_websocket_status_${statusCode}`));
    });
  });
}

function rejectedUpgradeStatus(url, origin) {
  return new Promise((resolveStatus, rejectStatus) => {
    const socket = new WebSocket(url, { origin, handshakeTimeout: 10_000 });
    socket.once("open", () => {
      socket.terminate();
      rejectStatus(new Error("upgrade_unexpectedly_opened"));
    });
    socket.once("unexpected-response", (_request, response) => {
      const statusCode = response.statusCode;
      response.resume();
      resolveStatus(statusCode);
    });
    socket.once("error", (error) => {
      if (!String(error.message).startsWith("Unexpected server response:")) rejectStatus(error);
    });
  });
}

function waitForMessage(socket) {
  return withTimeout(new Promise((resolveMessage, rejectMessage) => {
    socket.once("message", (data) => resolveMessage(data.toString()));
    socket.once("error", rejectMessage);
  }), "websocket_message");
}

function waitForClose(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve(1006);
  return withTimeout(new Promise((resolveClose) => {
    socket.once("close", (code) => resolveClose(code));
  }), "websocket_close");
}

async function issueTicket(baseUrl, origin, channel = "test.integration") {
  const response = await fetch(`${baseUrl}/api/transport/ticket`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Pi-Web-Transport": "1",
    },
    body: JSON.stringify({ channel }),
    signal: AbortSignal.timeout(30_000),
  });
  return { response, body: await response.json() };
}

function writeFakeLauncherFixture(directory) {
  const fixtureDirectory = join(directory, "fake-launcher");
  const fixtureBinDirectory = join(fixtureDirectory, "bin");
  mkdirSync(fixtureBinDirectory, { recursive: true });

  const launcher = join(fixtureBinDirectory, "pi-web.js");
  cpSync(join(PROJECT_ROOT, "bin/pi-web.js"), launcher);
  cpSync(
    join(PROJECT_ROOT, "bin/pi-web-options.js"),
    join(fixtureBinDirectory, "pi-web-options.js"),
  );
  cpSync(
    join(PROJECT_ROOT, "bin/pi-web-tailscale-serve.js"),
    join(fixtureBinDirectory, "pi-web-tailscale-serve.js"),
  );
  assert.equal(sha256(launcher), sha256(join(PROJECT_ROOT, "bin/pi-web.js")));

  writeFileSync(join(fixtureBinDirectory, "pi-web-server.js"), String.raw`"use strict";
const keepAlive = setInterval(() => {}, 1_000);
let closeCalls = 0;

module.exports = {
  startPiWebServer: async (options) => {
    process.stdout.write("FAKE_SERVER_STARTING\n");
    if (process.env.PI_WEB_TEST_START_DELAY === "1") {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    process.stdout.write("FAKE_SERVER_OWNER:" + options.lifecycleOwner + "\n");
    return {
      ready: true,
      address: { address: "127.0.0.1", family: "IPv4", port: Number(options.port) },
      gateway: {},
      close: async () => {
        closeCalls += 1;
        process.stdout.write("FAKE_CLOSE_CALL:" + closeCalls + "\n");
        await new Promise((resolve) => setTimeout(resolve, 200));
        clearInterval(keepAlive);
        if (process.env.PI_WEB_TEST_CLOSE_FAILURE === "1") {
          throw new Error("synthetic close failure");
        }
        process.stdout.write("FAKE_CLOSE_DONE\n");
      },
    };
  },
};
`);

  return launcher;
}

async function runFakeSignalCase(
  launcher,
  signals,
  expectedExitCode,
  { failClose = false, duringStartup = false } = {},
) {
  const captured = spawnNode([
    launcher,
    "--dev",
    "--no-open",
  ], {
    env: {
      ...(failClose ? { PI_WEB_TEST_CLOSE_FAILURE: "1" } : {}),
      ...(duringStartup ? { PI_WEB_TEST_START_DELAY: "1" } : {}),
    },
  });

  await captured.waitForStdout(
    duringStartup ? "FAKE_SERVER_STARTING" : "[pi-web] Ready",
    duringStartup ? "fake_starting" : "fake_ready",
    10_000,
  );
  assert.equal(captured.child.kill(signals[0]), true);
  for (const signal of signals.slice(1)) {
    await delay(20);
    if (!captured.exited) assert.equal(captured.child.kill(signal), true);
  }

  const result = await captured.waitForExit("fake_signal", 10_000);
  assert.deepEqual(result, { code: expectedExitCode, signal: null });
  assert.equal(captured.stdout.includes("FAKE_SERVER_OWNER:terminal"), true);
  assert.equal(countOccurrences(captured.stdout, "FAKE_CLOSE_CALL:"), 1);
  assert.equal(countOccurrences(captured.stdout, "terminal_shutdown_started"), 1);
  assert.equal(captured.stdout.includes(`signal: '${signals[0]}'`), true);

  if (failClose) {
    assert.equal(captured.stderr.includes("close_failed"), true);
    assert.equal(captured.stdout.includes("terminal_shutdown_complete"), false);
  } else {
    assert.equal(captured.stdout.includes("FAKE_CLOSE_DONE"), true);
    assert.equal(countOccurrences(captured.stdout, "terminal_shutdown_complete"), 1);
    assert.equal(captured.stderr.includes("close_failed"), false);
  }
}

function writeFakeTailscaleFixture(directory, shape) {
  const executableDirectory = join(directory, `fake-tailscale-${shape}-bin`);
  mkdirSync(executableDirectory, { recursive: true });
  const commandName = shape === "shell" ? "tailscale-real" : "tailscale";
  const executable = join(executableDirectory, commandName);
  writeFileSync(executable, String.raw`#!/usr/bin/env node
"use strict";
const { appendFileSync } = require("node:fs");
const traceFile = process.env.PI_WEB_TEST_TAILSCALE_TRACE;
const mode = process.env.PI_WEB_TEST_TAILSCALE_MODE || "ready";
const hold = setInterval(() => {}, 1_000);
const trace = (entry) => appendFileSync(traceFile, entry + "\n");
const finishSignal = (signal) => {
  trace("SIGNAL:" + signal);
  clearInterval(hold);
  setTimeout(() => process.exit(0), 25);
};
process.on("SIGINT", () => finishSignal("SIGINT"));
process.on("SIGTERM", () => finishSignal("SIGTERM"));
trace("STARTED");
process.stdout.write("private-node.example.ts.net\n");
process.stderr.write("private route and daemon output\n");
const ready = () => {
  process.stdout.write("Press Ctrl");
  setTimeout(() => process.stdout.write("+C to exit."), 10);
};
if (mode === "early") {
  clearInterval(hold);
  setTimeout(() => process.exit(17), 25);
} else if (mode === "unexpected") {
  ready();
  setTimeout(() => {
    clearInterval(hold);
    process.exit(23);
  }, 150);
} else if (mode === "delayed") {
  setTimeout(ready, 30_000);
} else {
  ready();
}
`, { mode: 0o755 });

  if (shape === "shell") {
    writeFileSync(
      join(executableDirectory, "tailscale"),
      '#!/bin/sh\n"$(dirname "$0")/tailscale-real" "$@"\n',
      { mode: 0o755 },
    );
  }
  return executableDirectory;
}

async function waitForFileMarker(file, marker, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file) && readFileSync(file, "utf8").includes(marker)) return;
    await delay(10);
  }
  throw new Error("fake_tailscale_trace_timeout");
}

async function runFakeServeSignalCase(
  directory,
  launcher,
  tailscaleDirectory,
  shape,
  signal,
  mode,
) {
  const traceFile = join(directory, `tailscale-${shape}-${mode}-${signal}.trace`);
  const captured = spawnNode([
    launcher,
    "--dev",
    "--no-open",
    "--tailscale-serve",
    "--port",
    "31061",
  ], {
    env: {
      PATH: `${tailscaleDirectory}:${process.env.PATH ?? ""}`,
      PI_WEB_TEST_TAILSCALE_MODE: mode,
      PI_WEB_TEST_TAILSCALE_TRACE: traceFile,
    },
  });

  if (mode === "ready") {
    await captured.waitForStdout("[pi-web] Ready", "fake_serve_ready", 10_000);
  } else {
    await waitForFileMarker(traceFile, "STARTED");
  }
  assert.equal(captured.child.kill(signal), true);

  const result = await captured.waitForExit("fake_serve_signal", 10_000);
  assert.deepEqual(result, { code: SIGNAL_EXIT_CODES_FOR_TEST[signal], signal: null });
  assert.equal(countOccurrences(captured.stdout, "FAKE_CLOSE_CALL:"), 1);
  assert.equal(captured.stdout.includes("FAKE_CLOSE_DONE"), true);
  assert.equal(countOccurrences(captured.stdout, "terminal_shutdown_started"), 1);
  assert.equal(countOccurrences(captured.stdout, "terminal_shutdown_complete"), 1);
  assert.equal(captured.stdout.includes(`signal: '${signal}'`), true);
  assert.equal(captured.stderr.includes("close_failed"), false);
  assert.equal(captured.stdout.includes("private-node.example.ts.net"), false);
  assert.equal(captured.stderr.includes("private route and daemon output"), false);
  assert.equal(readFileSync(traceFile, "utf8").includes(`SIGNAL:${signal}`), true);
}

async function runFakeServeExitCase(directory, launcher, tailscaleDirectory, shape, mode) {
  const traceFile = join(directory, `tailscale-${shape}-${mode}.trace`);
  const captured = spawnNode([
    launcher,
    "--dev",
    "--no-open",
    "--tailscale-serve",
    "--port",
    "31062",
  ], {
    env: {
      PATH: `${tailscaleDirectory}:${process.env.PATH ?? ""}`,
      PI_WEB_TEST_TAILSCALE_MODE: mode,
      PI_WEB_TEST_TAILSCALE_TRACE: traceFile,
    },
  });

  if (mode === "early") {
    const result = await captured.waitForExit(`fake_serve_${shape}_${mode}`, 10_000);
    assert.deepEqual(result, { code: 1, signal: null });
    assert.equal(countOccurrences(captured.stdout, "FAKE_CLOSE_CALL:"), 1);
    assert.equal(captured.stdout.includes("FAKE_CLOSE_DONE"), true);
    assert.equal(captured.stderr.includes("startup_failed"), true);
    assert.equal(captured.stderr.includes("private access may be unavailable"), false);
  } else {
    await captured.waitForStdout("[pi-web] Ready", `fake_serve_${shape}_ready`, 10_000);
    await waitForFileMarker(traceFile, "STARTED");
    const warningDeadline = Date.now() + 10_000;
    while (!captured.stderr.includes("private access may be unavailable")) {
      if (Date.now() >= warningDeadline) throw new Error("fake_serve_warning_timeout");
      await delay(10);
    }
    assert.equal(captured.exited, false, "unexpected Serve exit keeps local Pi Web alive");
    assert.equal(countOccurrences(captured.stdout, "FAKE_CLOSE_CALL:"), 0);
    assert.equal(countOccurrences(captured.stderr, "private access may be unavailable"), 1);
    assert.equal(captured.child.kill("SIGINT"), true);
    const result = await captured.waitForExit(`fake_serve_${shape}_shutdown`, 10_000);
    assert.deepEqual(result, { code: 130, signal: null });
    assert.equal(countOccurrences(captured.stdout, "FAKE_CLOSE_CALL:"), 1);
    assert.equal(captured.stdout.includes("FAKE_CLOSE_DONE"), true);
    assert.equal(captured.stderr.includes("startup_failed"), false);
  }

  assert.equal(captured.stdout.includes("private-node.example.ts.net"), false);
  assert.equal(captured.stderr.includes("private route and daemon output"), false);
}

function writeProgrammaticServeHarness(directory, launcher) {
  const harness = join(directory, "programmatic-serve-close.cjs");
  writeFileSync(harness, String.raw`"use strict";
const { runPiWebCli } = require(${JSON.stringify(launcher)});

(async () => {
  const running = await runPiWebCli({
    args: ["--dev", "--no-open", "--tailscale-serve", "--port", "31063"],
  });
  process.stdout.write("PROGRAMMATIC_READY\n");
  await running.close();
  process.stdout.write("PROGRAMMATIC_CLOSED\n");
})().catch((error) => {
  process.stderr.write("PROGRAMMATIC_FAILED:" + (error?.code ?? error?.name ?? "Error") + "\n");
  process.exitCode = 1;
});
`);
  return harness;
}

async function runFakeServeProgrammaticClose(
  directory,
  launcher,
  tailscaleDirectory,
  shape,
) {
  const traceFile = join(directory, `tailscale-${shape}-programmatic.trace`);
  const harness = writeProgrammaticServeHarness(directory, launcher);
  const captured = spawnNode([harness], {
    env: {
      PATH: `${tailscaleDirectory}:${process.env.PATH ?? ""}`,
      PI_WEB_TEST_TAILSCALE_MODE: "ready",
      PI_WEB_TEST_TAILSCALE_TRACE: traceFile,
    },
  });

  await captured.waitForStdout("PROGRAMMATIC_READY", "programmatic_serve_ready", 10_000);
  const result = await captured.waitForExit("programmatic_serve_close", 10_000);
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(captured.stdout.includes("PROGRAMMATIC_CLOSED"), true);
  assert.equal(captured.stderr.includes("PROGRAMMATIC_FAILED"), false);
  assert.equal(captured.stdout.includes("private-node.example.ts.net"), false);
  assert.equal(captured.stderr.includes("private route and daemon output"), false);
  assert.equal(readFileSync(traceFile, "utf8").includes("SIGNAL:SIGINT"), true);
}

async function runUnconfirmedCleanupTerminalCase(directory, launcher) {
  writeFileSync(join(dirname(launcher), "pi-web-tailscale-serve.js"), String.raw`"use strict";
const pending = new Promise(() => {});
module.exports = {
  startTailscaleServe: async () => ({
    unexpectedExit: pending,
    close: async () => {
      const error = new Error("tailscale_serve_cleanup_unconfirmed");
      error.code = "tailscale_serve_cleanup_unconfirmed";
      throw error;
    },
  }),
};
`);
  const captured = spawnNode([
    launcher,
    "--dev",
    "--no-open",
    "--tailscale-serve",
    "--port",
    "31064",
  ]);
  await captured.waitForStdout("[pi-web] Ready", "unconfirmed_cleanup_ready", 10_000);
  assert.equal(captured.child.kill("SIGINT"), true);
  const result = await captured.waitForExit("unconfirmed_cleanup", 10_000);
  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(countOccurrences(captured.stdout, "FAKE_CLOSE_CALL:"), 1);
  assert.equal(captured.stderr.includes("Tailscale cleanup could not be confirmed."), true);
  assert.equal(captured.stderr.includes("tailscale_serve_cleanup_unconfirmed"), false);
  assert.equal(captured.stdout.includes("terminal_shutdown_complete"), false);
}

const SIGNAL_EXIT_CODES_FOR_TEST = Object.freeze({ SIGINT: 130, SIGTERM: 143 });

function writeRealDevelopmentHarness(directory) {
  const file = join(directory, "real-development-child.cjs");
  writeFileSync(file, String.raw`"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { startPiWebServer } = require(path.join(process.cwd(), "bin", "pi-web-server.js"));
const { PI_WEB_TRANSPORT_GATEWAY_SLOT } = require(path.join(process.cwd(), "bin", "pi-web-transport-gateway.js"));

const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };
let firstSignal = null;
let unregister = () => false;
let runningPromise;

function onSignal(signal) {
  if (firstSignal) return;
  firstSignal = signal;
  void (async () => {
    const running = await runningPromise;
    unregister();
    await running.close();
    assert.equal(
      Object.prototype.hasOwnProperty.call(globalThis, PI_WEB_TRANSPORT_GATEWAY_SLOT),
      false,
    );
    assert.deepEqual(running.gateway.getStats(), {
      closed: true,
      registeredChannelCount: 0,
      pendingTicketCount: 0,
      activeConnectionCount: 0,
      activePeerKeyCount: 0,
    });
    process.stdout.write("TEST_ORDERLY_CLOSE\n");
    process.exit(signalExitCodes[signal]);
  })().catch((error) => {
    process.stderr.write("TEST_CLOSE_FAILED:" + (error?.name ?? "Error") + "\n");
    process.exit(1);
  });
}

process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

runningPromise = (async () => {
  const running = await startPiWebServer({
    dev: true,
    hostname: "127.0.0.1",
    port: Number(process.env.PI_WEB_TEST_PORT),
    lifecycleOwner: "terminal",
    diagnostics: (entry) => {
      process.stdout.write(
        "TEST_DIAGNOSTIC:" + entry.event + ":" + (entry.outcome ?? "none") + ":" +
        (entry.lifecycleOwner ?? "none") + "\n"
      );
    },
  });
  unregister = running.gateway.registerChannel("test.integration", (socket) => {
    socket.on("message", (data) => socket.send("size:" + data.length));
    setImmediate(() => {
      if (socket.readyState === socket.OPEN) socket.send("connected");
    });
  });
  process.stdout.write("TEST_CHANNEL_READY\n");
  process.stdout.write("TEST_SERVER_READY\n");
  return running;
})();

runningPromise.catch((error) => {
  if (firstSignal) return;
  process.stderr.write("TEST_START_FAILED:" + (error?.name ?? "Error") + "\n");
  process.exit(1);
});
`);
  return file;
}

async function exerciseRealDevelopmentProcess(directory) {
  const activeChildren = new Set();
  const blockedListener = await listenLoopbackServer();
  const failedStartup = spawnNode([
    "bin/pi-web.js",
    "--dev",
    "--no-open",
    "-H",
    "127.0.0.1",
    "-p",
    String(blockedListener.port),
  ]);
  activeChildren.add(failedStartup);
  try {
    const failedExit = await failedStartup.waitForExit("failed_development_startup", 120_000);
    activeChildren.delete(failedStartup);
    assert.deepEqual(failedExit, { code: 1, signal: null });
    assert.equal(failedStartup.stderr.includes("startup_failed"), true);
  } finally {
    if (!failedStartup.exited) failedStartup.child.kill("SIGKILL");
    activeChildren.delete(failedStartup);
    await closeLoopbackServer(blockedListener.server);
  }

  const port = await unusedLoopbackPort();
  const developmentHarness = writeRealDevelopmentHarness(directory);
  const first = spawnNode([developmentHarness], {
    env: { PI_WEB_TEST_PORT: String(port) },
  });
  activeChildren.add(first);

  try {
    await first.waitForStdout("TEST_SERVER_READY", "real_development_ready", 120_000);
    assert.equal(first.stdout.includes("TEST_CHANNEL_READY"), true);
    assert.equal(first.stdout.includes("TEST_DIAGNOSTIC:server_ready:ok:terminal"), true);

    const baseUrl = `http://127.0.0.1:${port}`;
    const websocketBase = `ws://127.0.0.1:${port}`;
    const origin = baseUrl;
    const pageResponse = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(60_000) });
    assert.equal(pageResponse.status, 200);
    const homeResponse = await fetch(`${baseUrl}/api/home`, { signal: AbortSignal.timeout(60_000) });
    assert.equal(homeResponse.status, 200);
    assert.equal(typeof (await homeResponse.json()).home, "string");

    const hmrSocket = await openWebSocket(`${websocketBase}/_next/webpack-hmr`, origin);
    assert.equal(hmrSocket.readyState, WebSocket.OPEN);

    const runningTicket = await issueTicket(baseUrl, origin, "running");
    assert.equal(runningTicket.response.status, 200);
    const runningMessages = [];
    const runningSocket = new WebSocket(
      `${websocketBase}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(runningTicket.body.ticket)}`,
      { origin, handshakeTimeout: 10_000 },
    );
    runningSocket.on("message", (data) => runningMessages.push(JSON.parse(data.toString())));
    await withTimeout(new Promise((resolveOpen, rejectOpen) => {
      runningSocket.once("open", resolveOpen);
      runningSocket.once("error", rejectOpen);
    }), "running_websocket_open");
    const runningFramesDeadline = Date.now() + 10_000;
    while (runningMessages.length < 2) {
      if (Date.now() >= runningFramesDeadline) throw new Error("running_initial_frames_timeout");
      await delay(5);
    }
    assert.deepEqual(runningMessages.slice(0, 2).map((frame) => frame.type), [
      "running",
      "sessions_changed",
    ]);
    assert.equal(runningMessages.every((frame) =>
      frame.protocol === "pi-web-global-status" &&
      frame.version === 1 &&
      typeof frame.serverInstanceId === "string"
    ), true);
    assert.equal(hmrSocket.readyState, WebSocket.OPEN);

    const missingHeader = await fetch(`${baseUrl}/api/transport/ticket`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "test.integration" }),
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(missingHeader.status, 403);

    const unknown = await issueTicket(baseUrl, origin, "test.missing");
    assert.equal(unknown.response.status, 404);
    assert.deepEqual(unknown.body, { error: "channel_unavailable" });

    const oversizedBootstrap = await fetch(`${baseUrl}/api/transport/ticket`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Pi-Web-Transport": "1",
      },
      body: "x".repeat(1_025),
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(oversizedBootstrap.status, 413);

    const issued = await issueTicket(baseUrl, origin);
    assert.equal(issued.response.status, 200);
    assert.equal(/^[A-Za-z0-9_-]{43}$/.test(issued.body.ticket), true);

    const ticketUrl = `${websocketBase}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(issued.body.ticket)}`;
    assert.equal(await rejectedUpgradeStatus(ticketUrl, "http://other.invalid"), 403);
    const piSocket = await openWebSocket(ticketUrl, origin);
    assert.equal(await waitForMessage(piSocket), "connected");
    assert.equal(hmrSocket.readyState, WebSocket.OPEN);

    assert.equal(await rejectedUpgradeStatus(ticketUrl, origin), 401);
    assert.equal(await rejectedUpgradeStatus(`${websocketBase}${PI_WEB_TRANSPORT_PATH}`, origin), 401);

    piSocket.send(Buffer.alloc(PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES));
    assert.equal(await waitForMessage(piSocket), `size:${PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES}`);
    const oversizedClose = waitForClose(piSocket);
    piSocket.send(Buffer.alloc(PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES + 1));
    assert.equal(await oversizedClose, 1009);

    const afterOversize = await fetch(`${baseUrl}/api/home`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(afterOversize.status, 200);
    assert.equal(hmrSocket.readyState, WebSocket.OPEN);

    const pending = await issueTicket(baseUrl, origin);
    assert.equal(pending.response.status, 200);
    const idleSocket = await openWebSocket(
      `${websocketBase}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(pending.body.ticket)}`,
      origin,
    );
    assert.equal(await waitForMessage(idleSocket), "connected");
    const idleClosed = waitForClose(idleSocket);
    const runningClosed = waitForClose(runningSocket);
    const hmrClosed = waitForClose(hmrSocket);

    assert.equal(first.child.kill("SIGTERM"), true);
    const firstExit = await first.waitForExit("real_development", 60_000);
    activeChildren.delete(first);
    assert.deepEqual(firstExit, { code: 143, signal: null });
    await Promise.all([idleClosed, runningClosed, hmrClosed]);
    assert.equal(first.stdout.includes("TEST_DIAGNOSTIC:server_closed:forced:terminal"), true);
    assert.equal(first.stdout.includes("TEST_ORDERLY_CLOSE"), true);
    assert.equal(first.stderr.includes("TEST_CLOSE_FAILED"), false);

    const fresh = spawnNode([
      "bin/pi-web.js",
      "--dev",
      "--no-open",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ]);
    activeChildren.add(fresh);
    await fresh.waitForStdout("[pi-web] Ready", "fresh_development_ready", 120_000);
    const freshResponse = await fetch(`${baseUrl}/api/home`, { signal: AbortSignal.timeout(60_000) });
    assert.equal(freshResponse.status, 200);
    assert.equal(fresh.child.kill("SIGINT"), true);
    const freshExit = await fresh.waitForExit("fresh_development", 60_000);
    activeChildren.delete(fresh);
    assert.deepEqual(freshExit, { code: 130, signal: null });
    assert.equal(fresh.stdout.includes("event: 'server_closed'"), true);
    assert.equal(fresh.stdout.includes("terminal_shutdown_complete"), true);
  } finally {
    for (const captured of activeChildren) {
      if (!captured.exited) captured.child.kill("SIGKILL");
    }
  }
}

function mainProjectRoot() {
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  ).trim();
  return dirname(commonDirectory);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function includesProductionArtifactPath(sourceRelative) {
  if (!sourceRelative) return true;
  const firstSegment = sourceRelative.split(/[\\/]/, 1)[0];
  if (firstSegment === "cache" || firstSegment === "dev") return false;
  return !sourceRelative.endsWith(".js.map");
}

function artifactSnapshot(nextDirectory) {
  const entries = {};
  const visit = (directory, parentRelative = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryRelative = parentRelative ? join(parentRelative, entry.name) : entry.name;
      if (!includesProductionArtifactPath(entryRelative)) continue;
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath, entryRelative);
      } else if (entry.isSymbolicLink()) {
        entries[entryRelative] = {
          type: "symlink",
          target: readlinkSync(entryPath),
        };
      } else if (entry.isFile()) {
        const stat = lstatSync(entryPath);
        entries[entryRelative] = {
          type: "file",
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: sha256(entryPath),
        };
      } else {
        throw new Error("unsupported_production_artifact_entry");
      }
    }
  };

  visit(nextDirectory);
  const serializedEntries = JSON.stringify(entries);
  return {
    entryCount: Object.keys(entries).length,
    sha256: createHash("sha256").update(serializedEntries).digest("hex"),
  };
}

function preflightProductionArtifact(mainRoot) {
  const nextDirectory = join(mainRoot, ".next");
  for (const manifest of REQUIRED_PRODUCTION_MANIFESTS) {
    assert.equal(existsSync(join(nextDirectory, manifest)), true, `missing production manifest: ${manifest}`);
  }

  const buildId = readFileSync(join(nextDirectory, "BUILD_ID"), "utf8").trim();
  assert.equal(buildId.length > 0 && buildId.length <= 128, true);
  const appPaths = JSON.parse(readFileSync(join(nextDirectory, "server/app-paths-manifest.json"), "utf8"));
  assert.equal(Object.hasOwn(appPaths, "/api/home/route"), true);
  const routes = JSON.parse(readFileSync(join(nextDirectory, "routes-manifest.json"), "utf8"));
  assert.equal(routes.staticRoutes.some((route) => route.page === "/api/home"), true);

  const taskNextVersion = JSON.parse(readFileSync(join(PROJECT_ROOT, "node_modules/next/package.json"), "utf8")).version;
  const mainNextVersion = JSON.parse(readFileSync(join(mainRoot, "node_modules/next/package.json"), "utf8")).version;
  assert.equal(taskNextVersion, "16.2.11");
  assert.equal(mainNextVersion, taskNextVersion);

  return { nextDirectory, snapshot: artifactSnapshot(nextDirectory) };
}

function copyProductionFixture(sourceRoot, sourceNextDirectory, fixtureRoot) {
  mkdirSync(fixtureRoot, { recursive: true });
  cpSync(sourceNextDirectory, join(fixtureRoot, ".next"), {
    recursive: true,
    filter(source) {
      return includesProductionArtifactPath(relative(sourceNextDirectory, source));
    },
  });
  cpSync(join(sourceRoot, "package.json"), join(fixtureRoot, "package.json"));
  if (existsSync(join(sourceRoot, "next.config.ts"))) {
    cpSync(join(sourceRoot, "next.config.ts"), join(fixtureRoot, "next.config.ts"));
  }
  if (existsSync(join(sourceRoot, "public"))) {
    cpSync(join(sourceRoot, "public"), join(fixtureRoot, "public"), { recursive: true });
  }
  symlinkSync(join(PROJECT_ROOT, "node_modules"), join(fixtureRoot, "node_modules"), "dir");
}

function writeProductionLifecycleChild(directory) {
  const file = join(directory, "production-lifecycle-child.cjs");
  const source = String.raw`"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { startPiWebServer } = require(path.join(process.cwd(), "bin", "pi-web-server.js"));
const { PI_WEB_TRANSPORT_GATEWAY_SLOT } = require(path.join(process.cwd(), "bin", "pi-web-transport-gateway.js"));

(async () => {
  const fixture = process.env.PI_WEB_PRODUCTION_FIXTURE;
  const diagnostics = [];
  const first = await startPiWebServer({
    dev: false,
    dir: fixture,
    hostname: "127.0.0.1",
    port: 0,
    lifecycleOwner: "programmatic",
    diagnostics: (entry) => diagnostics.push(entry),
  });
  const port = first.address.port;
  const firstResponse = await fetch("http://127.0.0.1:" + port + "/api/home");
  assert.equal(firstResponse.status, 200);
  await first.close();
  assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
  assert.deepEqual(first.gateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
  process.stdout.write("PRODUCTION_FIRST_CLOSED\n");

  const second = await startPiWebServer({
    dev: false,
    dir: fixture,
    hostname: "127.0.0.1",
    port,
    lifecycleOwner: "programmatic",
    diagnostics: (entry) => diagnostics.push(entry),
  });
  assert.equal(second.address.port, port);
  const secondResponse = await fetch("http://127.0.0.1:" + port + "/api/home");
  assert.equal(secondResponse.status, 200);
  await second.close();
  assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
  assert.deepEqual(second.gateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
  const closed = diagnostics.filter((entry) => entry.event === "server_closed");
  assert.equal(closed.length, 2);
  assert.equal(closed.every((entry) =>
    entry.mode === "production" &&
    entry.lifecycleOwner === "programmatic" &&
    entry.outcome === "graceful" &&
    entry.activePiWebSocketCount === 0 &&
    entry.openConnectionCount === 0 &&
    entry.registeredChannelCount === 0 &&
    entry.pendingTicketCount === 0 &&
    entry.activeTicketTimerCount === 0 &&
    entry.activeConnectionCount === 0 &&
    entry.activePeerKeyCount === 0
  ), true);
  process.stdout.write("PRODUCTION_SECOND_CLOSED\n");
})().catch((error) => {
  process.stderr.write("PRODUCTION_LIFECYCLE_FAILED:" + (error?.name ?? "Error") + "\n");
  process.exitCode = 1;
});
`;
  assert.equal(/process\.exit\s*\(/.test(source), false);
  writeFileSync(file, source);
  return file;
}

async function exerciseProductionLifecycle(directory) {
  const mainRoot = mainProjectRoot();
  const { nextDirectory, snapshot } = preflightProductionArtifact(mainRoot);
  const fixtureRoot = join(directory, "production-fixture");
  copyProductionFixture(mainRoot, nextDirectory, fixtureRoot);
  const childFile = writeProductionLifecycleChild(directory);
  const captured = spawnNode([childFile], {
    env: { PI_WEB_PRODUCTION_FIXTURE: fixtureRoot },
  });

  const result = await captured.waitForExit("production_lifecycle", 120_000);
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(captured.stdout.includes("PRODUCTION_FIRST_CLOSED"), true);
  assert.equal(captured.stdout.includes("PRODUCTION_SECOND_CLOSED"), true);
  assert.equal(captured.stderr.includes("PRODUCTION_LIFECYCLE_FAILED"), false);
  assert.deepEqual(artifactSnapshot(nextDirectory), snapshot);
}

test("real Next development, terminal signals, and production lifecycle are process-safe", {
  timeout: 8 * 60_000,
}, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-real-next-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  await t.test("terminal CLI latches the first signal and closes exactly once", async () => {
    const launcher = writeFakeLauncherFixture(directory);
    await runFakeSignalCase(launcher, ["SIGINT"], 130);
    await runFakeSignalCase(launcher, ["SIGTERM"], 143);
    await runFakeSignalCase(launcher, ["SIGINT", "SIGINT"], 130);
    await runFakeSignalCase(launcher, ["SIGTERM", "SIGTERM"], 143);
    await runFakeSignalCase(launcher, ["SIGINT", "SIGTERM"], 130);
    await runFakeSignalCase(launcher, ["SIGTERM", "SIGINT"], 143);
    await runFakeSignalCase(launcher, ["SIGINT", "SIGTERM"], 130, {
      duringStartup: true,
    });
    await runFakeSignalCase(launcher, ["SIGTERM", "SIGINT"], 1, {
      failClose: true,
    });
  });

  await t.test("direct and shell-wrapped Serve commands follow owned cleanup and local fallback", async () => {
    const launcher = writeFakeLauncherFixture(directory);
    for (const shape of ["direct", "shell"]) {
      const tailscaleDirectory = writeFakeTailscaleFixture(directory, shape);
      await runFakeServeProgrammaticClose(directory, launcher, tailscaleDirectory, shape);
      await runFakeServeSignalCase(
        directory,
        launcher,
        tailscaleDirectory,
        shape,
        "SIGINT",
        "ready",
      );
      await runFakeServeSignalCase(
        directory,
        launcher,
        tailscaleDirectory,
        shape,
        "SIGTERM",
        "ready",
      );
      await runFakeServeSignalCase(
        directory,
        launcher,
        tailscaleDirectory,
        shape,
        "SIGINT",
        "delayed",
      );
      await runFakeServeSignalCase(
        directory,
        launcher,
        tailscaleDirectory,
        shape,
        "SIGTERM",
        "delayed",
      );
      await runFakeServeExitCase(directory, launcher, tailscaleDirectory, shape, "early");
      await runFakeServeExitCase(directory, launcher, tailscaleDirectory, shape, "unexpected");
    }
    await runUnconfirmedCleanupTerminalCase(directory, launcher);
  });

  await t.test("real development shares the gateway, preserves HMR, exits, and rebinds", async () => {
    await exerciseRealDevelopmentProcess(directory);
  });

  await t.test("copied real production artifact restarts and drains in one child", async () => {
    await exerciseProductionLifecycle(directory);
  });
});
