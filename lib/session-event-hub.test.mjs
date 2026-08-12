import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const reducer = await jiti.import("./session-reducer.ts");
const hubModule = await jiti.import("./session-event-hub.ts");

function assistant(text) {
  return { role: "assistant", provider: "fixture", model: "fixture", content: [{ type: "text", text }] };
}
function receive(units, initial = reducer.createSessionReceiver()) {
  let receiver = initial;
  for (const unit of units) {
    const result = reducer.applyProjectedSessionUnit(receiver, unit);
    assert.notEqual(result.outcome, "invalid");
    assert.notEqual(result.outcome, "gap");
    receiver = result.receiver;
  }
  return receiver;
}

test("sequence advances with zero subscribers and one multi-frame input is contiguous", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch" });
  hub.accept({ type: "agent_start" });
  hub.accept({ type: "message_end", message: { role: "branchSummary", summary: "private", fromId: "private" } });
  assert.equal(hub.cursor, 3);
  assert.equal(hub.getState().active, true);
  assert.equal(hub.getState().transcriptRevision, 1);
  const replay = hub.replayAfter("epoch", 0);
  assert.equal(replay.outcome, "exact");
  assert.deepEqual(replay.units.map((unit) => unit.sequence), [1, 2, 3]);
  assert.deepEqual(replay.units.map((unit) => unit.type), ["activity_started", "transcript_changed", "runtime_refresh_required"]);
});

test("multiple subscribers receive identical order, listener failures isolate, and attach has no gap", () => {
  const diagnostics = [];
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", diagnostic: (entry) => diagnostics.push(entry) });
  const one = [], two = [];
  hub.attach("epoch", 0, (unit) => one.push(unit.sequence));
  hub.attach("epoch", 0, (unit) => two.push(unit.sequence));
  hub.attach("epoch", 0, () => { throw new Error("listener private payload"); });
  hub.accept({ type: "agent_start" });
  hub.accept({ type: "agent_settled" });
  assert.deepEqual(one, [1, 2]);
  assert.deepEqual(two, [1, 2]);
  assert.ok(diagnostics.some((entry) => entry.kind === "listener" && entry.outcome === "threw"));
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|epoch/);

  const seen = [];
  const attached = hub.attach("epoch", 1, (unit) => seen.push(unit.sequence));
  assert.equal(attached.outcome, "exact");
  assert.deepEqual(attached.units.map((unit) => unit.sequence), [2]);
  hub.accept({ type: "entry_appended", entry: { private: true } });
  assert.deepEqual(seen, [3]);
  attached.unsubscribe();
});

test("validated frames are deeply immutable across listeners and retained replay", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch" });
  const observed = [];
  hub.attach("epoch", 0, (unit) => {
    assert.throws(() => { unit.type = "notice"; }, TypeError);
    if (unit.message?.content) assert.throws(() => { unit.message.content[0].text = "mutated"; }, TypeError);
  });
  hub.attach("epoch", 0, (unit) => observed.push(unit));
  hub.accept({ type: "message_end", message: assistant("original") });
  assert.equal(observed[0].type, "message_completed");
  assert.equal(observed[0].message.content[0].text, "original");
  const replay = hub.replayAfter("epoch", 0);
  assert.equal(replay.units[0].message.content[0].text, "original");
  assert.throws(() => { replay.units[0].raw = { private: true }; }, TypeError);
});

test("atomic attach buffers diagnostic reentrancy behind selected catch-up", () => {
  let hub;
  let reentered = false;
  hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "epoch",
    diagnostic(entry) {
      if (!reentered && entry.kind === "replay") {
        reentered = true;
        hub.accept({ type: "entry_appended", entry: { private: true } });
      }
    },
  });
  hub.accept({ type: "agent_start" });
  const live = [];
  const attached = hub.attach("epoch", 0, (unit) => live.push(unit.sequence));
  assert.deepEqual(attached.units.map((unit) => unit.sequence), [1, 2]);
  assert.deepEqual(live, [], "reentrant frame is returned after catch-up, not delivered early");
  hub.accept({ type: "agent_settled" });
  assert.deepEqual(live, [3]);
});

test("reentrant attach preserves every selected target while appending later live units", () => {
  const cases = [
    { outcome: "empty", seed: 1, resumeEpoch: "epoch", resumeCursor: 1 },
    { outcome: "initial_snapshot", seed: 1, resumeEpoch: null, resumeCursor: null },
    { outcome: "wrong_epoch", seed: 1, resumeEpoch: "wrong", resumeCursor: 0 },
    { outcome: "invalid_cursor", seed: 1, resumeEpoch: "epoch", resumeCursor: 99 },
    { outcome: "exact", seed: 2, resumeEpoch: "epoch", resumeCursor: 0 },
    { outcome: "overflow_snapshot", seed: 4, resumeEpoch: "epoch", resumeCursor: 0, replayUnitLimit: 1 },
  ];
  for (const fixture of cases) {
    let hub;
    let reentered = false;
    hub = new hubModule.ProjectedSessionEventHub({
      streamEpoch: "epoch",
      replayUnitLimit: fixture.replayUnitLimit ?? 100,
      replayByteLimit: 100_000,
      encodedUnitByteLimit: 400,
      diagnostic(entry) {
        if (!reentered && entry.kind === "replay") {
          reentered = true;
          hub.accept({ type: "entry_appended", entry: { synthetic: true } });
        }
      },
    });
    for (let index = 0; index < fixture.seed; index += 1) hub.accept({ type: "agent_settled" });
    const selectedCursor = hub.cursor;
    const attached = hub.attach(fixture.resumeEpoch, fixture.resumeCursor, () => {});
    assert.equal(attached.outcome, fixture.outcome);
    assert.equal(attached.cursor, selectedCursor, `${fixture.outcome} selected cursor is immutable`);
    assert.equal(attached.streamEpoch, "epoch");
    assert.equal(hub.cursor, selectedCursor + 1);
    assert.equal(attached.units.at(-1).sequence, selectedCursor + 1, `${fixture.outcome} buffered unit is post-target`);
    const selectedUnits = attached.units.slice(0, -1);
    if (["initial_snapshot", "wrong_epoch", "invalid_cursor", "overflow_snapshot"].includes(fixture.outcome)) {
      assert.equal(selectedUnits[0].type, "snapshot_start");
      assert.equal(selectedUnits.at(-1).type, "snapshot_end");
      assert.ok(selectedUnits.every((unit) => unit.sequence === selectedCursor));
    } else if (fixture.outcome === "empty") {
      assert.equal(selectedUnits.length, 0);
    } else {
      assert.ok(selectedUnits.length > 0 && selectedUnits.every((unit) => unit.sequence <= selectedCursor));
    }
    attached.unsubscribe();
  }
});

test("listener and diagnostic reentrancy serialize whole ordinary and final snapshot groups", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 100_000, replayUnitLimit: 1_000, encodedUnitByteLimit: 400 });
  const one = [], two = [];
  let nestedOrdinary = false;
  let nestedFinal = false;
  hub.attach("epoch", 0, (unit) => {
    one.push([unit.sequence, unit.type]);
    if (!nestedOrdinary && unit.type === "transcript_changed") {
      nestedOrdinary = true;
      hub.accept({ type: "entry_appended", entry: { private: true } });
    }
    if (!nestedFinal && unit.type === "snapshot_chunk") {
      nestedFinal = true;
      hub.accept({ type: "agent_start" });
    }
  });
  hub.attach("epoch", 0, (unit) => two.push([unit.sequence, unit.type]));

  hub.accept({ type: "message_end", message: { role: "branchSummary", summary: "private", fromId: "private" } });
  assert.deepEqual(one, two);
  assert.deepEqual(one.map((entry) => entry[1]), ["transcript_changed", "runtime_refresh_required", "transcript_changed"]);
  assert.deepEqual(one.map((entry) => entry[0]), [1, 2, 3]);

  hub.accept({ type: "wrapper_settled" });
  assert.deepEqual(one, two);
  const finalStart = one.findIndex((entry) => entry[1] === "snapshot_start");
  const finalEnd = one.findIndex((entry, index) => index > finalStart && entry[1] === "snapshot_end");
  const nestedStart = one.findIndex((entry, index) => index > finalStart && entry[1] === "activity_started");
  assert.ok(finalStart >= 0 && finalEnd > finalStart && nestedStart > finalEnd, JSON.stringify(one));
  assert.ok(one.slice(finalStart, finalEnd + 1).every((entry) => entry[0] === one[finalStart][0]));
  const replay = hub.replayAfter("epoch", 0);
  assert.deepEqual(replay.units.map((unit) => [unit.sequence, unit.type]), one);
});

