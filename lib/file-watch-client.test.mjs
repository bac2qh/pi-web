import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { FileWatchClient, deriveFileWatchWebSocketUrl } = await jiti.import("./file-watch-client.ts");
const TICKET = "a".repeat(43);

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
class Socket {
  constructor(url) { this.url = url; this.readyState = 0; this.onopen = this.onmessage = this.onerror = this.onclose = null; this.closeCalls = []; }
  open() { this.readyState = 1; this.onopen?.({}); }
  message(value) { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
  binary() { this.onmessage?.({ data: new Uint8Array([1]) }); }
  error() { this.onerror?.({}); }
  close(code = 1006) { this.closeCalls.push(code); if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
}
function response(status = 200) {
  return new Response(status === 200 ? JSON.stringify({ ticket: TICKET, expiresAt: 10 }) : "{}", { status, headers: { "Content-Type": "application/json" } });
}
function frame(type = "connected", count = 0, server = "server") {
  return { protocol: "pi-web-file-watch", version: 1, serverInstanceId: server, type, changeCount: count, exists: true, size: 3 };
}
function harness(overrides = {}) {
  const fetches = [], sockets = [], timers = new Map(), delays = [];
  let nextTimer = 1;
  const dependencies = {
    fetch(input, init) { const result = deferred(); fetches.push({ input, init, result }); return result.promise; },
    createWebSocket(url) { const socket = new Socket(url); sockets.push(socket); return socket; },
    getLocation: () => ({ protocol: "http:", host: "localhost:30141" }),
    createAbortController: () => new AbortController(),
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, callback); delays.push(delay); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...overrides,
  };
  return { fetches, sockets, timers, delays, dependencies, runTimer() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); } };
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }
async function bootstrap(h, client, status = 200) {
  client.start(); h.fetches.at(-1).result.resolve(response(status)); await flush(); return h.sockets.at(-1);
}

test("derives only page-host websocket URLs", () => {
  assert.equal(deriveFileWatchWebSocketUrl({ protocol: "http:", host: "localhost:30141" }, TICKET), `ws://localhost:30141/_pi/websocket?ticket=${TICKET}`);
  assert.equal(deriveFileWatchWebSocketUrl({ protocol: "https:", host: "[::1]:8443" }, TICKET), `wss://[::1]:8443/_pi/websocket?ticket=${TICKET}`);
  assert.throws(() => deriveFileWatchWebSocketUrl({ protocol: "file:", host: "local" }, TICKET));
});

test("uses exact same-origin ticket body and accepts connected then changes", async () => {
  const h = harness();
  const client = new FileWatchClient("/synthetic/control\u0001.txt", "session", h.dependencies);
  const frames = [], snapshots = [];
  client.subscribe((snapshot) => snapshots.push(snapshot));
  client.subscribeFrames((value) => frames.push(value));
  const socket = await bootstrap(h, client);
  assert.deepEqual(JSON.parse(h.fetches[0].init.body), { channel: "file-watch", path: "/synthetic/control\u0001.txt", sessionId: "session" });
  assert.equal(h.fetches[0].init.cache, "no-store");
  assert.equal(h.fetches[0].init.credentials, "same-origin");
  assert.equal(h.fetches[0].init.signal instanceof AbortSignal, true);
  assert.equal(new URL(socket.url).pathname, "/_pi/websocket");
  assert.deepEqual([...new URL(socket.url).searchParams.keys()], ["ticket"]);
  socket.open();
  assert.equal(client.getSnapshot().connectionState, "connecting", "TCP open alone is not connected");
  socket.message(frame());
  socket.message(frame("change", 1));
  assert.equal(client.getSnapshot().connectionState, "connected");
  assert.equal(client.getSnapshot().changeCount, 1);
  assert.equal(frames.length, 2);
  assert.equal(snapshots.at(-1).size, 3);
  client.stop();
});

