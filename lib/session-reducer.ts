import {
  DEFAULT_SESSION_SNAPSHOT_UNIT_BYTES,
  PROJECTED_SESSION_PROTOCOL,
  PROJECTED_SESSION_VERSION,
  createInitialProjectedSessionState,
  encodeProjectedSessionFrame,
  freezeCanonicalData,
  isDeeplyFrozenCanonicalData,
  parseProjectedSessionFrame,
  parseProjectedSessionState,
  resolveProjectedSessionStateLimits,
  type ProjectedAssistantDraft,
  type ProjectedDraftBlock,
  type ProjectedSessionEffect,
  type ProjectedSessionFrame,
  type ProjectedSessionFrameDraft,
  type ProjectedSessionLogicalFrame,
  type ProjectedSessionState,
  type ProjectedSessionStateLimits,
  type SnapshotStartFrame,
  type SnapshotTransferFrame,
} from "./session-protocol";

export type ReductionResult = { state: ProjectedSessionState; effect?: ProjectedSessionEffect };

function cloneState(state: ProjectedSessionState, limits: Partial<ProjectedSessionStateLimits> = {}): ProjectedSessionState {
  const parsed = parseProjectedSessionState(state, limits);
  if (!parsed) throw new Error("invalid_projected_session_state");
  return parsed;
}

function locateOrdered<T>(items: readonly T[], compare: (item: T) => number): { index: number; found: boolean } {
  if (items.length > 0) {
    const lastIndex = items.length - 1;
    const lastComparison = compare(items[lastIndex]);
    if (lastComparison === 0) return { index: lastIndex, found: true };
    if (lastComparison < 0) return { index: items.length, found: false };
  }
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const comparison = compare(items[middle]);
    if (comparison === 0) return { index: middle, found: true };
    if (comparison < 0) low = middle + 1;
    else high = middle - 1;
  }
  return { index: low, found: false };
}
function copyAt<T>(items: readonly T[], index: number, item: T, replace: boolean): T[] {
  return [...items.slice(0, index), item, ...items.slice(index + (replace ? 1 : 0))];
}
function replaceKey<T extends { key: string }>(items: T[], item: T): T[] {
  const located = locateOrdered(items, (current) => current.key < item.key ? -1 : current.key > item.key ? 1 : 0);
  return copyAt(items, located.index, item, located.found);
}
function removeKey<T extends { key: string }>(items: T[], key: string): T[] {
  const located = locateOrdered(items, (current) => current.key < key ? -1 : current.key > key ? 1 : 0);
  return located.found ? [...items.slice(0, located.index), ...items.slice(located.index + 1)] : items;
}
function locateDraftBlock(draft: ProjectedAssistantDraft, contentIndex: number): { index: number; found: boolean } {
  return locateOrdered(draft.blocks, (item) => item.contentIndex - contentIndex);
}
function withDraftBlock(draft: ProjectedAssistantDraft, block: ProjectedDraftBlock): ProjectedAssistantDraft {
  const located = locateDraftBlock(draft, block.contentIndex);
  return { ...draft, blocks: copyAt(draft.blocks, located.index, block, located.found) };
}
function findDraftBlock(draft: ProjectedAssistantDraft, contentIndex: number): ProjectedDraftBlock | undefined {
  const located = locateDraftBlock(draft, contentIndex);
  return located.found ? draft.blocks[located.index] : undefined;
}

export type CanonicalStateMetrics = { depth: number; nodes: number; bytes: number };

// Structural reducer copies let this weak cache retain exact metrics for every
// unchanged branch. Routine text/thinking/tool deltas visit only the shallow
// state spine plus the changed draft branch rather than the growing state.
const canonicalStateMetricCache = new WeakMap<object, CanonicalStateMetrics>();
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const jsonStringBytes = (value: string): number => utf8Bytes(JSON.stringify(value));

function appendedJsonStringBytes(previous: string, delta: string, previousBytes: number): number {
  let bytes = previousBytes + jsonStringBytes(delta) - 2;
  if (previous.length > 0 && delta.length > 0) {
    const last = previous.charCodeAt(previous.length - 1);
    const first = delta.charCodeAt(0);
    if (last >= 0xd800 && last <= 0xdbff && first >= 0xdc00 && first <= 0xdfff) bytes -= 8;
  }
  return bytes;
}

