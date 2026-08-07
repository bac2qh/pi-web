export const UNREAD_SESSION_IDS_STORAGE_KEY = "pi-web:unread-session-ids";

export interface UnreadSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): UnreadSessionStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

/**
 * Read the existing browser-local unread set. Storage access and malformed
 * payloads fail safely because unread is presentation state only.
 */
export function loadUnreadSessionIds(storage?: UnreadSessionStorage | null): Set<string> {
  try {
    const target = storage === undefined ? getBrowserStorage() : storage;
    if (!target) return new Set();
    const raw = target.getItem(UNREAD_SESSION_IDS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/** Persist the unread set without making storage availability user-visible. */
export function saveUnreadSessionIds(
  ids: ReadonlySet<string>,
  storage?: UnreadSessionStorage | null,
): void {
  try {
    const target = storage === undefined ? getBrowserStorage() : storage;
    if (!target) return;
    if (ids.size === 0) target.removeItem(UNREAD_SESSION_IDS_STORAGE_KEY);
    else target.setItem(UNREAD_SESSION_IDS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage quota, disabled-storage, and privacy-mode errors.
  }
}

/** Return the original set for an idempotent update so React can skip a render. */
export function setSessionUnread(
  ids: Set<string>,
  sessionId: string,
  isUnread: boolean,
): Set<string> {
  if (ids.has(sessionId) === isUnread) return ids;
  const next = new Set(ids);
  if (isUnread) next.add(sessionId);
  else next.delete(sessionId);
  return next;
}

/** Remove unread IDs only after a caller has a complete authoritative listing. */
export function pruneUnreadSessionIds(
  ids: Set<string>,
  existingSessionIds: ReadonlySet<string>,
): Set<string> {
  if (ids.size === 0) return ids;
  const next = new Set([...ids].filter((id) => existingSessionIds.has(id)));
  return next.size === ids.size ? ids : next;
}

export function getBackgroundCompletedSessionIds(
  previousRunningSessionIds: ReadonlySet<string>,
  runningSessionIds: ReadonlySet<string>,
  selectedSessionId: string | null,
): string[] {
  return [...previousRunningSessionIds].filter(
    (id) => !runningSessionIds.has(id) && id !== selectedSessionId,
  );
}

/**
 * Preserve the established automatic lifecycle: every currently running
 * session is read, then unselected sessions that just completed become unread.
 */
export function updateUnreadSessionIdsForRunningState(
  ids: Set<string>,
  runningSessionIds: ReadonlySet<string>,
  completedInBackgroundSessionIds: readonly string[],
): Set<string> {
  let next: Set<string> | null = null;
  const mutable = () => {
    if (!next) next = new Set(ids);
    return next;
  };

  for (const id of runningSessionIds) {
    if (ids.has(id)) mutable().delete(id);
  }
  for (const id of completedInBackgroundSessionIds) {
    const current = next ?? ids;
    if (!current.has(id)) mutable().add(id);
  }

  return next ?? ids;
}
