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
  ensureGlobalStatusChannel,
} = await jiti.import("./global-status-channel.ts");

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.frames = [];
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
