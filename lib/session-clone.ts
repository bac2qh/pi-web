import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, unlinkSync } from "fs";
import { dirname, normalize } from "path";

export type SessionCloneStatus =
  | "created"
  | "nothing_to_clone"
  | "missing_source"
  | "stale_leaf"
  | "clone_failed";

export type SessionCloneResult =
  | { status: "created"; newSessionId: string; newSessionFile: string }
  | { status: Exclude<SessionCloneStatus, "created"> };

type CloneFailureStage = "eligibility" | "extract" | "verify" | "cleanup";

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
      stage: "cleanup" satisfies CloneFailureStage,
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
