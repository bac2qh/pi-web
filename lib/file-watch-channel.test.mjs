import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { createPiWebTransportGateway } = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  FILE_WATCH_REGISTRATION_TEST_SYMBOL, createFileWatchChannelHandler,
  createFileWatchTicketContext, ensureFileWatchChannel,
} = await jiti.import("./file-watch-channel.ts");
const { normalizeAbsoluteFilePath } = await jiti.import("./file-authorization.ts");

class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.frames = []; this.closeCalls = []; this.sendError = null; }
  send(text, callback) { this.frames.push(JSON.parse(text)); callback?.(this.sendError); }
  close(code) { this.closeCalls.push(code); this.readyState = 3; this.emit("close", code); }
  terminate() { this.close(1006); }
}
class Watcher extends EventEmitter {
  constructor() { super(); this.closeCalls = 0; }
  close() { this.closeCalls += 1; }
}
function stats(size, file = true) { return { size, isFile: () => file }; }
function harness({ observationClass = "ordinary", beforeAllocate } = {}) {
  const watches = [], timers = new Map(); let nextTimer = 1; let current = stats(7);
  const dependencies = {
    watch(target, listener) { const watcher = new Watcher(); watches.push({ target, listener, watcher }); return watcher; },
    stat() { if (current instanceof Error) throw current; return current; },
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay, unref() {} }); return id; },
    clearTimeout(id) { timers.delete(id); }, beforeAllocate,
  };
  const socket = new Socket();
  const context = { channel: "file-watch", serverInstanceId: "server", ticketContext: createFileWatchTicketContext("/synthetic/target.txt", observationClass) };
  return {
    watches, timers, socket, context, dependencies,
    setStat(value) { current = value; },
    runTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
  };
}

test.afterEach(() => { delete globalThis[FILE_WATCH_REGISTRATION_TEST_SYMBOL]; });

test("allocates one parent watcher only in consumed handler and sends connected first", async () => {
  const h = harness();
  const handler = createFileWatchChannelHandler(h.dependencies, { coalesceMs: 5 });
  assert.equal(h.watches.length, 0);
  await handler(h.socket, h.context);
  assert.equal(h.watches.length, 1);
  assert.equal(h.watches[0].target, path.dirname("/synthetic/target.txt"));
  assert.deepEqual(h.socket.frames, [{
    protocol: "pi-web-file-watch", version: 1, serverInstanceId: "server", type: "connected",
    changeCount: 0, exists: true, size: 7,
  }]);
  assert.equal(JSON.stringify(h.socket.frames).includes("synthetic"), false);
});

test("ordinary watcher filters siblings and coalesces filename string, Buffer, and null to latest observation", async () => {
  const h = harness(); await createFileWatchChannelHandler(h.dependencies)(h.socket, h.context);
  const watch = h.watches[0];
  watch.listener("change", "sibling.txt");
  assert.equal(h.timers.size, 0);
  watch.listener("rename", Buffer.from("target.txt"));
  watch.listener("change", null);
  assert.equal(h.timers.size, 1);
  h.setStat(new Error("gone")); h.runTimer();
  assert.deepEqual(h.socket.frames.at(-1), {
    protocol: "pi-web-file-watch", version: 1, serverInstanceId: "server", type: "change",
    changeCount: 1, exists: false, size: 0,
  });
  watch.listener("rename", "target.txt"); h.setStat(stats(Number.MAX_SAFE_INTEGER + 100)); h.runTimer();
  assert.equal(h.socket.frames.at(-1).size, Number.MAX_SAFE_INTEGER);
  assert.equal(h.socket.frames.at(-1).changeCount, 2);
});

test("normalized slash-form UNC basenames compare case-insensitively while POSIX remains case-sensitive", async () => {
  const normalizedUnc = normalizeAbsoluteFilePath("\\\\Server\\Share\\MixedCase.TXT");
  assert.equal(normalizedUnc, "//Server/Share/MixedCase.TXT");
  const injected = harness();
  injected.context.ticketContext = createFileWatchTicketContext(normalizedUnc, "ordinary");
  await createFileWatchChannelHandler(injected.dependencies)(injected.socket, injected.context);
  injected.watches[0].listener("change", "mixedcase.txt");
  assert.equal(injected.timers.size, 1);
  injected.runTimer();
  assert.equal(injected.socket.frames.at(-1).changeCount, 1);

  const posix = harness();
  await createFileWatchChannelHandler(posix.dependencies)(posix.socket, posix.context);
  posix.watches[0].listener("change", "TARGET.TXT");
  assert.equal(posix.timers.size, 0);
  posix.watches[0].listener("change", "target.txt");
  assert.equal(posix.timers.size, 1);
});

