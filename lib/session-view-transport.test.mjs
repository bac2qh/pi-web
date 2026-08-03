import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const { SessionRegistry } = await jiti.import("./session-registry.ts");
const { SessionViewTransport, SessionViewAttachmentError } = await jiti.import("./session-view-transport.ts");

function snapshot({ connectionState = "idle", cursor = 0, active = false, revision = cursor, transcriptRevision = 0, streamEpoch } = {}) {
  return protocol.freezeCanonicalData({
    connectionState,
    serverInstanceId: connectionState === "idle" ? null : "server",
    streamEpoch: streamEpoch === undefined
      ? (cursor || connectionState === "recovering" || connectionState === "connected" ? "epoch" : null)
      : streamEpoch,
    cursor,
    state: { ...protocol.createInitialProjectedSessionState(), active, transcriptRevision },
    readyOutcome: connectionState === "recovering" || connectionState === "connected" ? "exact" : null,
    errorClass: connectionState === "terminal" ? "unsupported_protocol" : null,
    revision,
  });
}

class FakeHandle {
  constructor(owner, initial = snapshot()) { this.owner = owner; this.snapshot = initial; this.snapshots = new Set(); this.effects = new Set(); this.released = false; }
  getSnapshot() { return this.snapshot; }
  subscribe(listener) { this.snapshots.add(listener); listener(this.snapshot); return () => this.snapshots.delete(listener); }
  subscribeEffects(listener) { this.effects.add(listener); return () => this.effects.delete(listener); }
  updateOwnership(value) { this.owner.operations.push(["ownership", this.owner.id, value]); }
  release() { if (this.released) return; this.released = true; this.owner.operations.push(["release", this.owner.id]); }
  publish(next) { this.snapshot = next; for (const listener of [...this.snapshots]) listener(next); }
  effect(delivery) { this.owner.onEffect?.(delivery); for (const listener of [...this.effects]) listener(delivery); }
}
class FakeRegistry {
  constructor() { this.entries = new Map(); this.allHandles = []; this.operations = []; this.disposed = 0; }
  acquire(id, options) {
    this.operations.push(["acquire", id, options.ownership]);
    const owner = { id, operations: this.operations, onEffect: options.onEffect };
    const handle = new FakeHandle(owner);
    if (options.onSnapshot) handle.snapshots.add(options.onSnapshot);
    this.entries.set(id, handle);
    this.allHandles.push(handle);
    options.onSnapshot?.(handle.snapshot);
    return handle;
  }
  dispose() { this.disposed += 1; }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function delivery(sequence, type = "notice") {
  return protocol.freezeCanonicalData({
    streamEpoch: "epoch", sequence,
    effect: type === "notice" ? { type, level: "info", message: "synthetic" } : { type: "editor_inserted", text: "synthetic" },
  });
}

test("selection acquires B before relabelling/releasing A and same ID reuses one binding", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const a = views.select("A");
  assert.strictEqual(views.select("A"), a);
  const b = views.select("B");
  assert.notStrictEqual(a, b);
  const acquireB = registry.operations.findIndex((op) => op[0] === "acquire" && op[1] === "B");
  const releaseA = registry.operations.findIndex((op) => op[0] === "release" && op[1] === "A");
  assert.equal(releaseA, -1, "release is deferred beyond the current snapshot/effect batch");
  await flush();
  assert.ok(acquireB >= 0);
  assert.ok(registry.operations.findIndex((op) => op[0] === "release" && op[1] === "A") > acquireB);
  views.dispose();
});

