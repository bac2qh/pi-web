import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const {
  PI_WEB_HEARTBEAT_INTERVAL_MS,
  PI_WEB_SHUTDOWN_GRACE_MS,
  createPiWebUpgradeHandler,
  createWebSocketHeartbeat,
  startPiWebServer,
} = require("../bin/pi-web-server.js");
const { createPiWebTransportGateway, PI_WEB_TRANSPORT_PATH } = require("../bin/pi-web-transport-gateway.js");
const { WebSocket } = require("ws");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const execFileAsync = promisify(execFile);
const openWebSocket = (url, origin, options = {}) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { origin, ...options });
  socket.once("open", () => resolve(socket));
  socket.once("error", reject);
});

class Socket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.closeCalls = [];
    this.terminateCalls = 0;
    this.pingCalls = 0;
  }
  close(code) { this.closeCalls.push(code); this.readyState = 2; }
  terminate() { this.terminateCalls += 1; this.readyState = 3; this.emit("close"); }
  ping() { this.pingCalls += 1; }
}

function clock() {
  let now = 0;
  let next = 1;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const value = { id: next++, at: now + delay, callback, unref() {} };
      timeouts.set(value.id, value);
      return value;
    },
    clearTimeout(value) { if (value) timeouts.delete(value.id); },
    setInterval(callback, delay) {
      const value = { id: next++, delay, callback, unrefCalls: 0, unref() { this.unrefCalls += 1; } };
      intervals.set(value.id, value);
      return value;
    },
    clearInterval(value) { if (value) intervals.delete(value.id); },
    advance(milliseconds) {
      now += milliseconds;
      for (;;) {
        const due = [...timeouts.values()].filter((item) => item.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timeouts.delete(due.id);
        due.callback();
      }
    },
    sweep() { for (const value of [...intervals.values()]) value.callback(); },
    timeoutCount: () => timeouts.size,
    intervalCount: () => intervals.size,
    firstInterval: () => [...intervals.values()][0],
  };
}

test("S6 constants freeze one 30-second heartbeat and one 10-second owned grace", () => {
  assert.equal(PI_WEB_HEARTBEAT_INTERVAL_MS, 30_000);
  assert.equal(PI_WEB_SHUTDOWN_GRACE_MS, 10_000);
});

test("gateway owner lifecycle enlists before dispatch and distinguishes replacement from shutdown", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({
    randomUUID: () => "server",
    randomBytes: () => Buffer.alloc(32, 7),
    now: c.now,
    setTimeout: c.setTimeout,
    clearTimeout: c.clearTimeout,
  });
  assert.equal(gateway.ownerLifecycleVersion, 1);
  const reasons = [];
  gateway.registerChannel("session", () => {}, (reason) => reasons.push(reason));
  const ticket = gateway.issueTicket("session");
  const authorization = gateway.consumeTicket(ticket.ticket);
  const socket = new Socket();
  const enlisted = authorization.enlistSocket(socket);
  assert.equal(enlisted.ownerToken.isCurrent(), true);
  gateway.beginShutdown();
  assert.deepEqual(reasons, ["server_shutdown"]);
  assert.deepEqual(socket.closeCalls, [1001]);
  c.advance(9_999);
  assert.equal(socket.terminateCalls, 0);
  c.advance(100_000);
  assert.equal(socket.terminateCalls, 0, "gateway never forces server-shutdown sockets");
  assert.equal(enlisted.ownerToken.isCurrent(), false);
  gateway.close();

  const replacement = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const replacementReasons = [];
  const unregister = replacement.registerChannel("running", () => {}, (reason) => replacementReasons.push(reason));
  const consumed = replacement.consumeTicket(replacement.issueTicket("running").ticket);
  const replacedSocket = new Socket();
  consumed.enlistSocket(replacedSocket);
  unregister();
  assert.deepEqual(replacementReasons, ["owner_replaced"]);
  assert.deepEqual(replacedSocket.closeCalls, [1012]);
  c.advance(1_000);
  assert.equal(replacedSocket.terminateCalls, 1, "replacement retains bounded local fallback");
  replacement.close();
});

test("reentrant shutdown inside replacement owner cleanup cannot install a late gateway fallback", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  let unregister;
  unregister = gateway.registerChannel("running", () => {}, () => gateway.beginShutdown());
  const authorization = gateway.consumeTicket(gateway.issueTicket("running").ticket);
  const socket = new Socket();
  authorization.enlistSocket(socket);
  unregister();
  assert.equal(gateway.getOwnerLifecycleStats().closeFallbackCount, 0);
  c.advance(100_000);
  assert.equal(socket.terminateCalls, 0);
  socket.readyState = 3;
  socket.emit("close");
  gateway.close();
});

