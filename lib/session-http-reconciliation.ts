import type { SessionClientSnapshot } from "./session-transport-client";

export type SessionHttpResource = "transcript" | "context" | "runtime";

export type SessionHttpObservation = Readonly<{
  sessionId: string;
  viewGeneration: number;
  transport: SessionClientSnapshot;
  selectedLeafId: string | null;
  leafGeneration: number;
  promptUiGeneration: number;
  promptRunGeneration: number;
  promptLineage: number | null;
}>;

export type SessionHttpRequestToken = Readonly<{
  resource: SessionHttpResource;
  request: number;
  sessionId: string;
  viewGeneration: number;
  transport: SessionClientSnapshot;
  streamEpoch: string | null;
  cursor: number;
  revision: number;
  transcriptRevision: number;
  selectedLeafId: string | null;
  leafGeneration: number;
  promptUiGeneration: number;
  promptRunGeneration: number;
  promptLineage: number | null;
}>;

export type SessionHttpDecision =
  | "accepted"
  | "superseded"
  | "stale_view"
  | "stale_cursor"
  | "stale_leaf"
  | "stale_ui"
  | "stale_run";

type ObservationTuple = Readonly<{
  sessionId: string;
  viewGeneration: number;
  streamEpoch: string | null;
  cursor: number;
  revision: number;
  transcriptRevision: number;
  selectedLeafId: string | null;
  leafGeneration: number;
  promptUiGeneration: number;
  promptRunGeneration: number;
  promptLineage: number | null;
}>;

type FailureTuple = ObservationTuple & Readonly<{ attempts: number }>;

type ResourceState = {
  nextRequest: number;
  newestRequest: number;
  inFlight: boolean;
  dirty: boolean;
  scheduled: boolean;
  lastApplied: ObservationTuple | null;
  failure: FailureTuple | null;
};

function createResourceState(): ResourceState {
  return { nextRequest: 1, newestRequest: 0, inFlight: false, dirty: false, scheduled: false, lastApplied: null, failure: null };
}

function observationTuple(observation: SessionHttpObservation): ObservationTuple {
  const transport = observation.transport;
  return Object.freeze({
    sessionId: observation.sessionId,
    viewGeneration: observation.viewGeneration,
    streamEpoch: transport.streamEpoch,
    cursor: transport.cursor,
    revision: transport.revision,
    transcriptRevision: transport.state.transcriptRevision,
    selectedLeafId: observation.selectedLeafId,
    leafGeneration: observation.leafGeneration,
    promptUiGeneration: observation.promptUiGeneration,
    promptRunGeneration: observation.promptRunGeneration,
    promptLineage: observation.promptLineage,
  });
}

function sameObservationTuple(a: ObservationTuple | null, b: ObservationTuple): boolean {
  return !!a
    && a.sessionId === b.sessionId
    && a.viewGeneration === b.viewGeneration
    && a.streamEpoch === b.streamEpoch
    && a.cursor === b.cursor
    && a.revision === b.revision
    && a.transcriptRevision === b.transcriptRevision
    && a.selectedLeafId === b.selectedLeafId
    && a.leafGeneration === b.leafGeneration
    && a.promptUiGeneration === b.promptUiGeneration
    && a.promptRunGeneration === b.promptRunGeneration
    && a.promptLineage === b.promptLineage;
}

/**
 * Pure request-token/coalescing coordinator. It never clears server sticky
 * markers; lastApplied only records which observed marker/cursor tuple was
 * successfully repaired.
 */
export class SessionHttpReconciliation {
  private readonly resources: Record<SessionHttpResource, ResourceState> = {
    transcript: createResourceState(),
    context: createResourceState(),
    runtime: createResourceState(),
  };