test("prepared rapid A to B to C activates only the mounted winner and acquires it before changing A", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const a = views.select("A");
  registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 1, active: true }));
  const b = views.prepareSelection("B");
  const c = views.prepareSelection("C");
  assert.notStrictEqual(b, c);
  assert.equal(registry.operations.some((operation) => operation[0] === "acquire" && operation[1] === "B"), false);
  assert.equal(registry.operations.some((operation) => operation[0] === "acquire" && operation[1] === "C"), false);
  c.subscribeEffects(() => {});
  c.subscribe(() => {});
  views.activate(c, "visible");
  const acquireC = registry.operations.findIndex((operation) => operation[0] === "acquire" && operation[1] === "C");
  const changeA = registry.operations.findIndex((operation, index) => index > acquireC
    && operation[1] === "A" && (operation[0] === "ownership" || operation[0] === "release"));
  assert.ok(acquireC >= 0 && changeA > acquireC);
  assert.strictEqual(views.prepareSelection("A"), a, "a still-current retained binding can win a reentrant selection");
  views.activate(a, "visible");
  await flush();
  assert.equal(registry.operations.filter((operation) => operation[0] === "acquire" && operation[1] === "A").length, 1);
  views.dispose();
});

test("rapid A to B to A cancels deferred release and N IDs remain independent", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const a = views.select("A");
  views.select("B");
  assert.strictEqual(views.select("A"), a);
  await flush();
  assert.equal(registry.allHandles[0].released, false);
  assert.equal(registry.operations.filter((op) => op[0] === "acquire" && op[1] === "A").length, 1);
  for (const id of ["C", "D", "E"]) {
    views.select(id);
    await flush();
  }
  assert.equal(new Set(registry.operations.filter((op) => op[0] === "acquire").map((op) => op[1])).size, 5);
  assert.equal(registry.allHandles.filter((handle) => !handle.released).length, 1);
  views.dispose();
  assert.equal(registry.allHandles.every((handle) => handle.released), true);
  assert.equal(registry.operations.filter((op) => op[0] === "release").length, registry.allHandles.length);
});

test("uncovered prompt claim survives ready idle baseline and hidden selection until ordered active", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const a = views.select("A");
  const claim = a.beginPromptClaim();
  registry.entries.get("A").publish(snapshot({ connectionState: "recovering", revision: 1, streamEpoch: null }));
  await a.waitUntilAttached(20);
  claim.accepted();
  views.select("B");
  await flush();
  assert.equal(registry.entries.get("A").released, false, "idle selected-before-prompt baseline cannot close the uncovered claim");
  registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 1, active: true }));
  assert.equal(a.getSnapshot().localPromptPending, false, "ordered canonical activity covers the continuity claim");
  registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 2, active: false }));
  await flush();
  assert.equal(registry.entries.get("A").released, true);
  views.dispose();
});

test("a hidden accepted claim settles through the bounded page monitor after its hook listeners unmount", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry, { initialDelayMs: 0, pollMs: 1, maximumMs: 50 });
  const a = views.select("A");
  const claim = a.beginPromptClaim();
  const off = a.subscribe(() => {});
  claim.accepted(async () => true);
  off();
  views.select("B");
  await sleep(10);
  await flush();
  assert.equal(registry.entries.get("A").released, true, "unchanged hidden idle probe settles exact retained claim");
  assert.equal(registry.operations.some((op) => /abort|stop|command/i.test(op.join(" "))), false);
  views.dispose();
});

test("hidden settlement monitor remains one-at-a-time after the fast window until exact idle", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry, { initialDelayMs: 0, pollMs: 1, maximumMs: 0, longPollMs: 1 });
  const a = views.select("A");
  const claim = a.beginPromptClaim();
  let probes = 0, concurrent = 0, maximumConcurrent = 0;
  claim.accepted(async () => {
    probes += 1;
    concurrent += 1;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    await Promise.resolve();
    concurrent -= 1;
    return probes >= 3;
  });
  views.select("B");
  await sleep(15);
  await flush();
  assert.ok(probes >= 3);
  assert.equal(maximumConcurrent, 1);
  assert.equal(registry.entries.get("A").released, true);
  views.dispose();
});

