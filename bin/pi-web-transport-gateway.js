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
const TICKET_BYTES = 32;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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
    if (closingBracket === -1 || hostHeader.indexOf("]", closingBracket + 1) !== -1) {
      return false;
    }
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
    typeof hostHeader !== "string" ||
    hostHeader.length === 0 ||
    hostHeader.length > 255 ||
    hostHeader !== hostHeader.trim() ||
    hostHeader.includes(",") ||
    /[\u0000-\u0020\\/]/.test(hostHeader) ||
    !hasValidHostAuthorityShape(hostHeader)
  ) {
    return null;
  }

  try {
    const parsed = new URL(`${protocol}//${hostHeader}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.host;
  } catch {
    return null;
  }
}

function isSameHostBrowserOrigin(originHeader, hostHeader) {
  if (
    typeof originHeader !== "string" ||
    originHeader.length === 0 ||
    originHeader.length > 512 ||
    originHeader === "null" ||
    originHeader.includes(",")
  ) {
    return false;
  }

  try {
    const origin = new URL(originHeader);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.origin !== originHeader
    ) {
      return false;
    }

    return canonicalHost(hostHeader, origin.protocol) === origin.host;
  } catch {
    return false;
  }
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
  const tickets = new Map();
  const peerConnectionCounts = new Map();
  const activeReservations = new Set();
  let activeConnectionCount = 0;
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
    } catch {
      // Diagnostics must never affect authorization or cleanup.
    }
  };

  const assertOpen = () => {
    if (closed) throw gatewayError("gateway_closed");
  };

  const revokeRegistrationTickets = (registration) => {
    for (const [ticket, record] of tickets) {
      if (record.registration !== registration) continue;
      tickets.delete(ticket);
      cancelTimeout(record.timeout);
    }
  };

  const gateway = {
    version: PI_WEB_TRANSPORT_GATEWAY_VERSION,
    ticketContextVersion: 1,
    serverInstanceId,
    isSameHostOrigin: isSameHostBrowserOrigin,

    registerChannel(channel, handler) {
      assertOpen();
      if (!isValidChannelName(channel) || typeof handler !== "function") {
        throw gatewayError("invalid_channel");
      }
      if (channels.has(channel)) throw gatewayError("duplicate_channel");

      const registration = { channel, handler };
      channels.set(channel, registration);
      emitDiagnostic("channel_registered");

      let unregistered = false;
      return () => {
        if (unregistered) return false;
        unregistered = true;
        if (channels.get(channel) !== registration) return false;
        channels.delete(channel);
        revokeRegistrationTickets(registration);
        emitDiagnostic("channel_unregistered");
        return true;
      };
    },

    issueTicket(channel, ticketContext) {
      assertOpen();
      if (!isValidChannelName(channel)) throw gatewayError("invalid_channel");
      const registration = channels.get(channel);
      if (!registration) throw gatewayError("channel_unavailable");

      let ticket;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = createRandomBytes(TICKET_BYTES).toString("base64url");
        if (TICKET_PATTERN.test(candidate) && !tickets.has(candidate)) {
          ticket = candidate;
          break;
        }
      }
      if (!ticket) throw gatewayError("ticket_generation_failed");

      const expiresAt = now() + PI_WEB_TRANSPORT_TICKET_TTL_MS;
      const record = {
        version: PI_WEB_TRANSPORT_GATEWAY_VERSION,
        registration,
        expiresAt,
        ticketContext,
        timeout: undefined,
      };
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

      // Deleting first makes consumption atomic even when validation or dispatch fails.
      tickets.delete(ticket);
      cancelTimeout(record.timeout);

      if (record.version !== PI_WEB_TRANSPORT_GATEWAY_VERSION) {
        emitDiagnostic("ticket_rejected", { reason: "version" });
        throw gatewayError("gateway_version_mismatch");
      }
      if (now() >= record.expiresAt) {
        emitDiagnostic("ticket_rejected", { reason: "expired" });
        throw gatewayError("invalid_ticket");
      }

      emitDiagnostic("ticket_consumed");
      return {
        handler: record.registration.handler,
        channel: record.registration.channel,
        expiresAt: record.expiresAt,
        ticketContext: record.ticketContext,
      };
    },

    reserveConnection(directPeerAddress) {
      assertOpen();
      if (
        typeof directPeerAddress !== "string"
        || directPeerAddress.length === 0
        || directPeerAddress.length > 128
        || directPeerAddress !== directPeerAddress.trim()
      ) {
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
      closed = true;
      for (const record of tickets.values()) cancelTimeout(record.timeout);
      tickets.clear();
      channels.clear();
      for (const reservation of [...activeReservations]) {
        reservation.released = true;
      }
      activeReservations.clear();
      activeConnectionCount = 0;
      peerConnectionCounts.clear();
      if (
        Object.prototype.hasOwnProperty.call(globalThis, PI_WEB_TRANSPORT_GATEWAY_SLOT) &&
        globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] === gateway
      ) {
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
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === PI_WEB_TRANSPORT_GATEWAY_VERSION
  );
}

function installPiWebTransportGateway(gateway) {
  if (!isGatewayVersionOne(gateway)) {
    throw gatewayError("gateway_version_mismatch");
  }

  if (hasInstalledGatewaySlot()) {
    const existing = globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
    if (!isGatewayVersionOne(existing)) {
      throw gatewayError("gateway_version_mismatch");
    }
    throw gatewayError("gateway_already_installed");
  }

  globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] = gateway;
  return gateway;
}

function getInstalledPiWebTransportGateway() {
  if (!hasInstalledGatewaySlot()) return undefined;
  const gateway = globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  if (!isGatewayVersionOne(gateway)) {
    throw gatewayError("gateway_version_mismatch");
  }
  return gateway;
}

function uninstallPiWebTransportGateway(gateway) {
  if (
    !hasInstalledGatewaySlot() ||
    globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] !== gateway
  ) {
    return false;
  }
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
