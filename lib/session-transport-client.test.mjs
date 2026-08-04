import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const { createSnapshotTransfer } = await jiti.import("./session-event-hub.ts");
const {
  SessionTransportClient,
  deriveSessionTransportWebSocketUrl,
  isValidSessionTransportSessionId,
} = await jiti.import("./session-transport-client.ts");

const TICKET = "a".repeat(43);
function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
class FakeSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.onopen = this.onmessage = this.onerror = this.onclose = null; this.sent = []; this.closeCalls = []; }
  open() { this.readyState = 1; this.onopen?.({}); }
  send(text) { this.sent.push(text); }
  message(value) { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
  binary(value = new Uint8Array([1])) { this.onmessage?.({ data: value }); }
  close(code) { this.closeCalls.push(code); if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: code ?? 1000 }); }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
function response(value = { ticket: TICKET, expiresAt: 0 }, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function createHarness(location = { protocol: "http:", host: "localhost:30141" }) {
  const fetches = [], sockets = [], timers = new Map(), delays = [];
  let nextTimer = 1;
  const dependencies = {
    fetch(input, init) { const result = deferred(); fetches.push({ input, init, result }); return result.promise; },
    createWebSocket(url) { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    getLocation: () => location,
    createAbortController: () => new AbortController(),
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, callback); delays.push(delay); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { fetches, sockets, timers, delays, dependencies, runTimer(id = timers.keys().next().value) { const callback = timers.get(id); timers.delete(id); callback?.(); } };
}
const ready = (outcome, epoch, cursor, serverInstanceId = "server") => ({
  protocol: "pi-web-session-transport", version: 1, type: "ready", serverInstanceId, streamEpoch: epoch, cursor, outcome,
});
const logical = (epoch, sequence, type, values = {}) => ({
  protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: protocol.PROJECTED_SESSION_VERSION,
  streamEpoch: epoch, sequence, type, ...values,
});
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }
async function openClient(harness, client, ticketValue = { ticket: TICKET, expiresAt: 0 }) {
  client.start();
  harness.fetches.at(-1).result.resolve(response(ticketValue));
  await flush();
  const socket = harness.sockets.at(-1);
  socket.open();
  return socket;
}
function completeInitial(socket, epoch = "epoch", cursor = 0, server = "server") {
  socket.message(ready("initial_snapshot", epoch, cursor, server));
  for (const unit of createSnapshotTransfer(epoch, cursor, "initial", protocol.createInitialProjectedSessionState(), 512, `transfer-${server}`)) socket.message(unit);
}

test("validates exact session IDs and derives only ticket-bearing page-host WebSocket URLs", () => {
  assert.equal(isValidSessionTransportSessionId("session"), true);
  for (const invalid of ["", " x", "x ", "x\n", "x".repeat(257), 1]) assert.equal(isValidSessionTransportSessionId(invalid), false);
  assert.equal(deriveSessionTransportWebSocketUrl({ protocol: "http:", host: "localhost:30141" }, TICKET), `ws://localhost:30141/_pi/websocket?ticket=${TICKET}`);
  assert.equal(deriveSessionTransportWebSocketUrl({ protocol: "https:", host: "[::1]:8443" }, TICKET), `wss://[::1]:8443/_pi/websocket?ticket=${TICKET}`);
  assert.throws(() => deriveSessionTransportWebSocketUrl({ protocol: "file:", host: "host" }, TICKET));
});

test("uses the exact same-origin ticket request and sends exactly one null resume after open", async () => {
  const harness = createHarness();
  const client = new SessionTransportClient("session-id", harness.dependencies);
  const socket = await openClient(harness, client, { ticket: TICKET, expiresAt: Number.MAX_SAFE_INTEGER });
  const request = harness.fetches[0];
  assert.equal(request.input, "/api/transport/ticket");
  assert.deepEqual(request.init, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Pi-Web-Transport": "1" },
    body: JSON.stringify({ channel: "session", sessionId: "session-id" }),
    cache: "no-store", credentials: "same-origin", signal: request.init.signal,
  });
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    protocol: "pi-web-session-transport", version: 1, type: "resume", streamEpoch: null, cursor: null,
  });
  assert.equal(socket.sent.length, 1);
  const url = new URL(socket.url);
  assert.deepEqual([...url.searchParams.keys()], ["ticket"]);
  assert.equal(url.searchParams.get("ticket"), TICKET);
  assert.equal(socket.url.includes("session-id"), false);
  client.stop();
});

