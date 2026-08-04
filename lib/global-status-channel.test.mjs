import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { createPiWebTransportGateway } = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL,
  createGlobalStatusChannelHandler,
  encodeBoundedGlobalStatusFrame,
  ensureGlobalStatusChannel,
} = await jiti.import("./global-status-channel.ts");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.frames = [];
    this.bufferedAmount = 0;
    this.closeCalls = [];
    this.sendError = null;
  }

  send(value, callback) {
    this.frames.push(JSON.parse(value));
    callback?.(this.sendError);
  }

  close(code) {
    this.closeCalls.push(code);
    this.readyState = 3;
    this.emit("close", code);
  }

  terminate() {
    this.close(1006);
  }
}

function createDependencies(state = {}) {
  const runningListeners = new Set();
  const discoveryListeners = new Set();
  return {
    runningListeners,
    discoveryListeners,
    dependencies: {
      getRunningSessionIds: () => state.runningIds ?? ["session-b", "session-a"],
      getSessionListGeneration: () => state.generation ?? 4,
      subscribeRunning(listener) {
        runningListeners.add(listener);
        return () => runningListeners.delete(listener);
      },
      subscribeSessionList(listener) {
        discoveryListeners.add(listener);
        return () => discoveryListeners.delete(listener);
      },
    },
  };
}

function context(serverInstanceId = "server-one") {
  return { channel: "running", serverInstanceId };
}

test.afterEach(() => {
  delete globalThis[GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL];
});

test("running channel sends minimal initial and changed frames with exact cleanup", () => {
  const { dependencies, runningListeners, discoveryListeners } = createDependencies();
  const handler = createGlobalStatusChannelHandler(dependencies);
  const socket = new FakeSocket();
  handler(socket, context());

  assert.deepEqual(socket.frames, [
    {
      protocol: "pi-web-global-status",
      version: 1,
      serverInstanceId: "server-one",
      type: "running",
      runningSessionIds: ["session-a", "session-b"],
    },
    {
      protocol: "pi-web-global-status",
      version: 1,
      serverInstanceId: "server-one",
      type: "sessions_changed",
      sessionListGeneration: 4,
    },
  ]);
  assert.equal(runningListeners.size, 1);
  assert.equal(discoveryListeners.size, 1);

  [...runningListeners][0](["session-c"]);
  [...discoveryListeners][0](5);
  assert.deepEqual(socket.frames.slice(2).map((frame) => frame.type), ["running", "sessions_changed"]);
  assert.deepEqual(socket.frames[2].runningSessionIds, ["session-c"]);
  assert.equal(socket.frames[3].sessionListGeneration, 5);

  socket.emit("close");
  socket.emit("close");
  socket.emit("error", new Error("already isolated"));
  assert.equal(runningListeners.size, 0);
  assert.equal(discoveryListeners.size, 0);
});

test("subscribes before snapshots and keeps independent subscribers", () => {
  const state = { runningIds: ["snapshot"], generation: 8 };
  const { dependencies, runningListeners, discoveryListeners } = createDependencies(state);
  const originalGet = dependencies.getRunningSessionIds;
  dependencies.getRunningSessionIds = () => {
    for (const listener of runningListeners) listener(["transition"]);
    return originalGet();
  };
  const handler = createGlobalStatusChannelHandler(dependencies);
  const first = new FakeSocket();
  const second = new FakeSocket();
  handler(first, context());
  handler(second, context());

  assert.deepEqual(first.frames.slice(0, 2).map((frame) => frame.runningSessionIds), [
    ["transition"],
    ["snapshot"],
  ]);
  assert.equal(runningListeners.size, 2);
  assert.equal(discoveryListeners.size, 2);
  first.emit("close");
  assert.equal(runningListeners.size, 1);
  [...runningListeners][0](["second-only"]);
  assert.equal(first.frames.some((frame) => frame.runningSessionIds?.[0] === "second-only"), false);
  assert.equal(second.frames.at(-1).runningSessionIds[0], "second-only");
  second.emit("close");
});

