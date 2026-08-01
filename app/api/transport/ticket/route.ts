import { ensureGlobalStatusChannel } from "@/lib/global-status-channel";
import { GLOBAL_STATUS_CHANNEL } from "@/lib/global-status-protocol";
import { getWebSocketGateway } from "@/lib/websocket-gateway";

export const dynamic = "force-dynamic";

const TRANSPORT_HEADER = "X-Pi-Web-Transport";
const MAX_REQUEST_BODY_BYTES = 1024;

type BodyReadResult =
  | { ok: true; value: unknown }
  | { ok: false; tooLarge: boolean };

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

function parseChannel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "channel") return null;
  const channel = (value as { channel?: unknown }).channel;
  return typeof channel === "string" ? channel : null;
}

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

  const channel = parseChannel(body.value);
  if (channel === null) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  try {
    if (channel === GLOBAL_STATUS_CHANNEL) ensureGlobalStatusChannel(gateway);
    const { ticket, expiresAt } = gateway.issueTicket(channel);
    return jsonResponse({ ticket, expiresAt }, 200);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === "invalid_channel") {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    if (code === "channel_unavailable") {
      return jsonResponse({ error: "channel_unavailable" }, 404);
    }
    return jsonResponse({ error: "transport_unavailable" }, 503);
  }
}
