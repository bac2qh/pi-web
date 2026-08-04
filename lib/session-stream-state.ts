import {
  PROJECTED_SESSION_PROTOCOL,
  PROJECTED_SESSION_VERSION,
  parseProjectedSessionFrame,
  type ProjectedSessionEffect,
  type ProjectedSessionState,
  type SnapshotStartFrame,
} from "./session-protocol";
import {
  applyProjectedSessionUnit,
  createSessionReceiver,
  type SessionReceiver,
} from "./session-reducer";
import type {
  SessionTransportReadyFrame,
  SessionTransportReadyOutcome,
} from "./session-transport-protocol";

export type SessionStreamPhase = "idle" | "awaiting_ready" | "recovering" | "live" | "terminal";
export type SessionStreamFault =
  | "protocol_malformed"
  | "protocol_unknown_type"
  | "unsupported_protocol"
  | "cursor_gap"
  | "epoch_mismatch"
  | "snapshot_invalid";

export type SessionStreamSnapshot = Readonly<{
  phase: SessionStreamPhase;
  serverInstanceId: string | null;
  streamEpoch: string | null;
  cursor: number;
  state: ProjectedSessionState;
  readyOutcome: SessionTransportReadyOutcome | null;
}>;

export type SessionStreamTransition = Readonly<{
  outcome: "accepted" | "duplicate" | "fault";
  changed: boolean;
  targetReached: boolean;
  fault: SessionStreamFault | null;
  effect?: ProjectedSessionEffect;
  sequence?: number;
}>;

type Target = Readonly<{
  streamEpoch: string;
  cursor: number;
  outcome: SessionTransportReadyOutcome;
  snapshotReason: "initial" | "recovery" | null;
}>;

const accepted = (changed: boolean, targetReached = false, effect?: ProjectedSessionEffect, sequence?: number): SessionStreamTransition => Object.freeze({
  outcome: "accepted" as const,
  changed,
  targetReached,
  fault: null,
  ...(effect === undefined ? {} : { effect }),
  ...(sequence === undefined ? {} : { sequence }),
});
const duplicate = (): SessionStreamTransition => Object.freeze({ outcome: "duplicate", changed: false, targetReached: false, fault: null });
const fault = (reason: SessionStreamFault): SessionStreamTransition => Object.freeze({ outcome: "fault", changed: false, targetReached: false, fault: reason });

/**
 * Pure target-gated composition around the accepted SessionReceiver. The
 * committed receiver never contains a partial snapshot assembly.
 */
export class SessionStreamState {
  private committed: SessionReceiver;
  private candidate: SessionReceiver;
  private phase: SessionStreamPhase = "idle";
  private serverInstanceId: string | null = null;
  private readyOutcome: SessionTransportReadyOutcome | null = null;
  private target: Target | null = null;
  private duplicateSnapshotCandidate: SessionReceiver | null = null;
  private snapshot: SessionStreamSnapshot;

  constructor(receiver: SessionReceiver = createSessionReceiver()) {
    if (receiver.assembly) throw new Error("session_stream_receiver_must_be_committed");
    this.committed = receiver;
    this.candidate = receiver;
    this.snapshot = this.makeSnapshot();
  }

  getSnapshot(): SessionStreamSnapshot { return this.snapshot; }
  getCommittedReceiver(): SessionReceiver { return this.committed; }

  beginAttempt(): void {
    this.discardCandidate();
    this.serverInstanceId = null;
    this.readyOutcome = null;
    this.phase = "awaiting_ready";
    this.publish();
  }

  resetConnection(): void {
    this.discardCandidate();
    this.serverInstanceId = null;
    this.readyOutcome = null;
    this.phase = "idle";
    this.publish();
  }

  markTerminal(): void {
    this.discardCandidate();
    this.phase = "terminal";
    this.publish();
  }

