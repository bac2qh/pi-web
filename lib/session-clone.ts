import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, unlinkSync } from "fs";
import { dirname, normalize } from "path";
import {
  SIDE_SESSION_MARKER_CONTENT,
  SIDE_SESSION_MARKER_TYPE,
  SIDE_SESSION_POLICY_VERSION,
  classifySideSession,
} from "./side-session";

export type SessionCloneStatus =
  | "created"
  | "nothing_to_clone"
  | "missing_source"
  | "stale_leaf"
  | "clone_failed";

export type SessionCloneResult =
  | { status: "created"; newSessionId: string; newSessionFile: string }
  | { status: Exclude<SessionCloneStatus, "created"> };

export type SideSessionCreateStatus =
  | "created"
  | "nothing_to_clone"
  | "missing_source"
  | "stale_cutoff"
  | "side_failed";

export type SideSessionCreateResult =
  | { status: "created"; newSessionId: string; newSessionFile: string; markerEntryId: string; name: string }
  | { status: Exclude<SideSessionCreateStatus, "created"> };

export interface SideSessionFinalizeTestHooks {
  afterExtract?(): void;
  afterMarker?(): void;
  afterName?(): void;
  beforeVerify?(): void;
}

type CloneFailureStage = "eligibility" | "extract" | "verify" | "cleanup";
type SideFailureStage = "eligibility" | "extract" | "marker" | "name" | "verify" | "cleanup";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function logCloneFailure(sourceSessionId: string, stage: Exclude<CloneFailureStage, "cleanup">, error: unknown): void {
  console.error("[pi-web] session_clone_failed", {
    sourceSessionId,
    stage,
    errorName: errorName(error),
  });
}

function logSideFailure(sourceSessionId: string, stage: Exclude<SideFailureStage, "cleanup">, error: unknown): void {
  console.error("[pi-web] side_session_failed", {
    sourceSessionId,
    stage,
    errorName: errorName(error),
  });
}

function cleanupFailedCandidate(
  candidatePath: string | undefined,
  sourceSessionFile: string,
  sourceSessionDir: string,
  sourceSessionId: string,
): void {
  if (!candidatePath) return;
  const normalizedCandidate = normalize(candidatePath);
  if (
    normalizedCandidate === normalize(sourceSessionFile)
    || dirname(normalizedCandidate) !== normalize(sourceSessionDir)
    || !existsSync(normalizedCandidate)
  ) {
    return;
  }

  try {
    unlinkSync(normalizedCandidate);
  } catch (error) {
    console.warn("[pi-web] session_clone_cleanup_failed", {
      sourceSessionId,
      stage: "cleanup" satisfies CloneFailureStage | SideFailureStage,
      errorName: errorName(error),
    });
  }
}

/**
 * Clone one persisted source branch with Pi's native extraction primitive.
 * The source is reopened on a disposable manager because createBranchedSession()
 * replaces the manager state it is called on.
 */
export function cloneSessionBranch(options: {
  sourceSessionFile: string;
  sourceSessionDir: string;
  sourceSessionId: string;
  activeLeafId: string;
}): SessionCloneResult {
  const { sourceSessionFile, sourceSessionDir, sourceSessionId, activeLeafId } = options;

  if (!existsSync(sourceSessionFile)) return { status: "missing_source" };

  let disposableManager: SessionManager;
  try {
    disposableManager = SessionManager.open(sourceSessionFile, sourceSessionDir);
  } catch (error) {
    if (!existsSync(sourceSessionFile)) return { status: "missing_source" };
    logCloneFailure(sourceSessionId, "eligibility", error);
    return { status: "clone_failed" };
  }

  if (!disposableManager.getEntry(activeLeafId)) return { status: "stale_leaf" };

  let candidatePath: string | undefined;
  try {
    candidatePath = disposableManager.createBranchedSession(activeLeafId);
  } catch (error) {
    candidatePath = disposableManager.getSessionFile();
    cleanupFailedCandidate(candidatePath, sourceSessionFile, sourceSessionDir, sourceSessionId);
    logCloneFailure(sourceSessionId, "extract", error);
    return { status: "clone_failed" };
  }

  if (!candidatePath || normalize(candidatePath) === normalize(sourceSessionFile)) {
    cleanupFailedCandidate(candidatePath, sourceSessionFile, sourceSessionDir, sourceSessionId);
    logCloneFailure(sourceSessionId, "verify", new Error("Native clone did not return a distinct candidate"));
    return { status: "clone_failed" };
  }

  // Pi intentionally defers writing branches without an assistant message.
  // The web host has no replacement runtime to retain that manager, so absence
  // is an ineligible clone rather than a successful, undiscoverable session.
  if (!existsSync(candidatePath)) return { status: "nothing_to_clone" };

  try {
    const clonedManager = SessionManager.open(candidatePath, sourceSessionDir);
    const newSessionId = clonedManager.getSessionId();
    if (!newSessionId || newSessionId === sourceSessionId) {
      throw new Error("Native clone did not produce a distinct session ID");
    }
    return { status: "created", newSessionId, newSessionFile: candidatePath };
  } catch (error) {
    cleanupFailedCandidate(candidatePath, sourceSessionFile, sourceSessionDir, sourceSessionId);
    logCloneFailure(sourceSessionId, "verify", error);
    return { status: "clone_failed" };
  }
}

