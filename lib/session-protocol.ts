import type { AgentMessage, AssistantMessage, CustomMessage, ToolResultMessage, UserMessage } from "./types";

export const PROJECTED_SESSION_PROTOCOL = "pi-web-projected-session" as const;
export const PROJECTED_SESSION_VERSION = 1 as const;
export const DEFAULT_SESSION_REPLAY_BYTES = 4 * 1024 * 1024;
export const DEFAULT_SESSION_REPLAY_UNITS = 8_192;
/** Byte ceiling for each snapshot start/chunk/end transfer unit only. */
export const DEFAULT_SESSION_SNAPSHOT_UNIT_BYTES = 64 * 1024;
export const DEFAULT_SESSION_STATE_NODES = 100_000;
/** Recursive canonical traversal is supported only through this maximum depth. */
export const DEFAULT_SESSION_STATE_DEPTH = 64;
export const DEFAULT_SESSION_SNAPSHOT_BYTES = DEFAULT_SESSION_REPLAY_BYTES * 16;
export const DEFAULT_SESSION_SNAPSHOT_PARTS = DEFAULT_SESSION_REPLAY_UNITS;

export type ProjectedSessionStateLimits = {
  canonicalDepthLimit: number;
  canonicalNodeLimit: number;
  snapshotByteLimit: number;
  snapshotPartLimit: number;
};

export function resolveProjectedSessionStateLimits(
  limits: Partial<ProjectedSessionStateLimits> = {},
): ProjectedSessionStateLimits {
  const resolved = {
    canonicalDepthLimit: limits.canonicalDepthLimit ?? DEFAULT_SESSION_STATE_DEPTH,
    canonicalNodeLimit: limits.canonicalNodeLimit ?? DEFAULT_SESSION_STATE_NODES,
    snapshotByteLimit: limits.snapshotByteLimit ?? DEFAULT_SESSION_SNAPSHOT_BYTES,
    snapshotPartLimit: limits.snapshotPartLimit ?? DEFAULT_SESSION_SNAPSHOT_PARTS,
  };
  if (!Number.isSafeInteger(resolved.canonicalDepthLimit) || resolved.canonicalDepthLimit < 0
    || resolved.canonicalDepthLimit > DEFAULT_SESSION_STATE_DEPTH
    || !Number.isSafeInteger(resolved.canonicalNodeLimit) || resolved.canonicalNodeLimit <= 0
    || !Number.isSafeInteger(resolved.snapshotByteLimit) || resolved.snapshotByteLimit <= 0
    || !Number.isSafeInteger(resolved.snapshotPartLimit) || resolved.snapshotPartLimit <= 0) {
    throw new Error("invalid_projected_session_state_limits");
  }
  return resolved;
}

export type SnapshotReason = "initial" | "recovery" | "final";
export type TerminalReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export type ContentDeltaKind = "text" | "thinking" | "tool_arguments";
export type ContentBlockKind = "text" | "thinking" | "toolCall";

export type ProjectedAssistantMetadata = Pick<AssistantMessage, "role" | "model" | "provider"> & {
  timestamp?: number;
};

export type ProjectedDraftBlock =
  | { contentIndex: number; type: "text"; text: string }
  | { contentIndex: number; type: "thinking"; thinking: string }
  | { contentIndex: number; type: "toolCall"; argumentsText: string; toolCall?: Extract<AssistantMessage["content"][number], { type: "toolCall" }> };

export type ProjectedAssistantDraft = {
  metadata: ProjectedAssistantMetadata;
  blocks: ProjectedDraftBlock[];
  terminalReason?: TerminalReason;
};

export type ProjectedDialog =
  | { id: string; method: "select"; title: string; options: string[]; timeout?: number; expiresAt?: number }
  | { id: string; method: "confirm"; title: string; message: string; timeout?: number; expiresAt?: number }
  | { id: string; method: "input"; title: string; placeholder?: string; timeout?: number; expiresAt?: number }
  | { id: string; method: "editor"; title: string; prefill?: string; timeout?: number; expiresAt?: number };

