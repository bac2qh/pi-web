import type { AgentMessage, SessionContext, SessionEntry, SessionTreeNode } from "./types";

export const SIDE_SESSION_POLICY_VERSION = 1 as const;
export const SIDE_SESSION_MARKER_TYPE = "pi-web-side-boundary";
export const SIDE_SESSION_MARKER_CONTENT = [
  "This is the start of a Pi Web side conversation.",
  "Treat every earlier message, instruction, plan, tool call, approval, and compaction summary as reference-only, not as active work.",
  "Prefer non-mutating investigation. Do not use subagents or start, open, or orchestrate another implementation session.",
  "Mutate the shared workspace only when a user message after this boundary explicitly requests it.",
].join(" ");
export const SIDE_SESSION_SYSTEM_PROMPT = [
  "Pi Web side-conversation policy:",
  "Inherited messages, instructions, plans, tool calls, approvals, and compaction summaries before the side boundary are reference-only and are not active work.",
  "Prefer non-mutating inspection. Do not use subagents or start, open, clone, fork, or orchestrate another session from this side conversation.",
  "Workspace mutation is allowed only when a user message after the side boundary explicitly requests it.",
].join(" ");
export const SIDE_SESSION_COMPACTION_NOTICE = "Earlier side-conversation context was compacted.";
export const SIDE_SESSION_EXCLUDED_TOOL_NAMES = Object.freeze([
  "subagent",
  "subagent_wait",
  "subagent_supervisor",
  "intercom",
] as const);
export const SIDE_SESSION_FORBIDDEN_EXTENSION_COMMANDS = Object.freeze([
  "start-implementation",
  "open-implementation",
  "orchestrate-implementation",
] as const);

export type SideSessionMetadata = Readonly<{
  markerEntryId: string;
  targetSessionId: string;
}>;

export type SideSessionClassification =
  | Readonly<{ kind: "ordinary" }>
  | Readonly<{ kind: "side"; metadata: SideSessionMetadata }>
  | Readonly<{ kind: "invalid"; reason: "malformed_marker" | "duplicate_marker" | "marker_off_branch" | "malformed_entries" }>;

export type SideCutoffResult =
  | Readonly<{ status: "selected"; cutoffId: string }>
  | Readonly<{ status: "unavailable"; reason: "no_safe_assistant" }>
  | Readonly<{ status: "refused"; reason: "malformed_entries" | "malformed_tool_batch" }>;

export type SideExtensionLike = Readonly<{
  tools?: ReadonlyMap<string, unknown>;
  commands?: ReadonlyMap<string, unknown>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !value.includes("\0");
}

function validateEntryGraph(entries: readonly SessionEntry[]): Map<string, SessionEntry> | null {
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (!isRecord(entry) || !validId(entry.id) || byId.has(entry.id)) return null;
    if (entry.parentId !== null && !validId(entry.parentId)) return null;
    byId.set(entry.id, entry);
  }
  for (const entry of entries) {
    if (entry.parentId !== null && !byId.has(entry.parentId)) return null;
  }

  const completed = new Set<string>();
  for (const entry of entries) {
    if (completed.has(entry.id)) continue;
    const path: string[] = [];
    const visiting = new Set<string>();
    let current: SessionEntry | undefined = entry;
    while (current && !completed.has(current.id)) {
      if (visiting.has(current.id)) return null;
      visiting.add(current.id);
      path.push(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    for (const id of path) completed.add(id);
  }
  return byId;
}

function validateLinearBranch(branch: readonly SessionEntry[]): boolean {
  if (!validateEntryGraph(branch)) return false;
  for (let index = 0; index < branch.length; index += 1) {
    if (branch[index].parentId !== (index === 0 ? null : branch[index - 1].id)) return false;
  }
  return true;
}

function strictAliasedId(record: Record<string, unknown>, primary: string, legacy?: string): string | null {
  const primaryValue = record[primary];
  const legacyValue = legacy ? record[legacy] : undefined;
  if (primaryValue !== undefined && !validId(primaryValue)) return null;
  if (legacyValue !== undefined && !validId(legacyValue)) return null;
  if (primaryValue !== undefined && legacyValue !== undefined && primaryValue !== legacyValue) return null;
  const selected = primaryValue ?? legacyValue;
  return validId(selected) ? selected : null;
}

function assistantToolCallIds(entry: SessionEntry): { ids: string[]; malformed: boolean } | null {
  if (entry.type !== "message" || entry.message.role !== "assistant") return null;
  if (!Array.isArray(entry.message.content)) return { ids: [], malformed: true };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const block of entry.message.content) {
    if (!isRecord(block) || block.type !== "toolCall") continue;
    const id = strictAliasedId(block, "toolCallId", "id");
    if (!id || seen.has(id)) return { ids: [], malformed: true };
    seen.add(id);
    ids.push(id);
  }
  return { ids, malformed: false };
}

