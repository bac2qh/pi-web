"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from "react";
import type {
  AgentMessage,
  ExtensionStatusItem,
  ExtensionUiRequest,
  ExtensionWidgetItem,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import { getToolNamesForPreset, type ToolEntry } from "@/lib/tool-presets";
import type { SessionStatsInfo } from "@/lib/pi-types";
import {
  isEffectCurrent,
  projectSessionEffect,
  projectSessionView,
  type SessionPromptClassification,
} from "@/lib/session-view-projection";
import {
  SessionHttpReconciliation,
  type SessionHttpObservation,
  type SessionHttpResource,
} from "@/lib/session-http-reconciliation";
import type {
  SessionViewBinding,
  SessionViewPromptClaim,
  SessionViewSnapshot,
  SessionViewTransportController,
} from "@/lib/session-view-transport";
import type { SessionEffectDelivery } from "@/lib/session-transport-client";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface CompactCommandResult {
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

interface LastAssistantTextResponse {
  text?: string;
}

type AgentStateResponse = {
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isCompacting?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
};

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

function normalizeQueuedMessages(q?: { steering?: string[]; followUp?: string[] } | null): QueuedMessages {
  return { steering: q?.steering ?? [], followUp: q?.followUp ?? [] };
}

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
export type NoticeType = "info" | "success" | "warning" | "error";

export type NoticeItem = {
  id: string;
  message: string;
  type: NoticeType;
  exiting?: boolean;
};

type NoticeState = {
  visible: NoticeItem[];
  pending: NoticeItem[];
};

type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "remove"; id: string };

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_command" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export interface CompactResultInfo {
  reason: "manual" | "threshold" | "overflow" | "auto" | string;
  tokensBefore: number;
  estimatedTokensAfter: number;
}

export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
}

export type BuiltinSlashCommandResult =
  | { handled: false }
  | { handled: true; message?: string; error?: string; action?: "openSessionStats" };

export function isExactCloneCommand(text: string): boolean {
  return text.trim() === "/clone";
}

type CloneCommandResult =
  | { created: true; newSessionId: string }
  | {
      created: false;
      reason: "busy" | "nothing_to_clone" | "missing_source" | "stale_leaf" | "clone_failed";
    };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  sessionViewBinding: SessionViewBinding | null;
  sessionViewTransport: SessionViewTransportController;
  newScreenGeneration: number;
  isNewScreenCurrent?: (generation: number) => boolean;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo, generation: number, binding: SessionViewBinding) => void;
  onSessionForked?: (newSessionId: string) => void;
  onSessionCloned?: () => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsPanelOpen?: () => void;
  setToolPreset?: (preset: "none" | "default" | "full") => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const PROGRAMMATIC_SCROLL_IGNORE_MS = 700;
const USER_SCROLL_INTENT_MS = 1200;
const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
const PROMPT_SETTLE_POLL_MS = 600;
const PROMPT_SETTLE_MAX_MS = 20_000;
const AGENT_STATE_RECONCILE_MS = 15_000;
const MAX_NOTICES = 5;
const NOTICE_VISIBLE_MS = 5000;
const NOTICE_EXIT_ANIMATION_MS = 180;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);

function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  if (index === -1) return notices;
  return notices.map((notice, i) => (
    i === index ? { ...notice, exiting: true } : notice
  ));
}

function fillPendingNotices(visible: NoticeItem[], pending: NoticeItem[]): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) {
    nextVisible = markOldestNoticeExiting(nextVisible);
  }
  return { visible: nextVisible, pending: nextPending };
}

function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add": {
      if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
        return {
          visible: state.visible.some((notice) => notice.exiting)
            ? state.visible
            : markOldestNoticeExiting(state.visible),
          pending: [...state.pending, action.notice],
        };
      }
      return { ...state, visible: [...state.visible, action.notice] };
    }
    case "mark_oldest_exiting":
      return { ...state, visible: markOldestNoticeExiting(state.visible) };
    case "remove": {
      const visible = state.visible.filter((notice) => notice.id !== action.id);
      return fillPendingNotices(visible, state.pending);
    }
    default:
      return state;
  }
}

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object"
        && (block as { type?: string }).type === "text"
        && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "")
    .filter(Boolean)
    .join("\n");
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") return "";
  const source = (block as { source?: unknown }).source;
  if (source && typeof source === "object") {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown };
    return [
      src.type === "url" ? "url" : "base64",
      typeof src.media_type === "string" ? src.media_type : "",
      typeof src.data === "string" ? src.data : "",
      typeof src.url === "string" ? src.url : "",
    ].join(":");
  }
  const flat = block as { data?: unknown; mimeType?: unknown };
  return [
    "base64",
    typeof flat.mimeType === "string" ? flat.mimeType : "",
    typeof flat.data === "string" ? flat.data : "",
    "",
  ].join(":");
}

function userMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return JSON.stringify({ text: content, images: [] });
  if (!Array.isArray(content)) return JSON.stringify({ text: "", images: [] });
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  });
}

function readCompactResult(result: unknown, reason: string): CompactResultInfo | null {
  if (!result || typeof result !== "object") return null;
  const r = result as CompactCommandResult;
  if (typeof r.tokensBefore !== "number" || typeof r.estimatedTokensAfter !== "number") return null;
  return { reason, tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter };
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

type PromptTranscriptFloor = {
  runId: number;
  leafGeneration: number;
  priorEntryId: string | null;
  userMessageKey: string;
  priorMatchingUserMessages: number;
  preexistingMatchingEntryIds: ReadonlySet<string>;
  compactionAtStart: string;
  observedCompactionStart: boolean;
  covered: boolean;
};

type LeafNavigationOutcome = "succeeded" | "failed" | "superseded";
type LeafIntent = {
  pinnedLeafId: string | null;
  promptBaseLeafId: string | null;
  activeLeafId: string | null;
};
type PendingLeafNavigation = {
  generation: number;
  promise: Promise<LeafNavigationOutcome>;
};

function nativePromptBaseForTreeTarget(tree: SessionTreeNode[], targetId: string): string | null {
  const pending = [...tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.entry.id === targetId) {
      const entry = node.entry;
      return (entry.type === "message" && entry.message.role === "user")
        || entry.type === "custom_message"
        ? entry.parentId
        : targetId;
    }
    pending.push(...node.children);
  }
  return targetId;
}

function matchingUserEntryIds(messages: AgentMessage[], entryIds: string[], key: string): ReadonlySet<string> {
  const matching = new Set<string>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const entryId = entryIds[index];
    if (entryId && message.role === "user" && userMessageKey(message) === key) matching.add(entryId);
  }
  return matching;
}

function compactionFingerprint(compaction: SessionViewSnapshot["transport"]["state"]["compaction"]): string {
  if (!compaction) return "none";
  return JSON.stringify({
    active: compaction.active,
    reason: compaction.reason,
    aborted: compaction.aborted ?? false,
    hasError: compaction.errorMessage !== undefined,
    tokensBefore: compaction.tokensBefore ?? null,
    estimatedTokensAfter: compaction.estimatedTokensAfter ?? null,
  });
}

function transcriptCoversPromptFloor(
  messages: AgentMessage[],
  entryIds: string[],
  floor: PromptTranscriptFloor,
): boolean {
  const matchingIndexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user" && userMessageKey(message) === floor.userMessageKey) matchingIndexes.push(index);
  }
  const eligibleIndexes = floor.preexistingMatchingEntryIds.size === 0
    ? matchingIndexes
    : matchingIndexes.filter((index) => {
      const entryId = entryIds[index];
      return !!entryId && !floor.preexistingMatchingEntryIds.has(entryId);
    });
  if (floor.priorEntryId === null) {
    return floor.preexistingMatchingEntryIds.size > 0
      ? eligibleIndexes.length > 0
      : matchingIndexes.length > floor.priorMatchingUserMessages;
  }

  const priorIndex = entryIds.indexOf(floor.priorEntryId);
  if (priorIndex !== -1) return eligibleIndexes.some((index) => index > priorIndex);

  // A compaction can replace the pre-prompt path with a summary while retaining
  // the current user entry. In that transformed descendant, the exact prompt
  // is the usable floor even though the prior displayed entry is no longer in
  // the HTTP transcript.
  const compactionIndex = messages.findIndex((message) => (
    message.role === "custom"
    && (message as { customType?: string }).customType === "compaction"
  ));
  return compactionIndex !== -1 && eligibleIndexes.some((index) => index > compactionIndex);
}

