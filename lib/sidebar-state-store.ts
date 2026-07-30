import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  MAX_SIDEBAR_STATE_IDS,
  SidebarStateValueError,
  applySidebarStateOperation,
  createDefaultSidebarState,
  parseSidebarState,
  reconcileSidebarState,
  sidebarStateContentEquals,
  type SidebarState,
  type SidebarStateOperation,
} from "./sidebar-session-state";
import { getSessionListGeneration } from "./session-reader";
import type { SessionInfo } from "./types";

export const SIDEBAR_STATE_FILENAME = "pi-web-sidebar.json";
const SIDEBAR_STATE_LOCK_SUFFIX = ".lock";
const MAX_SIDEBAR_STATE_FILE_BYTES = 1024 * 1024;
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 25;

export type SidebarStateStoreErrorCode =
  | "sidebar_state_invalid"
  | "sidebar_state_lock_timeout"
  | "sidebar_state_read_failed"
  | "sidebar_state_write_failed";

export class SidebarStateListingChangedError extends Error {
  constructor() {
    super("Session listing changed before sidebar-state reconciliation");
    this.name = "SidebarStateListingChangedError";
  }
}

export class SidebarStateStoreError extends Error {
  readonly code: SidebarStateStoreErrorCode;
  readonly status: number;

  constructor(code: SidebarStateStoreErrorCode, message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "SidebarStateStoreError";
    this.code = code;
    this.status = status;
  }
}

export interface SidebarStateStoreOptions {
  agentDir?: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  expectedSessionListGeneration?: number;
}

function storePaths(options: SidebarStateStoreOptions): { directory: string; statePath: string; lockPath: string } {
  const directory = options.agentDir ?? getAgentDir();
  const statePath = join(directory, SIDEBAR_STATE_FILENAME);
  return {
    directory,
    statePath,
    lockPath: `${statePath}${SIDEBAR_STATE_LOCK_SUFFIX}`,
  };
}

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/u.test(name) ? name : "Error";
}

