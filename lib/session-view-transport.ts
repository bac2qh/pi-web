import {
  type SessionRegistryController,
  type SessionRegistryHandle,
} from "./session-registry";
import { createInitialProjectedSessionState } from "./session-protocol";
import {
  type SessionClientSnapshot,
  type SessionEffectDelivery,
} from "./session-transport-client";

export const DEFAULT_SESSION_VIEW_ATTACH_TIMEOUT_MS = 5_000;
const DEFAULT_SETTLEMENT_INITIAL_DELAY_MS = 800;
const DEFAULT_SETTLEMENT_POLL_MS = 600;
const DEFAULT_SETTLEMENT_MAX_MS = 20_000;
const DEFAULT_SETTLEMENT_LONG_POLL_MS = 15_000;
const MAX_RETAINED_PROMPT_LINEAGES = 8;

export type SessionViewSnapshot = Readonly<{
  generation: number;
  transport: SessionClientSnapshot;
  /** True exactly when the accepted client has a committed receiver. */
  canonicalCommitted: boolean;
  localPromptPending: boolean;
}>;

export type SessionPromptSettlementProbe = () => Promise<boolean>;
export type SessionViewPromptClassification = "prompt" | "slash_command";
export type SessionViewPromptFailureOutcome = "rolled_back" | "covered";

export interface SessionViewPromptClaim {
  readonly lineage: number;
  accepted(settlementProbe?: SessionPromptSettlementProbe): void;
  failed(): SessionViewPromptFailureOutcome;
  settled(): void;
}

export interface SessionViewBinding {
  getSnapshot(): SessionViewSnapshot;
  getPromptLineage(): number | null;
  getPromptClassification(): SessionViewPromptClassification | null;
  subscribe(listener: (snapshot: SessionViewSnapshot) => void): () => void;
  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void;
  subscribeCompletions(listener: (lineage: number) => void): () => void;
  waitUntilAttached(timeoutMs?: number): Promise<void>;
  beginPromptClaim(classification?: SessionViewPromptClassification): SessionViewPromptClaim;
  settlePromptLineage(lineage: number): void;
}

export type SessionViewPromptStart = Readonly<{
  binding: SessionViewBinding;
  claim: SessionViewPromptClaim;
}>;

export interface SessionViewTransportController {
  select(sessionId: string | null): SessionViewBinding | null;
  /** Prepare B without changing A; activate only after B's consumers exist. */
  prepareSelection(sessionId: string): SessionViewBinding;
  activate(binding: SessionViewBinding, ownership: "visible" | "retained_hidden"): void;
  /** Atomically acquire a not-yet-adopted hidden ID and retain it with its claim. */
  beginPrompt(sessionId: string, visible?: boolean, classification?: SessionViewPromptClassification): SessionViewPromptStart;
  dispose(): void;
}

type PromptLineage = {
  lineage: number;
  claim: PromptClaim;
  classification: SessionViewPromptClassification;
  accepted: boolean;
  continuityClosed: boolean;
  activityObserved: boolean;
  failed: boolean;
  settled: boolean;
  completion: "unsettled" | "pending_visible" | "notified" | "suppressed";
  probe: SessionPromptSettlementProbe | null;
  monitorTimer: ReturnType<typeof setTimeout> | null;
  monitorStartedAt: number | null;
};

type EntryAcquisition = {
  ownership: "visible" | "retained_hidden";
};

type Entry = {
  id: string;
  generation: number;
  handle: SessionRegistryHandle | null;
  acquisition: EntryAcquisition | null;
  binding: ViewBinding;
  snapshot: SessionViewSnapshot;
  selected: boolean;
  pendingVisible: boolean;
  released: boolean;
  promptLineages: Map<number, PromptLineage>;
  snapshotListeners: Set<(snapshot: SessionViewSnapshot) => void>;
  effectListeners: Set<(delivery: SessionEffectDelivery) => void>;
  completionListeners: Set<(lineage: number) => void>;
  releaseToken: object | null;
};

function viewSnapshot(generation: number, transport: SessionClientSnapshot, localPromptPending: boolean): SessionViewSnapshot {
  return Object.freeze({
    generation,
    transport,
    canonicalCommitted: transport.streamEpoch !== null,
    localPromptPending,
  });
}

function isAttached(snapshot: SessionViewSnapshot): boolean {
  return snapshot.transport.connectionState === "recovering" || snapshot.transport.connectionState === "connected";
}

