import { randomUUID } from "node:crypto";
import {
  DEFAULT_SESSION_REPLAY_BYTES,
  DEFAULT_SESSION_REPLAY_UNITS,
  DEFAULT_SESSION_SNAPSHOT_UNIT_BYTES,
  DEFAULT_SESSION_STATE_DEPTH,
  DEFAULT_SESSION_STATE_NODES,
  DEFAULT_SESSION_SNAPSHOT_BYTES,
  DEFAULT_SESSION_SNAPSHOT_PARTS,
  PROJECTED_SESSION_PROTOCOL,
  PROJECTED_SESSION_VERSION,
  createInitialProjectedSessionState,
  encodeProjectedSessionFrame,
  freezeCanonicalData,
  parseProjectedSessionFrame,
  parseProjectedSessionState,
  resolveProjectedSessionStateLimits,
  type ProjectedSessionFrame,
  type ProjectedSessionState,
  type ProjectedSessionStateLimits,
  type SnapshotReason,
  type SnapshotTransferFrame,
} from "./session-protocol";
import {
  captureSessionProjectionInput,
  classifyAcceptedNativeLifecycleInput,
  projectSessionInput,
  type AcceptedNativeLifecycleInput,
  type ProjectionDiagnostic,
  type SessionProjectionInput,
} from "./session-projector";
import {
  canReduceProjectedSessionFrame,
  freezeProjectedSessionTransition,
  isProjectedSessionStateWithSettlementRepresentable,
  makeLogicalFrame,
  measureProjectedSessionState,
  measureProjectedSessionTransition,
  reduceProjectedSessionFrame,
  snapshotRawChunkSize,
  type CanonicalStateMetrics,
} from "./session-reducer";

export const PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL = Symbol.for("pi-web.projected-session-hub.v1");
const HUB_OWNER = "pi-web" as const;

export type SessionHubDiagnostic =
  | ProjectionDiagnostic
  | { kind: "replay"; outcome: ReplayOutcome; occupancy: "empty" | "low" | "medium" | "high" }
  | { kind: "frame"; frameType: ProjectedSessionFrame["type"]; byteClass: "small" | "medium" | "large" | "oversized"; replayClass: "retained" | "not_retained"; finality: "ordinary" | "final_snapshot" }
  | { kind: "listener"; outcome: "threw" | "closed" }
  | { kind: "final_equality"; outcome: "equal" | "mismatch" | "not_comparable"; inputClass: "assistant" };

export type SessionHubOptions = {
  replayByteLimit?: number;
  replayUnitLimit?: number;
  /** Applies only to encoded snapshot start/chunk/end transfer units. */
  encodedUnitByteLimit?: number;
  canonicalDepthLimit?: number;
  canonicalNodeLimit?: number;
  snapshotByteLimit?: number;
  snapshotPartLimit?: number;
  streamEpoch?: string;
  diagnostic?: (diagnostic: SessionHubDiagnostic) => void;
  initialQueue?: { steering?: readonly string[]; followUp?: readonly string[] };
};

type ReplayGroup = { sequence: number; units: ProjectedSessionFrame[]; bytes: number };
type PlannedGroup = ReplayGroup & { stateAfter: ProjectedSessionState; metricsAfter: CanonicalStateMetrics; finality: "ordinary" | "final_snapshot" };
type PlannedInput = { outcome: "committed" | "rejected"; groups: PlannedGroup[] };
export type ReplayOutcome = "exact" | "empty" | "initial_snapshot" | "overflow_snapshot" | "wrong_epoch" | "invalid_cursor" | "closed";
export type ReplayResult = { outcome: ReplayOutcome; units: ProjectedSessionFrame[]; cursor: number; streamEpoch: string };
export type HubListener = (unit: ProjectedSessionFrame) => void;
export type PreparedSessionProjectionInput = Readonly<{ lifecycle: AcceptedNativeLifecycleInput | null }>;
export type ProjectedInputCommitOutcome = "committed" | "rejected";
export type ProjectedInputCommitReceipt = Readonly<{
  whenResolved(callback: (outcome: ProjectedInputCommitOutcome) => void): void;
}>;

type AcceptedInputQueueEntry = {
  input: SessionProjectionInput | { type: string; [key: string]: unknown };
  resolve: (outcome: ProjectedInputCommitOutcome) => void;
};