test("every non-open initial send cleans up exactly once and only terminates when appropriate", () => {
  for (const [readyState, expectedCloseCalls] of [
    [0, [1006]],
    [2, [1006]],
    [3, []],
  ]) {
    const { dependencies, runningListeners, discoveryListeners } = createDependencies();
    const socket = new FakeSocket();
    socket.readyState = readyState;

    createGlobalStatusChannelHandler(dependencies)(socket, context());

    assert.equal(runningListeners.size, 0);
    assert.equal(discoveryListeners.size, 0);
    assert.deepEqual(socket.closeCalls, expectedCloseCalls);
    assert.deepEqual(socket.frames, []);
    socket.emit("close");
    socket.emit("error", new Error("already isolated"));
    assert.equal(runningListeners.size, 0);
    assert.equal(discoveryListeners.size, 0);
  }
});

test("handler setup failure closes the socket and releases an earlier subscription", () => {
  const runningListeners = new Set();
  const socket = new FakeSocket();
  createGlobalStatusChannelHandler({
    getRunningSessionIds: () => [],
    getSessionListGeneration: () => 0,
    subscribeRunning(listener) {
      runningListeners.add(listener);
      return () => runningListeners.delete(listener);
    },
    subscribeSessionList() { throw new Error("synthetic setup failure"); },
  })(socket, context());
  assert.equal(runningListeners.size, 0);
  assert.deepEqual(socket.closeCalls, [1011]);
});

test("send failure closes the socket and unsubscribes once", () => {
  const { dependencies, runningListeners, discoveryListeners } = createDependencies();
  const socket = new FakeSocket();
  socket.sendError = new Error("synthetic send failure");
  createGlobalStatusChannelHandler(dependencies)(socket, context());
  assert.deepEqual(socket.closeCalls, [1011]);
  assert.equal(runningListeners.size, 0);
  assert.equal(discoveryListeners.size, 0);
});

test("bounded global encoding and callback pump isolate a stalled peer at exact byte limits", () => {
  const frame = {
    protocol: "pi-web-global-status", version: 1, serverInstanceId: "server-one",
    type: "running", runningSessionIds: ["x".repeat(128)],
  };
  const encoded = JSON.stringify(frame);
  const bytes = Buffer.byteLength(encoded);
  assert.equal(encodeBoundedGlobalStatusFrame(frame, bytes), encoded);
  assert.equal(encodeBoundedGlobalStatusFrame(frame, bytes - 1), null);

  class StalledSocket extends FakeSocket {
    constructor() { super(); this.callbacks = []; }
    send(value, callback) { this.frames.push(JSON.parse(value)); this.callbacks.push(callback); }
  }
  const h = createDependencies({ runningIds: [], generation: 0 });
  const stalled = new StalledSocket();
  const healthy = new FakeSocket();
  const options = { outputByteLimit: 350 };
  createGlobalStatusChannelHandler(h.dependencies, options)(stalled, context());
  createGlobalStatusChannelHandler(h.dependencies, options)(healthy, context());
  for (let index = 0; index < 8; index += 1) {
    for (const listener of [...h.runningListeners]) listener([`transition-${index}`]);
  }
  assert.deepEqual(stalled.closeCalls, [1013]);
  assert.equal(healthy.closeCalls.length, 0);
  assert.equal(healthy.frames.at(-1).runningSessionIds[0], "transition-7");
});

test("wide canonical running lists preserve the exact byte boundary and one-over decision", () => {
  const runningSessionIds = Array.from({ length: 8_192 }, (_, index) => `session-${String(index).padStart(5, "0")}`);
  const frame = {
    protocol: "pi-web-global-status", version: 1, serverInstanceId: "server-one",
    type: "running", runningSessionIds,
  };
  const expected = JSON.stringify(frame);
  const bytes = Buffer.byteLength(expected);
  assert.equal(encodeBoundedGlobalStatusFrame(frame, bytes), expected);
  assert.equal(encodeBoundedGlobalStatusFrame(frame, bytes - 1), null);
});