test("malformed known input and invalid candidate frames cannot mutate cursor, floor, replay, or state", () => {
  const diagnostics = [];
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", diagnostic: (entry) => diagnostics.push(entry) });
  hub.accept({ type: "message_start", message: assistant("safe") });
  const before = { cursor: hub.cursor, floor: hub.floor, occupancy: hub.getReplayOccupancy(), state: hub.getState() };
  let getterCalls = 0;
  const getterToolCall = { type: "toolCall", id: "id", name: "tool" };
  Object.defineProperty(getterToolCall, "arguments", { enumerable: true, get() { getterCalls += 1; return { private: true }; } });
  for (const input of [
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: -1, delta: "private", partial: assistant("private") } },
    { type: "queue_update", steering: ["safe"], followUp: [1] },
    { type: "extension_ui_request", method: "setWidget", widgetKey: "key", widgetLines: [1] },
    { type: "message_end", message: { role: "custom", customType: "x", content: "safe", display: true, details: { bad: Infinity } } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: getterToolCall, partial: assistant("") } },
  ]) hub.accept(input);
  assert.equal(getterCalls, 0);
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.deepEqual(hub.getReplayOccupancy(), before.occupancy);
  assert.deepEqual(hub.getState(), before.state);
  assert.ok(diagnostics.filter((entry) => entry.kind === "input" && entry.outcome === "malformed").length >= 4);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|widgetLines|followUp/);
});

test("throwing and reentrant diagnostics cannot interrupt projection, listeners, replay, or close", () => {
  let hub;
  let reentered = false;
  let replayReentered = false;
  const seen = [];
  hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "epoch",
    diagnostic(entry) {
      if (!reentered && entry.kind === "frame") {
        reentered = true;
        hub.accept({ type: "entry_appended", entry: { private: true } });
        replayReentered = hub.replayAfter("epoch", 0).outcome === "exact";
      }
      throw new Error("private diagnostic payload");
    },
  });
  hub.attach("epoch", 0, (unit) => seen.push(unit.type));
  assert.doesNotThrow(() => hub.accept({ type: "message_end", message: { role: "branchSummary", summary: "private" } }));
  assert.deepEqual(seen, ["transcript_changed", "runtime_refresh_required", "transcript_changed"]);
  assert.equal(replayReentered, true);
  assert.doesNotThrow(() => hub.replayAfter("epoch", 0));
  assert.doesNotThrow(() => hub.close());
  assert.equal(hub.isClosed(), true);
  assert.equal(hub.close(), false);
});

test("diagnostics expose only finite frame, byte, replay, finality, and equality classes", () => {
  const diagnostics = [];
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "private-epoch", diagnostic: (entry) => diagnostics.push(entry), encodedUnitByteLimit: 400 });
  hub.accept({ type: "wrapper_activity_started", activity: "prompt" });
  hub.accept({ type: "message_start", message: assistant("") });
  hub.accept({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: assistant("") } });
  hub.accept({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "private-content", partial: assistant("private-content") } });
  hub.accept({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "private-content", partial: assistant("private-content") } });
  hub.accept({ type: "message_end", message: assistant("private-content") });
  hub.accept({ type: "wrapper_settled" });
  hub.replayAfter(hub.streamEpoch, hub.cursor);
  assert.ok(diagnostics.some((entry) => entry.kind === "frame" && entry.frameType === "content_delta" && ["small", "medium", "large", "oversized"].includes(entry.byteClass)));
  assert.ok(diagnostics.some((entry) => entry.kind === "frame" && entry.frameType === "snapshot_start" && entry.finality === "final_snapshot"));
  assert.ok(diagnostics.some((entry) => entry.kind === "replay" && entry.outcome === "empty"));
  assert.ok(diagnostics.some((entry) => entry.kind === "final_equality" && entry.outcome === "equal"));
  const encoded = JSON.stringify(diagnostics);
  assert.doesNotMatch(encoded, /private-content|private-epoch|fixture|model|provider|toolCallId|streamEpoch/);
});

test("frame-count and UTF-8 byte eviction preserve exact contiguous suffixes and bounds", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 900, replayUnitLimit: 3, encodedUnitByteLimit: 512 });
  for (let index = 0; index < 8; index += 1) hub.accept({ type: "entry_appended", entry: { private: index } });
  const occupancy = hub.getReplayOccupancy();
  assert.ok(occupancy.units <= 3);
  assert.ok(occupancy.bytes <= 900);
  assert.ok(occupancy.floor >= 5);
  assert.equal(hub.replayAfter("epoch", occupancy.floor).outcome, "exact");
  assert.equal(hub.replayAfter("epoch", occupancy.floor - 1).outcome, "overflow_snapshot");
  assert.equal(hub.replayAfter("wrong", hub.cursor).outcome, "wrong_epoch");
  assert.equal(hub.replayAfter("epoch", hub.cursor + 1).outcome, "invalid_cursor");
  assert.equal(hub.replayAfter("epoch", hub.cursor).outcome, "empty");
});

test("ordinary logical frames may exceed the snapshot-unit ceiling, apply live, and recover through bounded snapshot units", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 300, replayUnitLimit: 10, encodedUnitByteLimit: 512 });
  const seen = [];
  let liveReceiver = reducer.createSessionReceiver(undefined, { encodedUnitByteLimit: 512 });
  hub.attach("epoch", 0, (unit) => {
    seen.push(unit);
    const applied = reducer.applyProjectedSessionUnit(liveReceiver, unit);
    assert.equal(applied.outcome, "applied");
    liveReceiver = applied.receiver;
  });
  const lines = ["雪".repeat(200)];
  hub.accept({ type: "extension_ui_request", id: "durable", method: "custom", lines });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "extension_custom_replaced");
  assert.ok(Buffer.byteLength(protocol.encodeProjectedSessionFrame(seen[0])) > 512, "ordinary frames are not snapshot transfer units");
  assert.deepEqual(liveReceiver.state, hub.getState());
  assert.equal(hub.floor, 1);
  assert.equal(hub.getReplayOccupancy().units, 0);

  const recovery = hub.replayAfter("epoch", 0);
  assert.equal(recovery.outcome, "overflow_snapshot");
  recovery.units.forEach((unit) => assert.ok(Buffer.byteLength(protocol.encodeProjectedSessionFrame(unit)) <= 512));
  const recovered = receive(recovery.units, reducer.createSessionReceiver(undefined, { encodedUnitByteLimit: 512 }));
  assert.deepEqual(recovered.state, hub.getState());
  assert.equal(hub.replayAfter("epoch", 1).outcome, "empty");
});

test("oversized durable state is represented without truncation by bounded initial/recovery chunks without mutating replay eligibility", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 700, replayUnitLimit: 8, encodedUnitByteLimit: 400 });
  const lines = ["雪🙂".repeat(600)];
  hub.accept({ type: "extension_ui_request", id: "id", method: "custom", lines });
  const before = hub.getReplayOccupancy();
  const initial = hub.snapshot("initial");
  const recovery = hub.snapshot("recovery");
  assert.ok(initial.length > 3);
  assert.ok(recovery.length > 3);
  [...initial, ...recovery].forEach((unit) => assert.ok(Buffer.byteLength(protocol.encodeProjectedSessionFrame(unit)) <= 400));
  assert.deepEqual(hub.getReplayOccupancy(), before);
  assert.deepEqual(receive(initial).state.customUis, [{ id: "id", lines }]);
  assert.deepEqual(receive(recovery).state.customUis, [{ id: "id", lines }]);
});

