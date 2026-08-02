import {
  freezeCanonicalData,
  type ProjectedSessionEffect,
  type ProjectedSessionState,
} from "./session-protocol";
import { SessionStreamState, type SessionStreamFault } from "./session-stream-state";
import {
  SESSION_TRANSPORT_CHANNEL,
  SESSION_TRANSPORT_PROTOCOL,
  SESSION_TRANSPORT_VERSION,
  encodeSessionTransportResumeFrame,
  parseSessionTransportReadyText,
  type SessionTransportReadyOutcome,
} from "./session-transport-protocol";

export type SessionClientConnectionState = "idle" | "connecting" | "awaiting_ready" | "recovering" | "connected" | "reconnecting" | "terminal";
export type SessionClientErrorClass =
  | "ticket_unavailable"
  | "ticket_invalid"
  | "socket_unavailable"
  | "transport_closed"
  | "owner_unavailable"
  | "slow_consumer"
  | "protocol_malformed"
  | "protocol_unknown_type"
  | "cursor_gap"
  | "epoch_mismatch"
  | "snapshot_invalid"
  | "unsupported_protocol";

export type SessionClientSnapshot = Readonly<{
  connectionState: SessionClientConnectionState;
  serverInstanceId: string | null;
  streamEpoch: string | null;
  cursor: number;
  state: ProjectedSessionState;
  readyOutcome: SessionTransportReadyOutcome | null;
  errorClass: SessionClientErrorClass | null;
  revision: number;
}>;

export type SessionEffectDelivery = Readonly<{
  streamEpoch: string;
  sequence: number;
  effect: ProjectedSessionEffect;
}>;

export interface SessionClientController {
  start(): void;
  stop(): void;
  getSnapshot(): SessionClientSnapshot;
  subscribe(listener: (snapshot: SessionClientSnapshot) => void): () => void;
  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void;
}

type BrowserLocation = Readonly<{ protocol: string; host: string }>;
type ClientWebSocket = {
  readonly readyState: number;
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
  send(data: string): void;
  close(code?: number): void;
};
type TicketResponse = Readonly<{ ticket: string; expiresAt: number }>;
type ReconnectTimer = { readonly token: object; resource: unknown };
type NotificationBatch = Readonly<{
  snapshot: SessionClientSnapshot | null;
  snapshotListeners: ((snapshot: SessionClientSnapshot) => void)[];
  effect: SessionEffectDelivery | null;
  effectListeners: ((delivery: SessionEffectDelivery) => void)[];
}>;

export type SessionTransportClientDependencies = Readonly<{
  fetch(input: string, init: RequestInit): Promise<Response>;
  createWebSocket(url: string): ClientWebSocket;
  getLocation(): BrowserLocation;
  createAbortController(): AbortController;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
}>;

export type SessionTransportClientDiagnostic = Readonly<{
  stage: "bootstrap" | "socket" | "ready" | "catch_up" | "live" | "reconnect" | "terminal" | "stop" | "listener";
  outcome: "started" | "accepted" | "failed" | "stale" | "threw" | "stopped";
  errorClass?: SessionClientErrorClass;
  readyOutcome?: SessionTransportReadyOutcome;
}>;

export type SessionTransportClientOptions = Readonly<{
  initialReconnectDelayMs?: number;
  maximumReconnectDelayMs?: number;
  diagnostic?: (entry: SessionTransportClientDiagnostic) => void;
}>;

const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 250;
const DEFAULT_MAXIMUM_RECONNECT_DELAY_MS = 10_000;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function defaultDependencies(): SessionTransportClientDependencies {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    createWebSocket: (url) => new WebSocket(url),
    getLocation: () => ({ protocol: window.location.protocol, host: window.location.host }),
    createAbortController: () => new AbortController(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
}

export function isValidSessionTransportSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 256
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseTicketResponse(value: unknown): TicketResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "expiresAt" || keys[1] !== "ticket") return null;
  if (typeof record.ticket !== "string" || !TICKET_PATTERN.test(record.ticket)) return null;
  if (!Number.isSafeInteger(record.expiresAt) || (record.expiresAt as number) < 0) return null;
  return Object.freeze({ ticket: record.ticket, expiresAt: record.expiresAt as number });
}

