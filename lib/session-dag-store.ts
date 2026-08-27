import { createHash, randomUUID } from "node:crypto";
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
  SESSION_DAG_MAX_RECEIPTS,
  SESSION_DAG_MAX_STATE_BYTES,
  SessionDagConflictError,
  SessionDagValueError,
  applySessionDagOperation,
  createDefaultStoredSessionDagState,
  parseStoredSessionDagState,
  toPublicSessionDagState,
  type SessionDagMutationEnvelope,
  type SessionDagOperation,
  type SessionDagState,
  type StoredSessionDagState,
} from "./session-dag";
import { getSessionListGeneration } from "./session-reader";

export const SESSION_DAG_STATE_FILENAME = "pi-web-session-dag.json";
const SESSION_DAG_LOCK_SUFFIX = ".lock";
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 25;

export type SessionDagStoreErrorCode =
  | "session_dag_state_invalid"
  | "session_dag_lock_timeout"
  | "session_dag_read_failed"
  | "session_dag_write_failed";

export type SessionDagMutationConflictCode =
  | "session_dag_mutation_id_conflict"
  | "session_dag_revision_conflict"
  | SessionDagConflictError["code"];

export class SessionDagListingChangedError extends Error {
  constructor() {
    super("Session listing changed before the session DAG mutation");
    this.name = "SessionDagListingChangedError";
  }
}

export class SessionDagStoreError extends Error {
  readonly code: SessionDagStoreErrorCode;
  readonly status: number;

  constructor(code: SessionDagStoreErrorCode, message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionDagStoreError";
    this.code = code;
    this.status = status;
  }
}

export class SessionDagMutationConflictResponseError extends Error {
  readonly code: SessionDagMutationConflictCode;
  readonly state: SessionDagState;
  readonly status = 409;

  constructor(code: SessionDagMutationConflictCode, message: string, state: SessionDagState, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionDagMutationConflictResponseError";
    this.code = code;
    this.state = state;
  }
}

export interface SessionDagStoreOptions {
  agentDir?: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  expectedSessionListGeneration?: number;
  getCurrentSessionListGeneration?: () => number;
  availableSessionIds?: ReadonlySet<string>;
  now?: () => Date;
  maximumStateBytes?: number;
}

export interface SessionDagMutationResult {
  state: SessionDagState;
  changed: boolean;
  idempotent: boolean;
}

function storePaths(options: SessionDagStoreOptions): {
  directory: string;
  statePath: string;
  lockPath: string;
} {
  const directory = options.agentDir ?? getAgentDir();
  const statePath = join(directory, SESSION_DAG_STATE_FILENAME);
  return {
    directory,
    statePath,
    lockPath: `${statePath}${SESSION_DAG_LOCK_SUFFIX}`,
  };
}

function errorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/u.test(name) ? name : "Error";
}

function safeStateCounts(state: StoredSessionDagState | SessionDagState | undefined): {
  revision: number | undefined;
  formCount: number | undefined;
  activeEdgeCount: number | undefined;
  batchCount: number | undefined;
} {
  return {
    revision: state?.revision,
    formCount: state?.forms.length,
    activeEdgeCount: state?.activeEdges.length,
    batchCount: state ? state.applied.length + state.redo.length : undefined,
  };
}

function logStoreFailure(
  category: SessionDagStoreErrorCode,
  details: {
    operation: SessionDagOperation["type"] | "read";
    stage: "directory" | "lock" | "read" | "validate" | "apply" | "serialize" | "publish" | "unlock";
    status: number;
    state?: StoredSessionDagState | SessionDagState;
    error: unknown;
  },
): void {
  console.error(`[pi-web] ${category}`, {
    operation: details.operation,
    stage: details.stage,
    ...safeStateCounts(details.state),
    status: details.status,
    errorClass: errorClass(details.error),
  });
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

function operationNeedsSessionListing(operation: SessionDagOperation): boolean {
  return operation.type === "add_edge"
    || operation.type === "replace_edge"
    || operation.type === "insert_edge";
}

function assertCurrentSessionListingGeneration(
  operation: SessionDagOperation,
  expectedGeneration: number | undefined,
  getCurrentGeneration: () => number,
): void {
  if (operationNeedsSessionListing(operation)
    && expectedGeneration !== undefined
    && getCurrentGeneration() !== expectedGeneration) {
    throw new SessionDagListingChangedError();
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
  );
}

export function digestSessionDagMutation(envelope: SessionDagMutationEnvelope): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(envelope)))
    .digest("hex");
}