export type ProjectedSessionHubReader = {
  readonly streamEpoch: string;
  readonly cursor: number;
  readonly floor: number;
  getState(): ProjectedSessionState;
  getReplayOccupancy(): { bytes: number; units: number; groups: number; floor: number; cursor: number };
  isClosed(): boolean;
  snapshot(reason?: "initial" | "recovery"): SnapshotTransferFrame[];
  replayAfter(streamEpoch: string | null, cursor: number | null): ReplayResult;
  attach(streamEpoch: string | null, cursor: number | null, listener: HubListener): ReplayResult & { unsubscribe: () => void };
};

export type ProjectedSessionHubCapability = {
  protocol: "pi-web-projected-session-hub";
  version: 1;
  owner: typeof HUB_OWNER;
  hub: ProjectedSessionHubReader;
};

const installedHubInternals = new WeakMap<object, ProjectedSessionEventHub>();

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function cloneState(state: ProjectedSessionState, limits: Partial<ProjectedSessionStateLimits> = {}): ProjectedSessionState {
  const parsed = parseProjectedSessionState(state, limits);
  if (!parsed) throw new Error("invalid_canonical_projected_state");
  return parsed;
}
function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}


export function createSnapshotTransfer(
  streamEpoch: string,
  sequence: number,
  reason: SnapshotReason,
  state: ProjectedSessionState,
  encodedUnitByteLimit = DEFAULT_SESSION_SNAPSHOT_UNIT_BYTES,
  transferId = randomUUID(),
  stateLimits: Partial<ProjectedSessionStateLimits> = {},
): SnapshotTransferFrame[] {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(encodedUnitByteLimit) || encodedUnitByteLimit < 256) {
    throw new Error("invalid_snapshot_transfer_limit");
  }
  const limits = resolveProjectedSessionStateLimits(stateLimits);
  const canonical = cloneState({ ...state, transcriptRefreshRequired: true, runtimeRefreshRequired: true }, limits);
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  if (bytes.byteLength === 0 || bytes.byteLength > limits.snapshotByteLimit) throw new Error("snapshot_state_exceeds_byte_limit");

  const chunkTemplate = (partIndex: number, data: string): SnapshotTransferFrame => ({
    protocol: PROJECTED_SESSION_PROTOCOL,
    version: PROJECTED_SESSION_VERSION,
    streamEpoch,
    sequence,
    type: "snapshot_chunk",
    transferId,
    partIndex,
    data,
  });
  // Size chunks against the largest V1 sequence and part-index widths so a
  // state accepted now remains transferable after later sequence growth.
  const rawChunkSize = snapshotRawChunkSize(streamEpoch, bytes.byteLength, encodedUnitByteLimit, transferId);
  if (rawChunkSize === 0) throw new Error("snapshot_transfer_metadata_exceeds_unit_limit");
  const partCount = Math.ceil(bytes.byteLength / rawChunkSize);
  if (partCount > limits.snapshotPartLimit) throw new Error("snapshot_state_exceeds_part_limit");
  const start: SnapshotTransferFrame = {
    protocol: PROJECTED_SESSION_PROTOCOL,
    version: PROJECTED_SESSION_VERSION,
    streamEpoch,
    sequence,
    type: "snapshot_start",
    transferId,
    reason,
    partCount,
    byteLength: bytes.byteLength,
    transcriptRefreshRequired: true,
    runtimeRefreshRequired: true,
  };
  const end: SnapshotTransferFrame = { protocol: PROJECTED_SESSION_PROTOCOL, version: PROJECTED_SESSION_VERSION, streamEpoch, sequence, type: "snapshot_end", transferId };
  if (utf8Bytes(encodeProjectedSessionFrame(start)) > encodedUnitByteLimit || utf8Bytes(encodeProjectedSessionFrame(end)) > encodedUnitByteLimit) {
    throw new Error("snapshot_transfer_metadata_exceeds_unit_limit");
  }
  const units: SnapshotTransferFrame[] = [freezeCanonicalData(start)];
  for (let offset = 0, partIndex = 0; offset < bytes.byteLength; offset += rawChunkSize, partIndex += 1) {
    const unit = chunkTemplate(partIndex, base64Url(bytes.subarray(offset, Math.min(bytes.byteLength, offset + rawChunkSize))));
    if (utf8Bytes(encodeProjectedSessionFrame(unit)) > encodedUnitByteLimit) throw new Error("snapshot_transfer_unit_exceeds_limit");
    units.push(freezeCanonicalData(unit));
  }
  units.push(freezeCanonicalData(end));
  return Object.freeze(units) as unknown as SnapshotTransferFrame[];
}


