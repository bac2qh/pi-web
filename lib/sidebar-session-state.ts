import type { SessionInfo } from "./types";

export const SIDEBAR_STATE_VERSION = 1 as const;
export const RECENT_SESSION_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
export const MAX_SIDEBAR_STATE_IDS = 10_000;
export const MAX_SESSION_ID_LENGTH = 512;

export interface SidebarState {
  version: typeof SIDEBAR_STATE_VERSION;
  revision: number;
  pinnedSessionIds: string[];
  explicitlyHiddenSessionIds: string[];
}

export type SidebarOperationKind = "pin" | "unpin" | "hide" | "restore";

export interface SidebarStateOperation {
  operation: SidebarOperationKind;
  sessionId: string;
}

export type HiddenSessionKind = "explicit" | "inherited";

export interface SidebarSessionTreeNode {
  session: SessionInfo;
  children: SidebarSessionTreeNode[];
  latestVisibleDescendantModified: number;
}

export type SelectedSessionLineage =
  | { status: "unavailable" }
  | { status: "hidden"; hiddenKind: HiddenSessionKind }
  | {
      status: "available";
      selectedSession: SessionInfo;
      selectedAncestorSessionIds: string[];
      roots: SidebarSessionTreeNode[];
      sessionCount: number;
    };

export interface SidebarSessionLists {
  hiddenSessionKinds: Map<string, HiddenSessionKind>;
  presentedSessions: SessionInfo[];
  pinnedSessions: SessionInfo[];
  recentSessions: SessionInfo[];
  projectPrefixes: Map<string, string>;
  nextRecentExpiryAt: number | null;
}

export class SidebarStateValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidebarStateValueError";
  }
}

export function createDefaultSidebarState(): SidebarState {
  return {
    version: SIDEBAR_STATE_VERSION,
    revision: 0,
    pinnedSessionIds: [],
    explicitlyHiddenSessionIds: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidSidebarSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_SESSION_ID_LENGTH
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function parseIdArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_SIDEBAR_STATE_IDS) {
    throw new SidebarStateValueError(`${field} must be a bounded array`);
  }
  if (!value.every(isValidSidebarSessionId)) {
    throw new SidebarStateValueError(`${field} contains an invalid session id`);
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) {
    throw new SidebarStateValueError(`${field} contains duplicate session ids`);
  }
  return [...ids];
}

export function parseSidebarState(value: unknown): SidebarState {
  if (!isRecord(value)) throw new SidebarStateValueError("Sidebar state must be an object");
  const keys = Object.keys(value).sort();
  const expectedKeys = ["explicitlyHiddenSessionIds", "pinnedSessionIds", "revision", "version"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new SidebarStateValueError("Sidebar state has unsupported fields");
  }
  if (value.version !== SIDEBAR_STATE_VERSION) {
    throw new SidebarStateValueError("Sidebar state version is unsupported");
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new SidebarStateValueError("Sidebar state revision is invalid");
  }
  return {
    version: SIDEBAR_STATE_VERSION,
    revision: value.revision as number,
    pinnedSessionIds: parseIdArray(value.pinnedSessionIds, "pinnedSessionIds"),
    explicitlyHiddenSessionIds: parseIdArray(value.explicitlyHiddenSessionIds, "explicitlyHiddenSessionIds"),
  };
}

export function parseSidebarStateOperation(value: unknown): SidebarStateOperation {
  if (!isRecord(value)) throw new SidebarStateValueError("Sidebar operation must be an object");
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "operation" || keys[1] !== "sessionId") {
    throw new SidebarStateValueError("Sidebar operation has unsupported fields");
  }
  if (value.operation !== "pin" && value.operation !== "unpin" && value.operation !== "hide" && value.operation !== "restore") {
    throw new SidebarStateValueError("Sidebar operation kind is invalid");
  }
  if (!isValidSidebarSessionId(value.sessionId)) {
    throw new SidebarStateValueError("Sidebar operation session id is invalid");
  }
  return { operation: value.operation, sessionId: value.sessionId };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function buildChildrenIndex(sessions: readonly SessionInfo[]): Map<string, string[]> {
  const knownIds = new Set(sessions.map((session) => session.id));
  const children = new Map<string, string[]>();
  for (const session of sessions) children.set(session.id, []);
  for (const session of sessions) {
    const parentId = session.parentSessionId;
    if (!parentId || !knownIds.has(parentId)) continue;
    children.get(parentId)!.push(session.id);
  }
  for (const childIds of children.values()) childIds.sort((a, b) => a.localeCompare(b));
  return children;
}

function collectDescendantIds(children: Map<string, string[]>, rootId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    for (const childId of children.get(current) ?? []) pending.push(childId);
  }
  return descendants;
}