test("final snapshot is one logical sequence/group and oversized final has exact before-versus-after floor semantics", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 900, replayUnitLimit: 5, encodedUnitByteLimit: 400 });
  for (let index = 0; index < 5; index += 1) {
    hub.accept({ type: "extension_ui_request", id: `s${index}`, method: "setStatus", statusKey: `k${index}`, statusText: "v".repeat(80) });
  }
  hub.accept({ type: "wrapper_activity_started", activity: "prompt" });
  const immediatelyBefore = hub.cursor;
  const live = [];
  hub.attach("epoch", immediatelyBefore, (unit) => live.push(unit));
  hub.accept({ type: "wrapper_settled" });
  const finalSequence = hub.cursor;
  assert.equal(finalSequence, immediatelyBefore + 2);
  assert.equal(live[0].type, "run_settled");
  const snapshotUnits = live.slice(1);
  assert.equal(snapshotUnits[0].type, "snapshot_start");
  assert.equal(snapshotUnits.at(-1).type, "snapshot_end");
  assert.ok(snapshotUnits.every((unit) => unit.sequence === finalSequence));
  assert.ok(snapshotUnits.every((unit) => Buffer.byteLength(protocol.encodeProjectedSessionFrame(unit)) <= 400));
  assert.equal(hub.floor, finalSequence, "unretained final group advances floor through its logical sequence");
  assert.equal(hub.replayAfter("epoch", immediatelyBefore).outcome, "overflow_snapshot");
  assert.equal(hub.replayAfter("epoch", finalSequence).outcome, "empty");
  const recovered = receive(hub.replayAfter("epoch", immediatelyBefore).units);
  assert.equal(recovered.cursor, finalSequence);
  assert.deepEqual(recovered.state, hub.getState());
});

test("retained final snapshot groups evict atomically and reduce to exact final canonical state", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 20_000, replayUnitLimit: 100, encodedUnitByteLimit: 512 });
  hub.accept({ type: "wrapper_activity_started", activity: "prompt" });
  hub.accept({ type: "message_start", message: assistant("done") });
  hub.accept({ type: "message_update", message: assistant("done"), assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: assistant("") } });
  hub.accept({ type: "message_update", message: assistant("done"), assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "done", partial: assistant("done") } });
  hub.accept({ type: "message_update", message: assistant("done"), assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "done", partial: assistant("done") } });
  hub.accept({ type: "message_end", message: assistant("done") });
  hub.accept({ type: "wrapper_settled" });
  const replay = hub.replayAfter("epoch", 0);
  assert.equal(replay.outcome, "exact");
  const finalStart = replay.units.findIndex((unit) => unit.type === "snapshot_start" && unit.reason === "final");
  assert.ok(finalStart > 0);
  const receiver = receive(replay.units);
  assert.equal(receiver.cursor, hub.cursor);
  assert.deepEqual(receiver.state, hub.getState());
  const occupancy = hub.getReplayOccupancy();
  assert.ok(occupancy.units <= 100 && occupancy.bytes <= 20_000);
});

function actualWireGrowth(kind, chunks) {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: `epoch-${kind}`, replayByteLimit: 100_000_000, replayUnitLimit: 100_000, encodedUnitByteLimit: 512 });
  const units = [];
  hub.attach(hub.streamEpoch, 0, (unit) => units.push(unit));
  const piece = "雪🙂";
  const contentIndex = 0;
  const partial = { role: "assistant", provider: "fixture", model: "fixture", content: [] };
  hub.accept({ type: "wrapper_activity_started", activity: "prompt" });
  hub.accept({ type: "message_start", message: partial });
  const startType = kind === "text" ? "text_start" : kind === "thinking" ? "thinking_start" : "toolcall_start";
  hub.accept({ type: "message_update", assistantMessageEvent: { type: startType, contentIndex, partial } });

  let growing = "";
  let legacyBytes = 0;
  if (kind === "tool") hub.accept({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex, delta: '{"value":"', partial } });
  for (let index = 0; index < chunks; index += 1) {
    growing += piece;
    const deltaType = kind === "text" ? "text_delta" : kind === "thinking" ? "thinking_delta" : "toolcall_delta";
    hub.accept({ type: "message_update", assistantMessageEvent: { type: deltaType, contentIndex, delta: piece, partial } });
    const legacyBlock = kind === "text"
      ? { type: "text", text: growing }
      : kind === "thinking"
        ? { type: "thinking", thinking: growing }
        : { type: "toolCall", id: "id", name: "tool", arguments: { value: growing } };
    legacyBytes += Buffer.byteLength(JSON.stringify({ type: "message_update", message: { ...partial, content: [legacyBlock] }, assistantMessageEvent: { type: deltaType, contentIndex, delta: piece, partial: { ...partial, content: [legacyBlock] } } }));
  }

  let final;
  let endEvent;
  if (kind === "text") {
    final = { ...partial, content: [{ type: "text", text: growing }] };
    endEvent = { type: "text_end", contentIndex, content: growing, partial };
  } else if (kind === "thinking") {
    final = { ...partial, content: [{ type: "thinking", thinking: growing }] };
    endEvent = { type: "thinking_end", contentIndex, content: growing, partial };
  } else {
    hub.accept({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex, delta: '"}', partial } });
    final = { ...partial, content: [{ type: "toolCall", toolCallId: "id", toolName: "tool", input: { value: growing } }] };
    endEvent = { type: "toolcall_end", contentIndex, toolCall: final.content[0], partial };
  }
  hub.accept({ type: "message_update", assistantMessageEvent: endEvent });
  hub.accept({ type: "message_end", message: final });
  hub.accept({ type: "wrapper_settled" });

  legacyBytes += Buffer.byteLength(JSON.stringify({ type: "agent_end", messages: [final] }));
  const projectedBytes = units.reduce((sum, unit) => sum + Buffer.byteLength(protocol.encodeProjectedSessionFrame(unit)), 0);
  assert.equal(units.filter((unit) => unit.type === "message_completed").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.ok(units.some((unit) => unit.type === "content_block_started"));
  assert.ok(units.some((unit) => unit.type === "content_block_finished"));
  const receiver = receive(units);
  assert.equal(receiver.cursor, hub.cursor);
  assert.deepEqual(receiver.state, hub.getState());
  return { legacyBytes, projectedBytes, unitCount: units.length };
}

test("actual projector-reducer-hub-encoder wire growth is linear for Unicode text, thinking, and tool arguments", () => {
  for (const kind of ["text", "thinking", "tool"]) {
    const small = actualWireGrowth(kind, 128);
    const large = actualWireGrowth(kind, 256);
    assert.ok(large.projectedBytes / small.projectedBytes < 2.3, `${kind} projected ${JSON.stringify({ small, large })}`);
    assert.ok(large.legacyBytes / small.legacyBytes > 3.2, `${kind} legacy ${JSON.stringify({ small, large })}`);
    assert.ok(large.projectedBytes * 2 < large.legacyBytes, `${kind} ${JSON.stringify({ small, large })}`);
    assert.ok(large.unitCount - small.unitCount >= 128, `${kind} exercises the per-delta optimized hub/reducer path`);
  }
});

