import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const reducer = await jiti.import("./session-reducer.ts");
const { createSnapshotTransfer } = await jiti.import("./session-event-hub.ts");
const { SessionStreamState } = await jiti.import("./session-stream-state.ts");

const ready = (outcome, streamEpoch, cursor, serverInstanceId = "server") => ({
  protocol: "pi-web-session-transport", version: 1, type: "ready",
  serverInstanceId, streamEpoch, cursor, outcome,
});
const logical = (epoch, sequence, type, values = {}) => ({
  protocol: protocol.PROJECTED_SESSION_PROTOCOL,
  version: protocol.PROJECTED_SESSION_VERSION,
  streamEpoch: epoch,
  sequence,
  type,
  ...values,
});
function applyAll(stream, units) {
  return units.map((unit) => stream.applyUnit(unit));
}
function initialize(epoch = "epoch", cursor = 0, state = protocol.createInitialProjectedSessionState()) {
  const stream = new SessionStreamState();
  stream.beginAttempt();
  assert.equal(stream.acceptReady(ready("initial_snapshot", epoch, cursor)).outcome, "accepted");
  const results = applyAll(stream, createSnapshotTransfer(epoch, cursor, "initial", state, 512, "initial-transfer"));
  assert.equal(results.at(-1).targetReached, true);
  assert.equal(stream.getSnapshot().phase, "live");
  return stream;
}

test("ready is target-only and all six outcomes enforce the complete held relation", () => {
  const freshState = protocol.createInitialProjectedSessionState();
  const initial = new SessionStreamState();
  const initialIdentity = initial.getSnapshot().state;
  initial.beginAttempt();
  const selected = initial.acceptReady(ready("initial_snapshot", "epoch", 0));
  assert.equal(selected.targetReached, false);
  assert.strictEqual(initial.getSnapshot().state, initialIdentity);
  assert.equal(initial.getSnapshot().phase, "recovering");
  applyAll(initial, createSnapshotTransfer("epoch", 0, "initial", freshState, 512, "initial"));
  assert.equal(initial.getSnapshot().phase, "live");

  for (const outcome of ["empty", "exact", "overflow_snapshot", "wrong_epoch", "invalid_cursor"]) {
    const fresh = new SessionStreamState();
    fresh.beginAttempt();
    assert.equal(fresh.acceptReady(ready(outcome, "epoch", outcome === "invalid_cursor" ? 0 : 1)).outcome, "fault", outcome);
    assert.equal(fresh.getSnapshot().phase, "idle");
    assert.equal(fresh.getCommittedReceiver().assembly, null);
  }

  const cases = [
    { outcome: "empty", readyEpoch: "epoch", readyCursor: 3, reached: true },
    { outcome: "exact", readyEpoch: "epoch", readyCursor: 4, reached: false },
    { outcome: "overflow_snapshot", readyEpoch: "epoch", readyCursor: 4, reached: false, reason: "recovery" },
    { outcome: "wrong_epoch", readyEpoch: "new-epoch", readyCursor: 2, reached: false, reason: "recovery" },
    { outcome: "invalid_cursor", readyEpoch: "epoch", readyCursor: 2, reached: false, reason: "recovery" },
  ];
  for (const fixture of cases) {
    const stream = initialize();
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      stream.applyUnit(logical("epoch", sequence, "native_settled"));
    }
    const held = stream.getSnapshot();
    stream.resetConnection(); stream.beginAttempt();
    const result = stream.acceptReady(ready(fixture.outcome, fixture.readyEpoch, fixture.readyCursor));
    assert.equal(result.outcome, "accepted", fixture.outcome);
    assert.equal(result.targetReached, fixture.reached, fixture.outcome);
    assert.strictEqual(stream.getSnapshot().state, held.state);
    if (fixture.reason) {
      const units = createSnapshotTransfer(fixture.readyEpoch, fixture.readyCursor, fixture.reason, freshState, 512, `recovery-${fixture.outcome}`);
      const applied = applyAll(stream, units);
      assert.equal(applied.at(-1).targetReached, true);
      assert.equal(stream.getSnapshot().streamEpoch, fixture.readyEpoch);
      assert.equal(stream.getSnapshot().cursor, fixture.readyCursor);
    } else if (fixture.outcome === "exact") {
      assert.equal(stream.applyUnit(logical("epoch", 4, "native_settled")).targetReached, true);
    }
  }

  const impossible = [
    ["wrong_epoch", "epoch", 3],
    ["overflow_snapshot", "other", 4],
    ["overflow_snapshot", "epoch", 3],
    ["overflow_snapshot", "epoch", 2],
    ["invalid_cursor", "other", 2],
    ["invalid_cursor", "epoch", 3],
    ["invalid_cursor", "epoch", 4],
    ["initial_snapshot", "other", 0],
  ];
  for (const [outcome, epoch, cursor] of impossible) {
    const stream = initialize();
    for (let sequence = 1; sequence <= 3; sequence += 1) stream.applyUnit(logical("epoch", sequence, "native_settled"));
    stream.resetConnection(); stream.beginAttempt();
    assert.equal(stream.acceptReady(ready(outcome, epoch, cursor)).outcome, "fault", `${outcome}:${epoch}:${cursor}`);
    assert.equal(stream.getSnapshot().phase, "idle");
  }
});

