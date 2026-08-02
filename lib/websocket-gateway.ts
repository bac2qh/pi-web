import type WebSocket from "ws";

export const PI_WEB_TRANSPORT_GATEWAY_VERSION = 1 as const;
export const PI_WEB_TRANSPORT_GATEWAY_SLOT = "__piWebTransportGatewayV1" as const;

export type PiWebTransportChannelContext = {
  channel: string;
  serverInstanceId: string;
  ticketContext?: unknown;
};

export type PiWebTransportChannelHandler = (
  socket: WebSocket,
  context: PiWebTransportChannelContext,
) => void | Promise<void>;

export type PiWebTransportGatewayV1 = {
  readonly version: typeof PI_WEB_TRANSPORT_GATEWAY_VERSION;
  readonly ticketContextVersion?: 1;
  readonly serverInstanceId: string;
  isSameHostOrigin(originHeader: string | null, hostHeader: string | null): boolean;
  registerChannel(channel: string, handler: PiWebTransportChannelHandler): () => boolean;
  issueTicket(channel: string, ticketContext?: unknown): { ticket: string; expiresAt: number };
  consumeTicket(ticket: string): {
    handler: PiWebTransportChannelHandler;
    channel: string;
    expiresAt: number;
    ticketContext?: unknown;
  };
  reserveConnection(directPeerAddress: string | undefined): () => boolean;
  getStats(): {
    closed: boolean;
    registeredChannelCount: number;
    pendingTicketCount: number;
    activeConnectionCount: number;
    activePeerKeyCount: number;
  };
  close(): void;
};

declare global {
  var __piWebTransportGatewayV1: PiWebTransportGatewayV1 | undefined;
}

export class PiWebTransportGatewayAccessError extends Error {
  readonly code: "gateway_unavailable" | "gateway_version_mismatch";

  constructor(code: "gateway_unavailable" | "gateway_version_mismatch") {
    super(code);
    this.name = "PiWebTransportGatewayAccessError";
    this.code = code;
  }
}

function isGatewayV1(value: unknown): value is PiWebTransportGatewayV1 {
  if (!value || typeof value !== "object") return false;
  const gateway = value as Partial<PiWebTransportGatewayV1>;
  return (
    gateway.version === PI_WEB_TRANSPORT_GATEWAY_VERSION &&
    typeof gateway.serverInstanceId === "string" &&
    typeof gateway.isSameHostOrigin === "function" &&
    typeof gateway.registerChannel === "function" &&
    typeof gateway.issueTicket === "function" &&
    typeof gateway.consumeTicket === "function" &&
    typeof gateway.reserveConnection === "function" &&
    typeof gateway.getStats === "function" &&
    typeof gateway.close === "function"
  );
}

export function getWebSocketGateway(): PiWebTransportGatewayV1 {
  if (!Object.prototype.hasOwnProperty.call(globalThis, PI_WEB_TRANSPORT_GATEWAY_SLOT)) {
    throw new PiWebTransportGatewayAccessError("gateway_unavailable");
  }
  const gateway: unknown = globalThis.__piWebTransportGatewayV1;
  if (!isGatewayV1(gateway)) {
    throw new PiWebTransportGatewayAccessError("gateway_version_mismatch");
  }
  return gateway;
}