export function canonicalizeExplicitHiddenSessionIds(
  explicitIds: readonly string[],
  sessions: readonly SessionInfo[],
): string[] {
  const children = buildChildrenIndex(sessions);
  const kept: string[] = [];
  const closureByKeptId = new Map<string, Set<string>>();

  for (const sessionId of uniqueIds(explicitIds)) {
    if (kept.some((keptId) => closureByKeptId.get(keptId)!.has(sessionId))) continue;

    const sessionClosure = collectDescendantIds(children, sessionId);
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (sessionClosure.has(kept[index])) {
        closureByKeptId.delete(kept[index]);
        kept.splice(index, 1);
      }
    }
    kept.push(sessionId);
    closureByKeptId.set(sessionId, sessionClosure);
  }

  return kept;
}

export function getEffectiveHiddenSessionKinds(
  sessions: readonly SessionInfo[],
  explicitIds: readonly string[],
): Map<string, HiddenSessionKind> {
  const children = buildChildrenIndex(sessions);
  const knownIds = new Set(sessions.map((session) => session.id));
  const explicit = new Set(explicitIds.filter((sessionId) => knownIds.has(sessionId)));
  const hiddenKinds = new Map<string, HiddenSessionKind>();
  const pending: string[] = [];

  for (const sessionId of explicit) {
    hiddenKinds.set(sessionId, "explicit");
    pending.push(sessionId);
  }

  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const childId of children.get(current) ?? []) {
      const nextKind: HiddenSessionKind = explicit.has(childId) ? "explicit" : "inherited";
      const previousKind = hiddenKinds.get(childId);
      if (previousKind === "explicit" || previousKind === nextKind) continue;
      hiddenKinds.set(childId, nextKind);
      pending.push(childId);
    }
  }

  return hiddenKinds;
}

export function applySidebarStateOperation(
  state: SidebarState,
  operation: SidebarStateOperation,
  sessions: readonly SessionInfo[],
): SidebarState {
  let pinnedSessionIds = state.pinnedSessionIds;
  let explicitlyHiddenSessionIds = state.explicitlyHiddenSessionIds;

  switch (operation.operation) {
    case "pin":
      if (!pinnedSessionIds.includes(operation.sessionId)) {
        pinnedSessionIds = [operation.sessionId, ...pinnedSessionIds];
      }
      break;
    case "unpin":
      pinnedSessionIds = pinnedSessionIds.filter((sessionId) => sessionId !== operation.sessionId);
      break;
    case "hide":
      explicitlyHiddenSessionIds = canonicalizeExplicitHiddenSessionIds(
        [...explicitlyHiddenSessionIds, operation.sessionId],
        sessions,
      );
      break;
    case "restore":
      explicitlyHiddenSessionIds = canonicalizeExplicitHiddenSessionIds(
        explicitlyHiddenSessionIds.filter((sessionId) => sessionId !== operation.sessionId),
        sessions,
      );
      break;
  }

  return {
    ...state,
    pinnedSessionIds,
    explicitlyHiddenSessionIds,
  };
}

export function replaySidebarStateOperations(
  confirmedState: SidebarState,
  pendingOperations: readonly SidebarStateOperation[],
  sessions: readonly SessionInfo[],
): SidebarState {
  return pendingOperations.reduce(
    (state, operation) => applySidebarStateOperation(state, operation, sessions),
    confirmedState,
  );
}

export function reconcileSidebarState(
  state: SidebarState,
  sessions: readonly SessionInfo[],
): SidebarState {
  const knownIds = new Set(sessions.map((session) => session.id));
  return {
    ...state,
    pinnedSessionIds: state.pinnedSessionIds.filter((sessionId) => knownIds.has(sessionId)),
    explicitlyHiddenSessionIds: canonicalizeExplicitHiddenSessionIds(
      state.explicitlyHiddenSessionIds.filter((sessionId) => knownIds.has(sessionId)),
      sessions,
    ),
  };
}

export function sidebarStateContentEquals(left: SidebarState, right: SidebarState): boolean {
  return left.pinnedSessionIds.length === right.pinnedSessionIds.length
    && left.explicitlyHiddenSessionIds.length === right.explicitlyHiddenSessionIds.length
    && left.pinnedSessionIds.every((sessionId, index) => sessionId === right.pinnedSessionIds[index])
    && left.explicitlyHiddenSessionIds.every((sessionId, index) => sessionId === right.explicitlyHiddenSessionIds[index]);
}

export function acceptAuthoritativeSidebarState(
  currentState: SidebarState,
  incomingState: SidebarState,
): SidebarState {
  return incomingState.revision >= currentState.revision ? incomingState : currentState;
}

export function resolvePinnedSessions(
  sessions: readonly SessionInfo[],
  pinnedSessionIds: readonly string[],
): SessionInfo[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return pinnedSessionIds.flatMap((sessionId) => {
    const session = sessionsById.get(sessionId);
    return session ? [session] : [];
  });
}

