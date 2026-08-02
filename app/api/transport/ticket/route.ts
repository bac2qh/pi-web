import { isAbsolute, resolve as resolvePath } from "node:path";
import { ensureGlobalStatusChannel } from "@/lib/global-status-channel";
import { GLOBAL_STATUS_CHANNEL } from "@/lib/global-status-protocol";
import {
  createSessionTicketContext,
  ensureSessionChannel,
  isCompatibleSessionHub,
} from "@/lib/session-channel";
import { SESSION_TRANSPORT_CHANNEL } from "@/lib/session-transport-protocol";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionHeader } from "@/lib/types";
import { getWebSocketGateway, type PiWebTransportGatewayV1 } from "@/lib/websocket-gateway";

export const dynamic = "force-dynamic";

const TRANSPORT_HEADER = "X-Pi-Web-Transport";
const MAX_REQUEST_BODY_BYTES = 1024;
const MAX_SESSION_ID_CHARACTERS = 256;
const MAX_SESSION_PATH_BYTES = 4096;

type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean };

type ParsedTicketRequest =
  | { channel: string; sessionId?: never }
  | { channel: typeof SESSION_TRANSPORT_CHANNEL; sessionId: string };

type SessionTicketIssuerOutcome =
  | { ok: true; ticket: string; expiresAt: number }
  | { ok: false; status: 404; error: "session_not_found" }
  | { ok: false; status: 409; error: "session_transport_unavailable" }
  | { ok: false; status: 503; error: "session_unavailable" | "transport_unavailable" };

type SessionTicketIssuerDependencies = {
  ensureChannel(gateway: PiWebTransportGatewayV1): unknown;
  resolvePath(sessionId: string): Promise<string | null>;
  readHeader(sessionFile: string): SessionHeader | null;
  getSession(sessionId: string): AgentSessionWrapper | undefined;
  startSession: typeof startRpcSession;
};

const defaultSessionTicketDependencies: SessionTicketIssuerDependencies = {
  ensureChannel: ensureSessionChannel,
  resolvePath: resolveSessionPath,
  readHeader: readSessionHeader,
  getSession: getRpcSession,
  startSession: startRpcSession,
};

function jsonResponse(body: { error: string } | { ticket: string; expiresAt: number }, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function hasValidHostAuthorityShape(hostHeader: string): boolean {
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

function isSameHostRequestOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (
    !originHeader ||
    !hostHeader ||
    originHeader.length > 512 ||
    hostHeader.length > 255 ||
    originHeader === "null" ||
    originHeader.includes(",") ||
    hostHeader !== hostHeader.trim() ||
    hostHeader.includes(",") ||
    /[\u0000-\u0020\\/]/.test(hostHeader) ||
    !hasValidHostAuthorityShape(hostHeader)
  ) {
    return false;
  }

  try {
    const origin = new URL(originHeader);
    const requestHost = new URL(`${origin.protocol}//${hostHeader}`);
    return (
      (origin.protocol === "http:" || origin.protocol === "https:") &&
      !origin.username &&
      !origin.password &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash &&
      origin.origin === originHeader &&
      !requestHost.username &&
      !requestHost.password &&
      requestHost.pathname === "/" &&
      !requestHost.search &&
      !requestHost.hash &&
      requestHost.host === origin.host
    );
  } catch {
    return false;
  }
}

async function readBoundedJson(req: Request): Promise<BodyReadResult> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, tooLarge: false };
    if (Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
      return { ok: false, tooLarge: true };
    }
  }

  if (!req.body) return { ok: false, tooLarge: false };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= MAX_SESSION_ID_CHARACTERS
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseTicketRequest(value: unknown): ParsedTicketRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length === 1 && keys[0] === "channel" && typeof record.channel === "string"
    && record.channel !== SESSION_TRANSPORT_CHANNEL) {
    return { channel: record.channel };
  }
  if (keys.length === 2 && keys[0] === "channel" && keys[1] === "sessionId"
    && record.channel === SESSION_TRANSPORT_CHANNEL && validSessionId(record.sessionId)) {
    return { channel: SESSION_TRANSPORT_CHANNEL, sessionId: record.sessionId };
  }
  return null;
}

function normalizedBoundedAbsolutePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !isAbsolute(value)) return null;
  const normalized = resolvePath(value);
  return Buffer.byteLength(normalized, "utf8") <= MAX_SESSION_PATH_BYTES ? normalized : null;
}

function inspectWrapper(
  wrapper: AgentSessionWrapper,
  expected: { sessionId: string; sessionFile: string; cwd: string; realSessionId?: string },
) {
  try {
    if (!wrapper.isAlive() || wrapper.sessionId !== expected.sessionId
      || (expected.realSessionId !== undefined && expected.realSessionId !== expected.sessionId)
      || normalizedBoundedAbsolutePath(wrapper.sessionFile) !== expected.sessionFile
      || normalizedBoundedAbsolutePath(wrapper.inner.sessionManager.getCwd()) !== expected.cwd) return null;
    const hub = wrapper.getProjectedEventHub();
    if (!isCompatibleSessionHub(hub) || hub.isClosed()) return null;
    return hub;
  } catch {
    return null;
  }
}

class SessionTargetConflict extends Error {
  readonly code = "session_target_conflict";
}

