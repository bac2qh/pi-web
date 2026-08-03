import {
  FILE_WATCH_CHANNEL,
  FILE_WATCH_CLOSE,
  FILE_WATCH_PROTOCOL,
  FILE_WATCH_VERSION,
  parseFileWatchFrameText,
  type FileWatchFrame,
} from "./file-watch-protocol";

export type FileWatchConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "terminal";
export type FileWatchErrorClass = "ticket" | "socket" | "protocol" | "watcher" | "server";
export type FileWatchSnapshot = Readonly<{
  connectionState: FileWatchConnectionState;
  serverInstanceId: string | null;
  changeCount: number;
  exists: boolean | null;
  size: number | null;
  errorClass: FileWatchErrorClass | null;
}>;

type BrowserLocation = Readonly<{ protocol: string; host: string }>;
type ClientWebSocket = {
  readonly readyState: number;
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
  close(code?: number): void;
};

type TicketResponse = Readonly<{ ticket: string; expiresAt: number }>;
export type FileWatchClientDependencies = Readonly<{
  fetch(input: string, init: RequestInit): Promise<Response>;
  createWebSocket(url: string): ClientWebSocket;
  getLocation(): BrowserLocation;
  createAbortController(): AbortController;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
}>;
export type FileWatchClientDiagnostic = Readonly<{
  stage: "bootstrap" | "socket" | "connected" | "change" | "reconnect" | "stop" | "terminal" | "listener";
  outcome: "started" | "accepted" | "failed" | "stale" | "stopped" | "threw";
  errorClass?: FileWatchErrorClass;
}>;
export type FileWatchClientOptions = Readonly<{
  diagnostic?: (entry: FileWatchClientDiagnostic) => void;
}>;

const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SOCKET_ERROR_CLOSE_GRACE_MS = 100;
const RECONNECT_DELAYS = [250, 500, 1_000, 2_000, 4_000, 8_000, 10_000] as const;

function defaultDependencies(): FileWatchClientDependencies {
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
  if (keys.length !== 2 || keys[0] !== "expiresAt" || keys[1] !== "ticket"
    || typeof record.ticket !== "string" || !TICKET_PATTERN.test(record.ticket)
    || !Number.isSafeInteger(record.expiresAt) || (record.expiresAt as number) < 0) return null;
  return Object.freeze({ ticket: record.ticket, expiresAt: record.expiresAt as number });
}

