import {
  getRunningRpcSessionProjection,
  getSessionListRefreshGeneration,
  subscribeRunningSessions,
  subscribeSessionListRefresh,
  type RunningSessionIdsView,
} from "./rpc-manager";
import {
  GLOBAL_STATUS_CHANNEL,
  GLOBAL_STATUS_PROTOCOL,
  GLOBAL_STATUS_VERSION,
  type GlobalRunningFrame,
  type GlobalStatusFrame,
} from "./global-status-protocol";
import type {
  PiWebOwnerCloseReason,
  PiWebTransportChannelHandler,
  PiWebTransportGatewayV1,
} from "./websocket-gateway";

const GLOBAL_STATUS_REGISTRATION_SYMBOL = Symbol.for("pi-web.global-status-channel.v1");
const GLOBAL_STATUS_REGISTRATION_OWNER = "pi-web" as const;
export const GLOBAL_STATUS_OUTPUT_BYTES = 4 * 1024 * 1024;
const GLOBAL_STATUS_CLOSE_FALLBACK_MS = 1_000;

type GlobalSubscriberClose = (reason: PiWebOwnerCloseReason) => void;
type GlobalStatusOwner = {
  active: boolean;
  subscribers: Set<GlobalSubscriberClose>;
  closeFallbacks: Set<() => void>;
};
type GlobalStatusRegistration = {
  protocol: "pi-web-global-status-channel";
  version: 1;
  owner: typeof GLOBAL_STATUS_REGISTRATION_OWNER;
  gateway: PiWebTransportGatewayV1;
  serverInstanceId: string;
  active: boolean;
  unregister: () => boolean;
  subscriptionOwner: GlobalStatusOwner;
};

type RunningIdSource = readonly string[] | RunningSessionIdsView;
type GlobalStatusFrameInput = GlobalStatusFrame | (Omit<GlobalRunningFrame, "runningSessionIds"> & {
  runningSessionIds: RunningIdSource;
});

type GlobalStatusChannelDependencies = {
  getRunningSessionIds(): RunningIdSource;
  getSessionListGeneration(): number;
  subscribeRunning(listener: (ids: RunningIdSource) => void): () => void;
  subscribeSessionList(listener: (generation: number) => void): () => void;
};

type GlobalStatusChannelOptions = {
  outputByteLimit?: number;
  closeFallbackMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  subscriptionOwner?: GlobalStatusOwner;
  /** Bounded test observer: counts only, never IDs or encoded text. */
  referenceObserver?: (state: Readonly<{
    queuedRetained: number;
    arrayReferences: number;
    inFlight: boolean;
    closeFallbacks: number;
  }>) => void;
};

const defaultDependencies: GlobalStatusChannelDependencies = {
  getRunningSessionIds: getRunningRpcSessionProjection,
  getSessionListGeneration: getSessionListRefreshGeneration,
  subscribeRunning: subscribeRunningSessions,
  subscribeSessionList: subscribeSessionListRefresh,
};

function isCompatibleRegistration(value: unknown): value is GlobalStatusRegistration {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GlobalStatusRegistration>;
  return record.protocol === "pi-web-global-status-channel" && record.version === 1
    && record.owner === GLOBAL_STATUS_REGISTRATION_OWNER && typeof record.serverInstanceId === "string"
    && typeof record.active === "boolean" && typeof record.unregister === "function"
    && !!record.gateway && !!record.subscriptionOwner
    && record.subscriptionOwner.subscribers instanceof Set
    && record.subscriptionOwner.closeFallbacks instanceof Set;
}

/** Encode only finite V1 shapes and stop at the first newly-unique one-over ID. */
export function encodeBoundedGlobalStatusFrame(frame: GlobalStatusFrameInput, limit: number): string | null {
  try {
    if (!Number.isSafeInteger(limit) || limit <= 0 || !frame || typeof frame !== "object"
      || frame.protocol !== GLOBAL_STATUS_PROTOCOL || frame.version !== GLOBAL_STATUS_VERSION
      || typeof frame.serverInstanceId !== "string" || frame.serverInstanceId.length === 0
      || frame.serverInstanceId.length > 128) return null;
    const chunks: string[] = [];
    let bytes = 0;
    const append = (value: string): boolean => {
      const nextBytes = Buffer.byteLength(value);
      if (bytes + nextBytes > limit) return false;
      bytes += nextBytes;
      chunks.push(value);
      return true;
    };
    const appendBoundedString = (value: string, maximumLength: number): boolean => {
      if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) return false;
      return append(JSON.stringify(value));
    };
    if (!append('{"protocol":"pi-web-global-status","version":1,"serverInstanceId":')
      || !appendBoundedString(frame.serverInstanceId, 128)) return null;
    if (frame.type === "running") {
      const source = frame.runningSessionIds;
      if (!source || typeof source === "string" || typeof source[Symbol.iterator] !== "function"
        || !append(',"type":"running","runningSessionIds":[')) return null;
      const suffix = "]}";
      const suffixBytes = Buffer.byteLength(suffix);
      if (bytes + suffixBytes > limit) return null;
      const encodedById = new Map<string, string>();
      for (const id of source) {
        if (typeof id !== "string" || id.length === 0 || id.length > 256) return null;
        if (encodedById.has(id)) continue;
        const encoded = JSON.stringify(id);
        const nextBytes = (encodedById.size === 0 ? 0 : 1) + Buffer.byteLength(encoded);
        if (bytes + nextBytes + suffixBytes > limit) return null;
        bytes += nextBytes;
        encodedById.set(id, encoded);
      }
      const canonicalIds = [...encodedById.keys()].sort();
      chunks.push(canonicalIds.map((id) => encodedById.get(id)!).join(","), suffix);
    } else if (frame.type === "sessions_changed") {
      if (!Number.isSafeInteger(frame.sessionListGeneration) || frame.sessionListGeneration < 0
        || !append(',"type":"sessions_changed","sessionListGeneration":')
        || !append(String(frame.sessionListGeneration)) || !append("}")) return null;
    } else return null;
    return chunks.join("");
  } catch { return null; }
}

