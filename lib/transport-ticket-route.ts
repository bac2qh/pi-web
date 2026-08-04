import fs from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { authorizeFileRequest, normalizeAbsoluteFilePath } from "@/lib/file-authorization";
import {
  createFileWatchTicketContext,
  ensureFileWatchChannel,
} from "@/lib/file-watch-channel";
import { FILE_WATCH_CHANNEL } from "@/lib/file-watch-protocol";
import { ensureGlobalStatusChannel } from "@/lib/global-status-channel";
import { GLOBAL_STATUS_CHANNEL } from "@/lib/global-status-protocol";
import {
  createSessionTicketContext,
  ensureSessionChannel,
  isCompatibleSessionHub,
} from "@/lib/session-channel";
import { SESSION_TRANSPORT_CHANNEL } from "@/lib/session-transport-protocol";
import {
  getRpcSession,
  isCurrentRpcSession,
  startRpcSession,
  type AgentSessionWrapper,
} from "@/lib/rpc-manager";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionHeader } from "@/lib/types";
import { getWebSocketGateway, type PiWebTransportGatewayV1 } from "@/lib/websocket-gateway";

const TRANSPORT_HEADER = "X-Pi-Web-Transport";
const MAX_LEGACY_REQUEST_BODY_BYTES = 1024;
const MAX_FILE_WATCH_REQUEST_BODY_BYTES = 26_624;
const MAX_SESSION_ID_CHARACTERS = 256;
const MAX_SESSION_PATH_BYTES = 4096;
const MAX_FILE_WATCH_PATH_BYTES = 4096;

type BodyReadResult =
  | { ok: true; value: unknown; byteLength: number }
  | { ok: false; tooLarge: boolean };

type ParsedTicketRequest =
  | { channel: string; sessionId?: never; path?: never }
  | { channel: typeof SESSION_TRANSPORT_CHANNEL; sessionId: string; path?: never }
  | { channel: typeof FILE_WATCH_CHANNEL; path: string; sessionId?: string };

type SessionTicketIssuerOutcome =
  | { ok: true; ticket: string; expiresAt: number }
  | { ok: false; status: 404; error: "session_not_found" }
  | { ok: false; status: 409; error: "session_transport_unavailable" }
  | { ok: false; status: 503; error: "session_unavailable" | "transport_unavailable" };

type FileWatchTicketIssuerOutcome =
  | { ok: true; ticket: string; expiresAt: number }
  | { ok: false; status: 400; error: "invalid_request" }
  | { ok: false; status: 403; error: "access_denied" }
  | { ok: false; status: 404; error: "file_unavailable" }
  | { ok: false; status: 503; error: "transport_unavailable" };

type FileWatchTicketIssuerDependencies = Readonly<{
  authorize(filePath: string, sessionId: string | null): Promise<"allowed_root" | "allowed_session_reference" | "denied">;
  stat(filePath: string): fs.Stats;
  lstat(filePath: string): fs.Stats;
  ensureChannel(gateway: PiWebTransportGatewayV1): unknown;
}>;

const defaultFileWatchTicketDependencies: FileWatchTicketIssuerDependencies = {
  authorize: (filePath, sessionId) => authorizeFileRequest(filePath, sessionId, true),
  stat: (filePath) => fs.statSync(filePath),
  lstat: (filePath) => fs.lstatSync(filePath),
  ensureChannel: ensureFileWatchChannel,
};

type SessionTicketIssuerDependencies = {
  ensureChannel(gateway: PiWebTransportGatewayV1): unknown;
  resolvePath(sessionId: string): Promise<string | null>;
  readHeader(sessionFile: string): SessionHeader | null;
  getSession(sessionId: string): AgentSessionWrapper | undefined;
  isCurrentSession(sessionId: string, wrapper: AgentSessionWrapper): boolean;
  startSession: typeof startRpcSession;
};

