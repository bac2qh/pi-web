import type WebSocket from "ws";
import type { AgentSessionWrapper } from "./rpc-manager";
import type { ProjectedSessionFrame } from "./session-protocol";
import {
  createBoundedProjectedSessionFrameEncoder,
} from "./session-protocol";
import type { ProjectedSessionHubReader, ReplayOutcome } from "./session-event-hub";
import {
  SESSION_TRANSPORT_CHANNEL,
  SESSION_TRANSPORT_CLOSE,
  SESSION_TRANSPORT_CLOSE_FALLBACK_MS,
  SESSION_TRANSPORT_OUTPUT_BYTES,
  SESSION_TRANSPORT_PROTOCOL,
  SESSION_TRANSPORT_RESUME_TIMEOUT_MS,
  SESSION_TRANSPORT_VERSION,
  encodeSessionTransportReadyFrame,
  parseSessionTransportResumeText,
  type SessionTransportReadyFrame,
} from "./session-transport-protocol";
import type {
  PiWebTransportChannelContext,
  PiWebTransportChannelHandler,
  PiWebTransportGatewayV1,
} from "./websocket-gateway";

const SESSION_REGISTRATION_SYMBOL = Symbol.for("pi-web.session-channel.v1");
const SESSION_OWNER = "pi-web" as const;
const SESSION_TICKET_CONTEXT_PROTOCOL = "pi-web-session-ticket-context" as const;

export type SessionTransportWrapper = Pick<AgentSessionWrapper,
  "isAlive" | "getProjectedEventHub" | "onDestroy"
>;

export type SessionTicketContext = Readonly<{
  protocol: typeof SESSION_TICKET_CONTEXT_PROTOCOL;
  version: 1;
  owner: typeof SESSION_OWNER;
  wrapper: SessionTransportWrapper;
  hub: ProjectedSessionHubReader;
}>;

type SubscriberOwner = {
  dead: boolean;
  subscribers: Set<(code: typeof SESSION_TRANSPORT_CLOSE.owner) => void>;
};

export type SessionOwnerRegistry = Map<SessionTransportWrapper, SubscriberOwner>;

type SessionRegistration = {
  protocol: "pi-web-session-channel";
  version: 1;
  owner: typeof SESSION_OWNER;
  gateway: PiWebTransportGatewayV1;
  serverInstanceId: string;
  active: boolean;
  unregister: () => boolean;
  handler: PiWebTransportChannelHandler;
  ownerRegistry: SessionOwnerRegistry;
};

export type SessionChannelDiagnostic = Readonly<{
  kind: "registration" | "resume" | "subscriber" | "close";
  outcome: string;
  countClass?: "zero" | "one" | "many";
  byteClass?: "empty" | "low" | "medium" | "high" | "over";
}>;

export type SessionChannelReferenceState = Readonly<{
  outcome: "catch_up_loaded" | "source_released" | "cleanup_released";
  catchUpRetained: number;
  liveRetained: number;
  inFlightSource: boolean;
}>;

export type SessionChannelOptions = {
  outputByteLimit?: number;
  resumeTimeoutMs?: number;
  closeFallbackMs?: number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  diagnostic?: (entry: SessionChannelDiagnostic) => void;
  /** Optional bounded test observer; it receives counts only, never frame identities or content. */
  referenceObserver?: (state: SessionChannelReferenceState) => void;
};

function finiteCountClass(count: number): "zero" | "one" | "many" {
  return count === 0 ? "zero" : count === 1 ? "one" : "many";
}

export function isCompatibleSessionHub(value: unknown): value is ProjectedSessionHubReader {
  if (!value || typeof value !== "object") return false;
  const hub = value as Partial<ProjectedSessionHubReader>;
  return typeof hub.streamEpoch === "string" && hub.streamEpoch.length > 0 && hub.streamEpoch.length <= 128
    && Number.isSafeInteger(hub.cursor) && (hub.cursor as number) >= 0
    && typeof hub.attach === "function"
    && typeof hub.replayAfter === "function"
    && typeof hub.snapshot === "function"
    && typeof hub.getState === "function"
    && typeof hub.getReplayOccupancy === "function"
    && typeof hub.isClosed === "function";
}