function attachmentFailure(snapshot: SessionViewSnapshot): "terminal" | null {
  return snapshot.transport.connectionState === "terminal" ? "terminal" : null;
}

export class SessionViewAttachmentError extends Error {
  constructor(public readonly reason: "timeout" | "terminal" | "released" | "stale") {
    super(reason === "timeout"
      ? "Timed out connecting to the agent session stream. Please try again."
      : "Failed to connect to the agent session stream. Please try again.");
    this.name = "SessionViewAttachmentError";
  }
}

class PromptClaim implements SessionViewPromptClaim {
  constructor(
    private readonly controller: SessionViewTransport,
    readonly entry: Entry,
    readonly lineage: number,
  ) {}

  accepted(settlementProbe?: SessionPromptSettlementProbe): void {
    this.controller.acceptPrompt(this.entry, this.lineage, settlementProbe);
  }

  failed(): SessionViewPromptFailureOutcome { return this.controller.failPrompt(this.entry, this.lineage); }
  settled(): void { this.controller.settlePrompt(this.entry, this.lineage); }
}

class ViewBinding implements SessionViewBinding {
  constructor(private readonly controller: SessionViewTransport, readonly entry: Entry) {}

  getSnapshot(): SessionViewSnapshot { return this.entry.snapshot; }
  getPromptLineage(): number | null { return this.controller.getPromptLineage(this.entry); }
  getPromptClassification(): SessionViewPromptClassification | null {
    return this.controller.getPromptClassification(this.entry);
  }

  subscribe(listener: (snapshot: SessionViewSnapshot) => void): () => void {
    if (this.entry.released) return () => {};
    this.entry.snapshotListeners.add(listener);
    try { listener(this.entry.snapshot); } catch { /* listener isolation */ }
    return () => { this.entry.snapshotListeners.delete(listener); };
  }

  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void {
    if (this.entry.released) return () => {};
    this.entry.effectListeners.add(listener);
    return () => { this.entry.effectListeners.delete(listener); };
  }

  subscribeCompletions(listener: (lineage: number) => void): () => void {
    if (this.entry.released) return () => {};
    this.entry.completionListeners.add(listener);
    this.controller.flushCompletion(this.entry);
    return () => { this.entry.completionListeners.delete(listener); };
  }

  waitUntilAttached(timeoutMs = DEFAULT_SESSION_VIEW_ATTACH_TIMEOUT_MS): Promise<void> {
    const entry = this.entry;
    const generation = entry.generation;
    const current = entry.snapshot;
    if (entry.released) return Promise.reject(new SessionViewAttachmentError("released"));
    if (isAttached(current)) return Promise.resolve();
    if (attachmentFailure(current)) return Promise.reject(new SessionViewAttachmentError("terminal"));

    return new Promise((resolve, reject) => {
      let done = false;
      let unsubscribe = () => {};
      const finish = (error?: SessionViewAttachmentError) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new SessionViewAttachmentError("timeout")), Math.max(0, timeoutMs));
      unsubscribe = this.subscribe(() => {
        const latest = this.entry.snapshot;
        if (this.entry.released) return finish(new SessionViewAttachmentError("released"));
        if (latest.generation !== generation) return finish(new SessionViewAttachmentError("stale"));
        if (attachmentFailure(latest)) return finish(new SessionViewAttachmentError("terminal"));
        if (!isAttached(latest)) return;
        const reread = this.getSnapshot();
        if (reread.generation !== generation) return finish(new SessionViewAttachmentError("stale"));
        if (isAttached(reread)) finish();
      });
    });
  }

  beginPromptClaim(classification: SessionViewPromptClassification = "prompt"): SessionViewPromptClaim {
    return this.controller.beginPromptForEntry(this.entry, classification);
  }

  settlePromptLineage(lineage: number): void {
    this.controller.settlePrompt(this.entry, lineage);
  }
}

export class SessionViewTransport implements SessionViewTransportController {
  private readonly entries = new Map<string, Entry>();
  private selectedId: string | null = null;
  private nextGeneration = 1;
  private nextPromptLineage = 1;
  private pendingVisibleEntry: Entry | null = null;
  private disposed = false;