test("final-component symlinks retain one direct-path watcher", async () => {
  const h = harness({ observationClass: "symlink" });
  await createFileWatchChannelHandler(h.dependencies)(h.socket, h.context);
  assert.equal(h.watches.length, 1);
  assert.equal(h.watches[0].target, "/synthetic/target.txt");
  h.watches[0].listener("change", "any-name"); h.runTimer();
  assert.equal(h.socket.frames.at(-1).type, "change");
});

test("every close, watcher, send, and duplicate terminal path cleans one watcher/timer", async () => {
  for (const terminal of ["socket", "watcher", "send"]) {
    const h = harness(); await createFileWatchChannelHandler(h.dependencies)(h.socket, h.context);
    h.watches[0].listener("change", "target.txt");
    if (terminal === "socket") h.socket.emit("close");
    if (terminal === "watcher") h.watches[0].watcher.emit("error", new Error("private"));
    if (terminal === "send") { h.socket.sendError = new Error("private"); h.runTimer(); }
    h.socket.emit("close"); h.watches[0].watcher.emit("error", new Error("duplicate"));
    assert.equal(h.watches[0].watcher.closeCalls, 1);
    assert.equal(h.timers.size, 0);
  }
});

test("change count closes retryably before overflow instead of wrapping", async () => {
  const h = harness();
  await createFileWatchChannelHandler(h.dependencies, { maximumChangeCount: 1 })(h.socket, h.context);
  h.watches[0].listener("change", "target.txt"); h.runTimer();
  assert.equal(h.socket.frames.at(-1).changeCount, 1);
  h.watches[0].listener("change", "target.txt"); h.runTimer();
  assert.deepEqual(h.socket.closeCalls, [1011]);
  assert.equal(h.watches[0].watcher.closeCalls, 1);
});

test("binary and text application input close with exact policy codes", async () => {
  for (const [binary, code] of [[true, 1003], [false, 1008]]) {
    const h = harness(); await createFileWatchChannelHandler(h.dependencies)(h.socket, h.context);
    h.socket.emit("message", Buffer.from("hostile"), binary);
    assert.deepEqual(h.socket.closeCalls, [code]);
    assert.equal(h.watches[0].watcher.closeCalls, 1);
  }
});

test("close and owner replacement winning deferred setup allocate no watcher", async () => {
  for (const outcome of ["close", "owner"]) {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    let current = true;
    const h = harness({ beforeAllocate: () => gate });
    const pending = createFileWatchChannelHandler(h.dependencies, { isCurrentOwner: () => current })(h.socket, h.context);
    if (outcome === "close") h.socket.emit("close"); else current = false;
    release(); await pending;
    assert.equal(h.watches.length, 0);
    if (outcome === "owner") assert.deepEqual(h.socket.closeCalls, [1012]);
  }
});

test("malformed frozen context and closed socket fail before allocation", async () => {
  for (const context of [
    undefined,
    Object.freeze({ protocol: "wrong" }),
    Object.freeze({ protocol: "pi-web-file-watch-ticket-context", version: 1, owner: "pi-web", filePath: "relative", observationClass: "ordinary" }),
    Object.freeze({ protocol: "pi-web-file-watch-ticket-context", version: 1, owner: "pi-web", filePath: "/synthetic/../not-normal", observationClass: "ordinary" }),
  ]) {
    const h = harness(); await createFileWatchChannelHandler(h.dependencies)(h.socket, { ...h.context, ticketContext: context });
    assert.equal(h.watches.length, 0); assert.deepEqual(h.socket.closeCalls, [1011]);
  }
  const h = harness(); h.socket.readyState = 3; await createFileWatchChannelHandler(h.dependencies)(h.socket, h.context);
  assert.equal(h.watches.length, 0);
});

