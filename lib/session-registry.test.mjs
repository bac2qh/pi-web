import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const { SessionRegistry } = await jiti.import("./session-registry.ts");

function frozenSnapshot(revision = 0, cursor = 0) {
  return protocol.freezeCanonicalData({
    connectionState: "idle", serverInstanceId: null, streamEpoch: cursor ? "epoch" : null,
    cursor, state: protocol.createInitialProjectedSessionState(), readyOutcome: null,
    errorClass: null, revision,
  });
}
class FakeClient {
  constructor(config = {}) {
    this.snapshot = frozenSnapshot(); this.snapshotListeners = new Set(); this.effectListeners = new Set();
    this.startCalls = 0; this.stopCalls = 0; this.snapshotCleanupCalls = 0; this.effectCleanupCalls = 0;
    this.config = config; this.effectOnStart = config.effectOnStart ?? false;
  }
  getSnapshot() { if (this.config.throwGetSnapshot) throw new Error("snapshot"); return this.snapshot; }
  subscribe(listener) {
    if (this.config.throwSubscribe) throw new Error("subscribe");
    this.snapshotListeners.add(listener); listener(this.snapshot);
    return () => { this.snapshotCleanupCalls += 1; this.snapshotListeners.delete(listener); if (this.config.throwSnapshotCleanup) throw new Error("snapshot cleanup"); };
  }
  subscribeEffects(listener) {
    if (this.config.throwSubscribeEffects) throw new Error("effects");
    this.effectListeners.add(listener);
    return () => { this.effectCleanupCalls += 1; this.effectListeners.delete(listener); if (this.config.throwEffectCleanup) throw new Error("effect cleanup"); };
  }
  start() {
    this.startCalls += 1;
    if (this.config.throwStart) throw new Error("start");
    if (this.effectOnStart) this.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "start" } }));
  }
  stop() { this.stopCalls += 1; if (this.config.throwStop) throw new Error("stop"); }
  publish(cursor) { this.snapshot = frozenSnapshot(this.snapshot.revision + 1, cursor); this.republish(); }
  republish() { for (const listener of [...this.snapshotListeners]) listener(this.snapshot); }
  emitEffect(delivery) { for (const listener of [...this.effectListeners]) listener(delivery); }
}
function harness(config = {}) {
  const created = [];
  const registry = new SessionRegistry({ createClient(id) { const client = new FakeClient(config); created.push({ id, client }); return client; } });
  return { registry, created };
}

test("same ID owners share one client while distinct IDs own independent clients", () => {
  const { registry, created } = harness();
  const visible = registry.acquire("same", { ownership: "visible" });
  const hidden = registry.acquire("same", { ownership: "retained_hidden" });
  const other = registry.acquire("other", { ownership: "visible" });
  assert.deepEqual(created.map((item) => item.id), ["same", "other"]);
  assert.equal(created[0].client.startCalls, 1);
  assert.equal(created[1].client.startCalls, 1);
  assert.strictEqual(visible.getSnapshot(), hidden.getSnapshot());
  created[0].client.publish(1);
  assert.strictEqual(visible.getSnapshot(), hidden.getSnapshot());
  assert.notStrictEqual(visible.getSnapshot(), other.getSnapshot());
  visible.release();
  assert.equal(created[0].client.stopCalls, 0, "hidden ownership retains client need");
  hidden.release();
  assert.equal(created[0].client.stopCalls, 1);
  other.release();
  assert.equal(created[1].client.stopCalls, 1);
});

test("first onEffect is installed before synchronous client start without a journal", () => {
  const { registry, created } = harness({ effectOnStart: true });
  const effects = [];
  const handle = registry.acquire("session", { ownership: "visible", onEffect: (delivery) => effects.push(delivery) });
  assert.equal(created[0].client.startCalls, 1);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].sequence, 1);
  const futureOnly = [];
  handle.subscribeEffects((delivery) => futureOnly.push(delivery));
  assert.equal(futureOnly.length, 0, "later effect subscriptions have no history");
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 2, effect: { type: "notice", level: "info", message: "future" } }));
  assert.deepEqual(futureOnly.map((item) => item.sequence), [2]);
  handle.release();
});