  constructor(
    private readonly registry: SessionRegistryController,
    private readonly settlementTiming: Readonly<{
      initialDelayMs?: number;
      pollMs?: number;
      maximumMs?: number;
      longPollMs?: number;
    }> = {},
  ) {}

  select(sessionId: string | null): SessionViewBinding | null {
    if (this.disposed) throw new Error("session_view_transport_disposed");
    if (sessionId === null) {
      this.cancelPendingVisible(null);
      this.commitSelected(null);
      return null;
    }
    const entry = this.ensurePreparedEntry(sessionId);
    this.cancelPendingVisible(entry);
    entry.pendingVisible = true;
    this.pendingVisibleEntry = entry;
    this.activateEntry(entry, "visible");
    return entry.binding;
  }

  prepareSelection(sessionId: string): SessionViewBinding {
    if (this.disposed) throw new Error("session_view_transport_disposed");
    const entry = this.ensurePreparedEntry(sessionId);
    this.cancelPendingVisible(entry);
    entry.pendingVisible = true;
    this.pendingVisibleEntry = entry;
    return entry.binding;
  }

  activate(binding: SessionViewBinding, ownership: "visible" | "retained_hidden"): void {
    if (this.disposed) throw new Error("session_view_transport_disposed");
    if (!(binding instanceof ViewBinding) || binding.entry.binding !== binding || !this.isCurrent(binding.entry)) {
      throw new SessionViewAttachmentError("stale");
    }
    const entry = binding.entry;
    if (ownership === "visible" && this.pendingVisibleEntry !== entry && !entry.selected) {
      throw new SessionViewAttachmentError("stale");
    }
    this.activateEntry(entry, ownership);
  }

  beginPrompt(
    sessionId: string,
    visible = false,
    classification: SessionViewPromptClassification = "prompt",
  ): SessionViewPromptStart {
    if (this.disposed) throw new Error("session_view_transport_disposed");
    if (visible) {
      const binding = this.prepareSelection(sessionId);
      const entry = (binding as ViewBinding).entry;
      const claim = this.beginPromptForEntry(entry, classification);
      return Object.freeze({ binding, claim });
    }
    // A stale materialization has no visible consumer. Its claim is installed
    // before retained acquisition, and hidden transient effects are discarded.
    const entry = this.ensurePreparedEntry(sessionId);
    const claim = this.beginPromptForEntry(entry, classification);
    this.activateEntry(entry, "retained_hidden");
    return Object.freeze({ binding: entry.binding, claim });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.selectedId = null;
    for (const entry of [...this.entries.values()]) this.releaseEntry(entry);
  }

  beginPromptForEntry(
    entry: Entry,
    classification: SessionViewPromptClassification = "prompt",
  ): SessionViewPromptClaim {
    if (!this.isCurrent(entry)) throw new SessionViewAttachmentError("released");
    const lineage = this.nextPromptLineage++;
    const claim = new PromptClaim(this, entry, lineage);
    entry.promptLineages.set(lineage, {
      lineage,
      claim,
      classification,
      accepted: false,
      continuityClosed: false,
      activityObserved: false,
      failed: false,
      settled: false,
      completion: "unsettled",
      probe: null,
      monitorTimer: null,
      monitorStartedAt: null,
    });
    this.pruneLineages(entry);
    this.publishClaimChange(entry);
    return claim;
  }

  getPromptLineage(entry: Entry): number | null {
    return this.getCurrentPromptRecord(entry)?.lineage ?? null;
  }

  getPromptClassification(entry: Entry): SessionViewPromptClassification | null {
    return this.getCurrentPromptRecord(entry)?.classification ?? null;
  }

  acceptPrompt(entry: Entry, lineage: number, settlementProbe?: SessionPromptSettlementProbe): void {
    const record = this.getLineage(entry, lineage);
    if (!record || record.failed || record.settled) return;
    record.accepted = true;
    if (settlementProbe) record.probe = settlementProbe;
    if (!entry.selected) this.startSettlementMonitor(entry, record);
  }

  failPrompt(entry: Entry, lineage: number): SessionViewPromptFailureOutcome {
    const record = this.getLineage(entry, lineage);
    if (!record) return "rolled_back";
    if (record.activityObserved || record.settled || record.completion !== "unsettled") return "covered";
    if (record.failed) return "rolled_back";
    record.failed = true;
    record.continuityClosed = true;
    record.completion = "suppressed";
    this.clearMonitor(record);
    this.publishClaimChange(entry);
    this.considerRelease(entry);
    return "rolled_back";
  }