export function deriveSessionTransportWebSocketUrl(location: BrowserLocation, ticket: string): string {
  if ((location.protocol !== "http:" && location.protocol !== "https:") || !location.host || !TICKET_PATTERN.test(ticket)) {
    throw new Error("unsupported_session_transport_location");
  }
  const url = new URL("/_pi/websocket", `${location.protocol}//${location.host}`);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export class SessionTransportClient implements SessionClientController {
  private readonly sessionId: string;
  private readonly dependencies: SessionTransportClientDependencies;
  private readonly initialReconnectDelayMs: number;
  private readonly maximumReconnectDelayMs: number;
  private readonly diagnostic?: (entry: SessionTransportClientDiagnostic) => void;
  private readonly stream = new SessionStreamState();
  private readonly snapshotListeners = new Set<(snapshot: SessionClientSnapshot) => void>();
  private readonly effectListeners = new Set<(delivery: SessionEffectDelivery) => void>();
  private readonly notificationQueue: NotificationBatch[] = [];
  private snapshot: SessionClientSnapshot;
  private pendingSnapshot: SessionClientSnapshot;
  private notifying = false;
  private started = false;
  private clientEpoch = 0;
  private bootstrapController: AbortController | null = null;
  private socket: ClientWebSocket | null = null;
  private reconnectTimer: ReconnectTimer | null = null;
  private reconnectDelayMs: number;

  constructor(
    sessionId: string,
    dependencies: SessionTransportClientDependencies = defaultDependencies(),
    options: SessionTransportClientOptions = {},
  ) {
    if (!isValidSessionTransportSessionId(sessionId)) throw new Error("invalid_session_transport_session_id");
    this.sessionId = sessionId;
    this.dependencies = dependencies;
    this.initialReconnectDelayMs = Math.max(1, Math.floor(options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS));
    this.maximumReconnectDelayMs = Math.max(this.initialReconnectDelayMs, Math.floor(options.maximumReconnectDelayMs ?? DEFAULT_MAXIMUM_RECONNECT_DELAY_MS));
    this.reconnectDelayMs = this.initialReconnectDelayMs;
    this.diagnostic = options.diagnostic;
    const stream = this.stream.getSnapshot();
    this.snapshot = freezeCanonicalData({
      connectionState: "idle" as const,
      serverInstanceId: null,
      streamEpoch: stream.streamEpoch,
      cursor: stream.cursor,
      state: stream.state,
      readyOutcome: null,
      errorClass: null,
      revision: 0,
    });
    this.pendingSnapshot = this.snapshot;
  }

  getSnapshot(): SessionClientSnapshot { return this.snapshot; }

  subscribe(listener: (snapshot: SessionClientSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    const current = this.snapshot;
    try { listener(current); } catch { this.report({ stage: "listener", outcome: "threw" }); }
    // A nested publication may already be queued but is not public yet. Treat
    // those queued identities as future deliveries for this new subscriber.
    for (const batch of this.notificationQueue) {
      if (batch.snapshot && !batch.snapshotListeners.includes(listener)) {
        batch.snapshotListeners.push(listener);
      }
    }
    return () => { this.snapshotListeners.delete(listener); };
  }

  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void {
    this.effectListeners.add(listener);
    return () => { this.effectListeners.delete(listener); };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.clientEpoch += 1;
    this.reconnectDelayMs = this.initialReconnectDelayMs;
    this.connect(this.clientEpoch, false);
  }

  stop(): void {
    if (!this.started && !this.bootstrapController && !this.socket && this.reconnectTimer === null
      && this.pendingSnapshot.connectionState === "idle") return;
    this.started = false;
    this.clientEpoch += 1;
    const controller = this.bootstrapController;
    const socket = this.socket;
    const timer = this.reconnectTimer;
    this.bootstrapController = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.safeAbort(controller);
    if (timer !== null) this.safeClearTimer(timer.resource);
    this.safeClose(socket, 1000);
    this.stream.resetConnection();
    this.publishFromStream("idle", null);
    this.report({ stage: "stop", outcome: "stopped" });
  }

  private report(entry: SessionTransportClientDiagnostic): void {
    try { this.diagnostic?.(Object.freeze(entry)); } catch { /* diagnostics are isolated */ }
  }

  private publishFromStream(
    connectionState: SessionClientConnectionState,
    errorClass: SessionClientErrorClass | null,
    effect?: Readonly<{ effect: ProjectedSessionEffect; streamEpoch: string; sequence: number }>,
  ): boolean {
    const stream = this.stream.getSnapshot();
    const current = this.pendingSnapshot;
    let next: SessionClientSnapshot | null = null;
    if (current.connectionState !== connectionState
      || current.serverInstanceId !== stream.serverInstanceId
      || current.streamEpoch !== stream.streamEpoch
      || current.cursor !== stream.cursor
      || current.state !== stream.state
      || current.readyOutcome !== stream.readyOutcome
      || current.errorClass !== errorClass) {
      next = freezeCanonicalData({
        connectionState,
        serverInstanceId: stream.serverInstanceId,
        streamEpoch: stream.streamEpoch,
        cursor: stream.cursor,
        state: stream.state,
        readyOutcome: stream.readyOutcome,
        errorClass,
        revision: current.revision + 1,
      });
      this.pendingSnapshot = next;
    }
    const delivery = effect
      ? freezeCanonicalData({ streamEpoch: effect.streamEpoch, sequence: effect.sequence, effect: effect.effect })
      : null;
    if (!next && !delivery) return false;
    this.notificationQueue.push(Object.freeze({
      snapshot: next,
      snapshotListeners: next ? [...this.snapshotListeners] : [],
      effect: delivery,
      effectListeners: delivery ? [...this.effectListeners] : [],
    }));
    this.drainNotifications();
    return next !== null;
  }

  private drainNotifications(): void {
    if (this.notifying) return;
    this.notifying = true;
    try {
      while (this.notificationQueue.length > 0) {
        const batch = this.notificationQueue.shift()!;
        if (batch.snapshot) {
          this.snapshot = batch.snapshot;
          for (const listener of batch.snapshotListeners) {
            try { listener(batch.snapshot); } catch { this.report({ stage: "listener", outcome: "threw" }); }
          }
        }
        if (batch.effect) {
          for (const listener of batch.effectListeners) {
            try { listener(batch.effect); } catch { this.report({ stage: "listener", outcome: "threw" }); }
          }
        }
      }
    } finally {
      this.notifying = false;
    }
  }

  private isCurrent(epoch: number): boolean { return this.started && this.clientEpoch === epoch; }

  private connect(epoch: number, reconnecting: boolean): void {
    if (!this.isCurrent(epoch) || this.bootstrapController || this.socket || this.reconnectTimer !== null) return;
    this.publishFromStream(reconnecting ? "reconnecting" : "connecting", this.pendingSnapshot.errorClass);
    if (!this.isCurrent(epoch) || this.bootstrapController || this.socket || this.reconnectTimer !== null) return;
    this.report({ stage: "bootstrap", outcome: "started" });

    let controller: AbortController | null = null;
    let signal: AbortSignal;
    try {
      controller = this.dependencies.createAbortController();
      signal = controller.signal;
    } catch {
      this.safeAbort(controller);
      this.scheduleReconnect(epoch, "ticket_unavailable");
      return;
    }
    if (!this.isCurrent(epoch)) {
      this.safeAbort(controller);
      return;
    }
    this.bootstrapController = controller;

    let request: Promise<Response>;
    try {
      request = this.dependencies.fetch("/api/transport/ticket", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pi-Web-Transport": "1",
        },
        body: JSON.stringify({ channel: SESSION_TRANSPORT_CHANNEL, sessionId: this.sessionId }),
        cache: "no-store",
        credentials: "same-origin",
        signal,
      });
    } catch {
      if (this.bootstrapController === controller) this.bootstrapController = null;
      this.safeAbort(controller);
      this.scheduleReconnect(epoch, "ticket_unavailable");
      return;
    }

    try {
      void Promise.resolve(request).then(
        (response) => { void this.handleTicketResponse(epoch, controller, response); },
        () => { this.failBootstrap(epoch, controller, "ticket_unavailable"); },
      );
    } catch {
      this.failBootstrap(epoch, controller, "ticket_unavailable");
    }
  }

  private async handleTicketResponse(epoch: number, controller: AbortController, response: Response): Promise<void> {
    if (!this.isCurrent(epoch) || this.bootstrapController !== controller) return;
    let ok: boolean;
    try { ok = response.ok; }
    catch { this.failBootstrap(epoch, controller, "ticket_unavailable"); return; }
    if (!ok) { this.failBootstrap(epoch, controller, "ticket_unavailable"); return; }

    let body: unknown;
    try { body = await response.json(); }
    catch { this.failBootstrap(epoch, controller, "ticket_invalid"); return; }
    if (!this.isCurrent(epoch) || this.bootstrapController !== controller) return;
    let ticket: TicketResponse | null;
    try { ticket = parseTicketResponse(body); }
    catch { ticket = null; }
    if (!ticket) { this.failBootstrap(epoch, controller, "ticket_invalid"); return; }
    this.bootstrapController = null;

    let socket: ClientWebSocket;
    try {
      const location = this.dependencies.getLocation();
      const url = deriveSessionTransportWebSocketUrl(location, ticket.ticket);
      socket = this.dependencies.createWebSocket(url);
      if (!socket || typeof socket !== "object") throw new Error("invalid_socket");
    } catch {
      this.scheduleReconnect(epoch, "socket_unavailable");
      return;
    }
    if (!this.isCurrent(epoch) || this.socket) {
      this.safeClose(socket, 1000);
      this.report({ stage: "socket", outcome: "stale" });
      return;
    }
    this.socket = socket;
    if (!this.installSocketHandlers(epoch, socket)) {
      if (this.socket === socket) this.socket = null;
      this.safeClose(socket, 1000);
      this.stream.resetConnection();
      this.scheduleReconnect(epoch, "socket_unavailable");
    }
  }

  private installSocketHandlers(epoch: number, socket: ClientWebSocket): boolean {
    let resumeSent = false;
    let readyReceived = false;
    try {
      socket.onopen = () => {
        try {
          if (!this.isCurrent(epoch) || this.socket !== socket) return;
          if (resumeSent) { this.failSocket(epoch, socket, "protocol_malformed"); return; }
          resumeSent = true;
          this.stream.beginAttempt();
          this.publishFromStream("awaiting_ready", null);
          if (!this.isCurrent(epoch) || this.socket !== socket) return;
          const receiver = this.stream.getCommittedReceiver();
          const resume = receiver.streamEpoch === null
            ? { protocol: SESSION_TRANSPORT_PROTOCOL, version: SESSION_TRANSPORT_VERSION, type: "resume" as const, streamEpoch: null, cursor: null }
            : { protocol: SESSION_TRANSPORT_PROTOCOL, version: SESSION_TRANSPORT_VERSION, type: "resume" as const, streamEpoch: receiver.streamEpoch, cursor: receiver.cursor };
          try { socket.send(encodeSessionTransportResumeFrame(resume)); }
          catch { this.failSocket(epoch, socket, "socket_unavailable"); }
        } catch { this.failSocket(epoch, socket, "socket_unavailable"); }
      };
      socket.onmessage = (event) => {
        try {
          if (!this.isCurrent(epoch) || this.socket !== socket) return;
          const data = event.data;
          if (typeof data !== "string") { this.failSocket(epoch, socket, "protocol_malformed"); return; }
          if (!readyReceived) {
            const parsed = parseSessionTransportReadyText(data);
            if (!parsed.ok) {
              this.failSocket(epoch, socket, parsed.reason === "unsupported_version" ? "unsupported_protocol" : parsed.reason === "unknown_type" ? "protocol_unknown_type" : "protocol_malformed");
              return;
            }
            const transition = this.stream.acceptReady(parsed.frame);
            if (transition.outcome === "fault") { this.failSocket(epoch, socket, this.mapStreamFault(transition.fault)); return; }
            readyReceived = true;
            const connectionState = transition.targetReached ? "connected" : "recovering";
            this.publishFromStream(connectionState, null);
            if (!this.isCurrent(epoch) || this.socket !== socket) return;
            this.report({ stage: "ready", outcome: "accepted", readyOutcome: parsed.frame.outcome });
            if (transition.targetReached) this.markTargetCompleted();
            return;
          }
          let value: unknown;
          try { value = JSON.parse(data) as unknown; }
          catch { this.failSocket(epoch, socket, "protocol_malformed"); return; }
          const transition = this.stream.applyUnit(value);
          if (transition.outcome === "fault") { this.failSocket(epoch, socket, this.mapStreamFault(transition.fault)); return; }
          if (transition.outcome === "duplicate") return;
          const stream = this.stream.getSnapshot();
          const connectionState = stream.phase === "live" ? "connected" : "recovering";
          const delivery = transition.effect && transition.sequence !== undefined && stream.streamEpoch !== null
            ? { effect: transition.effect, streamEpoch: stream.streamEpoch, sequence: transition.sequence }
            : undefined;
          if (transition.changed || delivery) this.publishFromStream(connectionState, null, delivery);
          if (transition.targetReached && this.isCurrent(epoch) && this.socket === socket) this.markTargetCompleted();
        } catch { this.failSocket(epoch, socket, "protocol_malformed"); }
      };
      socket.onerror = () => {
        try {
          if (!this.isCurrent(epoch) || this.socket !== socket) return;
          this.failSocket(epoch, socket, "socket_unavailable");
        } catch { this.failSocket(epoch, socket, "socket_unavailable"); }
      };
      socket.onclose = (event) => {
        try {
          if (!this.isCurrent(epoch) || this.socket !== socket) return;
          const code = event.code;
          const errorClass: SessionClientErrorClass = code === 1012
            ? "owner_unavailable"
            : code === 1013 ? "slow_consumer" : "transport_closed";
          this.failSocket(epoch, socket, errorClass, false);
        } catch { this.failSocket(epoch, socket, "transport_closed", false); }
      };
      return true;
    } catch {
      return false;
    }
  }

  private failBootstrap(epoch: number, controller: AbortController, errorClass: SessionClientErrorClass): void {
    if (!this.isCurrent(epoch) || this.bootstrapController !== controller) return;
    this.bootstrapController = null;
    this.safeAbort(controller);
    this.scheduleReconnect(epoch, errorClass);
  }

  private mapStreamFault(reason: SessionStreamFault | null): SessionClientErrorClass {
    return reason ?? "protocol_malformed";
  }

  private markTargetCompleted(): void {
    this.reconnectDelayMs = this.initialReconnectDelayMs;
    this.report({ stage: "live", outcome: "accepted" });
  }

  private failSocket(epoch: number, socket: ClientWebSocket, errorClass: SessionClientErrorClass, close = true): void {
    if (!this.isCurrent(epoch) || this.socket !== socket) return;
    this.socket = null;
    if (close) this.safeClose(socket, 1000);
    if (errorClass === "unsupported_protocol") {
      this.stream.markTerminal();
      this.publishFromStream("terminal", errorClass);
      this.report({ stage: "terminal", outcome: "failed", errorClass });
      return;
    }
    this.stream.resetConnection();
    this.scheduleReconnect(epoch, errorClass);
  }

  private scheduleReconnect(epoch: number, errorClass: SessionClientErrorClass): void {
    if (!this.isCurrent(epoch) || this.reconnectTimer !== null) return;
    this.publishFromStream("reconnecting", errorClass);
    if (!this.isCurrent(epoch) || this.reconnectTimer !== null) return;
    this.report({ stage: "reconnect", outcome: "failed", errorClass });
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.maximumReconnectDelayMs, delay * 2);
    const timer: ReconnectTimer = { token: {}, resource: null };
    this.reconnectTimer = timer;
    let firedSynchronously = false;
    let armed = false;
    let resource: unknown;
    try {
      resource = this.dependencies.setTimeout(() => {
        try {
          if (!armed) { firedSynchronously = true; return; }
          if (!this.isCurrent(epoch) || this.reconnectTimer !== timer) return;
          this.reconnectTimer = null;
          this.connect(epoch, true);
        } catch {
          this.makeSchedulingUnavailable(epoch, errorClass, timer);
        }
      }, delay);
    } catch {
      if (this.reconnectTimer === timer) this.reconnectTimer = null;
      this.makeRestartable(errorClass);
      return;
    }
    timer.resource = resource;
    armed = true;
    if (firedSynchronously) {
      if (this.reconnectTimer === timer) this.reconnectTimer = null;
      this.safeClearTimer(resource);
      this.makeRestartable(errorClass);
    }
  }

  private makeSchedulingUnavailable(epoch: number, errorClass: SessionClientErrorClass, timer: ReconnectTimer): void {
    if (!this.isCurrent(epoch) || this.reconnectTimer !== timer) return;
    this.reconnectTimer = null;
    this.safeClearTimer(timer.resource);
    this.makeRestartable(errorClass);
  }

  private makeRestartable(errorClass: SessionClientErrorClass): void {
    const controller = this.bootstrapController;
    const socket = this.socket;
    const timer = this.reconnectTimer;
    this.started = false;
    this.clientEpoch += 1;
    this.bootstrapController = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.safeAbort(controller);
    this.safeClose(socket, 1000);
    if (timer) this.safeClearTimer(timer.resource);
    this.stream.resetConnection();
    this.publishFromStream("idle", errorClass);
  }

  private safeAbort(controller: AbortController | null): void {
    if (!controller) return;
    try { controller.abort(); } catch { /* invalidated resource */ }
  }

  private safeClose(socket: ClientWebSocket | null, code?: number): void {
    if (!socket) return;
    try { socket.close(code); } catch { /* invalidated resource */ }
  }

  private safeClearTimer(resource: unknown): void {
    try { this.dependencies.clearTimeout(resource); } catch { /* stale callback is identity-suppressed */ }
  }
}
