"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { performance } = require("node:perf_hooks");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const transportGateway = require("./pi-web-transport-gateway");
const {
  PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES,
  PI_WEB_TRANSPORT_PATH,
  createPiWebTransportGateway,
  installPiWebTransportGateway,
  uninstallPiWebTransportGateway,
} = transportGateway;

const PI_WEB_HEARTBEAT_INTERVAL_MS = 30_000;
const PI_WEB_SHUTDOWN_GRACE_MS = 10_000;
const PUBLIC_ERROR_CLASSES = new Set([
  "AbortError", "AggregateError", "Error", "EvalError", "RangeError",
  "ReferenceError", "SyntaxError", "TypeError", "URIError",
]);

function publicErrorClass(error) {
  try {
    const name = error?.name;
    return typeof name === "string" && name.length <= 32 && PUBLIC_ERROR_CLASSES.has(name) ? name : "Error";
  } catch { return "Error"; }
}

function normalizePort(value) {
  const candidate = value ?? 30141;
  if (typeof candidate !== "number" && (typeof candidate !== "string" || !/^\d+$/.test(candidate))) {
    throw new TypeError("invalid_port");
  }
  const port = typeof candidate === "number" ? candidate : Number(candidate);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError("invalid_port");
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
  socket.end(`HTTP/1.1 ${statusCode} ${statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function createPiWebUpgradeHandler({ gateway, webSocketServer, diagnostics, onAcceptedSocket }) {
  const emitDiagnostic = (event, details = {}) => {
    try {
      diagnostics?.({
        event,
        serverInstanceId: gateway.serverInstanceId,
        activePiWebSocketCount: gateway.getStats().activeConnectionCount,
        ...details,
      });
    } catch { /* diagnostics are isolated */ }
  };

  return (req, socket, head) => {
    if (pathnameFromRequestUrl(req.url) !== PI_WEB_TRANSPORT_PATH) return false;
    let parsedUrl;
    try { parsedUrl = new URL(req.url, "http://pi-web.invalid"); }
    catch {
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
    try { authorization = gateway.consumeTicket(queryEntries[0][1]); }
    catch {
      emitDiagnostic("upgrade_rejected", { reason: "ticket" });
      rejectUpgrade(socket, 401);
      return true;
    }
    const abandonAuthorization = () => authorization.abandon?.();
    try {
      const bound = authorization.bindRawSocket?.(socket);
      if (bound !== true) throw new Error("consumed_authorization_binding_unavailable");
    } catch {
      abandonAuthorization();
      emitDiagnostic("upgrade_rejected", { reason: "handshake" });
      rejectUpgrade(socket, 503);
      return true;
    }

    let releaseAdmission;
    try {
      // Only the accepted direct socket peer is authoritative. Forwarded headers are ignored.
      releaseAdmission = gateway.reserveConnection(socket.remoteAddress);
    } catch (error) {
      abandonAuthorization();
      const reason = error?.code === "peer_unavailable" ? "peer_unavailable" : "connection_limit";
      emitDiagnostic("upgrade_rejected", { reason });
      rejectUpgrade(socket, reason === "connection_limit" ? 429 : 503);
      return true;
    }

    const release = () => releaseAdmission();
    socket.once("close", release);
    let callbackReceived = false;
    try {
      webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
        callbackReceived = true;
        let enlistment;
        // Admission is retained until the accepted transport is actually terminal,
        // including the consume/reserve/owner-replacement race before enlistment.
        webSocket.once("close", () => {
          enlistment?.release?.();
          release();
          emitDiagnostic("websocket_closed");
        });
        try {
          // This is deliberately synchronous and precedes every Promise/microtask dispatch.
          enlistment = authorization.enlistSocket?.(webSocket);
          if (gateway.ownerLifecycleVersion === 1 && !enlistment) throw new Error("socket_enlistment_unavailable");
        } catch {
          try {
            const reason = authorization.handleEnlistmentFailure?.(webSocket);
            if (!reason) throw new Error("enlistment_failure_owner_unavailable");
          } catch {
            if (gateway.isAcceptingOwners?.() === false) {
              try { if (webSocket.readyState === 1) webSocket.close(1001); } catch { /* coordinator owns force */ }
            } else {
              try { webSocket.terminate(); }
              catch { try { socket.destroy(); } catch { /* raw close listener releases admission */ } }
            }
          }
          return;
        }
        webSocket.on("error", () => emitDiagnostic("websocket_error"));
        try { onAcceptedSocket?.(webSocket); } catch {
          try { webSocket.terminate(); } catch { /* terminal */ }
          return;
        }
        emitDiagnostic("upgrade_accepted");
        Promise.resolve().then(() => {
          if (enlistment?.ownerToken && !enlistment.ownerToken.isCurrent()) return undefined;
          return authorization.handler(webSocket, {
            channel: authorization.channel,
            serverInstanceId: gateway.serverInstanceId,
            ticketContext: authorization.ticketContext,
            ownerToken: enlistment?.ownerToken,
          });
        }).catch(() => {
          // Server shutdown owns the only force boundary. Ordinary handler/HMR failures remain bounded.
          if (gateway.isAcceptingOwners?.() === false) {
            try { if (webSocket.readyState === 1) webSocket.close(1011); } catch { /* server coordinator owns force */ }
            return;
          }
          try { webSocket.terminate(); }
          catch {
            try { socket.destroy(); } catch { /* reservation close listener converges */ }
            release();
          }
        });
      });
    } catch {
      abandonAuthorization();
      emitDiagnostic("upgrade_rejected", { reason: "handshake" });
      if (!socket.destroyed) socket.destroy();
      return true;
    }
    if (!callbackReceived) {
      // ws rejects malformed handshakes without invoking its callback. A
      // successful callback is synchronous; any later hostile callback must
      // observe the abandoned authorization and fail closed.
      abandonAuthorization();
      emitDiagnostic("upgrade_rejected", { reason: "handshake" });
      if (!socket.destroyed) socket.destroy();
    }
    return true;
  };
}

function listen(httpServer, port, hostname) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { httpServer.off("listening", onListening); reject(error); };
    const onListening = () => { httpServer.off("error", onError); resolve(); };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    if (hostname) httpServer.listen(port, hostname);
    else httpServer.listen(port);
  });
}

function createWebSocketHeartbeat({ webSocketServer, gateway, diagnostics, setInterval: scheduleInterval = setInterval, clearInterval: cancelInterval = clearInterval, intervalMs = PI_WEB_HEARTBEAT_INTERVAL_MS }) {
  const states = new Map();
  let closed = false;
  const countClass = (count) => count === 0 ? "zero" : count === 1 ? "one" : "many";
  const report = (outcome, socket) => {
    try {
      const channelClass = gateway.getSocketChannelClass?.(socket) ?? "other";
      if (channelClass === "other") return;
      diagnostics?.({ event: "heartbeat", outcome, channelClass, countClass: countClass(states.size) });
    } catch { /* diagnostics are isolated */ }
  };
  const removeState = (socket, state, outcome = null) => {
    if (states.get(socket) !== state) return false;
    states.delete(socket);
    socket.off?.("pong", state.onPong);
    socket.off?.("error", state.onError);
    socket.off?.("close", state.onClose);
    if (outcome) report(outcome, socket);
    return true;
  };
  const track = (socket) => {
    if (closed) throw new Error("heartbeat_closed");
    const previous = states.get(socket);
    if (previous) removeState(socket, previous);
    const state = { alive: true, terminalPending: false, onPong: null, onError: null, onClose: null };
    const attemptTermination = (outcome) => {
      if (closed || states.get(socket) !== state) return;
      // This transition precedes the first attempt and is irreversible. A
      // throwing/non-closing transport remains retryable on later sweeps but is never pinged again.
      state.terminalPending = true;
      report(outcome, socket);
      try { socket.terminate(); } catch { /* later sweeps retry until close/controller shutdown */ }
    };
    state.onPong = () => {
      if (!closed && states.get(socket) === state && !state.terminalPending) {
        state.alive = true;
        report("pong", socket);
      }
    };
    state.onClose = () => { removeState(socket, state, "closed"); };
    state.onError = () => {
      if (closed || states.get(socket) !== state || state.terminalPending) return;
      attemptTermination("ping_failed");
    };
    states.set(socket, state);
    socket.on("pong", state.onPong);
    socket.on("error", state.onError);
    socket.on("close", state.onClose);
  };
  const sweep = () => {
    if (closed) return;
    for (const socket of [...(webSocketServer.clients ?? [])]) {
      const state = states.get(socket);
      if (!state) continue;
      if (state.terminalPending) {
        try { socket.terminate(); } catch { /* bounded one retry per sweep */ }
        continue;
      }
      if (!state.alive) {
        state.terminalPending = true;
        report("missed", socket);
        try { socket.terminate(); } catch { /* later sweeps retry */ }
        continue;
      }
      state.alive = false;
      try {
        if (socket.readyState !== 1) throw new Error("not_open");
        socket.ping();
        report("sweep", socket);
      } catch {
        state.terminalPending = true;
        report("ping_failed", socket);
        try { socket.terminate(); } catch { /* later sweeps retry */ }
      }
    }
  };
  const timer = scheduleInterval(sweep, intervalMs);
  timer?.unref?.();
  return {
    track,
    close() {
      if (closed) return false;
      closed = true;
      cancelInterval(timer);
      for (const [socket, state] of [...states]) removeState(socket, state);
      return true;
    },
  };
}

function waitImmediate(scheduleImmediate) {
  return new Promise((resolve) => scheduleImmediate(resolve));
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
  const diagnostics = options.diagnostics ?? (dev ? (entry) => console.debug("[pi-web] transport", entry) : null);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nextFactory = dependencies.nextFactory ?? require("next");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WebSocketServer = dependencies.WebSocketServer ?? require("ws").WebSocketServer;
  const createHttpServer = dependencies.createHttpServer ?? http.createServer;
  const createGateway = dependencies.createGateway ?? createPiWebTransportGateway;
  const installGateway = dependencies.installGateway ?? installPiWebTransportGateway;
  const uninstallGateway = dependencies.uninstallGateway ?? uninstallPiWebTransportGateway;
  const now = dependencies.now ?? (() => performance.now());
  const scheduleTimeout = dependencies.setTimeout ?? setTimeout;
  const cancelTimeout = dependencies.clearTimeout ?? clearTimeout;
  const scheduleInterval = dependencies.setInterval ?? setInterval;
  const cancelInterval = dependencies.clearInterval ?? clearInterval;
  const scheduleImmediate = dependencies.setImmediate ?? setImmediate;
  const shutdownGraceMs = dependencies.shutdownGraceMs ?? PI_WEB_SHUTDOWN_GRACE_MS;
  const heartbeatIntervalMs = dependencies.heartbeatIntervalMs ?? PI_WEB_HEARTBEAT_INTERVAL_MS;

  let requestHandler = null;
  let app = null;
  let closePromise = null;
  let closing = false;
  const connections = new Set();
  const resourceListeners = new Set();
  const resourcesChanged = () => { for (const listener of [...resourceListeners]) listener(); };

  const httpServer = createHttpServer((req, res) => {
    if (!requestHandler || closing) {
      res.writeHead(503, { "Content-Type": "text/plain", "Content-Length": "0" });
      res.end();
      return;
    }
    Promise.resolve().then(() => requestHandler(req, res)).catch((error) => {
      try { diagnostics?.({ event: "request_failed", errorName: publicErrorClass(error) }); } catch { /* isolated */ }
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain", "Content-Length": "0" });
        res.end();
      } else res.destroy();
    });
  });
  httpServer.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => { connections.delete(socket); resourcesChanged(); });
  });

  const gateway = createGateway({ diagnostics });
  if (gateway.ownerLifecycleVersion !== 1 || typeof gateway.beginShutdown !== "function"
    || typeof gateway.isAcceptingOwners !== "function") {
    try { gateway.close(); } catch { /* preserve compatibility failure */ }
    throw new Error("gateway_owner_lifecycle_unavailable");
  }
  try {
    installGateway(gateway);
    globalThis.__piWebActivateRpcRuntimeOwnerV1?.();
  }
  catch (error) {
    try { gateway.close(); } catch { /* preserve installation failure */ }
    httpServer.removeAllListeners("connection");
    throw error;
  }

  let webSocketServer;
  let upgradeHandler;
  let heartbeat;
  try {
    webSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES });
    heartbeat = createWebSocketHeartbeat({
      webSocketServer, gateway, diagnostics,
      setInterval: scheduleInterval, clearInterval: cancelInterval, intervalMs: heartbeatIntervalMs,
    });
    upgradeHandler = createPiWebUpgradeHandler({ gateway, webSocketServer, diagnostics, onAcceptedSocket: heartbeat.track });
    httpServer.on("upgrade", upgradeHandler);
  } catch (error) {
    try { heartbeat?.close(); } catch { /* preserve acquisition failure */ }
    try { gateway.close(); } catch { /* preserve acquisition failure */ }
    try { uninstallGateway(gateway); } catch { /* preserve acquisition failure */ }
    httpServer.removeAllListeners("connection");
    throw error;
  }

  const close = () => {
    if (closePromise) return closePromise;
    let resolveClose;
    let rejectClose;
    closePromise = new Promise((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    closing = true;
    requestHandler = null;
    const coordinator = (async () => {
      const startedAt = now();
      const shutdownDeadline = startedAt + shutdownGraceMs;
      const errors = [];
      let forcedWebSockets = 0;
      let forcedConnections = 0;
      let forced = false;
      let webSocketCallbackSettled = false;
      let httpCallbackSettled = false;
      const collectSync = (stage) => {
        try { stage(); } catch (error) { errors.push(error); }
      };
      const ownedAreSettled = () => (webSocketServer.clients?.size ?? 0) === 0 && connections.size === 0;
      const waitForSignal = (predicate, maximumMs) => new Promise((resolve) => {
        if (predicate()) { resolve(true); return; }
        let done = false;
        let timer;
        const finish = (value) => {
          if (done) return;
          done = true;
          resourceListeners.delete(onChange);
          if (timer) cancelTimeout(timer);
          resolve(value);
        };
        const onChange = () => { if (predicate()) finish(true); };
        resourceListeners.add(onChange);
        timer = scheduleTimeout(() => finish(predicate()), maximumMs);
        timer?.unref?.();
        onChange();
      });

      try {
        const stats = gateway.getStats();
        diagnostics?.({
          event: "server_closing", mode, lifecycleOwner, stage: "owned_resources",
          serverInstanceId: gateway.serverInstanceId,
          activePiWebSocketCount: webSocketServer.clients?.size ?? 0,
          openConnectionCount: connections.size,
          ...stats,
          activeTicketTimerCount: stats.pendingTicketCount,
        });
      } catch { /* isolated */ }

      httpServer.off("upgrade", upgradeHandler);
      collectSync(() => heartbeat.close());
      collectSync(() => gateway.beginShutdown("server_shutdown"));
      for (const client of webSocketServer.clients ?? []) {
        if (gateway.isSocketEnlisted?.(client)) continue;
        try { if (client.readyState === 1) client.close(1001); } catch (error) { errors.push(error); }
      }

      collectSync(() => webSocketServer.close((error) => {
        webSocketCallbackSettled = true;
        if (error) errors.push(error);
        resourcesChanged();
      }));
      if (!httpServer.listening) httpCallbackSettled = true;
      else collectSync(() => httpServer.close((error) => {
        httpCallbackSettled = true;
        if (error) errors.push(error);
        resourcesChanged();
      }));

      if (!ownedAreSettled()) {
        const remainingGraceMs = Math.max(0, shutdownDeadline - now());
        if (remainingGraceMs > 0) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resourceListeners.delete(onChange);
              if (deadlineTimer) cancelTimeout(deadlineTimer);
              resolve();
            };
            const onChange = () => { if (ownedAreSettled()) finish(); };
            resourceListeners.add(onChange);
            let deadlineTimer;
            deadlineTimer = scheduleTimeout(finish, remainingGraceMs);
            deadlineTimer?.unref?.();
            onChange();
          });
        }
      }

      if (!ownedAreSettled()) {
        forced = true;
        for (const client of [...(webSocketServer.clients ?? [])]) {
          forcedWebSockets += 1;
          try { client.terminate(); } catch (error) { errors.push(error); }
        }
        if (connections.size > 0) {
          collectSync(() => httpServer.closeAllConnections?.());
          for (const socket of [...connections]) {
            forcedConnections += 1;
            try { socket.destroy(); } catch (error) { errors.push(error); }
          }
        }
        await waitImmediate(scheduleImmediate);
        if (!ownedAreSettled()) await waitForSignal(ownedAreSettled, 1_000);
      }

      // Real public APIs converge after force. Hostile injected missing callbacks are bounded failures.
      if (ownedAreSettled()) {
        await waitImmediate(scheduleImmediate);
        if (!webSocketCallbackSettled || !httpCallbackSettled) {
          await waitForSignal(() => webSocketCallbackSettled && httpCallbackSettled, 250);
        }
        if (!webSocketCallbackSettled) errors.push(new Error("websocket_close_callback_missing"));
        if (!httpCallbackSettled) errors.push(new Error("http_close_callback_missing"));
      } else {
        errors.push(new Error("owned_resources_failed_to_settle"));
      }

      collectSync(() => gateway.close());
      collectSync(() => uninstallGateway(gateway));
      try { await app?.close(); } catch (error) { errors.push(error); }

      connections.clear();
      resourceListeners.clear();
      httpServer.removeAllListeners("connection");
      const outcome = errors.length > 0 ? "failed" : forced ? "forced" : "graceful";
      try {
        const stats = gateway.getStats();
        diagnostics?.({
          event: "server_closed", mode, lifecycleOwner, stage: "complete", outcome,
          durationClass: now() - startedAt < shutdownGraceMs ? "under_grace" : "at_or_over_grace",
          forcedWebSocketCountClass: forcedWebSockets === 0 ? "zero" : forcedWebSockets === 1 ? "one" : "many",
          forcedConnectionCountClass: forcedConnections === 0 ? "zero" : forcedConnections === 1 ? "one" : "many",
          serverInstanceId: gateway.serverInstanceId,
          activePiWebSocketCount: webSocketServer.clients?.size ?? 0,
          openConnectionCount: connections.size,
          ...stats,
          activeTicketTimerCount: stats.pendingTicketCount,
        });
      } catch { /* isolated */ }
      if (errors.length > 0) throw new AggregateError(errors, "pi_web_server_close_failed");
      return Object.freeze({ outcome, forcedWebSocketCount: forcedWebSockets, forcedConnectionCount: forcedConnections });
    })();
    coordinator.then(resolveClose, rejectClose);
    return closePromise;
  };

  try {
    app = nextFactory({ dev, dir, hostname, port, httpServer });
    await app.prepare();
    requestHandler = app.getRequestHandler();
    await listen(httpServer, port, hostname);
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("invalid_server_address");
    try {
      diagnostics?.({
        event: "server_ready", mode, lifecycleOwner, stage: "listening", outcome: "ok",
        serverInstanceId: gateway.serverInstanceId, addressFamily: address.family, port: address.port,
      });
    } catch { /* isolated */ }
    return {
      ready: true,
      address: { address: address.address, family: address.family, port: address.port },
      gateway,
      close,
    };
  } catch (error) {
    try { await close(); } catch { /* preserve startup failure */ }
    throw error;
  }
}

module.exports = {
  PI_WEB_HEARTBEAT_INTERVAL_MS,
  PI_WEB_SHUTDOWN_GRACE_MS,
  startPiWebServer,
  createPiWebUpgradeHandler,
  createWebSocketHeartbeat,
  normalizePort,
  publicErrorClass,
};