async function readStateFile(
  statePath: string,
  operation: SessionDagOperation["type"] | "read",
  maximumStateBytes: number,
): Promise<StoredSessionDagState> {
  try {
    const fileStats = await stat(statePath);
    if (!fileStats.isFile() || fileStats.size > maximumStateBytes) {
      const cause = new SessionDagValueError("Session DAG state is not a bounded regular file");
      logStoreFailure("session_dag_state_invalid", {
        operation,
        stage: "validate",
        status: 409,
        error: cause,
      });
      throw new SessionDagStoreError(
        "session_dag_state_invalid",
        "Stored session DAG state is invalid or unsupported",
        409,
        { cause },
      );
    }

    const raw = await readFile(statePath, "utf8");
    if (Buffer.byteLength(raw, "utf8") > maximumStateBytes) {
      const cause = new SessionDagValueError("Session DAG state exceeds its byte limit");
      logStoreFailure("session_dag_state_invalid", {
        operation,
        stage: "validate",
        status: 409,
        error: cause,
      });
      throw new SessionDagStoreError(
        "session_dag_state_invalid",
        "Stored session DAG state is invalid or unsupported",
        409,
        { cause },
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      logStoreFailure("session_dag_state_invalid", {
        operation,
        stage: "validate",
        status: 409,
        error,
      });
      throw new SessionDagStoreError(
        "session_dag_state_invalid",
        "Stored session DAG state is invalid or unsupported",
        409,
        { cause: error },
      );
    }

    try {
      return parseStoredSessionDagState(value);
    } catch (error) {
      logStoreFailure("session_dag_state_invalid", {
        operation,
        stage: "validate",
        status: 409,
        error,
      });
      throw new SessionDagStoreError(
        "session_dag_state_invalid",
        "Stored session DAG state is invalid or unsupported",
        409,
        { cause: error },
      );
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return createDefaultStoredSessionDagState();
    if (error instanceof SessionDagStoreError) throw error;
    logStoreFailure("session_dag_read_failed", {
      operation,
      stage: "read",
      status: 500,
      error,
    });
    throw new SessionDagStoreError(
      "session_dag_read_failed",
      "Session DAG state could not be read",
      500,
      { cause: error },
    );
  }
}

async function acquireLock(
  lockPath: string,
  operation: SessionDagOperation["type"],
  options: SessionDagStoreOptions,
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
        logStoreFailure("session_dag_write_failed", {
          operation,
          stage: "lock",
          status: 500,
          error,
        });
        throw new SessionDagStoreError(
          "session_dag_write_failed",
          "Session DAG state lock could not be created",
          500,
          { cause: error },
        );
      }
      if (Date.now() - startedAt >= timeoutMs) {
        logStoreFailure("session_dag_lock_timeout", {
          operation,
          stage: "lock",
          status: 503,
          error,
        });
        throw new SessionDagStoreError(
          "session_dag_lock_timeout",
          "Session DAG state is busy; refresh and try again",
          503,
          { cause: error },
        );
      }
      await delay(Math.min(retryMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    }
  }
}

async function writeStateAtomically(
  statePath: string,
  state: StoredSessionDagState,
  operation: SessionDagOperation["type"],
  maximumStateBytes: number,
): Promise<void> {
  const temporaryPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  let temporaryCreated = false;
  try {
    // Parse the exact object again before publication. This catches accidental
    // internal drift at the same strict boundary used on restart.
    parseStoredSessionDagState(state);
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > maximumStateBytes) {
      throw new SessionDagValueError("Session DAG state exceeds its byte limit");
    }
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
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
    logStoreFailure("session_dag_write_failed", {
      operation,
      stage: error instanceof SessionDagValueError ? "serialize" : "publish",
      status: 500,
      state,
      error,
    });
    throw new SessionDagStoreError(
      "session_dag_write_failed",
      "Session DAG state could not be written",
      500,
      { cause: error },
    );
  }
}

function conflict(
  code: SessionDagMutationConflictCode,
  message: string,
  state: StoredSessionDagState,
  options?: ErrorOptions,
): SessionDagMutationConflictResponseError {
  return new SessionDagMutationConflictResponseError(
    code,
    message,
    toPublicSessionDagState(state),
    options,
  );
}

export async function readSessionDagState(options: SessionDagStoreOptions = {}): Promise<SessionDagState> {
  const { statePath } = storePaths(options);
  const maximumStateBytes = options.maximumStateBytes ?? SESSION_DAG_MAX_STATE_BYTES;
  return toPublicSessionDagState(await readStateFile(statePath, "read", maximumStateBytes));
}