export type ProjectedCompaction = {
  active: boolean;
  reason: "manual" | "threshold" | "overflow";
  aborted?: boolean;
  errorMessage?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
};

export type ProjectedSessionState = {
  active: boolean;
  nativeSettled: boolean;
  draft: ProjectedAssistantDraft | null;
  activeTools: Array<{ toolCallId: string; toolName: string }>;
  queue: { steering: string[]; followUp: string[] };
  retry: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  compaction: ProjectedCompaction | null;
  dialogs: ProjectedDialog[];
  customUis: Array<{ id: string; lines: string[] }>;
  statuses: Array<{ key: string; text: string }>;
  widgets: Array<{ key: string; lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  title: string | null;
  transcriptRevision: number;
  transcriptRefreshRequired: boolean;
  runtimeRefreshRequired: boolean;
};

export type ProjectedSessionEffect =
  | { type: "message_completed"; message: AgentMessage }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "editor_inserted"; text: string };

export type ProjectedSessionFrameDraft =
  | { type: "activity_started"; activity: "native" | "prompt" | "compaction" }
  | { type: "attempt_ended"; willRetry: boolean }
  | { type: "native_settled" }
  | { type: "run_settled" }
  | { type: "assistant_message_started"; metadata: ProjectedAssistantMetadata }
  | { type: "content_block_started"; contentIndex: number; blockType: ContentBlockKind }
  | { type: "content_delta"; contentIndex: number; deltaType: ContentDeltaKind; delta: string }
  | { type: "content_block_finished"; contentIndex: number; blockType: ContentBlockKind; toolCall?: Extract<AssistantMessage["content"][number], { type: "toolCall" }> }
  | { type: "assistant_terminal"; reason: TerminalReason }
  | { type: "message_completed"; message: AgentMessage }
  | { type: "tool_started"; toolCallId: string; toolName: string }
  | { type: "tool_finished"; toolCallId: string }
  | { type: "queue_replaced"; steering: string[]; followUp: string[] }
  | { type: "retry_started"; attempt: number; maxAttempts: number; errorMessage?: string }
  | { type: "retry_finished" }
  | { type: "compaction_started"; reason: ProjectedCompaction["reason"] }
  | { type: "compaction_finished"; reason: ProjectedCompaction["reason"]; aborted: boolean; errorMessage?: string; tokensBefore?: number; estimatedTokensAfter?: number }
  | { type: "transcript_changed" }
  | { type: "runtime_refresh_required" }
  | { type: "extension_dialog_opened"; dialog: ProjectedDialog }
  | { type: "extension_dialog_closed"; id: string }
  | { type: "extension_custom_replaced"; id: string; lines: string[] }
  | { type: "extension_custom_closed"; id: string }
  | { type: "extension_status_set"; key: string; text: string }
  | { type: "extension_status_cleared"; key: string }
  | { type: "extension_widget_set"; key: string; lines: string[]; placement: "aboveEditor" | "belowEditor" }
  | { type: "extension_widget_cleared"; key: string }
  | { type: "extension_title_set"; title: string }
  | { type: "notice"; level: "info" | "warning" | "error"; message: string }
  | { type: "editor_inserted"; text: string };

export type ProjectedSessionLogicalFrame = ProjectedSessionFrameDraft & {
  protocol: typeof PROJECTED_SESSION_PROTOCOL;
  version: typeof PROJECTED_SESSION_VERSION;
  streamEpoch: string;
  sequence: number;
};