test("handle snapshots preserve stable client identity and subscriptions synchronously deliver current once", () => {
  const { registry, created } = harness();
  const handle = registry.acquire("session", { ownership: "visible" });
  const identity = handle.getSnapshot();
  assert.strictEqual(handle.getSnapshot(), identity);
  const seen = [];
  handle.subscribe((snapshot) => seen.push(snapshot));
  assert.deepEqual(seen, [identity]);
  created[0].client.publish(1);
  assert.equal(seen.length, 2);
  assert.strictEqual(handle.getSnapshot(), seen[1]);
  assert.strictEqual(handle.getSnapshot(), handle.getSnapshot());
  assert.ok(Object.isFrozen(handle.getSnapshot()) && Object.isFrozen(handle.getSnapshot().state));
  handle.release();
});

test("ownership relabel and acquire-before-release affect only the addressed handle", () => {
  const { registry, created } = harness();
  const oldVisible = registry.acquire("session", { ownership: "visible" });
  const newVisible = registry.acquire("session", { ownership: "visible" });
  oldVisible.updateOwnership("retained_hidden");
  oldVisible.release();
  assert.equal(created[0].client.stopCalls, 0);
  newVisible.updateOwnership("retained_hidden");
  newVisible.updateOwnership("retained_hidden");
  newVisible.release();
  assert.equal(created[0].client.stopCalls, 1);
});

test("stale and double handle operations cannot affect a recreated generation", () => {
  const { registry, created } = harness();
  const stale = registry.acquire("session", { ownership: "visible" });
  stale.release(); stale.release(); stale.updateOwnership("retained_hidden");
  assert.equal(created[0].client.stopCalls, 1);
  const current = registry.acquire("session", { ownership: "visible" });
  assert.equal(created.length, 2);
  stale.release(); stale.updateOwnership("visible");
  assert.equal(created[1].client.stopCalls, 0);
  current.release();
  assert.equal(created[1].client.stopCalls, 1);
});

test("snapshot and effect listener mutation and throws isolate deterministic fanout", () => {
  const { registry, created } = harness();
  const one = registry.acquire("session", { ownership: "visible" });
  const two = registry.acquire("session", { ownership: "retained_hidden" });
  const snapshots = [], effects = [];
  one.subscribe(() => { throw new Error("synthetic"); });
  one.subscribe((snapshot) => snapshots.push(snapshot.cursor));
  one.subscribeEffects(() => { throw new Error("synthetic"); });
  two.subscribeEffects((delivery) => effects.push(delivery.sequence));
  created[0].client.publish(1);
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "x" } }));
  assert.deepEqual(snapshots, [0, 1]);
  assert.deepEqual(effects, [1]);
  one.release(); two.release();
});

test("dispose invalidates all handles and stops every current client exactly once", () => {
  const { registry, created } = harness();
  const one = registry.acquire("one", { ownership: "visible" });
  const two = registry.acquire("two", { ownership: "retained_hidden" });
  registry.dispose(); registry.dispose();
  assert.deepEqual(created.map((item) => item.client.stopCalls), [1, 1]);
  one.release(); two.release(); one.updateOwnership("retained_hidden");
  assert.deepEqual(created.map((item) => item.client.stopCalls), [1, 1]);
  assert.throws(() => registry.acquire("later", { ownership: "visible" }), /disposed/);
});

test("nested snapshot and effect batches preserve captured identities and sequence order", () => {
  const { registry, created } = harness();
  const one = registry.acquire("session", { ownership: "visible" });
  const two = registry.acquire("session", { ownership: "retained_hidden" });
  const snapshots = [], effects = [], effectCursors = [];
  let nestedSnapshot = false, nestedEffect = false;
  one.subscribe((snapshot) => {
    if (snapshot.cursor === 1 && !nestedSnapshot) { nestedSnapshot = true; created[0].client.publish(2); }
  });
  two.subscribe((snapshot) => snapshots.push([snapshot.revision, snapshot.cursor, two.getSnapshot()]));
  one.subscribeEffects((delivery) => {
    if (delivery.sequence === 1 && !nestedEffect) {
      nestedEffect = true;
      created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 2, effect: { type: "notice", level: "info", message: "nested" } }));
    }
  });
  two.subscribeEffects((delivery) => { effects.push(delivery.sequence); effectCursors.push(two.getSnapshot().cursor); });
  created[0].client.publish(1);
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "outer" } }));
  assert.deepEqual(snapshots.map(([revision, cursor]) => [revision, cursor]), [[0, 0], [1, 1], [2, 2]]);
  assert.ok(snapshots.every(([, , identity]) => Object.isFrozen(identity)));
  assert.deepEqual(effects, [1, 2]);
  assert.deepEqual(effectCursors, [2, 2]);
  one.release(); two.release();
});