/**
 * Extract and transactionally finalize a durable side child. The candidate is
 * unadvertised until its targeted hidden boundary, name, native ancestry, and
 * reopened identity have all been verified.
 */
export function createSideSessionBranch(options: {
  sourceSessionFile: string;
  sourceSessionDir: string;
  sourceSessionId: string;
  cutoffId: string;
  name: string;
  testHooks?: SideSessionFinalizeTestHooks;
}): SideSessionCreateResult {
  const {
    sourceSessionFile,
    sourceSessionDir,
    sourceSessionId,
    cutoffId,
    name,
    testHooks,
  } = options;
  if (!existsSync(sourceSessionFile)) return { status: "missing_source" };

  let disposableManager: SessionManager;
  try {
    disposableManager = SessionManager.open(sourceSessionFile, sourceSessionDir);
  } catch (error) {
    if (!existsSync(sourceSessionFile)) return { status: "missing_source" };
    logSideFailure(sourceSessionId, "eligibility", error);
    return { status: "side_failed" };
  }
  if (!disposableManager.getEntry(cutoffId)) return { status: "stale_cutoff" };
  const sourceBranchNonLabelIds = disposableManager.getBranch(cutoffId)
    .filter((entry) => entry.type !== "label")
    .map((entry) => entry.id);

  let candidatePath: string | undefined;
  let candidateBoundaryParentId: string | undefined;
  let stage: Exclude<SideFailureStage, "cleanup"> = "extract";
  try {
    candidatePath = disposableManager.createBranchedSession(cutoffId);
    if (!candidatePath || normalize(candidatePath) === normalize(sourceSessionFile)) {
      throw new Error("Native side extraction did not return a distinct candidate");
    }
    if (!existsSync(candidatePath)) return { status: "nothing_to_clone" };
    testHooks?.afterExtract?.();

    const candidate = SessionManager.open(candidatePath, sourceSessionDir);
    const newSessionId = candidate.getSessionId();
    candidateBoundaryParentId = candidate.getLeafId() ?? undefined;
    const candidateNonLabelIds = candidate.getEntries()
      .filter((entry) => entry.type !== "label")
      .map((entry) => entry.id);
    if (!newSessionId || newSessionId === sourceSessionId
      || !candidateBoundaryParentId
      || candidateNonLabelIds.length !== sourceBranchNonLabelIds.length
      || candidateNonLabelIds.some((id, index) => id !== sourceBranchNonLabelIds[index])) {
      throw new Error("Native side extraction did not preserve the selected source prefix");
    }

    stage = "marker";
    const markerEntryId = candidate.appendCustomMessageEntry(
      SIDE_SESSION_MARKER_TYPE,
      SIDE_SESSION_MARKER_CONTENT,
      false,
      { version: SIDE_SESSION_POLICY_VERSION, targetSessionId: newSessionId },
    );
    testHooks?.afterMarker?.();

    stage = "name";
    const nameEntryId = candidate.appendSessionInfo(name);
    testHooks?.afterName?.();

    stage = "verify";
    testHooks?.beforeVerify?.();
    const verified = SessionManager.open(candidatePath, sourceSessionDir);
    const header = verified.getHeader();
    const entries = verified.getEntries();
    const classification = classifySideSession(entries as never, newSessionId, verified.getLeafId());
    const markerEntry = verified.getEntry(markerEntryId);
    const nameEntry = verified.getEntry(nameEntryId);
    if (verified.getSessionId() !== newSessionId
      || !header?.parentSession
      || normalize(header.parentSession) !== normalize(sourceSessionFile)
      || classification.kind !== "side"
      || classification.metadata.markerEntryId !== markerEntryId
      || markerEntry?.parentId !== candidateBoundaryParentId
      || nameEntry?.type !== "session_info"
      || nameEntry.parentId !== markerEntryId
      || nameEntry.name !== name
      || verified.getSessionName() !== name
      || verified.getLeafId() !== nameEntryId) {
      throw new Error("Side candidate verification failed");
    }

    return { status: "created", newSessionId, newSessionFile: candidatePath, markerEntryId, name };
  } catch (error) {
    if (!candidatePath) candidatePath = disposableManager.getSessionFile();
    cleanupFailedCandidate(candidatePath, sourceSessionFile, sourceSessionDir, sourceSessionId);
    logSideFailure(sourceSessionId, stage, error);
    return { status: "side_failed" };
  }
}