test("global canonicalization ignores duplicate byte growth and stops before a valid iterator tail", () => {
  const base = {
    protocol: "pi-web-global-status", version: 1, serverInstanceId: "server-one", type: "running",
  };
  const canonical = { ...base, runningSessionIds: ["alpha", "beta"] };
  const expected = JSON.stringify(canonical);
  const duplicates = { ...base, runningSessionIds: Array.from({ length: 100_000 }, (_, index) => index % 2 ? "alpha" : "beta") };
  assert.equal(encodeBoundedGlobalStatusFrame(duplicates, Buffer.byteLength(expected)), expected);

  let reads = 0;
  const source = {
    *[Symbol.iterator]() {
      reads += 1; yield "x".repeat(256);
      reads += 1; yield "y".repeat(256);
      reads += 1; throw new Error("tail_must_not_be_read");
    },
  };
  const oneId = JSON.stringify({ ...base, runningSessionIds: ["x".repeat(256)] });
  assert.equal(encodeBoundedGlobalStatusFrame({ ...base, runningSessionIds: source }, Buffer.byteLength(oneId)), null);
  assert.equal(reads, 2, "the newly unique one-over ID returns before reading the valid-width tail");
});

test("hostile oversized identifiers fail before their value is stringified", () => {
  const originalStringify = JSON.stringify;
  const stringifiedLengths = [];
  JSON.stringify = (value, ...rest) => {
    if (typeof value === "string") stringifiedLengths.push(value.length);
    return originalStringify(value, ...rest);
  };
  try {
    assert.equal(encodeBoundedGlobalStatusFrame({
      protocol: "pi-web-global-status", version: 1, serverInstanceId: "server-one",
      type: "running", runningSessionIds: ["x".repeat(1_000_000)],
    }, 4 * 1024 * 1024), null);
    assert.ok(stringifiedLengths.every((length) => length <= 128));
  } finally {
    JSON.stringify = originalStringify;
  }
});