test("nested snapshot followed by last release finishes the current batch and suppresses the deleted generation", () => {
  const { registry, created } = harness();
  const handle = registry.acquire("session", { ownership: "visible" });
  const seen = [], currentBatch = [];
  handle.subscribe((snapshot) => {
    seen.push(snapshot.cursor);
    if (snapshot.cursor === 1) {
      created[0].client.publish(2);
      handle.release();
    }
  });
  handle.subscribe((snapshot) => currentBatch.push(snapshot.cursor));
  seen.length = 0; currentBatch.length = 0;
  created[0].client.publish(1);
  assert.deepEqual(seen, [1], "nested stale snapshot is not delivered");
  assert.deepEqual(currentBatch, [1], "the already-shifted batch keeps its captured listener snapshot");
  assert.equal(handle.getSnapshot().cursor, 1, "deleted entry does not advance to the queued stale cursor");
  assert.equal(created[0].client.stopCalls, 1);
});

test("nested effect followed by last release finishes the current batch and suppresses the deleted generation", () => {
  const { registry, created } = harness();
  const handle = registry.acquire("session", { ownership: "visible" });
  const seen = [], currentBatch = [];
  handle.subscribeEffects((delivery) => {
    seen.push(delivery.sequence);
    if (delivery.sequence === 1) {
      created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 2, effect: { type: "notice", level: "info", message: "stale" } }));
      handle.release();
    }
  });
  handle.subscribeEffects((delivery) => currentBatch.push(delivery.sequence));
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "current" } }));
  assert.deepEqual(seen, [1], "nested stale effect is not delivered");
  assert.deepEqual(currentBatch, [1], "the already-shifted batch keeps its captured listener snapshot");
  assert.equal(created[0].client.stopCalls, 1);
});

test("nested snapshot followed by registry disposal cannot mutate or notify the disposed generation", () => {
  const { registry, created } = harness();
  const handle = registry.acquire("session", { ownership: "visible" });
  const seen = [], currentBatch = [];
  handle.subscribe((snapshot) => {
    seen.push(snapshot.cursor);
    if (snapshot.cursor === 1) {
      created[0].client.publish(2);
      registry.dispose();
    }
  });
  handle.subscribe((snapshot) => currentBatch.push(snapshot.cursor));
  seen.length = 0; currentBatch.length = 0;
  created[0].client.publish(1);
  assert.deepEqual(seen, [1]);
  assert.deepEqual(currentBatch, [1]);
  assert.equal(handle.getSnapshot().cursor, 1);
  assert.equal(created[0].client.stopCalls, 1);
  assert.throws(() => registry.acquire("session", { ownership: "visible" }), /disposed/);
});

test("nested effect followed by registry disposal cannot notify the disposed generation", () => {
  const { registry, created } = harness();
  const handle = registry.acquire("session", { ownership: "visible" });
  const seen = [], currentBatch = [];
  handle.subscribeEffects((delivery) => {
    seen.push(delivery.sequence);
    if (delivery.sequence === 1) {
      created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 2, effect: { type: "notice", level: "info", message: "stale" } }));
      registry.dispose();
    }
  });
  handle.subscribeEffects((delivery) => currentBatch.push(delivery.sequence));
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "current" } }));
  assert.deepEqual(seen, [1]);
  assert.deepEqual(currentBatch, [1]);
  assert.equal(created[0].client.stopCalls, 1);
});

