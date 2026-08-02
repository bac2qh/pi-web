import {
  SessionTransportClient,
  isValidSessionTransportSessionId,
  type SessionClientController,
  type SessionClientSnapshot,
  type SessionEffectDelivery,
} from "./session-transport-client";

export type SessionOwnership = "visible" | "retained_hidden";
export type SessionAcquireOptions = Readonly<{
  ownership: SessionOwnership;
  onEffect?: (delivery: SessionEffectDelivery) => void;
}>;

export interface SessionRegistryHandle {
  getSnapshot(): SessionClientSnapshot;
  subscribe(listener: (snapshot: SessionClientSnapshot) => void): () => void;
  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void;
  updateOwnership(ownership: SessionOwnership): void;
  release(): void;
}

export interface SessionRegistryController {
  acquire(sessionId: string, options: SessionAcquireOptions): SessionRegistryHandle;
  dispose(): void;
}

export type SessionRegistryDiagnostic = Readonly<{
  outcome: "acquired" | "released" | "relabelled" | "disposed" | "listener_threw";
  entryCount: "zero" | "one" | "many";
  visibleCount: "zero" | "one" | "many";
  retainedHiddenCount: "zero" | "one" | "many";
  ownership?: SessionOwnership;
}>;

export type SessionRegistryOptions = Readonly<{
  createClient?: (sessionId: string) => SessionClientController;
  diagnostic?: (entry: SessionRegistryDiagnostic) => void;
}>;

type Entry = {
  generation: number;
  client: SessionClientController;
  snapshot: SessionClientSnapshot;
  handles: Set<RegistryHandle>;
  unsubscribeSnapshot: (() => void) | null;
  unsubscribeEffects: (() => void) | null;
  stopped: boolean;
  stopAttempted: boolean;
};

type RegistryNotification = Readonly<{
  entry: Entry;
  snapshot: SessionClientSnapshot | null;
  snapshotListeners: ((snapshot: SessionClientSnapshot) => void)[];
  effect: SessionEffectDelivery | null;
  effectListeners: ((delivery: SessionEffectDelivery) => void)[];
}>;

const countClass = (count: number): "zero" | "one" | "many" => count === 0 ? "zero" : count === 1 ? "one" : "many";
const validOwnership = (value: unknown): value is SessionOwnership => value === "visible" || value === "retained_hidden";

class RegistryHandle implements SessionRegistryHandle {
  readonly snapshotListeners = new Set<(snapshot: SessionClientSnapshot) => void>();
  readonly effectListeners = new Set<(delivery: SessionEffectDelivery) => void>();
  ownership: SessionOwnership;
  active = true;

  constructor(
    private readonly registry: SessionRegistry,
    readonly entry: Entry,
    readonly generation: number,
    ownership: SessionOwnership,
    onEffect?: (delivery: SessionEffectDelivery) => void,
  ) {
    this.ownership = ownership;
    if (onEffect) this.effectListeners.add(onEffect);
  }

  getSnapshot(): SessionClientSnapshot { return this.entry.snapshot; }

  subscribe(listener: (snapshot: SessionClientSnapshot) => void): () => void {
    if (!this.active) return () => {};
    const subscribedListener = (snapshot: SessionClientSnapshot) => listener(snapshot);
    this.snapshotListeners.add(subscribedListener);
    const current = this.entry.snapshot;
    try { subscribedListener(current); } catch { this.registry.listenerThrew(); }
    this.registry.includeInQueuedSnapshots(this, subscribedListener, current);
    return () => { this.snapshotListeners.delete(subscribedListener); };
  }

  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void {
    if (!this.active) return () => {};
    this.effectListeners.add(listener);
    return () => { this.effectListeners.delete(listener); };
  }

  updateOwnership(ownership: SessionOwnership): void {
    if (!validOwnership(ownership)) throw new Error("invalid_session_ownership");
    if (!this.active || this.ownership === ownership) return;
    this.registry.updateHandleOwnership(this, ownership);
  }

  release(): void { this.registry.releaseHandle(this); }

  invalidate(): void {
    if (!this.active) return;
    this.active = false;
    this.snapshotListeners.clear();
    this.effectListeners.clear();
  }
}