export class ProjectedSessionEventHub {
  readonly streamEpoch: string;
  private sequence = 0;
  private replayFloor = 0;
  private state: ProjectedSessionState;
  private stateMetrics: CanonicalStateMetrics;
  private replayGroups: ReplayGroup[] = [];
  private replayHead = 0;
  private replayBytes = 0;
  private replayUnits = 0;
  private listeners = new Set<HubListener>();
  private acceptedInputs: AcceptedInputQueueEntry[] = [];
  private acceptedInputHead = 0;
  private readonly preparedInputs = new WeakMap<object, SessionProjectionInput | { type: string; [key: string]: unknown }>();
  private processing = false;
  private closeRequested = false;
  private closed = false;
  private reportingDiagnostic = false;
  private readonly replayByteLimit: number;
  private readonly replayUnitLimit: number;
  private readonly encodedUnitByteLimit: number;
  private readonly stateLimits: ProjectedSessionStateLimits;
  private readonly diagnostic?: (diagnostic: SessionHubDiagnostic) => void;

  constructor(options: SessionHubOptions = {}) {
    this.streamEpoch = options.streamEpoch ?? randomUUID();
    this.replayByteLimit = options.replayByteLimit ?? DEFAULT_SESSION_REPLAY_BYTES;
    this.replayUnitLimit = options.replayUnitLimit ?? DEFAULT_SESSION_REPLAY_UNITS;
    this.encodedUnitByteLimit = options.encodedUnitByteLimit ?? DEFAULT_SESSION_SNAPSHOT_UNIT_BYTES;
    this.stateLimits = Object.freeze(resolveProjectedSessionStateLimits({
      canonicalDepthLimit: options.canonicalDepthLimit ?? DEFAULT_SESSION_STATE_DEPTH,
      canonicalNodeLimit: options.canonicalNodeLimit ?? DEFAULT_SESSION_STATE_NODES,
      snapshotByteLimit: options.snapshotByteLimit ?? DEFAULT_SESSION_SNAPSHOT_BYTES,
      snapshotPartLimit: options.snapshotPartLimit ?? DEFAULT_SESSION_SNAPSHOT_PARTS,
    }));
    this.diagnostic = options.diagnostic;
    if (!this.streamEpoch || this.streamEpoch.length > 128 || !Number.isSafeInteger(this.replayByteLimit) || this.replayByteLimit <= 0 || !Number.isSafeInteger(this.replayUnitLimit) || this.replayUnitLimit <= 0 || !Number.isSafeInteger(this.encodedUnitByteLimit) || this.encodedUnitByteLimit < 256) {
      throw new Error("invalid_projected_session_hub_options");
    }
    this.state = createInitialProjectedSessionState(options.initialQueue);
    this.stateMetrics = measureProjectedSessionState(this.state);
    if (!this.isRepresentable(this.state, this.stateMetrics)) throw new Error("initial_projected_session_state_exceeds_limit");
    // Validate metadata/chunk representability once at construction as well as
    // the aggregate state budgets used for every later precommit.
    createSnapshotTransfer(this.streamEpoch, 0, "initial", this.state, this.encodedUnitByteLimit, randomUUID(), this.stateLimits);
  }

  get cursor(): number { return this.sequence; }
  get floor(): number { return this.replayFloor; }
  isClosed(): boolean { return this.closed; }
  getState(): ProjectedSessionState { return this.state; }
  getReplayOccupancy(): { bytes: number; units: number; groups: number; floor: number; cursor: number } {
    return Object.freeze({ bytes: this.replayBytes, units: this.replayUnits, groups: this.replayGroups.length - this.replayHead, floor: this.replayFloor, cursor: this.sequence });
  }

  private occupancyClass(): "empty" | "low" | "medium" | "high" {
    if (this.replayUnits === 0) return "empty";
    const ratio = Math.max(this.replayBytes / this.replayByteLimit, this.replayUnits / this.replayUnitLimit);
    return ratio < 0.5 ? "low" : ratio < 0.85 ? "medium" : "high";
  }
  private report(diagnostic: SessionHubDiagnostic): void {
    if (this.reportingDiagnostic) return;
    this.reportingDiagnostic = true;
    try { this.diagnostic?.(diagnostic); } catch { /* diagnostics are fully isolated */ }
    finally { this.reportingDiagnostic = false; }
  }
  private reportReplay(outcome: ReplayOutcome): void {
    this.report({ kind: "replay", outcome, occupancy: this.occupancyClass() });
  }
  private isRepresentable(state: ProjectedSessionState, metrics: CanonicalStateMetrics): boolean {
    return isProjectedSessionStateWithSettlementRepresentable(state, metrics, this.stateLimits, this.encodedUnitByteLimit, this.streamEpoch);
  }