export function deriveFileWatchWebSocketUrl(location: BrowserLocation, ticket: string): string {
  if ((location.protocol !== "http:" && location.protocol !== "https:") || !location.host || !TICKET_PATTERN.test(ticket)) {
    throw new Error("unsupported_file_watch_location");
  }
  const url = new URL("/_pi/websocket", `${location.protocol}//${location.host}`);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export class FileWatchClient {
  private readonly filePath: string;
  private readonly sessionId: string | null;
  private readonly dependencies: FileWatchClientDependencies;
  private readonly diagnostic?: (entry: FileWatchClientDiagnostic) => void;
  private readonly snapshotListeners = new Set<(snapshot: FileWatchSnapshot) => void>();
  private readonly frameListeners = new Set<(frame: FileWatchFrame) => void>();
  private snapshot: FileWatchSnapshot = Object.freeze({
    connectionState: "idle", serverInstanceId: null, changeCount: 0,
    exists: null, size: null, errorClass: null,
  });
  private started = false;
  private epoch = 0;
  private bootstrap: AbortController | null = null;
  private socket: ClientWebSocket | null = null;
  private timer: unknown = null;
  private reconnectAttempt = 0;

  constructor(
    filePath: string,
    sessionId: string | null = null,
    dependencies: FileWatchClientDependencies = defaultDependencies(),
    options: FileWatchClientOptions = {},
  ) {
    if (typeof filePath !== "string" || filePath.length === 0) throw new Error("invalid_file_watch_path");
    this.filePath = filePath;
    this.sessionId = sessionId;
    this.dependencies = dependencies;
    this.diagnostic = options.diagnostic;
  }

  getSnapshot(): FileWatchSnapshot { return this.snapshot; }
  subscribe(listener: (snapshot: FileWatchSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    try { listener(this.snapshot); } catch { this.report({ stage: "listener", outcome: "threw" }); }
    return () => { this.snapshotListeners.delete(listener); };
  }
  subscribeFrames(listener: (frame: FileWatchFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => { this.frameListeners.delete(listener); };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.epoch += 1;
    this.reconnectAttempt = 0;
    this.connect(this.epoch, false);
  }

  stop(): void {
    if (!this.started && !this.bootstrap && !this.socket && this.timer === null) return;
    this.started = false;
    this.epoch += 1;
    const bootstrap = this.bootstrap;
    const socket = this.socket;
    const timer = this.timer;
    this.bootstrap = null;
    this.socket = null;
    this.timer = null;
    try { bootstrap?.abort(); } catch { /* stale bootstrap */ }
    if (timer !== null) { try { this.dependencies.clearTimeout(timer); } catch { /* stale timer */ } }
    try { socket?.close(1000); } catch { /* stale socket */ }
    this.publish({ connectionState: "idle" });
    this.report({ stage: "stop", outcome: "stopped" });
  }

  private report(entry: FileWatchClientDiagnostic): void {
    try { this.diagnostic?.(Object.freeze(entry)); } catch { /* diagnostics are isolated */ }
  }
  private current(epoch: number): boolean { return this.started && this.epoch === epoch; }
  private publish(update: Partial<FileWatchSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...update });
    for (const listener of [...this.snapshotListeners]) {
      try { listener(this.snapshot); } catch { this.report({ stage: "listener", outcome: "threw" }); }
    }
  }
  private deliver(frame: FileWatchFrame): void {
    for (const listener of [...this.frameListeners]) {
      try { listener(frame); } catch { this.report({ stage: "listener", outcome: "threw" }); }
    }
  }

  private connect(epoch: number, reconnecting: boolean): void {
    if (!this.current(epoch) || this.bootstrap || this.socket || this.timer !== null) return;
    this.publish({ connectionState: reconnecting ? "reconnecting" : "connecting", errorClass: null });
    this.report({ stage: "bootstrap", outcome: "started" });
    let controller: AbortController;
    try { controller = this.dependencies.createAbortController(); }
    catch { this.scheduleReconnect(epoch, "ticket"); return; }
    if (!this.current(epoch)) { try { controller.abort(); } catch { /* stale */ } return; }
    this.bootstrap = controller;
    const body = this.sessionId
      ? { channel: FILE_WATCH_CHANNEL, path: this.filePath, sessionId: this.sessionId }
      : { channel: FILE_WATCH_CHANNEL, path: this.filePath };
    let request: Promise<Response>;
    try {
      request = this.dependencies.fetch("/api/transport/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Pi-Web-Transport": "1" },
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
    } catch { this.failBootstrap(epoch, controller, "ticket"); return; }
    void Promise.resolve(request).then(
      (response) => { void this.handleTicket(epoch, controller, response).catch(() => this.failBootstrap(epoch, controller, "ticket")); },
      () => this.failBootstrap(epoch, controller, "ticket"),
    );
  }

  private async handleTicket(epoch: number, controller: AbortController, response: Response): Promise<void> {
    if (!this.current(epoch) || this.bootstrap !== controller) return;
    if (!response.ok) {
      const terminal = [400, 403, 413, 415].includes(response.status);
      if (terminal) {
        this.bootstrap = null;
        this.terminal(controller, "ticket");
      } else {
        this.failBootstrap(epoch, controller, "ticket");
      }
      return;
    }
    let ticket: TicketResponse | null = null;
    try { ticket = parseTicketResponse(await response.json()); } catch { /* invalid response */ }
    if (!this.current(epoch) || this.bootstrap !== controller) return;
    if (!ticket) { this.bootstrap = null; this.terminal(controller, "ticket"); return; }
    this.bootstrap = null;
    let socket: ClientWebSocket;
    try { socket = this.dependencies.createWebSocket(deriveFileWatchWebSocketUrl(this.dependencies.getLocation(), ticket.ticket)); }
    catch { this.scheduleReconnect(epoch, "socket"); return; }
    if (!this.current(epoch) || this.socket) {
      try { socket.close(1000); } catch { /* stale socket */ }
      this.report({ stage: "socket", outcome: "stale" });
      return;
    }
    this.socket = socket;
    this.installSocket(epoch, socket);
  }

  private installSocket(epoch: number, socket: ClientWebSocket): void {
    let connected = false;
    let serverInstanceId: string | null = null;
    let lastChangeCount = 0;
    try {
      socket.onopen = () => {
        if (!this.current(epoch) || this.socket !== socket) return;
        this.report({ stage: "socket", outcome: "accepted" });
      };
      socket.onmessage = (event) => {
        if (!this.current(epoch) || this.socket !== socket) return;
        if (typeof event.data !== "string") { this.failSocket(epoch, socket, "protocol", true); return; }
        const frame = parseFileWatchFrameText(event.data);
        if (!frame || (serverInstanceId !== null && serverInstanceId !== frame.serverInstanceId)
          || (!connected && frame.type !== "connected") || (connected && frame.type === "connected")
          || (frame.type === "change" && frame.changeCount !== lastChangeCount + 1)) {
          this.failSocket(epoch, socket, "protocol", true);
          return;
        }
        if (frame.protocol !== FILE_WATCH_PROTOCOL || frame.version !== FILE_WATCH_VERSION) {
          this.failSocket(epoch, socket, "protocol", true);
          return;
        }
        serverInstanceId = frame.serverInstanceId;
        if (frame.type === "connected") {
          connected = true;
          this.reconnectAttempt = 0;
          this.publish({ connectionState: "connected", serverInstanceId, changeCount: 0, exists: frame.exists, size: frame.size, errorClass: null });
          this.report({ stage: "connected", outcome: "accepted" });
        } else {
          lastChangeCount = frame.changeCount;
          this.publish({ connectionState: "connected", changeCount: frame.changeCount, exists: frame.exists, size: frame.size, errorClass: null });
          this.report({ stage: "change", outcome: "accepted" });
        }
        this.deliver(frame);
      };
      socket.onerror = () => {
        if (this.current(epoch) && this.socket === socket) this.deferSocketFailure(epoch, socket);
      };
      socket.onclose = (event) => {
        if (!this.current(epoch) || this.socket !== socket) return;
        this.cancelTimer();
        if (event.code === FILE_WATCH_CLOSE.binary || event.code === FILE_WATCH_CLOSE.policy) {
          this.failSocket(epoch, socket, "protocol", true, false);
        } else {
          const errorClass: FileWatchErrorClass = event.code === FILE_WATCH_CLOSE.internal
            ? "watcher" : event.code === FILE_WATCH_CLOSE.owner ? "server" : "socket";
          this.failSocket(epoch, socket, errorClass, false, false);
        }
      };
    } catch { this.failSocket(epoch, socket, "socket", false); }
  }

  private failBootstrap(epoch: number, controller: AbortController, errorClass: FileWatchErrorClass): void {
    if (!this.current(epoch) || this.bootstrap !== controller) return;
    this.bootstrap = null;
    try { controller.abort(); } catch { /* stale bootstrap */ }
    this.scheduleReconnect(epoch, errorClass);
  }
  private terminal(controller: AbortController | null, errorClass: FileWatchErrorClass): void {
    try { controller?.abort(); } catch { /* stale bootstrap */ }
    this.publish({ connectionState: "terminal", errorClass });
    this.report({ stage: "terminal", outcome: "failed", errorClass });
  }
  private cancelTimer(): void {
    const timer = this.timer;
    this.timer = null;
    if (timer !== null) {
      try { this.dependencies.clearTimeout(timer); } catch { /* stale timer */ }
    }
  }
  private deferSocketFailure(epoch: number, socket: ClientWebSocket): void {
    if (!this.current(epoch) || this.socket !== socket || this.timer !== null) return;
    let timer: unknown;
    let firedSynchronously = false;
    let armed = false;
    const fallback = () => {
      if (!armed) { firedSynchronously = true; return; }
      if (!this.current(epoch) || this.socket !== socket || this.timer !== timer) return;
      this.timer = null;
      this.failSocket(epoch, socket, "socket", false);
    };
    try { timer = this.dependencies.setTimeout(fallback, SOCKET_ERROR_CLOSE_GRACE_MS); }
    catch { this.failSocket(epoch, socket, "socket", false); return; }
    armed = true;
    if (firedSynchronously) {
      try { this.dependencies.clearTimeout(timer); } catch { /* synthetic synchronous timer */ }
      this.failSocket(epoch, socket, "socket", false);
      return;
    }
    this.timer = timer;
  }
  private failSocket(
    epoch: number,
    socket: ClientWebSocket,
    errorClass: FileWatchErrorClass,
    terminal: boolean,
    close = true,
  ): void {
    if (!this.current(epoch) || this.socket !== socket) return;
    this.cancelTimer();
    this.socket = null;
    if (close) { try { socket.close(terminal ? FILE_WATCH_CLOSE.policy : 1000); } catch { /* stale */ } }
    if (terminal) { this.terminal(null, errorClass); return; }
    this.scheduleReconnect(epoch, errorClass);
  }
  private scheduleReconnect(epoch: number, errorClass: FileWatchErrorClass): void {
    if (!this.current(epoch) || this.timer !== null) return;
    this.publish({ connectionState: "reconnecting", errorClass });
    this.report({ stage: "reconnect", outcome: "failed", errorClass });
    const index = Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1);
    const delay = RECONNECT_DELAYS[index];
    this.reconnectAttempt += 1;
    let timer: unknown;
    let firedSynchronously = false;
    let armed = false;
    try {
      timer = this.dependencies.setTimeout(() => {
        if (!armed) { firedSynchronously = true; return; }
        if (!this.current(epoch) || this.timer !== timer) return;
        this.timer = null;
        this.connect(epoch, true);
      }, delay);
    } catch {
      this.publish({ connectionState: "terminal", errorClass: "socket" });
      this.report({ stage: "terminal", outcome: "failed", errorClass: "socket" });
      return;
    }
    armed = true;
    if (firedSynchronously) {
      try { this.dependencies.clearTimeout(timer); } catch { /* synthetic synchronous timer */ }
      this.connect(epoch, true);
      return;
    }
    this.timer = timer;
  }
}