test("same-sequence final effect is delivered before deferred hidden release and transient effects are not journaled", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const seen = [];
  const a = views.select("A");
  a.subscribeEffects((effect) => seen.push(effect.sequence));
  registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 1, active: true }));
  views.select("B");
  registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 2, active: false }));
  registry.entries.get("A").effect(delivery(2));
  assert.deepEqual(seen, [2]);
  await flush();
  assert.equal(registry.entries.get("A").released, true);
  const later = [];
  a.subscribeEffects((effect) => later.push(effect.sequence));
  assert.deepEqual(later, [], "released bindings do not replay an effect journal");
  views.dispose();
});

test("visible completion is an atomic page-lineage decision for projected-first HTTP-first and reentrancy", () => {
  for (const order of ["projected-first", "http-first"]) {
    const registry = new FakeRegistry();
    const views = new SessionViewTransport(registry);
    const a = views.select("A");
    const claim = a.beginPromptClaim();
    const completions = [];
    a.subscribeCompletions((lineage) => {
      completions.push(lineage);
      a.settlePromptLineage(lineage);
    });
    claim.accepted();
    if (order === "projected-first") {
      registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 1, active: true }));
      registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 2, active: false }));
      a.settlePromptLineage(claim.lineage);
    } else {
      a.settlePromptLineage(claim.lineage);
      registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 1, active: true }));
      registry.entries.get("A").publish(snapshot({ connectionState: "connected", cursor: 2, active: false }));
    }
    assert.deepEqual(completions, [claim.lineage], order);
    views.dispose();
  }
});

test("hidden settlement is permanently suppressed while A to B to A before settlement remains eligible", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const hidden = views.select("hidden");
  const hiddenClaim = hidden.beginPromptClaim();
  const hiddenSeen = [];
  hidden.subscribeCompletions((lineage) => hiddenSeen.push(lineage));
  hiddenClaim.accepted();
  views.select("B");
  hidden.settlePromptLineage(hiddenClaim.lineage);
  views.select("hidden");
  assert.deepEqual(hiddenSeen, []);

  const eligible = views.select("eligible");
  const claim = eligible.beginPromptClaim();
  const seen = [];
  const off = eligible.subscribeCompletions((lineage) => seen.push(lineage));
  claim.accepted();
  views.select("B2");
  views.select("eligible");
  eligible.settlePromptLineage(claim.lineage);
  assert.deepEqual(seen, [claim.lineage]);
  off();
  eligible.subscribeCompletions((lineage) => seen.push(lineage));
  assert.deepEqual(seen, [claim.lineage], "remount alone cannot recreate completion");
  await flush();
  views.dispose();
});

test("stale new-screen materialization is atomically claim-retained and cannot select itself", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  views.select(null); // blank screen A
  views.select(null); // newer blank screen C
  const { binding: staleA, claim } = views.beginPrompt("materialized-A");
  assert.deepEqual(registry.operations.find((op) => op[0] === "acquire"), ["acquire", "materialized-A", "retained_hidden"]);
  claim.accepted();
  const currentC = views.select("current-C");
  assert.notStrictEqual(currentC, staleA);
  assert.ok(registry.operations.some((op) => op[0] === "ownership" && op[1] === "current-C" && op[2] === "visible"));
  claim.failed();
  await flush();
  assert.equal(registry.entries.get("materialized-A").released, true);
  assert.strictEqual(views.select("current-C"), currentC);
  views.dispose();
});

test("current new-screen prompt installs consumers before visible activation and promotion reuses its binding", () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const { binding, claim } = views.beginPrompt("current", true, "slash_command");
  assert.equal(registry.operations.length, 0, "prepared binding does not start before consumers exist");
  assert.equal(binding.getPromptClassification(), "slash_command");
  binding.subscribeEffects(() => {});
  binding.subscribe(() => {});
  views.activate(binding, "visible");
  assert.deepEqual(registry.operations[0], ["acquire", "current", "visible"]);
  assert.strictEqual(views.select("current"), binding);
  assert.equal(registry.operations.filter((op) => op[0] === "acquire" && op[1] === "current").length, 1);
  claim.failed();
  views.select(null);
  views.dispose();
});