  settlePrompt(entry: Entry, lineage: number): void {
    const record = this.getLineage(entry, lineage);
    if (!record || record.failed || record.settled) return;
    // An idle HTTP observation cannot prove that an unaccepted POST executed.
    // Accepted HTTP or ordered canonical activity must first cover this exact
    // page lineage; active→inactive remains a valid fast pre-response proof.
    if (!record.accepted && !record.activityObserved) return;
    record.settled = true;
    record.continuityClosed = true;
    this.clearMonitor(record);
    record.completion = entry.selected && entry.completionListeners.size > 0
      ? "pending_visible"
      : "suppressed";
    this.publishClaimChange(entry);
    this.flushCompletion(entry);
    this.considerRelease(entry);
  }

  flushCompletion(entry: Entry): void {
    if (!this.isCurrent(entry) || !entry.selected || entry.completionListeners.size === 0) return;
    const listener = entry.completionListeners.values().next().value as ((lineage: number) => void) | undefined;
    if (!listener) return;
    const record = [...entry.promptLineages.values()]
      .find((candidate) => candidate.completion === "pending_visible");
    if (!record) return;
    // Claim the page-lineage decision before invoking user code. Throws and
    // reentrancy cannot produce a second completion.
    record.completion = "notified";
    try { listener(record.lineage); } catch { /* completion listener isolation */ }
  }

  publishClaimChange(entry: Entry): void {
    if (!this.isCurrent(entry)) return;
    this.publish(entry, entry.snapshot.transport);
  }

  considerRelease(entry: Entry): void {
    if (!this.isCurrent(entry) || entry.selected || this.shouldRetain(entry)) return;
    this.deferRelease(entry);
  }

  private ensurePreparedEntry(sessionId: string): Entry {
    const existing = this.entries.get(sessionId);
    if (existing && !existing.released) return existing;

    const generation = this.nextGeneration++;
    const placeholder = Object.freeze({
      connectionState: "idle" as const,
      serverInstanceId: null,
      streamEpoch: null,
      cursor: 0,
      state: createInitialProjectedSessionState(),
      readyOutcome: null,
      errorClass: null,
      revision: 0,
    });
    const entry = {} as Entry;
    Object.assign(entry, {
      id: sessionId,
      generation,
      handle: null,
      acquisition: null,
      binding: null,
      snapshot: viewSnapshot(generation, placeholder, false),
      selected: false,
      pendingVisible: false,
      released: false,
      promptLineages: new Map<number, PromptLineage>(),
      snapshotListeners: new Set<(snapshot: SessionViewSnapshot) => void>(),
      effectListeners: new Set<(delivery: SessionEffectDelivery) => void>(),
      completionListeners: new Set<(lineage: number) => void>(),
      releaseToken: null,
    });
    entry.binding = new ViewBinding(this, entry);
    this.entries.set(sessionId, entry);
    return entry;
  }

  private activateEntry(entry: Entry, ownership: "visible" | "retained_hidden"): void {
    if (!this.isCurrent(entry)) throw new SessionViewAttachmentError("released");
    if (entry.handle) {
      entry.handle.updateOwnership(ownership);
      if (ownership === "visible") this.commitSelected(entry);
      return;
    }

    // Raw acquisition may synchronously publish snapshots/effects. A callback
    // that activates this exact binding must join the in-flight acquisition,
    // not acquire and overwrite a second registry handle. Visible intent wins
    // over retained intent; the outer frame commits that final intent only
    // after the single raw handle has returned and passed its currency check.
    if (entry.acquisition) {
      if (ownership === "visible") entry.acquisition.ownership = "visible";
      return;
    }

    const acquisition: EntryAcquisition = { ownership };
    entry.acquisition = acquisition;
    let acquired: SessionRegistryHandle | null = null;
    try {
      // Both raw relays are installed atomically before client subscribe/start.
      // After synchronous start returns, recheck the exact prepared entry: a
      // callback may have selected another ID/null and invalidated this owner.
      acquired = this.registry.acquire(entry.id, {
        ownership,
        onSnapshot: (snapshot) => this.acceptSnapshot(entry, snapshot),
        onEffect: (delivery) => this.relayEffect(entry, delivery),
      });
      const finalOwnership = acquisition.ownership;
      const stillIntended = this.isCurrent(entry)
        && entry.acquisition === acquisition
        && (finalOwnership !== "visible" || entry.selected || this.pendingVisibleEntry === entry);
      if (!stillIntended) throw new SessionViewAttachmentError("stale");
      entry.handle = acquired;
      acquired = null;
      entry.acquisition = null;
      if (finalOwnership !== ownership) entry.handle.updateOwnership(finalOwnership);
      if (finalOwnership === "visible") this.commitSelected(entry);
    } catch (error) {
      try { acquired?.release(); } catch { /* cleanup isolation */ }
      if (entry.acquisition === acquisition) entry.acquisition = null;
      this.releaseEntry(entry);
      throw error;
    }
  }

