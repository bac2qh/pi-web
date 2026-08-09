"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomBytes, randomUUID } = require("node:crypto");

const PI_WEB_TRANSPORT_GATEWAY_VERSION = 1;
const PI_WEB_TRANSPORT_GATEWAY_SLOT = "__piWebTransportGatewayV1";
const PI_WEB_TRANSPORT_TICKET_TTL_MS = 30_000;
const PI_WEB_TRANSPORT_PATH = "/_pi/websocket";
const PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES = 16 * 1024;
const PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER = 64;
const PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL = 256;
const PI_WEB_TRANSPORT_CHANNEL_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const OWNER_CLOSE_FALLBACK_MS = 1_000;
const TICKET_BYTES = 32;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OWNER_REASONS = new Set(["owner_replaced", "server_shutdown"]);
const RUNTIME_OWNER_CLASSES = new Set(["rpc"]);

class PiWebTransportGatewayError extends Error {
  constructor(code) {
    super(code);
    this.name = "PiWebTransportGatewayError";
    this.code = code;
  }
}

function gatewayError(code) {
  return new PiWebTransportGatewayError(code);
}

function isValidChannelName(channel) {
  return typeof channel === "string" && PI_WEB_TRANSPORT_CHANNEL_PATTERN.test(channel);
}

function hasValidHostAuthorityShape(hostHeader) {
  if (hostHeader.includes("@")) return false;
  if (hostHeader.startsWith("[")) {
    const closingBracket = hostHeader.indexOf("]");
    if (closingBracket === -1 || hostHeader.indexOf("]", closingBracket + 1) !== -1) return false;
    const suffix = hostHeader.slice(closingBracket + 1);
    return suffix === "" || /^:\d+$/.test(suffix);
  }
  const firstColon = hostHeader.indexOf(":");
  if (firstColon === -1) return true;
  if (firstColon !== hostHeader.lastIndexOf(":")) return false;
  return /^\d+$/.test(hostHeader.slice(firstColon + 1));
}

