import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_SESSION_STATE_DEPTH,
  DEFAULT_SESSION_STATE_NODES,
  cloneJsonSafe,
  parseNormalizedMessage,
  type ProjectedAssistantDraft,
  type ProjectedDialog,
  type ProjectedSessionFrameDraft,
  type ProjectedSessionState,
} from "./session-protocol";
import type { AgentMessage, AssistantMessage, ToolCallContent } from "./types";

type NativeMessageUpdate = Extract<AgentSessionEvent, { type: "message_update" }>;
type AssistantMessageEvent = NativeMessageUpdate["assistantMessageEvent"];
const KNOWN_ASSISTANT_EVENT_TYPES: Record<AssistantMessageEvent["type"], true> = {
  start: true,
  text_start: true,
  text_delta: true,
  text_end: true,
  thinking_start: true,
  thinking_delta: true,
  thinking_end: true,
  toolcall_start: true,
  toolcall_delta: true,
  toolcall_end: true,
  done: true,
  error: true,
};

export type ProjectionOnlyInput =
  | { type: "wrapper_activity_started"; activity: "prompt" | "compaction" }
  | { type: "wrapper_settled" }
  | { type: "extension_dialog_closed"; id: string }
  | { type: "extension_status_cleared"; key: string }
  | { type: "extension_widget_cleared"; key: string };

type LegacyCompactionInput =
  | { type: "auto_compaction_start"; reason?: "manual" | "threshold" | "overflow" }
  | { type: "auto_compaction_end"; reason?: "manual" | "threshold" | "overflow"; result?: unknown; aborted?: boolean; errorMessage?: string };

type WrapperInput =
  | { type: "prompt_error"; errorMessage?: unknown }
  | { type: "prompt_done" }
  | { type: "extension_error"; error?: unknown; extensionPath?: unknown; event?: unknown }
  | ({ type: "extension_ui_request" } & Record<string, unknown>);

export type SessionProjectionInput = AgentSessionEvent | ProjectionOnlyInput | LegacyCompactionInput | WrapperInput;

const INSTALLED_AGENT_EVENT_TYPES = {
  agent_start: true,
  agent_end: true,
  agent_settled: true,
  turn_start: true,
  turn_end: true,
  message_start: true,
  message_update: true,
  message_end: true,
  tool_execution_start: true,
  tool_execution_update: true,
  tool_execution_end: true,
  queue_update: true,
  compaction_start: true,
  compaction_end: true,
  entry_appended: true,
  session_info_changed: true,
  thinking_level_changed: true,
  auto_retry_start: true,
  auto_retry_end: true,
  summarization_retry_scheduled: true,
  summarization_retry_attempt_start: true,
  summarization_retry_finished: true,
  bash_execution_update: true,
} satisfies Record<AgentSessionEvent["type"], true>;

function isInstalledAgentEvent(input: { type: string }): input is AgentSessionEvent {
  return Object.prototype.hasOwnProperty.call(INSTALLED_AGENT_EVENT_TYPES, input.type);
}

/** Compiler-exhaustive installed-event classification; projection remains below. */
function classifyInstalledAgentEvent(input: AgentSessionEvent): void {
  switch (input.type) {
    case "agent_start": case "agent_end": case "agent_settled":
    case "turn_start": case "turn_end":
    case "message_start": case "message_update": case "message_end":
    case "tool_execution_start": case "tool_execution_update": case "tool_execution_end":
    case "queue_update": case "compaction_start": case "compaction_end":
    case "entry_appended": case "session_info_changed": case "thinking_level_changed":
    case "auto_retry_start": case "auto_retry_end":
    case "summarization_retry_scheduled": case "summarization_retry_attempt_start": case "summarization_retry_finished":
    case "bash_execution_update": return;
    default: return assertNever(input);
  }
}

export type ProjectionDiagnostic = {
  kind: "input" | "final_equality";
  outcome: "projected" | "omitted" | "unknown" | "malformed" | "equal" | "mismatch" | "not_comparable";
  inputClass: "native" | "wrapper" | "extension" | "assistant" | "message" | "unknown";
};
export type ProjectionDiagnosticSink = (diagnostic: ProjectionDiagnostic) => void;

const safeArray = (value: unknown): value is unknown[] => {
  try { return Array.isArray(value); } catch { return false; }
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !safeArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const safeInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

type CaptureBudget = { nodes: number; nodeLimit: number; depthLimit: number; seen: Set<object> };

type InspectedRecord = { source: object; values: Record<string, unknown> };

function claimCaptureNode(budget: CaptureBudget, depth: number): boolean {
  budget.nodes += 1;
  return depth <= budget.depthLimit && budget.nodes <= budget.nodeLimit;
}

function defineCaptured(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

/** Validate one ordinary record identity without enumerating any discarded key. */
function inspectRecordIdentity(value: unknown, budget?: CaptureBudget, depth = 0, selectIdentity = false): object | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (budget && (!claimCaptureNode(budget, depth) || (selectIdentity && budget.seen.has(value)))) return null;
    if (budget && selectIdentity) budget.seen.add(value);
    return value;
  } catch { return null; }
}

/** Fetch only fixed own enumerable data descriptors; optional absence is omitted. */
function inspectSelectedDataFields(
  value: unknown,
  keys: readonly string[],
  budget?: CaptureBudget,
  depth = 0,
  options: { required?: readonly string[]; selectIdentity?: boolean } = {},
): InspectedRecord | null {
  const source = inspectRecordIdentity(value, budget, depth, options.selectIdentity === true);
  if (!source) return null;
  const required = new Set(options.required ?? []);
  const values = Object.create(null) as Record<string, unknown>;
  try {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor) {
        if (required.has(key)) return null;
        continue;
      }
      if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
      if (descriptor.value !== undefined) defineCaptured(values, key, descriptor.value);
    }
    return { source, values };
  } catch { return null; }
}

function inspectDiscriminant(value: unknown, key: string, budget?: CaptureBudget, depth = 0, selectIdentity = false): InspectedRecord | null {
  const inspected = inspectSelectedDataFields(value, [key], budget, depth, { required: [key], selectIdentity });
  return inspected && string(inspected.values[key]) ? inspected : null;
}

/** Full record inspection is reserved for already-canonical internal values. */
function inspectDataRecord(value: unknown): Record<string, unknown> | null {
  try {
    const source = inspectRecordIdentity(value);
    if (!source) return null;
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const keys = Reflect.ownKeys(descriptors);
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      defineCaptured(record, key, descriptor.value);
    }
    return record;
  } catch { return null; }
}