test("retries indefinitely with the exact capped schedule and resets only after connected", async () => {
  const h = harness();
  const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
  client.start();
  for (let attempt = 0; attempt < 9; attempt += 1) {
    h.fetches.at(-1).result.resolve(response(404));
    await flush();
    assert.equal(h.timers.size, 1);
    h.runTimer();
  }
  assert.deepEqual(h.delays, [250, 500, 1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  h.fetches.at(-1).result.resolve(response()); await flush();
  const socket = h.sockets.at(-1); socket.open(); socket.close(1012);
  assert.equal(h.delays.at(-1), 10000, "TCP open does not reset backoff");
  h.runTimer(); h.fetches.at(-1).result.resolve(response()); await flush();
  const recovered = h.sockets.at(-1); recovered.open(); recovered.message(frame()); recovered.close(1011);
  assert.equal(h.delays.at(-1), 250, "valid connected resets backoff");
  client.stop();
});

test("duplicate, decreasing, and skipped connection-local change counts are terminal", async () => {
  for (const counts of [[1, 1], [1, 3]]) {
    const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
    const socket = await bootstrap(h, client); socket.open(); socket.message(frame());
    for (const count of counts) socket.message(frame("change", count));
    assert.equal(client.getSnapshot().connectionState, "terminal");
    assert.equal(h.timers.size, 0);
  }
});

test("protocol/policy failures are terminal while owner/watcher/socket failures retry", async () => {
  for (const invalid of ["not-json", { ...frame(), extra: true }, frame("change", 1), { ...frame(), version: 2 }]) {
    const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
    const socket = await bootstrap(h, client); socket.open(); socket.message(invalid);
    assert.equal(client.getSnapshot().connectionState, "terminal");
    assert.equal(h.timers.size, 0);
  }
  const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
  await bootstrap(h, client, 403);
  assert.equal(client.getSnapshot().connectionState, "terminal");
});

test("error then terminal or retryable close lets close-code classification win", async () => {
  for (const code of [1003, 1008]) {
    const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
    const socket = await bootstrap(h, client); socket.open(); socket.error();
    assert.deepEqual(h.delays, [100]);
    socket.close(code);
    assert.equal(client.getSnapshot().connectionState, "terminal");
    assert.equal(client.getSnapshot().errorClass, "protocol");
    assert.equal(h.timers.size, 0);
  }

  const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
  const socket = await bootstrap(h, client); socket.open(); socket.error(); socket.close(1012);
  assert.equal(client.getSnapshot().connectionState, "reconnecting");
  assert.equal(client.getSnapshot().errorClass, "server");
  assert.deepEqual(h.delays, [100, 250]);
  assert.equal(h.timers.size, 1);
  client.stop();
});

test("error without close falls back once into capped reconnect and stop cancels the fallback", async () => {
  const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
  const socket = await bootstrap(h, client); socket.open(); socket.error();
  assert.equal(h.timers.size, 1);
  h.runTimer();
  assert.equal(socket.closeCalls.includes(1000), true);
  assert.equal(client.getSnapshot().connectionState, "reconnecting");
  assert.deepEqual(h.delays, [100, 250]);
  assert.equal(h.timers.size, 1);
  h.runTimer();
  assert.equal(h.fetches.length, 2);
  client.stop();

  const stopped = harness(); const stoppedClient = new FileWatchClient("/synthetic/file", null, stopped.dependencies);
  const stoppedSocket = await bootstrap(stopped, stoppedClient); stoppedSocket.open(); stoppedSocket.error();
  const staleFallback = [...stopped.timers.values()][0];
  stoppedClient.stop();
  staleFallback();
  assert.equal(stoppedClient.getSnapshot().connectionState, "idle");
  assert.equal(stopped.timers.size, 0);
  assert.equal(stopped.fetches.length, 1);
});

test("stale-epoch error fallback cannot disturb a restarted client", async () => {
  const h = harness(); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
  const staleSocket = await bootstrap(h, client); staleSocket.open(); staleSocket.error();
  const staleFallback = [...h.timers.values()][0];
  client.stop(); client.start();
  h.fetches.at(-1).result.resolve(response()); await flush();
  const current = h.sockets.at(-1); current.open(); current.message(frame("connected", 0, "current"));
  staleFallback(); staleSocket.onerror?.({}); staleSocket.onclose?.({ code: 1008 });
  assert.equal(client.getSnapshot().connectionState, "connected");
  assert.equal(client.getSnapshot().serverInstanceId, "current");
  assert.equal(h.timers.size, 0);
  client.stop();
});

test("synchronous dependency failures remain bounded and stale-safe", async () => {
  const controllerFailure = harness({ createAbortController() { throw new Error("private"); } });
  const controllerClient = new FileWatchClient("/synthetic/file", null, controllerFailure.dependencies);
  controllerClient.start();
  assert.deepEqual(controllerFailure.delays, [250]);
  controllerClient.stop();

  const fetchFailure = harness({ fetch() { throw new Error("private"); } });
  const fetchClient = new FileWatchClient("/synthetic/file", null, fetchFailure.dependencies);
  fetchClient.start();
  assert.deepEqual(fetchFailure.delays, [250]);
  fetchClient.stop();

  for (const overrides of [
    { createWebSocket() { throw new Error("private"); } },
    { getLocation() { throw new Error("private"); } },
  ]) {
    const h = harness(overrides); const client = new FileWatchClient("/synthetic/file", null, h.dependencies);
    client.start(); h.fetches[0].result.resolve(response()); await flush();
    assert.deepEqual(h.delays, [250]);
    assert.equal(h.sockets.length, 0);
    client.stop();
  }

  let synchronousCallbacks = 0;
  const synchronousTimer = harness({
    setTimeout(callback, delay) { synchronousCallbacks += 1; callback(); return `sync-${delay}`; },
    clearTimeout() {},
  });
  const synchronousClient = new FileWatchClient("/synthetic/file", null, synchronousTimer.dependencies);
  synchronousClient.start(); synchronousTimer.fetches[0].result.reject(new Error("private")); await flush();
  assert.equal(synchronousCallbacks, 1);
  assert.equal(synchronousTimer.fetches.length, 2);
  synchronousClient.stop();

  const timerFailure = harness({ setTimeout() { throw new Error("private"); } });
  const timerClient = new FileWatchClient("/synthetic/file", null, timerFailure.dependencies);
  timerClient.start(); timerFailure.fetches[0].result.reject(new Error("private")); await flush();
  assert.equal(timerClient.getSnapshot().connectionState, "terminal");
  timerClient.stop();
});

test("resource epoch suppresses stale fetch, socket, timer, and listener throws", async () => {
  const h = harness(); const diagnostics = [];
  const client = new FileWatchClient("/synthetic/file", null, h.dependencies, { diagnostic: (entry) => diagnostics.push(entry) });
  client.subscribe(() => { throw new Error("hostile listener"); });
  client.start(); const stale = h.fetches[0]; client.stop(); client.start();
  stale.result.resolve(response()); h.fetches[1].result.resolve(response()); await flush();
  assert.equal(h.sockets.length, 1);
  const socket = h.sockets[0]; socket.open(); socket.message(frame());
  const staleMessage = socket.onmessage; socket.close(1012); const oldTimer = [...h.timers.keys()][0]; h.runTimer();
  h.fetches.at(-1).result.resolve(response()); await flush(); const current = h.sockets.at(-1); current.open(); current.message(frame("connected", 0, "new"));
  staleMessage?.({ data: JSON.stringify(frame("change", 1)) });
  h.timers.get(oldTimer)?.();
  assert.equal(client.getSnapshot().serverInstanceId, "new");
  assert.equal(diagnostics.some((entry) => entry.stage === "listener" && entry.outcome === "threw"), true);
  assert.equal(JSON.stringify(diagnostics).includes("/synthetic"), false);
  client.stop(); assert.equal(h.timers.size, 0);
});