test("a repeated open callback cannot send a second resume", async () => {
  const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
  const socket = await openClient(harness, client);
  assert.equal(socket.sent.length, 1);
  socket.open();
  assert.equal(socket.sent.length, 1);
  assert.equal(client.getSnapshot().errorClass, "protocol_malformed");
  assert.equal(harness.timers.size, 1);
  client.stop();
});

test("strict ticket shape accepts nonnegative safe expiry without wall-clock comparison and rejects malformed responses", async () => {
  for (const expiresAt of [0, Number.MAX_SAFE_INTEGER]) {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    await openClient(harness, client, { ticket: TICKET, expiresAt });
    assert.equal(harness.sockets.length, 1);
    client.stop();
  }
  for (const invalid of [
    { ticket: TICKET, expiresAt: -1 }, { ticket: TICKET, expiresAt: 1.5 },
    { ticket: TICKET, expiresAt: Number.MAX_SAFE_INTEGER + 1 }, { ticket: "short", expiresAt: 0 },
    { ticket: TICKET }, { ticket: TICKET, expiresAt: 0, extra: true }, null,
  ]) {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.resolve(response(invalid)); await flush();
    assert.equal(harness.sockets.length, 0);
    assert.equal(client.getSnapshot().errorClass, "ticket_invalid");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
});

test("stable deeply frozen snapshots publish ready target before atomic snapshot and effects only after commit", async () => {
  const harness = createHarness();
  const client = new SessionTransportClient("id", harness.dependencies);
  const snapshots = [], effects = [], observedEffectCursors = [];
  client.subscribe((snapshot) => snapshots.push(snapshot));
  client.subscribeEffects((delivery) => { effects.push(delivery); observedEffectCursors.push(client.getSnapshot().cursor); });
  const initialIdentity = client.getSnapshot();
  assert.strictEqual(client.getSnapshot(), initialIdentity);
  const socket = await openClient(harness, client);
  socket.message(ready("initial_snapshot", "epoch", 0));
  const beforeChunks = client.getSnapshot();
  const units = createSnapshotTransfer("epoch", 0, "initial", protocol.createInitialProjectedSessionState(), 400, "atomic");
  for (const unit of units.slice(0, -1)) socket.message(unit);
  assert.strictEqual(client.getSnapshot(), beforeChunks, "partial assembly has no public revision");
  socket.message(units.at(-1));
  assert.equal(client.getSnapshot().connectionState, "connected");
  assert.ok(Object.isFrozen(client.getSnapshot()) && Object.isFrozen(client.getSnapshot().state));
  const liveIdentity = client.getSnapshot();
  assert.strictEqual(client.getSnapshot(), liveIdentity);

  const notice = logical("epoch", 1, "notice", { level: "info", message: "synthetic" });
  socket.message(notice); socket.message(notice);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].sequence, 1);
  assert.ok(Object.isFrozen(effects[0]) && Object.isFrozen(effects[0].effect));
  assert.deepEqual(observedEffectCursors, [1]);
  assert.equal(snapshots.at(-1).cursor, 1);
  const after = client.getSnapshot();
  assert.strictEqual(client.getSnapshot(), after);
  client.stop();
});