export class SessionRegistry implements SessionRegistryController {
  private readonly entries = new Map<string, Entry>();
  private readonly createClient: (sessionId: string) => SessionClientController;
  private readonly diagnostic?: (entry: SessionRegistryDiagnostic) => void;
  private readonly notificationQueue: RegistryNotification[] = [];
  private nextGeneration = 1;
  private disposed = false;
  private notifying = false;

  constructor(options: SessionRegistryOptions = {}) {
    this.createClient = options.createClient ?? ((sessionId) => new SessionTransportClient(sessionId));
    this.diagnostic = options.diagnostic;
  }

  acquire(sessionId: string, options: SessionAcquireOptions): SessionRegistryHandle {
    if (this.disposed) throw new Error("session_registry_disposed");
    if (!isValidSessionTransportSessionId(sessionId)) throw new Error("invalid_session_transport_session_id");
    if (!options || !validOwnership(options.ownership)
      || (options.onEffect !== undefined && typeof options.onEffect !== "function")) {
      throw new Error("invalid_session_acquire_options");
    }

    const existing = this.entries.get(sessionId);
    if (existing) {
      const handle = new RegistryHandle(this, existing, existing.generation, options.ownership, options.onEffect);
      existing.handles.add(handle);
      this.report("acquired", options.ownership);
      return handle;
    }

    let client: SessionClientController;
    try { client = this.createClient(sessionId); }
    catch { throw new Error("session_registry_client_create_failed"); }

    let snapshot: SessionClientSnapshot;
    try { snapshot = client.getSnapshot(); }
    catch {
      this.stopClientOnce(client);
      throw new Error("session_registry_client_snapshot_failed");
    }

    const entry: Entry = {
      generation: this.nextGeneration++,
      client,
      snapshot,
      handles: new Set(),
      unsubscribeSnapshot: null,
      unsubscribeEffects: null,
      stopped: false,
      stopAttempted: false,
    };
    const handle = new RegistryHandle(this, entry, entry.generation, options.ownership, options.onEffect);
    entry.handles.add(handle);
    this.entries.set(sessionId, entry);

    try {
      const unsubscribeSnapshot = client.subscribe((next) => this.relaySnapshot(entry, next));
      if (typeof unsubscribeSnapshot !== "function") throw new Error("invalid_snapshot_cleanup");
      entry.unsubscribeSnapshot = unsubscribeSnapshot;
      const unsubscribeEffects = client.subscribeEffects((delivery) => this.relayEffect(entry, delivery));
      if (typeof unsubscribeEffects !== "function") throw new Error("invalid_effect_cleanup");
      entry.unsubscribeEffects = unsubscribeEffects;
      client.start();
      if (this.entries.get(sessionId) !== entry || !handle.active || entry.stopped) {
        throw new Error("session_registry_client_invalidated_during_start");
      }
    } catch {
      this.deleteEntry(sessionId, entry);
      throw new Error("session_registry_client_setup_failed");
    }

    this.report("acquired", options.ownership);
    return handle;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [sessionId, entry] of [...this.entries]) this.deleteEntry(sessionId, entry);
    this.report("disposed");
  }

  updateHandleOwnership(handle: RegistryHandle, ownership: SessionOwnership): void {
    const entry = handle.entry;
    if (!this.isCurrent(handle, entry)) return;
    handle.ownership = ownership;
    this.report("relabelled", ownership);
  }

  releaseHandle(handle: RegistryHandle): void {
    if (!handle.active) return;
    const entry = handle.entry;
    if (!this.isCurrent(handle, entry)) {
      handle.invalidate();
      return;
    }
    const ownership = handle.ownership;
    handle.invalidate();
    entry.handles.delete(handle);
    if (entry.handles.size === 0) {
      const sessionId = this.findEntryId(entry);
      if (sessionId !== null) this.deleteEntry(sessionId, entry);
    }
    this.report("released", ownership);
  }

  listenerThrew(): void { this.report("listener_threw"); }

  includeInQueuedSnapshots(
    handle: RegistryHandle,
    listener: (snapshot: SessionClientSnapshot) => void,
    deliveredSnapshot: SessionClientSnapshot,
  ): void {
    const entry = handle.entry;
    if (!this.isCurrent(handle, entry) || !handle.snapshotListeners.has(listener)) return;
    const seenSnapshots = new Set<SessionClientSnapshot>([deliveredSnapshot]);
    for (const batch of this.notificationQueue) {
      if (batch.entry !== entry || !batch.snapshot) continue;
      const listenerIndex = batch.snapshotListeners.indexOf(listener);
      if (seenSnapshots.has(batch.snapshot)) {
        if (listenerIndex !== -1) batch.snapshotListeners.splice(listenerIndex, 1);
        continue;
      }
      seenSnapshots.add(batch.snapshot);
      if (listenerIndex === -1) batch.snapshotListeners.push(listener);
    }
  }

  private isCurrent(handle: RegistryHandle, entry: Entry): boolean {
    return handle.active && handle.generation === entry.generation
      && this.findEntryId(entry) !== null && entry.handles.has(handle);
  }

  private findEntryId(entry: Entry): string | null {
    for (const [sessionId, candidate] of this.entries) if (candidate === entry) return sessionId;
    return null;
  }

  private relaySnapshot(entry: Entry, snapshot: SessionClientSnapshot): void {
    if (this.findEntryId(entry) === null || entry.stopped) return;
    const listeners = [...entry.handles]
      .filter((handle) => handle.active && handle.generation === entry.generation)
      .flatMap((handle) => [...handle.snapshotListeners]);
    this.notificationQueue.push(Object.freeze({
      entry,
      snapshot,
      snapshotListeners: listeners,
      effect: null,
      effectListeners: [],
    }));
    this.drainNotifications();
  }

  private relayEffect(entry: Entry, delivery: SessionEffectDelivery): void {
    if (this.findEntryId(entry) === null || entry.stopped) return;
    const listeners = [...entry.handles]
      .filter((handle) => handle.active && handle.generation === entry.generation)
      .flatMap((handle) => [...handle.effectListeners]);
    this.notificationQueue.push(Object.freeze({
      entry,
      snapshot: null,
      snapshotListeners: [],
      effect: delivery,
      effectListeners: listeners,
    }));
    this.drainNotifications();
  }

  private drainNotifications(): void {
    if (this.notifying) return;
    this.notifying = true;
    try {
      while (this.notificationQueue.length > 0) {
        const batch = this.notificationQueue.shift()!;
        if (batch.entry.stopped || this.findEntryId(batch.entry) === null) continue;
        if (batch.snapshot) {
          batch.entry.snapshot = batch.snapshot;
          for (const listener of batch.snapshotListeners) {
            try { listener(batch.snapshot); } catch { this.listenerThrew(); }
          }
        }
        if (batch.effect) {
          for (const listener of batch.effectListeners) {
            try { listener(batch.effect); } catch { this.listenerThrew(); }
          }
        }
      }
    } finally {
      this.notifying = false;
    }
  }

  private deleteEntry(sessionId: string, entry: Entry): void {
    if (this.entries.get(sessionId) !== entry) return;
    this.entries.delete(sessionId);
    entry.stopped = true;
    for (const handle of [...entry.handles]) handle.invalidate();
    entry.handles.clear();
    const cleanupSnapshot = entry.unsubscribeSnapshot;
    const cleanupEffects = entry.unsubscribeEffects;
    entry.unsubscribeSnapshot = null;
    entry.unsubscribeEffects = null;
    this.invokeCleanup(cleanupSnapshot);
    this.invokeCleanup(cleanupEffects);
    this.stopClientOnce(entry.client, entry);
  }

  private invokeCleanup(cleanup: (() => void) | null): void {
    if (!cleanup) return;
    try { cleanup(); } catch { /* every remaining cleanup still runs */ }
  }

  private stopClientOnce(client: SessionClientController, entry?: Entry): void {
    if (entry) {
      if (entry.stopAttempted) return;
      entry.stopAttempted = true;
    }
    try { client.stop(); } catch { /* the stop attempt is exact-once */ }
  }

  private report(outcome: SessionRegistryDiagnostic["outcome"], ownership?: SessionOwnership): void {
    let visible = 0;
    let retainedHidden = 0;
    for (const entry of this.entries.values()) {
      for (const handle of entry.handles) {
        if (!handle.active) continue;
        if (handle.ownership === "visible") visible += 1;
        else retainedHidden += 1;
      }
    }
    try {
      this.diagnostic?.(Object.freeze({
        outcome,
        entryCount: countClass(this.entries.size),
        visibleCount: countClass(visible),
        retainedHiddenCount: countClass(retainedHidden),
        ...(ownership === undefined ? {} : { ownership }),
      }));
    } catch { /* diagnostics are isolated */ }
  }
}