  private byteClass(bytes: number): "small" | "medium" | "large" | "oversized" {
    if (bytes > this.replayByteLimit) return "oversized";
    const ratio = bytes / this.replayByteLimit;
    return ratio < 0.01 ? "small" : ratio < 0.25 ? "medium" : "large";
  }
  private notify(units: readonly ProjectedSessionFrame[]): void {
    for (const listener of [...this.listeners]) {
      for (const unit of units) {
        try { listener(unit); } catch { this.report({ kind: "listener", outcome: "threw" }); break; }
      }
    }
  }
  private encodedGroup(sequence: number, units: ProjectedSessionFrame[]): ReplayGroup {
    return { sequence, units, bytes: units.reduce((sum, unit) => sum + utf8Bytes(encodeProjectedSessionFrame(unit)), 0) };
  }
  private removeFirstGroup(): void {
    const removed = this.replayGroups[this.replayHead];
    if (!removed) return;
    this.replayHead += 1;
    this.replayBytes -= removed.bytes;
    this.replayUnits -= removed.units.length;
    this.replayFloor = Math.max(this.replayFloor, removed.sequence);
    if (this.replayHead > 1024 && this.replayHead * 2 > this.replayGroups.length) {
      this.replayGroups = this.replayGroups.slice(this.replayHead);
      this.replayHead = 0;
    }
  }
  private clearReplay(): void {
    while (this.replayHead < this.replayGroups.length) this.removeFirstGroup();
    this.replayGroups = [];
    this.replayHead = 0;
  }
  private retain(group: ReplayGroup): boolean {
    if (group.bytes > this.replayByteLimit || group.units.length > this.replayUnitLimit) {
      this.clearReplay();
      this.replayFloor = Math.max(this.replayFloor, group.sequence);
      return false;
    }
    this.replayGroups.push(group);
    this.replayBytes += group.bytes;
    this.replayUnits += group.units.length;
    while (this.replayBytes > this.replayByteLimit || this.replayUnits > this.replayUnitLimit) this.removeFirstGroup();
    return true;
  }
  private planInput(input: SessionProjectionInput | { type: string; [key: string]: unknown }): PlannedInput {
    let projectionAccepted = true;
    const drafts = projectSessionInput(input, this.state, (diagnostic) => this.report(diagnostic), (accepted) => { projectionAccepted = accepted; });
    if (!projectionAccepted) return { outcome: "rejected", groups: [] };
    const isSettlement = drafts.length === 1 && drafts[0].type === "run_settled";
    const maximumDraftSequence = isSettlement ? Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER - 2;
    // Every non-final publication must leave two logical positions for the
    // mandatory settled frame and its event-driven final snapshot. Check before
    // addition so unsafe integer rounding can never create a duplicate cursor.
    if (isSettlement && this.sequence > Number.MAX_SAFE_INTEGER - 2) {
      this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
      return { outcome: "rejected", groups: [] };
    }
    let nextState = this.state;
    let nextSequence = this.sequence;
    const planned: PlannedGroup[] = [];
    for (const draft of drafts) {
      if (nextSequence >= maximumDraftSequence) {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        return { outcome: "rejected", groups: [] };
      }
      const candidateSequence = nextSequence + 1;
      const candidate = makeLogicalFrame(this.streamEpoch, candidateSequence, draft);
      const parsed = parseProjectedSessionFrame(candidate);
      if (!parsed.ok || parsed.frame.type === "snapshot_start" || parsed.frame.type === "snapshot_chunk" || parsed.frame.type === "snapshot_end") {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        return { outcome: "rejected", groups: [] };
      }
      const frame = freezeCanonicalData(parsed.frame);
      nextSequence = candidateSequence;
      if (!canReduceProjectedSessionFrame(nextState, frame)) {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        return { outcome: "rejected", groups: [] };
      }
      const previousState = nextState;
      nextState = freezeProjectedSessionTransition(reduceProjectedSessionFrame(nextState, frame).state);
      const metricsAfter = measureProjectedSessionTransition(previousState, nextState, frame);
      if (!this.isRepresentable(nextState, metricsAfter)) {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        return { outcome: "rejected", groups: [] };
      }
      planned.push({ ...this.encodedGroup(nextSequence, [frame]), stateAfter: nextState, metricsAfter, finality: "ordinary" });
    }
    if (isSettlement) {
      if (nextSequence >= Number.MAX_SAFE_INTEGER) {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        return { outcome: "rejected", groups: [] };
      }
      nextSequence += 1;
      const units = createSnapshotTransfer(this.streamEpoch, nextSequence, "final", nextState, this.encodedUnitByteLimit, randomUUID(), this.stateLimits);
      planned.push({ ...this.encodedGroup(nextSequence, units), stateAfter: nextState, metricsAfter: measureProjectedSessionState(nextState), finality: "final_snapshot" });
    }
    return { outcome: "committed", groups: planned };
  }
  private publishPlanned(groups: readonly PlannedGroup[]): void {
    for (const group of groups) {
      this.sequence = group.sequence;
      this.state = group.stateAfter;
      this.stateMetrics = group.metricsAfter;
      const retained = this.retain(group);
      this.report({
        kind: "frame",
        frameType: group.units[0].type,
        byteClass: this.byteClass(group.bytes),
        replayClass: retained ? "retained" : "not_retained",
        finality: group.finality,
      });
      this.notify(group.units);
    }
  }
  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeRequested = false;
    for (let index = this.acceptedInputHead; index < this.acceptedInputs.length; index += 1) {
      this.acceptedInputs[index].resolve("rejected");
    }
    this.acceptedInputs = [];
    this.acceptedInputHead = 0;
    this.listeners.clear();
    this.report({ kind: "listener", outcome: "closed" });
  }
  private processAcceptedInputs(): void {
    while (this.acceptedInputHead < this.acceptedInputs.length && !this.closed) {
      const entry = this.acceptedInputs[this.acceptedInputHead++];
      let planned: PlannedInput;
      try { planned = this.planInput(entry.input); }
      catch {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        planned = { outcome: "rejected", groups: [] };
      }
      // Projection, planning, and every precommit diagnostic complete before
      // this point. A close requested anywhere in that phase rejects the
      // current logical input atomically; publication is the commit point.
      if (this.closeRequested) {
        entry.resolve("rejected");
        this.finishClose();
        break;
      }
      if (planned.outcome === "committed") this.publishPlanned(planned.groups);
      // Once publication begins, every group of this logical input is emitted
      // before honoring a listener/frame-diagnostic close request.
      entry.resolve(planned.outcome);
      if (this.closeRequested) this.finishClose();
    }
    if (this.closeRequested && !this.closed) this.finishClose();
  }
  private compactAcceptedInputs(): void {
    if (this.acceptedInputHead >= this.acceptedInputs.length) {
      this.acceptedInputs = [];
      this.acceptedInputHead = 0;
    }
  }
  private drainAcceptedInputs(): void {
    if (this.processing || this.closed) return;
    this.processing = true;
    try { this.processAcceptedInputs(); }
    finally {
      this.compactAcceptedInputs();
      this.processing = false;
    }
  }

  /** Capture hostile native input once, before lifecycle and projection use it. */
  prepareNativeInput(input: SessionProjectionInput | { type: string; [key: string]: unknown }): PreparedSessionProjectionInput | null {
    if (this.closed || this.closeRequested) return null;
    try {
      const captured = captureSessionProjectionInput(input, this.stateLimits.canonicalNodeLimit, this.stateLimits.canonicalDepthLimit);
      if (!captured) {
        this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
        return null;
      }
      const classifiedLifecycle = classifyAcceptedNativeLifecycleInput(captured);
      const prepared = Object.freeze({ lifecycle: classifiedLifecycle ? Object.freeze(classifiedLifecycle) : null });
      this.preparedInputs.set(prepared, freezeCanonicalData(captured));
      return prepared;
    } catch {
      this.report({ kind: "input", outcome: "malformed", inputClass: "unknown" });
      return null;
    }
  }

  private createCommitReceipt(): {
    receipt: ProjectedInputCommitReceipt;
    resolve: (outcome: ProjectedInputCommitOutcome) => void;
  } {
    let outcome: ProjectedInputCommitOutcome | null = null;
    let callback: ((resolved: ProjectedInputCommitOutcome) => void) | null = null;
    const receipt = Object.freeze({
      whenResolved(next: (resolved: ProjectedInputCommitOutcome) => void): void {
        if (callback) throw new Error("projected_input_commit_receipt_already_observed");
        callback = next;
        if (outcome) {
          try { callback(outcome); } catch { /* internal receipt observers are isolated */ }
        }
      },
    });
    return {
      receipt,
      resolve(resolved) {
        if (outcome) return;
        outcome = resolved;
        try { callback?.(resolved); } catch { /* internal receipt observers are isolated */ }
      },
    };
  }

  /** Enqueue exactly one wrapper-prepared canonical input and expose only its commit outcome. */
  acceptPreparedNativeInput(input: PreparedSessionProjectionInput): ProjectedInputCommitReceipt | null {
    if (this.closed || this.closeRequested || !input || typeof input !== "object") return null;
    const captured = this.preparedInputs.get(input as object);
    if (!captured) return null;
    this.preparedInputs.delete(input as object);
    const pending = this.createCommitReceipt();
    this.acceptedInputs.push({ input: captured, resolve: pending.resolve });
    this.drainAcceptedInputs();
    return pending.receipt;
  }

  accept(input: SessionProjectionInput | { type: string; [key: string]: unknown }): void {
    const prepared = this.prepareNativeInput(input);
    if (prepared) this.acceptPreparedNativeInput(prepared);
  }

  snapshot(reason: "initial" | "recovery" = "initial"): SnapshotTransferFrame[] {
    if (!this.isRepresentable(this.state, this.stateMetrics)) throw new Error("canonical_projected_session_state_exceeds_limit");
    return createSnapshotTransfer(this.streamEpoch, this.sequence, reason, this.state, this.encodedUnitByteLimit, randomUUID(), this.stateLimits);
  }

  private selectReplay(streamEpoch: string | null, cursor: number | null): ReplayResult {
    if (this.closed) return { outcome: "closed", units: [], cursor: this.sequence, streamEpoch: this.streamEpoch };
    if (streamEpoch === null || cursor === null) return { outcome: "initial_snapshot", units: this.snapshot("initial"), cursor: this.sequence, streamEpoch: this.streamEpoch };
    if (streamEpoch !== this.streamEpoch) return { outcome: "wrong_epoch", units: this.snapshot("recovery"), cursor: this.sequence, streamEpoch: this.streamEpoch };
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.sequence) return { outcome: "invalid_cursor", units: this.snapshot("recovery"), cursor: this.sequence, streamEpoch: this.streamEpoch };
    if (cursor < this.replayFloor) return { outcome: "overflow_snapshot", units: this.snapshot("recovery"), cursor: this.sequence, streamEpoch: this.streamEpoch };
    if (cursor === this.sequence) return { outcome: "empty", units: [], cursor: this.sequence, streamEpoch: this.streamEpoch };
    const suffix: ReplayGroup[] = [];
    let lastContiguousSequence = cursor;
    for (let index = this.replayHead; index < this.replayGroups.length; index += 1) {
      const group = this.replayGroups[index];
      if (group.sequence <= cursor) continue;
      if (lastContiguousSequence >= Number.MAX_SAFE_INTEGER || group.sequence !== lastContiguousSequence + 1) {
        return { outcome: "overflow_snapshot", units: this.snapshot("recovery"), cursor: this.sequence, streamEpoch: this.streamEpoch };
      }
      suffix.push(group);
      lastContiguousSequence = group.sequence;
    }
    if (lastContiguousSequence !== this.sequence) return { outcome: "overflow_snapshot", units: this.snapshot("recovery"), cursor: this.sequence, streamEpoch: this.streamEpoch };
    return { outcome: "exact", units: suffix.flatMap((group) => group.units), cursor: this.sequence, streamEpoch: this.streamEpoch };
  }

  replayAfter(streamEpoch: string | null, cursor: number | null): ReplayResult {
    const alreadyProcessing = this.processing;
    if (!alreadyProcessing) this.processing = true;
    try {
      const selected = this.selectReplay(streamEpoch, cursor);
      this.reportReplay(selected.outcome);
      // Reentrant diagnostic publication is serialized after selection. It may
      // advance the hub, but cannot alter or interrupt the selected transaction.
      if (!alreadyProcessing) this.processAcceptedInputs();
      return selected;
    } finally {
      if (!alreadyProcessing) {
        this.compactAcceptedInputs();
        this.processing = false;
      }
    }
  }

  /** Synchronous selection and listener registration form one attach operation. */
  attach(streamEpoch: string | null, cursor: number | null, listener: HubListener): ReplayResult & { unsubscribe: () => void } {
    const buffered: ProjectedSessionFrame[] = [];
    const bufferListener: HubListener = (unit) => { buffered.push(unit); };
    const alreadyProcessing = this.processing;
    if (!alreadyProcessing) this.processing = true;
    if (!this.closed) this.listeners.add(bufferListener);
    let selected: ReplayResult;
    try {
      selected = this.selectReplay(streamEpoch, cursor);
      this.reportReplay(selected.outcome);
      if (!alreadyProcessing) this.processAcceptedInputs();
    } finally {
      if (!alreadyProcessing) {
        this.compactAcceptedInputs();
        this.processing = false;
      }
    }
    this.listeners.delete(bufferListener);
    if (!this.closed) this.listeners.add(listener);
    const catchUp = buffered.length === 0 ? selected : { ...selected, units: [...selected.units, ...buffered], cursor: this.sequence };
    let removed = false;
    return {
      ...catchUp,
      unsubscribe: () => {
        if (removed) return;
        removed = true;
        this.listeners.delete(listener);
      },
    };
  }

  close(): boolean {
    if (this.closed || this.closeRequested) return false;
    if (this.processing) {
      this.closeRequested = true;
      return true;
    }
    this.finishClose();
    return true;
  }
}