export async function mutateSessionDagState(
  envelope: SessionDagMutationEnvelope,
  options: SessionDagStoreOptions = {},
): Promise<SessionDagMutationResult> {
  const paths = storePaths(options);
  const operation = envelope.operation.type;
  const maximumStateBytes = options.maximumStateBytes ?? SESSION_DAG_MAX_STATE_BYTES;
  try {
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    logStoreFailure("session_dag_write_failed", {
      operation,
      stage: "directory",
      status: 500,
      error,
    });
    throw new SessionDagStoreError(
      "session_dag_write_failed",
      "Session DAG state directory could not be prepared",
      500,
      { cause: error },
    );
  }

  const lockHandle = await acquireLock(paths.lockPath, operation, options);
  let result: SessionDagMutationResult | undefined;
  let primaryError: unknown;
  let stateForDiagnostics: StoredSessionDagState | undefined;
  try {
    const getCurrentGeneration = options.getCurrentSessionListGeneration ?? getSessionListGeneration;
    assertCurrentSessionListingGeneration(
      envelope.operation,
      options.expectedSessionListGeneration,
      getCurrentGeneration,
    );

    const currentState = await readStateFile(paths.statePath, operation, maximumStateBytes);
    stateForDiagnostics = currentState;
    // readStateFile is asynchronous. Recheck immediately before the synchronous
    // receipt/revision/apply decision so a rename/create invalidation that raced
    // the state read cannot authorize an add/replace/insert from an obsolete listing.
    assertCurrentSessionListingGeneration(
      envelope.operation,
      options.expectedSessionListGeneration,
      getCurrentGeneration,
    );
    const digest = digestSessionDagMutation(envelope);
    const existingReceipt = currentState.receipts.find((receipt) => receipt.mutationId === envelope.mutationId);
    if (existingReceipt) {
      if (existingReceipt.digest !== digest) {
        throw conflict(
          "session_dag_mutation_id_conflict",
          "That mutation id was already used for another request",
          currentState,
        );
      }
      result = {
        state: toPublicSessionDagState(currentState),
        changed: false,
        idempotent: true,
      };
    } else {
      if (envelope.baseRevision !== currentState.revision) {
        throw conflict(
          "session_dag_revision_conflict",
          "Graph changed elsewhere; review and retry",
          currentState,
        );
      }

      let applied;
      try {
        applied = applySessionDagOperation(
          toPublicSessionDagState(currentState),
          envelope.operation,
          {
            availableSessionIds: options.availableSessionIds,
            now: options.now,
          },
        );
      } catch (error) {
        if (error instanceof SessionDagConflictError) {
          throw conflict(error.code, error.message, currentState, { cause: error });
        }
        throw error;
      }

      if (applied.changed && currentState.revision >= Number.MAX_SAFE_INTEGER) {
        throw conflict(
          "session_dag_counter_overflow",
          "The graph revision cannot advance",
          currentState,
        );
      }
      const revision = applied.changed ? currentState.revision + 1 : currentState.revision;
      const receipts = [
        ...currentState.receipts,
        { mutationId: envelope.mutationId, digest, revision },
      ].slice(-SESSION_DAG_MAX_RECEIPTS);
      const nextState: StoredSessionDagState = {
        ...applied.state,
        revision,
        receipts,
      };
      const prospectiveStateBytes = Buffer.byteLength(
        `${JSON.stringify(nextState, null, 2)}\n`,
        "utf8",
      );
      if (prospectiveStateBytes > maximumStateBytes) {
        throw conflict(
          "session_dag_limit_exceeded",
          "The graph has reached its storage limit",
          currentState,
        );
      }
      await writeStateAtomically(paths.statePath, nextState, operation, maximumStateBytes);
      stateForDiagnostics = nextState;
      result = {
        state: toPublicSessionDagState(nextState),
        changed: applied.changed,
        idempotent: false,
      };
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await lockHandle.close();
      await unlink(paths.lockPath);
    } catch (error) {
      if (!primaryError) {
        logStoreFailure("session_dag_write_failed", {
          operation,
          stage: "unlock",
          status: 500,
          state: stateForDiagnostics,
          error,
        });
        primaryError = new SessionDagStoreError(
          "session_dag_write_failed",
          "Session DAG state lock could not be released",
          500,
          { cause: error },
        );
      }
    }
  }

  if (primaryError) throw primaryError;
  return result!;
}