function modifiedTime(session: SessionInfo): number {
  const parsed = Date.parse(session.modified);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareSessionsByActivity(left: SessionInfo, right: SessionInfo): number {
  const timeDifference = modifiedTime(right) - modifiedTime(left);
  return timeDifference || left.id.localeCompare(right.id);
}

export function deriveRecentSessions(
  sessions: readonly SessionInfo[],
  pinnedSessionIds: readonly string[],
  now: number,
): SessionInfo[] {
  const pinnedIds = new Set(pinnedSessionIds);
  const threshold = now - RECENT_SESSION_WINDOW_MS;
  return sessions
    .filter((session) => !pinnedIds.has(session.id) && modifiedTime(session) >= threshold)
    .sort(compareSessionsByActivity);
}

export function getNextRecentExpiryAt(sessions: readonly SessionInfo[], now: number): number | null {
  let nextExpiry: number | null = null;
  const threshold = now - RECENT_SESSION_WINDOW_MS;
  for (const session of sessions) {
    const activity = modifiedTime(session);
    if (activity < threshold) continue;
    const expiry = activity + RECENT_SESSION_WINDOW_MS + 1;
    if (nextExpiry === null || expiry < nextExpiry) nextExpiry = expiry;
  }
  return nextExpiry;
}

function projectKey(session: SessionInfo): string {
  return session.projectRoot ?? session.cwd;
}

function normalizeDisplayPath(path: string): string {
  if (path === "/" || path === "\\") return "/";
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "");
}

function splitDisplayPath(path: string): string[] {
  return normalizeDisplayPath(path).split("/").filter(Boolean);
}

function suffixForDepth(path: string, depth: number): string {
  const normalized = normalizeDisplayPath(path);
  const segments = splitDisplayPath(normalized);
  if (segments.length === 0) return normalized || "/";
  const suffix = segments.slice(-Math.min(depth, segments.length)).join("/");
  if (depth > segments.length && normalized.startsWith("/")) return `/${suffix}`;
  return suffix;
}

export function deriveShortestUniqueProjectPrefixes(
  sessionsOrProjectRoots: readonly SessionInfo[] | readonly string[],
): Map<string, string> {
  const roots = uniqueIds(
    sessionsOrProjectRoots.map((value) => typeof value === "string" ? value : projectKey(value)),
  );
  const prefixes = new Map<string, string>();
  const maxDepth = Math.max(1, ...roots.map((root) => splitDisplayPath(root).length + 1));

  for (const root of roots) {
    let label = suffixForDepth(root, 1);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const candidate = suffixForDepth(root, depth);
      const collides = roots.some((otherRoot) => (
        otherRoot !== root && suffixForDepth(otherRoot, depth) === candidate
      ));
      label = candidate;
      if (!collides) break;
    }
    prefixes.set(root, label);
  }

  return prefixes;
}

function isInParentCycle(sessionId: string, parentById: Map<string, string>): boolean {
  const visited = new Set<string>([sessionId]);
  let current = sessionId;
  while (true) {
    const parentId = parentById.get(current);
    if (!parentId) return false;
    if (parentId === sessionId) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    current = parentId;
  }
}

function compareTreeNodes(left: SidebarSessionTreeNode, right: SidebarSessionTreeNode): number {
  const descendantDifference = right.latestVisibleDescendantModified - left.latestVisibleDescendantModified;
  if (descendantDifference) return descendantDifference;
  const ownDifference = modifiedTime(right.session) - modifiedTime(left.session);
  return ownDifference || left.session.id.localeCompare(right.session.id);
}

export function buildVisibleProjectSessionTree(sessions: readonly SessionInfo[]): SidebarSessionTreeNode[] {
  const nodesById = new Map<string, SidebarSessionTreeNode>();
  for (const session of sessions) {
    nodesById.set(session.id, {
      session,
      children: [],
      latestVisibleDescendantModified: modifiedTime(session),
    });
  }

  const candidateParentById = new Map<string, string>();
  for (const session of nodesById.values()) {
    const parentId = session.session.parentSessionId;
    if (parentId && nodesById.has(parentId)) candidateParentById.set(session.session.id, parentId);
  }

  const roots: SidebarSessionTreeNode[] = [];
  for (const node of nodesById.values()) {
    const sessionId = node.session.id;
    const parentId = isInParentCycle(sessionId, candidateParentById)
      ? undefined
      : candidateParentById.get(sessionId);
    if (parentId) nodesById.get(parentId)!.children.push(node);
    else roots.push(node);
  }

  const finalize = (node: SidebarSessionTreeNode): number => {
    let newest = modifiedTime(node.session);
    for (const child of node.children) newest = Math.max(newest, finalize(child));
    node.latestVisibleDescendantModified = newest;
    node.children.sort(compareTreeNodes);
    return newest;
  };
  for (const root of roots) finalize(root);
  roots.sort(compareTreeNodes);
  return roots;
}