test("attachment accepts only current recovering/connected generation and fails terminal/timeout/release", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const recovering = views.select("recovering");
  const ready = recovering.waitUntilAttached(30);
  registry.entries.get("recovering").publish(snapshot({ connectionState: "recovering", revision: 1 }));
  await ready;

  const terminal = views.select("terminal");
  registry.entries.get("terminal").publish(snapshot({ connectionState: "terminal", revision: 1 }));
  await assert.rejects(terminal.waitUntilAttached(20), (error) => error instanceof SessionViewAttachmentError && error.reason === "terminal");

  const timeout = views.select("timeout");
  await assert.rejects(timeout.waitUntilAttached(1), (error) => error.reason === "timeout");

  const released = views.select("released");
  const pending = released.waitUntilAttached(100);
  views.select("replacement");
  await flush();
  await assert.rejects(pending, (error) => error.reason === "released");
  views.dispose();
});

test("failed claims expose covered versus rollback outcomes from exact lineage evidence", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const binding = views.select("covered");
  const covered = binding.beginPromptClaim("slash_command");
  registry.entries.get("covered").publish(snapshot({ connectionState: "connected", cursor: 1, active: true }));
  assert.equal(covered.failed(), "covered");
  assert.equal(binding.getPromptLineage(), covered.lineage);
  assert.equal(binding.getPromptClassification(), "slash_command");
  registry.entries.get("covered").publish(snapshot({ connectionState: "connected", cursor: 2, active: false }));

  const failedBinding = views.select("rollback");
  const failed = failedBinding.beginPromptClaim();
  assert.equal(failed.failed(), "rolled_back");
  assert.equal(failedBinding.getPromptLineage(), null);
  views.dispose();
});

test("pre-acceptance idle cannot settle a lineage while accepted recovery idle settlement remains exact", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);

  const unacceptedBinding = views.select("unaccepted");
  const unaccepted = unacceptedBinding.beginPromptClaim();
  unacceptedBinding.settlePromptLineage(unaccepted.lineage);
  assert.equal(unacceptedBinding.getPromptLineage(), unaccepted.lineage, "idle HTTP before POST acceptance supplies no execution proof");
  assert.equal(unaccepted.failed(), "rolled_back", "definitive failed POST still rolls back after pre-acceptance idle");
  assert.equal(unacceptedBinding.getPromptLineage(), null);

  const failedBinding = views.select("failed");
  const failed = failedBinding.beginPromptClaim();
  views.select("other");
  failed.failed();
  await flush();
  assert.equal(registry.entries.get("failed").released, true);

  const settledBinding = views.select("settled");
  const settled = settledBinding.beginPromptClaim();
  settled.accepted();
  views.select("last");
  settledBinding.settlePromptLineage(settled.lineage);
  await flush();
  assert.equal(registry.entries.get("settled").released, true, "accepted recovery snapshot may settle from run-matched HTTP idle");
  assert.equal(registry.operations.some((op) => /abort|stop/i.test(op.join(" "))), false);
  views.dispose();
});

test("same ID recreates only after exact release and snapshot/effect listeners isolate throws and reentrancy", async () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const first = views.select("same");
  const firstGeneration = first.getSnapshot().generation;
  let snapshots = 0, effects = 0;
  first.subscribe(() => { throw new Error("isolated"); });
  first.subscribe(() => { snapshots += 1; if (snapshots === 2) views.select("same"); });
  first.subscribeEffects(() => { throw new Error("isolated"); });
  first.subscribeEffects(() => { effects += 1; });
  registry.entries.get("same").publish(snapshot({ connectionState: "connected", cursor: 1 }));
  registry.entries.get("same").effect(delivery(1));
  assert.equal(effects, 1);
  views.select("other");
  await flush();
  const second = views.select("same");
  assert.ok(second.getSnapshot().generation > firstGeneration);
  assert.equal(registry.operations.filter((op) => op[0] === "acquire" && op[1] === "same").length, 2);
  views.dispose();
});