test("retired all-channel HMR ownership is enlisted into later shutdown and leaves no fallback references", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const sockets = [];
  const reasons = new Map();
  for (const channel of ["running", "session", "file-watch"]) {
    const observed = [];
    reasons.set(channel, observed);
    const unregister = gateway.registerChannel(channel, () => {}, (reason) => observed.push(reason));
    const authorization = gateway.consumeTicket(gateway.issueTicket(channel).ticket);
    const socket = new Socket();
    sockets.push(socket);
    const releaseAdmission = gateway.reserveConnection("127.0.0.1");
    socket.once("close", releaseAdmission);
    authorization.enlistSocket(socket);
    unregister();
    gateway.registerChannel(channel, () => {}, (reason) => observed.push(`replacement:${reason}`));
    assert.equal(gateway.getSocketChannelClass(socket), channel === "file-watch" ? "file_watch" : channel);
  }
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 3, enlistedSocketCount: 3, closeFallbackCount: 3, pendingConsumedCount: 0,
  });
  gateway.beginShutdown();
  assert.deepEqual([...reasons.values()], [
    ["owner_replaced", "replacement:server_shutdown"],
    ["owner_replaced", "replacement:server_shutdown"],
    ["owner_replaced", "replacement:server_shutdown"],
  ]);
  assert.equal(gateway.getOwnerLifecycleStats().closeFallbackCount, 0);
  c.advance(9_999);
  assert.deepEqual(sockets.map((socket) => socket.terminateCalls), [0, 0, 0]);
  c.advance(1);
  for (const socket of sockets) socket.terminate(); // the server coordinator's exact boundary
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  gateway.close();
});

test("pre-enlist replacement retained through shutdown suppresses its fallback and releases naturally", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const unregister = gateway.registerChannel("running", () => {}, () => {});
  const authorization = gateway.consumeTicket(gateway.issueTicket("running").ticket);
  const releaseAdmission = gateway.reserveConnection("127.0.0.1");
  unregister();
  assert.equal(gateway.getOwnerLifecycleStats().pendingConsumedCount, 1);
  gateway.beginShutdown();
  const socket = new Socket();
  socket.once("close", releaseAdmission);
  assert.equal(authorization.handleEnlistmentFailure(socket), "server_shutdown");
  assert.equal(gateway.getOwnerLifecycleStats().closeFallbackCount, 0);
  c.advance(9_999);
  assert.equal(socket.terminateCalls, 0);
  socket.readyState = 3;
  socket.emit("close");
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  gateway.close();
});

test("callback-less handshake abandons its authorization and a later hostile callback cannot repopulate owner state", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const reasons = [];
  const unregister = gateway.registerChannel("running", () => {}, (reason) => reasons.push(reason));
  const ticket = gateway.issueTicket("running");
  let delayedUpgrade;
  const webSocketServer = { handleUpgrade(_req, _socket, _head, callback) { delayedUpgrade = callback; } };
  const handler = createPiWebUpgradeHandler({ gateway, webSocketServer, diagnostics: () => {} });
  const raw = new EventEmitter();
  raw.remoteAddress = "127.0.0.1";
  raw.destroyed = false;
  raw.end = () => raw.destroy();
  raw.destroy = () => { if (!raw.destroyed) { raw.destroyed = true; raw.emit("close"); } };
  handler({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
    headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141" },
  }, raw, Buffer.alloc(0));
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  assert.equal(gateway.getOwnerLifecycleStats().pendingConsumedCount, 0);
  unregister();
  assert.deepEqual(reasons, ["owner_replaced"]);
  assert.equal(gateway.getOwnerLifecycleStats().retiredRegistrationCount, 0);

  const hostile = new Socket();
  delayedUpgrade(hostile);
  assert.equal(hostile.terminateCalls, 1);
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  assert.deepEqual(gateway.getStats(), {
    closed: false, registeredChannelCount: 0, pendingTicketCount: 0, activeConnectionCount: 0, activePeerKeyCount: 0,
  });
  gateway.close();
});

test("terminal raw bindings reject before admission with no retained owner or transport state", () => {
  for (const mode of ["already_destroyed", "synchronous_close_during_once"]) {
    const gateway = createPiWebTransportGateway();
    let handlerCalls = 0;
    let handleUpgradeCalls = 0;
    const ownerReasons = [];
    const unregister = gateway.registerChannel("running", () => { handlerCalls += 1; }, (reason) => ownerReasons.push(reason));
    const ticket = gateway.issueTicket("running");
    const raw = new EventEmitter();
    raw.remoteAddress = "peer-a";
    raw.destroyed = mode === "already_destroyed";
    raw.responses = [];
    raw.end = (response) => { raw.responses.push(response); raw.destroy(); };
    raw.destroy = () => {
      if (raw.destroyed) return;
      raw.destroyed = true;
      raw.emit("close");
    };
    if (mode === "synchronous_close_during_once") {
      const ordinaryOnce = raw.once.bind(raw);
      raw.once = (event, listener) => {
        ordinaryOnce(event, listener);
        if (event === "close") raw.destroy();
        return raw;
      };
    }
    const upgrade = createPiWebUpgradeHandler({
      gateway,
      webSocketServer: { handleUpgrade() { handleUpgradeCalls += 1; } },
      diagnostics: () => {},
    });
    assert.equal(upgrade({
      url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
      headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141" },
    }, raw, Buffer.alloc(0)), true, mode);
    assert.equal(handlerCalls, 0, mode);
    assert.equal(handleUpgradeCalls, 0, mode);
    assert.equal(raw.listenerCount("close"), 0, mode);
    assert.deepEqual(gateway.getOwnerLifecycleStats(), {
      retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
    }, mode);
    unregister();
    assert.deepEqual(ownerReasons, ["owner_replaced"], mode);
    assert.deepEqual(gateway.getStats(), {
      closed: false, registeredChannelCount: 0, pendingTicketCount: 0, activeConnectionCount: 0, activePeerKeyCount: 0,
    }, mode);
    assert.deepEqual(gateway.getOwnerLifecycleStats(), {
      retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
    }, mode);
    gateway.close();
  }
});