type SelectedModel = { provider: string; modelId: string };
type ModelEntry = { id: string; name: string; provider: string };
type ModelsResponse = {
  models: Record<string, string>;
  modelList?: ModelEntry[];
  defaultModel?: SelectedModel | null;
  thinkingLevels?: Record<string, string[]>;
  thinkingLevelMaps?: Record<string, Record<string, string | null>>;
};

type SlashCommandsResponse = {
  commands?: SlashCommandInfo[];
};

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, sessionViewBinding, sessionViewTransport, newScreenGeneration, isNewScreenCurrent,
    newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, onSessionCloned,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange, onSessionStatsPanelOpen,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelEntry[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModel] = useState<SelectedModel | null>(null);
  const [newSessionDefaultModel, setNewSessionDefaultModel] = useState<SelectedModel | null>(null);
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">("default");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [compactResult, setCompactResult] = useState<CompactResultInfo | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommandInfo[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [], pending: [] });
  const [sessionStatsOverride, setSessionStatsOverride] = useState<SessionStatsInfo | null>(null);
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<ExtensionStatusItem[]>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<ExtensionWidgetItem[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessages>({ steering: [], followUp: [] });

  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const viewBindingRef = useRef<SessionViewBinding | null>(sessionViewBinding);
  const viewSnapshotRef = useRef<SessionViewSnapshot | null>(sessionViewBinding?.getSnapshot() ?? null);
  const unsubscribeViewSnapshotRef = useRef<(() => void) | null>(null);
  const unsubscribeViewEffectsRef = useRef<(() => void) | null>(null);
  const unsubscribeViewCompletionsRef = useRef<(() => void) | null>(null);
  const currentPromptClaimRef = useRef<SessionViewPromptClaim | null>(null);
  const hookMountedRef = useRef(true);
  const promptClassificationRef = useRef<SessionPromptClassification>(
    sessionViewBinding?.getPromptClassification?.() ?? null,
  );
  const httpLiveSeededRef = useRef(false);
  const lastEffectRef = useRef<{ epoch: string; sequence: number } | null>(null);
  const httpReconciliationRef = useRef(new SessionHttpReconciliation());
  const pinnedLeafIdRef = useRef<string | null>(null);
  const pinnedPromptBaseLeafIdRef = useRef<string | null>(null);
  const confirmedLeafIntentRef = useRef<LeafIntent>({
    pinnedLeafId: null,
    promptBaseLeafId: null,
    activeLeafId: null,
  });
  const leafGenerationRef = useRef(0);
  const promptUiGenerationRef = useRef(0);
  const transcriptRepairScheduledRef = useRef(false);
  const runtimeRepairScheduledRef = useRef(false);
  const repairTimersRef = useRef<Partial<Record<SessionHttpResource, ReturnType<typeof setTimeout>>>>({});
  const settlementWaitsRef = useRef(new Set<{ cancel: () => void }>());
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const completionScrollAllowedRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const ignoreProgrammaticScrollUntilRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const ensuringNewSessionRef = useRef<Promise<string | null> | null>(null);
  const cloneInFlightRef = useRef<Promise<BuiltinSlashCommandResult> | null>(null);
  const newSessionPromotedRef = useRef(false);
  const promptRunIdRef = useRef(0);
  const optimisticUserMessageKeyRef = useRef<string | null>(null);
  const promptTranscriptFloorRef = useRef<PromptTranscriptFloor | null>(null);
  const pendingLeafNavigationRef = useRef<PendingLeafNavigation | null>(null);
  const loadSessionRef = useRef<((sid: string, showLoading?: boolean, includeState?: boolean) => Promise<unknown>) | null>(null);
  const loadContextRef = useRef<((sid: string, leafId: string) => Promise<void>) | null>(null);
  const reconcileAgentStateRef = useRef<((sid: string) => Promise<void>) | null>(null);
  const applyProjectedSnapshotRef = useRef<((snapshot: SessionViewSnapshot) => void) | null>(null);
  const applyProjectedEffectRef = useRef<((delivery: SessionEffectDelivery) => void) | null>(null);

  const setToolPresetState = opts.setToolPreset ?? setToolPreset;

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? (newSessionModel ?? newSessionDefaultModel) : currentModel;

  const currentHttpObservation = useCallback((sid = sessionIdRef.current): SessionHttpObservation | null => {
    const snapshot = viewBindingRef.current?.getSnapshot() ?? null;
    if (!sid || !snapshot) return null;
    return Object.freeze({
      sessionId: sid,
      viewGeneration: snapshot.generation,
      transport: snapshot.transport,
      selectedLeafId: pinnedLeafIdRef.current,
      leafGeneration: leafGenerationRef.current,
      promptUiGeneration: promptUiGenerationRef.current,
      promptRunGeneration: promptRunIdRef.current,
      promptLineage: viewBindingRef.current?.getPromptLineage() ?? null,
    });
  }, []);

  const scheduleHttpRepair = useCallback((requestedResource: SessionHttpResource, delayMs = 0) => {
    const resource: SessionHttpResource = requestedResource === "runtime"
      ? "runtime"
      : pinnedLeafIdRef.current === null ? "transcript" : "context";
    const flag = resource === "runtime" ? runtimeRepairScheduledRef : transcriptRepairScheduledRef;
    if (delayMs === 0) {
      const delayedResources: SessionHttpResource[] = resource === "runtime"
        ? ["runtime"]
        : ["transcript", "context"];
      let cancelledDelayedRepair = false;
      for (const delayedResource of delayedResources) {
        const timer = repairTimersRef.current[delayedResource];
        if (timer === undefined) continue;
        clearTimeout(timer);
        delete repairTimersRef.current[delayedResource];
        httpReconciliationRef.current.cancelSchedule(delayedResource);
        cancelledDelayedRepair = true;
      }
      if (cancelledDelayedRepair) flag.current = false;
    }
    if (flag.current || repairTimersRef.current[resource]
      || !httpReconciliationRef.current.requestSchedule(resource)) return;
    flag.current = true;
    const run = () => {
      delete repairTimersRef.current[resource];
      flag.current = false;
      httpReconciliationRef.current.cancelSchedule(resource);

      // Leaf intent can change while a coalesced repair waits. Select the HTTP
      // authority only when it actually runs so an old context cannot restore
      // an ancestor and an old root repair cannot overwrite a later pin.
      const pinnedLeafId = pinnedLeafIdRef.current;
      const currentResource: SessionHttpResource = resource === "runtime"
        ? "runtime"
        : pinnedLeafId === null ? "transcript" : "context";
      if (currentResource !== resource) httpReconciliationRef.current.markDirty(currentResource);

      // A scheduled marker may race an initial/requested repair that began
      // after scheduling. Coalesce rather than superseding that live request.
      if (httpReconciliationRef.current.isInFlight(currentResource)) return;
      const sid = sessionIdRef.current;
      if (!sid || !hookMountedRef.current) return;
      if (currentResource === "runtime") void reconcileAgentStateRef.current?.(sid);
      else if (currentResource === "context" && pinnedLeafId !== null) void loadContextRef.current?.(sid, pinnedLeafId);
      else void loadSessionRef.current?.(sid, false, false);
    };
    if (delayMs > 0) repairTimersRef.current[resource] = setTimeout(run, delayMs);
    else queueMicrotask(run);
  }, []);

  const retryFailedHttpRepair = useCallback((resource: SessionHttpResource, observation: SessionHttpObservation | null) => {
    if (!observation) return;
    const delayMs = httpReconciliationRef.current.consumeFailureRetryDelay(resource, observation);
    if (delayMs !== null) scheduleHttpRepair(resource, delayMs);
  }, [scheduleHttpRepair]);

  const sessionStats = useMemo(() => {
    if (sessionStatsOverride) return sessionStatsOverride;
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    let cost = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let toolCalls = 0;
    for (const msg of messages) {
      if (msg.role === "user") userMessages += 1;
      if (msg.role === "toolResult") toolResults += 1;
      if (msg.role !== "assistant") continue;
      assistantMessages += 1;
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
      toolCalls += (msg as import("@/lib/types").AssistantMessage).content.filter((c) => c.type === "toolCall").length;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    if (tokens.total === 0 && messages.length === 0) return null;
    return {
      sessionFile: data?.filePath || undefined,
      sessionId: sessionIdRef.current ?? session?.id ?? "",
      sessionName: session?.name,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: messages.length,
      tokens,
      cost,
      ...(contextUsage ? { contextUsage } : {}),
    } satisfies SessionStatsInfo;
  }, [messages, sessionStatsOverride, contextUsage, data?.filePath, session?.id, session?.name]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    let messagesLoaded = false;
    const observation = currentHttpObservation(sid);
    if (!observation) return null;
    const transcriptToken = httpReconciliationRef.current.begin("transcript", observation);
    try {
      if (showLoading) setLoading(true);
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1" });
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}?${params}`);
      if (res.status === 404) {
        const current = currentHttpObservation(sid);
        if (current && httpReconciliationRef.current.decide(transcriptToken, current) === "accepted" && showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setEntryIds([]);
          setError(null);
        }
        if (current) httpReconciliationRef.current.finish(transcriptToken, current, true);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData;
      const current = currentHttpObservation(sid);
      if (!current || httpReconciliationRef.current.decide(transcriptToken, current) !== "accepted"
        || (transcriptToken.selectedLeafId !== null && d.leafId !== transcriptToken.selectedLeafId)) {
        if (current) httpReconciliationRef.current.finish(transcriptToken, current, false);
        scheduleHttpRepair(transcriptToken.selectedLeafId === null ? "transcript" : "context");
        return null;
      }
      const promptFloor = promptTranscriptFloorRef.current;
      const guardsCurrentPrompt = transcriptToken.selectedLeafId === null
        && promptFloor !== null
        && promptFloor.runId === transcriptToken.promptRunGeneration
        && promptFloor.leafGeneration === transcriptToken.leafGeneration;
      if (guardsCurrentPrompt && !transcriptCoversPromptFloor(d.context.messages, d.context.entryIds ?? [], promptFloor)) {
        httpReconciliationRef.current.finish(transcriptToken, current, false);
        retryFailedHttpRepair("transcript", current);
        return null;
      }
      if (guardsCurrentPrompt) promptFloor.covered = true;
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      if (d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }
      const afterApply = currentHttpObservation(sid);
      if (!afterApply || httpReconciliationRef.current.finish(transcriptToken, afterApply, true) !== "accepted") {
        scheduleHttpRepair("transcript");
      }

      messagesLoaded = true;
      if (showLoading) setLoading(false);
      if (!includeState) return null;

      const runtimeObservation = currentHttpObservation(sid);
      if (!runtimeObservation) return null;
      const runtimeToken = httpReconciliationRef.current.begin("runtime", runtimeObservation);
      try {
        const stateRes = await fetch(`/api/sessions/${encodeURIComponent(sid)}/state`);
        if (!stateRes.ok) throw new Error(`HTTP ${stateRes.status}`);
        const agentState = await stateRes.json() as { running: boolean; state?: AgentStateResponse };
        const runtimeCurrent = currentHttpObservation(sid);
        if (!runtimeCurrent || httpReconciliationRef.current.decide(runtimeToken, runtimeCurrent) !== "accepted") {
          if (runtimeCurrent) httpReconciliationRef.current.finish(runtimeToken, runtimeCurrent, false);
          scheduleHttpRepair("runtime");
          return null;
        }

        const liveState = agentState.state;
        const committedView = viewBindingRef.current?.getSnapshot();
        const hasCanonical = committedView?.generation === runtimeCurrent.viewGeneration
          && committedView.canonicalCommitted;
        if (liveState) {
          if (liveState.contextUsage !== undefined) setContextUsage(liveState.contextUsage ?? null);
          if (liveState.systemPrompt !== undefined) setSystemPrompt(liveState.systemPrompt ?? null);
          if (liveState.thinkingLevel !== undefined) setThinkingLevel((liveState.thinkingLevel as ThinkingLevelOption) ?? "auto");
          if (liveState.extensionStatuses !== undefined) setExtensionStatuses(liveState.extensionStatuses ?? []);
          if (liveState.extensionWidgets !== undefined) setExtensionWidgets(liveState.extensionWidgets ?? []);
          if (liveState.queuedMessages !== undefined) setQueuedMessages(normalizeQueuedMessages(liveState.queuedMessages));
          if (!hasCanonical) {
            httpLiveSeededRef.current = true;
            const promptBusy = agentState.running && !!(liveState.isStreaming || liveState.isPromptRunning);
            agentRunningRef.current = promptBusy;
            setAgentRunning(promptBusy);
            setIsCompacting(liveState.isCompacting ?? false);
            if (promptBusy) {
              dispatch({ type: "start" });
              if (!liveState.isStreaming && liveState.isPromptRunning) {
                promptClassificationRef.current = "slash_command";
                setAgentPhase({ kind: "running_command" });
              } else setAgentPhase({ kind: "waiting_model" });
            } else {
              dispatch({ type: "end" });
              setAgentPhase(null);
            }
          }
        } else if (!agentState.running) {
          setQueuedMessages({ steering: [], followUp: [] });
        }
        // Canonical projected live fields win over HTTP seed/repair fields.
        const projected = viewBindingRef.current?.getSnapshot();
        if (hasCanonical && projected) applyProjectedSnapshotRef.current?.(projected);
        const runtimeAfterApply = currentHttpObservation(sid);
        if (!runtimeAfterApply || httpReconciliationRef.current.finish(runtimeToken, runtimeAfterApply, true) !== "accepted") {
          scheduleHttpRepair("runtime");
        } else {
          const busy = !!(agentState.running && liveState
            && (liveState.isStreaming || liveState.isPromptRunning || liveState.isCompacting));
          if (!busy && runtimeToken.promptLineage !== null) {
            viewBindingRef.current?.settlePromptLineage(runtimeToken.promptLineage);
          }
        }
        return agentState;
      } catch {
        const runtimeCurrent = currentHttpObservation(sid);
        if (runtimeCurrent) httpReconciliationRef.current.finish(runtimeToken, runtimeCurrent, false);
        retryFailedHttpRepair("runtime", runtimeCurrent);
        return null;
      }
    } catch (e) {
      const current = currentHttpObservation(sid);
      if (current) httpReconciliationRef.current.finish(transcriptToken, current, false);
      retryFailedHttpRepair("transcript", current);
      if (sessionIdRef.current === sid) setError(String(e));
      return null;
    } finally {
      if (showLoading && !messagesLoaded) setLoading(false);
    }
  }, [currentHttpObservation, retryFailedHttpRepair, scheduleHttpRepair]);
  loadSessionRef.current = loadSession;

  const loadContext = useCallback(async (sid: string, leafId: string) => {
    const observation = currentHttpObservation(sid);
    if (!observation) return;
    if (observation.selectedLeafId !== leafId) {
      scheduleHttpRepair(observation.selectedLeafId === null ? "transcript" : "context");
      return;
    }
    const token = httpReconciliationRef.current.begin("context", observation);
    try {
      const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", leafId });
      const url = `/api/sessions/${encodeURIComponent(sid)}/context?${params}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      const current = currentHttpObservation(sid);
      if (!current || httpReconciliationRef.current.decide(token, current) !== "accepted") {
        if (current) httpReconciliationRef.current.finish(token, current, false);
        scheduleHttpRepair("context");
        return;
      }
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      const afterApply = currentHttpObservation(sid);
      if (!afterApply || httpReconciliationRef.current.finish(token, afterApply, true) !== "accepted") {
        scheduleHttpRepair("context");
      }
    } catch {
      const current = currentHttpObservation(sid);
      if (current) httpReconciliationRef.current.finish(token, current, false);
      retryFailedHttpRepair("context", current);
    }
  }, [currentHttpObservation, retryFailedHttpRepair, scheduleHttpRepair]);
  loadContextRef.current = loadContext;

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (tools) {
        const { getPresetFromTools } = await import("@/lib/tool-presets");
        setToolPresetState(getPresetFromTools(tools));
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [setToolPresetState]);

  const promoteNewSession = useCallback((messageCount = 0, firstMessage = "(no messages)") => {
    const sid = sessionIdRef.current;
    const binding = viewBindingRef.current;
    if (!isNew || !newSessionCwd || !sid || !binding || newSessionPromotedRef.current) return;
    newSessionPromotedRef.current = true;
    onSessionCreated?.({
      id: sid,
      path: "",
      cwd: newSessionCwd,
      name: undefined,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount,
      firstMessage,
    }, newScreenGeneration, binding);
  }, [isNew, newSessionCwd, newScreenGeneration, onSessionCreated]);

  const ensureNewSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (!isNew || !newSessionCwd) return sessionIdRef.current;
    if (ensuringNewSessionRef.current) return ensuringNewSessionRef.current;

    const promise = (async () => {
      const selectedModel = newSessionModel ?? newSessionDefaultModel;
      if (selectedModel) setPendingModel(selectedModel);
      const toolNames = getToolNamesForPreset(toolPreset);
      const res = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: newSessionCwd,
          type: "ensure_session",
          toolNames,
          ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
          ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { sessionId: string };
      const realId = result.sessionId;
      sessionIdRef.current = realId;
      return realId;
    })();

    ensuringNewSessionRef.current = promise;
    try {
      return await promise;
    } finally {
      ensuringNewSessionRef.current = null;
    }
  }, [isNew, newSessionCwd, newSessionModel, newSessionDefaultModel, toolPreset, thinkingLevel]);

  const loadSlashCommands = useCallback(async () => {
    const sid = sessionIdRef.current ?? await ensureNewSession();
    if (!sid) {
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    }
    setSlashCommandsLoading(true);
    try {
      const data = await sendAgentCommand<SlashCommandsResponse>(sid, { type: "get_commands" });
      const commands = data?.commands ?? [];
      setSlashCommands(commands);
      return commands;
    } catch (e) {
      console.error("Failed to load slash commands:", e);
      setSlashCommands([]);
      return [] as SlashCommandInfo[];
    } finally {
      setSlashCommandsLoading(false);
    }
  }, [ensureNewSession]);

  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response: { value: string } | { confirmed: boolean } | { cancelled: true },
  ) => {
    const sid = sessionIdRef.current;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
    }
  }, []);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, []);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    dispatchNotice({
      type: "add",
      notice: {
        id: notice.id ?? createNoticeId(),
        message,
        type: notice.type ?? "info",
      },
    });
  }, []);

  const applyProjectedSnapshot = useCallback((snapshot: SessionViewSnapshot) => {
    if (viewBindingRef.current?.getSnapshot().generation !== snapshot.generation) return;
    const previous = viewSnapshotRef.current;
    viewSnapshotRef.current = snapshot;
    // Initial HTTP is the only available live-state authority until the exact
    // receiver commits canonical state. Later connecting/recovering
    // publications must not erase that seed; the first committed canonical
    // publication atomically supersedes it.
    if (!snapshot.canonicalCommitted && httpLiveSeededRef.current) return;
    if (snapshot.canonicalCommitted) httpLiveSeededRef.current = false;
    const projected = projectSessionView(snapshot, promptClassificationRef.current);

    agentRunningRef.current = projected.running;
    setAgentRunning(projected.running);
    if (projected.isStreaming && projected.streamingMessage) {
      dispatch({ type: "update", message: projected.streamingMessage });
    } else if (projected.running) {
      dispatch({ type: "start" });
    } else {
      dispatch({ type: "end" });
    }
    if (projected.phase === "running_tools") {
      setAgentPhase({ kind: "running_tools", tools: projected.activeTools.map((tool) => ({ ...tool })) });
    } else if (projected.phase === "running_command") setAgentPhase({ kind: "running_command" });
    else if (projected.phase === "waiting_model") setAgentPhase({ kind: "waiting_model" });
    else setAgentPhase(null);
    setQueuedMessages({ steering: [...projected.queue.steering], followUp: [...projected.queue.followUp] });
    setRetryInfo(projected.retry ? { ...projected.retry } : null);
    const compactionStarted = projected.compaction?.active === true
      && previous?.transport.state.compaction?.active !== true;
    if (compactionStarted && promptTranscriptFloorRef.current) {
      promptTranscriptFloorRef.current.observedCompactionStart = true;
    }
    setIsCompacting(projected.compaction?.active ?? false);
    if (compactionStarted) {
      setCompactError(null);
      setCompactResult(null);
    } else if (projected.compaction && !projected.compaction.active) {
      if (projected.compaction.errorMessage) {
        setCompactError(projected.compaction.errorMessage);
        setCompactResult(null);
      } else if (!projected.compaction.aborted
        && typeof projected.compaction.tokensBefore === "number"
        && typeof projected.compaction.estimatedTokensAfter === "number") {
        const promptFloor = promptTranscriptFloorRef.current;
        const completedCompaction = snapshot.transport.state.compaction;
        if (promptFloor && (promptFloor.observedCompactionStart
          || compactionFingerprint(completedCompaction) !== promptFloor.compactionAtStart)) {
          promptTranscriptFloorRef.current = null;
        }
        setCompactError(null);
        setCompactResult({
          reason: projected.compaction.reason,
          tokensBefore: projected.compaction.tokensBefore,
          estimatedTokensAfter: projected.compaction.estimatedTokensAfter,
        });
      }
    }
    setExtensionDialog(projected.dialog as ExtensionUiDialogRequest | null);
    setExtensionCustomUi(projected.customUi as ExtensionUiCustomRequest | null);
    setExtensionStatuses(projected.statuses.map((status) => ({ ...status })));
    setExtensionWidgets(projected.widgets.map((widget) => ({ ...widget, lines: [...widget.lines] })));
    if (projected.title) document.title = projected.title;

    const transport = snapshot.transport;
    const previousTransport = previous?.transport;
    const recovered = previousTransport?.streamEpoch !== transport.streamEpoch
      || transport.connectionState === "recovering";
    const transcriptAdvanced = previousTransport?.state.transcriptRevision !== transport.state.transcriptRevision;
    const settled = previousTransport?.state.active === true && !transport.state.active;
    const observation = currentHttpObservation();
    if (observation && (recovered || transcriptAdvanced || settled)
      && httpReconciliationRef.current.needsRepair("transcript", observation)) scheduleHttpRepair("transcript");
    if (observation && (recovered || settled)
      && httpReconciliationRef.current.needsRepair("runtime", observation)) scheduleHttpRepair("runtime");
  }, [currentHttpObservation, scheduleHttpRepair]);
  applyProjectedSnapshotRef.current = applyProjectedSnapshot;

  const applyProjectedEffect = useCallback((delivery: SessionEffectDelivery) => {
    const snapshot = viewBindingRef.current?.getSnapshot();
    if (!snapshot || !isEffectCurrent(snapshot, delivery)) return;
    const last = lastEffectRef.current;
    if (last && last.epoch === delivery.streamEpoch && delivery.sequence <= last.sequence) return;
    lastEffectRef.current = { epoch: delivery.streamEpoch, sequence: delivery.sequence };
    const effect = projectSessionEffect(delivery);
    if (effect.type === "notice") {
      addNotice({ type: effect.level, message: effect.message });
      return;
    }
    if (effect.type === "editor_inserted") {
      opts.chatInputRef?.current?.insertText(effect.text);
      return;
    }

    promptUiGenerationRef.current += 1;
    const completed = effect.message;
    if (completed.role === "user") {
      const deliveredKey = userMessageKey(completed);
      const optimisticKey = optimisticUserMessageKeyRef.current;
      optimisticUserMessageKeyRef.current = null;
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (optimisticKey && lastMessage?.role === "user" && userMessageKey(lastMessage) === optimisticKey) {
          return optimisticKey === deliveredKey ? prev : [...prev.slice(0, -1), completed];
        }
        return [...prev, completed];
      });
    } else {
      setMessages((prev) => [...prev, completed]);
    }
    dispatch({ type: "reset" });
  }, [addNotice, opts.chatInputRef]);
  applyProjectedEffectRef.current = applyProjectedEffect;

  const handlePagePromptCompletion = useCallback(() => {
    if (!hookMountedRef.current) return;
    currentPromptClaimRef.current = null;
    optimisticUserMessageKeyRef.current = null;
    agentRunningRef.current = false;
    setAgentRunning(false);
    setAgentPhase(null);
    setRetryInfo(null);
    dispatch({ type: "end" });
    promptClassificationRef.current = null;
    scheduleHttpRepair("transcript");
    scheduleHttpRepair("runtime");
    onAgentEnd?.();
  }, [onAgentEnd, scheduleHttpRepair]);

  const attachViewBinding = useCallback((binding: SessionViewBinding) => {
    if (viewBindingRef.current === binding && unsubscribeViewSnapshotRef.current
      && unsubscribeViewEffectsRef.current && unsubscribeViewCompletionsRef.current) return;
    unsubscribeViewSnapshotRef.current?.();
    unsubscribeViewEffectsRef.current?.();
    unsubscribeViewCompletionsRef.current?.();
    viewBindingRef.current = binding;
    viewSnapshotRef.current = binding.getSnapshot();
    promptClassificationRef.current = binding.getPromptClassification?.() ?? promptClassificationRef.current;
    lastEffectRef.current = null;
    // Effects subscribe before the synchronous snapshot publication. The base
    // client still publishes each future snapshot before its associated effect.
    unsubscribeViewEffectsRef.current = binding.subscribeEffects((delivery) => applyProjectedEffectRef.current?.(delivery));
    unsubscribeViewSnapshotRef.current = binding.subscribe((snapshot) => applyProjectedSnapshotRef.current?.(snapshot));
    unsubscribeViewCompletionsRef.current = binding.subscribeCompletions(handlePagePromptCompletion);
  }, [handlePagePromptCompletion]);

  const waitForSettlementDelay = useCallback((ms: number): Promise<boolean> => new Promise((resolve) => {
    let completed = false;
    const timer = { current: null as ReturnType<typeof setTimeout> | null };
    const wait = {
      cancel: () => {
        if (completed) return;
        completed = true;
        if (timer.current !== null) clearTimeout(timer.current);
        settlementWaitsRef.current.delete(wait);
        resolve(false);
      },
    };
    timer.current = setTimeout(() => {
      if (completed) return;
      completed = true;
      settlementWaitsRef.current.delete(wait);
      resolve(true);
    }, ms);
    if (!completed) settlementWaitsRef.current.add(wait);
  }), []);

  const waitForPromptSettlement = useCallback(async (sid: string, runId?: number) => {
    if (!await waitForSettlementDelay(PROMPT_SETTLE_INITIAL_DELAY_MS)) return;
    const startedAt = Date.now();

    while (hookMountedRef.current && agentRunningRef.current
      && Date.now() - startedAt < PROMPT_SETTLE_MAX_MS) {
      if (runId !== undefined && promptRunIdRef.current !== runId) return;
      await reconcileAgentStateRef.current?.(sid);
      if (!hookMountedRef.current || !agentRunningRef.current) return;
      if (!await waitForSettlementDelay(PROMPT_SETTLE_POLL_MS)) return;
    }
  }, [waitForSettlementDelay]);

  // Transport-neutral recovery net. Projected state remains authoritative for
  // live fields; HTTP repairs HTTP-only runtime context and settles a run whose
  // recovery snapshot skipped the active edge.
  const reconcileAgentState = useCallback(async (sid: string) => {
    const observation = currentHttpObservation(sid);
    if (!observation) return;
    const token = httpReconciliationRef.current.begin("runtime", observation);
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      if (!res.ok) throw new Error("runtime_reconciliation_failed");
      const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
      const current = currentHttpObservation(sid);
      if (!current || httpReconciliationRef.current.decide(token, current) !== "accepted") {
        if (current) httpReconciliationRef.current.finish(token, current, false);
        scheduleHttpRepair("runtime");
        return;
      }
      const state = data.state;
      const committedView = viewBindingRef.current?.getSnapshot();
      const hasCanonical = committedView?.generation === current.viewGeneration
        && committedView.canonicalCommitted;
      if (state) {
        if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
        if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
        if (state.thinkingLevel !== undefined) setThinkingLevel((state.thinkingLevel as ThinkingLevelOption) ?? "auto");
        if (!hasCanonical) {
          httpLiveSeededRef.current = true;
          const promptBusy = !!(data.running && (state.isStreaming || state.isPromptRunning));
          agentRunningRef.current = promptBusy;
          setAgentRunning(promptBusy);
          setIsCompacting(state.isCompacting ?? false);
          setQueuedMessages(normalizeQueuedMessages(state.queuedMessages));
          if (state.extensionStatuses !== undefined) setExtensionStatuses(state.extensionStatuses ?? []);
          if (state.extensionWidgets !== undefined) setExtensionWidgets(state.extensionWidgets ?? []);
        }
      }
      const projected = viewBindingRef.current?.getSnapshot();
      if (hasCanonical && projected) applyProjectedSnapshotRef.current?.(projected);
      const afterApply = currentHttpObservation(sid);
      if (!afterApply || httpReconciliationRef.current.finish(token, afterApply, true) !== "accepted") {
        scheduleHttpRepair("runtime");
        return;
      }
      const busy = !!(data.running && state
        && (state.isStreaming || state.isPromptRunning || state.isCompacting));
      if (!busy && token.promptLineage !== null) {
        viewBindingRef.current?.settlePromptLineage(token.promptLineage);
      }
    } catch {
      const current = currentHttpObservation(sid);
      if (current) httpReconciliationRef.current.finish(token, current, false);
      retryFailedHttpRepair("runtime", current);
      // Network still down — bounded backoff plus visibility/online recovery retains dirty repair.
    }
  }, [currentHttpObservation, retryFailedHttpRepair, scheduleHttpRepair]);
  reconcileAgentStateRef.current = reconcileAgentState;

  // Active runs keep the 15-second recovery net. Visibility and online edges
  // also retrigger dirty selected-idle repairs after bounded backoff exhausts.
  useEffect(() => {
    const reconcile = () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const observation = currentHttpObservation(sid);
      if (!observation) return;
      const transcriptResource: SessionHttpResource = observation.selectedLeafId === null ? "transcript" : "context";
      if (httpReconciliationRef.current.needsRepair(transcriptResource, observation)) {
        scheduleHttpRepair(transcriptResource);
      }
      if (agentRunningRef.current || observation.promptLineage !== null
        || httpReconciliationRef.current.needsRepair("runtime", observation)) {
        scheduleHttpRepair("runtime");
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const interval = agentRunning ? setInterval(reconcile, AGENT_STATE_RECONCILE_MS) : null;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", reconcile);
    return () => {
      if (interval !== null) clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", reconcile);
    };
  }, [agentRunning, currentHttpObservation, scheduleHttpRepair]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const probePromptSettlement = useCallback(async (sid: string): Promise<boolean> => {
    const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
    if (!res.ok) return false;
    const data = await res.json() as { running?: boolean; state?: AgentStateResponse };
    return !data.running || !data.state
      || (!data.state.isStreaming && !data.state.isPromptRunning && !data.state.isCompacting);
  }, []);

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]): Promise<boolean> => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !images?.length) return false;
    if (agentRunning) return false;
    while (pendingLeafNavigationRef.current) {
      const transition = pendingLeafNavigationRef.current;
      const outcome = await transition.promise;
      if (outcome === "failed") return false;
    }
    if (agentRunningRef.current) return false;
    const isSlashCommandPrompt = !images?.length && trimmedMessage.startsWith("/");
    const followsLiveTip = !isSlashCommandPrompt;
    const promptRunId = promptRunIdRef.current + 1;
    const priorPinnedLeafId = pinnedLeafIdRef.current;
    const priorPinnedPromptBaseLeafId = pinnedPromptBaseLeafIdRef.current;
    if (followsLiveTip) {
      pinnedLeafIdRef.current = null;
      pinnedPromptBaseLeafIdRef.current = null;
      leafGenerationRef.current += 1;
    }
    const promptLeafGeneration = leafGenerationRef.current;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    const promptUserMessageKey = userMessageKey(userMsg);
    const promptBaseLeafId = priorPinnedLeafId !== null
      ? priorPinnedPromptBaseLeafId
      : activeLeafId;
    const promptTranscriptFloor: PromptTranscriptFloor | null = isSlashCommandPrompt ? null : {
      runId: promptRunId,
      leafGeneration: promptLeafGeneration,
      priorEntryId: promptBaseLeafId,
      userMessageKey: promptUserMessageKey,
      priorMatchingUserMessages: priorPinnedLeafId !== null && promptBaseLeafId === null
        ? 0
        : messages.reduce((count, priorMessage) => (
          priorMessage.role === "user" && userMessageKey(priorMessage) === promptUserMessageKey ? count + 1 : count
        ), 0),
      preexistingMatchingEntryIds: matchingUserEntryIds(messages, entryIds, promptUserMessageKey),
      compactionAtStart: compactionFingerprint(
        viewBindingRef.current?.getSnapshot().transport.state.compaction ?? null,
      ),
      observedCompactionStart: false,
      covered: false,
    };
    promptTranscriptFloorRef.current = promptTranscriptFloor;
    promptUiGenerationRef.current += 1;
    setMessages((prev) => [...prev, userMsg]);
    optimisticUserMessageKeyRef.current = promptUserMessageKey;
    promptRunIdRef.current = promptRunId;
    promptClassificationRef.current = isSlashCommandPrompt ? "slash_command" : "prompt";
    agentRunningRef.current = true;
    setAgentRunning(true);
    setAgentPhase(isSlashCommandPrompt ? { kind: "running_command" } : { kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;
    completionScrollAllowedRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    let selectedMaterializedView = false;
    let dispatchedClaim: SessionViewPromptClaim | null = null;
    let sentSessionId: string | null = null;
    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        const existingSid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
        const sid = existingSid ?? await ensureNewSession();

        if (sid) {
          sentSessionId = sid;
          selectedMaterializedView = hookMountedRef.current
            && (isNewScreenCurrent?.(newScreenGeneration) ?? true);
          const classification = isSlashCommandPrompt ? "slash_command" : "prompt";
          let binding: SessionViewBinding;
          let claim: SessionViewPromptClaim;
          if (selectedMaterializedView) {
            binding = sessionViewTransport.prepareSelection(sid);
            claim = binding.beginPromptClaim(classification);
            attachViewBinding(binding);
            sessionViewTransport.activate(binding, "visible");
          } else {
            ({ binding, claim } = sessionViewTransport.beginPrompt(sid, false, classification));
            viewBindingRef.current = binding;
            viewSnapshotRef.current = binding.getSnapshot();
          }
          dispatchedClaim = claim;
          currentPromptClaimRef.current = claim;
          await binding.waitUntilAttached();
          if (selectedModel) {
            setPendingModel(selectedModel);
            if (existingSid) {
              await sendAgentCommand(sid, { type: "set_model", provider: selectedModel.provider, modelId: selectedModel.modelId });
            }
          }
          await sendAgentCommand(sid, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
          claim.accepted(() => probePromptSettlement(sid));
          promoteNewSession(1, message);
        } else {
          throw new Error("Failed to create session");
        }
      } else if (session) {
        sentSessionId = session.id;
        const binding = viewBindingRef.current ?? sessionViewBinding;
        if (!binding) throw new Error("Session view is unavailable");
        attachViewBinding(binding);
        const claim = binding.beginPromptClaim(isSlashCommandPrompt ? "slash_command" : "prompt");
        dispatchedClaim = claim;
        currentPromptClaimRef.current = claim;
        await binding.waitUntilAttached();
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
        claim.accepted(() => probePromptSettlement(session.id));
      }
      if (!sentSessionId) throw new Error("Session is unavailable");
      if (isSlashCommandPrompt) {
        void waitForPromptSettlement(sentSessionId, promptRunId);
      }
      return true;
    } catch (e) {
      const transcriptCovered = promptTranscriptFloor !== null
        && promptTranscriptFloorRef.current === promptTranscriptFloor
        && promptTranscriptFloor.covered;
      if (transcriptCovered && dispatchedClaim && sentSessionId) {
        const settlementSessionId = sentSessionId;
        dispatchedClaim.accepted(() => probePromptSettlement(settlementSessionId));
      }
      const failureOutcome = transcriptCovered ? "covered" : dispatchedClaim?.failed() ?? "rolled_back";
      if (failureOutcome === "covered") {
        // The exact page lineage already observed ordered canonical activity
        // or settlement. A lost/failed HTTP response cannot undo an executing
        // prompt, its optimistic bubble, composer acceptance, or completion.
        // Materialized new sessions still cross the same generation-guarded
        // AppShell adoption boundary as a successful prompt response. A stale
        // screen reaches only the callback's discovery refresh path.
        if (isNew && sentSessionId) promoteNewSession(1, message);
        return true;
      }
      currentPromptClaimRef.current = null;
      if (promptTranscriptFloor !== null && promptTranscriptFloorRef.current === promptTranscriptFloor) {
        promptTranscriptFloorRef.current = null;
      }
      const restorePinnedLeaf = followsLiveTip
        && priorPinnedLeafId !== null
        && leafGenerationRef.current === promptLeafGeneration;
      if (restorePinnedLeaf) {
        pinnedLeafIdRef.current = priorPinnedLeafId;
        pinnedPromptBaseLeafIdRef.current = priorPinnedPromptBaseLeafId;
        leafGenerationRef.current += 1;
        setActiveLeafId(priorPinnedLeafId);
      }
      const optimisticKey = optimisticUserMessageKeyRef.current;
      if (optimisticKey) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return last?.role === "user" && userMessageKey(last) === optimisticKey
            ? prev.slice(0, -1)
            : prev;
        });
      }
      promptUiGenerationRef.current += 1;
      addNotice({ type: "error", message: e instanceof Error ? e.message : "Failed to send message" });
      optimisticUserMessageKeyRef.current = null;
      agentRunningRef.current = false;
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
      promptClassificationRef.current = null;
      if (restorePinnedLeaf) scheduleHttpRepair("context");
      if (selectedMaterializedView && (isNewScreenCurrent?.(newScreenGeneration) ?? false)) {
        sessionViewTransport.select(null);
      }
      return false;
    }
  }, [isNew, newSessionCwd, newSessionModel, newScreenGeneration, isNewScreenCurrent, session, sessionViewBinding, sessionViewTransport, agentRunning, activeLeafId, messages, entryIds, ensureNewSession, attachViewBinding, promoteNewSession, waitForPromptSettlement, probePromptSettlement, addNotice, scheduleHttpRepair]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  const navigateToLeaf = useCallback(async (leafId: string): Promise<LeafNavigationOutcome> => {
    const sid = sessionIdRef.current;
    if (!sid) return "failed";
    const previousTransition = pendingLeafNavigationRef.current;
    if (!previousTransition) {
      confirmedLeafIntentRef.current = {
        pinnedLeafId: pinnedLeafIdRef.current,
        promptBaseLeafId: pinnedPromptBaseLeafIdRef.current,
        activeLeafId,
      };
    }
    const promptBaseLeafId = nativePromptBaseForTreeTarget(data?.tree ?? [], leafId);
    pinnedLeafIdRef.current = leafId;
    pinnedPromptBaseLeafIdRef.current = promptBaseLeafId;
    leafGenerationRef.current += 1;
    const navigationGeneration = leafGenerationRef.current;
    promptUiGenerationRef.current += 1;
    setActiveLeafId(leafId);

    const finishNavigation = (succeeded: boolean): LeafNavigationOutcome => {
      if (succeeded) {
        confirmedLeafIntentRef.current = {
          pinnedLeafId: leafId,
          promptBaseLeafId,
          activeLeafId: leafId,
        };
      }
      const isCurrent = pendingLeafNavigationRef.current?.generation === navigationGeneration
        && leafGenerationRef.current === navigationGeneration
        && pinnedLeafIdRef.current === leafId;
      if (!isCurrent) return "superseded";
      pendingLeafNavigationRef.current = null;
      if (succeeded) return "succeeded";

      const confirmed = confirmedLeafIntentRef.current;
      pinnedLeafIdRef.current = confirmed.pinnedLeafId;
      pinnedPromptBaseLeafIdRef.current = confirmed.promptBaseLeafId;
      leafGenerationRef.current += 1;
      promptUiGenerationRef.current += 1;
      setActiveLeafId(confirmed.activeLeafId);
      scheduleHttpRepair(confirmed.pinnedLeafId === null ? "transcript" : "context");
      return "failed";
    };

    const promise = (async (): Promise<LeafNavigationOutcome> => {
      if (previousTransition) await previousTransition.promise;
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean }>(sid, {
          type: "navigate_tree",
          targetId: leafId,
        });
        return finishNavigation(!result?.cancelled);
      } catch {
        return finishNavigation(false);
      }
    })();
    pendingLeafNavigationRef.current = { generation: navigationGeneration, promise };
    const contextRequest = loadContext(sid, leafId);
    const [outcome] = await Promise.all([promise, contextRequest]);
    return outcome;
  }, [activeLeafId, data?.tree, loadContext, scheduleHttpRepair]);

  const handleNavigate = useCallback(async (entryId: string) => {
    await navigateToLeaf(entryId);
  }, [navigateToLeaf]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    if (leafId !== null) {
      await navigateToLeaf(leafId);
      return;
    }
    const navigationGeneration = leafGenerationRef.current + 1;
    pinnedLeafIdRef.current = null;
    pinnedPromptBaseLeafIdRef.current = null;
    leafGenerationRef.current = navigationGeneration;
    promptUiGenerationRef.current += 1;
    setActiveLeafId(null);
    while (pendingLeafNavigationRef.current) {
      const transition = pendingLeafNavigationRef.current;
      await transition.promise;
      if (pendingLeafNavigationRef.current === transition) pendingLeafNavigationRef.current = null;
    }
    if (leafGenerationRef.current !== navigationGeneration) return;
    const sid = sessionIdRef.current;
    if (sid) await loadSession(sid);
  }, [loadSession, navigateToLeaf]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      setPendingModel({ provider, modelId });
      const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew, setNewSessionModel]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    setCompactResult(null);
    promptClassificationRef.current = "compaction";
    try {
      const result = await sendAgentCommand<CompactCommandResult>(sid, { type: "compact" });
      setCompactResult(readCompactResult(result, "manual"));
      promptTranscriptFloorRef.current = null;
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
      setCompactResult(null);
    } finally {
      promptClassificationRef.current = null;
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const loadModels = useCallback(async (signal?: AbortSignal) => {
    const modelCwd = newSessionCwd ?? session?.cwd ?? "";
    const modelsUrl = modelCwd ? `/api/models?cwd=${encodeURIComponent(modelCwd)}` : "/api/models";
    const res = await fetch(modelsUrl, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as ModelsResponse;
    setModelNames(d.models);
    setModelThinkingLevels(d.thinkingLevels ?? {});
    setModelThinkingLevelMaps(d.thinkingLevelMaps ?? {});
    const nextModelList = d.modelList ?? [];
    setModelList(nextModelList);
    if (isNew) {
      const match = d.defaultModel
        ? nextModelList.find((m) => m.id === d.defaultModel?.modelId && m.provider === d.defaultModel?.provider)
        : undefined;
      const displayModel = match ?? nextModelList[0];
      setNewSessionDefaultModel(displayModel ? { provider: displayModel.provider, modelId: displayModel.id } : null);
    }
  }, [isNew, newSessionCwd, session?.cwd]);

  const handleBuiltinSlashCommand = useCallback(async (text: string): Promise<BuiltinSlashCommandResult> => {
    const normalizedText = text.trim();
    if (!normalizedText.startsWith("/")) return { handled: false };
    const match = normalizedText.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { handled: false };

    const [, commandName, rawArgs = ""] = match;
    const args = rawArgs.trim();
    const complete = (result: BuiltinSlashCommandResult): BuiltinSlashCommandResult => {
      if (!result.handled) return result;
      if (result.error) {
        addNotice({ type: "error", message: result.error });
      } else if (result.action !== "openSessionStats") {
        addNotice({ type: "success", message: result.message ?? "Command completed" });
      }
      return result;
    };

    if (commandName === "clone") {
      if (!isExactCloneCommand(normalizedText)) return { handled: false };
      if (cloneInFlightRef.current) return cloneInFlightRef.current;

      const invocation = (async (): Promise<BuiltinSlashCommandResult> => {
        if (agentRunningRef.current) {
          return complete({ handled: true, error: "Wait for the current run to finish before cloning" });
        }

        const sid = sessionIdRef.current;
        if (!sid || !activeLeafId) {
          return complete({ handled: true, error: "Nothing to clone yet" });
        }

        try {
          const result = await sendAgentCommand<CloneCommandResult>(sid, {
            type: "clone",
            activeLeafId,
          });
          if (result.created) {
            const completed = complete({ handled: true, message: "Cloned session — available in sidebar" });
            onSessionCloned?.();
            return completed;
          }

          switch (result.reason) {
            case "busy":
              return complete({ handled: true, error: "Wait for the current run to finish before cloning" });
            case "nothing_to_clone":
              return complete({ handled: true, error: "Nothing to clone yet" });
            case "missing_source":
              return complete({ handled: true, error: "Session is no longer available" });
            case "stale_leaf":
              return complete({ handled: true, error: "The selected branch changed; reload and try again" });
            case "clone_failed":
            default:
              return complete({ handled: true, error: "Could not clone session" });
          }
        } catch (error) {
          const message = error instanceof Error && error.message === "Session not found"
            ? "Session is no longer available"
            : "Could not clone session";
          return complete({ handled: true, error: message });
        }
      })();

      cloneInFlightRef.current = invocation;
      try {
        return await invocation;
      } finally {
        if (cloneInFlightRef.current === invocation) cloneInFlightRef.current = null;
      }
    }

    const sid = sessionIdRef.current ?? await ensureNewSession();
    try {
      switch (commandName) {
        case "compact": {
          if (!sid || isCompacting) return complete({ handled: true, error: "No active session to compact" });
          setIsCompacting(true);
          setCompactError(null);
          setCompactResult(null);
          const result = await sendAgentCommand<CompactCommandResult>(sid, {
            type: "compact",
            ...(args ? { customInstructions: args } : {}),
          });
          setCompactResult(readCompactResult(result, "manual"));
          promptTranscriptFloorRef.current = null;
          if (await loadSession(sid, true)) promoteNewSession();
          return complete({ handled: true, message: "Compacted context" });
        }

        case "reload": {
          if (!sid) return complete({ handled: true, error: "No active session to reload" });
          await sendAgentCommand(sid, { type: "reload" });
          await Promise.all([
            loadSession(sid, false, true),
            loadTools(sid),
            loadSlashCommands(),
            loadModels(),
          ]);
          return complete({ handled: true, message: "Reloaded session resources" });
        }

        case "name": {
          if (!sid) return complete({ handled: true, error: "No active session to name" });
          if (!args) return complete({ handled: true, error: "Usage: /name <name>" });
          await sendAgentCommand(sid, { type: "set_session_name", name: args });
          if (await loadSession(sid)) promoteNewSession();
          return complete({ handled: true, message: `Session renamed to ${args}` });
        }

        case "session": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const stats = await sendAgentCommand<SessionStatsInfo>(sid, { type: "get_session_stats" });
          if (stats) {
            setSessionStatsOverride(stats);
          }
          onSessionStatsPanelOpen?.();
          return complete({ handled: true, action: "openSessionStats" });
        }

        case "copy": {
          if (!sid) return complete({ handled: true, error: "No active session" });
          const data = await sendAgentCommand<LastAssistantTextResponse>(sid, { type: "get_last_assistant_text" });
          const textToCopy = data?.text ?? "";
          if (!textToCopy) return complete({ handled: true, error: "No assistant message to copy" });
          await navigator.clipboard.writeText(textToCopy);
          return complete({ handled: true, message: "Copied last assistant message" });
        }

        default:
          return { handled: false };
      }
    } catch (e) {
      return complete({ handled: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (commandName === "compact") setIsCompacting(false);
    }
  }, [activeLeafId, addNotice, ensureNewSession, isCompacting, loadModels, loadSession, loadSlashCommands, loadTools, onSessionCloned, promoteNewSession, onSessionStatsPanelOpen]);

  // Queued (undelivered) messages live in the queue panel only; the chat gets
  // the real user message when pi delivers it (user message_end event). An
  // optimistic chat bubble here would duplicate the queue panel and turn into
  // a ghost message if the queue is recalled.
  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, []);

  const handlePromptWithStreamingBehavior = useCallback(async (
    message: string,
    behavior: "steer" | "followUp",
    images?: AttachedImage[],
  ) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "prompt",
        message,
        streamingBehavior: behavior,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to queue prompt:", e);
    }
  }, []);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, []);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleRecallQueue = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ steering?: string[]; followUp?: string[] }>(sid, { type: "clear_queue" });
      // clearQueue also projects an empty queue state, but clear locally so
      // idle recalls update immediately while transport recovery is pending.
      setQueuedMessages({ steering: [], followUp: [] });
      const texts = [...(result?.steering ?? []), ...(result?.followUp ?? [])];
      if (texts.length > 0) {
        opts.chatInputRef?.current?.prependText(texts.join("\n\n"));
      }
    } catch (e) {
      console.error("Failed to recall queued messages:", e);
      addNotice({ type: "error", message: "Failed to recall queued messages" });
    }
  }, [opts.chatInputRef, addNotice]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const handleToolPresetChange = useCallback(async (preset: "none" | "default" | "full") => {
    const toolNames = getToolNamesForPreset(preset);
    setToolPresetState(preset);
    const sid = sessionIdRef.current ?? await ensuringNewSessionRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames });
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, [setToolPresetState]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    ignoreProgrammaticScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_IGNORE_MS;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  const markUserScrollIntent = useCallback((event: Event) => {
    if (event instanceof KeyboardEvent) {
      if (!SCROLL_KEYS.has(event.key)) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
    }
    userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    if (!agentRunningRef.current) return;
    if (Date.now() < ignoreProgrammaticScrollUntilRef.current) return;
    if (Date.now() > userScrollIntentUntilRef.current) return;
    completionScrollAllowedRef.current = false;
  }, []);

  // Attach the provider-owned selected binding before initial HTTP repair.
  // Keyed hook cleanup removes only UI consumers; the page view controller
  // independently retains or releases the socket from canonical activity/claim.
  useEffect(() => {
    hookMountedRef.current = true;
    const settlementWaits = settlementWaitsRef.current;
    if (session && sessionViewBinding) {
      sessionIdRef.current = session.id;
      attachViewBinding(sessionViewBinding);
      // AppShell prepared B without changing A. Consumers now exist, so this
      // exact activation acquires B first and only then relabels/releases A.
      sessionViewTransport.activate?.(sessionViewBinding, "visible");
      loadSession(session.id, true, true).then((agentState) => {
        if (agentState?.running) {
          loadTools(session.id);
          if (agentState.state?.isStreaming || agentState.state?.isPromptRunning) {
            if (!agentState.state.isStreaming && agentState.state.isPromptRunning) {
              promptClassificationRef.current = "slash_command";
              applyProjectedSnapshotRef.current?.(sessionViewBinding.getSnapshot());
              void waitForPromptSettlement(session.id);
            }
          }
        }
      });
    }
    return () => {
      hookMountedRef.current = false;
      unsubscribeViewSnapshotRef.current?.();
      unsubscribeViewEffectsRef.current?.();
      unsubscribeViewCompletionsRef.current?.();
      unsubscribeViewSnapshotRef.current = null;
      unsubscribeViewEffectsRef.current = null;
      unsubscribeViewCompletionsRef.current = null;
      for (const timer of Object.values(repairTimersRef.current)) clearTimeout(timer);
      repairTimersRef.current = {};
      for (const wait of [...settlementWaits]) wait.cancel();
      applyProjectedSnapshotRef.current = null;
      applyProjectedEffectRef.current = null;
    };
    // The keyed chat lifetime intentionally binds these mount-time identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  useEffect(() => {
    window.addEventListener("keydown", markUserScrollIntent);
    window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    return () => {
      window.removeEventListener("keydown", markUserScrollIntent);
      window.removeEventListener("pointerdown", markUserScrollIntent);
    };
  }, [markUserScrollIntent]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", markUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", markUserScrollIntent, { passive: true });
    container.addEventListener("scroll", handleScrollPositionChange, { passive: true });
    return () => {
      container.removeEventListener("wheel", markUserScrollIntent);
      container.removeEventListener("touchstart", markUserScrollIntent);
      container.removeEventListener("scroll", handleScrollPositionChange);
    };
  }, [messages.length, loading, handleScrollPositionChange, markUserScrollIntent]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        scrollToBottom("instant");
      } else if (!agentRunningRef.current && completionScrollAllowedRef.current) {
        scrollToBottom("smooth");
      }
    }
  }, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  // Load model list
  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [loadModels, modelsRefreshKey]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  useEffect(() => {
    if (!compactResult) return;
    const t = setTimeout(() => setCompactResult(null), 6000);
    return () => clearTimeout(t);
  }, [compactResult]);

  useEffect(() => {
    if (noticeState.visible.length === 0) return;
    const exiting = noticeState.visible.find((notice) => notice.exiting);
    if (exiting) {
      const t = setTimeout(() => {
        dispatchNotice({ type: "remove", id: exiting.id });
      }, NOTICE_EXIT_ANIMATION_MS);
      return () => clearTimeout(t);
    }
    const oldest = noticeState.visible[0];
    if (!oldest) return;
    const t = setTimeout(() => {
      dispatchNotice({ type: "mark_oldest_exiting" });
    }, NOTICE_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [noticeState.visible]);

  useEffect(() => {
    setSessionStatsOverride(null);
  }, [messages.length, contextUsage?.tokens, contextUsage?.percent, contextUsage?.contextWindow]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, compactResult, currentModel, displayModel, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices: noticeState.visible, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection: isNew && newSessionModel === null,
    agentPhase,
    isNew,
    // Refs
    sessionIdRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadTools, loadSlashCommands, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId,
  };
}