export function createGlobalStatusChannelHandler(
  dependencies: GlobalStatusChannelDependencies = defaultDependencies,
  options: GlobalStatusChannelOptions = {},
): PiWebTransportChannelHandler {
  const outputByteLimit = options.outputByteLimit ?? GLOBAL_STATUS_OUTPUT_BYTES;
  const closeFallbackMs = options.closeFallbackMs ?? GLOBAL_STATUS_CLOSE_FALLBACK_MS;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;
  const owner = options.subscriptionOwner ?? { active: true, subscribers: new Set(), closeFallbacks: new Set() };
  if (!Number.isSafeInteger(outputByteLimit) || outputByteLimit <= 0) throw new Error("invalid_global_output_limit");

  return (socket, context) => {
    let terminal = false;
    let unsubscribeRunning: (() => void) | null = null;
    let unsubscribeSessionList: (() => void) | null = null;
    let closeFallback: ReturnType<typeof setTimeout> | null = null;
    let queue: Array<{ text: string; bytes: number } | null> = [];
    let queueHead = 0;
    let queuedBytes = 0;
    let inFlightBytes = 0;
    let sending = false;
    let draining = false;
    let drainRequested = false;

    const observeReferences = () => {
      try {
        if (!options.referenceObserver) return;
        options.referenceObserver(Object.freeze({
          queuedRetained: Math.max(0, queue.length - queueHead),
          arrayReferences: queue.reduce((count, item) => count + (item === null ? 0 : 1), 0),
          inFlight: inFlightBytes > 0,
          closeFallbacks: owner.closeFallbacks.size,
        }));
      } catch { /* test observation is isolated */ }
    };
    const clearFallback = () => {
      owner.closeFallbacks.delete(clearFallback);
      if (!closeFallback) return;
      cancelTimeout(closeFallback);
      closeFallback = null;
      observeReferences();
    };
    const requestClose = (code: number, allowTerminateFallback: boolean) => {
      try {
        if (socket.readyState === 1) socket.close(code);
        else if (allowTerminateFallback && (socket.readyState === 0 || socket.readyState === 2)) socket.terminate();
      } catch {
        if (allowTerminateFallback) try { if (socket.readyState !== 3) socket.terminate(); } catch { /* terminal */ }
      }
      if (allowTerminateFallback && socket.readyState !== 3 && !closeFallback) {
        closeFallback = scheduleTimeout(() => {
          owner.closeFallbacks.delete(clearFallback);
          closeFallback = null;
          try { if (socket.readyState !== 3) socket.terminate(); } catch { /* terminal */ }
          observeReferences();
        }, closeFallbackMs);
        closeFallback?.unref?.();
        owner.closeFallbacks.add(clearFallback);
      }
    };
    const cleanup = (initiateClose: boolean, code = 1011, allowFallback = true) => {
      if (terminal) { if (!initiateClose) clearFallback(); return; }
      terminal = true;
      owner.subscribers.delete(ownerClose);
      unsubscribeRunning?.();
      unsubscribeSessionList?.();
      unsubscribeRunning = null;
      unsubscribeSessionList = null;
      queue = [];
      queueHead = 0;
      queuedBytes = 0;
      inFlightBytes = 0;
      if (initiateClose) requestClose(code, allowFallback);
      else clearFallback();
      observeReferences();
    };
    const ownerClose: GlobalSubscriberClose = () => cleanup(true, 1012, false);
    const failSlow = () => cleanup(true, 1013, true);
    const bufferedOver = () => {
      try { return !Number.isFinite(socket.bufferedAmount) || socket.bufferedAmount < 0 || socket.bufferedAmount > outputByteLimit; }
      catch { return true; }
    };
    const drain = () => {
      drainRequested = true;
      if (draining) return;
      draining = true;
      try {
        while (drainRequested && !terminal) {
          drainRequested = false;
          if (sending) continue;
          if (bufferedOver()) { failSlow(); continue; }
          if (queueHead >= queue.length) { queue = []; queueHead = 0; observeReferences(); continue; }
          const item = queue[queueHead];
          queue[queueHead] = null;
          queueHead += 1;
          if (!item) { cleanup(true, 1011, true); continue; }
          queuedBytes -= item.bytes;
          if (queueHead > 1_024 && queueHead * 2 > queue.length) {
            queue = queue.slice(queueHead);
            queueHead = 0;
          }
          sending = true;
          inFlightBytes = item.bytes;
          observeReferences();
          try {
            socket.send(item.text, (error?: Error) => {
              if (terminal) return;
              if (error) { cleanup(true, 1011, true); return; }
              sending = false;
              inFlightBytes = 0;
              observeReferences();
              drain();
            });
            if (!terminal && bufferedOver()) failSlow();
          } catch { cleanup(true, 1011, true); }
        }
      } finally {
        draining = false;
        if (drainRequested && !terminal && !sending) drain();
      }
    };
    const admit = (frame: GlobalStatusFrameInput): boolean => {
      if (terminal || socket.readyState !== 1 || bufferedOver()) { failSlow(); return false; }
      const text = encodeBoundedGlobalStatusFrame(frame, outputByteLimit);
      if (text === null) { failSlow(); return false; }
      const bytes = Buffer.byteLength(text);
      if (queuedBytes + inFlightBytes + bytes > outputByteLimit) { failSlow(); return false; }
      queue.push({ text, bytes });
      queuedBytes += bytes;
      observeReferences();
      drain();
      return true;
    };
    const runningFrame = (ids: RunningIdSource): GlobalStatusFrameInput => ({
      protocol: GLOBAL_STATUS_PROTOCOL, version: GLOBAL_STATUS_VERSION,
      serverInstanceId: context.serverInstanceId, type: "running", runningSessionIds: ids,
    });
    const discoveryFrame = (generation: number): GlobalStatusFrame => ({
      protocol: GLOBAL_STATUS_PROTOCOL, version: GLOBAL_STATUS_VERSION,
      serverInstanceId: context.serverInstanceId, type: "sessions_changed", sessionListGeneration: generation,
    });

    socket.once("close", () => cleanup(false));
    socket.once("error", () => cleanup(true, 1011, true));
    owner.subscribers.add(ownerClose);
    if (!owner.active || context.ownerToken?.isCurrent() === false) {
      cleanup(true, 1012, false);
      return;
    }
    if (socket.readyState !== 1) {
      cleanup(true, 1012, true);
      return;
    }
    try {
      unsubscribeRunning = dependencies.subscribeRunning((ids) => { admit(runningFrame(ids)); });
      unsubscribeSessionList = dependencies.subscribeSessionList((generation) => { admit(discoveryFrame(generation)); });
      if (!admit(runningFrame(dependencies.getRunningSessionIds()))) return;
      admit(discoveryFrame(dependencies.getSessionListGeneration()));
    } catch { cleanup(true, 1011, true); }
  };
}