test("aggregate state overflow rejects the whole input atomically and leaves every recovery/finality path usable", () => {
  const initial = protocol.createInitialProjectedSessionState();
  const first = reducer.reduceProjectedSessionFrame(initial, {
    type: "extension_custom_replaced", id: "one", lines: ["a"],
  }).state;
  let firstNodeCount = 1;
  while (!protocol.parseProjectedSessionState(first, { canonicalNodeLimit: firstNodeCount })) firstNodeCount += 1;

  const hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "aggregate",
    canonicalNodeLimit: firstNodeCount,
    snapshotByteLimit: 20_000,
    snapshotPartLimit: 100,
    encodedUnitByteLimit: 512,
  });
  const seen = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => seen.push(unit));
  hub.accept({ type: "extension_ui_request", id: "one", method: "custom", lines: ["a"] });
  assert.deepEqual(hub.getState().customUis, [{ id: "one", lines: ["a"] }]);
  const before = {
    cursor: hub.cursor,
    floor: hub.floor,
    state: hub.getState(),
    occupancy: hub.getReplayOccupancy(),
    seen: seen.length,
  };

  hub.accept({ type: "extension_ui_request", id: "two", method: "custom", lines: ["b"] });
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.deepEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.occupancy);
  assert.equal(seen.length, before.seen);

  const matchingReceiver = () => reducer.createSessionReceiver(undefined, {
    encodedUnitByteLimit: 512,
    canonicalNodeLimit: firstNodeCount,
    snapshotByteLimit: 20_000,
    snapshotPartLimit: 100,
  });
  assert.deepEqual(receive(hub.snapshot("initial"), matchingReceiver()).state, before.state);
  assert.deepEqual(receive(hub.snapshot("recovery"), matchingReceiver()).state, before.state);
  const recovered = hub.replayAfter("wrong", 0);
  assert.equal(recovered.outcome, "wrong_epoch");
  assert.deepEqual(receive(recovered.units, matchingReceiver()).state, before.state);

  hub.accept({ type: "wrapper_settled" });
  const final = hub.replayAfter(hub.streamEpoch, before.cursor);
  assert.equal(final.units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(final.units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.deepEqual(receive(final.units, { ...matchingReceiver(), streamEpoch: hub.streamEpoch, cursor: before.cursor, state: before.state }).state, hub.getState());
});

test("canonical node, UTF-8 snapshot byte, and snapshot part budgets accept exact boundaries and reject one over", () => {
  const state = protocol.createInitialProjectedSessionState({ steering: ["雪".repeat(120)], followUp: [] });
  const byteLength = Buffer.byteLength(JSON.stringify(state));
  let nodeCount = 1;
  while (!protocol.parseProjectedSessionState(state, { canonicalNodeLimit: nodeCount, snapshotByteLimit: byteLength })) nodeCount += 1;
  assert.ok(protocol.parseProjectedSessionState(state, { canonicalNodeLimit: nodeCount, snapshotByteLimit: byteLength }));
  assert.equal(protocol.parseProjectedSessionState(state, { canonicalNodeLimit: nodeCount - 1, snapshotByteLimit: byteLength }), null);
  assert.equal(protocol.parseProjectedSessionState(state, { canonicalNodeLimit: nodeCount, snapshotByteLimit: byteLength - 1 }), null);

  const units = hubModule.createSnapshotTransfer("boundary", 1, "recovery", state, 400, "boundary", {
    canonicalNodeLimit: nodeCount,
    snapshotByteLimit: byteLength,
    snapshotPartLimit: 1_000,
  });
  const partCount = units[0].partCount;
  assert.equal(units.filter((unit) => unit.type === "snapshot_chunk").length, partCount);
  assert.doesNotThrow(() => hubModule.createSnapshotTransfer("boundary", 1, "recovery", state, 400, "boundary", {
    canonicalNodeLimit: nodeCount,
    snapshotByteLimit: byteLength,
    snapshotPartLimit: partCount,
  }));
  assert.throws(() => hubModule.createSnapshotTransfer("boundary", 1, "recovery", state, 400, "boundary", {
    canonicalNodeLimit: nodeCount,
    snapshotByteLimit: byteLength,
    snapshotPartLimit: partCount - 1,
  }), /part_limit/);
});

test("incremental delta accounting matches exact UTF-8 state bytes, including split surrogate pairs", () => {
  const partial = { role: "assistant", provider: "fixture", model: "fixture", content: [] };
  let state = protocol.createInitialProjectedSessionState();
  state = reducer.reduceProjectedSessionFrame(state, { type: "assistant_message_started", metadata: { role: "assistant", provider: "fixture", model: "fixture" } }).state;
  state = reducer.reduceProjectedSessionFrame(state, { type: "content_block_started", contentIndex: 0, blockType: "text" }).state;
  state = reducer.reduceProjectedSessionFrame(state, { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "\ud83d" }).state;
  const highSurrogateBytes = Buffer.byteLength(JSON.stringify(state));
  state = reducer.reduceProjectedSessionFrame(state, { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "\ude42" }).state;
  const exactBytes = Buffer.byteLength(JSON.stringify(state));

  const drive = (snapshotByteLimit) => {
    const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: `delta-${snapshotByteLimit}`, snapshotByteLimit });
    hub.accept({ type: "message_start", message: partial });
    hub.accept({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0, partial } });
    const beforeHigh = hub.cursor;
    hub.accept({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "\ud83d", partial } });
    const before = hub.cursor;
    hub.accept({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "\ude42", partial } });
    return { hub, before, beforeHigh };
  };
  const accepted = drive(highSurrogateBytes);
  assert.equal(accepted.hub.cursor, accepted.before + 1);
  assert.equal(accepted.hub.getState().draft.blocks[0].text, "🙂");
  assert.equal(accepted.hub.snapshot()[0].byteLength, exactBytes);
  const rejected = drive(highSurrogateBytes - 1);
  assert.equal(rejected.hub.cursor, rejected.beforeHigh);
  assert.equal(rejected.hub.getState().draft.blocks[0].text, "");
});

test("multi-draft inputs make one aggregate precommit decision", () => {
  const probe = new hubModule.ProjectedSessionEventHub({ streamEpoch: "probe" });
  for (let index = 0; index < 9; index += 1) probe.accept({ type: "entry_appended", entry: {} });
  const byteLimit = Buffer.byteLength(JSON.stringify(probe.getState()));
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "multi", snapshotByteLimit: byteLimit });
  for (let index = 0; index < 9; index += 1) hub.accept({ type: "entry_appended", entry: {} });
  const before = { cursor: hub.cursor, state: hub.getState(), occupancy: hub.getReplayOccupancy() };
  const seen = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => seen.push(unit));
  hub.accept({ type: "message_end", message: { role: "branchSummary", summary: "private" } });
  assert.equal(hub.cursor, before.cursor);
  assert.deepEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.occupancy);
  assert.deepEqual(seen, []);
});

test("mandatory settlement headroom rejects earlier exact-limit growth and preserves canonical final replay", () => {
  const grow = { type: "extension_ui_request", id: "headroom", method: "setStatus", statusKey: "headroom", statusText: "x".repeat(128) };
  const probe = new hubModule.ProjectedSessionEventHub({ streamEpoch: "headroom" });
  probe.accept({ type: "agent_start" });
  probe.accept({ type: "agent_settled" });
  probe.accept(grow);
  const liveBytes = Buffer.byteLength(JSON.stringify(probe.getState()));
  probe.accept({ type: "wrapper_settled" });
  const settledBytes = Buffer.byteLength(JSON.stringify(probe.getState()));
  assert.equal(settledBytes, liveBytes + 1, "false is one UTF-8 byte larger than true at this boundary");

  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "headroom", snapshotByteLimit: liveBytes });
  hub.accept({ type: "agent_start" });
  hub.accept({ type: "agent_settled" });
  const beforeGrowth = {
    cursor: hub.cursor,
    floor: hub.floor,
    state: hub.getState(),
    occupancy: hub.getReplayOccupancy(),
  };
  hub.accept(grow);
  assert.equal(hub.cursor, beforeGrowth.cursor, "growth consuming mandatory finality reserve rejects atomically");
  assert.equal(hub.floor, beforeGrowth.floor);
  assert.strictEqual(hub.getState(), beforeGrowth.state);
  assert.deepEqual(hub.getReplayOccupancy(), beforeGrowth.occupancy);

  hub.accept({ type: "wrapper_settled" });
  const final = hub.replayAfter(hub.streamEpoch, beforeGrowth.cursor);
  assert.deepEqual(final.units.filter((unit) => unit.type === "run_settled").map((unit) => unit.sequence), [beforeGrowth.cursor + 1]);
  assert.equal(final.units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  const receiver = receive(hub.replayAfter(hub.streamEpoch, 0).units, reducer.createSessionReceiver(undefined, { snapshotByteLimit: liveBytes }));
  assert.equal(receiver.state.active, false);
  assert.deepEqual(receiver.state, hub.getState());
  assert.equal(receiver.cursor, hub.cursor);
});