test("disconnect resumes the last committed pair and resets backoff only after target completion", async () => {
  const harness = createHarness();
  const client = new SessionTransportClient("id", harness.dependencies, { initialReconnectDelayMs: 250, maximumReconnectDelayMs: 1000 });
  const first = await openClient(harness, client);
  completeInitial(first);
  first.message(logical("epoch", 1, "activity_started", { activity: "prompt" }));
  first.serverClose(1006);
  assert.deepEqual(harness.delays, [250]);
  harness.runTimer(); harness.fetches[1].result.resolve(response()); await flush();
  const second = harness.sockets[1]; second.open();
  assert.deepEqual(JSON.parse(second.sent[0]), {
    protocol: "pi-web-session-transport", version: 1, type: "resume", streamEpoch: "epoch", cursor: 1,
  });
  second.message(ready("exact", "epoch", 2, "server-two"));
  second.serverClose(1006);
  assert.deepEqual(harness.delays, [250, 500], "ready metadata alone does not reset delay");
  harness.runTimer(); harness.fetches[2].result.resolve(response()); await flush();
  const third = harness.sockets[2]; third.open(); third.message(ready("exact", "epoch", 2, "server-three"));
  third.message(logical("epoch", 2, "native_settled"));
  third.serverClose(1006);
  assert.deepEqual(harness.delays, [250, 500, 250], "completed target resets delay");
  client.stop();
});