function canonicalHost(hostHeader, protocol) {
  if (
    typeof hostHeader !== "string" || hostHeader.length === 0 || hostHeader.length > 255
    || hostHeader !== hostHeader.trim() || hostHeader.includes(",")
    || /[\u0000-\u0020\\/]/.test(hostHeader) || !hasValidHostAuthorityShape(hostHeader)
  ) return null;
  try {
    const parsed = new URL(`${protocol}//${hostHeader}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.host;
  } catch { return null; }
}

function isSameHostBrowserOrigin(originHeader, hostHeader) {
  if (
    typeof originHeader !== "string" || originHeader.length === 0 || originHeader.length > 512
    || originHeader === "null" || originHeader.includes(",")
  ) return false;
  try {
    const origin = new URL(originHeader);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:")
      || origin.username || origin.password || origin.pathname !== "/"
      || origin.search || origin.hash || origin.origin !== originHeader
    ) return false;
    return canonicalHost(hostHeader, origin.protocol) === origin.host;
  } catch { return false; }
}

function countClass(count) {
  return count === 0 ? "zero" : count === 1 ? "one" : "many";
}

function createPiWebTransportGateway(options = {}) {
  const now = options.now ?? Date.now;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;
  const createRandomBytes = options.randomBytes ?? randomBytes;
  const createInstanceId = options.randomUUID ?? randomUUID;
  const diagnostics = typeof options.diagnostics === "function" ? options.diagnostics : null;

  const serverInstanceId = createInstanceId();
  const channels = new Map();
  // Registrations removed by HMR remain server-owned until every consumed
  // authorization, enlisted transport, and replacement fallback settles.
  const retiredRegistrations = new Set();
  const tickets = new Map();
  const peerConnectionCounts = new Map();
  const activeReservations = new Set();
  const runtimeOwners = new Map();
  const pendingRuntimeOwnerCleanups = new Set();
  let runtimeOwnerCleanupFailed = false;
  let activeConnectionCount = 0;
  let shuttingDown = false;
  let closed = false;

  const emitDiagnostic = (event, details = {}) => {
    if (!diagnostics) return;
    try {
      diagnostics({
        event,
        serverInstanceId,
        registeredChannelCount: channels.size,
        pendingTicketCount: tickets.size,
        activeConnectionCount,
        activePeerKeyCount: peerConnectionCounts.size,
        ...details,
      });
    } catch { /* diagnostics are isolated */ }
  };

  const assertOpen = () => {
    if (closed) throw gatewayError("gateway_closed");
    if (shuttingDown) throw gatewayError("gateway_shutting_down");
  };

  const closeRuntimeOwner = (record, reason) => {
    let result;
    try { result = record.ownerClose(reason); }
    catch {
      runtimeOwnerCleanupFailed = true;
      emitDiagnostic("owner_failed", { ownerClass: record.ownerClass });
      return;
    }
    if (result === undefined) return;
    const cleanup = Promise.resolve(result);
    pendingRuntimeOwnerCleanups.add(cleanup);
    cleanup.then(
      () => { pendingRuntimeOwnerCleanups.delete(cleanup); },
      () => {
        pendingRuntimeOwnerCleanups.delete(cleanup);
        runtimeOwnerCleanupFailed = true;
        emitDiagnostic("owner_failed", { ownerClass: record.ownerClass });
      },
    );
  };

  const revokeRegistrationTickets = (registration) => {
    for (const [ticket, record] of tickets) {
      if (record.registration !== registration) continue;
      tickets.delete(ticket);
      cancelTimeout(record.timeout);
    }
  };

  const maybeReleaseRetiredRegistration = (registration) => {
    if (registration.active || registration.pendingConsumed !== 0
      || registration.sockets.size !== 0 || registration.closeFallbacks.size !== 0) return false;
    return retiredRegistrations.delete(registration);
  };

  const clearSocketFallback = (registration, socket) => {
    const timer = registration.closeFallbacks.get(socket);
    registration.closeFallbacks.delete(socket);
    if (timer) cancelTimeout(timer);
    maybeReleaseRetiredRegistration(registration);
  };

  const requestSocketClose = (socket, reason, registration) => {
    if (!socket || socket.readyState === 3) return;
    try {
      if (socket.readyState === 1) socket.close(reason === "server_shutdown" ? 1001 : 1012);
      // CONNECTING/CLOSING peers remain owned until the bounded replacement
      // fallback; shutdown reserves every force for the server coordinator.
    } catch { /* replacement fallback or shutdown coordinator owns force */ }
    if (reason === "server_shutdown" || socket.readyState === 3 || registration.closeFallbacks.has(socket)) return;
    const timer = scheduleTimeout(() => {
      registration.closeFallbacks.delete(socket);
      try { if (socket.readyState !== 3) socket.terminate(); } catch { /* terminal-pending ownership remains */ }
      maybeReleaseRetiredRegistration(registration);
    }, OWNER_CLOSE_FALLBACK_MS);
    timer?.unref?.();
    registration.closeFallbacks.set(socket, timer);
  };

  const releaseEnlistedSocket = (registration, socket) => {
    const released = registration.sockets.delete(socket);
    clearSocketFallback(registration, socket);
    maybeReleaseRetiredRegistration(registration);
    return released;
  };

  const trackRegistrationSocket = (registration, socket) => {
    registration.sockets.add(socket);
    let released = false;
    const release = () => {
      if (released) return false;
      released = true;
      return releaseEnlistedSocket(registration, socket);
    };
    socket.once?.("close", release);
    return release;
  };

  const settleConsumedAuthorization = (registration, controller) => {
    if (!registration.consumedAuthorizations.delete(controller)) return false;
    registration.pendingConsumed = Math.max(0, registration.pendingConsumed - 1);
    maybeReleaseRetiredRegistration(registration);
    return true;
  };

  const cancelRegistrationFallbacks = (registration) => {
    for (const timer of registration.closeFallbacks.values()) cancelTimeout(timer);
    registration.closeFallbacks.clear();
  };

  const suppressRegistrationForce = (registration) => {
    cancelRegistrationFallbacks(registration);
    for (const socket of [...registration.sockets]) requestSocketClose(socket, "server_shutdown", registration);
    maybeReleaseRetiredRegistration(registration);
  };

  const closeRegistration = (registration, reason) => {
    if (!OWNER_REASONS.has(reason) || registration.closeReason) return false;
    registration.closeReason = reason;
    registration.active = false;
    revokeRegistrationTickets(registration);
    if (reason === "server_shutdown") cancelRegistrationFallbacks(registration);
    try { registration.ownerClose?.(reason); } catch {
      emitDiagnostic("owner_failed", { ownerClass: registration.ownerClass });
    }
    // Owner cleanup can reenter beginShutdown. Re-read the coordinator state
    // after the semantic callback so replacement cannot install a late force fallback.
    const networkReason = shuttingDown ? "server_shutdown" : reason;
    if (networkReason === "server_shutdown") cancelRegistrationFallbacks(registration);
    for (const socket of [...registration.sockets]) requestSocketClose(socket, networkReason, registration);
    maybeReleaseRetiredRegistration(registration);
    emitDiagnostic("owner_closing", {
      ownerClass: registration.ownerClass,
      socketCountClass: countClass(registration.sockets.size),
    });
    return true;
  };

  const gateway = {
    version: PI_WEB_TRANSPORT_GATEWAY_VERSION,
    ticketContextVersion: 1,
    ownerLifecycleVersion: 1,
    serverInstanceId,
    isSameHostOrigin: isSameHostBrowserOrigin,

    isAcceptingOwners() {
      return !closed && !shuttingDown;
    },

    registerChannel(channel, handler, ownerClose) {
      assertOpen();
      if (!isValidChannelName(channel) || typeof handler !== "function"
        || (ownerClose !== undefined && typeof ownerClose !== "function")) {
        throw gatewayError("invalid_channel");
      }
      if (channels.has(channel)) throw gatewayError("duplicate_channel");
      const ownerClass = channel === "file-watch" ? "file_watch"
        : channel === "running" || channel === "session" ? channel : "other";
      const registration = {
        channel, handler, ownerClose, ownerClass,
        active: true, closeReason: null, pendingConsumed: 0,
        consumedAuthorizations: new Set(), sockets: new Set(), closeFallbacks: new Map(),
      };
      channels.set(channel, registration);
      emitDiagnostic("channel_registered", { ownerClass });

      let unregistered = false;
      return () => {
        if (unregistered) return false;
        unregistered = true;
        if (channels.get(channel) !== registration) return false;
        channels.delete(channel);
        retiredRegistrations.add(registration);
        closeRegistration(registration, "owner_replaced");
        emitDiagnostic("channel_unregistered", { ownerClass });
        return true;
      };
    },

    registerRuntimeOwner(ownerClass, ownerClose) {
      assertOpen();
      if (!RUNTIME_OWNER_CLASSES.has(ownerClass) || typeof ownerClose !== "function") {
        throw gatewayError("invalid_owner");
      }
      const existing = runtimeOwners.get(ownerClass);
      if (existing?.active) throw gatewayError("duplicate_owner");
      const record = { ownerClass, ownerClose, active: true };
      runtimeOwners.set(ownerClass, record);
      const token = Object.freeze({
        serverInstanceId,
        ownerClass,
        isCurrent: () => !closed && !shuttingDown && record.active && runtimeOwners.get(ownerClass) === record,
      });
      emitDiagnostic("owner_registered", { ownerClass });
      return {
        token,
        unregister() {
          if (!record.active || runtimeOwners.get(ownerClass) !== record) return false;
          record.active = false;
          runtimeOwners.delete(ownerClass);
          closeRuntimeOwner(record, "owner_replaced");
          return true;
        },
      };
    },

    issueTicket(channel, ticketContext) {
      assertOpen();
      if (!isValidChannelName(channel)) throw gatewayError("invalid_channel");
      const registration = channels.get(channel);
      if (!registration?.active) throw gatewayError("channel_unavailable");
      let ticket;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = createRandomBytes(TICKET_BYTES).toString("base64url");
        if (TICKET_PATTERN.test(candidate) && !tickets.has(candidate)) { ticket = candidate; break; }
      }
      if (!ticket) throw gatewayError("ticket_generation_failed");
      const expiresAt = now() + PI_WEB_TRANSPORT_TICKET_TTL_MS;
      const record = { version: PI_WEB_TRANSPORT_GATEWAY_VERSION, registration, expiresAt, ticketContext, timeout: undefined };
      record.timeout = scheduleTimeout(() => {
        if (tickets.get(ticket) !== record) return;
        tickets.delete(ticket);
        emitDiagnostic("ticket_expired");
      }, PI_WEB_TRANSPORT_TICKET_TTL_MS);
      record.timeout?.unref?.();
      tickets.set(ticket, record);
      emitDiagnostic("ticket_issued");
      return { ticket, expiresAt };
    },

    consumeTicket(ticket) {
      assertOpen();
      if (typeof ticket !== "string" || !TICKET_PATTERN.test(ticket)) {
        emitDiagnostic("ticket_rejected", { reason: "invalid" });
        throw gatewayError("invalid_ticket");
      }
      const record = tickets.get(ticket);
      if (!record) {
        emitDiagnostic("ticket_rejected", { reason: "missing" });
        throw gatewayError("invalid_ticket");
      }
      tickets.delete(ticket);
      cancelTimeout(record.timeout);
      if (record.version !== PI_WEB_TRANSPORT_GATEWAY_VERSION || !record.registration.active
        || channels.get(record.registration.channel) !== record.registration) {
        emitDiagnostic("ticket_rejected", { reason: "version" });
        throw gatewayError("gateway_version_mismatch");
      }
      if (now() >= record.expiresAt) {
        emitDiagnostic("ticket_rejected", { reason: "expired" });
        throw gatewayError("invalid_ticket");
      }
      const registration = record.registration;
      registration.pendingConsumed += 1;
      let state = "consumed";
      let rawSocket = null;
      let rawClose = null;
      const detachRawSocket = () => {
        if (rawSocket && rawClose) rawSocket.off?.("close", rawClose);
        rawSocket = null;
        rawClose = null;
      };
      const settleAuthorization = (terminalState) => {
        if (state !== "consumed" && state !== "raw_bound") return false;
        state = terminalState;
        detachRawSocket();
        return settleConsumedAuthorization(registration, controller);
      };
      const forceTerminalSocket = (socket) => {
        if (!socket || socket.readyState === 3) return;
        try { socket.terminate(); }
        catch {
          // A ws callback after final gateway/server cleanup has no remaining
          // coordinator. Public terminate is the terminal ownership boundary.
          try { socket.close?.(1001); } catch { /* already terminal or hostile */ }
        }
      };
      const requestUntrackedSocketClose = (socket) => {
        if (!socket || socket.readyState === 3) return;
        try {
          if (socket.readyState === 1) socket.close(1001);
        } catch { /* the active server coordinator retains this WSS client */ }
      };
      const controller = {
        finalizeGatewayClose() {
          settleAuthorization("gateway_closed");
        },
      };
      registration.consumedAuthorizations.add(controller);
      emitDiagnostic("ticket_consumed");
      return {
        handler: registration.handler,
        channel: registration.channel,
        expiresAt: record.expiresAt,
        ticketContext: record.ticketContext,
        bindRawSocket(socket) {
          if ((state !== "consumed" && state !== "raw_bound") || !socket) {
            throw gatewayError("authorization_terminal");
          }
          if (state === "raw_bound") {
            if (rawSocket === socket) return true;
            throw gatewayError("authorization_already_bound");
          }
          rawSocket = socket;
          rawClose = () => { settleAuthorization("abandoned"); };
          state = "raw_bound";
          if (typeof socket.once !== "function") {
            settleAuthorization("abandoned");
            return false;
          }
          socket.once("close", rawClose);
          if (socket.destroyed === true) settleAuthorization("abandoned");
          return state === "raw_bound" && rawSocket === socket;
        },
        abandon() {
          return settleAuthorization("abandoned") ? "abandoned" : "already_terminal";
        },
        enlistSocket(socket) {
          if (state !== "consumed" && state !== "raw_bound") {
            if (closed) forceTerminalSocket(socket);
            else if (shuttingDown) requestUntrackedSocketClose(socket);
            else forceTerminalSocket(socket);
            throw gatewayError("owner_unavailable");
          }
          if (closed || shuttingDown || !registration.active
            || channels.get(registration.channel) !== registration
            || !socket || socket.readyState === 3) {
            throw gatewayError("owner_unavailable");
          }
          const release = trackRegistrationSocket(registration, socket);
          settleAuthorization("enlisted");
          const ownerToken = Object.freeze({
            serverInstanceId,
            channel: registration.channel,
            isCurrent: () => !closed && !shuttingDown && registration.active
              && channels.get(registration.channel) === registration
              && registration.sockets.has(socket),
          });
          return { ownerToken, release };
        },
        handleEnlistmentFailure(socket) {
          if (!socket) { settleAuthorization("failed"); return false; }
          const reason = shuttingDown || closed || registration.closeReason === "server_shutdown"
            ? "server_shutdown"
            : "owner_replaced";
          const authorizationWasPending = state === "consumed" || state === "raw_bound";
          if (!authorizationWasPending) {
            // A callback after pre-callback abandonment is never allowed to
            // repopulate retired gateway state. During shutdown the public WSS
            // client set remains coordinator-owned; after final close no such
            // coordinator exists, so termination is immediate.
            if (closed) forceTerminalSocket(socket);
            else if (shuttingDown) requestUntrackedSocketClose(socket);
            else forceTerminalSocket(socket);
            return reason;
          }
          if (closed) {
            settleAuthorization("gateway_closed");
            forceTerminalSocket(socket);
            return reason;
          }
          const release = trackRegistrationSocket(registration, socket);
          settleAuthorization("failed");
          requestSocketClose(socket, reason, registration);
          if (socket.readyState === 3) release();
          return reason;
        },
      };
    },

    reserveConnection(directPeerAddress) {
      assertOpen();
      if (typeof directPeerAddress !== "string" || directPeerAddress.length === 0
        || directPeerAddress.length > 128 || directPeerAddress !== directPeerAddress.trim()) {
        emitDiagnostic("connection_rejected", { reason: "peer_unavailable" });
        throw gatewayError("peer_unavailable");
      }
      const peerCount = peerConnectionCounts.get(directPeerAddress) ?? 0;
      if (peerCount >= PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER) {
        emitDiagnostic("connection_rejected", { reason: "peer_limit" });
        throw gatewayError("connection_limit");
      }
      if (activeConnectionCount >= PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL) {
        emitDiagnostic("connection_rejected", { reason: "total_limit" });
        throw gatewayError("connection_limit");
      }
      const reservation = { peerKey: directPeerAddress, released: false };
      activeReservations.add(reservation);
      activeConnectionCount += 1;
      peerConnectionCounts.set(directPeerAddress, peerCount + 1);
      emitDiagnostic("connection_admitted");
      return () => {
        if (reservation.released) return false;
        reservation.released = true;
        if (!activeReservations.delete(reservation)) return false;
        activeConnectionCount = Math.max(0, activeConnectionCount - 1);
        const currentPeerCount = peerConnectionCounts.get(reservation.peerKey) ?? 0;
        if (currentPeerCount <= 1) peerConnectionCounts.delete(reservation.peerKey);
        else peerConnectionCounts.set(reservation.peerKey, currentPeerCount - 1);
        emitDiagnostic("connection_released");
        return true;
      };
    },

    beginShutdown(reason = "server_shutdown") {
      if (closed || shuttingDown) return false;
      if (reason !== "server_shutdown") throw gatewayError("invalid_owner_reason");
      shuttingDown = true;
      for (const record of tickets.values()) cancelTimeout(record.timeout);
      tickets.clear();
      for (const registration of channels.values()) closeRegistration(registration, reason);
      // HMR replacement has already invoked its semantic owner exactly once.
      // Shutdown only suppresses its gateway fallback and re-requests handshakes.
      for (const registration of retiredRegistrations) suppressRegistrationForce(registration);
      for (const record of runtimeOwners.values()) {
        if (!record.active) continue;
        record.active = false;
        closeRuntimeOwner(record, reason);
      }
      emitDiagnostic("gateway_shutdown_started");
      return true;
    },

    async waitForRuntimeOwnerCleanup() {
      // Owner replacement can leave an older generation settling while a new
      // one is active. Observe every pending generation before final close.
      while (pendingRuntimeOwnerCleanups.size > 0) {
        await Promise.allSettled([...pendingRuntimeOwnerCleanups]);
      }
      if (runtimeOwnerCleanupFailed) throw gatewayError("runtime_owner_cleanup_failed");
    },

    getSocketChannelClass(socket) {
      for (const registration of channels.values()) {
        if (registration.sockets.has(socket)) return registration.ownerClass;
      }
      for (const registration of retiredRegistrations) {
        if (registration.sockets.has(socket)) return registration.ownerClass;
      }
      return "other";
    },

    isSocketEnlisted(socket) {
      for (const registration of channels.values()) {
        if (registration.sockets.has(socket)) return true;
      }
      for (const registration of retiredRegistrations) {
        if (registration.sockets.has(socket)) return true;
      }
      return false;
    },

    getOwnerLifecycleStats() {
      const registrations = [...channels.values(), ...retiredRegistrations];
      return Object.freeze({
        retiredRegistrationCount: retiredRegistrations.size,
        enlistedSocketCount: registrations.reduce((count, registration) => count + registration.sockets.size, 0),
        closeFallbackCount: registrations.reduce((count, registration) => count + registration.closeFallbacks.size, 0),
        pendingConsumedCount: registrations.reduce((count, registration) => count + registration.pendingConsumed, 0),
      });
    },

    getStats() {
      return {
        closed,
        registeredChannelCount: channels.size,
        pendingTicketCount: tickets.size,
        activeConnectionCount,
        activePeerKeyCount: peerConnectionCounts.size,
      };
    },

    close() {
      if (closed) return;
      if (!shuttingDown) gateway.beginShutdown("server_shutdown");
      closed = true;
      for (const record of tickets.values()) cancelTimeout(record.timeout);
      tickets.clear();
      for (const registration of [...channels.values(), ...retiredRegistrations]) {
        for (const timer of registration.closeFallbacks.values()) cancelTimeout(timer);
        registration.closeFallbacks.clear();
        for (const controller of [...registration.consumedAuthorizations]) controller.finalizeGatewayClose();
        registration.consumedAuthorizations.clear();
        registration.sockets.clear();
        registration.pendingConsumed = 0;
        registration.ownerClose = undefined;
      }
      channels.clear();
      retiredRegistrations.clear();
      runtimeOwners.clear();
      for (const reservation of activeReservations) reservation.released = true;
      activeReservations.clear();
      activeConnectionCount = 0;
      peerConnectionCounts.clear();
      if (Object.prototype.hasOwnProperty.call(globalThis, PI_WEB_TRANSPORT_GATEWAY_SLOT)
        && globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] === gateway) {
        delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
      }
      emitDiagnostic("gateway_closed");
    },
  };
  return gateway;
}

function hasInstalledGatewaySlot() {
  return Object.prototype.hasOwnProperty.call(globalThis, PI_WEB_TRANSPORT_GATEWAY_SLOT);
}
function isGatewayVersionOne(value) {
  return value !== null && typeof value === "object" && value.version === PI_WEB_TRANSPORT_GATEWAY_VERSION;
}
function installPiWebTransportGateway(gateway) {
  if (!isGatewayVersionOne(gateway)) throw gatewayError("gateway_version_mismatch");
  if (hasInstalledGatewaySlot()) {
    const existing = globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
    if (!isGatewayVersionOne(existing)) throw gatewayError("gateway_version_mismatch");
    throw gatewayError("gateway_already_installed");
  }
  globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] = gateway;
  return gateway;
}
function getInstalledPiWebTransportGateway() {
  if (!hasInstalledGatewaySlot()) return undefined;
  const gateway = globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  if (!isGatewayVersionOne(gateway)) throw gatewayError("gateway_version_mismatch");
  return gateway;
}
function uninstallPiWebTransportGateway(gateway) {
  if (!hasInstalledGatewaySlot() || globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] !== gateway) return false;
  delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  return true;
}

module.exports = {
  PI_WEB_TRANSPORT_GATEWAY_VERSION,
  PI_WEB_TRANSPORT_GATEWAY_SLOT,
  PI_WEB_TRANSPORT_TICKET_TTL_MS,
  PI_WEB_TRANSPORT_PATH,
  PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES,
  PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER,
  PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL,
  PI_WEB_TRANSPORT_CHANNEL_PATTERN,
  PiWebTransportGatewayError,
  createPiWebTransportGateway,
  installPiWebTransportGateway,
  getInstalledPiWebTransportGateway,
  uninstallPiWebTransportGateway,
  isSameHostBrowserOrigin,
  isValidChannelName,
};