test("prototype-key malformed inputs invoke no getter and mutate no hub stream surface", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "prototype" });
  const seen = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => seen.push(unit));
  let getterCalls = 0;
  const inheritedOuter = {};
  Object.defineProperty(inheritedOuter, "message", { enumerable: true, get() { getterCalls += 1; return { role: "branchSummary" }; } });
  const outer = { type: "message_end" };
  Object.defineProperty(outer, "__proto__", { value: inheritedOuter, enumerable: true });
  const inheritedNested = {};
  Object.defineProperty(inheritedNested, "role", { enumerable: true, get() { getterCalls += 1; return "branchSummary"; } });
  const nested = {};
  Object.defineProperty(nested, "__proto__", { value: inheritedNested, enumerable: true });
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), occupancy: hub.getReplayOccupancy() };
  hub.accept(outer);
  hub.accept({ type: "message_end", message: nested });
  assert.equal(getterCalls, 0);
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.strictEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.occupancy);
  assert.deepEqual(seen, []);
  assert.deepEqual(hub.replayAfter(hub.streamEpoch, before.cursor).units, []);
});

test("hub and receiver cache-key graphs and exposed snapshot assembly are deeply immutable", () => {
  const mutationThrows = (mutate) => assert.throws(mutate, TypeError);
  const sharedQueue = { steering: ["shared"], followUp: [] };
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "immutable", initialQueue: sharedQueue });
  const siblingHub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "immutable-sibling", initialQueue: sharedQueue });
  const sharedInput = { type: "extension_ui_request", id: "status", method: "setStatus", statusKey: "status", statusText: "value" };
  hub.accept(sharedInput);
  siblingHub.accept(sharedInput);
  sharedQueue.steering[0] = "caller mutation";
  sharedInput.statusText = "caller mutation";
  assert.deepEqual(hub.getState().queue.steering, ["shared"]);
  assert.deepEqual(siblingHub.getState().queue.steering, ["shared"]);
  assert.equal(hub.getState().statuses[0].text, "value");
  assert.equal(siblingHub.getState().statuses[0].text, "value");
  const hubState = hub.getState();
  assert.ok(Object.isFrozen(hubState) && Object.isFrozen(hubState.statuses) && Object.isFrozen(hubState.statuses[0]));
  mutationThrows(() => { hubState.statuses[0].text = "mutated"; });
  mutationThrows(() => { hubState.statuses.push({ key: "later", text: "mutated" }); });
  const snapshot = hub.snapshot();
  assert.ok(Object.isFrozen(snapshot) && snapshot.every(Object.isFrozen));
  mutationThrows(() => { snapshot.push(snapshot[0]); });
  mutationThrows(() => { snapshot[0].byteLength = 1; });
  assert.equal(hub.snapshot()[0].byteLength, Buffer.byteLength(JSON.stringify(hubState)));

  let receiver = reducer.createSessionReceiver();
  receiver = reducer.applyProjectedSessionUnit(receiver, reducer.makeLogicalFrame("immutable", 1, {
    type: "extension_status_set", key: "status", text: "value",
  })).receiver;
  assert.ok(Object.isFrozen(receiver) && Object.isFrozen(receiver.state) && Object.isFrozen(receiver.stateMetrics) && Object.isFrozen(receiver.limits));
  assert.ok(Object.isFrozen(receiver.state.statuses) && Object.isFrozen(receiver.state.statuses[0]));
  mutationThrows(() => { receiver.state.statuses[0].text = "x".repeat(1_000); });
  mutationThrows(() => { receiver.stateMetrics.bytes = 1; });
  mutationThrows(() => { receiver.limits.snapshotByteLimit = Number.MAX_SAFE_INTEGER; });

  const largeState = protocol.createInitialProjectedSessionState({ steering: ["雪".repeat(100)], followUp: [] });
  const units = hubModule.createSnapshotTransfer("assembly", 3, "recovery", largeState, 400, "immutable-assembly");
  let assembling = reducer.applyProjectedSessionUnit(reducer.createSessionReceiver(undefined, { encodedUnitByteLimit: 400 }), units[0]).receiver;
  assembling = reducer.applyProjectedSessionUnit(assembling, units[1]).receiver;
  assert.ok(Object.isFrozen(assembling.assembly) && Object.isFrozen(assembling.assembly.tail));
  assert.equal(typeof assembling.assembly.tail.data, "string");
  assert.equal("bytes" in assembling.assembly.tail, false, "caller-mutable typed-array storage is never retained");
  mutationThrows(() => { assembling.assembly.tail.data = "AAAA"; });
  mutationThrows(() => { assembling.assembly.partCount = 99; });

  const exactBytes = receiver.stateMetrics.bytes;
  const reused = reducer.createSessionReceiver(receiver.state, { snapshotByteLimit: exactBytes });
  const rejected = reducer.applyProjectedSessionUnit(reused, reducer.makeLogicalFrame("reuse", 1, {
    type: "extension_status_set", key: "second", text: "value",
  }));
  assert.equal(rejected.outcome, "invalid");
  assert.strictEqual(rejected.receiver, reused);
  assert.equal(reused.stateMetrics.bytes, Buffer.byteLength(JSON.stringify(reused.state)));
  assert.equal(receiver.stateMetrics.bytes, exactBytes, "cross-receiver reuse cannot poison identity metrics");

  const shallowFrozen = structuredClone(receiver.state);
  Object.freeze(shallowFrozen);
  const beforeMutationMetrics = reducer.measureProjectedSessionState(shallowFrozen);
  shallowFrozen.statuses[0].text = "x".repeat(32);
  const afterMutationMetrics = reducer.measureProjectedSessionState(shallowFrozen);
  assert.notEqual(afterMutationMetrics.bytes, beforeMutationMetrics.bytes, "unproven shallow-frozen graphs are never trusted as cache keys");
  assert.equal(afterMutationMetrics.bytes, Buffer.byteLength(JSON.stringify(shallowFrozen)));
});

test("safe sequence headroom atomically reserves the last two positions for canonical finality", () => {
  const maximum = Number.MAX_SAFE_INTEGER;

  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "sequence-headroom", replayByteLimit: 100_000, replayUnitLimit: 1_000 });
  hub.accept({ type: "agent_start" });
  hub.sequence = maximum - 3;
  const beforeSingle = hub.getReplayOccupancy();
  hub.accept({ type: "entry_appended", entry: { private: true } });
  assert.equal(hub.cursor, maximum - 2, "the final non-settlement position remains usable");
  assert.equal(hub.getState().transcriptRevision, 1);

  const stateBeforeSettlement = hub.getState();
  const live = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => live.push(unit));
  hub.accept({ type: "wrapper_settled" });
  assert.equal(hub.cursor, maximum);
  assert.equal(live[0].type, "run_settled");
  assert.equal(live[0].sequence, maximum - 1);
  assert.equal(live[1].type, "snapshot_start");
  assert.equal(live.at(-1).type, "snapshot_end");
  assert.ok(live.slice(1).every((unit) => unit.sequence === maximum));
  let receiver = {
    ...reducer.createSessionReceiver(stateBeforeSettlement),
    streamEpoch: hub.streamEpoch,
    cursor: maximum - 2,
  };
  receiver = receive(live, receiver);
  assert.equal(receiver.cursor, maximum);
  assert.deepEqual(receiver.state, hub.getState());
  assert.equal(receiver.state.active, false);
  assert.ok(hub.getReplayOccupancy().units > beforeSingle.units);

  const multi = new hubModule.ProjectedSessionEventHub({ streamEpoch: "sequence-multi" });
  multi.accept({ type: "agent_start" });
  multi.sequence = maximum - 3;
  const multiBefore = { state: multi.getState(), floor: multi.floor, occupancy: multi.getReplayOccupancy() };
  const multiSeen = [];
  multi.attach(multi.streamEpoch, multi.cursor, (unit) => multiSeen.push(unit));
  multi.accept({ type: "message_end", message: { role: "branchSummary", summary: "private" } });
  assert.equal(multi.cursor, maximum - 3, "two-draft non-final input cannot consume finality reserve");
  assert.strictEqual(multi.getState(), multiBefore.state);
  assert.equal(multi.floor, multiBefore.floor);
  assert.deepEqual(multi.getReplayOccupancy(), multiBefore.occupancy);
  assert.deepEqual(multiSeen, []);

  for (const cursor of [maximum - 1, maximum]) {
    const blocked = new hubModule.ProjectedSessionEventHub({ streamEpoch: `sequence-${cursor}` });
    blocked.accept({ type: "agent_start" });
    blocked.sequence = cursor;
    const before = { state: blocked.getState(), floor: blocked.floor, occupancy: blocked.getReplayOccupancy() };
    const seen = [];
    blocked.attach(blocked.streamEpoch, blocked.cursor, (unit) => seen.push(unit));
    blocked.accept({ type: "wrapper_settled" });
    assert.equal(blocked.cursor, cursor);
    assert.strictEqual(blocked.getState(), before.state);
    assert.equal(blocked.floor, before.floor);
    assert.deepEqual(blocked.getReplayOccupancy(), before.occupancy);
    assert.deepEqual(seen, []);
  }
});

