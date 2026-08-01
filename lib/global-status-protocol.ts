export const GLOBAL_STATUS_PROTOCOL = "pi-web-global-status" as const;
export const GLOBAL_STATUS_VERSION = 1 as const;
export const GLOBAL_STATUS_CHANNEL = "running" as const;

export type GlobalRunningFrame = {
  protocol: typeof GLOBAL_STATUS_PROTOCOL;
  version: typeof GLOBAL_STATUS_VERSION;
  serverInstanceId: string;
  type: "running";
  runningSessionIds: string[];
};

export type GlobalSessionsChangedFrame = {
  protocol: typeof GLOBAL_STATUS_PROTOCOL;
  version: typeof GLOBAL_STATUS_VERSION;
  serverInstanceId: string;
  type: "sessions_changed";
  sessionListGeneration: number;
};

export type GlobalStatusFrame = GlobalRunningFrame | GlobalSessionsChangedFrame;

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function isServerInstanceId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function parseGlobalStatusFrame(value: unknown): GlobalStatusFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  if (
    frame.protocol !== GLOBAL_STATUS_PROTOCOL
    || frame.version !== GLOBAL_STATUS_VERSION
    || !isServerInstanceId(frame.serverInstanceId)
  ) {
    return null;
  }

  if (frame.type === "running") {
    if (!hasExactKeys(frame, [
      "protocol",
      "runningSessionIds",
      "serverInstanceId",
      "type",
      "version",
    ].sort())) return null;
    if (!Array.isArray(frame.runningSessionIds)) return null;
    const ids = frame.runningSessionIds;
    if (ids.some((id) => typeof id !== "string" || id.length === 0 || id.length > 256)) {
      return null;
    }
    if (new Set(ids).size !== ids.length) return null;
    return frame as GlobalRunningFrame;
  }

  if (frame.type === "sessions_changed") {
    if (!hasExactKeys(frame, [
      "protocol",
      "serverInstanceId",
      "sessionListGeneration",
      "type",
      "version",
    ].sort())) return null;
    if (!Number.isSafeInteger(frame.sessionListGeneration) || (frame.sessionListGeneration as number) < 0) {
      return null;
    }
    return frame as GlobalSessionsChangedFrame;
  }

  return null;
}