test("canonical commitment distinguishes initial ready from retained prior-epoch recovery", () => {
  const registry = new FakeRegistry();
  const views = new SessionViewTransport(registry);
  const initial = views.select("initial");
  registry.entries.get("initial").publish(snapshot({ connectionState: "recovering", streamEpoch: null, revision: 1 }));
  assert.equal(initial.getSnapshot().canonicalCommitted, false);
  registry.entries.get("initial").publish(snapshot({ connectionState: "connected", streamEpoch: "epoch", cursor: 1, revision: 2 }));
  assert.equal(initial.getSnapshot().canonicalCommitted, true);

  const prior = views.select("prior");
  registry.entries.get("prior").publish(snapshot({ connectionState: "recovering", streamEpoch: "prior", cursor: 9, revision: 1 }));
  assert.equal(prior.getSnapshot().canonicalCommitted, true, "accepted client retains real prior committed receiver during recovery");
  views.dispose();
});

class SynchronousStartClient {
  constructor(id, operations, emitEffect = false) {
    this.id = id;
    this.operations = operations;
    this.emitEffectOnStart = emitEffect;
    this.current = snapshot();
    this.snapshotListeners = new Set();
    this.effectListeners = new Set();
    this.startCalls = 0;
    this.stopCalls = 0;
  }
  getSnapshot() { return this.current; }
  subscribe(listener) { this.snapshotListeners.add(listener); listener(this.current); return () => this.snapshotListeners.delete(listener); }
  subscribeEffects(listener) { this.effectListeners.add(listener); return () => this.effectListeners.delete(listener); }
  start() {
    this.startCalls += 1;
    this.operations.push(["start", this.id]);
    this.current = snapshot({ connectionState: "connected", cursor: this.id === "A" ? 1 : 2, active: true });
    for (const listener of [...this.snapshotListeners]) listener(this.current);
    if (this.emitEffectOnStart) {
      for (const listener of [...this.effectListeners]) listener(delivery(1));
    }
  }
  stop() { this.stopCalls += 1; this.operations.push(["stop", this.id]); }
}

test("real registry acquisition publishes the synchronous start snapshot before the associated view effect", () => {
  const operations = [], clients = [];
  const registry = new SessionRegistry({
    createClient(id) { const client = new SynchronousStartClient(id, operations, true); clients.push(client); return client; },
  });
  const views = new SessionViewTransport(registry);
  const binding = views.prepareSelection("A");
  const order = [];
  binding.subscribe((next) => order.push(["snapshot", next.transport.cursor]));
  binding.subscribeEffects((effect) => order.push(["effect", effect.sequence, binding.getSnapshot().transport.cursor]));
  views.activate(binding, "visible");
  const committedIndex = order.findIndex((item) => item[0] === "snapshot" && item[1] === 1);
  const effectIndex = order.findIndex((item) => item[0] === "effect");
  assert.ok(committedIndex >= 0 && effectIndex > committedIndex, JSON.stringify(order));
  assert.deepEqual(order[effectIndex], ["effect", 1, 1]);
  views.dispose();
  registry.dispose();
  assert.equal(clients[0].startCalls, 1);
  assert.equal(clients[0].stopCalls, 1);
});

test("real registry coalesces same-ID visible reentrant activation into one raw handle", () => {
  const operations = [], clients = [];
  const registry = new SessionRegistry({
    createClient(id) { const client = new SynchronousStartClient(id, operations, true); clients.push(client); return client; },
  });
  const views = new SessionViewTransport(registry);
  const binding = views.prepareSelection("same");
  let reentries = 0;
  binding.subscribe(() => {});
  binding.subscribeEffects(() => {
    reentries += 1;
    views.activate(binding, "visible");
  });
  views.activate(binding, "visible");
  assert.equal(reentries, 1);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].startCalls, 1);
  assert.strictEqual(views.select("same"), binding);
  views.dispose();
  assert.equal(clients[0].stopCalls, 1);
  assert.equal(clients[0].snapshotListeners.size, 0);
  assert.equal(clients[0].effectListeners.size, 0);
  registry.dispose();
  assert.equal(clients[0].stopCalls, 1);
});

