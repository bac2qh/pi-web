export const SESSION_TRANSPORT_PROTOCOL = "pi-web-session-transport" as const;
export const SESSION_TRANSPORT_VERSION = 1 as const;
export const SESSION_TRANSPORT_CHANNEL = "session" as const;

export const SESSION_TRANSPORT_RESUME_TIMEOUT_MS = 10_000;
export const SESSION_TRANSPORT_CLOSE_FALLBACK_MS = 1_000;
export const SESSION_TRANSPORT_OUTPUT_BYTES = 4 * 1024 * 1024;

export const SESSION_TRANSPORT_CLOSE = Object.freeze({
  binary: 1003,
  policy: 1008,
  internal: 1011,
  owner: 1012,
  slow: 1013,
} as const);

export type SessionTransportResumeFrame = {
  protocol: typeof SESSION_TRANSPORT_PROTOCOL;
  version: typeof SESSION_TRANSPORT_VERSION;
  type: "resume";
  streamEpoch: string | null;
  cursor: number | null;
};

export type SessionTransportReadyOutcome =
  | "exact"
  | "empty"
  | "initial_snapshot"
  | "overflow_snapshot"
  | "wrong_epoch"
  | "invalid_cursor";

export type SessionTransportReadyFrame = {
  protocol: typeof SESSION_TRANSPORT_PROTOCOL;
  version: typeof SESSION_TRANSPORT_VERSION;
  type: "ready";
  serverInstanceId: string;
  streamEpoch: string;
  cursor: number;
  outcome: SessionTransportReadyOutcome;
};

export type SessionTransportParseResult<T> =
  | { ok: true; frame: T }
  | { ok: false; reason: "malformed" | "unsupported_version" | "unknown_type" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function boundedOpaque(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function safeCursor(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseSessionTransportResumeFrame(
  input: unknown,
): SessionTransportParseResult<SessionTransportResumeFrame> {
  if (!isRecord(input)) return { ok: false, reason: "malformed" };
  if (input.protocol !== SESSION_TRANSPORT_PROTOCOL) return { ok: false, reason: "malformed" };
  if (input.version !== SESSION_TRANSPORT_VERSION) return { ok: false, reason: "unsupported_version" };
  if (input.type !== "resume") return { ok: false, reason: "unknown_type" };
  if (!hasExactKeys(input, ["protocol", "version", "type", "streamEpoch", "cursor"])) {
    return { ok: false, reason: "malformed" };
  }
  const nullPair = input.streamEpoch === null && input.cursor === null;
  const resumePair = boundedOpaque(input.streamEpoch) && safeCursor(input.cursor);
  if (!nullPair && !resumePair) return { ok: false, reason: "malformed" };
  return { ok: true, frame: input as SessionTransportResumeFrame };
}

export function parseSessionTransportResumeText(
  text: string,
): SessionTransportParseResult<SessionTransportResumeFrame> {
  if (typeof text !== "string") return { ok: false, reason: "malformed" };
  try {
    return parseSessionTransportResumeFrame(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

const readyOutcomes = new Set<SessionTransportReadyOutcome>([
  "exact",
  "empty",
  "initial_snapshot",
  "overflow_snapshot",
  "wrong_epoch",
  "invalid_cursor",
]);

export function parseSessionTransportReadyFrame(
  input: unknown,
): SessionTransportParseResult<SessionTransportReadyFrame> {
  if (!isRecord(input)) return { ok: false, reason: "malformed" };
  if (input.protocol !== SESSION_TRANSPORT_PROTOCOL) return { ok: false, reason: "malformed" };
  if (input.version !== SESSION_TRANSPORT_VERSION) return { ok: false, reason: "unsupported_version" };
  if (input.type !== "ready") return { ok: false, reason: "unknown_type" };
  if (!hasExactKeys(input, [
    "protocol", "version", "type", "serverInstanceId", "streamEpoch", "cursor", "outcome",
  ])) return { ok: false, reason: "malformed" };
  if (!boundedOpaque(input.serverInstanceId) || !boundedOpaque(input.streamEpoch)
    || !safeCursor(input.cursor) || !readyOutcomes.has(input.outcome as SessionTransportReadyOutcome)) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, frame: input as SessionTransportReadyFrame };
}

export function parseSessionTransportReadyText(
  text: string,
): SessionTransportParseResult<SessionTransportReadyFrame> {
  if (typeof text !== "string") return { ok: false, reason: "malformed" };
  try {
    return parseSessionTransportReadyFrame(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export function encodeSessionTransportReadyFrame(frame: SessionTransportReadyFrame): string {
  const parsed = parseSessionTransportReadyFrame(frame);
  if (!parsed.ok) throw new Error(`invalid_session_transport_ready:${parsed.reason}`);
  return JSON.stringify(parsed.frame);
}