test("reentrant accepted inputs capture immutable projection data before FIFO planning", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "capture" });
  const completed = [];
  let queued = false;
  const nested = Object.assign(Object.create(null), { label: "original" });
  const details = Object.assign(Object.create(null), { items: [nested] });
  const message = Object.assign(Object.create(null), {
    role: "custom",
    customType: "fixture",
    content: "safe",
    display: true,
    details,
  });
  const accepted = Object.assign(Object.create(null), { type: "message_end", message });
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (!queued && unit.type === "transcript_changed") {
      queued = true;
      hub.accept(accepted);
      accepted.message.customType = "mutated";
      accepted.message.details.items[0].label = "mutated";
      accepted.message.details.items.push({ label: "later" });
    }
  });
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "message_completed") completed.push(unit);
  });
  hub.accept({ type: "entry_appended", entry: { private: true } });
  assert.equal(completed.length, 1);
  assert.equal(completed[0].message.customType, "fixture");
  assert.deepEqual(completed[0].message.details, { items: [{ label: "original" }] });
  assert.deepEqual(hub.replayAfter(hub.streamEpoch, 1).units.find((unit) => unit.type === "message_completed"), completed[0]);
});

test("reentrant FIFO queue contains only minimal canonical projection inputs", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "minimal-capture" });
  const partial = { role: "assistant", model: "fixture", provider: "fixture", content: [{ type: "text", text: "growing" }], responseId: "forbidden-response" };
  let inspected = false;
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (inspected || unit.type !== "transcript_changed") return;
    inspected = true;
    hub.accept({ type: "message_update", message: partial, assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "accumulated-private", partial } });
    hub.accept({ type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_end", contentIndex: 1, partial, toolCall: { type: "toolCall", id: "call", name: "fixture-tool", arguments: { value: 1 }, thoughtSignature: "forbidden-signature" } } });
    hub.accept({ type: "message_end", message: { ...partial, content: [{ type: "toolCall", id: "call", name: "fixture-tool", arguments: { value: 1 }, thoughtSignature: "forbidden-signature" }] } });
    hub.accept({ type: "agent_end", messages: [partial], willRetry: false });
    const queued = hub.acceptedInputs.slice(hub.acceptedInputHead);
    const encoded = JSON.stringify(queued);
    assert.doesNotMatch(encoded, /accumulated-private|growing|forbidden|responseId|thoughtSignature|messages/);
    assert.equal(queued[0].assistantMessageEvent.content, "");
    assert.deepEqual(queued[0].assistantMessageEvent.partial.content, []);
    assert.equal(queued[1].assistantMessageEvent.toolCall.input.value, 1);
    assert.equal(queued[2].message.responseId, undefined);
    assert.equal(queued[3].messages, undefined);
  });
  hub.accept({ type: "entry_appended", entry: { private: true } });
  assert.equal(inspected, true);
});

test("hub rejects canonically reconstructed output beyond its configured graph limit atomically", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "capture-output-limit", canonicalNodeLimit: 50, canonicalDepthLimit: 10 });
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), replay: hub.getReplayOccupancy() };
  const blocks = Array.from({ length: 20 }, (_, index) => ({ type: "text", text: `block-${index}` }));
  hub.accept({ type: "message_end", message: { role: "assistant", provider: "fixture", model: "fixture", content: blocks } });
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.strictEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.replay);
});

test("failed accepted-input capture invokes no accessor and mutates no stream surface", () => {
  const diagnostics = [];
  const hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "capture-rejection",
    diagnostic: (entry) => diagnostics.push(entry),
  });
  let getterCalls = 0;
  let toJsonCalls = 0;
  const topAccessor = { type: "queue_update", steering: [], followUp: [] };
  Object.defineProperty(topAccessor, "unused", { enumerable: true, get() { getterCalls += 1; return "private"; } });
  const nestedAccessor = { type: "extension_ui_request", method: "custom", id: "id" };
  Object.defineProperty(nestedAccessor, "lines", { enumerable: true, get() { getterCalls += 1; return ["private"]; } });
  const inherited = Object.create({ private: true });
  Object.assign(inherited, { type: "queue_update", steering: [], followUp: [] });
  const invalidValue = { type: "queue_update", steering: [() => "private"], followUp: [] };
  const hooked = {};
  Object.defineProperty(hooked, "toJSON", { value() { toJsonCalls += 1; return "private"; } });
  const serializationHook = { type: "extension_ui_request", method: "custom", id: "id", lines: [hooked] };
  hub.accept(topAccessor);
  assert.equal(getterCalls, 0, "discarded accessors are not inspected");
  diagnostics.length = 0;
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), occupancy: hub.getReplayOccupancy() };
  for (const input of [nestedAccessor, inherited, invalidValue, serializationHook]) hub.accept(input);
  assert.equal(getterCalls, 0);
  assert.equal(toJsonCalls, 0);
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.strictEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.occupancy);
  assert.ok(diagnostics.every((entry) => Object.values(entry).every((value) => typeof value !== "string" || !value.includes("private"))));
  assert.ok(diagnostics.some((entry) => entry.kind === "input" && entry.outcome === "malformed"));
});