  acceptReady(ready: SessionTransportReadyFrame): SessionStreamTransition {
    if (this.phase !== "awaiting_ready" || this.target) return this.reject("protocol_malformed");
    const heldEpoch = this.committed.streamEpoch;
    const heldCursor = this.committed.cursor;
    let snapshotReason: Target["snapshotReason"] = null;
    let reachesTarget = false;

    switch (ready.outcome) {
      case "empty":
        if (heldEpoch === null || heldEpoch !== ready.streamEpoch || heldCursor !== ready.cursor) {
          return this.reject(heldEpoch !== ready.streamEpoch ? "epoch_mismatch" : "cursor_gap");
        }
        reachesTarget = true;
        break;
      case "exact":
        if (heldEpoch === null || heldEpoch !== ready.streamEpoch) return this.reject("epoch_mismatch");
        if (ready.cursor < heldCursor) return this.reject("cursor_gap");
        reachesTarget = ready.cursor === heldCursor;
        break;
      case "initial_snapshot":
        if (heldEpoch !== null) return this.reject("snapshot_invalid");
        snapshotReason = "initial";
        break;
      case "wrong_epoch":
        if (heldEpoch === null || heldEpoch === ready.streamEpoch) return this.reject("epoch_mismatch");
        snapshotReason = "recovery";
        break;
      case "overflow_snapshot":
        if (heldEpoch === null || heldEpoch !== ready.streamEpoch) return this.reject("epoch_mismatch");
        if (ready.cursor <= heldCursor) return this.reject("cursor_gap");
        snapshotReason = "recovery";
        break;
      case "invalid_cursor":
        if (heldEpoch === null || heldEpoch !== ready.streamEpoch) return this.reject("epoch_mismatch");
        if (ready.cursor >= heldCursor) return this.reject("cursor_gap");
        snapshotReason = "recovery";
        break;
    }

    this.target = Object.freeze({
      streamEpoch: ready.streamEpoch,
      cursor: ready.cursor,
      outcome: ready.outcome,
      snapshotReason,
    });
    this.serverInstanceId = ready.serverInstanceId;
    this.readyOutcome = ready.outcome;
    this.phase = reachesTarget ? "live" : "recovering";
    if (snapshotReason) {
      // A recovery snapshot may intentionally replace an equal/lower cursor in
      // the same epoch. Assemble against a cursor-neutral receiver while its
      // durable state remains the previously committed state.
      this.candidate = createSessionReceiver(this.committed.state, this.committed.limits);
    } else {
      this.candidate = this.committed;
    }
    this.publish();
    return accepted(true, reachesTarget);
  }

  applyUnit(input: unknown): SessionStreamTransition {
    if ((this.phase !== "recovering" && this.phase !== "live") || !this.target) return this.reject("protocol_malformed");
    const parsed = parseProjectedSessionFrame(input);
    if (!parsed.ok) {
      if (parsed.reason === "unsupported_version") return this.reject("unsupported_protocol");
      if (parsed.reason === "unknown_type") return this.reject("protocol_unknown_type");
      return this.reject("protocol_malformed");
    }
    const frame = parsed.frame;
    const target = this.target;
    const snapshotUnit = frame.type === "snapshot_start" || frame.type === "snapshot_chunk" || frame.type === "snapshot_end";

    if (this.duplicateSnapshotCandidate) {
      if (!snapshotUnit || frame.type === "snapshot_start") return this.reject("snapshot_invalid");
      const duplicateResult = applyProjectedSessionUnit(this.duplicateSnapshotCandidate, frame);
      if (duplicateResult.outcome === "snapshot_pending") {
        this.duplicateSnapshotCandidate = duplicateResult.receiver;
        return accepted(false);
      }
      if (duplicateResult.outcome === "snapshot_applied") {
        this.duplicateSnapshotCandidate = null;
        return duplicate();
      }
      return this.reject(frame.streamEpoch !== this.committed.streamEpoch ? "epoch_mismatch" : "snapshot_invalid");
    }

    if (frame.type === "snapshot_start") {
      const authorization = this.authorizeSnapshotStart(frame, target);
      if (typeof authorization === "object") return authorization;
      if (authorization === "duplicate") {
        const duplicateResult = applyProjectedSessionUnit(createSessionReceiver(this.committed.state, this.committed.limits), frame);
        if (duplicateResult.outcome !== "snapshot_pending") return this.reject("snapshot_invalid");
        this.duplicateSnapshotCandidate = duplicateResult.receiver;
        return accepted(false);
      }
    } else if (snapshotUnit) {
      if (!this.candidate.assembly) return this.reject("snapshot_invalid");
    } else {
      if (this.candidate.assembly) return this.reject("snapshot_invalid");
      if (target.snapshotReason !== null && this.phase === "recovering") return this.reject("snapshot_invalid");
      if (frame.streamEpoch !== this.committed.streamEpoch) return this.reject("epoch_mismatch");
      if (this.phase === "recovering" && frame.sequence > target.cursor) return this.reject("cursor_gap");
    }

    const result = applyProjectedSessionUnit(this.candidate, frame);
    if (result.outcome === "duplicate") return duplicate();
    if (result.outcome === "gap") return this.reject("cursor_gap");
    if (result.outcome === "wrong_epoch") return this.reject("epoch_mismatch");
    if (result.outcome === "invalid") return this.reject(snapshotUnit || this.candidate.assembly ? "snapshot_invalid" : "protocol_malformed");

    this.candidate = result.receiver;
    if (result.outcome === "snapshot_pending") return accepted(false);

    if (result.outcome === "applied" || result.outcome === "snapshot_applied") {
      if (result.receiver.assembly) return this.reject("snapshot_invalid");
      if (this.phase === "recovering" && result.receiver.cursor > target.cursor) return this.reject("cursor_gap");
      if (this.phase === "recovering" && result.receiver.cursor === target.cursor
        && result.receiver.streamEpoch !== target.streamEpoch) return this.reject("epoch_mismatch");
      const targetReached = this.phase === "recovering"
        && result.receiver.streamEpoch === target.streamEpoch
        && result.receiver.cursor === target.cursor;
      this.committed = result.receiver;
      if (targetReached) this.phase = "live";
      this.publish();
      return accepted(true, targetReached, result.outcome === "applied" ? result.effect : undefined, result.outcome === "applied" ? frame.sequence : undefined);
    }
    return this.reject("protocol_malformed");
  }