const defaultSessionTicketDependencies: SessionTicketIssuerDependencies = {
  ensureChannel: ensureSessionChannel,
  resolvePath: resolveSessionPath,
  readHeader: readSessionHeader,
  getSession: getRpcSession,
  isCurrentSession: isCurrentRpcSession,
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
  let declaredByteLength = 0;
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, tooLarge: false };
    declaredByteLength = Number(contentLength);
    if (declaredByteLength > MAX_FILE_WATCH_REQUEST_BODY_BYTES) {
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
      if (totalBytes > MAX_FILE_WATCH_REQUEST_BODY_BYTES) {
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
    return {
      ok: true,
      value: JSON.parse(text) as unknown,
      byteLength: Math.max(totalBytes, declaredByteLength),
    };
  } catch {
    return { ok: false, tooLarge: totalBytes > MAX_LEGACY_REQUEST_BODY_BYTES };
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
  if ((keys.length === 2 && keys[0] === "channel" && keys[1] === "path")
    || (keys.length === 3 && keys[0] === "channel" && keys[1] === "path" && keys[2] === "sessionId")) {
    if (record.channel !== FILE_WATCH_CHANNEL || typeof record.path !== "string"
      || (keys.length === 3 && !validSessionId(record.sessionId))) return null;
    return keys.length === 3
      ? { channel: FILE_WATCH_CHANNEL, path: record.path, sessionId: record.sessionId as string }
      : { channel: FILE_WATCH_CHANNEL, path: record.path };
  }
  if (keys.length === 1 && keys[0] === "channel" && typeof record.channel === "string"
    && record.channel !== SESSION_TRANSPORT_CHANNEL && record.channel !== FILE_WATCH_CHANNEL) {
    return { channel: record.channel };
  }
  if (keys.length === 2 && keys[0] === "channel" && keys[1] === "sessionId"
    && record.channel === SESSION_TRANSPORT_CHANNEL && validSessionId(record.sessionId)) {
    return { channel: SESSION_TRANSPORT_CHANNEL, sessionId: record.sessionId };
  }
  return null;
}

function normalizedBoundedFileWatchPath(value: string): string | null {
  if (value.length === 0 || value.includes("\0")
    || Buffer.byteLength(value, "utf8") > MAX_FILE_WATCH_PATH_BYTES) return null;
  const normalized = normalizeAbsoluteFilePath(value);
  if (!normalized || Buffer.byteLength(normalized, "utf8") > MAX_FILE_WATCH_PATH_BYTES) return null;
  return normalized;
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

function inspectEnsuredWrapper(wrapper: AgentSessionWrapper, sessionId: string) {
  try {
    const target = wrapper.getEnsuredSessionTransportTarget();
    if (!target || !wrapper.isAlive()
      || target.sessionId !== sessionId || wrapper.sessionId !== sessionId
      || normalizedBoundedAbsolutePath(target.sessionFile) !== target.sessionFile
      || normalizedBoundedAbsolutePath(target.cwd) !== target.cwd) return null;
    const manager = wrapper.inner.sessionManager;
    const exposedFile = wrapper.sessionFile
      ? normalizedBoundedAbsolutePath(wrapper.sessionFile)
      : null;
    if (manager.getSessionId() !== sessionId
      || normalizedBoundedAbsolutePath(manager.getSessionFile()) !== target.sessionFile
      || normalizedBoundedAbsolutePath(manager.getCwd()) !== target.cwd
      || (wrapper.sessionFile && exposedFile !== target.sessionFile)) return null;
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

    // A newly ensured native SessionManager has already allocated an exact
    // owner, cwd, and session-file identity, but its header does not exist until
    // the first prompt persists work. Admit only that explicitly marked live
    // registry owner; persisted/discoverable sessions retain the existing path.
    const ensured = dependencies.getSession(sessionId);
    if (ensured) {
      const ensuredHub = inspectEnsuredWrapper(ensured, sessionId);
      if (ensuredHub) {
        if (!dependencies.isCurrentSession(sessionId, ensured)) {
          return { ok: false, status: 409, error: "session_transport_unavailable" };
        }
        try {
          const context = createSessionTicketContext(ensured, ensuredHub);
          if (!dependencies.isCurrentSession(sessionId, ensured)
            || inspectEnsuredWrapper(ensured, sessionId) !== ensuredHub) {
            return { ok: false, status: 409, error: "session_transport_unavailable" };
          }
          const { ticket, expiresAt } = gateway.issueTicket(SESSION_TRANSPORT_CHANNEL, context);
          return { ok: true, ticket, expiresAt };
        } catch {
          return { ok: false, status: 503, error: "session_unavailable" };
        }
      }
      try {
        if (ensured.hasEnsuredSessionTransportTarget()) {
          return { ok: false, status: 409, error: "session_transport_unavailable" };
        }
      } catch {
        // A wrapper from an older compatible runtime has no pre-prompt marker;
        // only the persisted-session authorization path may admit it.
      }
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
      if (!dependencies.isCurrentSession(sessionId, wrapper)
        || !wrapper.isAlive() || hub.isClosed() || wrapper.getProjectedEventHub() !== hub) {
        return { ok: false, status: 409, error: "session_transport_unavailable" };
      }
      const context = createSessionTicketContext(wrapper, hub);
      if (!dependencies.isCurrentSession(sessionId, wrapper)
        || !wrapper.isAlive() || hub.isClosed() || wrapper.getProjectedEventHub() !== hub) {
        return { ok: false, status: 409, error: "session_transport_unavailable" };
      }
      const { ticket, expiresAt } = gateway.issueTicket(SESSION_TRANSPORT_CHANNEL, context);
      return { ok: true, ticket, expiresAt };
    } catch {
      return { ok: false, status: 503, error: "session_unavailable" };
    }
  };
}

const issueSessionTicket = createSessionTicketIssuer();

export function createFileWatchTicketIssuer(
  dependencies: FileWatchTicketIssuerDependencies = defaultFileWatchTicketDependencies,
) {
  return async (
    gateway: PiWebTransportGatewayV1,
    submittedPath: string,
    sessionId: string | null,
  ): Promise<FileWatchTicketIssuerOutcome> => {
    if (gateway.ticketContextVersion !== 1) {
      return { ok: false, status: 503, error: "transport_unavailable" };
    }
    const filePath = normalizedBoundedFileWatchPath(submittedPath);
    if (!filePath) return { ok: false, status: 400, error: "invalid_request" };
    let authorization: "allowed_root" | "allowed_session_reference" | "denied";
    try { authorization = await dependencies.authorize(filePath, sessionId); }
    catch { return { ok: false, status: 403, error: "access_denied" }; }
    if (authorization === "denied") return { ok: false, status: 403, error: "access_denied" };

    let observationClass: "ordinary" | "symlink";
    try {
      if (!dependencies.stat(filePath).isFile()) {
        return { ok: false, status: 400, error: "invalid_request" };
      }
      observationClass = dependencies.lstat(filePath).isSymbolicLink() ? "symlink" : "ordinary";
    } catch { return { ok: false, status: 404, error: "file_unavailable" }; }

    try {
      dependencies.ensureChannel(gateway);
      const context = createFileWatchTicketContext(filePath, observationClass);
      const { ticket, expiresAt } = gateway.issueTicket(FILE_WATCH_CHANNEL, context);
      return { ok: true, ticket, expiresAt };
    } catch { return { ok: false, status: 503, error: "transport_unavailable" }; }
  };
}

const issueFileWatchTicket = createFileWatchTicketIssuer();

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
  const isExactFileWatchShape = parsed?.channel === FILE_WATCH_CHANNEL && "path" in parsed;
  if (body.byteLength > MAX_LEGACY_REQUEST_BODY_BYTES && !isExactFileWatchShape) {
    return jsonResponse({ error: "body_too_large" }, 413);
  }
  if (!parsed) return jsonResponse({ error: "invalid_request" }, 400);

  if (parsed.channel === FILE_WATCH_CHANNEL && "path" in parsed) {
    const issued = await issueFileWatchTicket(gateway, parsed.path as string, parsed.sessionId ?? null);
    if (!issued.ok) return jsonResponse({ error: issued.error }, issued.status);
    return jsonResponse({ ticket: issued.ticket, expiresAt: issued.expiresAt }, 200);
  }

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