test("real gateway settles every pre-callback admission and handshake terminal path exactly once", () => {
  const cases = [
    { name: "per_peer_cap", peer: "peer-a", fill: (gateway) => Array.from({ length: 64 }, () => gateway.reserveConnection("peer-a")), status: 429 },
    { name: "total_cap", peer: "peer-e", fill: (gateway) => Array.from({ length: 256 }, (_, index) => gateway.reserveConnection(`peer-${Math.floor(index / 64)}`)), status: 429 },
    { name: "missing_peer", peer: undefined, fill: () => [], status: 503 },
    { name: "synchronous_handshake_throw", peer: "peer-a", fill: () => [], throws: true },
  ];
  for (const fixture of cases) {
    const gateway = createPiWebTransportGateway();
    const reasons = [];
    const unregister = gateway.registerChannel("running", () => {}, (reason) => reasons.push(reason));
    const fillers = fixture.fill(gateway);
    const ticket = gateway.issueTicket("running");
    const raw = new EventEmitter();
    raw.remoteAddress = fixture.peer;
    raw.destroyed = false;
    raw.responses = [];
    raw.end = (response) => { raw.responses.push(response); raw.destroy(); };
    raw.destroy = () => { if (!raw.destroyed) { raw.destroyed = true; raw.emit("close"); } };
    const upgrade = createPiWebUpgradeHandler({
      gateway,
      webSocketServer: { handleUpgrade() { if (fixture.throws) throw new Error("private"); } },
      diagnostics: () => {},
    });
    upgrade({
      url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
      headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141" },
    }, raw, Buffer.alloc(0));
    for (const release of fillers) release();
    unregister();
    gateway.beginShutdown();
    assert.deepEqual(reasons, ["owner_replaced"], fixture.name);
    assert.deepEqual(gateway.getOwnerLifecycleStats(), {
      retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
    }, fixture.name);
    assert.deepEqual(gateway.getStats(), {
      closed: false, registeredChannelCount: 0, pendingTicketCount: 0, activeConnectionCount: 0, activePeerKeyCount: 0,
    }, fixture.name);
    if (fixture.status) assert.match(raw.responses[0], new RegExp(`^HTTP/1.1 ${fixture.status} `), fixture.name);
    gateway.close();
  }
});

test("raw close before callback abandons once and late enlistment fails closed without retired state", () => {
  const gateway = createPiWebTransportGateway();
  const reasons = [];
  const unregister = gateway.registerChannel("session", () => {}, (reason) => reasons.push(reason));
  let lateCallback;
  const raw = new EventEmitter();
  raw.remoteAddress = "peer-a";
  raw.destroyed = false;
  raw.end = () => raw.destroy();
  raw.destroy = () => { if (!raw.destroyed) { raw.destroyed = true; raw.emit("close"); } };
  const upgrade = createPiWebUpgradeHandler({
    gateway,
    webSocketServer: {
      handleUpgrade(_req, socket, _head, callback) {
        lateCallback = callback;
        socket.emit("close");
      },
    },
    diagnostics: () => {},
  });
  const ticket = gateway.issueTicket("session");
  upgrade({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
    headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141" },
  }, raw, Buffer.alloc(0));
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  unregister();
  const lateSocket = new Socket();
  lateCallback(lateSocket);
  assert.equal(lateSocket.terminateCalls, 1);
  assert.deepEqual(reasons, ["owner_replaced"]);
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  gateway.close();
});

test("HMR then shutdown settles a synchronous late callback with no local force through 9,999 ms", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  const reasons = [];
  let unregister;
  unregister = gateway.registerChannel("file-watch", () => {}, (reason) => reasons.push(reason));
  const socket = new Socket();
  const raw = new EventEmitter();
  raw.remoteAddress = "peer-a";
  raw.destroyed = false;
  raw.end = () => raw.destroy();
  raw.destroy = () => { if (!raw.destroyed) { raw.destroyed = true; raw.emit("close"); } };
  const upgrade = createPiWebUpgradeHandler({
    gateway,
    webSocketServer: {
      handleUpgrade(_req, _raw, _head, callback) {
        unregister();
        gateway.beginShutdown();
        callback(socket);
      },
    },
    diagnostics: () => {},
  });
  const ticket = gateway.issueTicket("file-watch");
  upgrade({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
    headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141" },
  }, raw, Buffer.alloc(0));
  assert.deepEqual(reasons, ["owner_replaced"]);
  assert.deepEqual(socket.closeCalls, [1001]);
  assert.equal(gateway.getOwnerLifecycleStats().pendingConsumedCount, 0);
  c.advance(9_999);
  assert.equal(socket.terminateCalls, 0);
  socket.terminate();
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  gateway.close();
});