export type SnapshotStartFrame = {
  protocol: typeof PROJECTED_SESSION_PROTOCOL;
  version: typeof PROJECTED_SESSION_VERSION;
  streamEpoch: string;
  sequence: number;
  type: "snapshot_start";
  transferId: string;
  reason: SnapshotReason;
  partCount: number;
  byteLength: number;
  transcriptRefreshRequired: true;
  runtimeRefreshRequired: true;
};
export type SnapshotChunkFrame = {
  protocol: typeof PROJECTED_SESSION_PROTOCOL;
  version: typeof PROJECTED_SESSION_VERSION;
  streamEpoch: string;
  sequence: number;
  type: "snapshot_chunk";
  transferId: string;
  partIndex: number;
  data: string;
};
export type SnapshotEndFrame = {
  protocol: typeof PROJECTED_SESSION_PROTOCOL;
  version: typeof PROJECTED_SESSION_VERSION;
  streamEpoch: string;
  sequence: number;
  type: "snapshot_end";
  transferId: string;
};
export type SnapshotTransferFrame = SnapshotStartFrame | SnapshotChunkFrame | SnapshotEndFrame;
export type ProjectedSessionFrame = ProjectedSessionLogicalFrame | SnapshotTransferFrame;

export type SessionFrameParseResult =
  | { ok: true; frame: ProjectedSessionFrame }
  | { ok: false; reason: "malformed" | "unsupported_version" | "unknown_type" };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const safeInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const string = (value: unknown): value is string => typeof value === "string";
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const optionalKeys = (base: string[], value: Record<string, unknown>, optional: string[]): string[] => [
  ...base,
  ...optional.filter((key) => value[key] !== undefined),
];

/**
 * Reconstruct JSON-safe data without invoking getters, toJSON methods, or other
 * caller-controlled serialization hooks. Arrays must be dense ordinary arrays;
 * records must have only own enumerable data properties and ordinary/null
 * prototypes. The finite depth/node budget makes arbitrary provider data fail
 * closed before it can overflow the wrapper event boundary.
 */
export function cloneJsonSafe(
  value: unknown,
  canonicalNodeLimit = DEFAULT_SESSION_STATE_NODES,
  canonicalDepthLimit = DEFAULT_SESSION_STATE_DEPTH,
): unknown | undefined {
  if (!Number.isSafeInteger(canonicalNodeLimit) || canonicalNodeLimit <= 0
    || !Number.isSafeInteger(canonicalDepthLimit) || canonicalDepthLimit < 0
    || canonicalDepthLimit > DEFAULT_SESSION_STATE_DEPTH) return undefined;
  const seen = new Set<object>();
  let nodes = 0;
  const childrenFit = (depth: number, childCount: number): boolean => Number.isSafeInteger(childCount) && childCount >= 0
    && childCount <= canonicalNodeLimit - nodes
    && (childCount === 0 || depth < canonicalDepthLimit);
  const exactDenseKeys = (keys: readonly PropertyKey[], length: number): boolean => {
    if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) return false;
    const names = new Set(keys as string[]);
    if (!names.has("length")) return false;
    for (let index = 0; index < length; index += 1) if (!names.has(String(index))) return false;
    return true;
  };
  const visit = (input: unknown, depth: number): unknown | undefined => {
    nodes += 1;
    if (depth > canonicalDepthLimit || nodes > canonicalNodeLimit) return undefined;
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
    if (!input || typeof input !== "object") return undefined;
    if (seen.has(input)) return undefined;

    try {
      const isArray = Array.isArray(input);
      const prototype = Object.getPrototypeOf(input);
      seen.add(input);
      if (isArray) {
        if (prototype !== Array.prototype) return undefined;
        // Preflight the fixed length before any element descriptor retrieval.
        const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
        if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return undefined;
        const length = lengthDescriptor.value as number;
        if (!childrenFit(depth, length)) return undefined;
        const keys = Reflect.ownKeys(input);
        if (!exactDenseKeys(keys, length)) return undefined;
        const result: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
          const cloned = visit(descriptor.value, depth + 1);
          if (cloned === undefined) return undefined;
          result.push(cloned);
        }
        return result;
      }
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      const keys = Reflect.ownKeys(input);
      if (keys.some((key) => typeof key !== "string") || !childrenFit(depth, keys.length)) return undefined;
      const result: Record<string, unknown> = {};
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true || descriptor.value === undefined) return undefined;
        const cloned = visit(descriptor.value, depth + 1);
        if (cloned === undefined) return undefined;
        Object.defineProperty(result, key, { value: cloned, enumerable: true, configurable: true, writable: true });
      }
      return result;
    } catch {
      return undefined;
    }
  };
  try {
    return visit(value, 0);
  } catch {
    // Every public parser/encoder boundary must fail closed on hostile input,
    // including engine traversal failures not covered by individual traps.
    return undefined;
  }
}

