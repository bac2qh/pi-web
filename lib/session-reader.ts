import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { closeSync, openSync, readSync } from "fs";
import { readdir } from "fs/promises";
import { join, normalize as normalizePath } from "path";
import { StringDecoder } from "string_decoder";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { resolveProject, type ProjectInfo } from "./worktree";
import { projectSideSessionContext, type SideSessionMetadata } from "./side-session";

export { getAgentDir };

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(normalizePath(s.path), s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(normalizePath(s.parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export interface CompleteSessionListing {
  sessions: SessionInfo[];
  generation: number;
}

export interface CompleteSessionIdListing {
  sessionIds: ReadonlySet<string>;
  generation: number;
}

export function getSessionListGeneration(): number {
  return globalThis.__piSessionListGeneration ?? 0;
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__piSessionListGeneration ?? 0) === generation) {
      globalThis.__piSessionListCache = { data, ts: Date.now() };
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

/**
 * Return a session listing together with the cache generation that remained
 * current for the entire scan. A scan invalidated while it is in flight is
 * still useful to its original caller, but it is not safe for destructive
 * sidebar-state reconciliation, so retry against the newer generation.
 */
export async function listAllSessionsWithGeneration(maxAttempts = 4): Promise<CompleteSessionListing> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const generation = getSessionListGeneration();
    const sessions = await listAllSessions();
    if (getSessionListGeneration() === generation) return { sessions, generation };
  }
  throw new Error("Session listing changed repeatedly while it was being read");
}

/**
 * Discover exact session IDs without parsing transcript bodies or resolving
 * project metadata. This mirrors SessionManager.listAll()'s standard
 * non-recursive directory and symlink shape.
 */
export async function listSessionIdsFromRoot(sessionsDir: string): Promise<ReadonlySet<string>> {
  const sessionIds = new Set<string>();
  let entries;
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return sessionIds;
  }

  const directories = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(sessionsDir, entry.name));
  for (const directory of directories) {
    let files: string[];
    try {
      files = (await readdir(directory))
        .filter((fileName) => fileName.endsWith(".jsonl"))
        .map((fileName) => join(directory, fileName));
    } catch {
      continue;
    }
    for (const filePath of files) {
      try {
        const header = readSessionHeader(filePath);
        if (header && typeof header.id === "string") sessionIds.add(header.id);
      } catch {
        // Discovery is best-effort: one unreadable or raced-away file must not
        // prevent other standard sessions from authorizing a DAG mutation.
      }
    }
  }
  return sessionIds;
}

/**
 * Return a fresh exact-ID listing whose cache generation remained current for
 * the complete bounded-header scan. Unlike the metadata listing, this path is
 * deliberately uncached so every DAG authority attempt gets a fresh set.
 */
export async function listAllSessionIdsWithGeneration(
  maxAttempts = 4,
  sessionsDir = join(getAgentDir(), "sessions"),
): Promise<CompleteSessionIdListing> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const generation = getSessionListGeneration();
    const sessionIds = await listSessionIdsFromRoot(sessionsDir);
    if (getSessionListGeneration() === generation) return { sessionIds, generation };
  }
  throw new Error("Session listing changed repeatedly while it was being read");
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = normalizePath(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const pathKey = normalizePath(filePath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousSessionId = reverseCache.get(pathKey);
  if (previousPath && previousPath !== pathKey && reverseCache.get(previousPath) === sessionId) {
    reverseCache.delete(previousPath);
  }
  if (previousSessionId && previousSessionId !== sessionId && pathCache.get(previousSessionId) === pathKey) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, pathKey);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  if (filePath && reverseCache.get(filePath) === sessionId) {
    reverseCache.delete(filePath);
  }
}

const SESSION_HEADER_READ_BUFFER_SIZE = 4 * 1024;
const MAX_SESSION_HEADER_SCAN_BYTES = 1024 * 1024;

function parseSessionHeaderCandidate(line: string): SessionHeader | null | undefined {
  if (!line.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return null;
  const header = value as Partial<SessionHeader>;
  return header.type === "session" && typeof header.id === "string"
    ? header as SessionHeader
    : null;
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(SESSION_HEADER_READ_BUFFER_SIZE);
    const lineChunks: string[] = [];
    let scannedBytes = 0;

    while (scannedBytes < MAX_SESSION_HEADER_SCAN_BYTES) {
      const readLength = Math.min(buffer.length, MAX_SESSION_HEADER_SCAN_BYTES - scannedBytes);
      const bytesRead = readSync(fd, buffer, 0, readLength, null);
      if (bytesRead === 0) {
        lineChunks.push(decoder.end());
        return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
      }
      scannedBytes += bytesRead;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      let lineStart = 0;
      let newlineIndex = chunk.indexOf("\n", lineStart);
      while (newlineIndex !== -1) {
        lineChunks.push(chunk.slice(lineStart, newlineIndex));
        const header = parseSessionHeaderCandidate(lineChunks.join(""));
        if (header !== undefined) return header;
        lineChunks.length = 0;
        lineStart = newlineIndex + 1;
        newlineIndex = chunk.indexOf("\n", lineStart);
      }
      lineChunks.push(chunk.slice(lineStart));
    }

    const probe = Buffer.allocUnsafe(1);
    if (readSync(fd, probe, 0, probe.length, null) === 0) {
      lineChunks.push(decoder.end());
      return parseSessionHeaderCandidate(lineChunks.join("")) ?? null;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: {
    deferThinking?: boolean;
    deferToolResultImages?: boolean;
    sideSession?: SideSessionMetadata;
  } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  const context: SessionContext = {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
  return options.sideSession
    ? projectSideSessionContext(context, entries, options.sideSession)
    : context;
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      return null;
  }
}