test("exact catch-up reaches its selected target before post-target live units and accepts retained final snapshots", () => {
  const stream = initialize("epoch", 0);
  stream.resetConnection(); stream.beginAttempt();
  assert.equal(stream.acceptReady(ready("exact", "epoch", 3)).targetReached, false);
  assert.equal(stream.applyUnit(logical("epoch", 1, "activity_started", { activity: "prompt" })).targetReached, false);
  const settled = stream.applyUnit(logical("epoch", 2, "run_settled"));
  assert.equal(settled.targetReached, false);
  const finalState = reducer.reduceProjectedSessionFrame(stream.getSnapshot().state, { type: "runtime_refresh_required" }).state;
  const finalUnits = createSnapshotTransfer("epoch", 3, "final", finalState, 512, "final-transfer");
  const finalResults = applyAll(stream, finalUnits);
  assert.equal(finalResults.at(-1).targetReached, true);
  assert.equal(stream.getSnapshot().phase, "live");
  assert.equal(stream.getSnapshot().cursor, 3);
  const postTarget = stream.applyUnit(logical("epoch", 4, "native_settled"));
  assert.equal(postTarget.outcome, "accepted");
  assert.equal(stream.getSnapshot().cursor, 4);
});

test("snapshot reason, epoch, phase, and sequence matrix fails closed above the receiver", () => {
  const fixtures = [
    { outcome: "initial_snapshot", epoch: "initial-epoch", cursor: 0, required: "initial", create: () => new SessionStreamState() },
    { outcome: "overflow_snapshot", epoch: "epoch", cursor: 2, required: "recovery", create: () => initialize() },
    { outcome: "wrong_epoch", epoch: "recovery-epoch", cursor: 2, required: "recovery", create: () => initialize() },
  ];
  fixtures.push({ outcome: "invalid_cursor", epoch: "epoch", cursor: 1, required: "recovery", create: () => {
    const stream = initialize();
    stream.applyUnit(logical("epoch", 1, "native_settled"));
    stream.applyUnit(logical("epoch", 2, "native_settled"));
    return stream;
  } });

  for (const fixture of fixtures) {
    for (const wrong of ["initial", "recovery", "final"].filter((reason) => reason !== fixture.required)) {
      const stream = fixture.create();
      stream.resetConnection(); stream.beginAttempt();
      assert.equal(stream.acceptReady(ready(fixture.outcome, fixture.epoch, fixture.cursor)).outcome, "accepted");
      const start = createSnapshotTransfer(fixture.epoch, fixture.cursor, wrong, protocol.createInitialProjectedSessionState(), 512, `wrong-${fixture.outcome}-${wrong}`)[0];
      assert.equal(stream.applyUnit(start).fault, "snapshot_invalid", `${fixture.outcome} rejects ${wrong}`);
      assert.equal(stream.getCommittedReceiver().assembly, null);
      assert.equal(stream.getSnapshot().phase, "idle");
    }
  }

  const liveStarts = [
    ["epoch", 1, "initial"], ["epoch", 1, "recovery"], ["new-epoch", 1, "final"], ["epoch", 2, "final"],
  ];
  for (const [epoch, sequence, reason] of liveStarts) {
    const live = initialize();
    const start = createSnapshotTransfer(epoch, sequence, reason, live.getSnapshot().state, 512, `live-${epoch}-${sequence}-${reason}`)[0];
    assert.equal(live.applyUnit(start).outcome, "fault");
    assert.equal(live.getCommittedReceiver().assembly, null);
  }
  const live = initialize();
  assert.equal(live.applyUnit(createSnapshotTransfer("epoch", 1, "final", live.getSnapshot().state, 512, "live-final")[0]).outcome, "accepted");
});