test("global pump nulls consumed entries and fired fallbacks release owner-wide references", () => {
  class BackloggedSocket extends FakeSocket {
    constructor() { super(); this.callbacks = []; }
    send(value, callback) { this.frames.push(JSON.parse(value)); this.callbacks.push(callback); }
    completeOne() { this.callbacks.shift()?.(); }
    close(code) { this.closeCalls.push(code); }
    terminate() { this.readyState = 3; this.emit("close"); }
  }
  const h = createDependencies({ runningIds: [], generation: 0 });
  const references = [];
  const owner = { active: true, subscribers: new Set(), closeFallbacks: new Set() };
  const timers = [];
  const socket = new BackloggedSocket();
  createGlobalStatusChannelHandler(h.dependencies, {
    outputByteLimit: 64 * 1024,
    subscriptionOwner: owner,
    referenceObserver: (state) => references.push(state),
    setTimeout(callback) { const timer = { callback, unref() {} }; timers.push(timer); return timer; },
    clearTimeout(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
  })(socket, context());
  for (let index = 0; index < 100; index += 1) {
    for (const listener of [...h.runningListeners]) listener([`transition-${index}`]);
  }
  while (socket.callbacks.length > 0) socket.completeOne();
  assert.equal(references.at(-1).queuedRetained, 0);
  assert.equal(references.at(-1).arrayReferences, 0, "historical encoded strings are physically released");
  assert.equal(references.at(-1).inFlight, false);

  for (const close of [...owner.subscribers]) close("owner_replaced");
  assert.equal(owner.closeFallbacks.size, 0, "semantic owner replacement installs no channel-local fallback");
  assert.equal(timers.length, 0);
  assert.equal(owner.subscribers.size, 0);
});

test("active global policy fallback is cancelled on HMR and retired gateway force is suppressed by shutdown", () => {
  let now = 0;
  const timers = new Set();
  const setTimeout = (callback, delay) => {
    const timer = { callback, at: now + delay, unref() {} };
    timers.add(timer);
    return timer;
  };
  const clearTimeout = (timer) => timers.delete(timer);
  const advance = (delay) => {
    now += delay;
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback(); }
  };
  class ResistantSocket extends FakeSocket {
    close(code) { this.closeCalls.push(code); this.readyState = 2; }
    terminate() { this.terminateCalls = (this.terminateCalls ?? 0) + 1; }
  }
  const oldGateway = createPiWebTransportGateway({ setTimeout, clearTimeout });
  ensureGlobalStatusChannel(oldGateway);
  const authorization = oldGateway.consumeTicket(oldGateway.issueTicket("running").ticket);
  const socket = new ResistantSocket();
  const enlisted = authorization.enlistSocket(socket);
  authorization.handler(socket, {
    channel: "running", serverInstanceId: oldGateway.serverInstanceId, ownerToken: enlisted.ownerToken,
  });
  socket.emit("error", new Error("policy"));
  const oldRecord = globalThis[GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL];
  assert.equal(oldRecord.subscriptionOwner.closeFallbacks.size, 1);

  const replacementGateway = createPiWebTransportGateway();
  ensureGlobalStatusChannel(replacementGateway);
  assert.equal(oldRecord.subscriptionOwner.closeFallbacks.size, 0, "HMR cancels the channel-local policy fallback");
  oldGateway.beginShutdown();
  assert.equal(oldGateway.getOwnerLifecycleStats().closeFallbackCount, 0, "shutdown cancels retired gateway fallback");
  advance(9_999);
  assert.equal(socket.terminateCalls ?? 0, 0);
  socket.readyState = 3;
  socket.emit("close");
  assert.deepEqual(oldGateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  oldGateway.close();
  replacementGateway.close();
});

test("registration reuses one live gateway and replaces only stale compatible ownership", () => {
  const firstGateway = createPiWebTransportGateway();
  const first = ensureGlobalStatusChannel(firstGateway);
  const repeated = ensureGlobalStatusChannel(firstGateway);
  assert.deepEqual(first, { channel: "running", reused: false });
  assert.deepEqual(repeated, { channel: "running", reused: true });
  assert.equal(firstGateway.getStats().registeredChannelCount, 1);

  const secondGateway = createPiWebTransportGateway();
  const replaced = ensureGlobalStatusChannel(secondGateway);
  assert.deepEqual(replaced, { channel: "running", reused: false });
  assert.equal(firstGateway.getStats().registeredChannelCount, 0);
  assert.equal(secondGateway.getStats().registeredChannelCount, 1);

  globalThis[GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL] = { owner: "foreign" };
  assert.throws(() => ensureGlobalStatusChannel(secondGateway), /incompatible/);
  assert.deepEqual(globalThis[GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL], { owner: "foreign" });
  firstGateway.close();
  secondGateway.close();
});

test("global attach reads only the projection and has no wrapper startup or registry call boundary", async () => {
  const [channelSource, runtimeSource] = await Promise.all([
    readFile(new URL("./global-status-channel.ts", import.meta.url), "utf8"),
    readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8"),
  ]);
  for (const forbidden of ["startRpcSession", "getOrCreateRpcSession", "getRpcSession", "getRegistry", ".isRunning("]) {
    assert.equal(channelSource.includes(forbidden), false, `channel touched ${forbidden}`);
  }
  const getter = runtimeSource.slice(
    runtimeSource.indexOf("export function getRunningRpcSessionIds"),
    runtimeSource.indexOf("// ----------------------------------------------------------------------------", runtimeSource.indexOf("export function getRunningRpcSessionIds")),
  );
  assert.match(getter, /getRunningProjection/);
  assert.doesNotMatch(getter, /getRegistry|isRunning|__piSessions/);
});
