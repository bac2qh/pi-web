import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const { startPiWebServer } = require("../bin/pi-web-server.js");
const { PI_WEB_TRANSPORT_PATH } = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST: postTicket } = await jiti.import("../app/api/transport/ticket/route.ts");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { SESSION_REGISTRATION_TEST_SYMBOL } = await jiti.import("./session-channel.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");

function nextFactoryForTicketRoute() {
  return () => ({
    async prepare() {},
    getRequestHandler() {
      return async (req, res) => {
        if (req.url === "/api/transport/ticket" && req.method === "POST") {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
            else if (value !== undefined) headers.set(key, value);
          }
          const response = await postTicket(new Request(`http://${req.headers.host}${req.url}`, {
            method: "POST", headers, body: Buffer.concat(chunks), duplex: "half",
          }));
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
        let body = Buffer.alloc(0);
        for await (const chunk of req) body = Buffer.concat([body, chunk]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ method: req.method, bytes: body.byteLength }));
      };
    },
    async close() {},
  });
}

function syntheticAgentSessionWrapper(manager) {
  const state = { emit: null, abortCalls: 0, disposeCalls: 0 };
  const inner = {
    get sessionId() { return manager.getSessionId(); },
    get sessionFile() { return manager.getSessionFile(); },
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    pendingMessageCount: 0,
    sessionManager: manager,
    agent: { state: {} },
    extensionRunner: {},
    subscribe(callback) { state.emit = callback; return () => { state.emit = null; }; },
    dispose() { state.disposeCalls += 1; },
    abort: async () => { state.abortCalls += 1; },
    reload: async () => {}, prompt: async () => {}, steer: async () => {}, followUp: async () => {},
    compact: async () => ({}), abortCompaction() {}, getContextUsage: () => undefined,
    getSteeringMessages: () => [], getFollowUpMessages: () => [],
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  return { wrapper, state, emit(event) { state.emit?.(event); } };
}

async function issueChannel(base, origin, body) {
  const response = await fetch(`${base}/api/transport/ticket`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Pi-Web-Transport": "1" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
const issue = (base, origin, id) => issueChannel(base, origin, { channel: "session", sessionId: id });

function rejectedUpgradeStatus(base, origin, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`, { origin });
    socket.once("open", () => { socket.terminate(); reject(new Error("upgrade_unexpectedly_opened")); });
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      response.resume();
      resolve(status);
    });
    socket.once("error", (error) => {
      if (!String(error.message).startsWith("Unexpected server response:")) reject(error);
    });
  });
}

function openRaw(base, origin, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`, { origin });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function open(base, origin, ticket, resume) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`, { origin });
    const frames = [];
    socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
    socket.once("open", () => {
      socket.send(JSON.stringify({
        protocol: "pi-web-session-transport", version: 1, type: "resume",
        streamEpoch: resume?.epoch ?? null, cursor: resume?.cursor ?? null,
      }));
      resolve({ socket, frames });
    });
    socket.once("error", reject);
  });
}

async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label}_timeout`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", resolve);
    socket.close(1000);
  });
}