  private commitSelected(next: Entry | null): void {
    const previous = this.selectedId === null ? null : this.entries.get(this.selectedId) ?? null;
    this.selectedId = next?.id ?? null;
    if (this.pendingVisibleEntry === next) this.pendingVisibleEntry = null;
    if (next) {
      next.pendingVisible = false;
      next.selected = true;
      next.releaseToken = null;
      next.handle?.updateOwnership("visible");
    }
    if (previous && previous !== next) {
      previous.selected = false;
      this.suppressUndeliveredCompletion(previous);
      this.startHiddenMonitors(previous);
      if (this.shouldRetain(previous)) previous.handle?.updateOwnership("retained_hidden");
      else this.deferRelease(previous);
    }
    if (next) this.flushCompletion(next);
  }

  private cancelPendingVisible(next: Entry | null): void {
    const pending = this.pendingVisibleEntry;
    if (!pending || pending === next) return;
    this.pendingVisibleEntry = null;
    pending.pendingVisible = false;
    if (!pending.handle && pending.promptLineages.size === 0 && !pending.selected) this.releaseEntry(pending);
  }

  private acceptSnapshot(entry: Entry, transport: SessionClientSnapshot): void {
    if (!this.isCurrent(entry)) return;
    const wasActive = entry.snapshot.transport.state.active;
    this.publish(entry, transport);
    if (transport.state.active) {
      for (const record of entry.promptLineages.values()) {
        if (record.failed || record.settled) continue;
        record.activityObserved = true;
        record.continuityClosed = true;
      }
      this.publishClaimChange(entry);
    }
    if (wasActive && !transport.state.active) {
      const lineage = this.getPromptLineage(entry);
      if (lineage !== null) this.settlePrompt(entry, lineage);
    }
    if (!entry.selected) {
      this.startHiddenMonitors(entry);
      if (this.shouldRetain(entry)) entry.handle?.updateOwnership("retained_hidden");
      else this.deferRelease(entry);
    }
  }

  private publish(entry: Entry, transport: SessionClientSnapshot): void {
    const pending = [...entry.promptLineages.values()].some((record) => !record.continuityClosed && !record.failed && !record.settled);
    const canonicalCommitted = transport.streamEpoch !== null;
    if (entry.snapshot.transport === transport
      && entry.snapshot.localPromptPending === pending
      && entry.snapshot.canonicalCommitted === canonicalCommitted) return;
    entry.snapshot = viewSnapshot(entry.generation, transport, pending);
    for (const listener of [...entry.snapshotListeners]) {
      try { listener(entry.snapshot); } catch { /* listener isolation */ }
    }
  }

  private relayEffect(entry: Entry, delivery: SessionEffectDelivery): void {
    if (!this.isCurrent(entry)) return;
    for (const listener of [...entry.effectListeners]) {
      try { listener(delivery); } catch { /* listener isolation */ }
    }
  }

  private shouldRetain(entry: Entry): boolean {
    return entry.selected
      || [...entry.promptLineages.values()].some((record) => !record.continuityClosed && !record.failed && !record.settled)
      || entry.snapshot.transport.state.active === true;
  }

  private deferRelease(entry: Entry): void {
    if (!this.isCurrent(entry) || entry.releaseToken) return;
    const token = {};
    entry.releaseToken = token;
    queueMicrotask(() => {
      if (!this.isCurrent(entry) || entry.releaseToken !== token) return;
      entry.releaseToken = null;
      if (!this.shouldRetain(entry)) this.releaseEntry(entry);
    });
  }

  private suppressUndeliveredCompletion(entry: Entry): void {
    for (const record of entry.promptLineages.values()) {
      if (record.completion === "pending_visible") record.completion = "suppressed";
    }
  }