test("nested snapshot from a released generation cannot affect a same-ID replacement", () => {
  const { registry, created } = harness();
  const stale = registry.acquire("session", { ownership: "visible" });
  const staleSeen = [], currentBatch = [];
  let replacement;
  stale.subscribe((snapshot) => {
    staleSeen.push(snapshot.cursor);
    if (snapshot.cursor === 1) {
      created[0].client.publish(2);
      stale.release();
      replacement = registry.acquire("session", { ownership: "visible" });
      created[1].client.publish(7);
    }
  });
  stale.subscribe((snapshot) => currentBatch.push(snapshot.cursor));
  staleSeen.length = 0; currentBatch.length = 0;
  created[0].client.publish(1);
  assert.deepEqual(staleSeen, [1]);
  assert.deepEqual(currentBatch, [1]);
  assert.equal(stale.getSnapshot().cursor, 1, "old generation suppresses its queued cursor");
  assert.equal(replacement.getSnapshot().cursor, 7, "replacement applies only its own queued snapshot");
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 0]);
  replacement.release();
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 1]);
});

test("same-ID replacement subscription delivers queued initial once and a newer identity once", () => {
  const { registry, created } = harness();
  const stale = registry.acquire("session", { ownership: "visible" });
  const staleSeen = [], currentBatch = [], replacementSeen = [];
  let replacement, replacementInitial;
  stale.subscribe((snapshot) => {
    staleSeen.push(snapshot.cursor);
    if (snapshot.cursor === 1) {
      created[0].client.publish(2);
      stale.release();
      replacement = registry.acquire("session", { ownership: "visible" });
      replacementInitial = replacement.getSnapshot();
      replacement.subscribe((next) => replacementSeen.push(next));
      created[1].client.publish(9);
    }
  });
  stale.subscribe((snapshot) => currentBatch.push(snapshot.cursor));
  staleSeen.length = 0; currentBatch.length = 0;
  created[0].client.publish(1);
  assert.deepEqual(replacementSeen.map(({ revision, cursor }) => [revision, cursor]), [[0, 0], [1, 9]]);
  assert.strictEqual(replacementSeen[0], replacementInitial, "queued initial identity is not redelivered");
  assert.deepEqual(staleSeen, [1], "old queued cursor is not delivered");
  assert.deepEqual(currentBatch, [1], "the old current batch still finishes");
  assert.equal(stale.getSnapshot().cursor, 1, "old generation is not mutated by its queued cursor");
  assert.equal(replacement.getSnapshot().cursor, 9, "replacement reaches only its own newer cursor");
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 0]);
  replacement.release();
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 1]);
});

test("replacement subscriptions deduplicate queued identities without losing later distinct snapshots", () => {
  const { registry, created } = harness();
  const stale = registry.acquire("session", { ownership: "visible" });
  const replacementSeen = [];
  let replacement;
  stale.subscribe((snapshot) => {
    if (snapshot.cursor !== 1) return;
    stale.release();
    replacement = registry.acquire("session", { ownership: "visible" });
    replacement.subscribe((next) => {
      replacementSeen.push(next);
      if (replacementSeen.length !== 1) return;
      created[1].client.republish();
      created[1].client.publish(7);
      created[1].client.republish();
      created[1].client.publish(8);
      created[1].client.republish();
    });
  });
  created[0].client.publish(1);
  assert.deepEqual(replacementSeen.map(({ revision, cursor }) => [revision, cursor]), [[0, 0], [1, 7], [2, 8]]);
  assert.equal(replacement.getSnapshot().cursor, 8);
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 0]);
  replacement.release();
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 1]);
});

test("nested effect from a released generation cannot affect a same-ID replacement", () => {
  const { registry, created } = harness();
  const stale = registry.acquire("session", { ownership: "visible" });
  const staleSeen = [], currentBatch = [], replacementSeen = [];
  let replacement;
  stale.subscribeEffects((delivery) => {
    staleSeen.push(delivery.sequence);
    if (delivery.sequence === 1) {
      created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 2, effect: { type: "notice", level: "info", message: "stale" } }));
      stale.release();
      replacement = registry.acquire("session", { ownership: "visible", onEffect: (next) => replacementSeen.push(next.sequence) });
      created[1].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 9, effect: { type: "notice", level: "info", message: "replacement" } }));
    }
  });
  stale.subscribeEffects((delivery) => currentBatch.push(delivery.sequence));
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "current" } }));
  assert.deepEqual(staleSeen, [1]);
  assert.deepEqual(currentBatch, [1]);
  assert.deepEqual(replacementSeen, [9], "replacement receives only its own effect batch");
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 0]);
  replacement.release();
  assert.deepEqual(created.map(({ client }) => client.stopCalls), [1, 1]);
});