test("hostile proxy, trap, cycle, depth, and aggregate capture failures are atomic and content-free", () => {
  const diagnostics = [];
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "hostile-capture", diagnostic: (entry) => diagnostics.push(entry) });
  let listenerCalls = 0;
  hub.attach(hub.streamEpoch, hub.cursor, () => { listenerCalls += 1; });
  diagnostics.length = 0;
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), occupancy: hub.getReplayOccupancy() };

  const revokedOuter = Proxy.revocable({ type: "agent_start" }, {}); revokedOuter.revoke();
  const revokedNested = Proxy.revocable({ type: "text_start", contentIndex: 0, partial: assistant("") }, {}); revokedNested.revoke();
  const revokedContent = Proxy.revocable([], {}); revokedContent.revoke();
  const revokedArray = Proxy.revocable([], {}); revokedArray.revoke();
  const partialWithRevokedContent = { role: "assistant", model: "fixture", provider: "fixture", content: revokedContent.proxy };
  const throwingPrototype = new Proxy({ type: "agent_start" }, { getPrototypeOf() { throw new Error("private prototype"); } });
  const throwingOwnKeys = new Proxy({ type: "agent_start" }, { ownKeys() { throw new Error("private keys"); } });
  const throwingDescriptor = new Proxy({ type: "agent_start" }, { getOwnPropertyDescriptor() { throw new Error("private descriptor"); } });
  const toJsonAccessor = { type: "queue_update", steering: [], followUp: [] };
  Object.defineProperty(toJsonAccessor, "toJSON", { enumerable: true, get() { throw new Error("private toJSON"); } });
  const cyclic = []; cyclic.push(cyclic);
  let deep = { leaf: true };
  for (let index = 0; index < 70; index += 1) deep = { nested: deep };
  const shared = Array.from({ length: 1_000 }, (_, index) => index);
  const aggregate = {};
  for (let index = 0; index < 101; index += 1) aggregate[`selected${index}`] = shared;

  const ignoredTrapInputs = [throwingOwnKeys, toJsonAccessor];
  for (const input of ignoredTrapInputs) assert.doesNotThrow(() => hub.accept(input));
  assert.equal(hub.cursor, before.cursor + ignoredTrapInputs.length, "discarded own keys are never enumerated");
  diagnostics.length = 0;
  const rejectedInputs = [
    revokedOuter.proxy,
    { type: "message_update", assistantMessageEvent: revokedNested.proxy },
    { type: "message_update", assistantMessageEvent: { type: "start", partial: partialWithRevokedContent } },
    { type: "queue_update", steering: revokedArray.proxy, followUp: [] },
    throwingPrototype, throwingDescriptor,
    { type: "queue_update", steering: cyclic, followUp: [] },
    { type: "message_end", message: { role: "custom", customType: "fixture", content: "ok", display: true, details: deep } },
    { type: "message_end", message: { role: "custom", customType: "fixture", content: "ok", display: true, details: aggregate } },
  ];
  const afterIgnored = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), occupancy: hub.getReplayOccupancy() };
  for (const input of rejectedInputs) assert.doesNotThrow(() => hub.accept(input));
  assert.equal(diagnostics.length, rejectedInputs.length, "each rejection emits one bounded diagnostic");
  assert.ok(diagnostics.every((entry) => entry.kind === "input" && entry.outcome === "malformed"));
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|hostile-capture|selected|fixture/);
  assert.equal(listenerCalls, ignoredTrapInputs.length);
  assert.equal(hub.cursor, afterIgnored.cursor);
  assert.equal(hub.floor, afterIgnored.floor);
  assert.strictEqual(hub.getState(), afterIgnored.state);
  assert.deepEqual(hub.getReplayOccupancy(), afterIgnored.occupancy);
});

test("capability is non-enumerable, reused compatibly, rejects incompatible records, and hub closes exactly once", () => {
  const owner = {};
  const hub = hubModule.installProjectedSessionHubCapability(owner, { streamEpoch: "epoch" });
  assert.strictEqual(hubModule.installProjectedSessionHubCapability(owner), hub);
  const reader = hubModule.getProjectedSessionHub(owner);
  assert.ok(reader);
  assert.equal(reader.streamEpoch, hub.streamEpoch);
  assert.equal(reader.accept, undefined, "transport-facing capability cannot accept raw SDK events");
  assert.equal(reader.prepareNativeInput, undefined);
  assert.equal(reader.acceptPreparedNativeInput, undefined, "transport-facing capability cannot access commit receipts");
  assert.equal(reader.close, undefined, "transport-facing capability cannot own wrapper destruction");
  const simulatedReloadOwner = { [hubModule.PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL]: owner[hubModule.PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL] };
  assert.strictEqual(hubModule.getProjectedSessionHub(simulatedReloadOwner), reader, "compatible structural record survives class/module identity changes");
  assert.deepEqual(Object.keys(owner), []);
  assert.equal(hub.close(), true);
  assert.equal(hub.close(), false);
  assert.equal(hub.replayAfter("epoch", 0).outcome, "closed");

  const incompatible = { [hubModule.PROJECTED_SESSION_HUB_CAPABILITY_SYMBOL]: { protocol: "foreign" } };
  assert.throws(() => hubModule.installProjectedSessionHubCapability(incompatible), /incompatible/);
  assert.equal(hubModule.getProjectedSessionHub({}), null);
});

test("prepared-input receipts resolve once after complete FIFO commit or atomic rejection", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "receipt", canonicalNodeLimit: 100, canonicalDepthLimit: 10 });
  const committed = hub.prepareNativeInput({ type: "agent_start" });
  assert.deepEqual(committed.lifecycle, { kind: "agent_start" });
  const committedReceipt = hub.acceptPreparedNativeInput(committed);
  const outcomes = [];
  committedReceipt.whenResolved((outcome) => outcomes.push(outcome));
  assert.deepEqual(outcomes, ["committed"]);
  assert.throws(() => committedReceipt.whenResolved(() => {}), /already_observed/);

  hub.sequence = Number.MAX_SAFE_INTEGER - 2;
  const rejected = hub.prepareNativeInput({ type: "agent_settled" });
  const rejectedReceipt = hub.acceptPreparedNativeInput(rejected);
  rejectedReceipt.whenResolved((outcome) => outcomes.push(outcome));
  assert.deepEqual(outcomes, ["committed", "rejected"]);
  assert.equal(hub.cursor, Number.MAX_SAFE_INTEGER - 2);
});

test("prepared commit controls bracket publication and reject stale queued input", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "receipt-controls" });
  let hostApplied = false;
  const timeline = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "extension_widget_set") timeline.push({ stage: "published", hostApplied });
  });
  const widget = hub.prepareNativeInput({
    type: "extension_ui_request",
    method: "setWidget",
    widgetKey: "controlled",
    widgetLines: ["line"],
  });
  const widgetReceipt = hub.acceptPreparedNativeInput(widget, {
    isCurrent: () => true,
    beforeCommit: () => { hostApplied = true; },
    afterCommit: () => { timeline.push({ stage: "after", hostApplied }); },
  });
  const outcomes = [];
  widgetReceipt.whenResolved((outcome) => outcomes.push(outcome));
  assert.deepEqual(timeline, [
    { stage: "published", hostApplied: true },
    { stage: "after", hostApplied: true },
  ]);
  assert.deepEqual(outcomes, ["committed"]);

  let queuedReceipt;
  let queuedCurrent = true;
  let queuedApplied = false;
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type !== "activity_started" || queuedReceipt) return;
    const queued = hub.prepareNativeInput({
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: "stale",
      statusText: "must-not-commit",
    });
    queuedReceipt = hub.acceptPreparedNativeInput(queued, {
      isCurrent: () => queuedCurrent,
      beforeCommit: () => { queuedApplied = true; },
    });
    queuedCurrent = false;
  });
  const start = hub.prepareNativeInput({ type: "agent_start" });
  hub.acceptPreparedNativeInput(start);
  const queuedOutcomes = [];
  queuedReceipt.whenResolved((outcome) => queuedOutcomes.push(outcome));
  assert.deepEqual(queuedOutcomes, ["rejected"]);
  assert.equal(queuedApplied, false);
  assert.deepEqual(hub.getState().statuses, []);
});

test("after-drain callbacks also flush after replay-owned accepted-input processing", () => {
  let hub;
  let queueDuringReplay = false;
  let queued = false;
  let callbackCalls = 0;
  hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "replay-drain-callback",
    diagnostic: (entry) => {
      if (!queueDuringReplay || queued || entry.kind !== "replay") return;
      queued = true;
      hub.accept({
        type: "extension_ui_request",
        method: "setWidget",
        widgetKey: "replay-widget",
        widgetLines: ["line"],
      });
    },
  });
  hub.accept({
    type: "extension_ui_request",
    method: "setStatus",
    statusKey: "seed",
    statusText: "ready",
  });
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "extension_widget_set" && unit.key === "replay-widget") {
      hub.afterAcceptedInputDrain(() => { callbackCalls += 1; });
    }
  });

  queueDuringReplay = true;
  hub.replayAfter(hub.streamEpoch, 0);
  assert.equal(queued, true);
  assert.equal(callbackCalls, 1);
});