  private startHiddenMonitors(entry: Entry): void {
    for (const record of entry.promptLineages.values()) this.startSettlementMonitor(entry, record);
  }

  private startSettlementMonitor(entry: Entry, record: PromptLineage): void {
    if (!this.isCurrent(entry) || entry.selected || !record.accepted || record.failed || record.settled
      || !record.probe || record.monitorTimer !== null) return;
    if (record.monitorStartedAt === null) record.monitorStartedAt = Date.now();
    const initialDelay = this.settlementTiming.initialDelayMs ?? DEFAULT_SETTLEMENT_INITIAL_DELAY_MS;
    const poll = this.settlementTiming.pollMs ?? DEFAULT_SETTLEMENT_POLL_MS;
    const maximum = this.settlementTiming.maximumMs ?? DEFAULT_SETTLEMENT_MAX_MS;
    const longPoll = this.settlementTiming.longPollMs ?? DEFAULT_SETTLEMENT_LONG_POLL_MS;
    const elapsed = Date.now() - record.monitorStartedAt;
    // Keep one bounded timer for a long-running hidden accepted claim after
    // the fast settlement window. This avoids an idle leak without a tight
    // loop or growth in concurrent monitor resources.
    const delay = elapsed >= maximum ? longPoll : elapsed === 0 ? initialDelay : poll;
    record.monitorTimer = setTimeout(() => {
      record.monitorTimer = null;
      if (!this.isCurrent(entry) || entry.selected || record.failed || record.settled || !record.probe) return;
      const generation = entry.generation;
      const transport = entry.snapshot.transport;
      void Promise.resolve().then(record.probe).then(
        (idle) => {
          if (!idle || !this.isCurrent(entry) || entry.selected || entry.generation !== generation
            || entry.snapshot.transport !== transport) {
            this.startSettlementMonitor(entry, record);
            return;
          }
          this.settlePrompt(entry, record.lineage);
        },
        () => { this.startSettlementMonitor(entry, record); },
      );
    }, Math.max(0, delay));
  }

  private clearMonitor(record: PromptLineage): void {
    if (record.monitorTimer !== null) clearTimeout(record.monitorTimer);
    record.monitorTimer = null;
  }

  private getCurrentPromptRecord(entry: Entry): PromptLineage | null {
    if (!this.isCurrent(entry)) return null;
    let latest: PromptLineage | null = null;
    for (const record of entry.promptLineages.values()) {
      if (record.failed || record.settled) continue;
      if (!latest || record.lineage > latest.lineage) latest = record;
    }
    return latest;
  }

  private getLineage(entry: Entry, lineage: number): PromptLineage | null {
    if (!this.isCurrent(entry)) return null;
    return entry.promptLineages.get(lineage) ?? null;
  }

  private pruneLineages(entry: Entry): void {
    if (entry.promptLineages.size <= MAX_RETAINED_PROMPT_LINEAGES) return;
    for (const [lineage, record] of entry.promptLineages) {
      if (!record.failed && !record.settled) continue;
      this.clearMonitor(record);
      entry.promptLineages.delete(lineage);
      if (entry.promptLineages.size <= MAX_RETAINED_PROMPT_LINEAGES) break;
    }
  }

  private releaseEntry(entry: Entry): void {
    if (entry.released) return;
    entry.released = true;
    entry.pendingVisible = false;
    entry.acquisition = null;
    if (this.pendingVisibleEntry === entry) this.pendingVisibleEntry = null;
    entry.releaseToken = null;
    for (const record of entry.promptLineages.values()) this.clearMonitor(record);
    // Wake attachment waiters before listeners are cleared so release fails
    // immediately rather than waiting for the deadline.
    for (const listener of [...entry.snapshotListeners]) {
      try { listener(entry.snapshot); } catch { /* listener isolation */ }
    }
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    if (this.selectedId === entry.id) this.selectedId = null;
    try { entry.handle?.release(); } catch { /* cleanup isolation */ }
    entry.handle = null;
    entry.promptLineages.clear();
    entry.snapshotListeners.clear();
    entry.effectListeners.clear();
    entry.completionListeners.clear();
  }

  private isCurrent(entry: Entry): boolean {
    return !this.disposed && !entry.released && this.entries.get(entry.id) === entry;
  }
}