test("interrupted assembly and faults resume only the last committed pair without partial state visibility", () => {
  const stream = initialize("epoch", 0);
  stream.applyUnit(logical("epoch", 1, "extension_status_set", { key: "held", text: "old" }));
  const committed = stream.getSnapshot();
  const replacement = protocol.createInitialProjectedSessionState({ steering: ["replacement"] });
  stream.resetConnection(); stream.beginAttempt();
  stream.acceptReady(ready("overflow_snapshot", "new-epoch", 7));
  const units = createSnapshotTransfer("new-epoch", 7, "recovery", replacement, 400, "interrupted");
  stream.applyUnit(units[0]);
  stream.applyUnit(units[1]);
  assert.strictEqual(stream.getSnapshot().state, committed.state);
  assert.equal(stream.getSnapshot().streamEpoch, "epoch");
  assert.equal(stream.getSnapshot().cursor, 1);
  stream.resetConnection();
  assert.equal(stream.getCommittedReceiver().assembly, null);
  assert.equal(stream.getCommittedReceiver().cursor, 1);

  stream.beginAttempt();
  assert.equal(stream.acceptReady(ready("empty", "epoch", 2)).fault, "cursor_gap");
  stream.resetConnection(); stream.beginAttempt();
  stream.acceptReady(ready("exact", "epoch", 3));
  assert.equal(stream.applyUnit(logical("epoch", 3, "native_settled")).fault, "cursor_gap");
  assert.equal(stream.getCommittedReceiver().cursor, 1);
});

test("disconnect at every recovery snapshot phase discards the candidate without visibility", () => {
  for (const phase of ["ready", "start", "chunk", "before_end"]) {
    const stream = initialize();
    stream.applyUnit(logical("epoch", 1, "native_settled"));
    const committed = stream.getSnapshot();
    stream.resetConnection(); stream.beginAttempt();
    assert.equal(stream.acceptReady(ready("overflow_snapshot", "epoch", 4)).outcome, "accepted");
    const units = createSnapshotTransfer("epoch", 4, "recovery", protocol.createInitialProjectedSessionState({ steering: ["new"] }), 400, `disconnect-${phase}`);
    if (phase !== "ready") stream.applyUnit(units[0]);
    if (phase === "chunk") stream.applyUnit(units[1]);
    if (phase === "before_end") for (const unit of units.slice(1, -1)) stream.applyUnit(unit);
    assert.strictEqual(stream.getSnapshot().state, committed.state, phase);
    assert.equal(stream.getSnapshot().cursor, committed.cursor, phase);
    stream.resetConnection();
    assert.equal(stream.getCommittedReceiver().assembly, null, phase);
    assert.equal(stream.getSnapshot().cursor, committed.cursor, phase);
  }
});

