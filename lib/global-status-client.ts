import {
  GLOBAL_STATUS_CHANNEL,
  parseGlobalStatusFrame,
} from "./global-status-protocol";

export type GlobalStatusConnectionState = "idle" | "connecting" | "connected" | "reconnecting";

export type GlobalStatusSnapshot = {
  runningSessionIds: readonly string[];
  runningAuthoritative: boolean;
  serverInstanceId: string | null;
  connectionState: GlobalStatusConnectionState;
};

export type GlobalSessionsChangedDelivery = {
  serverInstanceId: string;
  sessionListGeneration: number;
};

type BrowserLocation = { protocol: string; host: string };

type ClientWebSocket = {
  readonly readyState: number;
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
  close(code?: number): void;
};

type TicketResponse = {
  ticket: string;
  expiresAt: number;
};

export type GlobalStatusClientDependencies = {
  fetch(input: string, init: RequestInit): Promise<Response>;
  createWebSocket(url: string): ClientWebSocket;
  getLocation(): BrowserLocation;
  createAbortController(): AbortController;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
};

export type GlobalStatusClientOptions = {
  initialReconnectDelayMs?: number;
  maximumReconnectDelayMs?: number;
};

const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 250;
const DEFAULT_MAXIMUM_RECONNECT_DELAY_MS = 10_000;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function defaultDependencies(): GlobalStatusClientDependencies {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    createWebSocket: (url) => new WebSocket(url),
    getLocation: () => ({ protocol: window.location.protocol, host: window.location.host }),
    createAbortController: () => new AbortController(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
}

function parseTicketResponse(value: unknown): TicketResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "expiresAt" || keys[1] !== "ticket") return null;
  if (typeof record.ticket !== "string" || !TICKET_PATTERN.test(record.ticket)) return null;
  if (!Number.isSafeInteger(record.expiresAt) || (record.expiresAt as number) < 0) return null;
  return { ticket: record.ticket, expiresAt: record.expiresAt as number };
}