test("hostile callback after final gateway close is immediately terminal and cannot recreate ownership", () => {
  const gateway = createPiWebTransportGateway();
  gateway.registerChannel("running", () => {}, () => {});
  let lateCallback;
  const raw = new EventEmitter();
  raw.remoteAddress = "peer-a";
  raw.destroyed = false;
  raw.end = () => raw.destroy();
  raw.destroy = () => { if (!raw.destroyed) { raw.destroyed = true; raw.emit("close"); } };
  const upgrade = createPiWebUpgradeHandler({
    gateway,
    webSocketServer: { handleUpgrade(_req, _socket, _head, callback) { lateCallback = callback; } },
    diagnostics: () => {},
  });
  const ticket = gateway.issueTicket("running");
  upgrade({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
    headers: { host: "127.0.0.1:30141", origin: "http://127.0.0.1:30141" },
  }, raw, Buffer.alloc(0));
  gateway.beginShutdown();
  gateway.close();
  const hostile = new Socket();
  lateCallback(hostile);
  assert.equal(hostile.terminateCalls, 1);
  assert.deepEqual(gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  assert.deepEqual(gateway.getStats(), {
    closed: true, registeredChannelCount: 0, pendingTicketCount: 0, activeConnectionCount: 0, activePeerKeyCount: 0,
  });
});

test("pre-enlist shutdown requests a handshake and never installs a local force", () => {
  const c = clock();
  const gateway = createPiWebTransportGateway({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  gateway.registerChannel("running", () => {}, () => {});
  const authorization = gateway.consumeTicket(gateway.issueTicket("running").ticket);
  const releaseAdmission = gateway.reserveConnection("127.0.0.1");
  const socket = new Socket();
  socket.once("close", releaseAdmission);
  gateway.beginShutdown();
  assert.equal(authorization.handleEnlistmentFailure(socket), "server_shutdown");
  assert.deepEqual(socket.closeCalls, [1001]);
  c.advance(100_000);
  assert.equal(socket.terminateCalls, 0);
  assert.equal(gateway.getStats().activeConnectionCount, 1);
  socket.terminate();
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  gateway.close();
});

test("one heartbeat covers finite channel classes, honors pong, isolates misses, and cancels exactly", () => {
  const c = clock();
  const running = new Socket();
  const session = new Socket();
  const file = new Socket();
  const classes = new Map([[running, "running"], [session, "session"], [file, "file_watch"]]);
  const diagnostics = [];
  const heartbeat = createWebSocketHeartbeat({
    webSocketServer: { clients: new Set([running, session, file]) },
    gateway: { getSocketChannelClass: (socket) => classes.get(socket) },
    diagnostics: (entry) => diagnostics.push(entry),
    setInterval: c.setInterval,
    clearInterval: c.clearInterval,
  });
  assert.equal(c.intervalCount(), 1);
  assert.equal(c.firstInterval().delay, 30_000);
  assert.equal(c.firstInterval().unrefCalls, 1);
  heartbeat.track(running);
  heartbeat.track(session);
  heartbeat.track(file);
  for (const socket of [running, session, file]) {
    assert.deepEqual([socket.listenerCount("pong"), socket.listenerCount("error"), socket.listenerCount("close")], [1, 1, 1]);
  }
  c.sweep();
  assert.deepEqual([running.pingCalls, session.pingCalls, file.pingCalls], [1, 1, 1]);
  running.emit("pong");
  session.emit("pong");
  file.emit("pong");
  c.sweep();
  assert.deepEqual([running.terminateCalls, session.terminateCalls, file.terminateCalls], [0, 0, 0]);
  file.emit("error", new Error("synthetic"));
  running.emit("pong");
  c.sweep();
  assert.equal(session.terminateCalls, 1);
  assert.equal(running.terminateCalls, 0);
  assert.equal(file.terminateCalls, 1);
  for (const socket of [session, file]) {
    assert.deepEqual([socket.listenerCount("pong"), socket.listenerCount("error"), socket.listenerCount("close")], [0, 0, 0]);
  }
  assert.ok(diagnostics.some((entry) => entry.outcome === "pong" && entry.channelClass === "running"));
  assert.ok(diagnostics.some((entry) => entry.outcome === "pong" && entry.channelClass === "session"));
  assert.ok(diagnostics.some((entry) => entry.outcome === "pong" && entry.channelClass === "file_watch"));
  assert.equal(heartbeat.close(), true);
  assert.equal(heartbeat.close(), false);
  assert.deepEqual([running.listenerCount("pong"), running.listenerCount("error"), running.listenerCount("close")], [0, 0, 0]);
  assert.equal(c.intervalCount(), 0);
});

test("heartbeat terminal-pending peers never resume pings and retry termination only on later sweeps", () => {
  const c = clock();
  class ResistantHeartbeatSocket extends Socket {
    constructor({ pingThrows = false, terminateThrows = false } = {}) {
      super(); this.pingThrows = pingThrows; this.terminateThrows = terminateThrows;
    }
    ping() { this.pingCalls += 1; if (this.pingThrows) throw new Error("private_ping"); }
    terminate() { this.terminateCalls += 1; if (this.terminateThrows) throw new Error("private_terminate"); }
  }
  const pingThrow = new ResistantHeartbeatSocket({ pingThrows: true, terminateThrows: true });
  const noClose = new ResistantHeartbeatSocket();
  const clients = new Set([pingThrow, noClose]);
  const heartbeat = createWebSocketHeartbeat({
    webSocketServer: { clients },
    gateway: { getSocketChannelClass: () => "session" },
    setInterval: c.setInterval, clearInterval: c.clearInterval,
  });
  heartbeat.track(pingThrow);
  heartbeat.track(noClose);
  c.sweep();
  assert.deepEqual([pingThrow.pingCalls, pingThrow.terminateCalls], [1, 1], "ping throw immediately becomes terminal-pending");
  noClose.emit("error", new Error("first"));
  noClose.emit("error", new Error("repeated"));
  assert.equal(noClose.terminateCalls, 1, "repeated errors do not create an unbounded retry loop");
  pingThrow.emit("pong");
  noClose.emit("pong");
  c.sweep();
  assert.deepEqual([pingThrow.pingCalls, noClose.pingCalls], [1, 1], "terminal-pending pong cannot revive either peer");
  assert.deepEqual([pingThrow.terminateCalls, noClose.terminateCalls], [2, 2], "one bounded retry occurs on the later sweep");
  assert.deepEqual([pingThrow.listenerCount("pong"), noClose.listenerCount("error")], [1, 1]);
  heartbeat.close();
  assert.deepEqual([
    pingThrow.listenerCount("pong"), pingThrow.listenerCount("error"), pingThrow.listenerCount("close"),
    noClose.listenerCount("pong"), noClose.listenerCount("error"), noClose.listenerCount("close"),
  ], [0, 0, 0, 0, 0, 0]);
  c.sweep();
  assert.deepEqual([pingThrow.terminateCalls, noClose.terminateCalls], [2, 2], "shutdown cancels retries");
});

test("real ws autoPong false is terminated while an automatic-pong peer and HTTP stay healthy", async () => {
  const diagnostics = [];
  const server = await startPiWebServer({
    dev: false,
    hostname: "127.0.0.1",
    port: 0,
    diagnostics: (entry) => diagnostics.push(entry),
    dependencies: {
      heartbeatIntervalMs: 30,
      nextFactory: () => ({
        async prepare() {},
        getRequestHandler: () => (_req, res) => { res.writeHead(204); res.end(); },
        async close() {},
      }),
    },
  });
  try {
    server.gateway.registerChannel("running", () => {}, () => {});
    const origin = `http://127.0.0.1:${server.address.port}`;
    const wsBase = `ws://127.0.0.1:${server.address.port}${PI_WEB_TRANSPORT_PATH}?ticket=`;
    const automaticTicket = server.gateway.issueTicket("running");
    const resistantTicket = server.gateway.issueTicket("running");
    const automatic = await openWebSocket(`${wsBase}${automaticTicket.ticket}`, origin);
    const resistant = await openWebSocket(`${wsBase}${resistantTicket.ticket}`, origin, { autoPong: false });
    const resistantClosed = new Promise((resolve) => resistant.once("close", resolve));
    await Promise.race([resistantClosed, wait(500).then(() => { throw new Error("missed_pong_timeout"); })]);
    assert.equal(resistant.readyState, WebSocket.CLOSED);
    assert.equal(automatic.readyState, WebSocket.OPEN);
    for (let attempt = 0; attempt < 20 && server.gateway.getStats().activeConnectionCount !== 1; attempt += 1) await wait(5);
    assert.equal(server.gateway.getStats().activeConnectionCount, 1, "missed-pong terminal releases admission exactly once");
    const readmissionTicket = server.gateway.issueTicket("running");
    const readmitted = await openWebSocket(`${wsBase}${readmissionTicket.ticket}`, origin);
    assert.equal(server.gateway.getStats().activeConnectionCount, 2);
    assert.equal((await fetch(origin)).status, 204);
    assert.ok(diagnostics.some((entry) => entry.event === "heartbeat" && entry.outcome === "missed" && entry.channelClass === "running"));
    automatic.close();
    readmitted.close();
    await Promise.all([
      new Promise((resolve) => automatic.once("close", resolve)),
      new Promise((resolve) => readmitted.once("close", resolve)),
    ]);
    for (let attempt = 0; attempt < 20 && server.gateway.getStats().activeConnectionCount !== 0; attempt += 1) await wait(5);
    assert.equal(server.gateway.getStats().activeConnectionCount, 0);
  } finally {
    await server.close();
  }
});

test("current-bin injected production runs in a real child and restarts all channel classes on one port", async () => {
  const script = String.raw`
    const { startPiWebServer } = require('./bin/pi-web-server.js');
    const { WebSocket } = require('ws');
    const { PI_WEB_TRANSPORT_PATH } = require('./bin/pi-web-transport-gateway.js');
    const nextFactory = () => ({ async prepare(){}, getRequestHandler(){ return (_q,r)=>{r.writeHead(204);r.end()} }, async close(){} });
    const open = (url, origin) => new Promise((resolve,reject)=>{ const s=new WebSocket(url,{origin});s.once('open',()=>resolve(s));s.once('error',reject) });
    const shut = s => new Promise(resolve=>{s.once('close',resolve);s.close()});
    (async()=>{ let port=0, previous=null; for(let cycle=0;cycle<2;cycle++){
      const server=await startPiWebServer({dev:false,hostname:'127.0.0.1',port,diagnostics:()=>{},dependencies:{nextFactory}});port=server.address.port;
      if(previous===server.gateway.serverInstanceId) throw Error('stale_generation'); previous=server.gateway.serverInstanceId;
      for(const channel of ['running','session','file-watch']) server.gateway.registerChannel(channel,()=>{},()=>{});
      const origin='http://127.0.0.1:'+port, sockets=[];
      for(const channel of ['running','session','file-watch']){const t=server.gateway.issueTicket(channel);sockets.push(await open('ws://127.0.0.1:'+port+PI_WEB_TRANSPORT_PATH+'?ticket='+t.ticket,origin))}
      await Promise.all(sockets.map(shut)); const result=await server.close(); if(result.outcome!=='graceful') throw Error('not_graceful');
    } process.stdout.write(JSON.stringify({cycles:2,channels:3})); })().catch(()=>process.exit(1));
  `;
  const { stdout, stderr } = await execFileAsync(process.execPath, ["-e", script], {
    cwd: process.cwd(), timeout: 30_000, maxBuffer: 32 * 1024,
  });
  assert.deepEqual(JSON.parse(stdout), { cycles: 2, channels: 3 });
  assert.equal(stderr, "");
});

class FakeHttpServer extends EventEmitter {
  constructor(handler) { super(); this.handler = handler; this.listening = false; this.closeCallback = null; this.closeCalls = 0; this.closeAllCalls = 0; }
  listen() { this.listening = true; queueMicrotask(() => this.emit("listening")); }
  address() { return { address: "127.0.0.1", family: "IPv4", port: 32123 }; }
  close(callback) { this.closeCalls += 1; this.listening = false; this.closeCallback = callback; }
  closeAllConnections() { this.closeAllCalls += 1; }
  settleClose() { const callback = this.closeCallback; this.closeCallback = null; callback?.(); }
}
class FakeWss {
  constructor() { this.clients = new Set(); this.closeCallback = null; this.closeCalls = 0; }
  handleUpgrade() {}
  close(callback) { this.closeCalls += 1; this.closeCallback = callback; if (this.clients.size === 0) queueMicrotask(callback); }
  settleClose() { const callback = this.closeCallback; this.closeCallback = null; callback?.(); }
}
class ResistantRawSocket extends EventEmitter {
  constructor(server) { super(); this.server = server; this.destroyCalls = 0; }
  naturalClose() { this.emit("close"); this.server.settleClose(); }
  destroy() { this.destroyCalls += 1; this.emit("close"); this.server.settleClose(); }
}
class ResistantWebSocket extends Socket {
  constructor(wss) { super(); this.wss = wss; }
  terminate() {
    this.terminateCalls += 1;
    this.readyState = 3;
    this.wss.clients.delete(this);
    this.emit("close");
    this.wss.settleClose();
  }
}

async function createInjectedShutdownServer(c, diagnostics = () => {}) {
  let httpServer;
  let wss;
  let appCloseCalls = 0;
  const server = await startPiWebServer({
    dev: false, port: 0, diagnostics,
    dependencies: {
      nextFactory: () => ({ async prepare() {}, getRequestHandler: () => () => {}, async close() { appCloseCalls += 1; } }),
      createHttpServer(handler) { httpServer = new FakeHttpServer(handler); return httpServer; },
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      WebSocketServer: class extends FakeWss { constructor() { super(); wss = this; } },
      now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
      setInterval: c.setInterval, clearInterval: c.clearInterval, setImmediate,
    },
  });
  return { server, httpServer, wss, appCloseCalls: () => appCloseCalls };
}

test("callback after shutdown remains coordinator-owned with zero local force through 9,999 ms", async () => {
  const c = clock();
  let httpServer;
  let wss;
  let server;
  let closing;
  class ShutdownRaceWss extends FakeWss {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    constructor() { super(); wss = this; }
    handleUpgrade(_req, socket, _head, callback) {
      this.clients.add(socket);
      closing = server.close();
      callback(socket);
    }
  }
  class UpgradeSocket extends Socket {
    constructor() {
      super();
      this.remoteAddress = "127.0.0.1";
      this.destroyed = false;
      this.destroyCalls = 0;
    }
    end() { this.destroy(); }
    destroy() {
      if (this.destroyed) return;
      this.destroyCalls += 1;
      this.destroyed = true;
      this.readyState = 3;
      wss.clients.delete(this);
      this.emit("close");
      httpServer.settleClose();
      wss.settleClose();
    }
    terminate() { this.terminateCalls += 1; this.destroy(); }
  }
  server = await startPiWebServer({
    dev: false, port: 0, diagnostics: () => {},
    dependencies: {
      nextFactory: () => ({ async prepare() {}, getRequestHandler: () => () => {}, async close() {} }),
      createHttpServer(handler) { httpServer = new FakeHttpServer(handler); return httpServer; },
      WebSocketServer: ShutdownRaceWss,
      now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
      setInterval: c.setInterval, clearInterval: c.clearInterval, setImmediate,
    },
  });
  const reasons = [];
  server.gateway.registerChannel("running", () => {}, (reason) => reasons.push(reason));
  const ticket = server.gateway.issueTicket("running");
  const socket = new UpgradeSocket();
  httpServer.emit("connection", socket);
  httpServer.emit("upgrade", {
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket.ticket}`,
    headers: { host: "127.0.0.1:32123", origin: "http://127.0.0.1:32123" },
  }, socket, Buffer.alloc(0));
  assert.deepEqual(reasons, ["server_shutdown"]);
  assert.deepEqual(socket.closeCalls, [1001]);
  assert.equal(server.gateway.getOwnerLifecycleStats().pendingConsumedCount, 0);
  c.advance(9_999);
  await Promise.resolve();
  assert.equal(socket.terminateCalls, 0);
  assert.equal(server.gateway.getStats().activeConnectionCount, 1);
  c.advance(1);
  const result = await closing;
  assert.deepEqual(result, { outcome: "forced", forcedWebSocketCount: 1, forcedConnectionCount: 0 });
  assert.equal(socket.terminateCalls, 1);
  assert.equal(server.gateway.getStats().activeConnectionCount, 0);
  assert.deepEqual(server.gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
});

test("reentrant server close installs one latch before synchronous owner cleanup", async () => {
  const c = clock();
  const diagnostics = [];
  const h = await createInjectedShutdownServer(c, (entry) => diagnostics.push(entry));
  let beginShutdownCalls = 0;
  let gatewayCloseCalls = 0;
  const originalBeginShutdown = h.server.gateway.beginShutdown.bind(h.server.gateway);
  const originalGatewayClose = h.server.gateway.close.bind(h.server.gateway);
  h.server.gateway.beginShutdown = (...args) => { beginShutdownCalls += 1; return originalBeginShutdown(...args); };
  h.server.gateway.close = (...args) => { gatewayCloseCalls += 1; return originalGatewayClose(...args); };

  let nestedClose;
  const ownerReasons = [];
  h.server.gateway.registerChannel("session", () => {}, (reason) => {
    ownerReasons.push(reason);
    nestedClose = h.server.close();
  });
  const authorization = h.server.gateway.consumeTicket(h.server.gateway.issueTicket("session").ticket);
  const webSocket = new ResistantWebSocket(h.wss);
  h.wss.clients.add(webSocket);
  authorization.enlistSocket(webSocket);
  webSocket.once("close", h.server.gateway.reserveConnection("127.0.0.1"));
  const raw = new ResistantRawSocket(h.httpServer);
  h.httpServer.emit("connection", raw);

  const outerClose = h.server.close();
  assert.ok(nestedClose, "owner cleanup reentered close synchronously");
  assert.strictEqual(nestedClose, outerClose, "outer and nested calls share the installed latch");
  assert.deepEqual(ownerReasons, ["server_shutdown"]);
  assert.equal(beginShutdownCalls, 1);
  assert.equal(h.wss.closeCalls, 1);
  assert.equal(h.httpServer.closeCalls, 1);
  c.advance(10_000);
  const outerResult = await outerClose;
  const nestedResult = await nestedClose;
  assert.strictEqual(nestedResult, outerResult);
  assert.deepEqual(outerResult, { outcome: "forced", forcedWebSocketCount: 1, forcedConnectionCount: 1 });
  assert.equal(gatewayCloseCalls, 1);
  assert.equal(webSocket.terminateCalls, 1);
  assert.equal(raw.destroyCalls, 1);
  assert.equal(h.httpServer.closeAllCalls, 1);
  assert.equal(h.appCloseCalls(), 1);
  assert.equal(diagnostics.filter((entry) => entry.event === "server_closed").length, 1, "one final result diagnostic");
  assert.equal(c.timeoutCount(), 0);
  assert.equal(c.intervalCount(), 0);
  assert.equal(h.httpServer.listenerCount("connection"), 0);
  assert.equal(h.httpServer.listenerCount("upgrade"), 0);
  assert.equal(webSocket.listenerCount("close"), 0);
  assert.equal(raw.listenerCount("close"), 0);
  assert.deepEqual(h.server.gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  assert.deepEqual(h.server.gateway.getStats(), {
    closed: true, registeredChannelCount: 0, pendingTicketCount: 0, activeConnectionCount: 0, activePeerKeyCount: 0,
  });
});

test("a natural close at 9,999 ms remains graceful with zero coordinator force", async () => {
  const c = clock();
  const h = await createInjectedShutdownServer(c);
  h.server.gateway.registerChannel("session", () => {}, () => {});
  const authorization = h.server.gateway.consumeTicket(h.server.gateway.issueTicket("session").ticket);
  const webSocket = new ResistantWebSocket(h.wss);
  h.wss.clients.add(webSocket);
  authorization.enlistSocket(webSocket);
  const releaseAdmission = h.server.gateway.reserveConnection("127.0.0.1");
  webSocket.once("close", releaseAdmission);
  const raw = new ResistantRawSocket(h.httpServer);
  h.httpServer.emit("connection", raw);
  const closing = h.server.close();
  await Promise.resolve();
  c.advance(9_999);
  h.wss.clients.delete(webSocket);
  webSocket.readyState = 3;
  webSocket.emit("close");
  h.wss.settleClose();
  raw.naturalClose();
  const result = await closing;
  assert.deepEqual(result, { outcome: "graceful", forcedWebSocketCount: 0, forcedConnectionCount: 0 });
  assert.equal(webSocket.terminateCalls, 0);
  assert.equal(raw.destroyCalls, 0);
  assert.equal(h.server.gateway.getStats().activeConnectionCount, 0, "graceful terminal releases admission");
});

test("hostile absent public close callbacks become a bounded failure after zero ownership", async () => {
  const c = clock();
  let appCloseCalls = 0;
  class MissingCallbackWss extends FakeWss { close() {} }
  const server = await startPiWebServer({
    dev: false, port: 0, diagnostics: () => {},
    dependencies: {
      nextFactory: () => ({ async prepare() {}, getRequestHandler: () => () => {}, async close() { appCloseCalls += 1; } }),
      createHttpServer: (handler) => new FakeHttpServer(handler),
      WebSocketServer: MissingCallbackWss,
      now: c.now, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
      setInterval: c.setInterval, clearInterval: c.clearInterval, setImmediate,
    },
  });
  const closing = server.close();
  await new Promise(setImmediate);
  await Promise.resolve();
  c.advance(250);
  await assert.rejects(closing, (error) => error instanceof AggregateError && error.errors.length === 2);
  assert.equal(appCloseCalls, 1, "public Next cleanup still runs after bounded callback failure");
});

test("server coordinator performs zero early force and forces each residual owned class at 10,000 ms", async () => {
  const c = clock();
  const h = await createInjectedShutdownServer(c);
  const { server, httpServer, wss } = h;
  const ownerReasons = [];
  server.gateway.registerChannel("session", () => {}, (reason) => ownerReasons.push(reason));
  const authorization = server.gateway.consumeTicket(server.gateway.issueTicket("session").ticket);
  const webSocket = new ResistantWebSocket(wss);
  wss.clients.add(webSocket);
  authorization.enlistSocket(webSocket);
  const releaseAdmission = server.gateway.reserveConnection("127.0.0.1");
  webSocket.once("close", releaseAdmission);
  const raw = new ResistantRawSocket(httpServer);
  httpServer.emit("connection", raw);

  const closing = server.close();
  await Promise.resolve();
  assert.deepEqual(ownerReasons, ["server_shutdown"]);
  assert.deepEqual(webSocket.closeCalls, [1001]);
  c.advance(9_999);
  await Promise.resolve();
  assert.equal(webSocket.terminateCalls, 0);
  assert.equal(raw.destroyCalls, 0);
  c.advance(1);
  const result = await closing;
  assert.deepEqual(result, { outcome: "forced", forcedWebSocketCount: 1, forcedConnectionCount: 1 });
  assert.equal(webSocket.terminateCalls, 1);
  assert.equal(raw.destroyCalls, 1);
  assert.equal(httpServer.closeAllCalls, 1);
  assert.equal(h.appCloseCalls(), 1);
  assert.equal(c.intervalCount(), 0);
  assert.equal(server.gateway.getStats().activeConnectionCount, 0);
});

test("server coordinator retains retired running/session/file sockets and alone forces them at 10,000 ms", async () => {
  const c = clock();
  const h = await createInjectedShutdownServer(c);
  const sockets = [];
  const semanticReasons = [];
  for (const channel of ["running", "session", "file-watch"]) {
    const unregister = h.server.gateway.registerChannel(channel, () => {}, (reason) => semanticReasons.push(`${channel}:${reason}`));
    const authorization = h.server.gateway.consumeTicket(h.server.gateway.issueTicket(channel).ticket);
    const socket = new ResistantWebSocket(h.wss);
    h.wss.clients.add(socket);
    authorization.enlistSocket(socket);
    const release = h.server.gateway.reserveConnection("127.0.0.1");
    socket.once("close", release);
    unregister();
    h.server.gateway.registerChannel(channel, () => {}, (reason) => semanticReasons.push(`${channel}:replacement:${reason}`));
    sockets.push(socket);
  }
  const closing = h.server.close();
  await Promise.resolve();
  h.httpServer.settleClose();
  assert.deepEqual(semanticReasons, [
    "running:owner_replaced", "session:owner_replaced", "file-watch:owner_replaced",
    "running:replacement:server_shutdown", "session:replacement:server_shutdown", "file-watch:replacement:server_shutdown",
  ]);
  assert.equal(h.server.gateway.getOwnerLifecycleStats().closeFallbackCount, 0);
  c.advance(9_999);
  await Promise.resolve();
  assert.deepEqual(sockets.map((socket) => socket.terminateCalls), [0, 0, 0]);
  c.advance(1);
  const result = await closing;
  assert.deepEqual(result, { outcome: "forced", forcedWebSocketCount: 3, forcedConnectionCount: 0 });
  assert.deepEqual(sockets.map((socket) => socket.terminateCalls), [1, 1, 1]);
  assert.equal(h.server.gateway.getStats().activeConnectionCount, 0);
  assert.deepEqual(h.server.gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
});

test("synchronous owner setup consumes the one absolute shutdown deadline", async () => {
  for (const consumedDuringSetup of [9_999, 10_000]) {
    const c = clock();
    const h = await createInjectedShutdownServer(c);
    const { server, httpServer, wss } = h;
    server.gateway.registerChannel("session", () => {}, () => c.advance(consumedDuringSetup));
    const authorization = server.gateway.consumeTicket(server.gateway.issueTicket("session").ticket);
    const webSocket = new ResistantWebSocket(wss);
    wss.clients.add(webSocket);
    authorization.enlistSocket(webSocket);
    const raw = new ResistantRawSocket(httpServer);
    httpServer.emit("connection", raw);

    const closing = server.close();
    await Promise.resolve();
    if (consumedDuringSetup === 9_999) {
      assert.equal(webSocket.terminateCalls, 0);
      assert.equal(raw.destroyCalls, 0);
      c.advance(1);
    }
    const result = await closing;
    assert.equal(result.outcome, "forced");
    assert.equal(webSocket.terminateCalls, 1, `${consumedDuringSetup}ms setup WebSocket force`);
    assert.equal(raw.destroyCalls, 1, `${consumedDuringSetup}ms setup HTTP force`);
  }
});
