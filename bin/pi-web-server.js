"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const transportGateway = require("./pi-web-transport-gateway");
const {
  PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES,
  PI_WEB_TRANSPORT_PATH,
  createPiWebTransportGateway,
  installPiWebTransportGateway,
  uninstallPiWebTransportGateway,
} = transportGateway;

function normalizePort(value) {
  const candidate = value ?? 30141;
  if (
    (typeof candidate !== "number" &&
      (typeof candidate !== "string" || !/^\d+$/.test(candidate)))
  ) {
    throw new TypeError("invalid_port");
  }
  const port = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("invalid_port");
  }
  return port;
}

function pathnameFromRequestUrl(requestUrl) {
  if (typeof requestUrl !== "string") return null;
  const queryStart = requestUrl.indexOf("?");
  return queryStart === -1 ? requestUrl : requestUrl.slice(0, queryStart);
}

function rejectUpgrade(socket, statusCode) {
  if (socket.destroyed) return;
  const statusMessage = http.STATUS_CODES[statusCode] ?? "Rejected";
  socket.on("error", () => {});
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
    "Connection: close\r\n" +
    "Content-Length: 0\r\n" +
    "\r\n",
  );
}

function createPiWebUpgradeHandler({ gateway, webSocketServer, diagnostics }) {
  const emitDiagnostic = (event, details = {}) => {
    try {
      diagnostics?.({
        event,
        serverInstanceId: gateway.serverInstanceId,
        activePiWebSocketCount: gateway.getStats().activeConnectionCount,
        ...details,
      });
    } catch {
      // Diagnostics must not affect an upgrade decision.
    }
  };

  return (req, socket, head) => {
    if (pathnameFromRequestUrl(req.url) !== PI_WEB_TRANSPORT_PATH) return false;

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, "http://pi-web.invalid");
    } catch {
      emitDiagnostic("upgrade_rejected", { reason: "malformed" });
      rejectUpgrade(socket, 400);
      return true;
    }

    if (!gateway.isSameHostOrigin(req.headers.origin ?? null, req.headers.host ?? null)) {
      emitDiagnostic("upgrade_rejected", { reason: "origin" });
      rejectUpgrade(socket, 403);
      return true;
    }

    const queryEntries = [...parsedUrl.searchParams.entries()];
    if (queryEntries.length !== 1 || queryEntries[0][0] !== "ticket" || !queryEntries[0][1]) {
      emitDiagnostic("upgrade_rejected", { reason: "ticket" });
      rejectUpgrade(socket, 401);
      return true;
    }

    let authorization;
    try {
      authorization = gateway.consumeTicket(queryEntries[0][1]);
    } catch {
      emitDiagnostic("upgrade_rejected", { reason: "ticket" });
      rejectUpgrade(socket, 401);
      return true;
    }

    let releaseAdmission;
    try {
      // The accepted Node socket is the sole peer-address authority. Forwarded
      // request headers are deliberately never consulted for admission.
      releaseAdmission = gateway.reserveConnection(socket.remoteAddress);
    } catch (error) {
      const reason = error?.code === "peer_unavailable" ? "peer_unavailable" : "connection_limit";
      emitDiagnostic("upgrade_rejected", { reason });
      rejectUpgrade(socket, reason === "connection_limit" ? 429 : 503);
      return true;
    }

    // `ws` may reject a malformed handshake by closing the accepted raw socket
    // without throwing or invoking the upgrade callback. Attach the idempotent
    // reservation release before handing control to `handleUpgrade` so every
    // callback-less close converges with accepted-WebSocket and catch paths.
    const release = () => releaseAdmission();
    socket.once("close", release);

    try {
      webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
        let handlerFailed = false;
        webSocket.once("close", () => {
          release();
          emitDiagnostic("websocket_closed");
        });
        webSocket.on("error", () => {
          emitDiagnostic("websocket_error");
        });

        const closeAfterHandlerFailure = () => {
          if (handlerFailed) return;
          handlerFailed = true;
          try {
            // Keep the reservation until the accepted socket actually closes.
            // Handler failure is terminal, so do not wait on a close handshake.
            webSocket.terminate();
          } catch {
            try { socket.destroy(); } catch { /* admission release still converges */ }
            release();
          }
        };

        emitDiagnostic("upgrade_accepted");
        Promise.resolve()
          .then(() => authorization.handler(webSocket, {
            channel: authorization.channel,
            serverInstanceId: gateway.serverInstanceId,
          }))
          .catch(closeAfterHandlerFailure);
      });
    } catch {
      release();
      emitDiagnostic("upgrade_rejected", { reason: "handshake" });
      if (!socket.destroyed) socket.destroy();
    }

    return true;
  };
}

function listen(httpServer, port, hostname) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };

    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    if (hostname) {
      httpServer.listen(port, hostname);
    } else {
      httpServer.listen(port);
    }
  });
}

