import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createGlobalStatusChannelHandler } = await jiti.import("./global-status-channel.ts");
const { createFileWatchChannelHandler, createFileWatchTicketContext } = await jiti.import("./file-watch-channel.ts");
const {
  createPiWebUpgradeHandler,
  normalizePort,
  publicErrorClass,
  startPiWebServer,
} = require("../bin/pi-web-server.js");
const {
  PI_WEB_TRANSPORT_GATEWAY_SLOT,
  PI_WEB_TRANSPORT_GATEWAY_VERSION,
  PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER,
  PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL,
  PI_WEB_TRANSPORT_PATH,
  createPiWebTransportGateway,
} = require("../bin/pi-web-transport-gateway.js");

function listen(server, port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeNetServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

class RecordingSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.responses = [];
  }

  end(response) {
    this.responses.push(response);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}

test("server diagnostics map hostile mutable error names to finite classes", () => {
  const hostile = new Error("private message");
  hostile.name = "private/path/" + "x".repeat(10_000);
  assert.equal(publicErrorClass(hostile), "Error");
  assert.equal(publicErrorClass(new RangeError("private message")), "RangeError");
  assert.equal(publicErrorClass({ get name() { throw new Error("private getter"); } }), "Error");
});

test("accepts only decimal integer port values in range", () => {
  for (const [value, expected] of [
    [undefined, 30141],
    [0, 0],
    [30141, 30141],
    ["0", 0],
    ["30141", 30141],
    ["065535", 65_535],
  ]) {
    assert.equal(normalizePort(value), expected);
  }

  for (const value of [
    "",
    " ",
    "1e3",
    "0x50",
    "1.5",
    "-1",
    "+1",
    "65536",
    -1,
    65_536,
    true,
    {},
  ]) {
    assert.throws(() => normalizePort(value), /invalid_port/);
  }
});

test("contains synchronous and asynchronous request-handler failures", async () => {
  const diagnostics = [];
  const nextFactory = () => ({
    async prepare() {},
    getRequestHandler() {
      return (req, res) => {
        if (req.url === "/sync") throw new Error("sync request failure");
        if (req.url === "/async") return Promise.reject(new Error("async request failure"));
        res.writeHead(204);
        res.end();
        return undefined;
      };
    },
    async close() {},
  });
  const server = await startPiWebServer({
    dev: true,
    hostname: "127.0.0.1",
    port: 0,
    diagnostics: (entry) => diagnostics.push(entry),
    dependencies: { nextFactory },
  });

  try {
    for (const path of ["/sync", "/async"]) {
      const response = await fetch(`http://127.0.0.1:${server.address.port}${path}`);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("content-length"), "0");
      assert.equal(await response.text(), "");
    }
    assert.deepEqual(
      diagnostics
        .filter((entry) => entry.event === "request_failed")
        .map((entry) => entry.errorName),
      ["Error", "Error"],
    );
  } finally {
    await server.close();
  }
});