test("keeper owner excludes snapshots published after a synchronous subscriber releases", () => {
  const { registry, created } = harness();
  const keeper = registry.acquire("session", { ownership: "visible" });
  const seen = [];
  let newcomer;
  keeper.subscribe((snapshot) => {
    if (snapshot.cursor !== 1) return;
    newcomer = registry.acquire("session", { ownership: "retained_hidden" });
    newcomer.subscribe((current) => {
      seen.push(current.cursor);
      if (current.cursor !== 1) return;
      newcomer.release();
      created[0].client.publish(2);
    });
  });
  created[0].client.publish(1);
  assert.deepEqual(seen, [1], "release prevents membership in the later queued snapshot");
  assert.equal(created[0].client.stopCalls, 0, "keeper retains the current client");
  assert.equal(keeper.getSnapshot().cursor, 2, "the keeper still advances to the published snapshot");
  keeper.release();
  assert.equal(created[0].client.stopCalls, 1);
});

test("keeper owner preserves a queued snapshot captured before synchronous subscriber release", () => {
  const { registry, created } = harness();
  const keeper = registry.acquire("session", { ownership: "visible" });
  const seen = [];
  let newcomer;
  keeper.subscribe((snapshot) => {
    if (snapshot.cursor !== 1) return;
    newcomer = registry.acquire("session", { ownership: "retained_hidden" });
    newcomer.subscribe((current) => {
      seen.push(current.cursor);
      if (current.cursor !== 1) return;
      created[0].client.publish(2);
      newcomer.release();
    });
  });
  created[0].client.publish(1);
  assert.deepEqual(seen, [1, 2], "the already-captured listener-set snapshot still completes");
  assert.equal(created[0].client.stopCalls, 0, "keeper retains the current client");
  assert.equal(keeper.getSnapshot().cursor, 2, "the keeper and entry remain current");
  keeper.release();
  assert.equal(created[0].client.stopCalls, 1);
});

test("registry subscribe and unsubscribe reentrancy preserves captured and future batches", () => {
  const { registry, created } = harness();
  const one = registry.acquire("session", { ownership: "visible" });
  const two = registry.acquire("session", { ownership: "retained_hidden" });
  let unsubscribeSnapshotB = () => {}, snapshotMutated = false;
  const snapshotB = [], snapshotC = [];
  one.subscribe((snapshot) => {
    if (snapshot.cursor === 1 && !snapshotMutated) {
      snapshotMutated = true;
      unsubscribeSnapshotB();
      two.subscribe((next) => snapshotC.push(next.cursor));
      created[0].client.publish(2);
    }
  });
  unsubscribeSnapshotB = two.subscribe((snapshot) => snapshotB.push(snapshot.cursor));
  snapshotB.length = 0;
  created[0].client.publish(1);
  assert.deepEqual(snapshotB, [1]);
  assert.deepEqual(snapshotC, [1, 2]);

  let unsubscribeEffectB = () => {}, effectMutated = false;
  const effectB = [], effectC = [];
  one.subscribeEffects((delivery) => {
    if (delivery.sequence === 3 && !effectMutated) {
      effectMutated = true;
      unsubscribeEffectB();
      two.subscribeEffects((next) => effectC.push(next.sequence));
      created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 4, effect: { type: "notice", level: "info", message: "nested" } }));
    }
  });
  unsubscribeEffectB = two.subscribeEffects((delivery) => effectB.push(delivery.sequence));
  created[0].client.emitEffect(protocol.freezeCanonicalData({ streamEpoch: "epoch", sequence: 3, effect: { type: "notice", level: "info", message: "outer" } }));
  assert.deepEqual(effectB, [3]);
  assert.deepEqual(effectC, [4]);
  one.release(); two.release();
});