export function deriveGlobalStatusWebSocketUrl(location: BrowserLocation, ticket: string): string {
  if ((location.protocol !== "http:" && location.protocol !== "https:") || !location.host) {
    throw new Error("unsupported_page_location");
  }
  const url = new URL("/_pi/websocket", `${location.protocol}//${location.host}`);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export class GlobalStatusClient {
  private readonly dependencies: GlobalStatusClientDependencies;
  private readonly initialReconnectDelayMs: number;
  private readonly maximumReconnectDelayMs: number;
  private readonly snapshotListeners = new Set<(snapshot: GlobalStatusSnapshot) => void>();
  private readonly discoveryListeners = new Set<(event: GlobalSessionsChangedDelivery) => void>();
  private snapshot: GlobalStatusSnapshot = {
    runningSessionIds: [],
    runningAuthoritative: false,
    serverInstanceId: null,
    connectionState: "idle",
  };
  private started = false;
  private epoch = 0;
  private bootstrapController: AbortController | null = null;
  private socket: ClientWebSocket | null = null;
  private reconnectTimer: unknown = null;
  private reconnectDelayMs: number;

  constructor(
    dependencies: GlobalStatusClientDependencies = defaultDependencies(),
    options: GlobalStatusClientOptions = {},
  ) {
    this.dependencies = dependencies;
    this.initialReconnectDelayMs = Math.max(
      1,
      Math.floor(options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS),
    );
    this.maximumReconnectDelayMs = Math.max(
      this.initialReconnectDelayMs,
      Math.floor(options.maximumReconnectDelayMs ?? DEFAULT_MAXIMUM_RECONNECT_DELAY_MS),
    );
    this.reconnectDelayMs = this.initialReconnectDelayMs;
  }

  getSnapshot(): GlobalStatusSnapshot {
    return {
      ...this.snapshot,
      runningSessionIds: [...this.snapshot.runningSessionIds],
    };
  }

  subscribe(listener: (snapshot: GlobalStatusSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());
    return () => { this.snapshotListeners.delete(listener); };
  }

  subscribeSessionsChanged(listener: (event: GlobalSessionsChangedDelivery) => void): () => void {
    this.discoveryListeners.add(listener);
    return () => { this.discoveryListeners.delete(listener); };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.epoch += 1;
    this.reconnectDelayMs = this.initialReconnectDelayMs;
    this.connect(this.epoch, false);
  }

  stop(): void {
    if (!this.started && !this.bootstrapController && !this.socket && this.reconnectTimer === null) return;
    this.started = false;
    this.epoch += 1;

    const bootstrapController = this.bootstrapController;
    const socket = this.socket;
    const reconnectTimer = this.reconnectTimer;
    this.bootstrapController = null;
    this.socket = null;
    this.reconnectTimer = null;

    bootstrapController?.abort();
    if (reconnectTimer !== null) this.dependencies.clearTimeout(reconnectTimer);
    try { socket?.close(1000); } catch { /* stale resource is already invalid */ }
    this.updateSnapshot({ connectionState: "idle" });
  }

  private updateSnapshot(update: Partial<GlobalStatusSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    const snapshot = this.getSnapshot();
    for (const listener of this.snapshotListeners) listener(snapshot);
  }

  private isCurrentEpoch(epoch: number): boolean {
    return this.started && this.epoch === epoch;
  }

  private connect(epoch: number, reconnecting: boolean): void {
    if (!this.isCurrentEpoch(epoch) || this.bootstrapController || this.socket) return;
    this.updateSnapshot({ connectionState: reconnecting ? "reconnecting" : "connecting" });

    const controller = this.dependencies.createAbortController();
    this.bootstrapController = controller;
    void this.dependencies.fetch("/api/transport/ticket", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pi-Web-Transport": "1",
      },
      body: JSON.stringify({ channel: GLOBAL_STATUS_CHANNEL }),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!this.isCurrentEpoch(epoch) || this.bootstrapController !== controller) return;
      if (!response.ok) throw new Error("ticket_request_failed");
      const ticket = parseTicketResponse(await response.json());
      if (!ticket) throw new Error("ticket_response_invalid");
      if (!this.isCurrentEpoch(epoch) || this.bootstrapController !== controller) return;
      this.bootstrapController = null;

      const socketUrl = deriveGlobalStatusWebSocketUrl(this.dependencies.getLocation(), ticket.ticket);
      const socket = this.dependencies.createWebSocket(socketUrl);
      if (!this.isCurrentEpoch(epoch) || this.socket) {
        try { socket.close(1000); } catch { /* stale before publication */ }
        return;
      }
      this.socket = socket;
      let socketServerInstanceId: string | null = null;

      socket.onopen = () => {
        if (!this.isCurrentEpoch(epoch) || this.socket !== socket) return;
        this.reconnectDelayMs = this.initialReconnectDelayMs;
        this.updateSnapshot({ connectionState: "connected" });
      };
      socket.onmessage = (event) => {
        if (!this.isCurrentEpoch(epoch) || this.socket !== socket || typeof event.data !== "string") return;
        let parsed: unknown;
        try { parsed = JSON.parse(event.data) as unknown; } catch { return; }
        const frame = parseGlobalStatusFrame(parsed);
        if (!frame) return;
        if (socketServerInstanceId !== null && socketServerInstanceId !== frame.serverInstanceId) return;
        socketServerInstanceId = frame.serverInstanceId;
        this.reconnectDelayMs = this.initialReconnectDelayMs;

        if (frame.type === "running") {
          this.updateSnapshot({
            runningSessionIds: [...frame.runningSessionIds],
            runningAuthoritative: true,
            serverInstanceId: frame.serverInstanceId,
            connectionState: "connected",
          });
          return;
        }

        if (this.snapshot.serverInstanceId !== frame.serverInstanceId) {
          this.updateSnapshot({ serverInstanceId: frame.serverInstanceId });
        }
        const delivery = {
          serverInstanceId: frame.serverInstanceId,
          sessionListGeneration: frame.sessionListGeneration,
        };
        for (const listener of this.discoveryListeners) listener(delivery);
      };
      socket.onerror = () => {
        if (!this.isCurrentEpoch(epoch) || this.socket !== socket) return;
        try { socket.close(); } catch { this.handleSocketClose(epoch, socket); }
      };
      socket.onclose = () => this.handleSocketClose(epoch, socket);
    }).catch(() => {
      if (!this.isCurrentEpoch(epoch)) return;
      if (this.bootstrapController === controller) {
        this.bootstrapController = null;
      } else if (this.bootstrapController !== null || this.socket !== null) {
        return;
      }
      this.scheduleReconnect(epoch);
    });
  }

  private handleSocketClose(epoch: number, socket: ClientWebSocket): void {
    if (!this.isCurrentEpoch(epoch) || this.socket !== socket) return;
    this.socket = null;
    this.scheduleReconnect(epoch);
  }

  private scheduleReconnect(epoch: number): void {
    if (!this.isCurrentEpoch(epoch) || this.reconnectTimer !== null) return;
    this.updateSnapshot({ connectionState: "reconnecting" });
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.maximumReconnectDelayMs, delay * 2);
    const timer = this.dependencies.setTimeout(() => {
      if (!this.isCurrentEpoch(epoch) || this.reconnectTimer !== timer) return;
      this.reconnectTimer = null;
      this.connect(epoch, true);
    }, delay);
    this.reconnectTimer = timer;
  }
}
