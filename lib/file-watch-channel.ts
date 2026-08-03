import fs from "node:fs";
import path from "node:path";
import type WebSocket from "ws";
import { normalizeAbsoluteFilePath } from "./file-authorization";
import { isWindowsAbsolutePath } from "./file-access";
import {
  FILE_WATCH_CHANNEL,
  FILE_WATCH_CLOSE,
  FILE_WATCH_PROTOCOL,
  FILE_WATCH_VERSION,
  encodeFileWatchFrame,
  type FileWatchFrame,
} from "./file-watch-protocol";
import type {
  PiWebTransportChannelContext,
  PiWebTransportChannelHandler,
  PiWebTransportGatewayV1,
} from "./websocket-gateway";

const FILE_WATCH_REGISTRATION_SYMBOL = Symbol.for("pi-web.file-watch-channel.v1");
const FILE_WATCH_OWNER = "pi-web" as const;
const FILE_WATCH_TICKET_CONTEXT_PROTOCOL = "pi-web-file-watch-ticket-context" as const;
const DEFAULT_COALESCE_MS = 25;
const MAX_BUFFERED_BYTES = 64 * 1024;

export type FileWatchObservationClass = "ordinary" | "symlink";
export type FileWatchTicketContext = Readonly<{
  protocol: typeof FILE_WATCH_TICKET_CONTEXT_PROTOCOL;
  version: 1;
  owner: typeof FILE_WATCH_OWNER;
  filePath: string;
  observationClass: FileWatchObservationClass;
}>;

export type FileWatchDiagnostic = Readonly<{
  stage: "channel" | "watcher" | "change" | "close";
  outcome: string;
  activeClass?: "zero" | "one" | "many";
  state?: "present" | "absent";
  coalescedClass?: "one" | "many";
}>;

type WatchLike = Pick<fs.FSWatcher, "close" | "on">;
type FileWatchDependencies = Readonly<{
  watch(target: string, listener: (eventType: string, filename: string | Buffer | null) => void): WatchLike;
  stat(filePath: string): fs.Stats;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  beforeAllocate?(): void | Promise<void>;
}>;

type RegistrationOwner = {
  active: boolean;
  subscribers: Set<(code: number) => void>;
};

type FileWatchRegistration = {
  protocol: "pi-web-file-watch-channel";
  version: 1;
  owner: typeof FILE_WATCH_OWNER;
  gateway: PiWebTransportGatewayV1;
  serverInstanceId: string;
  active: boolean;
  unregister: () => boolean;
  handler: PiWebTransportChannelHandler;
  subscriptionOwner: RegistrationOwner;
};

export type FileWatchChannelOptions = Readonly<{
  coalesceMs?: number;
  maximumChangeCount?: number;
  diagnostic?: (entry: FileWatchDiagnostic) => void;
  isCurrentOwner?: () => boolean;
  subscriptionOwner?: RegistrationOwner;
}>;

const defaultDependencies: FileWatchDependencies = {
  watch: (target, listener) => fs.watch(target, listener),
  stat: (filePath) => fs.statSync(filePath),
  setTimeout,
  clearTimeout,
};

export function createFileWatchTicketContext(
  filePath: string,
  observationClass: FileWatchObservationClass,
): FileWatchTicketContext {
  return Object.freeze({
    protocol: FILE_WATCH_TICKET_CONTEXT_PROTOCOL,
    version: 1 as const,
    owner: FILE_WATCH_OWNER,
    filePath,
    observationClass,
  });
}

function validateTicketContext(value: unknown): FileWatchTicketContext | null {
  try {
    if (!value || typeof value !== "object" || !Object.isFrozen(value)) return null;
    const keys = Reflect.ownKeys(value);
    const expected = ["protocol", "version", "owner", "filePath", "observationClass"];
    if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (expected.some((key) => {
      const descriptor = descriptors[key];
      return !descriptor || !("value" in descriptor) || descriptor.enumerable !== true;
    })) return null;
    const record = value as Partial<FileWatchTicketContext>;
    if (record.protocol !== FILE_WATCH_TICKET_CONTEXT_PROTOCOL || record.version !== 1
      || record.owner !== FILE_WATCH_OWNER || typeof record.filePath !== "string"
      || record.filePath.length === 0 || record.filePath.includes("\0")
      || Buffer.byteLength(record.filePath, "utf8") > 4096
      || normalizeAbsoluteFilePath(record.filePath) !== record.filePath
      || (record.observationClass !== "ordinary" && record.observationClass !== "symlink")) return null;
    return record as FileWatchTicketContext;
  } catch { return null; }
}

