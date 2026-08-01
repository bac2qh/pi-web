import {
  getRunningRpcSessionIds,
  getSessionListRefreshGeneration,
  subscribeRunningSessions,
  subscribeSessionListRefresh,
} from "./rpc-manager";
import {
  GLOBAL_STATUS_CHANNEL,
  GLOBAL_STATUS_PROTOCOL,
  GLOBAL_STATUS_VERSION,
  type GlobalStatusFrame,
} from "./global-status-protocol";
import type {
  PiWebTransportChannelHandler,
  PiWebTransportGatewayV1,
} from "./websocket-gateway";

const GLOBAL_STATUS_REGISTRATION_SYMBOL = Symbol.for("pi-web.global-status-channel.v1");
const GLOBAL_STATUS_REGISTRATION_OWNER = "pi-web" as const;

type GlobalStatusRegistration = {
  protocol: "pi-web-global-status-channel";
  version: 1;
  owner: typeof GLOBAL_STATUS_REGISTRATION_OWNER;
  gateway: PiWebTransportGatewayV1;
  serverInstanceId: string;
  active: boolean;
  unregister: () => boolean;
};

type GlobalStatusChannelDependencies = {
  getRunningSessionIds(): string[];
  getSessionListGeneration(): number;
  subscribeRunning(listener: (ids: string[]) => void): () => void;
  subscribeSessionList(listener: (generation: number) => void): () => void;
};

const defaultDependencies: GlobalStatusChannelDependencies = {
  getRunningSessionIds: getRunningRpcSessionIds,
  getSessionListGeneration: getSessionListRefreshGeneration,
  subscribeRunning: subscribeRunningSessions,
  subscribeSessionList: subscribeSessionListRefresh,
};

function isCompatibleRegistration(value: unknown): value is GlobalStatusRegistration {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GlobalStatusRegistration>;
  return record.protocol === "pi-web-global-status-channel"
    && record.version === 1
    && record.owner === GLOBAL_STATUS_REGISTRATION_OWNER
    && typeof record.serverInstanceId === "string"
    && typeof record.active === "boolean"
    && typeof record.unregister === "function"
    && !!record.gateway;
}

function closeSocket(socket: Parameters<PiWebTransportChannelHandler>[0]): void {
  try {
    if (socket.readyState === 1) socket.close(1011);
    else if (socket.readyState === 0 || socket.readyState === 2) socket.terminate();
  } catch {
    try {
      if (socket.readyState !== 3) socket.terminate();
    } catch { /* already closed */ }
  }
}

export function createGlobalStatusChannelHandler(
  dependencies: GlobalStatusChannelDependencies = defaultDependencies,
): PiWebTransportChannelHandler {
  return (socket, context) => {
    let cleaned = false;
    let unsubscribeRunning: (() => void) | null = null;
    let unsubscribeSessionList: (() => void) | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribeRunning?.();
      unsubscribeSessionList?.();
      unsubscribeRunning = null;
      unsubscribeSessionList = null;
    };
    const fail = () => {
      cleanup();
      closeSocket(socket);
    };
    const send = (frame: GlobalStatusFrame): boolean => {
      if (cleaned) return false;
      if (socket.readyState !== 1) {
        cleanup();
        closeSocket(socket);
        return false;
      }
      try {
        socket.send(JSON.stringify(frame), (error) => {
          if (error) fail();
        });
        return true;
      } catch {
        fail();
        return false;
      }
    };
    const runningFrame = (runningSessionIds: string[]): GlobalStatusFrame => ({
      protocol: GLOBAL_STATUS_PROTOCOL,
      version: GLOBAL_STATUS_VERSION,
      serverInstanceId: context.serverInstanceId,
      type: "running",
      runningSessionIds: [...new Set(runningSessionIds)].sort(),
    });
    const discoveryFrame = (sessionListGeneration: number): GlobalStatusFrame => ({
      protocol: GLOBAL_STATUS_PROTOCOL,
      version: GLOBAL_STATUS_VERSION,
      serverInstanceId: context.serverInstanceId,
      type: "sessions_changed",
      sessionListGeneration,
    });

    try {
      socket.once("close", cleanup);
      socket.once("error", cleanup);

      // Subscribe synchronously before snapshots so a transition cannot fall in
      // the attachment gap. Duplicate current frames are harmless and bounded.
      unsubscribeRunning = dependencies.subscribeRunning((ids) => {
        send(runningFrame(ids));
      });
      unsubscribeSessionList = dependencies.subscribeSessionList((generation) => {
        send(discoveryFrame(generation));
      });

      if (!send(runningFrame(dependencies.getRunningSessionIds()))) return;
      send(discoveryFrame(dependencies.getSessionListGeneration()));
    } catch {
      fail();
    }
  };
}

export function ensureGlobalStatusChannel(
  gateway: PiWebTransportGatewayV1,
): { channel: typeof GLOBAL_STATUS_CHANNEL; reused: boolean } {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = scope[GLOBAL_STATUS_REGISTRATION_SYMBOL];
  if (existing !== undefined) {
    if (!isCompatibleRegistration(existing)) {
      throw new Error("global_status_registration_incompatible");
    }
    if (
      existing.active
      && existing.gateway === gateway
      && existing.serverInstanceId === gateway.serverInstanceId
    ) {
      return { channel: GLOBAL_STATUS_CHANNEL, reused: true };
    }
    existing.active = false;
    existing.unregister();
  }

  const unregister = gateway.registerChannel(
    GLOBAL_STATUS_CHANNEL,
    createGlobalStatusChannelHandler(),
  );
  const record: GlobalStatusRegistration = {
    protocol: "pi-web-global-status-channel",
    version: 1,
    owner: GLOBAL_STATUS_REGISTRATION_OWNER,
    gateway,
    serverInstanceId: gateway.serverInstanceId,
    active: true,
    unregister,
  };
  scope[GLOBAL_STATUS_REGISTRATION_SYMBOL] = record;
  return { channel: GLOBAL_STATUS_CHANNEL, reused: false };
}

export const GLOBAL_STATUS_REGISTRATION_TEST_SYMBOL = GLOBAL_STATUS_REGISTRATION_SYMBOL;
