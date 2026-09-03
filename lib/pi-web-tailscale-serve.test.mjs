import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  TAILSCALE_SERVE_CLEANUP_GRACE_MS,
  TAILSCALE_SERVE_FORCE_WAIT_MS,
  TAILSCALE_SERVE_READY_MARKER,
  TAILSCALE_SERVE_STARTUP_TIMEOUT_MS,
  startTailscaleServe,
} = require("../bin/pi-web-tailscale-serve.js");

function clock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const timer = { id: nextId++, at: now + delay, callback };
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timers.delete(timer.id);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (;;) {
        const due = [...timers.values()]
          .filter((timer) => timer.at <= now)
          .sort((left, right) => left.at - right.at)[0];
        if (!due) break;
        timers.delete(due.id);
        due.callback();
      }
    },
    count: () => timers.size,
  };
}

function fakeChild({ pid = 7311, exitOnDirectKill = true, directKillResult = true } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = [];
  child.unrefCalls = 0;
  child.kill = (signal) => {
    child.killCalls.push(signal);
    if (exitOnDirectKill) {
      queueMicrotask(() => {
        child.emit("exit", null, signal);
        child.emit("close", null, signal);
      });
    }
    return directKillResult;
  };
  child.unref = () => { child.unrefCalls += 1; };
  return child;
}

function spawnRecorder(child) {
  const calls = [];
  return {
    calls,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  };
}