test("recoverable faults and close 1012/1013 map to one reconnect timer", async () => {
  for (const [drive, expected] of [
    [(socket) => socket.binary(), "protocol_malformed"],
    [(socket) => socket.message("not-json"), "protocol_malformed"],
    [(socket) => socket.serverClose(1012), "owner_unavailable"],
    [(socket) => socket.serverClose(1013), "slow_consumer"],
  ]) {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    const socket = await openClient(harness, client);
    drive(socket);
    assert.equal(client.getSnapshot().errorClass, expected);
    assert.equal(client.getSnapshot().connectionState, "reconnecting");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
});

test("second ready, excess, unknown, impossible order, gap, epoch, and snapshot faults fail closed with finite classes", async () => {
  const cases = [
    { expected: "protocol_malformed", drive(socket) { completeInitial(socket); socket.message(ready("empty", "epoch", 0, "second")); } },
    { expected: "protocol_malformed", drive(socket) { completeInitial(socket); socket.message({ ...logical("epoch", 1, "native_settled"), extra: true }); } },
    { expected: "protocol_unknown_type", drive(socket) { completeInitial(socket); socket.message(logical("epoch", 1, "future_type")); } },
    { expected: "cursor_gap", drive(socket) { completeInitial(socket); socket.message(logical("epoch", 2, "native_settled")); } },
    { expected: "epoch_mismatch", drive(socket) { completeInitial(socket); socket.message(logical("wrong", 1, "native_settled")); } },
    { expected: "epoch_mismatch", drive(socket) { socket.message(ready("overflow_snapshot", "epoch", 2)); } },
    { expected: "epoch_mismatch", drive(socket) { socket.message(ready("empty", "epoch", 1)); } },
  ];
  for (const fixture of cases) {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    const socket = await openClient(harness, client); fixture.drive(socket);
    assert.equal(client.getSnapshot().errorClass, fixture.expected);
    assert.equal(client.getSnapshot().connectionState, "reconnecting");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
});

test("ticket/status failures use one exponential timer capped at ten seconds", async () => {
  const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
  client.start();
  for (let index = 0; index < 8; index += 1) {
    harness.fetches[index].result.resolve(response({ error: "unavailable" }, 503));
    await flush();
    assert.equal(client.getSnapshot().errorClass, "ticket_unavailable");
    assert.equal(harness.timers.size, 1);
    if (index < 7) harness.runTimer();
  }
  assert.deepEqual(harness.delays, [250, 500, 1000, 2000, 4000, 8000, 10000, 10000]);
  client.stop();
});

test("unsupported ready/projected versions are terminal until explicit stop and start", async () => {
  const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
  const first = await openClient(harness, client);
  first.message({ ...ready("initial_snapshot", "epoch", 0), version: 2 });
  assert.equal(client.getSnapshot().connectionState, "terminal");
  assert.equal(client.getSnapshot().errorClass, "unsupported_protocol");
  assert.equal(harness.timers.size, 0);
  client.start(); assert.equal(harness.fetches.length, 1, "terminal started client does not blind retry");
  client.stop(); client.start();
  assert.equal(harness.fetches.length, 2);
  harness.fetches[1].result.resolve(response()); await flush();
  const second = harness.sockets[1]; second.open(); completeInitial(second, "epoch-two");
  second.message({ ...logical("epoch-two", 1, "native_settled"), version: 2 });
  assert.equal(client.getSnapshot().connectionState, "terminal");
  client.stop();
});

test("epoch and exact resource identity suppress stale fetch, socket, message, close, and timer callbacks", async () => {
  const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
  client.start(); const staleFetch = harness.fetches[0];
  client.stop(); client.start(); const currentFetch = harness.fetches[1];
  staleFetch.result.resolve(response()); currentFetch.result.resolve(response()); await flush();
  assert.equal(harness.sockets.length, 1);
  const first = harness.sockets[0]; first.open(); completeInitial(first);
  const staleMessage = first.onmessage, staleClose = first.onclose;
  first.serverClose(1006); const staleTimer = harness.timers.keys().next().value;
  harness.runTimer(staleTimer); harness.fetches[2].result.resolve(response()); await flush();
  const replacement = harness.sockets[1]; replacement.open(); replacement.message(ready("empty", "epoch", 0, "replacement"));
  staleMessage?.({ data: JSON.stringify(logical("epoch", 1, "native_settled")) });
  staleClose?.({ code: 1012 }); harness.runTimer(staleTimer);
  assert.equal(client.getSnapshot().cursor, 0);
  assert.equal(client.getSnapshot().serverInstanceId, "replacement");
  assert.equal(harness.fetches.length, 3);
  client.stop();
});

test("nested client snapshot/effect batches preserve every captured identity and sequence", async () => {
  const harness = createHarness();
  const client = new SessionTransportClient("id", harness.dependencies);
  const snapshots = [], effects = [], effectCursors = [];
  let socket;
  let nestedSnapshot = false, nestedEffect = false;
  client.subscribe((snapshot) => {
    if (snapshot.cursor === 1 && !nestedSnapshot) {
      nestedSnapshot = true;
      socket.message(logical("epoch", 2, "notice", { level: "info", message: "nested" }));
    }
  });
  client.subscribe((snapshot) => snapshots.push([snapshot.revision, snapshot.cursor, snapshot, client.getSnapshot()]));
  client.subscribeEffects((delivery) => {
    if (delivery.sequence === 1 && !nestedEffect) {
      nestedEffect = true;
      socket.message(logical("epoch", 2, "notice", { level: "info", message: "nested" }));
    }
  });
  client.subscribeEffects((delivery) => { effects.push(delivery.sequence); effectCursors.push(client.getSnapshot().cursor); });
  socket = await openClient(harness, client);
  completeInitial(socket);
  snapshots.length = 0;
  socket.message(logical("epoch", 1, "notice", { level: "info", message: "outer" }));
  assert.deepEqual(snapshots.map(([revision, cursor]) => [revision, cursor]), [[5, 1], [6, 2]]);
  assert.ok(snapshots.every(([, , delivered, current]) => delivered === current));
  assert.deepEqual(effects, [1, 2]);
  assert.deepEqual(effectCursors, [1, 2]);
  client.stop();
});

test("client subscribe and unsubscribe reentrancy preserves snapshotted batches and future-only effects", async () => {
  const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
  let socket, unsubscribeSnapshotB = () => {}, snapshotMutated = false;
  const snapshotB = [], snapshotC = [];
  client.subscribe((snapshot) => {
    if (snapshot.cursor === 1 && !snapshotMutated) {
      snapshotMutated = true;
      unsubscribeSnapshotB();
      client.subscribe((next) => snapshotC.push(next.cursor));
      socket.message(logical("epoch", 2, "native_settled"));
    }
  });
  unsubscribeSnapshotB = client.subscribe((snapshot) => snapshotB.push(snapshot.cursor));
  socket = await openClient(harness, client); completeInitial(socket);
  snapshotB.length = 0;
  socket.message(logical("epoch", 1, "native_settled"));
  assert.deepEqual(snapshotB, [1], "unsubscribe cannot remove a listener from the captured revision");
  assert.deepEqual(snapshotC, [1, 2], "nested subscriber gets current then every not-yet-public identity");

  let unsubscribeEffectB = () => {}, effectMutated = false;
  const effectB = [], effectC = [];
  client.subscribeEffects((delivery) => {
    if (delivery.sequence === 3 && !effectMutated) {
      effectMutated = true;
      unsubscribeEffectB();
      client.subscribeEffects((next) => effectC.push(next.sequence));
      socket.message(logical("epoch", 4, "notice", { level: "info", message: "nested" }));
    }
  });
  unsubscribeEffectB = client.subscribeEffects((delivery) => effectB.push(delivery.sequence));
  socket.message(logical("epoch", 3, "notice", { level: "info", message: "outer" }));
  assert.deepEqual(effectB, [3]);
  assert.deepEqual(effectC, [4]);
  client.stop();
});

test("all synchronous transport resource failures are contained with finite restartable state", async () => {
  {
    const harness = createHarness();
    harness.dependencies.createAbortController = () => { throw new Error("abort create"); };
    const client = new SessionTransportClient("id", harness.dependencies);
    assert.doesNotThrow(() => client.start());
    assert.equal(client.getSnapshot().errorClass, "ticket_unavailable");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
  {
    const harness = createHarness();
    harness.dependencies.fetch = () => { throw new Error("fetch"); };
    const client = new SessionTransportClient("id", harness.dependencies);
    assert.doesNotThrow(() => client.start());
    assert.equal(client.getSnapshot().errorClass, "ticket_unavailable");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
  for (const boundary of ["location", "socket", "handler"]) {
    const harness = createHarness();
    if (boundary === "location") harness.dependencies.getLocation = () => { throw new Error("location"); };
    if (boundary === "socket") harness.dependencies.createWebSocket = () => { throw new Error("socket"); };
    if (boundary === "handler") {
      harness.dependencies.createWebSocket = (url) => {
        const base = new FakeSocket(url);
        const socket = new Proxy(base, { set(target, property, value) {
          if (property === "onmessage") throw new Error("handler");
          return Reflect.set(target, property, value);
        } });
        harness.sockets.push(socket);
        return socket;
      };
    }
    const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.resolve(response()); await flush();
    assert.equal(client.getSnapshot().errorClass, "socket_unavailable", boundary);
    assert.equal(harness.timers.size, 1, boundary);
    client.stop();
  }
  {
    const harness = createHarness();
    harness.dependencies.setTimeout = () => { throw new Error("timer"); };
    const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.reject(new Error("ticket")); await flush();
    assert.equal(client.getSnapshot().connectionState, "idle");
    assert.equal(client.getSnapshot().errorClass, "ticket_unavailable");
    assert.equal(harness.timers.size, 0);
    assert.doesNotThrow(() => client.start());
    assert.equal(harness.fetches.length, 2, "scheduling failure leaves start directly restartable");
    client.stop();
  }
});

test("abort, timer-clear, socket send/close, and event getter throws never escape", async () => {
  {
    const harness = createHarness();
    const signal = new AbortController().signal;
    harness.dependencies.createAbortController = () => ({ signal, abort() { throw new Error("abort"); } });
    const client = new SessionTransportClient("id", harness.dependencies);
    client.start();
    assert.doesNotThrow(() => client.stop());
  }
  {
    const harness = createHarness();
    harness.dependencies.clearTimeout = () => { throw new Error("clear"); };
    const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.reject(new Error("fetch")); await flush();
    const staleTimer = harness.timers.values().next().value;
    assert.doesNotThrow(() => client.stop());
    assert.doesNotThrow(() => staleTimer());
    assert.equal(harness.fetches.length, 1);
  }
  {
    const harness = createHarness();
    const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.resolve(response()); await flush();
    const socket = harness.sockets[0];
    socket.send = () => { throw new Error("send"); };
    assert.doesNotThrow(() => socket.open());
    assert.equal(client.getSnapshot().errorClass, "socket_unavailable");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
  {
    const harness = createHarness();
    const client = new SessionTransportClient("id", harness.dependencies);
    const socket = await openClient(harness, client);
    socket.close = () => { throw new Error("close"); };
    assert.doesNotThrow(() => socket.binary());
    assert.equal(client.getSnapshot().errorClass, "protocol_malformed");
    assert.doesNotThrow(() => client.stop());
  }
  {
    const harness = createHarness();
    const client = new SessionTransportClient("id", harness.dependencies);
    const socket = await openClient(harness, client);
    assert.doesNotThrow(() => socket.onmessage?.({ get data() { throw new Error("data"); } }));
    assert.equal(client.getSnapshot().errorClass, "protocol_malformed");
    client.stop();
  }
});

test("pre-open text/binary/Blob/ArrayBuffer data and close-error races fail once", async () => {
  for (const data of [
    JSON.stringify(ready("initial_snapshot", "epoch", 0)),
    new Uint8Array([1]),
    new Blob(["frame"]),
    new ArrayBuffer(2),
  ]) {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.resolve(response()); await flush();
    const socket = harness.sockets[0];
    assert.doesNotThrow(() => socket.onmessage?.({ data }));
    assert.equal(client.getSnapshot().errorClass, "protocol_malformed");
    assert.equal(harness.timers.size, 1);
    client.stop();
  }
  for (const order of ["error-close", "close-error"]) {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    const socket = await openClient(harness, client);
    const error = socket.onerror, close = socket.onclose;
    if (order === "error-close") { error?.({}); close?.({ code: 1013 }); }
    else { close?.({ code: 1013 }); error?.({}); }
    assert.equal(harness.timers.size, 1);
    assert.equal(client.getSnapshot().errorClass, order === "error-close" ? "socket_unavailable" : "slow_consumer");
    client.stop();
  }
});

test("synchronous timer callback is contained without recursive reconnect", async () => {
  const harness = createHarness();
  let timerCalls = 0;
  harness.dependencies.setTimeout = (callback) => { timerCalls += 1; callback(); return 99; };
  const client = new SessionTransportClient("id", harness.dependencies);
  client.start(); harness.fetches[0].result.reject(new Error("fetch")); await flush();
  assert.equal(timerCalls, 1);
  assert.equal(harness.fetches.length, 1);
  assert.equal(client.getSnapshot().connectionState, "idle");
  client.start();
  assert.equal(harness.fetches.length, 2);
  client.stop();
});

test("stop reentrancy during connecting, open, and reconnect publication leaves no resource", async () => {
  {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    client.subscribe((snapshot) => { if (snapshot.connectionState === "connecting") client.stop(); });
    client.start();
    assert.equal(client.getSnapshot().connectionState, "idle");
    assert.equal(harness.fetches.length, 0);
    assert.equal(harness.sockets.length, 0);
    assert.equal(harness.timers.size, 0);
  }
  {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    client.start(); harness.fetches[0].result.resolve(response()); await flush();
    const socket = harness.sockets[0];
    client.subscribe((snapshot) => { if (snapshot.connectionState === "awaiting_ready") client.stop(); });
    assert.doesNotThrow(() => socket.open());
    assert.equal(socket.sent.length, 0);
    assert.equal(client.getSnapshot().connectionState, "idle");
    assert.equal(harness.timers.size, 0);
  }
  {
    const harness = createHarness(); const client = new SessionTransportClient("id", harness.dependencies);
    const socket = await openClient(harness, client); completeInitial(socket);
    client.subscribe((snapshot) => { if (snapshot.connectionState === "reconnecting") client.stop(); });
    socket.serverClose(1006);
    assert.equal(client.getSnapshot().connectionState, "idle");
    assert.equal(harness.timers.size, 0);
  }
});

test("listener mutation, throws, and diagnostics are isolated and content-safe", async () => {
  const harness = createHarness(); const diagnostics = [];
  const client = new SessionTransportClient("private-session", harness.dependencies, { diagnostic: (entry) => diagnostics.push(entry) });
  let calls = 0;
  client.subscribe(() => { calls += 1; throw new Error("private error"); });
  client.subscribe((snapshot) => { assert.throws(() => { snapshot.cursor = 99; }, TypeError); });
  const socket = await openClient(harness, client); completeInitial(socket);
  assert.ok(calls >= 2);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-session|private error|epoch|server|ticket|cursor|payload/);
  client.stop();
});