function selectedChildrenFit(budget: CaptureBudget, depth: number, childCount: number): boolean {
  return Number.isSafeInteger(childCount) && childCount >= 0
    && childCount <= budget.nodeLimit - budget.nodes
    && (childCount === 0 || depth < budget.depthLimit);
}

function hasExactDenseArrayKeys(keys: readonly PropertyKey[], length: number): boolean {
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string")) return false;
  const names = new Set(keys as string[]);
  if (!names.has("length")) return false;
  for (let index = 0; index < length; index += 1) if (!names.has(String(index))) return false;
  return true;
}

function captureJsonValue(value: unknown, budget: CaptureBudget, depth: number): unknown | undefined {
  if (!claimCaptureNode(budget, depth)) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== "object" || budget.seen.has(value)) return undefined;
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    budget.seen.add(value);
    if (isArray) {
      if (prototype !== Array.prototype) return undefined;
      // Length is the sole descriptor needed before capacity preflight. A wide
      // rejected array must not trigger every element descriptor trap.
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return undefined;
      const length = lengthDescriptor.value as number;
      if (!selectedChildrenFit(budget, depth, length)) return undefined;
      const keys = Reflect.ownKeys(value);
      if (!hasExactDenseArrayKeys(keys, length)) return undefined;
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
        const item = captureJsonValue(descriptor.value, budget, depth + 1);
        if (item === undefined) return undefined;
        result.push(item);
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") || !selectedChildrenFit(budget, depth, keys.length)) return undefined;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true || descriptor.value === undefined) return undefined;
      const item = captureJsonValue(descriptor.value, budget, depth + 1);
      if (item === undefined) return undefined;
      defineCaptured(result, key, item);
    }
    return result;
  } catch { return undefined; }
}

type PickedRecordIdentityMode = "select" | "already_selected";

function capturePickedRecord(
  value: unknown,
  keys: readonly string[],
  budget: CaptureBudget,
  depth: number,
  identityMode: PickedRecordIdentityMode,
  preset: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> | null {
  const selectedKeys = keys.filter((key) => !Object.prototype.hasOwnProperty.call(preset, key));
  const inspected = identityMode === "select"
    ? inspectSelectedDataFields(value, selectedKeys, budget, depth, { selectIdentity: true })
    : inspectSelectedDataFields(value, selectedKeys, undefined, depth);
  if (!inspected || (identityMode === "already_selected" && !budget.seen.has(inspected.source)) || !claimCaptureNode(budget, depth)) return null;
  const captured = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const hasPreset = Object.prototype.hasOwnProperty.call(preset, key);
    if (!hasPreset && !Object.prototype.hasOwnProperty.call(inspected.values, key)) continue;
    const item = captureJsonValue(hasPreset ? preset[key] : inspected.values[key], budget, depth + 1);
    if (item === undefined) return null;
    defineCaptured(captured, key, item);
  }
  return captured;
}