function measureCanonicalValue(value: unknown): CanonicalStateMetrics {
  if (value === null || typeof value !== "object") return { depth: 0, nodes: 1, bytes: utf8Bytes(JSON.stringify(value)) };
  const cached = canonicalStateMetricCache.get(value);
  if (cached) return cached;
  let depth = 0;
  let nodes = 1;
  let bytes = 2;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const measured = measureCanonicalValue(value[index]);
      depth = Math.max(depth, measured.depth + 1);
      nodes += measured.nodes;
      bytes += measured.bytes + (index === 0 ? 0 : 1);
    }
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    for (let index = 0; index < entries.length; index += 1) {
      const [key, nested] = entries[index];
      const measured = measureCanonicalValue(nested);
      depth = Math.max(depth, measured.depth + 1);
      nodes += measured.nodes;
      bytes += jsonStringBytes(key) + 1 + measured.bytes + (index === 0 ? 0 : 1);
    }
  }
  const result = Object.freeze({ depth, nodes, bytes });
  if (isDeeplyFrozenCanonicalData(value)) canonicalStateMetricCache.set(value, result);
  return result;
}

function stateDraftBlock(
  state: ProjectedSessionState,
  contentIndex: number,
): NonNullable<ProjectedSessionState["draft"]>["blocks"][number] | undefined {
  return state.draft?.blocks.find((block) => block.contentIndex === contentIndex);
}

function objectPropertyBytes(value: Record<string, unknown>, property: string, metrics: CanonicalStateMetrics): number | null {
  const entries = Object.entries(value);
  if (!Object.prototype.hasOwnProperty.call(value, property)) return null;
  let otherBytes = 2 + Math.max(0, entries.length - 1);
  for (const [key, nested] of entries) {
    if (key === property) continue;
    otherBytes += jsonStringBytes(key) + 1 + measureCanonicalValue(nested).bytes;
  }
  return metrics.bytes - otherBytes - jsonStringBytes(property) - 1;
}

function seedAppendedBlockMetrics(
  previous: ProjectedSessionState,
  next: ProjectedSessionState,
  frame: ProjectedSessionFrameDraft | ProjectedSessionLogicalFrame,
): void {
  if (frame.type !== "content_delta") return;
  const oldBlock = stateDraftBlock(previous, frame.contentIndex);
  const newBlock = stateDraftBlock(next, frame.contentIndex);
  if (!oldBlock || !newBlock || oldBlock.type !== newBlock.type) return;
  const oldText = oldBlock.type === "text" ? oldBlock.text : oldBlock.type === "thinking" ? oldBlock.thinking : oldBlock.argumentsText;
  const oldMetrics = measureCanonicalValue(oldBlock);
  const textProperty = oldBlock.type === "text" ? "text" : oldBlock.type === "thinking" ? "thinking" : "argumentsText";
  const oldTextBytes = objectPropertyBytes(oldBlock, textProperty, oldMetrics);
  if (oldTextBytes === null) return;
  const newTextBytes = appendedJsonStringBytes(oldText, frame.delta, oldTextBytes);
  const newBlockMetrics = Object.freeze({ depth: oldMetrics.depth, nodes: oldMetrics.nodes, bytes: oldMetrics.bytes - oldTextBytes + newTextBytes });
  if (isDeeplyFrozenCanonicalData(newBlock)) canonicalStateMetricCache.set(newBlock, newBlockMetrics);

  const oldBlocks = previous.draft?.blocks;
  const newBlocks = next.draft?.blocks;
  if (!oldBlocks || !newBlocks || oldBlocks.length !== newBlocks.length || !isDeeplyFrozenCanonicalData(newBlocks)) return;
  const oldBlocksMetrics = measureCanonicalValue(oldBlocks);
  canonicalStateMetricCache.set(newBlocks, Object.freeze({
    depth: oldBlocksMetrics.depth,
    nodes: oldBlocksMetrics.nodes,
    bytes: oldBlocksMetrics.bytes - oldMetrics.bytes + newBlockMetrics.bytes,
  }));
}

export function measureProjectedSessionState(state: ProjectedSessionState): CanonicalStateMetrics {
  return measureCanonicalValue(state);
}

export function freezeProjectedSessionTransition(state: ProjectedSessionState): ProjectedSessionState {
  // Published previous branches are already frozen, so traversal stops at every
  // structurally shared branch and visits only newly allocated reducer output.
  return freezeCanonicalData(state);
}