test("reentrant prepared receipts resolve in FIFO commit order and close rejects queued work", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "receipt-fifo" });
  const timeline = [];
  let nestedReceipt;
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type !== "activity_started" || nestedReceipt) return;
    const nested = hub.prepareNativeInput({ type: "agent_settled" });
    nestedReceipt = hub.acceptPreparedNativeInput(nested);
    nestedReceipt.whenResolved((outcome) => timeline.push(`nested:${outcome}`));
    timeline.push("listener-returned");
  });
  const start = hub.prepareNativeInput({ type: "agent_start" });
  const startReceipt = hub.acceptPreparedNativeInput(start);
  startReceipt.whenResolved((outcome) => timeline.push(`start:${outcome}`));
  assert.deepEqual(timeline, ["listener-returned", "nested:committed", "start:committed"]);

  let closeReceipt;
  const closing = new hubModule.ProjectedSessionEventHub({ streamEpoch: "receipt-close" });
  closing.attach(closing.streamEpoch, closing.cursor, (unit) => {
    if (unit.type !== "activity_started") return;
    const queued = closing.prepareNativeInput({ type: "agent_settled" });
    closeReceipt = closing.acceptPreparedNativeInput(queued);
    closing.close();
  });
  const outer = closing.prepareNativeInput({ type: "agent_start" });
  closing.acceptPreparedNativeInput(outer);
  const closeOutcomes = [];
  closeReceipt.whenResolved((outcome) => closeOutcomes.push(outcome));
  assert.deepEqual(closeOutcomes, ["rejected"]);
  assert.equal(closing.isClosed(), true);
});

test("wide selected descriptor rejection is bounded and atomic while small distinct graphs commit", () => {
  const trap = (target) => {
    let descriptors = 0;
    let ownKeys = 0;
    return {
      proxy: new Proxy(target, {
        getOwnPropertyDescriptor(inner, key) { descriptors += 1; return Reflect.getOwnPropertyDescriptor(inner, key); },
        ownKeys(inner) { ownKeys += 1; return Reflect.ownKeys(inner); },
      }),
      counts: () => ({ descriptors, ownKeys }),
    };
  };
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "wide-selected", canonicalNodeLimit: 20, canonicalDepthLimit: 10 });
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), replay: hub.getReplayOccupancy() };

  const wideObject = trap(Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`field${index}`, index])));
  hub.accept({ type: "message_end", message: { role: "custom", customType: "x", content: "ok", display: true, details: wideObject.proxy } });
  assert.ok(wideObject.counts().descriptors <= 20);
  assert.equal(wideObject.counts().ownKeys, 1);

  const wideArray = trap(Array.from({ length: 1_000 }, (_, index) => `item-${index}`));
  hub.accept({ type: "queue_update", steering: wideArray.proxy, followUp: [] });
  assert.ok(wideArray.counts().descriptors <= 20);
  assert.ok(wideArray.counts().ownKeys <= 1);
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.strictEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.replay);

  hub.accept({ type: "queue_update", steering: ["same"], followUp: ["same"] });
  assert.equal(hub.cursor, before.cursor + 1);
  assert.deepEqual(hub.getState().queue, { steering: ["same"], followUp: ["same"] });
});

test("selected ancestor and sibling aliases reject hub input atomically while distinct equivalents commit", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "alias" });
  const shared = ["same"];
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), replay: hub.getReplayOccupancy() };
  hub.accept({ type: "queue_update", steering: shared, followUp: shared });

  const nested = { value: 1 };
  hub.accept({ type: "message_end", message: { role: "custom", customType: "x", content: "ok", display: true, details: { first: nested, second: nested } } });
  const messageRoot = { type: "message_start" };
  messageRoot.message = messageRoot;
  hub.accept(messageRoot);
  const compactionRoot = { type: "compaction_end", reason: "manual", aborted: false, willRetry: false };
  compactionRoot.result = compactionRoot;
  hub.accept(compactionRoot);

  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.strictEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.replay);

  hub.accept({ type: "message_start", message: { role: "assistant", model: "m", provider: "p" } });
  assert.equal(hub.cursor, before.cursor + 1);
  assert.deepEqual(hub.getState().draft.metadata, { role: "assistant", model: "m", provider: "p" });
});

test("diagnostic close before the commit point rejects current and queued work without mutation", () => {
  let hub;
  const timeline = [];
  hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "precommit-close",
    diagnostic(entry) {
      if (entry.kind !== "input" || entry.inputClass !== "extension" || entry.outcome !== "projected") return;
      timeline.push("diagnostic");
      assert.equal(hub.close(), true);
      timeline.push("close-return");
    },
  });
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), replay: hub.getReplayOccupancy() };
  const prepared = hub.prepareNativeInput({ type: "extension_ui_request", method: "setStatus", statusKey: "key", statusText: "value" });
  const receipt = hub.acceptPreparedNativeInput(prepared);
  receipt.whenResolved((outcome) => timeline.push(`receipt:${outcome}`));

  assert.deepEqual(timeline, ["diagnostic", "close-return", "receipt:rejected"]);
  assert.equal(hub.isClosed(), true);
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.strictEqual(hub.getState(), before.state);
  assert.deepEqual(hub.getReplayOccupancy(), before.replay);
});

test("publication listener close completes every group and rejects later queued input", () => {
  const hub = new hubModule.ProjectedSessionEventHub({ streamEpoch: "published-multi-close" });
  const seen = [];
  let queuedReceipt;
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    seen.push(unit.type);
    if (unit.type !== "transcript_changed" || queuedReceipt) return;
    const queued = hub.prepareNativeInput({ type: "extension_ui_request", method: "setStatus", statusKey: "later", statusText: "rejected" });
    queuedReceipt = hub.acceptPreparedNativeInput(queued);
    assert.equal(hub.close(), true);
  });
  const outer = hub.prepareNativeInput({ type: "message_end", message: { role: "branchSummary" } });
  const outerReceipt = hub.acceptPreparedNativeInput(outer);
  const outcomes = [];
  outerReceipt.whenResolved((outcome) => outcomes.push(`outer:${outcome}`));
  queuedReceipt.whenResolved((outcome) => outcomes.push(`queued:${outcome}`));

  assert.deepEqual(seen, ["transcript_changed", "runtime_refresh_required"]);
  assert.deepEqual(outcomes, ["outer:committed", "queued:rejected"]);
  assert.equal(hub.cursor, 2);
  assert.equal(hub.getState().transcriptRevision, 1);
  assert.deepEqual(hub.getState().statuses, []);
  assert.equal(hub.isClosed(), true);
});

test("frame-diagnostic close completes committed settlement and final snapshot atomically", () => {
  let hub;
  let queuedReceipt;
  let closeRequested = false;
  const seen = [];
  hub = new hubModule.ProjectedSessionEventHub({
    streamEpoch: "published-final-close",
    encodedUnitByteLimit: 400,
    diagnostic(entry) {
      if (closeRequested || entry.kind !== "frame" || entry.frameType !== "run_settled") return;
      closeRequested = true;
      const queued = hub.prepareNativeInput({ type: "extension_ui_request", method: "setStatus", statusKey: "later", statusText: "rejected" });
      queuedReceipt = hub.acceptPreparedNativeInput(queued);
      assert.equal(hub.close(), true);
    },
  });
  hub.accept({ type: "wrapper_activity_started", activity: "prompt" });
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => seen.push(unit.type));
  const startCursor = hub.cursor;
  const settled = hub.prepareNativeInput({ type: "wrapper_settled" });
  const settledReceipt = hub.acceptPreparedNativeInput(settled);
  const outcomes = [];
  settledReceipt.whenResolved((outcome) => outcomes.push(`settled:${outcome}`));
  queuedReceipt.whenResolved((outcome) => outcomes.push(`queued:${outcome}`));

  assert.equal(seen[0], "run_settled");
  assert.ok(seen.includes("snapshot_start"));
  assert.ok(seen.includes("snapshot_chunk"));
  assert.equal(seen.at(-1), "snapshot_end");
  assert.deepEqual(outcomes, ["settled:committed", "queued:rejected"]);
  assert.equal(hub.cursor, startCursor + 2);
  assert.equal(hub.getState().active, false);
  assert.deepEqual(hub.getState().statuses, []);
  assert.equal(hub.isClosed(), true);
});