function isWrapper(value: unknown): value is SessionTransportWrapper {
  if (!value || typeof value !== "object") return false;
  const wrapper = value as Partial<SessionTransportWrapper>;
  return typeof wrapper.isAlive === "function"
    && typeof wrapper.getProjectedEventHub === "function"
    && typeof wrapper.onDestroy === "function";
}

function validateTicketContext(value: unknown): SessionTicketContext | null {
  try {
    if (!value || typeof value !== "object" || !Object.isFrozen(value)) return null;
    const keys = Reflect.ownKeys(value);
    const expected = ["protocol", "version", "owner", "wrapper", "hub"];
    if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (expected.some((key) => {
      const descriptor = descriptors[key];
      return !descriptor || !("value" in descriptor) || descriptor.enumerable !== true;
    })) return null;
    const record = value as Partial<SessionTicketContext>;
    if (record.protocol !== SESSION_TICKET_CONTEXT_PROTOCOL
      || record.version !== 1
      || record.owner !== SESSION_OWNER
      || !isWrapper(record.wrapper)
      || !isCompatibleSessionHub(record.hub)) return null;
    return record as SessionTicketContext;
  } catch {
    return null;
  }
}

export function createSessionTicketContext(
  wrapper: SessionTransportWrapper,
  hub: ProjectedSessionHubReader,
): SessionTicketContext {
  return Object.freeze({
    protocol: SESSION_TICKET_CONTEXT_PROTOCOL,
    version: 1 as const,
    owner: SESSION_OWNER,
    wrapper,
    hub,
  });
}

function markOwnerDead(
  registry: SessionOwnerRegistry,
  wrapper: SessionTransportWrapper,
  owner: SubscriberOwner,
): void {
  if (owner.dead) return;
  owner.dead = true;
  if (registry.get(wrapper) === owner) registry.delete(wrapper);
  const subscribers = [...owner.subscribers];
  owner.subscribers.clear();
  for (const cleanup of subscribers) {
    try { cleanup(SESSION_TRANSPORT_CLOSE.owner); } catch { /* subscriber cleanup is isolated */ }
  }
}

function getOrCreateOwner(
  registry: SessionOwnerRegistry,
  wrapper: SessionTransportWrapper,
): SubscriberOwner {
  const existing = registry.get(wrapper);
  if (existing) return existing;
  const owner: SubscriberOwner = { dead: false, subscribers: new Set() };
  registry.set(wrapper, owner);
  wrapper.onDestroy(() => markOwnerDead(registry, wrapper, owner));
  if (!wrapper.isAlive()) markOwnerDead(registry, wrapper, owner);
  return owner;
}

function isNonclosedReplayOutcome(outcome: ReplayOutcome): outcome is SessionTransportReadyFrame["outcome"] {
  return outcome === "exact" || outcome === "empty" || outcome === "initial_snapshot"
    || outcome === "overflow_snapshot" || outcome === "wrong_epoch" || outcome === "invalid_cursor";
}