export function measureProjectedSessionTransition(
  previous: ProjectedSessionState,
  next: ProjectedSessionState,
  frame: ProjectedSessionFrameDraft | ProjectedSessionLogicalFrame,
): CanonicalStateMetrics {
  seedAppendedBlockMetrics(previous, next, frame);
  return measureCanonicalValue(next);
}

/** Maximum raw bytes in one bounded snapshot chunk unit. */
export function snapshotRawChunkSize(
  streamEpoch: string,
  byteLength: number,
  encodedSnapshotUnitByteLimit: number,
  transferId: string,
): number {
  const template = {
    protocol: PROJECTED_SESSION_PROTOCOL,
    version: PROJECTED_SESSION_VERSION,
    streamEpoch,
    sequence: Number.MAX_SAFE_INTEGER,
    type: "snapshot_chunk",
    transferId,
    partIndex: Math.max(0, byteLength - 1),
    data: "",
  };
  const capacity = encodedSnapshotUnitByteLimit - utf8Bytes(JSON.stringify(template));
  if (capacity < 2) return 0;
  let low = 1;
  let high = Math.max(1, Math.floor(capacity * 3 / 4));
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (Math.floor((middle * 4 + 2) / 3) <= capacity) { result = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return result;
}

/** Shared hub/receiver aggregate and snapshot-transfer representability rule. */
export function isProjectedSessionStateRepresentable(
  metrics: CanonicalStateMetrics,
  limits: ProjectedSessionStateLimits,
  encodedSnapshotUnitByteLimit: number,
  streamEpoch: string,
): boolean {
  if (metrics.depth > limits.canonicalDepthLimit || metrics.nodes > limits.canonicalNodeLimit || metrics.bytes > limits.snapshotByteLimit) return false;
  const transferId = "00000000-0000-4000-8000-000000000000";
  const rawChunkSize = snapshotRawChunkSize(streamEpoch, metrics.bytes, encodedSnapshotUnitByteLimit, transferId);
  if (rawChunkSize === 0) return false;
  const partCount = Math.ceil(metrics.bytes / rawChunkSize);
  if (partCount <= 0 || partCount > limits.snapshotPartLimit) return false;
  const start: SnapshotStartFrame = {
    protocol: PROJECTED_SESSION_PROTOCOL,
    version: PROJECTED_SESSION_VERSION,
    streamEpoch,
    sequence: Number.MAX_SAFE_INTEGER,
    type: "snapshot_start",
    transferId,
    reason: "recovery",
    partCount,
    byteLength: metrics.bytes,
    transcriptRefreshRequired: true,
    runtimeRefreshRequired: true,
  };
  const end: SnapshotTransferFrame = {
    protocol: PROJECTED_SESSION_PROTOCOL,
    version: PROJECTED_SESSION_VERSION,
    streamEpoch,
    sequence: Number.MAX_SAFE_INTEGER,
    type: "snapshot_end",
    transferId,
  };
  try {
    return utf8Bytes(encodeProjectedSessionFrame(start)) <= encodedSnapshotUnitByteLimit
      && utf8Bytes(encodeProjectedSessionFrame(end)) <= encodedSnapshotUnitByteLimit;
  } catch { return false; }
}

/** Every accepted live state reserves enough aggregate/transfer budget for forced finality. */
export function isProjectedSessionStateWithSettlementRepresentable(
  state: ProjectedSessionState,
  metrics: CanonicalStateMetrics,
  limits: ProjectedSessionStateLimits,
  encodedSnapshotUnitByteLimit: number,
  streamEpoch: string,
): boolean {
  if (!isProjectedSessionStateRepresentable(metrics, limits, encodedSnapshotUnitByteLimit, streamEpoch)) return false;
  const settled = freezeProjectedSessionTransition(reduceProjectedSessionFrame(state, { type: "run_settled" }).state);
  const settledMetrics = measureProjectedSessionTransition(state, settled, { type: "run_settled" });
  return isProjectedSessionStateRepresentable(settledMetrics, limits, encodedSnapshotUnitByteLimit, streamEpoch);
}

export function canReduceProjectedSessionFrame(
  previous: ProjectedSessionState,
  frame: ProjectedSessionFrameDraft | ProjectedSessionLogicalFrame,
): boolean {
  return (frame.type !== "message_completed" && frame.type !== "transcript_changed")
    || previous.transcriptRevision < Number.MAX_SAFE_INTEGER;
}

/** Pure canonical reduction with structural copies only along changed branches. */
export function reduceProjectedSessionFrame(
  previous: ProjectedSessionState,
  frame: ProjectedSessionFrameDraft | ProjectedSessionLogicalFrame,
): ReductionResult {
  switch (frame.type) {
    case "activity_started": return { state: { ...previous, active: true, nativeSettled: false } };
    case "attempt_ended": return { state: frame.willRetry ? { ...previous, active: true } : previous };
    case "native_settled": return { state: { ...previous, nativeSettled: true } };
    case "run_settled": return { state: {
      ...previous,
      active: false,
      nativeSettled: true,
      draft: null,
      activeTools: [],
      retry: null,
      compaction: previous.compaction?.active ? { ...previous.compaction, active: false } : previous.compaction,
      transcriptRefreshRequired: true,
      runtimeRefreshRequired: true,
    } };
    case "assistant_message_started": return { state: { ...previous, draft: { metadata: { ...frame.metadata }, blocks: [] } } };
    case "content_block_started": {
      if (!previous.draft) return { state: previous };
      const block: ProjectedDraftBlock = frame.blockType === "text"
        ? { contentIndex: frame.contentIndex, type: "text", text: "" }
        : frame.blockType === "thinking"
          ? { contentIndex: frame.contentIndex, type: "thinking", thinking: "" }
          : { contentIndex: frame.contentIndex, type: "toolCall", argumentsText: "" };
      return { state: { ...previous, draft: withDraftBlock(previous.draft, block) } };
    }
    case "content_delta": {
      if (!previous.draft) return { state: previous };
      const current = findDraftBlock(previous.draft, frame.contentIndex);
      const block: ProjectedDraftBlock = frame.deltaType === "text"
        ? { contentIndex: frame.contentIndex, type: "text", text: (current?.type === "text" ? current.text : "") + frame.delta }
        : frame.deltaType === "thinking"
          ? { contentIndex: frame.contentIndex, type: "thinking", thinking: (current?.type === "thinking" ? current.thinking : "") + frame.delta }
          : { contentIndex: frame.contentIndex, type: "toolCall", argumentsText: (current?.type === "toolCall" ? current.argumentsText : "") + frame.delta, ...(current?.type === "toolCall" && current.toolCall ? { toolCall: current.toolCall } : {}) };
      return { state: { ...previous, draft: withDraftBlock(previous.draft, block) } };
    }
    case "content_block_finished": {
      if (!previous.draft || frame.blockType !== "toolCall" || !frame.toolCall) return { state: previous };
      const current = findDraftBlock(previous.draft, frame.contentIndex);
      return { state: { ...previous, draft: withDraftBlock(previous.draft, {
        contentIndex: frame.contentIndex,
        type: "toolCall",
        argumentsText: current?.type === "toolCall" ? current.argumentsText : "",
        toolCall: frame.toolCall,
      }) } };
    }
    case "assistant_terminal": return { state: previous.draft ? { ...previous, draft: { ...previous.draft, terminalReason: frame.reason } } : previous };
    case "message_completed": return {
      state: { ...previous, draft: null, transcriptRevision: previous.transcriptRevision + 1, transcriptRefreshRequired: true },
      effect: { type: "message_completed", message: frame.message },
    };
    case "tool_started": return { state: { ...previous, activeTools: [...previous.activeTools.filter((tool) => tool.toolCallId !== frame.toolCallId), { toolCallId: frame.toolCallId, toolName: frame.toolName }] } };
    case "tool_finished": return { state: { ...previous, activeTools: previous.activeTools.filter((tool) => tool.toolCallId !== frame.toolCallId) } };
    case "queue_replaced": return { state: { ...previous, queue: { steering: [...frame.steering], followUp: [...frame.followUp] } } };
    case "retry_started": return { state: { ...previous, retry: { attempt: frame.attempt, maxAttempts: frame.maxAttempts, ...(frame.errorMessage === undefined ? {} : { errorMessage: frame.errorMessage }) } } };
    case "retry_finished": return { state: { ...previous, retry: null } };
    case "compaction_started": return { state: { ...previous, active: true, nativeSettled: false, compaction: { active: true, reason: frame.reason } } };
    case "compaction_finished": return { state: {
      ...previous,
      compaction: {
        active: false,
        reason: frame.reason,
        aborted: frame.aborted,
        ...(frame.errorMessage === undefined ? {} : { errorMessage: frame.errorMessage }),
        ...(frame.tokensBefore === undefined ? {} : { tokensBefore: frame.tokensBefore }),
        ...(frame.estimatedTokensAfter === undefined ? {} : { estimatedTokensAfter: frame.estimatedTokensAfter }),
      },
      transcriptRefreshRequired: true,
      runtimeRefreshRequired: true,
    } };
    case "transcript_changed": return { state: { ...previous, transcriptRevision: previous.transcriptRevision + 1, transcriptRefreshRequired: true } };
    case "runtime_refresh_required": return { state: { ...previous, runtimeRefreshRequired: true } };
    case "extension_dialog_opened": return { state: { ...previous, dialogs: [...previous.dialogs.filter((item) => item.id !== frame.dialog.id), frame.dialog] } };
    case "extension_dialog_closed": return { state: { ...previous, dialogs: previous.dialogs.filter((item) => item.id !== frame.id) } };
    case "extension_custom_replaced": return { state: { ...previous, customUis: [...previous.customUis.filter((item) => item.id !== frame.id), { id: frame.id, lines: [...frame.lines] }] } };
    case "extension_custom_closed": return { state: { ...previous, customUis: previous.customUis.filter((item) => item.id !== frame.id) } };
    case "extension_status_set": return { state: { ...previous, statuses: replaceKey(previous.statuses, { key: frame.key, text: frame.text }) } };
    case "extension_status_cleared": return { state: { ...previous, statuses: removeKey(previous.statuses, frame.key) } };
    case "extension_widget_set": return { state: { ...previous, widgets: replaceKey(previous.widgets, { key: frame.key, lines: [...frame.lines], placement: frame.placement }) } };
    case "extension_widget_cleared": return { state: { ...previous, widgets: removeKey(previous.widgets, frame.key) } };
    case "extension_title_set": return { state: { ...previous, title: frame.title } };
    case "notice": return { state: previous, effect: { type: "notice", level: frame.level, message: frame.message } };
    case "editor_inserted": return { state: previous, effect: { type: "editor_inserted", text: frame.text } };
  }
}

type SnapshotChunkNode = { data: string; previous: SnapshotChunkNode | null };
export type SnapshotAssembly = {
  start: SnapshotStartFrame;
  tail: SnapshotChunkNode | null;
  partCount: number;
  decodedBytes: number;
  maximumDecodedChunkBytes: number;
};

export type SessionReceiver = {
  streamEpoch: string | null;
  cursor: number;
  state: ProjectedSessionState;
  stateMetrics: CanonicalStateMetrics;
  assembly: SnapshotAssembly | null;
  limits: { /** Snapshot transfer units only; ordinary logical frames have no S2 unit ceiling. */ encodedUnitByteLimit: number; canonicalDepthLimit: number; canonicalNodeLimit: number; snapshotByteLimit: number; snapshotPartLimit: number };
};

export type ReceiverApplyResult = {
  receiver: SessionReceiver;
  outcome: "applied" | "duplicate" | "gap" | "wrong_epoch" | "invalid" | "snapshot_pending" | "snapshot_applied";
  effect?: ProjectedSessionEffect;
};

export function createSessionReceiver(
  state = createInitialProjectedSessionState(),
  limits: Partial<SessionReceiver["limits"]> = {},
): SessionReceiver {
  const encodedUnitByteLimit = limits.encodedUnitByteLimit ?? DEFAULT_SESSION_SNAPSHOT_UNIT_BYTES;
  let stateLimits: ProjectedSessionStateLimits;
  try {
    stateLimits = resolveProjectedSessionStateLimits(limits);
  } catch {
    throw new Error("invalid_session_receiver_limits");
  }
  if (!Number.isSafeInteger(encodedUnitByteLimit) || encodedUnitByteLimit < 256) throw new Error("invalid_session_receiver_limits");
  const resolved = Object.freeze({ encodedUnitByteLimit, ...stateLimits });
  const canonical = freezeProjectedSessionTransition(cloneState(state, resolved));
  const stateMetrics = measureProjectedSessionState(canonical);
  // Snapshot part representability depends on the accepted stream epoch and is
  // checked at first logical-frame precommit or snapshot replacement.
  if (stateMetrics.depth > stateLimits.canonicalDepthLimit
    || stateMetrics.nodes > stateLimits.canonicalNodeLimit
    || stateMetrics.bytes > stateLimits.snapshotByteLimit) {
    throw new Error("invalid_session_receiver_state");
  }
  return immutableReceiver({ streamEpoch: null, cursor: 0, state: canonical, stateMetrics, assembly: null, limits: resolved });
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function decodeBase64Url(data: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(data) || data.length % 4 === 1) return null;
  const output = new Uint8Array(Math.floor(data.length * 6 / 8));
  let bits = 0;
  let bitCount = 0;
  let outputIndex = 0;
  for (const character of data) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    if (value < 0) return null;
    bits = (bits << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output[outputIndex] = (bits >> bitCount) & 0xff;
      outputIndex += 1;
    }
  }
  if (bitCount > 0 && (bits & ((1 << bitCount) - 1)) !== 0) return null;
  return outputIndex === output.length ? output : null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  let bits = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      output += BASE64URL_ALPHABET[(bits >> bitCount) & 0x3f];
    }
  }
  if (bitCount > 0) output += BASE64URL_ALPHABET[(bits << (6 - bitCount)) & 0x3f];
  return output;
}

