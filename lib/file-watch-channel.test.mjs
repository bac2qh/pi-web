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

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("timed out waiting for filesystem watch convergence");
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
  const context = { channel: "file-watch", serverInstanceId: "server", ticketContext: createFileWatchTicketContext(target, "ordinary") };
  try {
    await createFileWatchChannelHandler(undefined, { coalesceMs: 10 })(socket, context);
    assert.equal(socket.frames[0].type, "connected");
    fs.appendFileSync(target, "two");
    await waitFor(() => socket.frames.length >= 2 && socket.frames.at(-1).exists);

    const replacement = path.join(directory, "replacement.tmp");
    fs.writeFileSync(replacement, "replacement");
    fs.renameSync(replacement, target);
    await waitFor(() => socket.frames.length >= 3 && socket.frames.at(-1).exists);

    fs.unlinkSync(target);
    await waitFor(() => socket.frames.some((frame) => frame.type === "change" && !frame.exists));
    const absentCount = socket.frames.at(-1).changeCount;
    fs.writeFileSync(target, "recreated");
    await waitFor(() => socket.frames.at(-1).exists && socket.frames.at(-1).changeCount > absentCount);
    const recreatedCount = socket.frames.at(-1).changeCount;
    fs.appendFileSync(target, "later");
    await waitFor(() => socket.frames.at(-1).changeCount > recreatedCount);

    const beforeSibling = socket.frames.length;
    fs.writeFileSync(sibling, "ignored");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(socket.frames.length, beforeSibling);
    socket.emit("close");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