function inspectDenseArray(
  value: unknown,
  budget: CaptureBudget,
  depth: number,
  captureItem: (item: unknown) => unknown | null,
): unknown[] | null {
  try {
    if (!claimCaptureNode(budget, depth) || !value || typeof value !== "object" || budget.seen.has(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    budget.seen.add(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const lengthValue = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value as unknown : undefined;
    if (!Number.isSafeInteger(lengthValue) || (lengthValue as number) < 0) return null;
    const length = lengthValue as number;
    if (!selectedChildrenFit(budget, depth, length)) return null;
    const keys = Reflect.ownKeys(value);
    if (!hasExactDenseArrayKeys(keys, length)) return null;
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      const captured = captureItem(descriptor.value);
      if (captured === null) return null;
      values.push(captured);
    }
    return values;
  } catch { return null; }
}

function inspectFixedDataFields(value: unknown, keys: readonly string[], budget: CaptureBudget, depth: number): Record<string, unknown> | null {
  return inspectSelectedDataFields(value, keys, budget, depth, { required: keys, selectIdentity: true })?.values ?? null;
}

function isOrdinaryArrayIdentity(value: unknown): boolean {
  try { return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype; }
  catch { return false; }
}

function captureIgnoredAssistant(value: unknown, budget: CaptureBudget, depth: number): Record<string, unknown> | null {
  // The complete partial/terminal message is validation-only. Inspect exactly
  // four fixed descriptors and the array identity; never enumerate its growing
  // content or retain model/provider labels.
  const record = inspectFixedDataFields(value, ["role", "model", "provider", "content"], budget, depth);
  if (!record || record.role !== "assistant" || !string(record.model) || !string(record.provider) || !isOrdinaryArrayIdentity(record.content)) return null;
  if (!claimCaptureNode(budget, depth)) return null;
  const captured = Object.create(null) as Record<string, unknown>;
  defineCaptured(captured, "role", "assistant");
  defineCaptured(captured, "model", "");
  defineCaptured(captured, "provider", "");
  defineCaptured(captured, "content", []);
  return captured;
}

function captureNormalizedToolCall(value: unknown, budget: CaptureBudget, depth: number, identityAlreadySelected = false): ToolCallContent | null {
  const inspected = inspectDiscriminant(value, "type", budget, depth, !identityAlreadySelected);
  if (!inspected || inspected.values.type !== "toolCall") return null;
  const selected = inspectSelectedDataFields(inspected.source, ["toolCallId", "id", "toolName", "name", "input", "arguments"])?.values;
  if (!selected) return null;
  const toolCallId = string(selected.toolCallId) ? selected.toolCallId : string(selected.id) ? selected.id : null;
  const toolName = string(selected.toolName) ? selected.toolName : string(selected.name) ? selected.name : null;
  const rawInput = object(selected.input) ? selected.input : object(selected.arguments) ? selected.arguments : null;
  if (!toolCallId || !toolName || !rawInput) return null;
  const input = captureJsonValue(rawInput, budget, depth + 1);
  return object(input) ? { type: "toolCall", toolCallId, toolName, input } : null;
}

function captureAssistantEvent(value: unknown, budget: CaptureBudget, depth: number): Record<string, unknown> | null {
  const discriminated = inspectDiscriminant(value, "type", budget, depth, true);
  if (!discriminated) return null;
  const eventType = discriminated.values.type as string;
  if (!Object.prototype.hasOwnProperty.call(KNOWN_ASSISTANT_EVENT_TYPES, eventType)) {
    if (!claimCaptureNode(budget, depth)) return null;
    const unknown = Object.create(null) as Record<string, unknown>;
    // Preserve only a bounded unknown-variant classification, not a caller
    // supplied type label or any unknown key/value.
    defineCaptured(unknown, "type", "__unknown_assistant_variant__");
    return unknown;
  }
  const allowedByType: Record<string, readonly string[]> = {
    start: ["type", "partial"],
    text_start: ["type", "contentIndex", "partial"], text_delta: ["type", "contentIndex", "delta", "partial"], text_end: ["type", "contentIndex", "content", "partial"],
    thinking_start: ["type", "contentIndex", "partial"], thinking_delta: ["type", "contentIndex", "delta", "partial"], thinking_end: ["type", "contentIndex", "content", "partial"],
    toolcall_start: ["type", "contentIndex", "partial"], toolcall_delta: ["type", "contentIndex", "delta", "partial"], toolcall_end: ["type", "contentIndex", "toolCall", "partial"],
    done: ["type", "reason", "message"], error: ["type", "reason", "error"],
  };
  const allowed = allowedByType[eventType];
  // Known variants are exact. Bound own-key count before fixed descriptor reads,
  // then reject symbols, hidden/accessor fields, and excess names without ever
  // retaining attacker-controlled keys or discarded values.
  let ownKeys: PropertyKey[];
  try { ownKeys = Reflect.ownKeys(discriminated.source); } catch { return null; }
  if (ownKeys.length !== allowed.length || ownKeys.some((key) => typeof key !== "string" || !allowed.includes(key))) return null;
  const record = inspectSelectedDataFields(discriminated.source, allowed, undefined, depth, { required: allowed })?.values;
  if (!record || !claimCaptureNode(budget, depth)) return null;
  const captured = Object.create(null) as Record<string, unknown>;
  defineCaptured(captured, "type", eventType);
  if (Object.prototype.hasOwnProperty.call(record, "contentIndex")) {
    if (!safeInt(record.contentIndex)) return null;
    defineCaptured(captured, "contentIndex", record.contentIndex);
  }
  if (Object.prototype.hasOwnProperty.call(record, "delta")) {
    if (!string(record.delta)) return null;
    defineCaptured(captured, "delta", record.delta);
  }
  if (Object.prototype.hasOwnProperty.call(record, "content")) {
    if (!string(record.content)) return null;
    // Block-end accumulated content is validation-only and can grow without
    // bound. Queue a canonical string sentinel, never the accumulated value.
    defineCaptured(captured, "content", "");
  }
  if (Object.prototype.hasOwnProperty.call(record, "reason")) {
    if (!string(record.reason)) return null;
    defineCaptured(captured, "reason", record.reason);
  }
  if (Object.prototype.hasOwnProperty.call(record, "partial")) {
    const partial = captureIgnoredAssistant(record.partial, budget, depth + 1);
    if (!partial) return null;
    defineCaptured(captured, "partial", partial);
  }
  if (eventType === "toolcall_end") {
    const toolCall = captureNormalizedToolCall(record.toolCall, budget, depth + 1);
    if (!toolCall) return null;
    defineCaptured(captured, "toolCall", toolCall);
  }
  if (eventType === "done" || eventType === "error") {
    const key = eventType === "done" ? "message" : "error";
    const terminal = captureIgnoredAssistant(record[key], budget, depth + 1);
    if (!terminal) return null;
    defineCaptured(captured, key, terminal);
  }
  return captured;
}

function captureDisplayContentItem(value: unknown, budget: CaptureBudget, depth: number, assistant: boolean): unknown | null {
  const discriminated = inspectDiscriminant(value, "type", budget, depth, true);
  if (!discriminated) return null;
  const type = discriminated.values.type;
  if (type === "text") {
    const record = inspectSelectedDataFields(discriminated.source, ["text"], undefined, depth, { required: ["text"] })?.values;
    return record && string(record.text) ? { type: "text", text: record.text } : null;
  }
  if (assistant && type === "thinking") {
    const record = inspectSelectedDataFields(discriminated.source, ["thinking", "deferred"], undefined, depth, { required: ["thinking"] })?.values;
    return record && string(record.thinking) && (record.deferred === undefined || typeof record.deferred === "boolean")
      ? { type: "thinking", thinking: record.thinking, ...(typeof record.deferred === "boolean" ? { deferred: record.deferred } : {}) }
      : null;
  }
  if (assistant && type === "toolCall") return captureNormalizedToolCall(value, budget, depth, true);
  if (type === "image") {
    const record = inspectSelectedDataFields(discriminated.source, ["source", "data", "mimeType"])?.values;
    if (!record) return null;
    if (record.source !== undefined) {
      const sourceType = inspectDiscriminant(record.source, "type", budget, depth + 1, true);
      if (!sourceType) return null;
      const source = inspectSelectedDataFields(sourceType.source, ["media_type", "data", "url"])?.values;
      if (!source) return null;
      if (sourceType.values.type === "base64" && (source.media_type === undefined || string(source.media_type)) && (source.data === undefined || string(source.data))) {
        return { type: "image", source: { type: "base64", ...(string(source.media_type) ? { media_type: source.media_type } : {}), ...(string(source.data) ? { data: source.data } : {}) } };
      }
      if (sourceType.values.type === "url" && (source.media_type === undefined || string(source.media_type)) && (source.url === undefined || string(source.url))) {
        return { type: "image", source: { type: "url", ...(string(source.media_type) ? { media_type: source.media_type } : {}), ...(string(source.url) ? { url: source.url } : {}) } };
      }
      return null;
    }
    if (string(record.data) && string(record.mimeType)) return { type: "image", source: { type: "base64", media_type: record.mimeType, data: record.data } };
  }
  return null;
}

function captureDisplayContent(value: unknown, budget: CaptureBudget, depth: number, assistant: boolean): string | unknown[] | null {
  if (string(value) && !assistant) return value;
  return inspectDenseArray(
    value,
    budget,
    depth,
    (item) => captureDisplayContentItem(item, budget, depth + 1, assistant),
  );
}

function captureNormalizedMessage(value: unknown, budget: CaptureBudget, depth: number): AgentMessage | { role: string } | null {
  const discriminated = inspectDiscriminant(value, "role", budget, depth, true);
  if (!discriminated) return null;
  const role = discriminated.values.role as string;
  if (["bashExecution", "branchSummary", "compactionSummary"].includes(role)) return { role };
  const selectedByRole: Record<string, readonly string[]> = {
    user: ["content", "timestamp"],
    assistant: ["content", "model", "provider", "stopReason", "errorMessage", "timestamp", "usage"],
    toolResult: ["toolCallId", "toolName", "content", "isError", "details", "timestamp"],
    custom: ["customType", "content", "display", "details", "timestamp"],
  };
  const selected = selectedByRole[role];
  if (!selected) return null;
  const fields = inspectSelectedDataFields(discriminated.source, selected)?.values;
  if (!fields) return null;
  const record = Object.assign(Object.create(null), fields, { role }) as Record<string, unknown>;
  let candidate: Record<string, unknown> | null = null;
  const timestamp = record.timestamp === undefined ? undefined : finite(record.timestamp) ? record.timestamp : null;
  if (timestamp === null) return null;
  if (record.role === "user") {
    const content = captureDisplayContent(record.content, budget, depth + 1, false);
    if (content !== null) candidate = { role: "user", content, ...(timestamp === undefined ? {} : { timestamp }) };
  } else if (record.role === "assistant" && string(record.model) && string(record.provider)) {
    const content = captureDisplayContent(record.content, budget, depth + 1, true);
    if (content !== null) {
      let usage: unknown = undefined;
      if (record.usage !== undefined) {
        const usageRecord = inspectSelectedDataFields(record.usage, ["input", "output", "cacheRead", "cacheWrite", "cost"], budget, depth + 1, { required: ["input", "output", "cacheRead", "cacheWrite", "cost"], selectIdentity: true })?.values;
        const cost = usageRecord && inspectSelectedDataFields(usageRecord.cost, ["input", "output", "cacheRead", "cacheWrite", "total"], budget, depth + 2, { required: ["input", "output", "cacheRead", "cacheWrite", "total"], selectIdentity: true })?.values;
        const fields = usageRecord && cost
          ? [usageRecord.input, usageRecord.output, usageRecord.cacheRead, usageRecord.cacheWrite, cost.input, cost.output, cost.cacheRead, cost.cacheWrite, cost.total]
          : [];
        if (!usageRecord || !cost || fields.length !== 9 || !fields.every(finite)) return null;
        usage = { input: usageRecord.input, output: usageRecord.output, cacheRead: usageRecord.cacheRead, cacheWrite: usageRecord.cacheWrite, cost: { input: cost.input, output: cost.output, cacheRead: cost.cacheRead, cacheWrite: cost.cacheWrite, total: cost.total } };
      }
      candidate = { role: "assistant", content, model: record.model, provider: record.provider,
        ...(string(record.stopReason) ? { stopReason: record.stopReason } : {}), ...(string(record.errorMessage) ? { errorMessage: record.errorMessage } : {}),
        ...(timestamp === undefined ? {} : { timestamp }), ...(usage === undefined ? {} : { usage }) };
    }
  } else if (record.role === "toolResult" && string(record.toolCallId)) {
    const content = captureDisplayContent(record.content, budget, depth + 1, false);
    if (content !== null) {
      const detailsRecord = record.details === undefined ? undefined : inspectSelectedDataFields(record.details, ["patch", "diff"], budget, depth + 1, { selectIdentity: true })?.values;
      if (record.details !== undefined && !detailsRecord) return null;
      const details = detailsRecord ? { ...(string(detailsRecord.patch) ? { patch: detailsRecord.patch } : {}), ...(string(detailsRecord.diff) ? { diff: detailsRecord.diff } : {}) } : undefined;
      candidate = { role: "toolResult", toolCallId: record.toolCallId, ...(string(record.toolName) ? { toolName: record.toolName } : {}), content,
        ...(typeof record.isError === "boolean" ? { isError: record.isError } : {}), ...(details && Object.keys(details).length ? { details } : {}), ...(timestamp === undefined ? {} : { timestamp }) };
    }
  } else if (record.role === "custom" && string(record.customType) && typeof record.display === "boolean") {
    const content = captureDisplayContent(record.content, budget, depth + 1, false);
    const details = record.details === undefined ? undefined : captureJsonValue(record.details, budget, depth + 1);
    if (content !== null && (record.details === undefined || details !== undefined)) candidate = { role: "custom", customType: record.customType, content, display: record.display,
      ...(details === undefined ? {} : { details }), ...(timestamp === undefined ? {} : { timestamp }) };
  }
  // Candidate construction above already emits the exact normalized display
  // subset. The caller performs the one configured strict canonical clone over
  // the complete reconstructed input graph before enqueue.
  return candidate as AgentMessage | null;
}

/**
 * Capture only projection-relevant canonical input before FIFO enqueue. One
 * depth/node budget covers every selected branch. Omitted provider payloads are
 * never traversed, and all proxy/descriptor/array inspection fails closed.
 */
function captureExtensionInput(source: object, budget: CaptureBudget): Record<string, unknown> | null {
  const discriminated = inspectDiscriminant(source, "method");
  if (!discriminated) return null;
  const method = discriminated.values.method as string;
  let keys: readonly string[];
  switch (method) {
    case "select": keys = ["type", "method", "id", "title", "options", "timeout", "expiresAt"]; break;
    case "confirm": keys = ["type", "method", "id", "title", "message", "timeout", "expiresAt"]; break;
    case "input": keys = ["type", "method", "id", "title", "placeholder", "timeout", "expiresAt"]; break;
    case "editor": keys = ["type", "method", "id", "title", "prefill", "timeout", "expiresAt"]; break;
    case "notify": keys = ["type", "method", "message", "notifyType"]; break;
    case "setStatus": keys = ["type", "method", "statusKey", "statusText"]; break;
    case "setWidget": keys = ["type", "method", "widgetKey", "widgetLines", "widgetPlacement"]; break;
    case "setTitle": keys = ["type", "method", "title"]; break;
    case "set_editor_text": keys = ["type", "method", "text"]; break;
    case "custom": keys = ["type", "method", "id", "closed", "lines"]; break;
    default: {
      if (!claimCaptureNode(budget, 0)) return null;
      const unknown = Object.create(null) as Record<string, unknown>;
      defineCaptured(unknown, "type", "extension_ui_request");
      defineCaptured(unknown, "method", "__unknown_extension_method__");
      return unknown;
    }
  }
  return capturePickedRecord(source, keys, budget, 0, "already_selected", { type: "extension_ui_request", method });
}

export function captureSessionProjectionInput(
  input: SessionProjectionInput | { type: string; [key: string]: unknown },
  canonicalNodeLimit = DEFAULT_SESSION_STATE_NODES,
  canonicalDepthLimit = DEFAULT_SESSION_STATE_DEPTH,
): SessionProjectionInput | { type: string; [key: string]: unknown } | null {
  if (!Number.isSafeInteger(canonicalNodeLimit) || canonicalNodeLimit <= 0 || !Number.isSafeInteger(canonicalDepthLimit) || canonicalDepthLimit < 0 || canonicalDepthLimit > DEFAULT_SESSION_STATE_DEPTH) return null;
  const budget: CaptureBudget = { nodes: 0, nodeLimit: canonicalNodeLimit, depthLimit: canonicalDepthLimit, seen: new Set() };
  try {
    const discriminated = inspectDiscriminant(input, "type", budget, 0, true);
    if (!discriminated) return null;
    const source = discriminated.source;
    const type = discriminated.values.type as string;
    let captured: Record<string, unknown> | null;
    const top = (keys: readonly string[]) => capturePickedRecord(source, keys, budget, 0, "already_selected", { type });
    const selectedTop = (keys: readonly string[]) => inspectSelectedDataFields(source, keys)?.values ?? null;
    switch (type) {
      case "wrapper_activity_started": captured = top(["type", "activity"]); break;
      case "wrapper_settled": case "agent_start": case "agent_settled": case "tool_execution_update":
      case "entry_appended": case "session_info_changed": case "thinking_level_changed": case "turn_start": case "turn_end":
      case "summarization_retry_scheduled": case "summarization_retry_attempt_start": case "summarization_retry_finished":
      case "bash_execution_update": case "prompt_done": captured = top(["type"]); break;
      case "extension_dialog_closed": captured = top(["type", "id"]); break;
      case "extension_status_cleared": case "extension_widget_cleared": captured = top(["type", "key"]); break;
      case "agent_end": captured = top(["type", "willRetry"]); break;
      case "message_start": {
        captured = top(["type"]);
        const outer = selectedTop(["message"]);
        const metadata = outer && capturePickedRecord(outer.message, ["role", "model", "provider", "timestamp"], budget, 1, "select");
        if (!captured || !metadata) return null;
        defineCaptured(captured, "message", metadata);
        break;
      }
      case "message_update": {
        captured = top(["type"]);
        const outer = selectedTop(["assistantMessageEvent"]);
        const event = outer && captureAssistantEvent(outer.assistantMessageEvent, budget, 1);
        if (!captured || !event) return null;
        defineCaptured(captured, "assistantMessageEvent", event);
        break;
      }
      case "message_end": {
        captured = top(["type"]);
        const outer = selectedTop(["message"]);
        const message = outer && captureNormalizedMessage(outer.message, budget, 1);
        if (!captured || !message) return null;
        defineCaptured(captured, "message", message);
        break;
      }
      case "tool_execution_start": captured = top(["type", "toolCallId", "toolName"]); break;
      case "tool_execution_end": captured = top(["type", "toolCallId"]); break;
      case "queue_update": captured = top(["type", "steering", "followUp"]); break;
      case "auto_retry_start": captured = top(["type", "attempt", "maxAttempts", "errorMessage"]); break;
      case "auto_retry_end": captured = top(["type"]); break;
      case "compaction_start": case "auto_compaction_start": captured = top(["type", "reason"]); break;
      case "compaction_end": case "auto_compaction_end": {
        captured = top(["type", "reason", "aborted", "willRetry", "errorMessage"]);
        const outer = selectedTop(["result"]);
        if (!captured || !outer) return null;
        if (outer.result !== undefined) {
          const capturedResult = capturePickedRecord(outer.result, ["tokensBefore", "estimatedTokensAfter"], budget, 1, "select");
          if (!capturedResult) return null;
          defineCaptured(captured, "result", capturedResult);
        }
        break;
      }
      case "prompt_error": captured = top(["type", "errorMessage"]); break;
      case "extension_error": captured = top(["type", "error"]); break;
      case "extension_ui_request": captured = captureExtensionInput(source, budget); break;
      default: {
        if (!claimCaptureNode(budget, 0)) return null;
        captured = Object.create(null) as Record<string, unknown>;
        defineCaptured(captured, "type", "__unknown_session_input__");
        break;
      }
    }
    if (!captured) return null;
    // Selected traversal and the actual queued graph share the same configured
    // limits. This one strict reconstruction catches output-node expansion,
    // aliases, cycles, and depth before enqueueing anything.
    const canonical = cloneJsonSafe(captured, canonicalNodeLimit, canonicalDepthLimit);
    return object(canonical)
      ? canonical as SessionProjectionInput | { type: string; [key: string]: unknown }
      : null;
  } catch { return null; }
}

function exactRecord(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const activeDiagnosticSinks = new WeakSet<ProjectionDiagnosticSink>();
function safeDiagnostic(sink: ProjectionDiagnosticSink | undefined, diagnostic: ProjectionDiagnostic): void {
  if (!sink || activeDiagnosticSinks.has(sink)) return;
  activeDiagnosticSinks.add(sink);
  try { sink(diagnostic); } catch { /* diagnostics cannot affect projection */ }
  finally { activeDiagnosticSinks.delete(sink); }
}

function normalizeToolCall(value: unknown): ToolCallContent | null {
  const budget: CaptureBudget = {
    nodes: 0,
    nodeLimit: DEFAULT_SESSION_STATE_NODES,
    depthLimit: DEFAULT_SESSION_STATE_DEPTH,
    seen: new Set(),
  };
  const captured = captureNormalizedToolCall(value, budget, 0);
  if (!captured) return null;
  const parsed = parseNormalizedMessage({ role: "assistant", model: "", provider: "", content: [captured] });
  return parsed?.role === "assistant" && parsed.content[0]?.type === "toolCall" ? parsed.content[0] : null;
}

/** Normalize only fields consumed by Pi Web rendering/reconciliation. */
export function normalizeProjectedMessage(input: unknown): AgentMessage | null {
  const budget: CaptureBudget = {
    nodes: 0,
    nodeLimit: DEFAULT_SESSION_STATE_NODES,
    depthLimit: DEFAULT_SESSION_STATE_DEPTH,
    seen: new Set(),
  };
  const captured = captureNormalizedMessage(input, budget, 0);
  if (!captured || !("content" in captured)) return null;
  return parseNormalizedMessage(captured);
}

function messageRole(value: unknown): string | null {
  const discriminated = inspectDiscriminant(value, "role");
  return discriminated ? discriminated.values.role as string : null;
}

function finalComparable(message: AssistantMessage): unknown[] {
  const comparable: unknown[] = [];
  message.content.forEach((block, contentIndex) => {
    if (block.type === "text") comparable.push({ contentIndex, type: "text", text: block.text });
    else if (block.type === "thinking") comparable.push({ contentIndex, type: "thinking", thinking: block.thinking });
    else if (block.type === "toolCall") comparable.push({ contentIndex, type: "toolCall", toolCallId: block.toolCallId, toolName: block.toolName, input: block.input });
  });
  return comparable;
}

function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => canonicalJsonEqual(item, right[index]));
  }
  if (!object(left) || !object(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && canonicalJsonEqual(left[key], right[key]));
}

function draftComparable(draft: ProjectedAssistantDraft): unknown[] | null {
  const comparable: unknown[] = [];
  for (const block of draft.blocks) {
    if (block.type === "text") comparable.push({ contentIndex: block.contentIndex, type: "text", text: block.text });
    else if (block.type === "thinking") comparable.push({ contentIndex: block.contentIndex, type: "thinking", thinking: block.thinking });
    else {
      if (!block.toolCall || block.argumentsText.length === 0) return null;
      let streamedInput: unknown;
      try { streamedInput = JSON.parse(block.argumentsText); } catch { return null; }
      const canonicalInput = cloneJsonSafe(streamedInput);
      if (!object(canonicalInput) || !canonicalJsonEqual(canonicalInput, block.toolCall.input)) return null;
      comparable.push({
        contentIndex: block.contentIndex,
        type: "toolCall",
        toolCallId: block.toolCall.toolCallId,
        toolName: block.toolCall.toolName,
        input: canonicalInput,
      });
    }
  }
  return comparable;
}

export function compareAssistantDeltaSubset(draft: ProjectedAssistantDraft | null, message: AssistantMessage): "equal" | "mismatch" | "not_comparable" {
  if (!draft) return "not_comparable";
  const comparable = draftComparable(draft);
  return comparable !== null && canonicalJsonEqual(comparable, finalComparable(message)) ? "equal" : "mismatch";
}

function validIgnoredAssistant(value: unknown): boolean {
  const message = inspectDataRecord(value);
  return !!message && message.role === "assistant" && string(message.model) && string(message.provider) && Array.isArray(message.content);
}

function projectAssistantEvent(event: Record<string, unknown>): ProjectedSessionFrameDraft[] | null {
  switch (event.type) {
    case "start": return exactRecord(event, ["type", "partial"]) && validIgnoredAssistant(event.partial) ? [] : null;
    case "text_start": return exactRecord(event, ["type", "contentIndex", "partial"]) && safeInt(event.contentIndex) && validIgnoredAssistant(event.partial) ? [{ type: "content_block_started", contentIndex: event.contentIndex, blockType: "text" }] : null;
    case "text_delta": return exactRecord(event, ["type", "contentIndex", "delta", "partial"]) && safeInt(event.contentIndex) && string(event.delta) && validIgnoredAssistant(event.partial) ? [{ type: "content_delta", contentIndex: event.contentIndex, deltaType: "text", delta: event.delta }] : null;
    case "text_end": return exactRecord(event, ["type", "contentIndex", "content", "partial"]) && safeInt(event.contentIndex) && string(event.content) && validIgnoredAssistant(event.partial) ? [{ type: "content_block_finished", contentIndex: event.contentIndex, blockType: "text" }] : null;
    case "thinking_start": return exactRecord(event, ["type", "contentIndex", "partial"]) && safeInt(event.contentIndex) && validIgnoredAssistant(event.partial) ? [{ type: "content_block_started", contentIndex: event.contentIndex, blockType: "thinking" }] : null;
    case "thinking_delta": return exactRecord(event, ["type", "contentIndex", "delta", "partial"]) && safeInt(event.contentIndex) && string(event.delta) && validIgnoredAssistant(event.partial) ? [{ type: "content_delta", contentIndex: event.contentIndex, deltaType: "thinking", delta: event.delta }] : null;
    case "thinking_end": return exactRecord(event, ["type", "contentIndex", "content", "partial"]) && safeInt(event.contentIndex) && string(event.content) && validIgnoredAssistant(event.partial) ? [{ type: "content_block_finished", contentIndex: event.contentIndex, blockType: "thinking" }] : null;
    case "toolcall_start": return exactRecord(event, ["type", "contentIndex", "partial"]) && safeInt(event.contentIndex) && validIgnoredAssistant(event.partial) ? [{ type: "content_block_started", contentIndex: event.contentIndex, blockType: "toolCall" }] : null;
    case "toolcall_delta": return exactRecord(event, ["type", "contentIndex", "delta", "partial"]) && safeInt(event.contentIndex) && string(event.delta) && validIgnoredAssistant(event.partial) ? [{ type: "content_delta", contentIndex: event.contentIndex, deltaType: "tool_arguments", delta: event.delta }] : null;
    case "toolcall_end": {
      if (!exactRecord(event, ["type", "contentIndex", "toolCall", "partial"]) || !safeInt(event.contentIndex) || !validIgnoredAssistant(event.partial)) return null;
      const toolCall = normalizeToolCall(event.toolCall);
      return toolCall ? [{ type: "content_block_finished", contentIndex: event.contentIndex, blockType: "toolCall", toolCall }] : null;
    }
    case "done": return exactRecord(event, ["type", "reason", "message"]) && ["stop", "length", "toolUse"].includes(event.reason as string) && validIgnoredAssistant(event.message) ? [{ type: "assistant_terminal", reason: event.reason as "stop" | "length" | "toolUse" }] : null;
    case "error": return exactRecord(event, ["type", "reason", "error"]) && ["error", "aborted"].includes(event.reason as string) && validIgnoredAssistant(event.error) ? [{ type: "assistant_terminal", reason: event.reason as "error" | "aborted" }] : null;
    default: return null;
  }
}
function assertNever(value: never): never {
  throw new Error(`unhandled_projector_variant:${typeof value}`);
}

function normalizeCompactionReason(value: unknown): "manual" | "threshold" | "overflow" {
  return value === "manual" || value === "threshold" || value === "overflow" ? value : "threshold";
}
function compactionFinished(event: Record<string, unknown>): ProjectedSessionFrameDraft | null {
  if (!(["manual", "threshold", "overflow"].includes(event.reason as string)) || typeof event.aborted !== "boolean") return null;
  const result = event.result === undefined
    ? null
    : inspectSelectedDataFields(event.result, ["tokensBefore", "estimatedTokensAfter"])?.values ?? null;
  if (event.result !== undefined && !result) return null;
  if (result && result.tokensBefore !== undefined && !safeInt(result.tokensBefore)) return null;
  if (result && result.estimatedTokensAfter !== undefined && !safeInt(result.estimatedTokensAfter)) return null;
  if (event.errorMessage !== undefined && !string(event.errorMessage)) return null;
  return {
    type: "compaction_finished",
    reason: event.reason as "manual" | "threshold" | "overflow",
    aborted: event.aborted,
    ...(string(event.errorMessage) ? { errorMessage: event.errorMessage } : {}),
    ...(result && safeInt(result.tokensBefore) ? { tokensBefore: result.tokensBefore } : {}),
    ...(result && safeInt(result.estimatedTokensAfter) ? { estimatedTokensAfter: result.estimatedTokensAfter } : {}),
  };
}

/** One structural result governs both current compaction projection and lifecycle. */
function currentCompactionFinished(event: Record<string, unknown>): ProjectedSessionFrameDraft | null {
  return typeof event.willRetry === "boolean" ? compactionFinished(event) : null;
}

export type AcceptedNativeLifecycleInput =
  | { kind: "agent_start" }
  | { kind: "agent_end" }
  | { kind: "agent_settled" }
  | { kind: "manual_compaction_start" }
  | { kind: "manual_compaction_end" };

/**
 * Classify lifecycle only from the already captured canonical input, using the
 * same exact semantic requirements as projection. Raw caller objects must never
 * be inspected a second time for lifecycle mutation.
 */
export function classifyAcceptedNativeLifecycleInput(input: unknown): AcceptedNativeLifecycleInput | null {
  const record = inspectDataRecord(input);
  if (!record || !string(record.type)) return null;
  switch (record.type) {
    case "agent_start": return exactRecord(record, ["type"]) ? { kind: "agent_start" } : null;
    case "agent_end": return exactRecord(record, ["type", "willRetry"]) && typeof record.willRetry === "boolean" ? { kind: "agent_end" } : null;
    case "agent_settled": return exactRecord(record, ["type"]) ? { kind: "agent_settled" } : null;
    case "compaction_start": return exactRecord(record, ["type", "reason"]) && record.reason === "manual" ? { kind: "manual_compaction_start" } : null;
    case "auto_compaction_start": return exactRecord(record, ["type", "reason"]) && record.reason === "manual" ? { kind: "manual_compaction_start" } : null;
    case "compaction_end": return record.reason === "manual" && currentCompactionFinished(record)
      ? { kind: "manual_compaction_end" }
      : null;
    case "auto_compaction_end": {
      if (record.reason !== "manual") return null;
      const normalized = { ...record, reason: "manual", aborted: record.aborted === true };
      return compactionFinished(normalized) ? { kind: "manual_compaction_end" } : null;
    }
    default: return null;
  }
}

function projectExtension(event: Record<string, unknown>): ProjectedSessionFrameDraft[] | null {
  if (!string(event.method)) return null;
  if (["select", "confirm", "input", "editor"].includes(event.method)) {
    if (!string(event.id) || !string(event.title)) return null;
    let dialog: ProjectedDialog | null = null;
    const options = cloneJsonSafe(event.options);
    if (event.method === "select" && Array.isArray(options) && options.every(string)) dialog = { id: event.id, method: "select", title: event.title, options };
    else if (event.method === "confirm" && string(event.message)) dialog = { id: event.id, method: "confirm", title: event.title, message: event.message };
    else if (event.method === "input" && (event.placeholder === undefined || string(event.placeholder))) dialog = { id: event.id, method: "input", title: event.title, ...(string(event.placeholder) ? { placeholder: event.placeholder } : {}) };
    else if (event.method === "editor" && (event.prefill === undefined || string(event.prefill))) dialog = { id: event.id, method: "editor", title: event.title, ...(string(event.prefill) ? { prefill: event.prefill } : {}) };
    if (!dialog) return null;
    if (safeInt(event.timeout)) dialog.timeout = event.timeout;
    if (finite(event.expiresAt)) dialog.expiresAt = event.expiresAt;
    return [{ type: "extension_dialog_opened", dialog }];
  }
  switch (event.method) {
    case "notify": return string(event.message) ? [{ type: "notice", level: event.notifyType === "warning" || event.notifyType === "error" ? event.notifyType : "info", message: event.message }] : null;
    case "setStatus": return string(event.statusKey) && (event.statusText === undefined || string(event.statusText)) ? [string(event.statusText) ? { type: "extension_status_set", key: event.statusKey, text: event.statusText } : { type: "extension_status_cleared", key: event.statusKey }] : null;
    case "setWidget": {
      if (!string(event.widgetKey)) return null;
      if (event.widgetLines === undefined) return [{ type: "extension_widget_cleared", key: event.widgetKey }];
      const lines = cloneJsonSafe(event.widgetLines);
      return Array.isArray(lines) && lines.every(string)
        ? [{ type: "extension_widget_set", key: event.widgetKey, lines, placement: event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor" }]
        : null;
    }
    case "setTitle": return string(event.title) ? [{ type: "extension_title_set", title: event.title }] : null;
    case "set_editor_text": return string(event.text) ? [{ type: "editor_inserted", text: event.text }] : null;
    case "custom": {
      if (!string(event.id)) return null;
      if (event.closed === true) return [{ type: "extension_custom_closed", id: event.id }];
      const lines = cloneJsonSafe(event.lines);
      return Array.isArray(lines) && lines.every(string) ? [{ type: "extension_custom_replaced", id: event.id, lines }] : null;
    }
    default: return [];
  }
}

export function projectSessionInput(
  input: SessionProjectionInput | { type: string; [key: string]: unknown },
  state: ProjectedSessionState,
  diagnostic?: ProjectionDiagnosticSink,
  onProjectionOutcome?: (accepted: boolean) => void,
): ProjectedSessionFrameDraft[] {
  let projectionAccepted = true;
  const rejectProjection = (): void => { projectionAccepted = false; };
  const emitDiagnostic = (outcome: ProjectionDiagnostic["outcome"], inputClass: ProjectionDiagnostic["inputClass"]) => safeDiagnostic(diagnostic, { kind: "input", outcome, inputClass });
  const malformed = (inputClass: ProjectionDiagnostic["inputClass"]): ProjectedSessionFrameDraft[] => {
    rejectProjection();
    emitDiagnostic("malformed", inputClass);
    return [];
  };
  try {
    const record = inspectDataRecord(input);
    if (!record || !string(record.type)) return malformed("unknown");
    if (isInstalledAgentEvent(record as { type: string })) classifyInstalledAgentEvent(record as AgentSessionEvent);
    switch (record.type) {
      case "wrapper_activity_started": return record.activity === "prompt" || record.activity === "compaction" ? [{ type: "activity_started", activity: record.activity }] : malformed("wrapper");
      case "wrapper_settled": return [{ type: "run_settled" }];
      case "extension_dialog_closed": return string(record.id) ? [{ type: "extension_dialog_closed", id: record.id }] : malformed("wrapper");
      case "extension_status_cleared": return string(record.key) ? [{ type: "extension_status_cleared", key: record.key }] : malformed("wrapper");
      case "extension_widget_cleared": return string(record.key) ? [{ type: "extension_widget_cleared", key: record.key }] : malformed("wrapper");
      case "agent_start": return [{ type: "activity_started", activity: "native" }];
      case "agent_end": return typeof record.willRetry === "boolean" ? [{ type: "attempt_ended", willRetry: record.willRetry }] : malformed("native");
      case "agent_settled": return [{ type: "native_settled" }];
      case "message_start": {
        const message = inspectDataRecord(record.message);
        if (!message || message.role !== "assistant" || !string(message.model) || !string(message.provider) || (message.timestamp !== undefined && !finite(message.timestamp))) return malformed("message");
        return [{ type: "assistant_message_started", metadata: { role: "assistant", model: message.model, provider: message.provider, ...(finite(message.timestamp) ? { timestamp: message.timestamp } : {}) } }];
      }
      case "message_update": {
        const event = inspectDataRecord(record.assistantMessageEvent);
        if (!event || !string(event.type)) return malformed("assistant");
        if (!Object.prototype.hasOwnProperty.call(KNOWN_ASSISTANT_EVENT_TYPES, event.type)) {
          rejectProjection();
          emitDiagnostic("unknown", "assistant");
          return [];
        }
        const frames = projectAssistantEvent(event);
        if (frames === null) return malformed("assistant");
        emitDiagnostic(frames.length ? "projected" : "omitted", "assistant");
        return frames;
      }
      case "message_end": {
        const role = messageRole(record.message);
        if (role === "bashExecution" || role === "branchSummary" || role === "compactionSummary") {
          emitDiagnostic("omitted", "message");
          return [{ type: "transcript_changed" }, { type: "runtime_refresh_required" }];
        }
        const message = normalizeProjectedMessage(record.message);
        if (!message) return malformed("message");
        if (message.role === "assistant") {
          const outcome = compareAssistantDeltaSubset(state.draft, message);
          safeDiagnostic(diagnostic, { kind: "final_equality", outcome, inputClass: "assistant" });
        }
        return [{ type: "message_completed", message }];
      }
      case "tool_execution_start": return string(record.toolCallId) && string(record.toolName) ? [{ type: "tool_started", toolCallId: record.toolCallId, toolName: record.toolName }] : malformed("native");
      case "tool_execution_end": return string(record.toolCallId) ? [{ type: "tool_finished", toolCallId: record.toolCallId }] : malformed("native");
      case "tool_execution_update": emitDiagnostic("omitted", "native"); return [];
      case "queue_update": {
        const steering = cloneJsonSafe(record.steering);
        const followUp = cloneJsonSafe(record.followUp);
        return Array.isArray(steering) && steering.every(string) && Array.isArray(followUp) && followUp.every(string)
          ? [{ type: "queue_replaced", steering, followUp }]
          : malformed("native");
      }
      case "auto_retry_start": return safeInt(record.attempt) && safeInt(record.maxAttempts) && (record.errorMessage === undefined || string(record.errorMessage))
        ? [{ type: "retry_started", attempt: record.attempt, maxAttempts: record.maxAttempts, ...(string(record.errorMessage) ? { errorMessage: record.errorMessage } : {}) }]
        : malformed("native");
      case "auto_retry_end": return [{ type: "retry_finished" }];
      case "compaction_start": return ["manual", "threshold", "overflow"].includes(record.reason as string)
        ? [{ type: "compaction_started", reason: record.reason as "manual" | "threshold" | "overflow" }]
        : malformed("native");
      case "auto_compaction_start": return record.reason === undefined || ["manual", "threshold", "overflow"].includes(record.reason as string)
        ? [{ type: "compaction_started", reason: normalizeCompactionReason(record.reason) }]
        : malformed("native");
      case "compaction_end": {
        const frame = currentCompactionFinished(record);
        return frame ? [frame] : malformed("native");
      }
      case "auto_compaction_end": {
        const frame = compactionFinished({ ...record, reason: normalizeCompactionReason(record.reason), aborted: record.aborted === true });
        return frame ? [frame] : malformed("native");
      }
      case "entry_appended": return [{ type: "transcript_changed" }];
      case "session_info_changed": case "thinking_level_changed": return [{ type: "runtime_refresh_required" }];
      case "turn_start": case "turn_end": case "summarization_retry_scheduled": case "summarization_retry_attempt_start": case "summarization_retry_finished": case "bash_execution_update": case "prompt_done": emitDiagnostic("omitted", "native"); return [];
      case "prompt_error": return record.errorMessage === undefined || string(record.errorMessage) ? [{ type: "notice", level: "error", message: string(record.errorMessage) ? record.errorMessage : "Command failed" }] : malformed("wrapper");
      case "extension_error": return record.error === undefined || string(record.error) ? [{ type: "notice", level: "error", message: string(record.error) ? record.error : "Extension command failed" }] : malformed("extension");
      case "extension_ui_request": {
        const frames = projectExtension(record);
        if (frames === null) return malformed("extension");
        if (record.method === "__unknown_extension_method__") rejectProjection();
        emitDiagnostic(frames.length ? "projected" : "omitted", "extension");
        return frames;
      }
      default: rejectProjection(); emitDiagnostic("unknown", "unknown"); return [];
    }
  } catch {
    return malformed("unknown");
  } finally {
    try { onProjectionOutcome?.(projectionAccepted); } catch { /* internal outcome reporting cannot affect projection */ }
  }
}