function immutableReceiver(receiver: SessionReceiver): SessionReceiver {
  return freezeCanonicalData(receiver);
}

/** Strictly validates and atomically applies logical frames and snapshot transactions. */
export function applyProjectedSessionUnit(receiver: SessionReceiver, input: unknown): ReceiverApplyResult {
  const abandonAssembly = (): SessionReceiver => receiver.assembly ? immutableReceiver({ ...receiver, assembly: null }) : receiver;
  const invalidSnapshot = (): ReceiverApplyResult => ({ receiver: abandonAssembly(), outcome: "invalid" });
  const invalidOrdinary = (): ReceiverApplyResult => ({ receiver, outcome: "invalid" });
  const parsed = parseProjectedSessionFrame(input);
  if (!parsed.ok) return invalidSnapshot();
  const frame = parsed.frame;
  const snapshotUnit = frame.type === "snapshot_start" || frame.type === "snapshot_chunk" || frame.type === "snapshot_end";
  if (snapshotUnit) {
    let encodedBytes: number;
    try { encodedBytes = new TextEncoder().encode(encodeProjectedSessionFrame(frame)).byteLength; } catch { return invalidSnapshot(); }
    if (encodedBytes > receiver.limits.encodedUnitByteLimit) return invalidSnapshot();
  }

  if (frame.type === "snapshot_start") {
    if (receiver.streamEpoch === frame.streamEpoch && frame.sequence <= receiver.cursor) {
      return { receiver: abandonAssembly(), outcome: "duplicate" };
    }
    const maximumDecodedPerUnit = snapshotRawChunkSize(frame.streamEpoch, frame.byteLength, receiver.limits.encodedUnitByteLimit, frame.transferId);
    if (frame.partCount > receiver.limits.snapshotPartLimit
      || frame.byteLength <= 0
      || frame.byteLength > receiver.limits.snapshotByteLimit
      || frame.partCount > frame.byteLength
      || maximumDecodedPerUnit === 0
      || frame.byteLength > frame.partCount * maximumDecodedPerUnit) return invalidSnapshot();
    return { receiver: immutableReceiver({ ...receiver, assembly: { start: frame, tail: null, partCount: 0, decodedBytes: 0, maximumDecodedChunkBytes: maximumDecodedPerUnit } }), outcome: "snapshot_pending" };
  }
  if (frame.type === "snapshot_chunk") {
    const assembly = receiver.assembly;
    if (!assembly || frame.streamEpoch !== assembly.start.streamEpoch || frame.sequence !== assembly.start.sequence || frame.transferId !== assembly.start.transferId || frame.partIndex !== assembly.partCount || frame.partIndex >= assembly.start.partCount || frame.data.length === 0) return invalidSnapshot();
    const bytes = decodeBase64Url(frame.data);
    if (!bytes || encodeBase64Url(bytes) !== frame.data) return invalidSnapshot();
    const decodedBytes = assembly.decodedBytes + bytes.byteLength;
    const remainingParts = assembly.start.partCount - (assembly.partCount + 1);
    if (decodedBytes > assembly.start.byteLength || decodedBytes > receiver.limits.snapshotByteLimit
      || decodedBytes + remainingParts > assembly.start.byteLength
      || decodedBytes + remainingParts * assembly.maximumDecodedChunkBytes < assembly.start.byteLength) return invalidSnapshot();
    return {
      receiver: immutableReceiver({ ...receiver, assembly: { ...assembly, tail: { data: frame.data, previous: assembly.tail }, partCount: assembly.partCount + 1, decodedBytes } }),
      outcome: "snapshot_pending",
    };
  }
  if (frame.type === "snapshot_end") {
    const assembly = receiver.assembly;
    if (!assembly || frame.streamEpoch !== assembly.start.streamEpoch || frame.sequence !== assembly.start.sequence || frame.transferId !== assembly.start.transferId || assembly.partCount !== assembly.start.partCount || assembly.decodedBytes !== assembly.start.byteLength) return invalidSnapshot();
    const bytes = new Uint8Array(assembly.decodedBytes);
    let node = assembly.tail;
    let offset = bytes.byteLength;
    while (node) {
      const decodedChunk = decodeBase64Url(node.data);
      if (!decodedChunk || encodeBase64Url(decodedChunk) !== node.data) return invalidSnapshot();
      offset -= decodedChunk.byteLength;
      bytes.set(decodedChunk, offset);
      node = node.previous;
    }
    if (offset !== 0) return invalidSnapshot();
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return invalidSnapshot(); }
    const state = parseProjectedSessionState(decoded, receiver.limits);
    if (!state || state.transcriptRefreshRequired !== true || state.runtimeRefreshRequired !== true) return invalidSnapshot();
    const stateMetrics = measureProjectedSessionState(state);
    if (!isProjectedSessionStateWithSettlementRepresentable(state, stateMetrics, receiver.limits, receiver.limits.encodedUnitByteLimit, assembly.start.streamEpoch)) return invalidSnapshot();
    return {
      receiver: immutableReceiver({ ...receiver, streamEpoch: assembly.start.streamEpoch, cursor: assembly.start.sequence, state, stateMetrics, assembly: null }),
      outcome: "snapshot_applied",
    };
  }

  if (receiver.assembly) return invalidOrdinary();
  if (receiver.streamEpoch !== null && frame.streamEpoch !== receiver.streamEpoch) return { receiver, outcome: "wrong_epoch" };
  if (receiver.streamEpoch === null && frame.sequence !== 1) return { receiver, outcome: "gap" };
  if (frame.sequence <= receiver.cursor) return { receiver, outcome: "duplicate" };
  if (frame.sequence !== receiver.cursor + 1) return { receiver, outcome: "gap" };
  if (!canReduceProjectedSessionFrame(receiver.state, frame)) return invalidOrdinary();
  try {
    const reduced = reduceProjectedSessionFrame(receiver.state, frame);
    const state = freezeProjectedSessionTransition(reduced.state);
    const stateMetrics = measureProjectedSessionTransition(receiver.state, state, frame);
    if (!isProjectedSessionStateWithSettlementRepresentable(state, stateMetrics, receiver.limits, receiver.limits.encodedUnitByteLimit, frame.streamEpoch)) return invalidOrdinary();
    return {
      receiver: immutableReceiver({ ...receiver, streamEpoch: frame.streamEpoch, cursor: frame.sequence, state, stateMetrics, assembly: null }),
      outcome: "applied",
      effect: reduced.effect,
    };
  } catch {
    return invalidOrdinary();
  }
}

export function makeLogicalFrame(streamEpoch: string, sequence: number, draft: ProjectedSessionFrameDraft): ProjectedSessionLogicalFrame {
  return { protocol: PROJECTED_SESSION_PROTOCOL, version: PROJECTED_SESSION_VERSION, streamEpoch, sequence, ...draft } as ProjectedSessionLogicalFrame;
}

export function isSnapshotTransferFrame(frame: ProjectedSessionFrame): frame is SnapshotTransferFrame {
  return frame.type === "snapshot_start" || frame.type === "snapshot_chunk" || frame.type === "snapshot_end";
}