test("every snapshot transfer fault discards its candidate and preserves committed visibility", () => {
  const mutations = [
    { name: "zero start part count", mutate(units) { return [{ ...units[0], partCount: 0 }]; } },
    { name: "zero start byte length", mutate(units) { return [{ ...units[0], byteLength: 0 }]; } },
    { name: "duplicate start", mutate(units) { return [units[0], units[0]]; } },
    { name: "wrong chunk transfer", mutate(units) { return [units[0], { ...units[1], transferId: "wrong-transfer" }]; } },
    { name: "wrong chunk epoch", mutate(units) { return [units[0], { ...units[1], streamEpoch: "wrong" }]; } },
    { name: "wrong chunk sequence", mutate(units) { return [units[0], { ...units[1], sequence: 3 }]; } },
    { name: "wrong chunk order", mutate(units) { return [units[0], { ...units[1], partIndex: 1 }]; } },
    { name: "empty chunk", mutate(units) { return [units[0], { ...units[1], data: "" }]; } },
    { name: "invalid base64", mutate(units) { return [units[0], { ...units[1], data: "!" }]; } },
    { name: "premature end", mutate(units) { return [units[0], units.at(-1)]; } },
    { name: "wrong end transfer", mutate(units) { return [...units.slice(0, -1), { ...units.at(-1), transferId: "wrong-transfer" }]; } },
    { name: "wrong end epoch", mutate(units) { return [...units.slice(0, -1), { ...units.at(-1), streamEpoch: "wrong" }]; } },
    { name: "wrong end sequence", mutate(units) { return [...units.slice(0, -1), { ...units.at(-1), sequence: 3 }]; } },
    { name: "excess end field", mutate(units) { return [...units.slice(0, -1), { ...units.at(-1), extra: true }]; } },
    { name: "interleaved logical", mutate(units) { return [units[0], logical("epoch", 2, "native_settled")]; } },
  ];
  for (const fixture of mutations) {
    const stream = initialize();
    stream.applyUnit(logical("epoch", 1, "native_settled"));
    const committed = stream.getSnapshot();
    stream.resetConnection(); stream.beginAttempt();
    stream.acceptReady(ready("overflow_snapshot", "epoch", 4));
    const units = createSnapshotTransfer("epoch", 4, "recovery", protocol.createInitialProjectedSessionState({ steering: ["replacement"] }), 400, `fault-${fixture.name}`);
    const driven = fixture.mutate(units);
    let result;
    for (const unit of driven) {
      result = stream.applyUnit(unit);
      if (result.outcome === "fault") break;
    }
    assert.equal(result.outcome, "fault", fixture.name);
    assert.strictEqual(stream.getSnapshot().state, committed.state, fixture.name);
    assert.equal(stream.getSnapshot().cursor, committed.cursor, fixture.name);
    assert.equal(stream.getCommittedReceiver().assembly, null, fixture.name);
    assert.equal(stream.getSnapshot().phase, "idle", fixture.name);
  }
});

test("complete duplicate final snapshots validate without revision, effects, or partial visibility", () => {
  const stream = initialize();
  const finalState = protocol.createInitialProjectedSessionState({ steering: ["final"] });
  const final = createSnapshotTransfer("epoch", 1, "final", finalState, 400, "duplicate-final");
  assert.equal(applyAll(stream, final).at(-1).outcome, "accepted");
  const committed = stream.getSnapshot();
  const duplicates = applyAll(stream, final);
  assert.ok(duplicates.slice(0, -1).every((item) => item.changed === false && item.effect === undefined));
  assert.equal(duplicates.at(-1).outcome, "duplicate");
  assert.strictEqual(stream.getSnapshot(), committed);
  assert.deepEqual(stream.getSnapshot().state, finalState);
});

test("logical effects are sequence-addressed once while duplicates and snapshots create none", () => {
  const stream = initialize();
  const notice = logical("epoch", 1, "notice", { level: "info", message: "synthetic" });
  const first = stream.applyUnit(notice);
  assert.equal(first.effect.type, "notice");
  assert.equal(first.sequence, 1);
  assert.equal(stream.getSnapshot().cursor, 1);
  const repeated = stream.applyUnit(notice);
  assert.equal(repeated.outcome, "duplicate");
  assert.equal(repeated.effect, undefined);
  const final = createSnapshotTransfer("epoch", 2, "final", stream.getSnapshot().state, 512, "no-effect");
  assert.ok(applyAll(stream, final).every((item) => item.effect === undefined));
  assert.ok(Object.isFrozen(stream.getSnapshot().state));
});