function findLineageBoundarySessionId(
  selectedSessionId: string,
  sessionsById: ReadonlyMap<string, SessionInfo>,
): string {
  const path: string[] = [];
  const pathIndexById = new Map<string, number>();
  let currentId = selectedSessionId;

  while (true) {
    const existingIndex = pathIndexById.get(currentId);
    if (existingIndex !== undefined) {
      return [...path.slice(existingIndex)].sort((left, right) => left.localeCompare(right))[0];
    }
    pathIndexById.set(currentId, path.length);
    path.push(currentId);

    const parentId = sessionsById.get(currentId)?.parentSessionId;
    if (!parentId || !sessionsById.has(parentId)) return currentId;
    currentId = parentId;
  }
}

function findRenderedAncestorSessionIds(
  roots: readonly SidebarSessionTreeNode[],
  selectedSessionId: string,
): string[] {
  const pending = [...roots]
    .reverse()
    .map((node) => ({ node, ancestorSessionIds: [] as string[] }));

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.node.session.id === selectedSessionId) return current.ancestorSessionIds;
    const childAncestorSessionIds = [...current.ancestorSessionIds, current.node.session.id];
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        node: current.node.children[index],
        ancestorSessionIds: childAncestorSessionIds,
      });
    }
  }

  return [];
}

export function deriveSelectedSessionLineage(
  allSessions: readonly SessionInfo[],
  presentedSessions: readonly SessionInfo[],
  hiddenSessionKinds: ReadonlyMap<string, HiddenSessionKind>,
  selectedSessionId: string | null,
): SelectedSessionLineage {
  if (!selectedSessionId) return { status: "unavailable" };

  const sessionsById = new Map(allSessions.map((session) => [session.id, session]));
  const selectedSession = sessionsById.get(selectedSessionId);
  if (!selectedSession) return { status: "unavailable" };

  const presentedSessionIds = new Set(presentedSessions.map((session) => session.id));
  if (!presentedSessionIds.has(selectedSessionId)) {
    const hiddenKind = hiddenSessionKinds.get(selectedSessionId);
    return hiddenKind
      ? { status: "hidden", hiddenKind }
      : { status: "unavailable" };
  }

  const boundarySessionId = findLineageBoundarySessionId(selectedSessionId, sessionsById);
  const familySessionIds = collectDescendantIds(buildChildrenIndex(allSessions), boundarySessionId);
  const familySessions = presentedSessions.filter((session) => familySessionIds.has(session.id));
  const roots = buildVisibleProjectSessionTree(familySessions);

  return {
    status: "available",
    selectedSession,
    selectedAncestorSessionIds: findRenderedAncestorSessionIds(roots, selectedSessionId),
    roots,
    sessionCount: familySessions.length,
  };
}

export function deriveSidebarSessionLists(
  allSessions: readonly SessionInfo[],
  state: SidebarState,
  showHidden: boolean,
  now: number,
): SidebarSessionLists {
  const hiddenSessionKinds = getEffectiveHiddenSessionKinds(
    allSessions,
    state.explicitlyHiddenSessionIds,
  );
  const presentedSessions = showHidden
    ? [...allSessions]
    : allSessions.filter((session) => !hiddenSessionKinds.has(session.id));
  const pinnedSessions = resolvePinnedSessions(presentedSessions, state.pinnedSessionIds);
  const recentSessions = deriveRecentSessions(presentedSessions, state.pinnedSessionIds, now);
  return {
    hiddenSessionKinds,
    presentedSessions,
    pinnedSessions,
    recentSessions,
    projectPrefixes: deriveShortestUniqueProjectPrefixes(presentedSessions),
    nextRecentExpiryAt: getNextRecentExpiryAt(recentSessions, now),
  };
}

export function getSessionDisplayTitle(session: SessionInfo): string {
  return session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
}

export function getGlobalSessionPrefix(
  session: SessionInfo,
  projectPrefixes: ReadonlyMap<string, string>,
): string {
  const root = projectKey(session);
  const projectPrefix = projectPrefixes.get(root) ?? suffixForDepth(root, 1);
  return session.worktreeBranch ? `${projectPrefix} · ${session.worktreeBranch}` : projectPrefix;
}

export function getLineageSessionPrefix(
  session: SessionInfo,
  selectedSession: SessionInfo,
  projectPrefixes: ReadonlyMap<string, string>,
): string | undefined {
  const sharesContext = projectKey(session) === projectKey(selectedSession)
    && session.cwd === selectedSession.cwd
    && session.worktreeBranch === selectedSession.worktreeBranch;
  return sharesContext ? undefined : getGlobalSessionPrefix(session, projectPrefixes);
}