function canonicalRecord(
  value: unknown,
  canonicalNodeLimit = DEFAULT_SESSION_STATE_NODES,
  canonicalDepthLimit = DEFAULT_SESSION_STATE_DEPTH,
): Record<string, unknown> | null {
  const canonical = cloneJsonSafe(value, canonicalNodeLimit, canonicalDepthLimit);
  return object(canonical) ? canonical : null;
}

function parseImage(value: unknown): unknown | null {
  if (!object(value) || value.type !== "image" || !object(value.source)) return null;
  const source = value.source;
  if (source.type === "base64") {
    if (!exact(source, optionalKeys(["type"], source, ["media_type", "data"]))) return null;
    if (source.media_type !== undefined && !string(source.media_type)) return null;
    if (source.data !== undefined && !string(source.data)) return null;
  } else if (source.type === "url") {
    if (!exact(source, optionalKeys(["type"], source, ["media_type", "url"]))) return null;
    if (source.media_type !== undefined && !string(source.media_type)) return null;
    if (source.url !== undefined && !string(source.url)) return null;
  } else return null;
  if (!exact(value, ["type", "source"])) return null;
  return value;
}

function parseTextOrImage(value: unknown): unknown | null {
  if (!object(value)) return null;
  if (value.type === "text" && exact(value, ["type", "text"]) && string(value.text)) return value;
  return parseImage(value);
}

function parseToolResultDetails(value: unknown): boolean {
  if (!object(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => key !== "patch" && key !== "diff")) return false;
  return (value.patch === undefined || string(value.patch)) && (value.diff === undefined || string(value.diff));
}

function parseUsage(value: unknown): boolean {
  if (!object(value) || !object(value.cost)) return false;
  if (!exact(value, ["input", "output", "cacheRead", "cacheWrite", "cost"])) return false;
  if (![value.input, value.output, value.cacheRead, value.cacheWrite].every(finite)) return false;
  return exact(value.cost, ["input", "output", "cacheRead", "cacheWrite", "total"])
    && [value.cost.input, value.cost.output, value.cost.cacheRead, value.cost.cacheWrite, value.cost.total].every(finite);
}