export function createSessionChannelHandler(
  ownerRegistry: SessionOwnerRegistry = new Map(),
  options: SessionChannelOptions = {},
): PiWebTransportChannelHandler {
  const outputByteLimit = options.outputByteLimit ?? SESSION_TRANSPORT_OUTPUT_BYTES;
  const resumeTimeoutMs = options.resumeTimeoutMs ?? SESSION_TRANSPORT_RESUME_TIMEOUT_MS;
  const closeFallbackMs = options.closeFallbackMs ?? SESSION_TRANSPORT_CLOSE_FALLBACK_MS;
  if (!Number.isSafeInteger(outputByteLimit) || outputByteLimit <= 0
    || !Number.isSafeInteger(resumeTimeoutMs) || resumeTimeoutMs <= 0
    || !Number.isSafeInteger(closeFallbackMs) || closeFallbackMs <= 0) {
    throw new Error("invalid_session_channel_options");
  }
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;
  const encodeFrame = createBoundedProjectedSessionFrameEncoder(outputByteLimit);
  const report = (entry: SessionChannelDiagnostic): void => {
    try { options.diagnostic?.(entry); } catch { /* diagnostics are isolated */ }
  };

  return (socket: WebSocket, dispatchContext: PiWebTransportChannelContext): void => {
    let terminal = false;
    let closeFallback: ReturnType<typeof setTimeout> | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let owner: SubscriberOwner | null = null;
    let ownerCleanup: ((code: typeof SESSION_TRANSPORT_CLOSE.owner) => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let resumeReceived = false;
    let paused = true;
    let readyText: string | null = null;
    let catchUpSource: Array<ProjectedSessionFrame | null> | null = null;
    let catchUpIndex = 0;
    let liveQueue: Array<{ text: string; bytes: number }> = [];
    let liveQueueHead = 0;
    let liveQueuedBytes = 0;
    let inFlightBytes = 0;
    let inFlightSourceIndex: number | null = null;
    let sending = false;
    let draining = false;
    let drainRequested = false;

    const observeReferences = (outcome: SessionChannelReferenceState["outcome"]): void => {
      try {
        options.referenceObserver?.(Object.freeze({
          outcome,
          catchUpRetained: catchUpSource ? Math.max(0, catchUpSource.length - catchUpIndex) : 0,
          liveRetained: Math.max(0, liveQueue.length - liveQueueHead),
          inFlightSource: inFlightSourceIndex !== null,
        }));
      } catch { /* test observation is isolated */ }
    };
    const clearCloseFallback = (): void => {
      if (!closeFallback) return;
      cancelTimeout(closeFallback);
      closeFallback = null;
    };
    const clearResumeTimer = (): void => {
      if (!resumeTimer) return;
      cancelTimeout(resumeTimer);
      resumeTimer = null;
    };
    const releaseReferences = (): void => {
      readyText = null;
      if (catchUpSource) {
        for (let index = catchUpIndex; index < catchUpSource.length; index += 1) catchUpSource[index] = null;
      }
      catchUpSource = null;
      liveQueue = [];
      liveQueueHead = 0;
      liveQueuedBytes = 0;
      inFlightBytes = 0;
      inFlightSourceIndex = null;
      sending = false;
      observeReferences("cleanup_released");
    };
    const bufferedAmountIsOver = (): boolean => {
      try {
        const amount = socket.bufferedAmount;
        return typeof amount !== "number" || !Number.isFinite(amount) || amount < 0
          || amount > outputByteLimit;
      } catch {
        return true;
      }
    };
    const beginClose = (code: number, reason: string): void => {
      try {
        if (socket.readyState === 1) socket.close(code, reason);
        else if (socket.readyState === 0 || socket.readyState === 2) socket.terminate();
      } catch {
        try { if (socket.readyState !== 3) socket.terminate(); } catch { /* already closed */ }
      }
      if (socket.readyState !== 3 && !closeFallback) {
        closeFallback = scheduleTimeout(() => {
          closeFallback = null;
          try { if (socket.readyState !== 3) socket.terminate(); } catch { /* already closed */ }
        }, closeFallbackMs);
        closeFallback?.unref?.();
      }
    };
    const cleanup = (code: number, reason: string, initiateClose: boolean): void => {
      if (terminal) {
        if (!initiateClose) clearCloseFallback();
        return;
      }
      terminal = true;
      clearResumeTimer();
      unsubscribe?.();
      unsubscribe = null;
      if (owner && ownerCleanup) owner.subscribers.delete(ownerCleanup);
      owner = null;
      ownerCleanup = null;
      releaseReferences();
      report({ kind: "close", outcome: reason });
      if (initiateClose) beginClose(code, reason);
      else clearCloseFallback();
    };
    const failSlow = (): void => cleanup(SESSION_TRANSPORT_CLOSE.slow, "slow", true);

    const requestDrain = (): void => {
      drainRequested = true;
      if (draining) return;
      draining = true;
      try {
        while (drainRequested && !terminal) {
          drainRequested = false;
          if (paused || sending) continue;
          if (bufferedAmountIsOver()) { failSlow(); continue; }

          let text: string | null = null;
          let bytes = 0;
          let sourceIndex: number | null = null;
          if (readyText !== null) {
            text = readyText;
            bytes = Buffer.byteLength(text);
            readyText = null;
          } else if (catchUpSource && catchUpIndex < catchUpSource.length) {
            sourceIndex = catchUpIndex;
            const frame = catchUpSource[sourceIndex];
            if (!frame) { cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true); continue; }
            let encoded;
            try { encoded = encodeFrame(frame); } catch { cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true); continue; }
            if (!encoded.ok) { failSlow(); continue; }
            text = encoded.text;
            bytes = encoded.bytes;
          } else if (liveQueueHead < liveQueue.length) {
            const item = liveQueue[liveQueueHead++];
            liveQueuedBytes -= item.bytes;
            text = item.text;
            bytes = item.bytes;
            if (liveQueueHead > 1_024 && liveQueueHead * 2 > liveQueue.length) {
              liveQueue = liveQueue.slice(liveQueueHead);
              liveQueueHead = 0;
            }
          } else {
            if (catchUpSource) catchUpSource = null;
            continue;
          }

          if (bytes > outputByteLimit || liveQueuedBytes + bytes > outputByteLimit) {
            failSlow();
            continue;
          }
          sending = true;
          inFlightBytes = bytes;
          inFlightSourceIndex = sourceIndex;
          try {
            socket.send(text, (error?: Error) => {
              if (terminal) return;
              if (error) {
                cleanup(SESSION_TRANSPORT_CLOSE.internal, "send", true);
                return;
              }
              const releasedSourceIndex = inFlightSourceIndex;
              if (releasedSourceIndex !== null && catchUpSource) {
                catchUpSource[releasedSourceIndex] = null;
                catchUpIndex = releasedSourceIndex + 1;
              }
              inFlightSourceIndex = null;
              if (releasedSourceIndex !== null) observeReferences("source_released");
              inFlightBytes = 0;
              sending = false;
              requestDrain();
            });
            if (!terminal && bufferedAmountIsOver()) failSlow();
          } catch {
            cleanup(SESSION_TRANSPORT_CLOSE.internal, "send", true);
          }
        }
      } finally {
        draining = false;
        if (drainRequested && !terminal && !sending && !paused) requestDrain();
      }
    };

    const admitLive = (frame: ProjectedSessionFrame): void => {
      if (terminal) return;
      let encoded;
      try { encoded = encodeFrame(frame); } catch { cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true); return; }
      if (!encoded.ok || bufferedAmountIsOver()
        || inFlightBytes + liveQueuedBytes + encoded.bytes > outputByteLimit) {
        failSlow();
        return;
      }
      liveQueue.push({ text: encoded.text, bytes: encoded.bytes });
      liveQueuedBytes += encoded.bytes;
      requestDrain();
    };

    const onClose = (): void => cleanup(1000, "client", false);
    const onError = (): void => cleanup(SESSION_TRANSPORT_CLOSE.internal, "send", true);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      if (terminal) return;
      if (resumeReceived) {
        cleanup(SESSION_TRANSPORT_CLOSE.policy, "policy", true);
        return;
      }
      resumeReceived = true;
      clearResumeTimer();
      if (isBinary) {
        cleanup(SESSION_TRANSPORT_CLOSE.binary, "binary", true);
        return;
      }
      const parsed = parseSessionTransportResumeText(data.toString());
      if (!parsed.ok) {
        cleanup(SESSION_TRANSPORT_CLOSE.policy, "policy", true);
        return;
      }
      try {
        const authorization = validateTicketContext(dispatchContext.ticketContext);
        if (!authorization || !owner || owner.dead) {
          cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true);
          return;
        }
        if (!authorization.wrapper.isAlive() || authorization.hub.isClosed()
          || authorization.wrapper.getProjectedEventHub() !== authorization.hub) {
          cleanup(SESSION_TRANSPORT_CLOSE.owner, "owner", true);
          return;
        }
        const attached = authorization.hub.attach(
          parsed.frame.streamEpoch,
          parsed.frame.cursor,
          admitLive,
        );
        unsubscribe = attached.unsubscribe;
        if (terminal) { unsubscribe(); unsubscribe = null; return; }
        if (!isNonclosedReplayOutcome(attached.outcome)) {
          cleanup(SESSION_TRANSPORT_CLOSE.owner, "owner", true);
          return;
        }
        if (!authorization.wrapper.isAlive() || authorization.hub.isClosed()
          || authorization.wrapper.getProjectedEventHub() !== authorization.hub || owner.dead) {
          cleanup(SESSION_TRANSPORT_CLOSE.owner, "owner", true);
          return;
        }
        const ready: SessionTransportReadyFrame = {
          protocol: SESSION_TRANSPORT_PROTOCOL,
          version: SESSION_TRANSPORT_VERSION,
          type: "ready",
          serverInstanceId: dispatchContext.serverInstanceId,
          streamEpoch: attached.streamEpoch,
          cursor: attached.cursor,
          outcome: attached.outcome,
        };
        readyText = encodeSessionTransportReadyFrame(ready);
        catchUpSource = Array.from(attached.units);
        observeReferences("catch_up_loaded");
        paused = false;
        report({ kind: "resume", outcome: attached.outcome });
        requestDrain();
      } catch {
        cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true);
      }
    };

    socket.once("close", onClose);
    socket.once("error", onError);
    if (socket.readyState !== 1) {
      cleanup(1000, "client", false);
      return;
    }

    const authorization = validateTicketContext(dispatchContext.ticketContext);
    if (!authorization) {
      cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true);
      return;
    }
    try {
      owner = getOrCreateOwner(ownerRegistry, authorization.wrapper);
      ownerCleanup = () => cleanup(SESSION_TRANSPORT_CLOSE.owner, "owner", true);
      owner.subscribers.add(ownerCleanup);
      if (owner.dead || !authorization.wrapper.isAlive() || authorization.hub.isClosed()
        || authorization.wrapper.getProjectedEventHub() !== authorization.hub) {
        cleanup(SESSION_TRANSPORT_CLOSE.owner, "owner", true);
        return;
      }
      socket.on("message", onMessage);
      resumeTimer = scheduleTimeout(() => {
        resumeTimer = null;
        cleanup(SESSION_TRANSPORT_CLOSE.policy, "timeout", true);
      }, resumeTimeoutMs);
      resumeTimer?.unref?.();
      report({
        kind: "subscriber",
        outcome: "registered",
        countClass: finiteCountClass(owner.subscribers.size),
      });
    } catch {
      cleanup(SESSION_TRANSPORT_CLOSE.internal, "internal", true);
    }
  };
}