function createProjectedSessionHubReader(hub: ProjectedSessionEventHub): ProjectedSessionHubReader {
  return Object.freeze({
    get streamEpoch() { return hub.streamEpoch; },
    get cursor() { return hub.cursor; },
    get floor() { return hub.floor; },
    getState: () => hub.getState(),
    getReplayOccupancy: () => hub.getReplayOccupancy(),
    isClosed: () => hub.isClosed(),
    snapshot: (reason?: "initial" | "recovery") => hub.snapshot(reason),
    replayAfter: (streamEpoch: string | null, cursor: number | null) => hub.replayAfter(streamEpoch, cursor),
    attach: (streamEpoch: string | null, cursor: number | null, listener: HubListener) => hub.attach(streamEpoch, cursor, listener),
  });
}

export function installProjectedSessionHubCapability(
  owner: object,
  options: SessionHubOptions = {},
): ProjectedSessionEventHub {
  const record = (owner as Record<PropertyKey, unknown>)[PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL];
  if (record !== undefined) {
    const compatible = getProjectedSessionHubCapability(owner);
    if (!compatible) throw new Error("projected_session_hub_capability_incompatible");
    const internal = installedHubInternals.get(owner);
    if (!internal) throw new Error("projected_session_hub_already_installed");
    return internal;
  }
  const hub = new ProjectedSessionEventHub(options);
  installedHubInternals.set(owner, hub);
  const capability: ProjectedSessionHubCapability = {
    protocol: "pi-web-projected-session-hub",
    version: 1,
    owner: HUB_OWNER,
    hub: createProjectedSessionHubReader(hub),
  };
  Object.defineProperty(owner, PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL, {
    value: capability,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return hub;
}

export function getProjectedSessionHubCapability(owner: object): ProjectedSessionHubCapability | null {
  const value = (owner as Record<PropertyKey, unknown>)[PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL];
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ProjectedSessionHubCapability>;
  const hub = record.hub as Partial<ProjectedSessionHubReader> | undefined;
  // Structural compatibility is deliberate: the record and wrapper survive
  // hot reload while this module's class identity may not.
  if (
    record.protocol !== "pi-web-projected-session-hub"
    || record.version !== 1
    || record.owner !== HUB_OWNER
    || !hub
    || typeof hub.attach !== "function"
    || typeof hub.replayAfter !== "function"
    || typeof hub.snapshot !== "function"
    || typeof hub.getState !== "function"
    || typeof hub.getReplayOccupancy !== "function"
    || typeof hub.isClosed !== "function"
  ) return null;
  return record as ProjectedSessionHubCapability;
}

export function getProjectedSessionHub(owner: object): ProjectedSessionHubReader | null {
  return getProjectedSessionHubCapability(owner)?.hub ?? null;
}