export function parseNormalizedMessage(input: unknown): AgentMessage | null {
  const canonical = canonicalRecord(input);
  if (!canonical) return null;
  const value = canonical;
  if (!string(value.role)) return null;
  const timestampOk = value.timestamp === undefined || finite(value.timestamp);
  if (!timestampOk) return null;
  if (value.role === "user") {
    if (!exact(value, optionalKeys(["role", "content"], value, ["timestamp"]))) return null;
    if (!(string(value.content) || (Array.isArray(value.content) && value.content.every((item) => parseTextOrImage(item))))) return null;
    return value as unknown as UserMessage;
  }
  if (value.role === "assistant") {
    if (!exact(value, optionalKeys(["role", "content", "model", "provider"], value, ["stopReason", "errorMessage", "timestamp", "usage"]))) return null;
    if (!string(value.model) || !string(value.provider) || (value.stopReason !== undefined && !["stop", "length", "toolUse", "error", "aborted"].includes(value.stopReason as string)) || (value.errorMessage !== undefined && !string(value.errorMessage))) return null;
    if (value.usage !== undefined && !parseUsage(value.usage)) return null;
    if (!Array.isArray(value.content)) return null;
    for (const item of value.content) {
      if (!object(item)) return null;
      if (item.type === "text") { if (!exact(item, ["type", "text"]) || !string(item.text)) return null; }
      else if (item.type === "thinking") {
        if (!exact(item, optionalKeys(["type", "thinking"], item, ["deferred"])) || !string(item.thinking) || (item.deferred !== undefined && typeof item.deferred !== "boolean")) return null;
      } else if (item.type === "toolCall") {
        if (!exact(item, ["type", "toolCallId", "toolName", "input"]) || !string(item.toolCallId) || !string(item.toolName) || !object(item.input) || cloneJsonSafe(item.input) === undefined) return null;
      } else if (!parseImage(item)) return null;
    }
    return value as unknown as AssistantMessage;
  }
  if (value.role === "toolResult") {
    if (!exact(value, optionalKeys(["role", "toolCallId", "content"], value, ["toolName", "isError", "details", "timestamp"]))) return null;
    if (!string(value.toolCallId) || (value.toolName !== undefined && !string(value.toolName)) || (value.isError !== undefined && typeof value.isError !== "boolean")) return null;
    if (!Array.isArray(value.content) || !value.content.every((item) => parseTextOrImage(item))) return null;
    if (value.details !== undefined && !parseToolResultDetails(value.details)) return null;
    return value as unknown as ToolResultMessage;
  }
  if (value.role === "custom") {
    if (!exact(value, optionalKeys(["role", "customType", "content", "display"], value, ["details", "timestamp"]))) return null;
    if (!string(value.customType) || typeof value.display !== "boolean") return null;
    if (!(string(value.content) || (Array.isArray(value.content) && value.content.every((item) => parseTextOrImage(item))))) return null;
    if (value.details !== undefined && cloneJsonSafe(value.details) === undefined) return null;
    return value as unknown as CustomMessage;
  }
  return null;
}

function parseMetadata(value: unknown): value is ProjectedAssistantMetadata {
  return object(value) && exact(value, optionalKeys(["role", "model", "provider"], value, ["timestamp"]))
    && value.role === "assistant" && string(value.model) && string(value.provider)
    && (value.timestamp === undefined || finite(value.timestamp));
}

function parseDialog(value: unknown): value is ProjectedDialog {
  if (!object(value) || !string(value.id) || !string(value.title) || !string(value.method)) return false;
  const optional = ["timeout", "expiresAt"];
  if (value.timeout !== undefined && !safeInt(value.timeout)) return false;
  if (value.expiresAt !== undefined && !finite(value.expiresAt)) return false;
  if (value.method === "select") return exact(value, optionalKeys(["id", "method", "title", "options"], value, optional)) && stringArray(value.options);
  if (value.method === "confirm") return exact(value, optionalKeys(["id", "method", "title", "message"], value, optional)) && string(value.message);
  if (value.method === "input") return exact(value, optionalKeys(["id", "method", "title"], value, [...optional, "placeholder"])) && (value.placeholder === undefined || string(value.placeholder));
  if (value.method === "editor") return exact(value, optionalKeys(["id", "method", "title"], value, [...optional, "prefill"])) && (value.prefill === undefined || string(value.prefill));
  return false;
}

function isUniqueSortedKeys(items: Array<{ key: string }>): boolean {
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0 && items[index - 1].key >= items[index].key) return false;
  }
  return true;
}

const deeplyFrozenCanonicalData = new WeakSet<object>();

/** Freeze a canonical data graph without invoking caller-controlled properties. */
export function freezeCanonicalData<T>(value: T): T {
  const visiting = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object" || deeplyFrozenCanonicalData.has(current)) return;
    if (visiting.has(current)) throw new Error("cyclic_canonical_data");
    visiting.add(current);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const descriptor of Object.values(descriptors)) {
        if (descriptor && "value" in descriptor) visit(descriptor.value);
      }
      if (!Object.isFrozen(current)) Object.freeze(current);
      deeplyFrozenCanonicalData.add(current);
    } finally {
      visiting.delete(current);
    }
  };
  visit(value);
  return value;
}

export function isDeeplyFrozenCanonicalData(value: unknown): boolean {
  return !value || typeof value !== "object" || deeplyFrozenCanonicalData.has(value);
}