function boundedSize(stat: fs.Stats): number {
  const size = stat.size;
  if (!Number.isFinite(size) || size < 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(size));
}

function closeSocket(socket: WebSocket, code: number): void {
  try {
    if (socket.readyState === 1) socket.close(code);
    else if (socket.readyState === 0 || socket.readyState === 2) socket.terminate();
  } catch {
    try { if (socket.readyState !== 3) socket.terminate(); } catch { /* already closed */ }
  }
}

function comparableBasename(value: string, filePath: string): string {
  return isWindowsAbsolutePath(filePath) ? value.toLowerCase() : value;
}

export function createFileWatchChannelHandler(
  dependencies: FileWatchDependencies = defaultDependencies,
  options: FileWatchChannelOptions = {},
): PiWebTransportChannelHandler {
  const coalesceMs = Math.max(0, Math.floor(options.coalesceMs ?? DEFAULT_COALESCE_MS));
  const maximumChangeCount = options.maximumChangeCount ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maximumChangeCount) || maximumChangeCount < 1) {
    throw new Error("invalid_file_watch_change_limit");
  }
  const owner = options.subscriptionOwner ?? { active: true, subscribers: new Set() };
  const report = (entry: FileWatchDiagnostic): void => {
    try { options.diagnostic?.(Object.freeze(entry)); } catch { /* diagnostics are isolated */ }
  };
  const ownerIsCurrent = () => owner.active && (options.isCurrentOwner?.() ?? true);

  return async (socket: WebSocket, dispatchContext: PiWebTransportChannelContext): Promise<void> => {
    let terminal = false;
    let watcher: WatchLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sending = false;
    let pendingWhileSending = false;
    let coalescedEvents = 0;
    let changeCount = 0;

    const cleanup = (code: number | null, outcome: string): void => {
      if (terminal) return;
      terminal = true;
      owner.subscribers.delete(ownerClose);
      if (timer) {
        try { dependencies.clearTimeout(timer); } catch { /* stale timer */ }
        timer = null;
      }
      const currentWatcher = watcher;
      watcher = null;
      try { currentWatcher?.close(); } catch { /* watcher already closed */ }
      report({ stage: "close", outcome, activeClass: "zero" });
      if (code !== null) closeSocket(socket, code);
    };
    const ownerClose = (code: number) => cleanup(code, "server");
    const fail = (outcome: string) => cleanup(FILE_WATCH_CLOSE.internal, outcome);

    const observe = (): { exists: boolean; size: number } => {
      try {
        const stat = dependencies.stat(authorization!.filePath);
        if (!stat.isFile()) return { exists: false, size: 0 };
        return { exists: true, size: boundedSize(stat) };
      } catch { return { exists: false, size: 0 }; }
    };

    const sendFrame = (frame: FileWatchFrame): boolean => {
      if (terminal || socket.readyState !== 1) { cleanup(null, "client"); return false; }
      let bufferedAmount: number;
      try { bufferedAmount = socket.bufferedAmount; }
      catch { fail("send"); return false; }
      if (!Number.isFinite(bufferedAmount) || bufferedAmount < 0 || bufferedAmount > MAX_BUFFERED_BYTES || sending) {
        if (sending) pendingWhileSending = true;
        else fail("send");
        return false;
      }
      sending = true;
      try {
        socket.send(encodeFileWatchFrame(frame), (error?: Error) => {
          sending = false;
          if (terminal) return;
          if (error) { fail("send"); return; }
          if (pendingWhileSending) {
            pendingWhileSending = false;
            scheduleChange();
          }
        });
        return true;
      } catch { sending = false; fail("send"); return false; }
    };

    const emitChange = (): void => {
      timer = null;
      if (terminal) return;
      if (sending) { pendingWhileSending = true; return; }
      if (changeCount >= maximumChangeCount) { fail("count"); return; }
      changeCount += 1;
      const observation = observe();
      const eventClass = coalescedEvents > 1 ? "many" : "one";
      coalescedEvents = 0;
      report({ stage: "change", outcome: "changed", state: observation.exists ? "present" : "absent", coalescedClass: eventClass });
      sendFrame({
        protocol: FILE_WATCH_PROTOCOL,
        version: FILE_WATCH_VERSION,
        serverInstanceId: dispatchContext.serverInstanceId,
        type: "change",
        changeCount,
        ...observation,
      });
    };
    const scheduleChange = (): void => {
      if (terminal) return;
      coalescedEvents = Math.min(2, coalescedEvents + 1);
      if (timer) return;
      try {
        timer = dependencies.setTimeout(emitChange, coalesceMs);
        timer?.unref?.();
      } catch { fail("watcher"); }
    };

    const authorization = validateTicketContext(dispatchContext.ticketContext);
    socket.once("close", () => cleanup(null, "client"));
    socket.once("error", () => cleanup(FILE_WATCH_CLOSE.internal, "send"));
    socket.on("message", (_data: WebSocket.RawData, isBinary: boolean) => {
      cleanup(isBinary ? FILE_WATCH_CLOSE.binary : FILE_WATCH_CLOSE.policy, "protocol");
    });
    owner.subscribers.add(ownerClose);

    if (!authorization) { fail("ticket"); return; }
    try { await dependencies.beforeAllocate?.(); }
    catch { fail("watcher"); return; }
    if (terminal || socket.readyState !== 1) { cleanup(null, "client"); return; }
    if (!ownerIsCurrent()) { cleanup(FILE_WATCH_CLOSE.owner, "server"); return; }

    const watchTarget = authorization.observationClass === "symlink"
      ? authorization.filePath
      : path.dirname(authorization.filePath);
    const targetBasename = comparableBasename(path.basename(authorization.filePath), authorization.filePath);
    try {
      const allocated = dependencies.watch(watchTarget, (_eventType, filename) => {
        if (terminal) return;
        if (authorization.observationClass === "ordinary" && filename !== null) {
          const candidate = Buffer.isBuffer(filename) ? filename.toString() : filename;
          if (comparableBasename(candidate, authorization.filePath) !== targetBasename) return;
        }
        scheduleChange();
      });
      if (terminal || socket.readyState !== 1 || !ownerIsCurrent()) {
        try { allocated.close(); } catch { /* setup loser */ }
        if (!terminal) cleanup(ownerIsCurrent() ? null : FILE_WATCH_CLOSE.owner, ownerIsCurrent() ? "client" : "server");
        return;
      }
      watcher = allocated;
      watcher.on("error", () => fail("watcher"));
      const observation = observe();
      report({ stage: "watcher", outcome: "connected", activeClass: "one", state: observation.exists ? "present" : "absent" });
      sendFrame({
        protocol: FILE_WATCH_PROTOCOL,
        version: FILE_WATCH_VERSION,
        serverInstanceId: dispatchContext.serverInstanceId,
        type: "connected",
        changeCount: 0,
        ...observation,
      });
    } catch { fail("watcher"); }
  };
}