  begin(resource: SessionHttpResource, observation: SessionHttpObservation): SessionHttpRequestToken {
    const state = this.resources[resource];
    const request = state.nextRequest++;
    state.newestRequest = request;
    state.inFlight = true;
    state.scheduled = false;
    const transport = observation.transport;
    return Object.freeze({
      resource,
      request,
      sessionId: observation.sessionId,
      viewGeneration: observation.viewGeneration,
      transport,
      streamEpoch: transport.streamEpoch,
      cursor: transport.cursor,
      revision: transport.revision,
      transcriptRevision: transport.state.transcriptRevision,
      selectedLeafId: observation.selectedLeafId,
      leafGeneration: observation.leafGeneration,
      promptUiGeneration: observation.promptUiGeneration,
      promptRunGeneration: observation.promptRunGeneration,
      promptLineage: observation.promptLineage,
    });
  }

  decide(token: SessionHttpRequestToken, current: SessionHttpObservation): SessionHttpDecision {
    const state = this.resources[token.resource];
    if (token.request !== state.newestRequest) return "superseded";
    if (current.sessionId !== token.sessionId || current.viewGeneration !== token.viewGeneration) return "stale_view";
    if (current.selectedLeafId !== token.selectedLeafId
      || current.leafGeneration !== token.leafGeneration) return "stale_leaf";
    if ((token.resource === "transcript" || token.resource === "context")
      && current.promptUiGeneration !== token.promptUiGeneration) return "stale_ui";
    if (token.resource === "runtime"
      && (current.promptRunGeneration !== token.promptRunGeneration
        || current.promptLineage !== token.promptLineage)) return "stale_run";
    const transport = current.transport;
    if (transport !== token.transport
      || transport.streamEpoch !== token.streamEpoch
      || transport.cursor !== token.cursor
      || transport.revision !== token.revision
      || transport.state.transcriptRevision !== token.transcriptRevision) return "stale_cursor";
    return "accepted";
  }

  finish(token: SessionHttpRequestToken, current: SessionHttpObservation, applied: boolean): SessionHttpDecision {
    const decision = this.decide(token, current);
    const state = this.resources[token.resource];
    if (token.request === state.newestRequest) {
      state.inFlight = false;
      if (applied && decision === "accepted") {
        const appliedTuple = observationTuple(current);
        state.lastApplied = appliedTuple;
        state.failure = null;
        state.dirty = false;
        if (token.resource === "context") {
          this.resources.transcript.lastApplied = appliedTuple;
          this.resources.transcript.failure = null;
          this.resources.transcript.dirty = false;
        }
      } else {
        state.dirty = true;
      }
    }
    return decision;
  }

  markDirty(resource: SessionHttpResource): void { this.resources[resource].dirty = true; }

  needsRepair(resource: SessionHttpResource, observation: SessionHttpObservation): boolean {
    const state = this.resources[resource];
    if (state.dirty) return true;
    const transport = observation.transport;
    const sticky = resource === "runtime"
      ? transport.state.runtimeRefreshRequired
      : transport.state.transcriptRefreshRequired;
    if (!sticky) return false;
    return !sameObservationTuple(state.lastApplied, observationTuple(observation));
  }

  requestSchedule(resource: SessionHttpResource): boolean {
    const state = this.resources[resource];
    state.dirty = true;
    if (state.inFlight || state.scheduled) return false;
    state.scheduled = true;
    return true;
  }

  cancelSchedule(resource: SessionHttpResource): void { this.resources[resource].scheduled = false; }

  /**
   * Exponentially back off an unchanged complete observation tuple, then keep
   * one saturated slow retry eligible until selected quiescence succeeds.
   * Tuple changes reset the short backoff; callers coalesce one in-flight
   * request and one timer per resource.
   */
  consumeFailureRetryDelay(resource: SessionHttpResource, observation: SessionHttpObservation): number {
    const state = this.resources[resource];
    const tuple = observationTuple(observation);
    const previous = state.failure;
    const attempts = sameObservationTuple(previous, tuple) ? previous!.attempts : 0;
    const nextAttempts = Math.min(attempts + 1, 4);
    state.failure = Object.freeze({ ...tuple, attempts: nextAttempts });
    return attempts === 0 ? 250 : attempts === 1 ? 750 : attempts === 2 ? 2_000 : 15_000;
  }

  isInFlight(resource: SessionHttpResource): boolean { return this.resources[resource].inFlight; }
}