test("injected development and production servers close idempotently and reuse their ports", async () => {
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    for (const dev of [true, false]) {
      const diagnostics = [];
      let nextCloseCalls = 0;
      let serverSequence = 0;
      const nextFactory = (options) => {
        serverSequence += 1;
        const sequence = serverSequence;
        return {
          async prepare() {
            assert.equal(options.httpServer.listening, false);
          },
          getRequestHandler() {
            return async (_req, res) => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ dev, sequence }));
            };
          },
          async close() {
            nextCloseCalls += 1;
            assert.equal(options.httpServer.listening, false);
            assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
          },
        };
      };

      for (let cycle = 1; cycle <= 2; cycle += 1) {
        const server = await startPiWebServer({
          dev,
          hostname: "127.0.0.1",
          port: 0,
          lifecycleOwner: "programmatic",
          diagnostics: (entry) => diagnostics.push(entry),
          dependencies: { nextFactory },
        });
        const port = server.address.port;

        assert.equal(server.ready, true);
        assert.equal(process.env.NODE_ENV, dev ? "development" : "production");
        const response = await fetch(`http://127.0.0.1:${port}/test`);
        assert.deepEqual(await response.json(), { dev, sequence: cycle });

        const firstClose = server.close();
        assert.equal(server.close(), firstClose);
        await firstClose;
        assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
        assert.deepEqual(server.gateway.getStats(), {
          closed: true,
          registeredChannelCount: 0,
          pendingTicketCount: 0,
          activeConnectionCount: 0,
          activePeerKeyCount: 0,
        });

        const rebound = createServer();
        await listen(rebound, port);
        await closeNetServer(rebound);
      }

      assert.equal(nextCloseCalls, 2);
      const readyEntries = diagnostics.filter((entry) => entry.event === "server_ready");
      const closingEntries = diagnostics.filter((entry) => entry.event === "server_closing");
      const closedEntries = diagnostics.filter((entry) => entry.event === "server_closed");
      assert.equal(readyEntries.length, 2);
      assert.equal(closingEntries.length, 2);
      assert.equal(closedEntries.length, 2);
      for (const entry of [...readyEntries, ...closingEntries, ...closedEntries]) {
        assert.equal(entry.mode, dev ? "development" : "production");
        assert.equal(entry.lifecycleOwner, "programmatic");
      }
      for (const entry of closedEntries) {
        assert.equal(entry.stage, "complete");
        assert.equal(entry.outcome, "graceful");
        assert.equal(entry.activePiWebSocketCount, 0);
        assert.equal(entry.openConnectionCount, 0);
        assert.equal(entry.registeredChannelCount, 0);
        assert.equal(entry.pendingTicketCount, 0);
        assert.equal(entry.activeTicketTimerCount, 0);
        assert.equal(entry.activeConnectionCount, 0);
        assert.equal(entry.activePeerKeyCount, 0);
      }
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  }
});

test("close aggregates runtime-owner and terminal failures while still clearing the exact global and port", async () => {
  const diagnostics = [];
  const runtimeOwnerCleanupError = new Error("runtime_owner_cleanup_failed");
  const gatewayCloseError = new Error("gateway close failed");
  const nextCloseError = new Error("next close failed");
  const gateway = {
    version: PI_WEB_TRANSPORT_GATEWAY_VERSION,
    ownerLifecycleVersion: 1,
    ticketContextVersion: 1,
    serverInstanceId: "00000000-0000-4000-8000-000000000001",
    isSameHostOrigin: () => false,
    isAcceptingOwners: () => true,
    registerChannel: () => () => false,
    registerRuntimeOwner: (_ownerClass, ownerClose) => ({
      token: { serverInstanceId: "00000000-0000-4000-8000-000000000001", ownerClass: "rpc", isCurrent: () => true },
      unregister: () => { ownerClose("owner_replaced"); return true; },
    }),
    beginShutdown: () => true,
    waitForRuntimeOwnerCleanup: async () => { throw runtimeOwnerCleanupError; },
    issueTicket: () => { throw new Error("unused"); },
    consumeTicket: () => { throw new Error("unused"); },
    reserveConnection: () => { throw new Error("unused"); },
    getStats: () => ({
      closed: false,
      registeredChannelCount: 0,
      pendingTicketCount: 0,
      activeConnectionCount: 0,
      activePeerKeyCount: 0,
    }),
    close: () => { throw gatewayCloseError; },
  };
  const nextFactory = () => ({
    async prepare() {},
    getRequestHandler() {
      return async (_req, res) => {
        res.writeHead(204);
        res.end();
      };
    },
    async close() {
      assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
      throw nextCloseError;
    },
  });

  const server = await startPiWebServer({
    dev: false,
    hostname: "127.0.0.1",
    port: 0,
    diagnostics: (entry) => diagnostics.push(entry),
    dependencies: {
      nextFactory,
      createGateway: () => gateway,
    },
  });
  const port = server.address.port;
  const firstClose = server.close();
  assert.equal(server.close(), firstClose);

  await assert.rejects(firstClose, (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.message, "pi_web_server_close_failed");
    assert.deepEqual(error.errors, [runtimeOwnerCleanupError, gatewayCloseError, nextCloseError]);
    return true;
  });

  assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
  const closed = diagnostics.findLast((entry) => entry.event === "server_closed");
  assert.equal(closed.outcome, "failed");
  assert.equal(closed.openConnectionCount, 0);

  const rebound = createServer();
  await listen(rebound, port);
  await closeNetServer(rebound);
});