  private authorizeSnapshotStart(frame: SnapshotStartFrame, target: Target): "apply" | "duplicate" | SessionStreamTransition {
    if (this.candidate.assembly) return this.reject("snapshot_invalid");
    if (this.phase === "recovering" && target.snapshotReason !== null) {
      return frame.reason === target.snapshotReason
        && frame.streamEpoch === target.streamEpoch
        && frame.sequence === target.cursor
        ? "apply"
        : this.reject(frame.streamEpoch !== target.streamEpoch ? "epoch_mismatch" : "snapshot_invalid");
    }

    // Retained exact replay and live finality may contain only same-epoch final
    // snapshots. A complete older transaction is validated and ignored.
    if (frame.streamEpoch === this.committed.streamEpoch && frame.sequence <= this.committed.cursor) {
      return frame.reason === "final" ? "duplicate" : this.reject("snapshot_invalid");
    }
    if (frame.reason !== "final") return this.reject("snapshot_invalid");
    if (frame.streamEpoch !== this.committed.streamEpoch) return this.reject("epoch_mismatch");
    if (frame.sequence !== this.committed.cursor + 1) return this.reject("cursor_gap");
    if (this.phase === "recovering" && frame.sequence > target.cursor) return this.reject("cursor_gap");
    return "apply";
  }

  private discardCandidate(): void {
    this.candidate = this.committed;
    this.duplicateSnapshotCandidate = null;
    this.target = null;
  }

  private reject(reason: SessionStreamFault): SessionStreamTransition {
    this.discardCandidate();
    this.serverInstanceId = null;
    this.readyOutcome = null;
    this.phase = "idle";
    this.publish();
    return fault(reason);
  }

  private makeSnapshot(): SessionStreamSnapshot {
    return Object.freeze({
      phase: this.phase,
      serverInstanceId: this.serverInstanceId,
      streamEpoch: this.committed.streamEpoch,
      cursor: this.committed.cursor,
      state: this.committed.state,
      readyOutcome: this.readyOutcome,
    });
  }

  private publish(): void { this.snapshot = this.makeSnapshot(); }
}

export function isProjectedSessionV1Envelope(value: unknown): boolean {
  return !!value && typeof value === "object"
    && (value as { protocol?: unknown }).protocol === PROJECTED_SESSION_PROTOCOL
    && (value as { version?: unknown }).version === PROJECTED_SESSION_VERSION;
}