export function createInitialProjectedSessionState(queue: { steering?: readonly string[]; followUp?: readonly string[] } = {}): ProjectedSessionState {
  return freezeCanonicalData({
    active: false,
    nativeSettled: false,
    draft: null,
    activeTools: [],
    queue: { steering: [...(queue.steering ?? [])], followUp: [...(queue.followUp ?? [])] },
    retry: null,
    compaction: null,
    dialogs: [],
    customUis: [],
    statuses: [],
    widgets: [],
    title: null,
    transcriptRevision: 0,
    transcriptRefreshRequired: true,
    runtimeRefreshRequired: true,
  });
}

export function parseProjectedSessionState(
  input: unknown,
  limits: Partial<ProjectedSessionStateLimits> = {},
): ProjectedSessionState | null {
  let resolved: ProjectedSessionStateLimits;
  try { resolved = resolveProjectedSessionStateLimits(limits); } catch { return null; }
  const canonical = canonicalRecord(input, resolved.canonicalNodeLimit, resolved.canonicalDepthLimit);
  if (canonical) {
    let byteLength: number;
    try { byteLength = new TextEncoder().encode(JSON.stringify(canonical)).byteLength; } catch { return null; }
    if (byteLength > resolved.snapshotByteLimit) return null;
  }
  if (!canonical) return null;
  const value = canonical;
  if (!exact(value, [
    "active", "nativeSettled", "draft", "activeTools", "queue", "retry", "compaction", "dialogs", "customUis", "statuses", "widgets", "title", "transcriptRevision", "transcriptRefreshRequired", "runtimeRefreshRequired",
  ])) return null;
  if (typeof value.active !== "boolean" || typeof value.nativeSettled !== "boolean" || !safeInt(value.transcriptRevision)
    || typeof value.transcriptRefreshRequired !== "boolean" || typeof value.runtimeRefreshRequired !== "boolean") return null;
  if (value.title !== null && !string(value.title)) return null;
  if (!object(value.queue) || !exact(value.queue, ["steering", "followUp"]) || !stringArray(value.queue.steering) || !stringArray(value.queue.followUp)) return null;
  if (!Array.isArray(value.activeTools) || !value.activeTools.every((item) => object(item) && exact(item, ["toolCallId", "toolName"]) && string(item.toolCallId) && string(item.toolName))
    || new Set(value.activeTools.map((item) => item.toolCallId)).size !== value.activeTools.length) return null;
  if (value.retry !== null && (!object(value.retry) || !exact(value.retry, optionalKeys(["attempt", "maxAttempts"], value.retry, ["errorMessage"])) || !safeInt(value.retry.attempt) || !safeInt(value.retry.maxAttempts) || (value.retry.errorMessage !== undefined && !string(value.retry.errorMessage)))) return null;
  if (value.compaction !== null) {
    const item = value.compaction;
    if (!object(item) || !exact(item, optionalKeys(["active", "reason"], item, ["aborted", "errorMessage", "tokensBefore", "estimatedTokensAfter"]))) return null;
    if (typeof item.active !== "boolean" || !["manual", "threshold", "overflow"].includes(item.reason as string)) return null;
    if (item.aborted !== undefined && typeof item.aborted !== "boolean") return null;
    if (item.errorMessage !== undefined && !string(item.errorMessage)) return null;
    if (item.tokensBefore !== undefined && !safeInt(item.tokensBefore)) return null;
    if (item.estimatedTokensAfter !== undefined && !safeInt(item.estimatedTokensAfter)) return null;
  }
  if (!Array.isArray(value.dialogs) || !value.dialogs.every(parseDialog) || new Set(value.dialogs.map((item) => item.id)).size !== value.dialogs.length) return null;
  if (!Array.isArray(value.customUis) || !value.customUis.every((item) => object(item) && exact(item, ["id", "lines"]) && string(item.id) && stringArray(item.lines)) || new Set(value.customUis.map((item) => item.id)).size !== value.customUis.length) return null;
  if (!Array.isArray(value.statuses) || !value.statuses.every((item) => object(item) && exact(item, ["key", "text"]) && string(item.key) && string(item.text)) || !isUniqueSortedKeys(value.statuses)) return null;
  if (!Array.isArray(value.widgets) || !value.widgets.every((item) => object(item) && exact(item, ["key", "lines", "placement"]) && string(item.key) && stringArray(item.lines) && ["aboveEditor", "belowEditor"].includes(item.placement as string)) || !isUniqueSortedKeys(value.widgets)) return null;
  if (value.draft !== null) {
    const draft = value.draft;
    if (!object(draft) || !exact(draft, optionalKeys(["metadata", "blocks"], draft, ["terminalReason"])) || !parseMetadata(draft.metadata) || !Array.isArray(draft.blocks)) return null;
    if (draft.terminalReason !== undefined && !["stop", "length", "toolUse", "error", "aborted"].includes(draft.terminalReason as string)) return null;
    let previousContentIndex = -1;
    for (const block of draft.blocks) {
      if (!object(block) || !safeInt(block.contentIndex) || block.contentIndex <= previousContentIndex) return null;
      previousContentIndex = block.contentIndex;
      if (block.type === "text") { if (!exact(block, ["contentIndex", "type", "text"]) || !string(block.text)) return null; }
      else if (block.type === "thinking") { if (!exact(block, ["contentIndex", "type", "thinking"]) || !string(block.thinking)) return null; }
      else if (block.type === "toolCall") {
        if (!exact(block, optionalKeys(["contentIndex", "type", "argumentsText"], block, ["toolCall"])) || !string(block.argumentsText)) return null;
        if (block.toolCall !== undefined) {
          const parsed = parseNormalizedMessage({ role: "assistant", model: "", provider: "", content: [block.toolCall] });
          if (!parsed) return null;
        }
      } else return null;
    }
  }
  return freezeCanonicalData(value as unknown as ProjectedSessionState);
}

