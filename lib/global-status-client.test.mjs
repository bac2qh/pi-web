import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  GlobalStatusClient,
  deriveGlobalStatusWebSocketUrl,
} = await jiti.import("./global-status-client.ts");

const TICKET = "a".repeat(43);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.closeCalls = [];
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  message(frame) {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  close(code) {
    this.closeCalls.push(code);
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1006 });
  }
}

function ticketResponse() {
  return new Response(JSON.stringify({ ticket: TICKET, expiresAt: 100_000 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function runningFrame(serverInstanceId, ids) {
  return {
    protocol: "pi-web-global-status",
    version: 1,
    serverInstanceId,
    type: "running",
    runningSessionIds: ids,
  };
}

function discoveryFrame(serverInstanceId, generation) {
  return {
    protocol: "pi-web-global-status",
    version: 1,
    serverInstanceId,
    type: "sessions_changed",
    sessionListGeneration: generation,
  };
}

function createHarness() {
  const fetches = [];
  const sockets = [];
  const timers = new Map();
  const timerDelays = [];
  let nextTimer = 1;
  const dependencies = {
    fetch(input, init) {
      const result = deferred();
      fetches.push({ input, init, result });
      return result.promise;
    },
    createWebSocket(url) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    getLocation: () => ({ protocol: "http:", host: "localhost:30141" }),
    createAbortController: () => new AbortController(),
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, callback);
      timerDelays.push(delay);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  return {
    fetches,
    sockets,
    timers,
    timerDelays,
    dependencies,
    runTimer(id = timers.keys().next().value) {
      const callback = timers.get(id);
      timers.delete(id);
      callback?.();
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function connect(harness, client) {
  client.start();
  assert.equal(harness.fetches.length, 1);
  harness.fetches[0].result.resolve(ticketResponse());
  await flush();
  assert.equal(harness.sockets.length, 1);
  harness.sockets[0].open();
  return harness.sockets[0];
}

test("derives only page-host ws and wss URLs including IPv6", () => {
  assert.equal(
    deriveGlobalStatusWebSocketUrl({ protocol: "http:", host: "localhost:30141" }, TICKET),
    `ws://localhost:30141/_pi/websocket?ticket=${TICKET}`,
  );
  assert.equal(
    deriveGlobalStatusWebSocketUrl({ protocol: "https:", host: "[::1]:8443" }, TICKET),
    `wss://[::1]:8443/_pi/websocket?ticket=${TICKET}`,
  );
  assert.throws(
    () => deriveGlobalStatusWebSocketUrl({ protocol: "file:", host: "localhost" }, TICKET),
    /unsupported_page_location/,
  );
});

test("uses one exact same-origin bootstrap and publishes validated frames", async () => {
  const harness = createHarness();
  const client = new GlobalStatusClient(harness.dependencies);
  const snapshots = [];
  const discovery = [];
  client.subscribe((snapshot) => snapshots.push(snapshot));
  client.subscribeSessionsChanged((event) => discovery.push(event));
  const socket = await connect(harness, client);

  const request = harness.fetches[0];
  assert.equal(request.input, "/api/transport/ticket");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    "Content-Type": "application/json",
    "X-Pi-Web-Transport": "1",
  });
  assert.equal(request.init.body, JSON.stringify({ channel: "running" }));
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(new URL(socket.url).origin, "ws://localhost:30141");
  assert.equal(new URL(socket.url).pathname, "/_pi/websocket");

  socket.message(runningFrame("server-one", ["session-b", "session-a"]));
  socket.message(discoveryFrame("server-one", 7));
  socket.message(discoveryFrame("server-one", 7));
  assert.deepEqual(client.getSnapshot(), {
    runningSessionIds: ["session-b", "session-a"],
    runningAuthoritative: true,
    serverInstanceId: "server-one",
    connectionState: "connected",
  });
  assert.deepEqual(discovery, [
    { serverInstanceId: "server-one", sessionListGeneration: 7 },
    { serverInstanceId: "server-one", sessionListGeneration: 7 },
  ], "equal-generation reconnect-style deliveries remain observable events");
  assert.equal(snapshots.at(-1).runningAuthoritative, true);
  client.stop();
});

test("retains last-known running state while reconnecting and accepts a new server namespace", async () => {
  const harness = createHarness();
  const client = new GlobalStatusClient(harness.dependencies, {
    initialReconnectDelayMs: 5,
    maximumReconnectDelayMs: 20,
  });
  const first = await connect(harness, client);
  first.message(runningFrame("server-one", ["session-active"]));
  first.close();
  assert.deepEqual(client.getSnapshot().runningSessionIds, ["session-active"]);
  assert.equal(client.getSnapshot().runningAuthoritative, true);
  assert.equal(harness.timers.size, 1);
  assert.deepEqual(harness.timerDelays, [5]);

  harness.runTimer();
  assert.equal(harness.fetches.length, 2);
  harness.fetches[1].result.resolve(ticketResponse());
  await flush();
  const second = harness.sockets[1];
  second.open();
  second.message(discoveryFrame("server-two", 0));
  second.message(runningFrame("server-two", []));
  assert.deepEqual(client.getSnapshot(), {
    runningSessionIds: [],
    runningAuthoritative: true,
    serverInstanceId: "server-two",
    connectionState: "connected",
  });
  client.stop();
});

test("malformed, unknown, and mixed-server frames cannot mutate product state", async () => {
  const harness = createHarness();
  const client = new GlobalStatusClient(harness.dependencies);
  const socket = await connect(harness, client);
  socket.message(runningFrame("server-one", ["known"]));
  const before = client.getSnapshot();

  for (const invalid of [
    "not-json",
    { protocol: "wrong", version: 1, serverInstanceId: "server-one", type: "running", runningSessionIds: [] },
    { ...runningFrame("server-one", []), extra: true },
    runningFrame("server-one", ["duplicate", "duplicate"]),
    discoveryFrame("server-one", -1),
    runningFrame("server-two", []),
  ]) socket.message(invalid);

  assert.deepEqual(client.getSnapshot(), before);
  client.stop();
});

test("epoch and resource identity suppress stale fetches, sockets, and timers", async () => {
  const harness = createHarness();
  const client = new GlobalStatusClient(harness.dependencies, {
    initialReconnectDelayMs: 5,
    maximumReconnectDelayMs: 10,
  });
  const snapshots = [];
  client.subscribe((snapshot) => snapshots.push(snapshot));
  client.start();
  const staleFetch = harness.fetches[0];
  client.stop();
  client.start();
  const currentFetch = harness.fetches[1];

  staleFetch.result.resolve(ticketResponse());
  currentFetch.result.resolve(ticketResponse());
  await flush();
  assert.equal(harness.sockets.length, 1);
  const currentSocket = harness.sockets[0];
  currentSocket.open();
  currentSocket.message(runningFrame("current-server", ["current"]));

  const staleMessage = currentSocket.onmessage;
  currentSocket.close();
  const staleTimer = [...harness.timers.keys()][0];
  harness.runTimer(staleTimer);
  assert.equal(harness.fetches.length, 3);
  harness.fetches[2].result.resolve(ticketResponse());
  await flush();
  const replacementSocket = harness.sockets[1];
  replacementSocket.open();
  replacementSocket.message(runningFrame("replacement-server", ["replacement"]));

  staleMessage?.({ data: JSON.stringify(runningFrame("current-server", ["stale"])) });
  harness.runTimer(staleTimer);
  assert.deepEqual(client.getSnapshot().runningSessionIds, ["replacement"]);
  assert.equal(harness.fetches.length, 3);
  assert.equal(snapshots.some((snapshot) => snapshot.runningSessionIds.includes("stale")), false);
  client.stop();
});

test("failed bootstraps use one bounded reconnect timer and cleanup cancels it", async () => {
  const harness = createHarness();
  const client = new GlobalStatusClient(harness.dependencies, {
    initialReconnectDelayMs: 5,
    maximumReconnectDelayMs: 10,
  });
  client.start();
  harness.fetches[0].result.reject(new Error("offline"));
  await flush();
  assert.equal(harness.timers.size, 1);
  assert.deepEqual(harness.timerDelays, [5]);
  harness.runTimer();
  harness.fetches[1].result.reject(new Error("offline"));
  await flush();
  assert.equal(harness.timers.size, 1);
  assert.deepEqual(harness.timerDelays, [5, 10]);
  client.stop();
  assert.equal(harness.timers.size, 0);
  assert.equal(client.getSnapshot().connectionState, "idle");
});