function isCompatibleRegistration(value: unknown): value is SessionRegistration {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SessionRegistration>;
  return record.protocol === "pi-web-session-channel"
    && record.version === 1
    && record.owner === SESSION_OWNER
    && typeof record.serverInstanceId === "string"
    && typeof record.active === "boolean"
    && typeof record.unregister === "function"
    && typeof record.handler === "function"
    && record.ownerRegistry instanceof Map
    && !!record.gateway;
}

export function ensureSessionChannel(
  gateway: PiWebTransportGatewayV1,
): { channel: typeof SESSION_TRANSPORT_CHANNEL; reused: boolean } {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = scope[SESSION_REGISTRATION_SYMBOL];
  let ownerRegistry: SessionOwnerRegistry = new Map();
  let handler: PiWebTransportChannelHandler | null = null;
  if (existing !== undefined) {
    if (!isCompatibleRegistration(existing)) throw new Error("session_registration_incompatible");
    ownerRegistry = existing.ownerRegistry;
    handler = existing.handler;
    if (existing.active && existing.gateway === gateway
      && existing.serverInstanceId === gateway.serverInstanceId) {
      return { channel: SESSION_TRANSPORT_CHANNEL, reused: true };
    }
    existing.active = false;
    existing.unregister();
  }
  handler ??= createSessionChannelHandler(ownerRegistry);
  const unregister = gateway.registerChannel(SESSION_TRANSPORT_CHANNEL, handler);
  const record: SessionRegistration = {
    protocol: "pi-web-session-channel",
    version: 1,
    owner: SESSION_OWNER,
    gateway,
    serverInstanceId: gateway.serverInstanceId,
    active: true,
    unregister,
    handler,
    ownerRegistry,
  };
  scope[SESSION_REGISTRATION_SYMBOL] = record;
  return { channel: SESSION_TRANSPORT_CHANNEL, reused: false };
}

export const SESSION_REGISTRATION_TEST_SYMBOL = SESSION_REGISTRATION_SYMBOL;