test("startup failure invokes public Next cleanup and removes owned gateway state", async () => {
  let nextCloseCalls = 0;
  const startupError = new Error("prepare failed");
  const nextFactory = () => ({
    async prepare() { throw startupError; },
    getRequestHandler() { throw new Error("unreachable"); },
    async close() { nextCloseCalls += 1; },
  });

  await assert.rejects(
    startPiWebServer({
      dev: true,
      hostname: "127.0.0.1",
      port: 0,
      diagnostics: () => {},
      dependencies: { nextFactory },
    }),
    startupError,
  );
  assert.equal(nextCloseCalls, 1);
  assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
});

test("WebSocket acquisition failure closes and uninstalls the newly owned gateway", async () => {
  const acquisitionError = new Error("WebSocket acquisition failed");
  let createdGateway;
  class FailingWebSocketServer {
    constructor() {
      throw acquisitionError;
    }
  }

  await assert.rejects(
    startPiWebServer({
      dev: true,
      hostname: "127.0.0.1",
      port: 0,
      diagnostics: () => {},
      dependencies: {
        WebSocketServer: FailingWebSocketServer,
        createGateway(options) {
          const {
            createPiWebTransportGateway,
          } = require("../bin/pi-web-transport-gateway.js");
          createdGateway = createPiWebTransportGateway(options);
          return createdGateway;
        },
      },
    }),
    (error) => error === acquisitionError,
  );

  assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
  assert.deepEqual(createdGateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
});

class AcceptedWebSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.closeCalls = [];
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

test("upgrade orders consume, reserve, handshake, and handler while cap rejection consumes its ticket", async () => {
  const diagnostics = [];
  const trace = [];
  const consumedTickets = new Set();
  let handlerCalls = 0;
  let handleUpgradeCalls = 0;
  const webSocket = new AcceptedWebSocket();
  const gateway = {
    serverInstanceId: "test-instance",
    isSameHostOrigin: () => true,
    consumeTicket(ticket) {
      trace.push("consume");
      if (consumedTickets.has(ticket)) {
        const error = new Error("already consumed");
        error.code = "invalid_ticket";
        throw error;
      }
      consumedTickets.add(ticket);
      const ticketContext = Object.freeze({ opaque: true });
      return {
        channel: "running",
        ticketContext,
        bindRawSocket: () => true,
        handler: (_socket, context) => {
          assert.strictEqual(context.ticketContext, ticketContext);
          trace.push("handler");
          handlerCalls += 1;
        },
      };
    },
    reserveConnection(peerAddress) {
      trace.push("reserve");
      if (peerAddress === "limited-peer") {
        const error = new Error("bounded admission rejection");
        error.code = "connection_limit";
        throw error;
      }
      if (!peerAddress) {
        const error = new Error("bounded missing peer");
        error.code = "peer_unavailable";
        throw error;
      }
      let released = false;
      return () => {
        if (released) return false;
        released = true;
        return true;
      };
    },
    getStats: () => ({ activeConnectionCount: 0 }),
  };
  const upgrade = createPiWebUpgradeHandler({
    gateway,
    webSocketServer: {
      clients: new Set(),
      handleUpgrade(_req, _socket, _head, callback) {
        trace.push("handleUpgrade");
        handleUpgradeCalls += 1;
        callback(webSocket);
      },
    },
    diagnostics: (entry) => diagnostics.push(entry),
  });
  const request = (ticket) => ({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${ticket}`,
    headers: {
      host: "localhost",
      origin: "http://localhost",
      forwarded: "for=trusted-must-not-be-used",
      "x-forwarded-for": "trusted-must-not-be-used",
    },
  });

  const accepted = new RecordingSocket();
  accepted.remoteAddress = "direct-peer";
  assert.equal(upgrade(request("a".repeat(43)), accepted, Buffer.alloc(0)), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(trace, ["consume", "reserve", "handleUpgrade", "handler"]);
  assert.equal(handleUpgradeCalls, 1);
  assert.equal(handlerCalls, 1);
  webSocket.close(1000);

  trace.length = 0;
  const rejectedTicket = "b".repeat(43);
  const rejected = new RecordingSocket();
  rejected.remoteAddress = "limited-peer";
  assert.equal(upgrade(request(rejectedTicket), rejected, Buffer.alloc(0)), true);
  assert.equal(rejected.responses[0].startsWith("HTTP/1.1 429"), true);
  assert.deepEqual(trace, ["consume", "reserve"]);
  assert.equal(handleUpgradeCalls, 1);
  assert.equal(handlerCalls, 1);

  const reused = new RecordingSocket();
  reused.remoteAddress = "direct-peer";
  assert.equal(upgrade(request(rejectedTicket), reused, Buffer.alloc(0)), true);
  assert.equal(reused.responses[0].startsWith("HTTP/1.1 401"), true);
  assert.deepEqual(trace, ["consume", "reserve", "consume"]);
  assert.equal(handleUpgradeCalls, 1);
  assert.equal(handlerCalls, 1);

  const missing = new RecordingSocket();
  assert.equal(upgrade(request("c".repeat(43)), missing, Buffer.alloc(0)), true);
  assert.equal(missing.responses[0].startsWith("HTTP/1.1 503"), true);
  assert.equal(handleUpgradeCalls, 1);
  assert.equal(handlerCalls, 1);
  assert.equal(JSON.stringify(diagnostics).includes("trusted-must-not-be-used"), false);
});

test("upgrade admission releases exactly once on normal close, handler failure, and handshake throw", async () => {
  const releaseCounts = [];
  const runCase = async ({ handler, handshakeThrows = false }) => {
    let releases = 0;
    const webSocket = new AcceptedWebSocket();
    const rawSocket = new RecordingSocket();
    rawSocket.remoteAddress = "direct-peer";
    const upgrade = createPiWebUpgradeHandler({
      gateway: {
        serverInstanceId: "test-instance",
        isSameHostOrigin: () => true,
        consumeTicket: () => ({ channel: "running", handler, bindRawSocket: () => true }),
        reserveConnection: () => {
          let released = false;
          return () => {
            if (released) return false;
            released = true;
            releases += 1;
            return true;
          };
        },
        getStats: () => ({ activeConnectionCount: releases === 0 ? 1 : 0 }),
      },
      webSocketServer: {
        clients: new Set(),
        handleUpgrade(_req, _socket, _head, callback) {
          if (handshakeThrows) throw new Error("synthetic handshake failure");
          callback(webSocket);
        },
      },
      diagnostics: () => {},
    });
    upgrade({
      url: `${PI_WEB_TRANSPORT_PATH}?ticket=${"c".repeat(43)}`,
      headers: { host: "localhost", origin: "http://localhost" },
    }, rawSocket, Buffer.alloc(0));
    await new Promise((resolve) => setImmediate(resolve));
    if (!handshakeThrows && webSocket.readyState !== 3) webSocket.close(1000);
    webSocket.emit("close", 1000);
    releaseCounts.push(releases);
  };

  await runCase({ handler: () => {} });
  await runCase({ handler: () => { throw new Error("sync handler failure"); } });
  await runCase({ handler: async () => { throw new Error("async handler failure"); } });
  await runCase({ handler: () => {}, handshakeThrows: true });
  assert.deepEqual(releaseCounts, [1, 1, 1, 1]);
});

test("accepted client close before deferred handler dispatch leaves no global subscribers", async () => {
  const runningListeners = new Set();
  const discoveryListeners = new Set();
  const webSocket = new AcceptedWebSocket();
  const rawSocket = new RecordingSocket();
  rawSocket.remoteAddress = "direct-peer";
  let releases = 0;
  const handler = createGlobalStatusChannelHandler({
    getRunningSessionIds: () => [],
    getSessionListGeneration: () => 0,
    subscribeRunning(listener) {
      runningListeners.add(listener);
      return () => runningListeners.delete(listener);
    },
    subscribeSessionList(listener) {
      discoveryListeners.add(listener);
      return () => discoveryListeners.delete(listener);
    },
  });
  const upgrade = createPiWebUpgradeHandler({
    gateway: {
      serverInstanceId: "test-instance",
      isSameHostOrigin: () => true,
      consumeTicket: () => ({ channel: "running", handler, bindRawSocket: () => true }),
      reserveConnection: () => {
        let released = false;
        return () => {
          if (released) return false;
          released = true;
          releases += 1;
          return true;
        };
      },
      getStats: () => ({ activeConnectionCount: releases === 0 ? 1 : 0 }),
    },
    webSocketServer: {
      clients: new Set(),
      handleUpgrade(_req, _socket, _head, callback) { callback(webSocket); },
    },
    diagnostics: () => {},
  });

  upgrade({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=${"d".repeat(43)}`,
    headers: { host: "localhost", origin: "http://localhost" },
  }, rawSocket, Buffer.alloc(0));
  // Channel dispatch is intentionally deferred by the upgrade handler.
  webSocket.close(1000);
  rawSocket.emit("close");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runningListeners.size, 0);
  assert.equal(discoveryListeners.size, 0);
  assert.equal(releases, 1);
});