test("actual ticket POST and same-port session channel stay resumable and HTTP-schedulable", { timeout: 60_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-session-channel-"));
  const cwd = join(directory, "cwd");
  const manager = SessionManager.create(cwd, directory);
  manager.appendMessage({ role: "user", content: "synthetic", timestamp: 1 });
  const file = manager.getSessionFile();
  const id = manager.getSessionId();
  writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd })}\n`);
  cacheSessionPath(id, file);
  const synthetic = syntheticAgentSessionWrapper(manager);
  const wrapper = synthetic.wrapper;
  const hub = wrapper.getProjectedEventHub();
  assert.ok(hub);
  globalThis.__piSessions ??= new Map();
  globalThis.__piSessions.set(id, wrapper);
  t.after(() => {
    if (wrapper.isAlive()) wrapper.destroy();
    globalThis.__piSessions?.delete(id);
    invalidateSessionPathCache(id);
    rmSync(directory, { recursive: true, force: true });
  });

  const start = (port = 0) => startPiWebServer({
    dev: false, hostname: "127.0.0.1", port, diagnostics: () => {},
    dependencies: { nextFactory: nextFactoryForTicketRoute() },
  });
  let server = await start();
  t.after(() => server.close().catch(() => {}));
  let httpBase = `http://127.0.0.1:${server.address.port}`;
  let wsBase = `ws://127.0.0.1:${server.address.port}`;

  const firstTicket = await issue(httpBase, httpBase, id);
  assert.equal(firstTicket.response.status, 200);
  assert.deepEqual(Object.keys(firstTicket.body).sort(), ["expiresAt", "ticket"]);
  assert.equal(JSON.stringify(firstTicket.body).includes(id), false);
  const first = await open(wsBase, httpBase, firstTicket.body.ticket);
  await waitFor(() => first.frames.at(-1)?.type === "snapshot_end", "initial_snapshot");
  assert.equal(first.frames[0].type, "ready");
  assert.equal(first.frames[0].outcome, "initial_snapshot");
  assert.equal(first.socket.url.includes(id), false);

  const reuseStatus = await new Promise((resolve, reject) => {
    const reused = new WebSocket(`${wsBase}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(firstTicket.body.ticket)}`, { origin: httpBase });
    reused.once("unexpected-response", (_request, response) => { const status = response.statusCode; response.resume(); resolve(status); });
    reused.once("error", (error) => { if (!String(error.message).startsWith("Unexpected server response:")) reject(error); });
  });
  assert.equal(reuseStatus, 401);

  const clients = [first];
  for (let index = 1; index < 7; index += 1) {
    const issued = await issue(httpBase, httpBase, id);
    clients.push(await open(wsBase, httpBase, issued.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor }));
  }
  await waitFor(() => clients.every((client) => client.frames.length > 0), "seven_ready");

  const runningSockets = [];
  for (let index = 0; index < 57; index += 1) {
    const runningTicket = await issueChannel(httpBase, httpBase, { channel: "running" });
    runningSockets.push(await openRaw(wsBase, httpBase, runningTicket.body.ticket));
  }
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 64, "mixed_capacity");
  const rejectedTicket = await issue(httpBase, httpBase, id);
  assert.equal(await rejectedUpgradeStatus(wsBase, httpBase, rejectedTicket.body.ticket), 429);
  await closeSocket(runningSockets.pop());
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 63, "mixed_release");
  assert.equal(await rejectedUpgradeStatus(wsBase, httpBase, rejectedTicket.body.ticket), 401, "cap rejection spends the ticket");
  const readmissionTicket = await issue(httpBase, httpBase, id);
  const readmitted = await open(wsBase, httpBase, readmissionTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => readmitted.frames[0]?.type === "ready", "mixed_readmission");
  await closeSocket(readmitted.socket);
  await Promise.all(runningSockets.map(closeSocket));
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 7, "mixed_cleanup");

  const getResponse = await fetch(`${httpBase}/bounded`);
  assert.equal(getResponse.status, 200);
  const postResponse = await fetch(`${httpBase}/bounded`, { method: "POST", body: "synthetic" });
  assert.deepEqual(await postResponse.json(), { method: "POST", bytes: 9 });

  synthetic.emit({ type: "agent_start" });
  await waitFor(() => clients.every((client) => client.frames.some((frame) => frame.type === "activity_started")), "live_all");
  const liveFrames = clients.map((client) => client.frames.filter((frame) => frame.type === "activity_started"));
  assert.ok(liveFrames.every((items) => JSON.stringify(items) === JSON.stringify(liveFrames[0])));

  for (const resumeTarget of [
    { epoch: "wrong-stream", cursor: 0, outcome: "wrong_epoch" },
    { epoch: hub.streamEpoch, cursor: hub.cursor + 1, outcome: "invalid_cursor" },
  ]) {
    const issued = await issue(httpBase, httpBase, id);
    const recovered = await open(wsBase, httpBase, issued.body.ticket, resumeTarget);
    await waitFor(() => recovered.frames.at(-1)?.type === "snapshot_end", resumeTarget.outcome);
    assert.equal(recovered.frames[0].outcome, resumeTarget.outcome);
    await closeSocket(recovered.socket);
  }

  for (const hostile of [
    { send(socket) { socket.send(Buffer.from([1])); }, code: 1003 },
    { send(socket) { socket.send("{}"); }, code: 1008 },
  ]) {
    const issued = await issue(httpBase, httpBase, id);
    const socket = await openRaw(wsBase, httpBase, issued.body.ticket);
    const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
    hostile.send(socket);
    assert.equal(await closed, hostile.code);
  }
  const duplicateTicket = await issue(httpBase, httpBase, id);
  const duplicate = await open(wsBase, httpBase, duplicateTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => duplicate.frames[0]?.type === "ready", "duplicate_ready");
  const duplicateClose = new Promise((resolve) => duplicate.socket.once("close", (code) => resolve(code)));
  duplicate.socket.send(JSON.stringify({ protocol: "pi-web-session-transport", version: 1, type: "resume", streamEpoch: hub.streamEpoch, cursor: hub.cursor }));
  assert.equal(await duplicateClose, 1008);

  await Promise.all(clients.map((client) => closeSocket(client.socket)));
  const stalledTicket = await issue(httpBase, httpBase, id);
  const healthyTicket = await issue(httpBase, httpBase, id);
  const stalled = await open(wsBase, httpBase, stalledTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  const healthy = await open(wsBase, httpBase, healthyTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => stalled.frames[0]?.type === "ready" && healthy.frames[0]?.type === "ready", "slow_pair_ready");
  const stalledClose = new Promise((resolve) => stalled.socket.once("close", (code) => resolve(code)));
  stalled.socket.pause();
  let lastStatusKey = "";
  for (let index = 0; index < 100 && server.gateway.getStats().activeConnectionCount === 2; index += 1) {
    lastStatusKey = `slow-${index}`;
    synthetic.emit({
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: lastStatusKey,
      statusText: "v".repeat(80_000),
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 1, "real_slow_detach", 15_000);
  assert.equal(healthy.socket.readyState, WebSocket.OPEN);
  await waitFor(() => healthy.frames.some((frame) => frame.type === "extension_status_set" && frame.key === lastStatusKey), "healthy_continues");
  stalled.socket.resume();
  assert.ok([1006, 1013].includes(await stalledClose), "retryable close is best effort before terminate fallback");
  await closeSocket(healthy.socket);

  const cursor = hub.cursor;
  synthetic.emit({ type: "entry_appended", entry: { synthetic: true } });
  const reconnectTicket = await issue(httpBase, httpBase, id);
  const reconnect = await open(wsBase, httpBase, reconnectTicket.body.ticket, { epoch: hub.streamEpoch, cursor });
  await waitFor(() => reconnect.frames.some((frame) => frame.sequence === cursor + 1), "zero_subscriber_replay");
  assert.equal(reconnect.frames[0].outcome, "exact");
  await closeSocket(reconnect.socket);

  const overflowCursor = hub.cursor;
  synthetic.emit({
    type: "extension_ui_request",
    id: "durable-overflow",
    method: "custom",
    lines: ["x".repeat(4 * 1024 * 1024 + 1_024)],
  });
  assert.ok(hub.floor > overflowCursor, "an individually over-replay-bound durable frame advances the floor");
  const overflowTicket = await issue(httpBase, httpBase, id);
  const overflow = await open(wsBase, httpBase, overflowTicket.body.ticket, { epoch: hub.streamEpoch, cursor: overflowCursor });
  await waitFor(() => overflow.frames.at(-1)?.type === "snapshot_end", "overflow_snapshot", 30_000);
  assert.equal(overflow.frames[0].outcome, "overflow_snapshot");
  await closeSocket(overflow.socket);
  assert.equal(synthetic.state.abortCalls + synthetic.state.disposeCalls, 0);

  const shutdownTicket = await issue(httpBase, httpBase, id);
  const shutdownOpen = await open(wsBase, httpBase, shutdownTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => shutdownOpen.frames[0]?.outcome === "empty", "shutdown_open_ready");
  const registration = globalThis[SESSION_REGISTRATION_TEST_SYMBOL];
  const ownerRecord = registration.ownerRegistry.get(wrapper);
  assert.equal(ownerRecord.subscribers.size, 1, "one genuine session subscriber remains owned before server close");
  assert.equal(server.gateway.getStats().activeConnectionCount, 1);
  const shutdownSocketClosed = new Promise((resolve) => shutdownOpen.socket.once("close", (code) => resolve(code)));

  const port = server.address.port;
  await server.close();
  assert.equal(await shutdownSocketClosed, 1006, "custom-server close terminates its still-open authorized session socket");
  assert.equal(ownerRecord.subscribers.size, 0, "socket termination releases the channel subscriber");
  assert.deepEqual(server.gateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
  assert.equal(wrapper.isAlive(), true);
  assert.equal(hub.isClosed(), false);

  server = await start(port);
  httpBase = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
  const restartTicket = await issue(httpBase, httpBase, id);
  const restarted = await open(wsBase, httpBase, restartTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => restarted.frames[0]?.outcome === "empty", "restart_empty");

  const oversizedTicket = await issue(httpBase, httpBase, id);
  const oversized = await openRaw(wsBase, httpBase, oversizedTicket.body.ticket);
  const oversizedClose = new Promise((resolve) => oversized.once("close", (code) => resolve(code)));
  oversized.send("x".repeat(16 * 1024 + 1));
  assert.equal(await oversizedClose, 1009, "installed ws owns maximum-payload closure");

  const utf8Ticket = await issue(httpBase, httpBase, id);
  const invalidUtf8 = await openRaw(wsBase, httpBase, utf8Ticket.body.ticket);
  const utf8Close = new Promise((resolve) => invalidUtf8.once("close", (code) => resolve(code)));
  invalidUtf8._sender.send(Buffer.from([0xff]), { binary: false, compress: false, fin: true, mask: true }, () => {});
  assert.equal(await utf8Close, 1007, "installed ws owns invalid-UTF-8 closure");

  assert.equal(wrapper.onDestroyCallbacks.size, 1, "HMR-stable owner registry installs one destruction observer");
  const ownerClose = new Promise((resolve) => restarted.socket.once("close", (code) => resolve(code)));
  wrapper.destroy();
  assert.equal(await ownerClose, 1012);
  assert.equal(synthetic.state.abortCalls, 0);
  assert.equal(synthetic.state.disposeCalls, 1, "only wrapper destruction owns native disposal");
});