test("first-entry creation is rollback-safe at every factory and client setup boundary", () => {
  const stages = ["create", "getSnapshot", "subscribe", "subscribeEffects", "start"];
  for (const stage of stages) {
    const created = [];
    let attempt = 0;
    const registry = new SessionRegistry({
      createClient() {
        attempt += 1;
        if (stage === "create" && attempt === 1) throw new Error("create");
        const config = attempt === 1 ? {
          throwGetSnapshot: stage === "getSnapshot",
          throwSubscribe: stage === "subscribe",
          throwSubscribeEffects: stage === "subscribeEffects",
          throwStart: stage === "start",
        } : {};
        const client = new FakeClient(config); created.push(client); return client;
      },
    });
    assert.throws(() => registry.acquire("session", { ownership: "visible" }), stage);
    if (stage !== "create") {
      assert.equal(created[0].stopCalls, 1, `${stage} stops once`);
      assert.equal(created[0].snapshotCleanupCalls, ["subscribeEffects", "start"].includes(stage) ? 1 : 0, `${stage} snapshot cleanup`);
      assert.equal(created[0].effectCleanupCalls, stage === "start" ? 1 : 0, `${stage} effect cleanup`);
    }
    const replacement = registry.acquire("session", { ownership: "visible" });
    assert.equal(attempt, 2, `${stage} recreates instead of reusing poison`);
    replacement.release();
    assert.equal(created.at(-1).stopCalls, 1);
  }
});

test("last release and dispose invoke every cleanup and stop once despite throws", () => {
  const configs = [
    { throwSnapshotCleanup: true }, { throwEffectCleanup: true }, { throwStop: true },
    { throwSnapshotCleanup: true, throwEffectCleanup: true, throwStop: true },
  ];
  for (const config of configs) {
    const created = [];
    const registry = new SessionRegistry({ createClient() { const client = new FakeClient(config); created.push(client); return client; } });
    const handle = registry.acquire("session", { ownership: "visible" });
    assert.doesNotThrow(() => handle.release());
    assert.equal(created[0].snapshotCleanupCalls, 1);
    assert.equal(created[0].effectCleanupCalls, 1);
    assert.equal(created[0].stopCalls, 1);
    const replacement = registry.acquire("session", { ownership: "retained_hidden" });
    assert.equal(created.length, 2);
    assert.doesNotThrow(() => registry.dispose());
    assert.equal(created[1].snapshotCleanupCalls, 1);
    assert.equal(created[1].effectCleanupCalls, 1);
    assert.equal(created[1].stopCalls, 1);
    replacement.release();
  }
});

test("dispose continues across entries when every cleanup and stop of an earlier entry throws", () => {
  const created = [];
  const registry = new SessionRegistry({
    createClient(id) {
      const client = new FakeClient(id === "one" ? { throwSnapshotCleanup: true, throwEffectCleanup: true, throwStop: true } : {});
      created.push(client);
      return client;
    },
  });
  registry.acquire("one", { ownership: "visible" });
  registry.acquire("two", { ownership: "retained_hidden" });
  assert.doesNotThrow(() => registry.dispose());
  for (const client of created) {
    assert.equal(client.snapshotCleanupCalls, 1);
    assert.equal(client.effectCleanupCalls, 1);
    assert.equal(client.stopCalls, 1);
  }
});

test("diagnostics expose aggregate visible, retained-hidden, and entry classes without IDs", () => {
  const diagnostics = [], created = [];
  const registry = new SessionRegistry({
    createClient(id) { const client = new FakeClient(); created.push({ id, client }); return client; },
    diagnostic(entry) { diagnostics.push(entry); },
  });
  const visibleOne = registry.acquire("private-session-id", { ownership: "visible" });
  const visibleTwo = registry.acquire("private-session-id", { ownership: "visible" });
  const hidden = registry.acquire("other-private-id", { ownership: "retained_hidden" });
  visibleOne.updateOwnership("retained_hidden"); visibleTwo.release(); hidden.release(); visibleOne.release(); registry.dispose();
  for (const entry of diagnostics) {
    assert.deepEqual(Object.keys(entry).sort().filter((key) => key.endsWith("Count")), ["entryCount", "retainedHiddenCount", "visibleCount"]);
    assert.ok([entry.entryCount, entry.visibleCount, entry.retainedHiddenCount].every((value) => ["zero", "one", "many"].includes(value)));
  }
  assert.ok(diagnostics.some((entry) => entry.entryCount === "many" && entry.visibleCount === "many" && entry.retainedHiddenCount === "one"));
  assert.ok(diagnostics.some((entry) => entry.entryCount === "zero" && entry.visibleCount === "zero" && entry.retainedHiddenCount === "zero"));
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-session-id|other-private-id/);
});