test("dispatcher enforces deterministic mixed-channel 256/257 total admission across direct peers and restores capacity", async () => {
  const acceptedWebSockets = [];
  let handlerCalls = 0;
  const peers = ["direct-peer-a", "direct-peer-b", "direct-peer-c", "direct-peer-d"];
  const countingGateway = createPiWebTransportGateway();
  let sequence = 0;
  countingGateway.registerChannel("running", () => { handlerCalls += 1; });
  countingGateway.registerChannel("session", () => { handlerCalls += 1; });
  const countingIssue = () => countingGateway.issueTicket(sequence++ % 2 === 0 ? "running" : "session").ticket;
  const countingUpgrade = createPiWebUpgradeHandler({
    gateway: countingGateway,
    webSocketServer: {
      clients: new Set(),
      handleUpgrade(_req, _socket, _head, callback) {
        const webSocket = new AcceptedWebSocket();
        acceptedWebSockets.push(webSocket);
        callback(webSocket);
      },
    },
    diagnostics: () => {},
  });
  const countingDispatch = (ticket, peer) => {
    const socket = new RecordingSocket();
    socket.remoteAddress = peer;
    countingUpgrade({
      url: `${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`,
      headers: { host: "localhost", origin: "http://localhost" },
    }, socket, Buffer.alloc(0));
    return socket;
  };

  for (let index = 0; index < PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL; index += 1) {
    countingDispatch(countingIssue(), peers[Math.floor(index / PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER)]);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handlerCalls, 256);
  assert.equal(countingGateway.getStats().activeConnectionCount, 256);
  assert.equal(countingGateway.getStats().activePeerKeyCount, 4);

  const rejectedTicket = countingIssue();
  const rejected = countingDispatch(rejectedTicket, "direct-peer-e");
  assert.equal(rejected.responses[0].startsWith("HTTP/1.1 429"), true);
  assert.equal(handlerCalls, 256);
  const reused = countingDispatch(rejectedTicket, "direct-peer-e");
  assert.equal(reused.responses[0].startsWith("HTTP/1.1 401"), true, "total-cap rejection spends the ticket");

  acceptedWebSockets[0].close(1000);
  assert.equal(countingGateway.getStats().activeConnectionCount, 255);
  countingDispatch(countingIssue(), "direct-peer-e");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handlerCalls, 257);
  assert.equal(countingGateway.getStats().activeConnectionCount, 256);
  assert.equal(countingGateway.getStats().activePeerKeyCount, 5);

  for (const webSocket of acceptedWebSockets.slice(1)) webSocket.close(1000);
  assert.equal(countingGateway.getStats().activeConnectionCount, 0);
  assert.equal(countingGateway.getStats().activePeerKeyCount, 0);
  countingGateway.close();
});