test("HMR registration reuses current owner and replacement closes its active subscription with 1012", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-web-file-watch-hmr-"));
  const target = path.join(directory, "target.txt");
  fs.writeFileSync(target, "fixture");
  const firstGateway = createPiWebTransportGateway();
  const secondGateway = createPiWebTransportGateway();
  try {
    assert.deepEqual(ensureFileWatchChannel(firstGateway), { channel: "file-watch", reused: false });
    assert.deepEqual(ensureFileWatchChannel(firstGateway), { channel: "file-watch", reused: true });
    const ticket = firstGateway.issueTicket("file-watch", createFileWatchTicketContext(target, "ordinary"));
    const authorization = firstGateway.consumeTicket(ticket.ticket);
    const socket = new Socket();
    await authorization.handler(socket, {
      channel: "file-watch", serverInstanceId: firstGateway.serverInstanceId,
      ticketContext: authorization.ticketContext,
    });
    assert.equal(socket.frames[0].type, "connected");
    ensureFileWatchChannel(secondGateway);
    assert.deepEqual(socket.closeCalls, [1012]);
    assert.equal(firstGateway.getStats().registeredChannelCount, 0);
    assert.equal(secondGateway.getStats().registeredChannelCount, 1);
  } finally {
    firstGateway.close(); secondGateway.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForFileWatchPhase(label, predicate, mutate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let nextRetryAt = Date.now() + 350;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (mutate && Date.now() >= nextRetryAt) {
      mutate();
      nextRetryAt = Date.now() + 350;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`file_watch_phase_timeout:${label}`);
}

async function waitForFileWatchQuiet(label, currentCount, quietMs = 200, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let observed = currentCount();
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const next = currentCount();
    if (next !== observed) {
      observed = next;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) return observed;
  }
  assert.fail(`file_watch_phase_timeout:${label}`);
}

test("real final-component symlink retains one direct-path watcher and OS-dependent parity boundary", async (t) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-web-file-watch-symlink-"));
  const referent = path.join(directory, "referent.txt");
  const link = path.join(directory, "link.txt");
  fs.writeFileSync(referent, "one");
  try { fs.symlinkSync(referent, link); } catch { t.skip("symbolic links unavailable"); return; }
  const socket = new Socket();
  let watchedTarget = null;
  let activeWatchers = 0;
  try {
    await createFileWatchChannelHandler({
      watch(target, listener) {
        watchedTarget = target;
        const watcher = fs.watch(target, listener);
        activeWatchers += 1;
        return { on(event, callback) { watcher.on(event, callback); return this; }, close() { if (activeWatchers) activeWatchers -= 1; watcher.close(); } };
      },
      stat(target) { return fs.statSync(target); }, setTimeout, clearTimeout,
    })(socket, {
      channel: "file-watch", serverInstanceId: "server",
      ticketContext: createFileWatchTicketContext(link, "symlink"),
    });
    assert.equal(watchedTarget, link);
    assert.equal(activeWatchers, 1);
    socket.emit("close");
    assert.equal(activeWatchers, 0);
  } finally { socket.emit("close"); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("real parent-directory watcher converges through modify, atomic replace, delete, recreate, and later modify without siblings", async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-web-file-watch-channel-"));
  const target = path.join(directory, "target.txt");
  const sibling = path.join(directory, "sibling.txt");
  fs.writeFileSync(target, "one");
  const socket = new Socket();
  const activeWatchers = new Set();
  const dependencies = {
    watch(watchedDirectory, listener) {
      const watcher = fs.watch(watchedDirectory, listener);
      const owned = {
        on(event, callback) { watcher.on(event, callback); return owned; },
        close() { activeWatchers.delete(owned); watcher.close(); },
      };
      activeWatchers.add(owned);
      return owned;
    },
    stat(watchedPath) { return fs.statSync(watchedPath); },
    setTimeout,
    clearTimeout,
  };
  const context = { channel: "file-watch", serverInstanceId: "server", ticketContext: createFileWatchTicketContext(target, "ordinary") };
  let mutation = 0;
  let recreateCycleCount = 0;
  let recreateRetryCount = 0;
  let recreateAbsentObservationCount = 0;
  const appendTarget = (prefix) => fs.appendFileSync(target, `${prefix}-${mutation++}`);
  const replaceTarget = () => {
    const replacement = path.join(directory, `replacement-${mutation++}.tmp`);
    fs.writeFileSync(replacement, `replacement-${mutation}`);
    fs.renameSync(replacement, target);
  };
  const deleteTarget = () => {
    if (!fs.existsSync(target)) fs.writeFileSync(target, `delete-retry-${mutation++}`);
    fs.unlinkSync(target);
  };
  const recreateTarget = () => {
    recreateCycleCount += 1;
    if (fs.existsSync(target)) fs.unlinkSync(target);
    assert.equal(fs.existsSync(target), false, "file_watch_phase:recreate_absent_before_present");
    recreateAbsentObservationCount += 1;
    fs.writeFileSync(target, `recreated-${mutation++}`);
  };
  try {
    await createFileWatchChannelHandler(dependencies, { coalesceMs: 10 })(socket, context);
    assert.equal(socket.frames[0].type, "connected", "file_watch_phase:connected");

    let baseline = await waitForFileWatchQuiet("connected_quiet", () => socket.frames.at(-1).changeCount);
    assert.equal(socket.frames.at(-1).exists, true, "file_watch_phase:connected_present_baseline");
    appendTarget("modify");
    await waitForFileWatchPhase("modify", () => socket.frames.at(-1).exists && socket.frames.at(-1).changeCount > baseline, () => appendTarget("modify-retry"));

    baseline = await waitForFileWatchQuiet("modify_quiet", () => socket.frames.at(-1).changeCount);
    assert.equal(socket.frames.at(-1).exists, true, "file_watch_phase:modify_present_baseline");
    replaceTarget();
    await waitForFileWatchPhase("atomic_replace", () => socket.frames.at(-1).exists && socket.frames.at(-1).changeCount > baseline, replaceTarget);

    baseline = await waitForFileWatchQuiet("atomic_replace_quiet", () => socket.frames.at(-1).changeCount);
    assert.equal(socket.frames.at(-1).exists, true, "file_watch_phase:atomic_replace_present_baseline");
    deleteTarget();
    await waitForFileWatchPhase("delete", () => !socket.frames.at(-1).exists && socket.frames.at(-1).changeCount > baseline, deleteTarget);

    baseline = await waitForFileWatchQuiet("delete_absent_quiet", () => socket.frames.at(-1).changeCount);
    assert.equal(fs.existsSync(target), false, "file_watch_phase:delete_filesystem_absent_baseline");
    assert.equal(socket.frames.at(-1).exists, false, "file_watch_phase:delete_observed_absent_baseline");
    recreateTarget();
    await waitForFileWatchPhase(
      "recreate_present",
      () => socket.frames.at(-1).exists && socket.frames.at(-1).changeCount > baseline,
      () => { recreateRetryCount += 1; recreateTarget(); },
    );
    assert.equal(recreateCycleCount, recreateRetryCount + 1, "file_watch_phase:recreate_each_retry_is_cycle");
    assert.equal(recreateAbsentObservationCount, recreateCycleCount, "file_watch_phase:recreate_observed_absent_each_cycle");

    baseline = await waitForFileWatchQuiet("recreate_present_quiet", () => socket.frames.at(-1).changeCount);
    assert.equal(fs.existsSync(target), true, "file_watch_phase:recreate_filesystem_present_baseline");
    assert.equal(socket.frames.at(-1).exists, true, "file_watch_phase:recreate_observed_present_baseline");
    appendTarget("later-modify");
    await waitForFileWatchPhase("later_modify", () => socket.frames.at(-1).exists && socket.frames.at(-1).changeCount > baseline, () => appendTarget("later-modify-retry"));

    const quietCount = await waitForFileWatchQuiet("later_modify_quiet", () => socket.frames.at(-1).changeCount);
    assert.equal(socket.frames.at(-1).exists, true, "file_watch_phase:later_modify_present_baseline");
    const beforeSiblingFrames = socket.frames.length;
    fs.writeFileSync(sibling, "ignored");
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal(socket.frames.at(-1).changeCount, quietCount, "file_watch_phase:sibling_filtering");
    assert.equal(socket.frames.length, beforeSiblingFrames, "file_watch_phase:sibling_filtering");

    socket.emit("close");
    assert.equal(activeWatchers.size, 0, "file_watch_phase:cleanup");
  } finally {
    socket.emit("close");
    for (const watcher of [...activeWatchers]) watcher.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