function closeWebSocketServer(webSocketServer) {
  return new Promise((resolve, reject) => {
    for (const client of webSocketServer.clients ?? []) client.terminate();
    webSocketServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeHttpServer(httpServer, connections) {
  return new Promise((resolve, reject) => {
    if (!httpServer.listening) {
      for (const socket of connections) socket.destroy();
      resolve();
      return;
    }

    httpServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    httpServer.closeAllConnections?.();
    for (const socket of connections) socket.destroy();
  });
}

async function startPiWebServer(options = {}) {
  const dev = options.dev === true;
  const mode = dev ? "development" : "production";
  const lifecycleOwner = options.lifecycleOwner === "terminal" ? "terminal" : "programmatic";
  process.env.NODE_ENV = mode;

  const dir = path.resolve(options.dir ?? path.join(__dirname, ".."));
  const port = normalizePort(options.port);
  const hostname = options.hostname || undefined;
  const dependencies = options.dependencies ?? {};
  const diagnostics = options.diagnostics ?? (dev
    ? (entry) => console.debug("[pi-web] transport", entry)
    : null);

  // Loading Next here keeps mode selection ahead of every Next module import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nextFactory = dependencies.nextFactory ?? require("next");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebSocketServer = dependencies.WebSocketServer ?? require("ws").WebSocketServer;
  const createHttpServer = dependencies.createHttpServer ?? http.createServer;
  const createGateway = dependencies.createGateway ?? createPiWebTransportGateway;
  const installGateway = dependencies.installGateway ?? installPiWebTransportGateway;
  const uninstallGateway = dependencies.uninstallGateway ?? uninstallPiWebTransportGateway;

  let requestHandler = null;
  let app = null;
  let closePromise = null;
  let closing = false;
  const connections = new Set();

  const httpServer = createHttpServer((req, res) => {
    if (!requestHandler || closing) {
      res.writeHead(503, { "Content-Type": "text/plain", "Content-Length": "0" });
      res.end();
      return;
    }

    Promise.resolve().then(() => requestHandler(req, res)).catch((error) => {
      try {
        diagnostics?.({ event: "request_failed", errorName: error?.name ?? "Error" });
      } catch {
        // Ignore diagnostic sink failures.
      }
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain", "Content-Length": "0" });
        res.end();
      } else {
        res.destroy();
      }
    });
  });
  httpServer.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });

  const gateway = createGateway({ diagnostics });
  try {
    installGateway(gateway);
  } catch (error) {
    try {
      gateway.close();
    } catch {
      // Preserve the installation failure.
    }
    httpServer.removeAllListeners("connection");
    throw error;
  }
  let webSocketServer;
  let upgradeHandler;
  try {
    webSocketServer = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES,
    });
    upgradeHandler = createPiWebUpgradeHandler({
      gateway,
      webSocketServer,
      diagnostics,
    });
    httpServer.on("upgrade", upgradeHandler);
  } catch (error) {
    try {
      gateway.close();
    } catch {
      // Preserve the acquisition failure.
    }
    try {
      uninstallGateway(gateway);
    } catch {
      // Preserve the acquisition failure.
    }
    httpServer.removeAllListeners("connection");
    throw error;
  }

  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    requestHandler = null;
    closePromise = (async () => {
      const errors = [];
      const settleCloseStage = (stage) => {
        try {
          return Promise.resolve(stage()).then(
            () => null,
            (error) => error,
          );
        } catch (error) {
          return Promise.resolve(error);
        }
      };
      const collectCloseStage = async (stage) => {
        const error = await settleCloseStage(stage);
        if (error) errors.push(error);
      };

      try {
        const gatewayStats = gateway.getStats();
        diagnostics?.({
          event: "server_closing",
          mode,
          lifecycleOwner,
          stage: "owned_resources",
          serverInstanceId: gateway.serverInstanceId,
          activePiWebSocketCount: webSocketServer.clients?.size ?? 0,
          openConnectionCount: connections.size,
          ...gatewayStats,
          activeTicketTimerCount: gatewayStats.pendingTicketCount,
        });
      } catch {
        // Ignore diagnostic sink failures.
      }

      httpServer.off("upgrade", upgradeHandler);

      // Both calls execute synchronously through their setup paths. Pi sockets
      // are terminated first, then HTTP acceptance stops without waiting for
      // the WebSocket close callback.
      const webSocketCloseResult = settleCloseStage(
        () => closeWebSocketServer(webSocketServer),
      );
      const httpCloseResult = settleCloseStage(
        () => closeHttpServer(httpServer, connections),
      );
      const webSocketCloseError = await webSocketCloseResult;
      if (webSocketCloseError) errors.push(webSocketCloseError);
      const httpCloseError = await httpCloseResult;
      if (httpCloseError) errors.push(httpCloseError);

      await collectCloseStage(() => gateway.close());
      await collectCloseStage(() => uninstallGateway(gateway));
      await collectCloseStage(() => app?.close());

      for (const socket of connections) socket.destroy();
      connections.clear();
      httpServer.removeAllListeners("connection");

      try {
        const gatewayStats = gateway.getStats();
        diagnostics?.({
          event: "server_closed",
          mode,
          lifecycleOwner,
          stage: "complete",
          outcome: errors.length === 0 ? "ok" : "failed",
          serverInstanceId: gateway.serverInstanceId,
          activePiWebSocketCount: webSocketServer.clients?.size ?? 0,
          openConnectionCount: connections.size,
          ...gatewayStats,
          activeTicketTimerCount: gatewayStats.pendingTicketCount,
        });
      } catch {
        // Ignore diagnostic sink failures.
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, "pi_web_server_close_failed");
      }
    })();
    return closePromise;
  };

  try {
    app = nextFactory({
      dev,
      dir,
      hostname,
      port,
      httpServer,
    });
    await app.prepare();
    requestHandler = app.getRequestHandler();
    await listen(httpServer, port, hostname);

    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("invalid_server_address");

    try {
      diagnostics?.({
        event: "server_ready",
        mode,
        lifecycleOwner,
        stage: "listening",
        outcome: "ok",
        serverInstanceId: gateway.serverInstanceId,
        addressFamily: address.family,
        port: address.port,
      });
    } catch {
      // Ignore diagnostic sink failures.
    }

    return {
      ready: true,
      address: {
        address: address.address,
        family: address.family,
        port: address.port,
      },
      gateway,
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch {
      // Preserve the startup failure; cleanup failure remains bounded here.
    }
    throw error;
  }
}

module.exports = {
  startPiWebServer,
  createPiWebUpgradeHandler,
  normalizePort,
};