test("real malformed handshake releases admission and permits a valid re-admission", {
  timeout: 30_000,
}, async (t) => {
  const nextFactory = () => ({
    async prepare() {},
    getRequestHandler() {
      return async (_req, res) => { res.writeHead(204); res.end(); };
    },
    async close() {},
  });
  const server = await startPiWebServer({
    dev: false,
    hostname: "127.0.0.1",
    port: 0,
    diagnostics: () => {},
    dependencies: { nextFactory },
  });
  t.after(() => server.close().catch(() => {}));
  let handlerCalls = 0;
  const ownerReasons = [];
  let unregister = server.gateway.registerChannel("test.handshake", () => { handlerCalls += 1; }, (reason) => ownerReasons.push(reason));
  const waitForAdmissionRelease = async () => {
    const deadline = Date.now() + 10_000;
    while (server.gateway.getStats().activeConnectionCount !== 0) {
      if (Date.now() >= deadline) throw new Error("handshake_admission_release_timeout");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const { ticket } = server.gateway.issueTicket("test.handshake");
  const rawResponse = await new Promise((resolve, reject) => {
    let response = "";
    const socket = connect({ host: "127.0.0.1", port: server.address.port });
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(
        `GET ${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${server.address.port}\r\n` +
        `Origin: http://127.0.0.1:${server.address.port}\r\n` +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: malformed\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => { response += chunk; });
    socket.once("error", reject);
    socket.once("close", () => resolve(response));
  });
  assert.match(rawResponse, /^HTTP\/1\.1 400 /);
  assert.equal(handlerCalls, 0);
  assert.throws(() => server.gateway.consumeTicket(ticket), (error) => error?.code === "invalid_ticket");
  await waitForAdmissionRelease();
  assert.equal(server.gateway.getStats().activeConnectionCount, 0);
  assert.equal(server.gateway.getStats().activePeerKeyCount, 0);
  unregister();
  assert.deepEqual(ownerReasons, ["owner_replaced"]);
  assert.deepEqual(server.gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
  unregister = server.gateway.registerChannel("test.handshake", () => { handlerCalls += 1; }, (reason) => ownerReasons.push(reason));

  const validTicket = server.gateway.issueTicket("test.handshake").ticket;
  const validSocket = new WebSocket(
    `ws://127.0.0.1:${server.address.port}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(validTicket)}`,
    { origin: `http://127.0.0.1:${server.address.port}`, handshakeTimeout: 10_000 },
  );
  await new Promise((resolve, reject) => {
    validSocket.once("open", resolve);
    validSocket.once("error", reject);
  });
  assert.equal(handlerCalls, 1);
  await new Promise((resolve) => {
    validSocket.once("close", resolve);
    validSocket.close(1000);
  });
  await waitForAdmissionRelease();
  unregister();
  assert.deepEqual(ownerReasons, ["owner_replaced", "owner_replaced"]);
  assert.equal(server.gateway.getStats().activeConnectionCount, 0);
  assert.equal(server.gateway.getStats().activePeerKeyCount, 0);
  assert.deepEqual(server.gateway.getOwnerLifecycleStats(), {
    retiredRegistrationCount: 0, enlistedSocketCount: 0, closeFallbackCount: 0, pendingConsumedCount: 0,
  });
});

test("real Node loopback mixed running/session authorizations enforce 64/65 with re-admission", {
  timeout: 60_000,
}, async (t) => {
  const nextFactory = () => ({
    async prepare() {},
    getRequestHandler() {
      return async (_req, res) => { res.writeHead(204); res.end(); };
    },
    async close() {},
  });
  const server = await startPiWebServer({
    dev: false,
    hostname: "127.0.0.1",
    port: 0,
    diagnostics: () => {},
    dependencies: { nextFactory },
  });
  t.after(() => server.close().catch(() => {}));
  let handlerCalls = 0;
  server.gateway.registerChannel("running", () => { handlerCalls += 1; });
  server.gateway.registerChannel("session", () => { handlerCalls += 1; });
  const origin = `http://127.0.0.1:${server.address.port}`;
  const base = `ws://127.0.0.1:${server.address.port}${PI_WEB_TRANSPORT_PATH}`;
  let issueSequence = 0;
  const issueMixed = () => server.gateway.issueTicket(issueSequence++ % 2 === 0 ? "running" : "session");

  const open = async () => {
    const { ticket } = issueMixed();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`, {
        origin,
        handshakeTimeout: 10_000,
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
      socket.once("unexpected-response", (_request, response) => {
        const status = response.statusCode;
        response.resume();
        reject(new Error(`unexpected_status_${status}`));
      });
    });
  };
  const rejectedStatus = async () => {
    const { ticket } = issueMixed();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`, {
        origin,
        handshakeTimeout: 10_000,
      });
      socket.once("open", () => {
        socket.terminate();
        reject(new Error("admission_unexpectedly_opened"));
      });
      socket.once("unexpected-response", (_request, response) => {
        const status = response.statusCode;
        response.resume();
        resolve(status);
      });
      socket.once("error", (error) => {
        if (!String(error.message).startsWith("Unexpected server response:")) reject(error);
      });
    });
  };
  const closeAll = async (sockets) => {
    await Promise.all(sockets.map((socket) => new Promise((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      socket.once("close", resolve);
      socket.close(1000);
    })));
  };
  const waitForActiveCount = async (expected) => {
    const deadline = Date.now() + 10_000;
    while (server.gateway.getStats().activeConnectionCount !== expected) {
      if (Date.now() >= deadline) throw new Error("admission_release_timeout");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const sockets = [];
  for (let index = 0; index < PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER; index += 1) {
    sockets.push(await open());
  }
  assert.equal(server.gateway.getStats().activeConnectionCount, 64);
  assert.equal(server.gateway.getStats().activePeerKeyCount, 1);
  assert.equal(await rejectedStatus(), 429);
  assert.equal(handlerCalls, 64);

  const released = sockets.pop();
  await closeAll([released]);
  await waitForActiveCount(63);
  sockets.push(await open());
  assert.equal(handlerCalls, 65);
  await closeAll(sockets);
  await waitForActiveCount(0);
  assert.deepEqual(server.gateway.getStats(), {
    closed: false,
    registeredChannelCount: 2,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
});

test("touches only the exact reserved upgrade path and redacts query values", () => {
  const diagnostics = [];
  let consumeCalls = 0;
  let handleUpgradeCalls = 0;
  const handler = createPiWebUpgradeHandler({
    gateway: {
      serverInstanceId: "test-instance",
      isSameHostOrigin: () => false,
      consumeTicket: () => { consumeCalls += 1; },
      reserveConnection: () => { throw new Error("unused"); },
      getStats: () => ({ activeConnectionCount: 0 }),
    },
    webSocketServer: {
      clients: new Set(),
      handleUpgrade: () => { handleUpgradeCalls += 1; },
    },
    diagnostics: (entry) => diagnostics.push(entry),
  });

  const nonPiSocket = new RecordingSocket();
  assert.equal(handler({
    url: "/_next/webpack-hmr?ticket=do-not-log",
    headers: { host: "localhost", origin: "http://localhost" },
  }, nonPiSocket, Buffer.alloc(0)), false);
  assert.equal(nonPiSocket.responses.length, 0);
  assert.equal(nonPiSocket.destroyed, false);
  assert.equal(consumeCalls, 0);
  assert.equal(handleUpgradeCalls, 0);
  assert.equal(diagnostics.length, 0);

  const rejectedSocket = new RecordingSocket();
  assert.equal(handler({
    url: `${PI_WEB_TRANSPORT_PATH}?ticket=do-not-log`,
    headers: { host: "localhost", origin: "http://other" },
  }, rejectedSocket, Buffer.alloc(0)), true);
  assert.equal(rejectedSocket.responses.length, 1);
  assert.equal(rejectedSocket.responses[0].startsWith("HTTP/1.1 403"), true);
  assert.equal(JSON.stringify(diagnostics).includes("do-not-log"), false);
  assert.equal(rejectedSocket.responses[0].includes("do-not-log"), false);
});

test("custom-server close synchronously releases an accepted file watcher while HTTP remains schedulable", async () => {
  const directory = fs.mkdtempSync(join(tmpdir(), "pi-web-file-watch-server-"));
  const filePath = join(directory, "target.txt");
  fs.writeFileSync(filePath, "fixture");
  let activeWatchers = 0;
  let watcherCloseCalls = 0;
  const handler = createFileWatchChannelHandler({
    watch(target, listener) {
      const watcher = fs.watch(target, listener);
      activeWatchers += 1;
      let closed = false;
      return {
        on(event, callback) { watcher.on(event, callback); return this; },
        close() {
          if (closed) return;
          closed = true;
          watcherCloseCalls += 1;
          activeWatchers -= 1;
          watcher.close();
        },
      };
    },
    stat(target) { return fs.statSync(target); },
    setTimeout,
    clearTimeout,
  });
  const nextFactory = () => ({
    async prepare() {},
    getRequestHandler() { return async (_request, response) => { response.writeHead(204); response.end(); }; },
    async close() {},
  });
  const server = await startPiWebServer({ dev: true, hostname: "127.0.0.1", port: 0, diagnostics: () => {}, dependencies: { nextFactory } });
  try {
    server.gateway.registerChannel("file-watch", handler);
    const issued = server.gateway.issueTicket("file-watch", createFileWatchTicketContext(filePath, "ordinary"));
    const url = `ws://127.0.0.1:${server.address.port}${PI_WEB_TRANSPORT_PATH}?ticket=${issued.ticket}`;
    const socket = new WebSocket(url, { headers: { Origin: `http://127.0.0.1:${server.address.port}` } });
    await new Promise((resolve, reject) => {
      socket.once("message", () => resolve());
      socket.once("error", reject);
    });
    assert.equal(activeWatchers, 1);
    const response = await fetch(`http://127.0.0.1:${server.address.port}/health`);
    assert.equal(response.status, 204);
    await server.close();
    assert.equal(activeWatchers, 0);
    assert.equal(watcherCloseCalls, 1);
  } finally {
    await server.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
