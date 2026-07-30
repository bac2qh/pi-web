import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createPiWebUpgradeHandler,
  normalizePort,
  startPiWebServer,
} = require("../bin/pi-web-server.js");
const {
  PI_WEB_TRANSPORT_GATEWAY_SLOT,
  PI_WEB_TRANSPORT_GATEWAY_VERSION,
  PI_WEB_TRANSPORT_PATH,
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
    this.destroyed = true;
  }
}

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
        assert.equal(entry.outcome, "ok");
        assert.equal(entry.activePiWebSocketCount, 0);
        assert.equal(entry.openConnectionCount, 0);
        assert.equal(entry.registeredChannelCount, 0);
        assert.equal(entry.pendingTicketCount, 0);
        assert.equal(entry.activeTicketTimerCount, 0);
      }
    }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  }
});

test("close aggregates observable failures while still clearing the exact global and port", async () => {
  const diagnostics = [];
  const gatewayCloseError = new Error("gateway close failed");
  const nextCloseError = new Error("next close failed");
  const gateway = {
    version: PI_WEB_TRANSPORT_GATEWAY_VERSION,
    serverInstanceId: "00000000-0000-4000-8000-000000000001",
    isSameHostOrigin: () => false,
    registerChannel: () => () => false,
    issueTicket: () => { throw new Error("unused"); },
    consumeTicket: () => { throw new Error("unused"); },
    getStats: () => ({
      closed: false,
      registeredChannelCount: 0,
      pendingTicketCount: 0,
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
    assert.deepEqual(error.errors, [gatewayCloseError, nextCloseError]);
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