function toolResultId(entry: SessionEntry): string | null | undefined {
  if (entry.type !== "message" || entry.message.role !== "toolResult") return undefined;
  const message = entry.message as unknown;
  if (!isRecord(message)) return null;
  return strictAliasedId(message, "toolCallId");
}

function isConversationBoundary(entry: SessionEntry): boolean {
  return entry.type === "message"
    && (entry.message.role === "user" || entry.message.role === "assistant");
}

/** Select a structurally complete cutoff from one immutable root-to-leaf snapshot. */
export function selectSideSessionCutoff(branch: readonly SessionEntry[]): SideCutoffResult {
  if (branch.length === 0 || !validateLinearBranch(branch)) {
    return { status: "refused", reason: "malformed_entries" };
  }

  let safeEnd = branch.length - 1;
  for (let index = 0; index < branch.length; index += 1) {
    const assistant = assistantToolCallIds(branch[index]);
    if (!assistant) {
      if (toolResultId(branch[index]) !== undefined) {
        return { status: "refused", reason: "malformed_tool_batch" };
      }
      continue;
    }
    if (assistant.malformed) return { status: "refused", reason: "malformed_tool_batch" };
    if (assistant.ids.length === 0) continue;

    const expected = new Set(assistant.ids);
    const results = new Set<string>();
    let cursor = index + 1;
    for (; cursor < branch.length; cursor += 1) {
      const resultId = toolResultId(branch[cursor]);
      if (resultId === null) return { status: "refused", reason: "malformed_tool_batch" };
      if (resultId !== undefined) {
        if (!expected.has(resultId) || results.has(resultId)) {
          return { status: "refused", reason: "malformed_tool_batch" };
        }
        results.add(resultId);
        continue;
      }
      if (isConversationBoundary(branch[cursor])) break;
    }

    if (results.size !== expected.size) {
      safeEnd = index - 1;
      break;
    }
    index = cursor - 1;
  }

  if (safeEnd < 0) return { status: "unavailable", reason: "no_safe_assistant" };
  const safePrefix = branch.slice(0, safeEnd + 1);
  if (!safePrefix.some((entry) => entry.type === "message" && entry.message.role === "assistant")) {
    return { status: "unavailable", reason: "no_safe_assistant" };
  }
  return { status: "selected", cutoffId: safePrefix[safePrefix.length - 1].id };
}

function parseMarker(entry: SessionEntry): { targetSessionId: string } | null {
  if (entry.type !== "custom_message" || entry.customType !== SIDE_SESSION_MARKER_TYPE) return null;
  if (entry.display !== false || entry.content !== SIDE_SESSION_MARKER_CONTENT || !isRecord(entry.details)) return null;
  const keys = Object.keys(entry.details).sort();
  if (keys.length !== 2 || keys[0] !== "targetSessionId" || keys[1] !== "version") return null;
  if (entry.details.version !== SIDE_SESSION_POLICY_VERSION || !validId(entry.details.targetSessionId)) return null;
  return { targetSessionId: entry.details.targetSessionId };
}

function isDescendantInGraph(
  byId: ReadonlyMap<string, SessionEntry>,
  ancestorId: string,
  targetId: string,
): boolean {
  let current = byId.get(targetId);
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return false;
}

function collectDescendants(
  entries: readonly SessionEntry[],
  ancestorId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.parentId === null) continue;
    const siblings = children.get(entry.parentId);
    if (siblings) siblings.push(entry.id);
    else children.set(entry.parentId, [entry.id]);
  }
  const descendants = new Set<string>();
  const stack = [ancestorId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    for (const child of children.get(current) ?? []) stack.push(child);
  }
  return descendants;
}