const envelopeKeys = ["protocol", "version", "streamEpoch", "sequence", "type"];
const validEpoch = (value: unknown): value is string => string(value) && value.length > 0 && value.length <= 128;
const validReason = (value: unknown): value is SnapshotReason => value === "initial" || value === "recovery" || value === "final";

export function parseProjectedSessionFrame(input: unknown): SessionFrameParseResult {
  const canonical = canonicalRecord(input);
  if (!canonical) return { ok: false, reason: "malformed" };
  const value = canonical;
  if (value.protocol !== PROJECTED_SESSION_PROTOCOL || !validEpoch(value.streamEpoch) || !safeInt(value.sequence)) return { ok: false, reason: "malformed" };
  if (value.version !== PROJECTED_SESSION_VERSION) return { ok: false, reason: "unsupported_version" };
  if (!string(value.type)) return { ok: false, reason: "malformed" };
  const f = value;
  const keys = (...extra: string[]) => exact(f, [...envelopeKeys, ...extra]);
  let valid = false;
  switch (f.type) {
    case "activity_started": valid = keys("activity") && ["native", "prompt", "compaction"].includes(f.activity as string); break;
    case "attempt_ended": valid = keys("willRetry") && typeof f.willRetry === "boolean"; break;
    case "native_settled": case "run_settled": case "retry_finished": case "transcript_changed": case "runtime_refresh_required": valid = keys(); break;
    case "assistant_message_started": valid = keys("metadata") && parseMetadata(f.metadata); break;
    case "content_block_started": valid = keys("contentIndex", "blockType") && safeInt(f.contentIndex) && ["text", "thinking", "toolCall"].includes(f.blockType as string); break;
    case "content_delta": valid = keys("contentIndex", "deltaType", "delta") && safeInt(f.contentIndex) && ["text", "thinking", "tool_arguments"].includes(f.deltaType as string) && string(f.delta); break;
    case "content_block_finished": {
      valid = keys("contentIndex", "blockType", ...(f.toolCall === undefined ? [] : ["toolCall"])) && safeInt(f.contentIndex) && ["text", "thinking", "toolCall"].includes(f.blockType as string);
      if (valid && f.toolCall !== undefined) valid = f.blockType === "toolCall" && !!parseNormalizedMessage({ role: "assistant", model: "", provider: "", content: [f.toolCall] });
      break;
    }
    case "assistant_terminal": valid = keys("reason") && ["stop", "length", "toolUse", "error", "aborted"].includes(f.reason as string); break;
    case "message_completed": valid = keys("message") && !!parseNormalizedMessage(f.message); break;
    case "tool_started": valid = keys("toolCallId", "toolName") && string(f.toolCallId) && string(f.toolName); break;
    case "tool_finished": valid = keys("toolCallId") && string(f.toolCallId); break;
    case "queue_replaced": valid = keys("steering", "followUp") && stringArray(f.steering) && stringArray(f.followUp); break;
    case "retry_started": valid = keys("attempt", "maxAttempts", ...(f.errorMessage === undefined ? [] : ["errorMessage"])) && safeInt(f.attempt) && safeInt(f.maxAttempts) && (f.errorMessage === undefined || string(f.errorMessage)); break;
    case "compaction_started": valid = keys("reason") && ["manual", "threshold", "overflow"].includes(f.reason as string); break;
    case "compaction_finished": valid = keys("reason", "aborted", ...["errorMessage", "tokensBefore", "estimatedTokensAfter"].filter((key) => f[key] !== undefined)) && ["manual", "threshold", "overflow"].includes(f.reason as string) && typeof f.aborted === "boolean" && (f.errorMessage === undefined || string(f.errorMessage)) && (f.tokensBefore === undefined || safeInt(f.tokensBefore)) && (f.estimatedTokensAfter === undefined || safeInt(f.estimatedTokensAfter)); break;
    case "extension_dialog_opened": valid = keys("dialog") && parseDialog(f.dialog); break;
    case "extension_dialog_closed": case "extension_custom_closed": valid = keys("id") && string(f.id); break;
    case "extension_custom_replaced": valid = keys("id", "lines") && string(f.id) && stringArray(f.lines); break;
    case "extension_status_set": valid = keys("key", "text") && string(f.key) && string(f.text); break;
    case "extension_status_cleared": case "extension_widget_cleared": valid = keys("key") && string(f.key); break;
    case "extension_widget_set": valid = keys("key", "lines", "placement") && string(f.key) && stringArray(f.lines) && ["aboveEditor", "belowEditor"].includes(f.placement as string); break;
    case "extension_title_set": valid = keys("title") && string(f.title); break;
    case "notice": valid = keys("level", "message") && ["info", "warning", "error"].includes(f.level as string) && string(f.message); break;
    case "editor_inserted": valid = keys("text") && string(f.text); break;
    case "snapshot_start": valid = keys("transferId", "reason", "partCount", "byteLength", "transcriptRefreshRequired", "runtimeRefreshRequired") && validEpoch(f.transferId) && validReason(f.reason) && safeInt(f.partCount) && f.partCount > 0 && safeInt(f.byteLength) && f.transcriptRefreshRequired === true && f.runtimeRefreshRequired === true; break;
    case "snapshot_chunk": valid = keys("transferId", "partIndex", "data") && validEpoch(f.transferId) && safeInt(f.partIndex) && string(f.data) && /^[A-Za-z0-9_-]+$/.test(f.data); break;
    case "snapshot_end": valid = keys("transferId") && validEpoch(f.transferId); break;
    default: return { ok: false, reason: "unknown_type" };
  }
  return valid ? { ok: true, frame: f as ProjectedSessionFrame } : { ok: false, reason: "malformed" };
}

export function encodeProjectedSessionFrame(frame: ProjectedSessionFrame): string {
  const parsed = parseProjectedSessionFrame(frame);
  if (!parsed.ok) throw new Error(`invalid_projected_session_frame:${parsed.reason}`);
  return JSON.stringify(parsed.frame);
}