function isCompatibleRegistration(value: unknown): value is FileWatchRegistration {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<FileWatchRegistration>;
  return record.protocol === "pi-web-file-watch-channel" && record.version === 1
    && record.owner === FILE_WATCH_OWNER && typeof record.serverInstanceId === "string"
    && typeof record.active === "boolean" && typeof record.unregister === "function"
    && typeof record.handler === "function" && !!record.gateway
    && !!record.subscriptionOwner && record.subscriptionOwner.subscribers instanceof Set;
}

export function ensureFileWatchChannel(
  gateway: PiWebTransportGatewayV1,
): { channel: typeof FILE_WATCH_CHANNEL; reused: boolean } {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = scope[FILE_WATCH_REGISTRATION_SYMBOL];
  if (existing !== undefined) {
    if (!isCompatibleRegistration(existing)) throw new Error("file_watch_registration_incompatible");
    if (existing.active && existing.gateway === gateway && existing.serverInstanceId === gateway.serverInstanceId) {
      return { channel: FILE_WATCH_CHANNEL, reused: true };
    }
    existing.active = false;
    existing.subscriptionOwner.active = false;
    for (const close of [...existing.subscriptionOwner.subscribers]) close(FILE_WATCH_CLOSE.owner);
    existing.unregister();
  }

  const subscriptionOwner: RegistrationOwner = { active: true, subscribers: new Set() };
  const record = {} as FileWatchRegistration;
  const handler = createFileWatchChannelHandler(defaultDependencies, {
    subscriptionOwner,
    isCurrentOwner: () => record.active && scope[FILE_WATCH_REGISTRATION_SYMBOL] === record,
  });
  const unregister = gateway.registerChannel(FILE_WATCH_CHANNEL, handler);
  Object.assign(record, {
    protocol: "pi-web-file-watch-channel",
    version: 1,
    owner: FILE_WATCH_OWNER,
    gateway,
    serverInstanceId: gateway.serverInstanceId,
    active: true,
    unregister,
    handler,
    subscriptionOwner,
  });
  scope[FILE_WATCH_REGISTRATION_SYMBOL] = record;
  return { channel: FILE_WATCH_CHANNEL, reused: false };
}

export const FILE_WATCH_REGISTRATION_TEST_SYMBOL = FILE_WATCH_REGISTRATION_SYMBOL;