test("real registry upgrades retained-to-visible same-ID intent during synchronous acquisition", () => {
  const operations = [], clients = [];
  const registry = new SessionRegistry({
    createClient(id) { const client = new SynchronousStartClient(id, operations, true); clients.push(client); return client; },
  });
  const views = new SessionViewTransport(registry);
  const binding = views.prepareSelection("same");
  binding.subscribe(() => {});
  binding.subscribeEffects(() => views.activate(binding, "visible"));
  views.activate(binding, "retained_hidden");
  assert.strictEqual(views.select("same"), binding, "the reentrant visible intent becomes final selection");
  assert.equal(clients.length, 1);
  assert.equal(clients[0].startCalls, 1);
  views.dispose();
  registry.dispose();
  assert.equal(clients[0].stopCalls, 1);
  assert.equal(clients[0].snapshotListeners.size, 0);
  assert.equal(clients[0].effectListeners.size, 0);
});

test("real registry releases a synchronously invalidated acquisition after reentrant null selection", () => {
  const operations = [], clients = [];
  const registry = new SessionRegistry({
    createClient(id) { const client = new SynchronousStartClient(id, operations, true); clients.push(client); return client; },
  });
  const views = new SessionViewTransport(registry);
  const binding = views.prepareSelection("A");
  binding.subscribe(() => {});
  binding.subscribeEffects(() => views.select(null));
  assert.throws(() => views.activate(binding, "visible"), (error) => (
    error instanceof SessionViewAttachmentError && error.reason === "stale"
  ));
  assert.equal(clients[0].startCalls, 1);
  assert.equal(clients[0].stopCalls, 1);
  assert.equal(clients[0].snapshotListeners.size, 0);
  assert.equal(clients[0].effectListeners.size, 0);
  views.dispose();
  registry.dispose();
  assert.equal(clients[0].stopCalls, 1);
});

test("real registry releases a synchronously invalidated acquisition after reentrant B activation without selection corruption or leak", () => {
  const operations = [], clients = new Map();
  const registry = new SessionRegistry({
    createClient(id) {
      const client = new SynchronousStartClient(id, operations, id === "A");
      clients.set(id, client);
      return client;
    },
  });
  const views = new SessionViewTransport(registry);
  const a = views.prepareSelection("A");
  let b = null;
  a.subscribe(() => {});
  a.subscribeEffects(() => {
    b = views.prepareSelection("B");
    b.subscribe(() => {});
    b.subscribeEffects(() => {});
    views.activate(b, "visible");
  });
  assert.throws(() => views.activate(a, "visible"), (error) => (
    error instanceof SessionViewAttachmentError && error.reason === "stale"
  ));
  assert.ok(b);
  assert.strictEqual(views.prepareSelection("B"), b, "B remains the exact selected binding after A invalidation");
  views.activate(b, "visible");
  const startB = operations.findIndex(([kind, id]) => kind === "start" && id === "B");
  const stopA = operations.findIndex(([kind, id]) => kind === "stop" && id === "A");
  assert.ok(startB >= 0 && stopA > startB, JSON.stringify(operations));
  assert.equal(clients.get("A").stopCalls, 1, "invalidated A is released exactly once");
  assert.equal(clients.get("B").stopCalls, 0, "current B remains owned until page disposal");
  views.dispose();
  registry.dispose();
  assert.equal(clients.get("A").stopCalls, 1);
  assert.equal(clients.get("B").stopCalls, 1);
  assert.equal(clients.get("A").snapshotListeners.size, 0);
  assert.equal(clients.get("A").effectListeners.size, 0);
  assert.equal(clients.get("B").snapshotListeners.size, 0);
  assert.equal(clients.get("B").effectListeners.size, 0);
  assert.equal([...clients.values()].reduce((sum, client) => sum + client.startCalls, 0),
    [...clients.values()].reduce((sum, client) => sum + client.stopCalls, 0), "every started client is disposed without a leaked owner");
});
