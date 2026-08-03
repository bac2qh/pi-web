export const FILE_WATCH_CHANNEL = "file-watch" as const;
export const FILE_WATCH_PROTOCOL = "pi-web-file-watch" as const;
export const FILE_WATCH_VERSION = 1 as const;

export const FILE_WATCH_CLOSE = Object.freeze({
  binary: 1003,
  policy: 1008,
  internal: 1011,
  owner: 1012,
  retry: 1013,
});

export type FileWatchFrame = Readonly<{
  protocol: typeof FILE_WATCH_PROTOCOL;
  version: typeof FILE_WATCH_VERSION;
  serverInstanceId: string;
  type: "connected" | "change";
  changeCount: number;
  exists: boolean;
  size: number;
}>;

const FRAME_KEYS = [
  "changeCount", "exists", "protocol", "serverInstanceId", "size", "type", "version",
] as const;

function isBoundedServerInstanceId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function parseFileWatchFrame(value: unknown): FileWatchFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== FRAME_KEYS.length || FRAME_KEYS.some((key, index) => keys[index] !== key)) return null;
  if (record.protocol !== FILE_WATCH_PROTOCOL || record.version !== FILE_WATCH_VERSION
    || !isBoundedServerInstanceId(record.serverInstanceId)
    || (record.type !== "connected" && record.type !== "change")
    || !isNonnegativeSafeInteger(record.changeCount)
    || typeof record.exists !== "boolean"
    || !isNonnegativeSafeInteger(record.size)) return null;
  if ((record.type === "connected" && record.changeCount !== 0)
    || (record.type === "change" && record.changeCount < 1)
    || (!record.exists && record.size !== 0)) return null;
  return Object.freeze({
    protocol: FILE_WATCH_PROTOCOL,
    version: FILE_WATCH_VERSION,
    serverInstanceId: record.serverInstanceId as string,
    type: record.type,
    changeCount: record.changeCount as number,
    exists: record.exists,
    size: record.size as number,
  });
}

export function parseFileWatchFrameText(text: string): FileWatchFrame | null {
  try { return parseFileWatchFrame(JSON.parse(text) as unknown); }
  catch { return null; }
}

export function encodeFileWatchFrame(frame: FileWatchFrame): string {
  const parsed = parseFileWatchFrame(frame);
  if (!parsed) throw new Error("invalid_file_watch_frame");
  return JSON.stringify(parsed);
}