function logStoreFailure(
  category: SidebarStateStoreErrorCode,
  details: {
    operation?: SidebarStateOperation["operation"] | "reconcile" | "read";
    state?: SidebarState;
    error: unknown;
  },
): void {
  console.error(`[pi-web] ${category}`, {
    operation: details.operation,
    revision: details.state?.revision,
    pinnedCount: details.state?.pinnedSessionIds.length,
    hiddenCount: details.state?.explicitlyHiddenSessionIds.length,
    errorClass: errorClass(details.error),
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

async function readStateFile(statePath: string, operation: SidebarStateOperation["operation"] | "reconcile" | "read"): Promise<SidebarState> {
  try {
    const fileStats = await stat(statePath);
    if (!fileStats.isFile() || fileStats.size > MAX_SIDEBAR_STATE_FILE_BYTES) {
      const cause = new SidebarStateValueError("Sidebar state file is not a bounded regular file");
      logStoreFailure("sidebar_state_invalid", { operation, error: cause });
      throw new SidebarStateStoreError(
        "sidebar_state_invalid",
        "Stored sidebar state is invalid or unsupported",
        409,
        { cause },
      );
    }

    const raw = await readFile(statePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_SIDEBAR_STATE_FILE_BYTES) {
      const cause = new SidebarStateValueError("Sidebar state file exceeds its byte limit");
      logStoreFailure("sidebar_state_invalid", { operation, error: cause });
      throw new SidebarStateStoreError(
        "sidebar_state_invalid",
        "Stored sidebar state is invalid or unsupported",
        409,
        { cause },
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      logStoreFailure("sidebar_state_invalid", { operation, error });
      throw new SidebarStateStoreError(
        "sidebar_state_invalid",
        "Stored sidebar state is invalid or unsupported",
        409,
        { cause: error },
      );
    }

    try {
      return parseSidebarState(value);
    } catch (error) {
      logStoreFailure("sidebar_state_invalid", { operation, error });
      throw new SidebarStateStoreError(
        "sidebar_state_invalid",
        "Stored sidebar state is invalid or unsupported",
        409,
        { cause: error },
      );
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return createDefaultSidebarState();
    if (error instanceof SidebarStateStoreError) throw error;
    logStoreFailure("sidebar_state_read_failed", { operation, error });
    throw new SidebarStateStoreError(
      "sidebar_state_read_failed",
      "Sidebar state could not be read",
      500,
      { cause: error },
    );
  }
}

async function acquireLock(
  lockPath: string,
  operation: SidebarStateOperation["operation"] | "reconcile",
  options: SidebarStateStoreOptions,
): Promise<FileHandle> {
  const timeoutMs = Math.max(0, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
  const retryMs = Math.max(1, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
        return handle;
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        logStoreFailure("sidebar_state_write_failed", { operation, error });
        throw new SidebarStateStoreError(
          "sidebar_state_write_failed",
          "Sidebar state lock could not be created",
          500,
          { cause: error },
        );
      }
      // Do not guess that an existing lock is stale: PID reuse, another host,
      // or a slow live writer can make automatic deletion lose updates. A
      // bounded timeout keeps browsing available and surfaces the need for operator recovery.
      if (Date.now() - startedAt >= timeoutMs) {
        logStoreFailure("sidebar_state_lock_timeout", { operation, error });
        throw new SidebarStateStoreError(
          "sidebar_state_lock_timeout",
          "Sidebar state is busy; refresh and try again",
          503,
          { cause: error },
        );
      }
      await delay(Math.min(retryMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    }
  }
}

async function writeStateAtomically(statePath: string, state: SidebarState, operation: SidebarStateOperation["operation"] | "reconcile"): Promise<void> {
  const temporaryPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  let temporaryCreated = false;
  try {
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (state.pinnedSessionIds.length > MAX_SIDEBAR_STATE_IDS || state.explicitlyHiddenSessionIds.length > MAX_SIDEBAR_STATE_IDS) {
      throw new SidebarStateValueError("Sidebar state exceeds its id limits");
    }
    if (Buffer.byteLength(serialized, "utf8") > MAX_SIDEBAR_STATE_FILE_BYTES) {
      throw new SidebarStateValueError("Sidebar state exceeds its byte limit");
    }
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    temporaryCreated = true;
    const temporaryHandle = await open(temporaryPath, "r");
    try {
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await rename(temporaryPath, statePath);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) await unlink(temporaryPath).catch(() => {});
    logStoreFailure("sidebar_state_write_failed", { operation, state, error });
    throw new SidebarStateStoreError(
      "sidebar_state_write_failed",
      "Sidebar state could not be written",
      500,
      { cause: error },
    );
  }
}

async function mutateStoredState(
  sessions: readonly SessionInfo[],
  operation: SidebarStateOperation | null,
  options: SidebarStateStoreOptions,
): Promise<SidebarState> {
  const paths = storePaths(options);
  const operationLabel = operation?.operation ?? "reconcile";
  try {
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    logStoreFailure("sidebar_state_write_failed", { operation: operationLabel, error });
    throw new SidebarStateStoreError(
      "sidebar_state_write_failed",
      "Sidebar state directory could not be prepared",
      500,
      { cause: error },
    );
  }

  const lockHandle = await acquireLock(paths.lockPath, operationLabel, options);
  let result: SidebarState | undefined;
  let primaryError: unknown;
  try {
    if (options.expectedSessionListGeneration !== undefined
      && getSessionListGeneration() !== options.expectedSessionListGeneration) {
      throw new SidebarStateListingChangedError();
    }
    const currentState = await readStateFile(paths.statePath, operationLabel);
    const reconciledState = reconcileSidebarState(currentState, sessions);
    const nextState = operation
      ? applySidebarStateOperation(reconciledState, operation, sessions)
      : reconciledState;

    if (sidebarStateContentEquals(currentState, nextState)) {
      result = currentState;
    } else {
      if (currentState.revision >= Number.MAX_SAFE_INTEGER) {
        const cause = new SidebarStateValueError("Sidebar state revision cannot be incremented");
        logStoreFailure("sidebar_state_invalid", { operation: operationLabel, state: currentState, error: cause });
        throw new SidebarStateStoreError(
          "sidebar_state_invalid",
          "Stored sidebar state is invalid or unsupported",
          409,
          { cause },
        );
      }
      result = { ...nextState, revision: currentState.revision + 1 };
      await writeStateAtomically(paths.statePath, result, operationLabel);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await lockHandle.close();
      await unlink(paths.lockPath);
    } catch (error) {
      if (!primaryError) {
        logStoreFailure("sidebar_state_write_failed", { operation: operationLabel, state: result, error });
        primaryError = new SidebarStateStoreError(
          "sidebar_state_write_failed",
          "Sidebar state lock could not be released",
          500,
          { cause: error },
        );
      }
    }
  }

  if (primaryError) throw primaryError;
  return result!;
}

export async function readSidebarState(options: SidebarStateStoreOptions = {}): Promise<SidebarState> {
  const { statePath } = storePaths(options);
  return readStateFile(statePath, "read");
}

export async function updateSidebarState(
  operation: SidebarStateOperation,
  sessions: readonly SessionInfo[],
  options: SidebarStateStoreOptions = {},
): Promise<SidebarState> {
  return mutateStoredState(sessions, operation, options);
}

export async function reconcileStoredSidebarState(
  sessions: readonly SessionInfo[],
  options: SidebarStateStoreOptions = {},
): Promise<SidebarState> {
  return mutateStoredState(sessions, null, options);
}
