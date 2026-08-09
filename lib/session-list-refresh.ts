import { invalidateSessionListCache } from "./session-reader";

declare global {
  var __piSessionListRefreshListeners: Set<(generation: number) => void> | undefined;
  var __piSessionListRefreshGeneration: number | undefined;
}

function getSessionListRefreshListeners(): Set<(generation: number) => void> {
  if (!globalThis.__piSessionListRefreshListeners) {
    globalThis.__piSessionListRefreshListeners = new Set();
  }
  return globalThis.__piSessionListRefreshListeners;
}

/** Subscribe to a request to reload the ordinary native session list. */
export function subscribeSessionListRefresh(listener: (generation: number) => void): () => void {
  const listeners = getSessionListRefreshListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Current replay token for initial and reconnected session-discovery consumers. */
export function getSessionListRefreshGeneration(): number {
  return globalThis.__piSessionListRefreshGeneration ?? 0;
}

/** Invalidate server discovery and prompt connected browsers to reload it. */
export function notifySessionListRefresh(): void {
  invalidateSessionListCache();
  const generation = getSessionListRefreshGeneration() + 1;
  globalThis.__piSessionListRefreshGeneration = generation;
  for (const listener of getSessionListRefreshListeners()) {
    try { listener(generation); } catch { /* listener failures are isolated */ }
  }
}