function writeReadyMarker(child, fragments = [TAILSCALE_SERVE_READY_MARKER]) {
  for (const fragment of fragments) child.stdout.write(fragment);
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function unixOptions(child, extra = {}) {
  const processKillCalls = [];
  return {
    processKillCalls,
    options: {
      port: 31041,
      platform: "darwin",
      spawn: () => child,
      processKill(pid, signal) {
        processKillCalls.push([pid, signal]);
        return true;
      },
      ...extra,
    },
  };
}

test("Unix spawn creates one attached foreground process group and signals it", async () => {
  const child = fakeChild();
  const recorder = spawnRecorder(child);
  const processKillCalls = [];
  const starting = startTailscaleServe({
    port: 31041,
    platform: "darwin",
    spawn: recorder.spawn,
    processKill(pid, signal) {
      processKillCalls.push([pid, signal]);
      queueMicrotask(() => {
        child.emit("exit", null, signal);
        child.emit("close", null, signal);
      });
      return true;
    },
  });

  child.stderr.write("private stderr with a MagicDNS name");
  writeReadyMarker(child, ["private prefix Press Ctrl", "+C to ", "exit. private suffix"]);
  const owner = await starting;

  assert.deepEqual(recorder.calls, [{
    command: "tailscale",
    args: ["serve", "--https=31041", "http://127.0.0.1:31041"],
    options: {
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  }]);
  assert.equal(child.unrefCalls, 0);

  const firstClose = owner.close();
  assert.equal(owner.close(), firstClose);
  await firstClose;
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"]]);
  assert.deepEqual(child.killCalls, []);
});

test("Windows preserves direct-child signaling without a Unix process group", async () => {
  const child = fakeChild();
  const recorder = spawnRecorder(child);
  const starting = startTailscaleServe({
    port: 31042,
    platform: "win32",
    spawn: recorder.spawn,
  });
  writeReadyMarker(child);
  const owner = await starting;
  await owner.close("SIGTERM");

  assert.equal(recorder.calls[0].options.detached, false);
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
  assert.equal(child.unrefCalls, 0);
});

test("Windows force cleanup remains limited to the direct child", async () => {
  const child = fakeChild({ exitOnDirectKill: false });
  const cleanupClock = clock();
  const starting = startTailscaleServe({
    port: 31042,
    platform: "win32",
    spawn: () => child,
    setTimeout: cleanupClock.setTimeout,
    clearTimeout: cleanupClock.clearTimeout,
  });
  writeReadyMarker(child);
  const owner = await starting;
  const closing = owner.close();

  cleanupClock.advance(TAILSCALE_SERVE_CLEANUP_GRACE_MS);
  await flushAsync();
  assert.deepEqual(child.killCalls, ["SIGINT", "SIGKILL"]);
  child.emit("exit", null, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  await closing;
});

test("reports spawn errors and early exits only after confirmed close", async () => {
  const missing = fakeChild({ pid: null, exitOnDirectKill: false });
  const missingStart = startTailscaleServe({
    port: 31043,
    platform: "darwin",
    spawn: () => missing,
    processKill: () => { throw new Error("must not signal"); },
  });
  missing.stderr.write("private executable path and daemon payload");
  missing.emit("error", new Error("private executable path"));
  missing.emit("close", null, null);
  await assert.rejects(
    missingStart,
    (error) => error?.code === "tailscale_serve_spawn_failed" &&
      !String(error).includes("private"),
  );

  const early = fakeChild();
  const { options, processKillCalls } = unixOptions(early, { port: 31044 });
  const earlyStart = startTailscaleServe(options);
  early.stdout.write("private hostname without the marker");
  early.emit("exit", 17, null);
  let settled = false;
  void earlyStart.catch(() => { settled = true; });
  await flushAsync();
  assert.equal(settled, false, "exit alone is not complete cleanup");
  assert.deepEqual(processKillCalls, []);
  early.emit("close", 17, null);
  await assert.rejects(
    earlyStart,
    (error) => error?.code === "tailscale_serve_exited_before_ready" &&
      !String(error).includes("private"),
  );
});

test("does not accept a readiness marker when exit wins the same turn", async () => {
  const child = fakeChild();
  const { options } = unixOptions(child, { port: 31045 });
  const starting = startTailscaleServe(options);
  writeReadyMarker(child);
  child.emit("exit", 1, null);
  child.emit("close", 1, null);
  await assert.rejects(
    starting,
    (error) => error?.code === "tailscale_serve_exited_before_ready",
  );
});

test("readiness timeout and startup cancellation use bounded shared cleanup", async () => {
  assert.equal(TAILSCALE_SERVE_STARTUP_TIMEOUT_MS, 60_000);

  const timedOut = fakeChild();
  const timeoutClock = clock();
  const timeoutKills = [];
  const timeoutStart = startTailscaleServe({
    port: 31046,
    platform: "darwin",
    spawn: () => timedOut,
    processKill(pid, signal) {
      timeoutKills.push([pid, signal]);
      queueMicrotask(() => {
        timedOut.emit("exit", null, signal);
        timedOut.emit("close", null, signal);
      });
      return true;
    },
    setTimeout: timeoutClock.setTimeout,
    clearTimeout: timeoutClock.clearTimeout,
  });
  timeoutClock.advance(TAILSCALE_SERVE_STARTUP_TIMEOUT_MS);
  await assert.rejects(
    timeoutStart,
    (error) => error?.code === "tailscale_serve_readiness_timeout",
  );
  assert.deepEqual(timeoutKills, [[-7311, "SIGINT"]]);

  const cancelled = fakeChild();
  const controller = new AbortController();
  const { options, processKillCalls } = unixOptions(cancelled, {
    port: 31047,
    signal: controller.signal,
    processKill(pid, signal) {
      processKillCalls.push([pid, signal]);
      return true;
    },
  });
  const cancelledStart = startTailscaleServe(options);
  controller.abort("SIGTERM");
  await flushAsync();
  assert.deepEqual(processKillCalls, [[-7311, "SIGTERM"]]);
  let settled = false;
  void cancelledStart.catch(() => { settled = true; });
  await flushAsync();
  assert.equal(settled, false);
  cancelled.emit("exit", null, "SIGTERM");
  await flushAsync();
  assert.equal(settled, false);
  cancelled.emit("close", null, "SIGTERM");
  await assert.rejects(
    cancelledStart,
    (error) => error?.name === "AbortError" &&
      error?.code === "tailscale_serve_startup_aborted",
  );
});

test("direct-child exit clears group ownership while close remains the success boundary", async () => {
  const child = fakeChild();
  const cleanupClock = clock();
  const { options, processKillCalls } = unixOptions(child, {
    setTimeout: cleanupClock.setTimeout,
    clearTimeout: cleanupClock.clearTimeout,
  });
  const starting = startTailscaleServe(options);
  writeReadyMarker(child);
  const owner = await starting;

  let settled = false;
  const closing = owner.close().then(() => { settled = true; });
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"]]);
  child.emit("exit", null, "SIGINT");
  await flushAsync();
  assert.equal(settled, false);

  cleanupClock.advance(TAILSCALE_SERVE_CLEANUP_GRACE_MS);
  await flushAsync();
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"]], "cleared group id is never reused");
  assert.equal(settled, false);

  child.emit("close", null, "SIGINT");
  await closing;
  assert.equal(settled, true);
  assert.equal(cleanupClock.count(), 0);
});

test("cleanup force-stops the still-owned group only after the first fixed wait", async () => {
  assert.equal(TAILSCALE_SERVE_CLEANUP_GRACE_MS, 10_000);
  assert.equal(TAILSCALE_SERVE_FORCE_WAIT_MS, 10_000);
  const child = fakeChild();
  const cleanupClock = clock();
  const warnings = [];
  const { options, processKillCalls } = unixOptions(child, {
    setTimeout: cleanupClock.setTimeout,
    clearTimeout: cleanupClock.clearTimeout,
    warn: (message) => warnings.push(message),
  });
  const starting = startTailscaleServe(options);
  writeReadyMarker(child);
  const owner = await starting;
  const closing = owner.close();

  cleanupClock.advance(TAILSCALE_SERVE_CLEANUP_GRACE_MS - 1);
  await flushAsync();
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"]]);
  cleanupClock.advance(1);
  await flushAsync();
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"], [-7311, "SIGKILL"]]);
  assert.deepEqual(warnings, ["[pi-web] Tailscale cleanup required a forced stop."]);

  cleanupClock.advance(TAILSCALE_SERVE_FORCE_WAIT_MS - 1);
  await flushAsync();
  child.emit("exit", null, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  await closing;
  assert.equal(cleanupClock.count(), 0);
});

test("a failed force signal is reported even if close is later confirmed", async () => {
  const child = fakeChild();
  const cleanupClock = clock();
  const processKillCalls = [];
  const starting = startTailscaleServe({
    port: 31050,
    platform: "darwin",
    spawn: () => child,
    processKill(pid, signal) {
      processKillCalls.push([pid, signal]);
      if (signal === "SIGKILL") throw new Error("private force failure");
      return true;
    },
    setTimeout: cleanupClock.setTimeout,
    clearTimeout: cleanupClock.clearTimeout,
  });
  writeReadyMarker(child);
  const owner = await starting;
  const closing = owner.close();

  cleanupClock.advance(TAILSCALE_SERVE_CLEANUP_GRACE_MS);
  await flushAsync();
  child.emit("exit", null, "SIGKILL");
  child.emit("close", null, "SIGKILL");
  await assert.rejects(
    closing,
    (error) => error?.code === "tailscale_serve_shutdown_failed" &&
      !String(error).includes("private"),
  );
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"], [-7311, "SIGKILL"]]);
});

test("cleanup returns one generic unconfirmed error after both fixed waits", async () => {
  const child = fakeChild();
  const cleanupClock = clock();
  const { options, processKillCalls } = unixOptions(child, {
    setTimeout: cleanupClock.setTimeout,
    clearTimeout: cleanupClock.clearTimeout,
  });
  const starting = startTailscaleServe(options);
  writeReadyMarker(child);
  const owner = await starting;
  const closing = owner.close();
  assert.equal(owner.close("SIGTERM"), closing);

  cleanupClock.advance(TAILSCALE_SERVE_CLEANUP_GRACE_MS);
  await flushAsync();
  cleanupClock.advance(TAILSCALE_SERVE_FORCE_WAIT_MS);
  await assert.rejects(
    closing,
    (error) => error?.code === "tailscale_serve_cleanup_unconfirmed" &&
      !String(error).includes("7311"),
  );
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"], [-7311, "SIGKILL"]]);
});

test("signal failures are caught, checked, and cannot claim successful cleanup", async () => {
  for (const failure of ["false", "throw", "error-event"]) {
    const child = fakeChild();
    const cleanupClock = clock();
    const calls = [];
    const starting = startTailscaleServe({
      port: 31049,
      platform: "darwin",
      spawn: () => child,
      processKill(pid, signal) {
        calls.push([pid, signal]);
        if (signal === "SIGINT" && failure === "false") return false;
        if (signal === "SIGINT" && failure === "throw") throw new Error("private signal failure");
        return true;
      },
      setTimeout: cleanupClock.setTimeout,
      clearTimeout: cleanupClock.clearTimeout,
    });
    writeReadyMarker(child);
    const owner = await starting;
    const closing = owner.close();
    if (failure === "error-event") child.emit("error", new Error("private async failure"));
    child.emit("exit", null, "SIGINT");
    child.emit("close", null, "SIGINT");
    await assert.rejects(
      closing,
      (error) => error?.code === "tailscale_serve_shutdown_failed" &&
        !String(error).includes("private"),
    );
    assert.deepEqual(calls, [[-7311, "SIGINT"]]);
  }
});

test("a cleared group is not force-signaled and final wait still remains bounded", async () => {
  const child = fakeChild();
  const cleanupClock = clock();
  const { options, processKillCalls } = unixOptions(child, {
    setTimeout: cleanupClock.setTimeout,
    clearTimeout: cleanupClock.clearTimeout,
  });
  const starting = startTailscaleServe(options);
  writeReadyMarker(child);
  const owner = await starting;
  const closing = owner.close();
  child.emit("exit", null, "SIGINT");

  cleanupClock.advance(TAILSCALE_SERVE_CLEANUP_GRACE_MS);
  await flushAsync();
  cleanupClock.advance(TAILSCALE_SERVE_FORCE_WAIT_MS);
  await assert.rejects(closing, (error) => error?.code === "tailscale_serve_cleanup_unconfirmed");
  assert.deepEqual(processKillCalls, [[-7311, "SIGINT"]]);
});

test("notifies once after a ready unexpected exit and never signals its cleared id", async () => {
  const child = fakeChild();
  const { options, processKillCalls } = unixOptions(child, { port: 31048 });
  const starting = startTailscaleServe(options);
  writeReadyMarker(child);
  const owner = await starting;

  child.emit("exit", 23, null);
  assert.deepEqual(await owner.unexpectedExit, { reason: "exited" });
  const closing = owner.close();
  child.emit("close", 23, null);
  await closing;
  assert.deepEqual(processKillCalls, []);
});

test("rejects unsafe helper ports without spawning", async () => {
  for (const port of [0, 443, 65_536, Number.NaN]) {
    let spawnCalls = 0;
    await assert.rejects(
      startTailscaleServe({ port, spawn: () => { spawnCalls += 1; } }),
      (error) => error?.code === "tailscale_serve_invalid_port",
    );
    assert.equal(spawnCalls, 0);
  }
});

test("runtime source excludes wrapper parsing, discovery, restart, and shared Serve mutation", () => {
  const binDirectory = new URL("../bin/", import.meta.url);
  const helperSource = readFileSync(new URL("pi-web-tailscale-serve.js", binDirectory), "utf8");
  const source = readdirSync(binDirectory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(new URL(name, binDirectory), "utf8"))
    .join("\n");
  const audits = [
    {
      pattern: /["']tailscale["']\s*,\s*\[(?=[^\]]*["']status["'])/,
      canaries: ["spawn('tailscale', ['status'])", 'spawn("tailscale", ["status"])'],
    },
    {
      pattern: /["']serve["']\s*,\s*["']status["']/,
      canaries: ["['serve', 'status']", '["serve", "status"]'],
    },
    {
      pattern: /["']--bg["']/,
      canaries: ["['--bg']", '["--bg"]'],
    },
    ...["funnel", "off", "reset", "clear"].map((command) => ({
      pattern: new RegExp(`["']${command}["']`, "i"),
      canaries: [`['${command}']`, `["${command}"]`],
    })),
    { pattern: /\bpkill\b/, canaries: ["pkill"] },
    { pattern: /\bkillall\b/, canaries: ["killall"] },
    { pattern: /["']ps["']\s*,/, canaries: ["spawn('ps', ['ax'])"] },
    { pattern: /ServeConfig/, canaries: ["ServeConfig"] },
    { pattern: /LocalAPI/, canaries: ["LocalAPI"] },
    { pattern: /set-config/, canaries: ["set-config"] },
  ];

  for (const { pattern, canaries } of audits) {
    assert.equal(pattern.test(source), false);
    for (const canary of canaries) assert.equal(pattern.test(canary), true);
  }
  assert.equal(/\.unref\s*\(/.test(helperSource), false);
  assert.equal(/readFile|createReadStream|\/usr\/local\/bin\/tailscale/.test(helperSource), false);
  assert.equal(/setInterval\s*\(/.test(helperSource), false);
});