export function ensureGlobalStatusChannel(
  gateway: PiWebTransportGatewayV1,
): { channel: typeof GLOBAL_STATUS_CHANNEL; reused: boolean } {
  if (gateway.ownerLifecycleVersion !== 1) throw new Error("global_status_owner_lifecycle_unavailable");
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = scope[GLOBAL_STATUS_REGISTRATION_SYMBOL];
  if (existing !== undefined) {
    if (!isCompatibleRegistration(existing)) throw new Error("global_status_registration_incompatible");
    if (existing.active && existing.gateway === gateway && existing.serverInstanceId === gateway.serverInstanceId) {
      return { channel: GLOBAL_STATUS_CHANNEL, reused: true };
    }
    existing.active = false;
    existing.unregister();
  }
  const subscriptionOwner: GlobalStatusOwner = { active: true, subscribers: new Set(), closeFallbacks: new Set() };
  const handler = createGlobalStatusChannelHandler(defaultDependencies, { subscriptionOwner });
  const ownerClose = (reason: PiWebOwnerCloseReason) => {
    subscriptionOwner.active = false;
    // Registration replacement force is centralized in the gateway. Semantic
    // owners only release application state and cancel any older policy/slow fallback.
    for (const cancel of [...subscriptionOwner.closeFallbacks]) cancel();
    for (const close of [...subscriptionOwner.subscribers]) close(reason);
  };
  const unregister = gateway.registerChannel(GLOBAL_STATUS_CHANNEL, handler, ownerClose);
  const record: GlobalStatusRegistration = {
    protocol: "pi-web-global-status-channel", version: 1, owner: GLOBAL_STATUS_REGISTRATION_OWNER,
    gateway, serverInstanceId: gateway.serverInstanceId, active: true, unregister, subscriptionOwner,
  };
  scope[GLOBAL_STATUS_REGISTRATION_SYMBOL] = record;
  return { channel: GLOBAL_STATUS_CHANNEL, reused: false };
}

export const GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL = GLOBAL_STATUS_REGISTRATION_SYMBOL;