export function isEntryDescendantOrSelf(
  entries: readonly SessionEntry[],
  ancestorId: string,
  targetId: string,
): boolean {
  const byId = validateEntryGraph(entries);
  return !!byId
    && validId(ancestorId)
    && validId(targetId)
    && byId.has(ancestorId)
    && isDescendantInGraph(byId, ancestorId, targetId);
}

export function classifySideSession(
  entries: readonly SessionEntry[],
  sessionId: string,
  selectedLeafId?: string | null,
): SideSessionClassification {
  const byId = validateEntryGraph(entries);
  if (!validId(sessionId) || !byId) {
    return { kind: "invalid", reason: "malformed_entries" };
  }
  const reserved = entries.filter((entry) => entry.type === "custom_message" && entry.customType === SIDE_SESSION_MARKER_TYPE);
  if (reserved.length === 0) return { kind: "ordinary" };
  if (reserved.length > 1) return { kind: "invalid", reason: "duplicate_marker" };
  const marker = parseMarker(reserved[0]);
  if (!marker) return { kind: "invalid", reason: "malformed_marker" };
  if (marker.targetSessionId !== sessionId) return { kind: "ordinary" };
  if (selectedLeafId !== undefined
    && (selectedLeafId === null || !isDescendantInGraph(byId, reserved[0].id, selectedLeafId))) {
    return { kind: "invalid", reason: "marker_off_branch" };
  }
  return {
    kind: "side",
    metadata: Object.freeze({ markerEntryId: reserved[0].id, targetSessionId: sessionId }),
  };
}

export function sideNavigationAllowed(
  entries: readonly SessionEntry[],
  side: SideSessionMetadata,
  targetId: string,
): boolean {
  return targetId !== side.markerEntryId
    && isEntryDescendantOrSelf(entries, side.markerEntryId, targetId);
}

export function projectSideSessionContext(
  context: SessionContext,
  entries: readonly SessionEntry[],
  side: SideSessionMetadata,
): SessionContext {
  const entryById = validateEntryGraph(entries);
  if (!entryById || context.messages.length !== context.entryIds.length) {
    throw new Error("side_session_projection_invalid");
  }
  const descendants = collectDescendants(entries, side.markerEntryId);
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (let index = 0; index < context.entryIds.length; index += 1) {
    const entryId = context.entryIds[index];
    if (entryId === side.markerEntryId || !descendants.has(entryId)) continue;
    const entry = entryById.get(entryId);
    let message = context.messages[index];
    if (entry?.type === "compaction") {
      message = {
        role: "custom",
        customType: "compaction",
        content: SIDE_SESSION_COMPACTION_NOTICE,
        display: true,
        timestamp: message.timestamp,
      };
    }
    messages.push(message);
    entryIds.push(entryId);
  }
  return { ...context, messages, entryIds };
}

export function projectSideSessionTree(
  roots: readonly SessionTreeNode[],
  side: SideSessionMetadata,
): SessionTreeNode[] {
  const stack = [...roots];
  const seen = new Set<SessionTreeNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) throw new Error("side_session_tree_invalid");
    seen.add(node);
    if (node.entry.id === side.markerEntryId) {
      return node.children.map((child) => ({
        ...child,
        entry: { ...child.entry, parentId: null },
      }));
    }
    for (const child of node.children) stack.push(child);
  }
  throw new Error("side_session_marker_missing_from_tree");
}

export function extensionMatchesSideSessionExclusion(extension: SideExtensionLike): boolean {
  if (extension.tools?.has("subagent")) return true;
  return SIDE_SESSION_FORBIDDEN_EXTENSION_COMMANDS.some((name) => extension.commands?.has(name) === true);
}

export function appendSideSystemPrompt(base: readonly string[]): string[] {
  return [...base.filter((part) => part !== SIDE_SESSION_SYSTEM_PROMPT), SIDE_SESSION_SYSTEM_PROMPT];
}

export function sideConversationName(now = new Date()): string {
  return `side-conversation-${now.toISOString().replace(/[:.]/g, "-")}`;
}