export function createSessionTicketIssuer(
  dependencies: SessionTicketIssuerDependencies = defaultSessionTicketDependencies,
) {
  return async (
    gateway: PiWebTransportGatewayV1,
    sessionId: string,
  ): Promise<SessionTicketIssuerOutcome> => {
    if (gateway.ticketContextVersion !== 1) {
      return { ok: false, status: 503, error: "transport_unavailable" };
    }
    try {
      dependencies.ensureChannel(gateway);
    } catch {
      return { ok: false, status: 503, error: "transport_unavailable" };
    }

    let sessionFile: string;
    let header: SessionHeader | null;
    try {
      const resolvedSessionFile = await dependencies.resolvePath(sessionId);
      if (resolvedSessionFile === null) return { ok: false, status: 404, error: "session_not_found" };
      const normalizedSessionFile = normalizedBoundedAbsolutePath(resolvedSessionFile);
      if (!normalizedSessionFile) {
        return { ok: false, status: 409, error: "session_transport_unavailable" };
      }
      sessionFile = normalizedSessionFile;
      header = dependencies.readHeader(sessionFile);
    } catch {
      return { ok: false, status: 404, error: "session_not_found" };
    }
    if (!header) return { ok: false, status: 404, error: "session_not_found" };
    const cwd = normalizedBoundedAbsolutePath(header.cwd);
    if (header.id !== sessionId || !cwd) {
      return { ok: false, status: 409, error: "session_transport_unavailable" };
    }

    const existing = dependencies.getSession(sessionId);
    let wrapper: AgentSessionWrapper;
    let hub;
    if (existing) {
      const existingHub = inspectWrapper(existing, { sessionId, sessionFile, cwd });
      if (!existingHub) return { ok: false, status: 409, error: "session_transport_unavailable" };
      wrapper = existing;
      hub = existingHub;
    } else {
      let started;
      try {
        started = await dependencies.startSession(sessionId, sessionFile, cwd, undefined, {
          validatePrepared(prepared) {
            if (!inspectWrapper(prepared.session, {
              sessionId,
              sessionFile,
              cwd,
              realSessionId: prepared.realSessionId,
            })) throw new SessionTargetConflict();
          },
        });
      } catch (error) {
        if ((error as { code?: unknown })?.code === "session_target_conflict"
          || (error as { message?: unknown })?.message === "rpc_existing_session_identity_mismatch") {
          return { ok: false, status: 409, error: "session_transport_unavailable" };
        }
        return { ok: false, status: 503, error: "session_unavailable" };
      }
      const startedHub = inspectWrapper(started.session, {
        sessionId,
        sessionFile,
        cwd,
        realSessionId: started.realSessionId,
      });
      if (!startedHub) return { ok: false, status: 409, error: "session_transport_unavailable" };
      wrapper = started.session;
      hub = startedHub;
    }

    try {
      if (!wrapper.isAlive() || hub.isClosed() || wrapper.getProjectedEventHub() !== hub) {
        return { ok: false, status: 409, error: "session_transport_unavailable" };
      }
      const context = createSessionTicketContext(wrapper, hub);
      const { ticket, expiresAt } = gateway.issueTicket(SESSION_TRANSPORT_CHANNEL, context);
      return { ok: true, ticket, expiresAt };
    } catch {
      return { ok: false, status: 503, error: "session_unavailable" };
    }
  };
}

const issueSessionTicket = createSessionTicketIssuer();

export async function POST(req: Request) {
  if (req.headers.get(TRANSPORT_HEADER) !== "1") {
    return jsonResponse({ error: "transport_forbidden" }, 403);
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!isSameHostRequestOrigin(origin, host)) {
    return jsonResponse({ error: "origin_forbidden" }, 403);
  }

  let gateway;
  try {
    gateway = getWebSocketGateway();
  } catch {
    return jsonResponse({ error: "transport_unavailable" }, 503);
  }

  if (!gateway.isSameHostOrigin(origin, host)) {
    return jsonResponse({ error: "origin_forbidden" }, 403);
  }

  if (!isJsonContentType(req.headers.get("content-type"))) {
    return jsonResponse({ error: "unsupported_media_type" }, 415);
  }

  const body = await readBoundedJson(req);
  if (!body.ok) {
    return jsonResponse(
      { error: body.tooLarge ? "body_too_large" : "invalid_request" },
      body.tooLarge ? 413 : 400,
    );
  }

  const parsed = parseTicketRequest(body.value);
  if (!parsed) return jsonResponse({ error: "invalid_request" }, 400);

  if (parsed.channel === SESSION_TRANSPORT_CHANNEL && "sessionId" in parsed) {
    const issued = await issueSessionTicket(gateway, parsed.sessionId as string);
    if (!issued.ok) return jsonResponse({ error: issued.error }, issued.status);
    return jsonResponse({ ticket: issued.ticket, expiresAt: issued.expiresAt }, 200);
  }

  try {
    if (parsed.channel === GLOBAL_STATUS_CHANNEL) ensureGlobalStatusChannel(gateway);
    const { ticket, expiresAt } = gateway.issueTicket(parsed.channel);
    return jsonResponse({ ticket, expiresAt }, 200);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === "invalid_channel") return jsonResponse({ error: "invalid_request" }, 400);
    if (code === "channel_unavailable") return jsonResponse({ error: "channel_unavailable" }, 404);
    return jsonResponse({ error: "transport_unavailable" }, 503);
  }
}
