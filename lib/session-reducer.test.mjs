import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const reducer = await jiti.import("./session-reducer.ts");
const hubModule = await jiti.import("./session-event-hub.ts");

function reduceAll(frames, initial = protocol.createInitialProjectedSessionState()) {
  return frames.reduce((result, frame) => reducer.reduceProjectedSessionFrame(result.state, frame), { state: initial });
}

test("pure reducer materializes live semantics and run settlement clears every ghost activity", () => {
  const message = { role: "assistant", provider: "p", model: "m", content: [{ type: "text", text: "hi" }] };
  const frames = [
    { type: "activity_started", activity: "prompt" },
    { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" } },
    { type: "content_block_started", contentIndex: 0, blockType: "text" },
    { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "hi" },
    { type: "tool_started", toolCallId: "one", toolName: "a" },
    { type: "tool_started", toolCallId: "two", toolName: "b" },
    { type: "tool_finished", toolCallId: "one" },
    { type: "retry_started", attempt: 2, maxAttempts: 3, errorMessage: "public" },
    { type: "compaction_started", reason: "threshold" },
    { type: "message_completed", message },
    { type: "run_settled" },
  ];
  let state = protocol.createInitialProjectedSessionState();
  let completed;
  for (const frame of frames) {
    const result = reducer.reduceProjectedSessionFrame(state, frame);
    state = result.state;
    if (result.effect?.type === "message_completed") completed = result.effect;
  }
  assert.deepEqual(completed, { type: "message_completed", message });
  assert.equal(state.active, false);
  assert.equal(state.draft, null);
  assert.deepEqual(state.activeTools, []);
  assert.equal(state.retry, null);
  assert.equal(state.compaction.active, false);
  assert.equal(state.transcriptRefreshRequired, true);
  assert.equal(state.runtimeRefreshRequired, true);
});

test("delta reduction copies only the changed state and draft branches", () => {
  let state = protocol.createInitialProjectedSessionState();
  state = reducer.reduceProjectedSessionFrame(state, { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" } }).state;
  state = reducer.reduceProjectedSessionFrame(state, { type: "content_block_started", contentIndex: 0, blockType: "text" }).state;
  const previous = state;
  const result = reducer.reduceProjectedSessionFrame(previous, { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "雪" }).state;
  assert.notStrictEqual(result, previous);
  assert.notStrictEqual(result.draft, previous.draft);
  assert.notStrictEqual(result.draft.blocks, previous.draft.blocks);
  for (const key of ["activeTools", "queue", "dialogs", "customUis", "statuses", "widgets", "retry", "compaction"]) {
    assert.strictEqual(result[key], previous[key], `${key} is structurally shared`);
  }
  assert.equal(previous.draft.blocks[0].text, "", "the pure reducer does not mutate its input");
  assert.equal(result.draft.blocks[0].text, "雪");
});

test("durable extension state is recovered while notice/editor effects are never stored", () => {
  let state = protocol.createInitialProjectedSessionState();
  const durable = [
    { type: "extension_dialog_opened", dialog: { id: "d", method: "input", title: "T" } },
    { type: "extension_custom_replaced", id: "c", lines: ["line"] },
    { type: "extension_status_set", key: "s", text: "status" },
    { type: "extension_widget_set", key: "w", lines: ["widget"], placement: "aboveEditor" },
    { type: "extension_title_set", title: "title" },
  ];
  ({ state } = reduceAll(durable, state));
  const beforeEffects = JSON.parse(JSON.stringify(state));
  let result = reducer.reduceProjectedSessionFrame(state, { type: "notice", level: "warning", message: "once" });
  assert.deepEqual(result.state, beforeEffects);
  assert.deepEqual(result.effect, { type: "notice", level: "warning", message: "once" });
  result = reducer.reduceProjectedSessionFrame(result.state, { type: "editor_inserted", text: "once" });
  assert.deepEqual(result.state, beforeEffects);
  assert.deepEqual(result.effect, { type: "editor_inserted", text: "once" });

  ({ state } = reduceAll([
    { type: "extension_dialog_closed", id: "d" },
    { type: "extension_custom_closed", id: "c" },
    { type: "extension_status_cleared", key: "s" },
    { type: "extension_widget_cleared", key: "w" },
  ], result.state));
  assert.deepEqual(state.dialogs, []);
  assert.deepEqual(state.customUis, []);
  assert.deepEqual(state.statuses, []);
  assert.deepEqual(state.widgets, []);
  assert.equal(state.title, "title");
});

test("receiver rejects duplicates, forward gaps, wrong epochs and malformed frames without state mutation", () => {
  let receiver = reducer.createSessionReceiver();
  const first = reducer.makeLogicalFrame("epoch-a", 1, { type: "activity_started", activity: "native" });
  let applied = reducer.applyProjectedSessionUnit(receiver, first);
  assert.equal(applied.outcome, "applied");
  receiver = applied.receiver;
  const baseline = JSON.parse(JSON.stringify(receiver));
  assert.equal(reducer.applyProjectedSessionUnit(receiver, first).outcome, "duplicate");
  assert.equal(reducer.applyProjectedSessionUnit(receiver, reducer.makeLogicalFrame("epoch-a", 3, { type: "native_settled" })).outcome, "gap");
  assert.equal(reducer.applyProjectedSessionUnit(receiver, reducer.makeLogicalFrame("epoch-b", 2, { type: "native_settled" })).outcome, "wrong_epoch");
  assert.equal(reducer.applyProjectedSessionUnit(receiver, { ...first, extra: true }).outcome, "invalid");
  assert.deepEqual(receiver, baseline);
});

test("snapshot transfer applies atomically only after ordered exact reassembly and supports newer epoch replacement", () => {
  const state = { ...protocol.createInitialProjectedSessionState({ steering: ["雪".repeat(100)], followUp: [] }), statuses: [{ key: "k", text: "v" }] };
  const units = hubModule.createSnapshotTransfer("new-epoch", 7, "recovery", state, 512, "transfer");
  assert.ok(units.length > 3);
  units.forEach((unit) => assert.ok(Buffer.byteLength(protocol.encodeProjectedSessionFrame(unit)) <= 512));

  let receiver = reducer.createSessionReceiver();
  const prior = JSON.parse(JSON.stringify(receiver));
  for (const unit of units.slice(0, -1)) {
    const result = reducer.applyProjectedSessionUnit(receiver, unit);
    assert.equal(result.outcome, "snapshot_pending");
    receiver = result.receiver;
    assert.deepEqual(receiver.state, prior.state);
    assert.equal(receiver.cursor, prior.cursor);
  }
  const final = reducer.applyProjectedSessionUnit(receiver, units.at(-1));
  assert.equal(final.outcome, "snapshot_applied");
  assert.equal(final.receiver.streamEpoch, "new-epoch");
  assert.equal(final.receiver.cursor, 7);
  assert.deepEqual(final.receiver.state, state);

  const outOfOrder = reducer.applyProjectedSessionUnit(reducer.applyProjectedSessionUnit(reducer.createSessionReceiver(), units[0]).receiver, units[2]);
  assert.equal(outOfOrder.outcome, "invalid");
  assert.deepEqual(outOfOrder.receiver.state, prior.state);
  assert.equal(outOfOrder.receiver.assembly, null);
  let retryReceiver = outOfOrder.receiver;
  for (const unit of units) retryReceiver = reducer.applyProjectedSessionUnit(retryReceiver, unit).receiver;
  assert.deepEqual(retryReceiver.state, state, "a fresh recovery succeeds after an interrupted transaction");
  const restarted = reducer.applyProjectedSessionUnit(reducer.applyProjectedSessionUnit(reducer.createSessionReceiver(), units[0]).receiver, units[0]);
  assert.equal(restarted.outcome, "snapshot_pending");
  assert.equal(restarted.receiver.assembly.partCount, 0);
  const duplicate = reducer.applyProjectedSessionUnit(reducer.applyProjectedSessionUnit(reducer.createSessionReceiver(), units[0]).receiver, units[1]);
  assert.equal(reducer.applyProjectedSessionUnit(duplicate.receiver, units[1]).outcome, "invalid");
  const tampered = units.map((unit) => ({ ...unit }));
  const chunk = tampered.find((unit) => unit.type === "snapshot_chunk");
  chunk.data = `${chunk.data}A`;
  let invalidReceiver = reducer.createSessionReceiver();
  let outcome;
  for (const unit of tampered) { const result = reducer.applyProjectedSessionUnit(invalidReceiver, unit); invalidReceiver = result.receiver; outcome = result.outcome; if (outcome === "invalid") break; }
  assert.equal(outcome, "invalid");
  assert.deepEqual(invalidReceiver.state, prior.state);
});

test("same-epoch snapshots at or behind the cursor and decoded marker mismatches never replace canonical state", () => {
  const currentState = protocol.createInitialProjectedSessionState({ steering: ["current"], followUp: [] });
  const currentUnits = hubModule.createSnapshotTransfer("epoch", 4, "recovery", currentState, 1_024, "current");
  let receiver = reducer.createSessionReceiver();
  for (const unit of currentUnits) receiver = reducer.applyProjectedSessionUnit(receiver, unit).receiver;
  const before = structuredClone(receiver);

  const altered = protocol.createInitialProjectedSessionState({ steering: ["altered"], followUp: [] });
  for (const sequence of [4, 3]) {
    const units = hubModule.createSnapshotTransfer("epoch", sequence, "recovery", altered, 1_024, `stale-${sequence}`);
    const start = reducer.applyProjectedSessionUnit(receiver, units[0]);
    assert.equal(start.outcome, "duplicate");
    assert.deepEqual(start.receiver.state, before.state);
    assert.equal(start.receiver.cursor, before.cursor);
    assert.equal(start.receiver.assembly, null);
    let unchanged = start.receiver;
    for (const unit of units.slice(1)) unchanged = reducer.applyProjectedSessionUnit(unchanged, unit).receiver;
    assert.deepEqual(unchanged.state, before.state);
    assert.equal(unchanged.cursor, before.cursor);
    assert.equal(unchanged.assembly, null);
  }

  const markerMismatch = { ...altered, transcriptRefreshRequired: false, runtimeRefreshRequired: false };
  const bytes = Buffer.from(JSON.stringify(markerMismatch));
  const transferId = "marker-mismatch";
  const units = [
    {
      protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: 1, streamEpoch: "epoch", sequence: 5,
      type: "snapshot_start", transferId, reason: "recovery", partCount: 1, byteLength: bytes.byteLength,
      transcriptRefreshRequired: true, runtimeRefreshRequired: true,
    },
    {
      protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: 1, streamEpoch: "epoch", sequence: 5,
      type: "snapshot_chunk", transferId, partIndex: 0, data: bytes.toString("base64url"),
    },
    {
      protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: 1, streamEpoch: "epoch", sequence: 5,
      type: "snapshot_end", transferId,
    },
  ];
  let mismatchReceiver = receiver;
  let outcome;
  for (const unit of units) {
    const applied = reducer.applyProjectedSessionUnit(mismatchReceiver, unit);
    mismatchReceiver = applied.receiver;
    outcome = applied.outcome;
  }
  assert.equal(outcome, "invalid");
  assert.deepEqual(mismatchReceiver.state, before.state);
  assert.equal(mismatchReceiver.cursor, before.cursor);
  assert.equal(mismatchReceiver.assembly, null);
});

test("snapshot receiver enforces unit, declaration, part, canonical-chunk, and cumulative bounds during assembly", () => {
  const state = protocol.createInitialProjectedSessionState({ steering: ["雪".repeat(80)], followUp: [] });
  const units = hubModule.createSnapshotTransfer("epoch", 4, "recovery", state, 400, "bounded");
  const receiver = reducer.createSessionReceiver(undefined, { encodedUnitByteLimit: 400, snapshotByteLimit: 2_000, snapshotPartLimit: 100 });
  const prior = structuredClone(receiver.state);

  const impossibleStarts = [
    { ...units[0], partCount: 101 },
    { ...units[0], byteLength: 2_001 },
    { ...units[0], partCount: units[0].byteLength + 1 },
    { ...units[0], byteLength: units[0].partCount * 301 },
  ];
  for (const start of impossibleStarts) {
    const result = reducer.applyProjectedSessionUnit(receiver, start);
    assert.equal(result.outcome, "invalid");
    assert.deepEqual(result.receiver.state, prior);
    assert.equal(result.receiver.assembly, null);
  }

  const started = reducer.applyProjectedSessionUnit(receiver, units[0]).receiver;
  assert.equal(reducer.applyProjectedSessionUnit(started, { ...units[1], data: "" }).outcome, "invalid");
  assert.equal(reducer.applyProjectedSessionUnit(started, { ...units[1], data: "AB" }).outcome, "invalid", "noncanonical trailing bits reject immediately");
  const oversizedData = "A".repeat(401);
  assert.equal(reducer.applyProjectedSessionUnit(started, { ...units[1], data: oversizedData }).outcome, "invalid");

  const first = reducer.applyProjectedSessionUnit(started, units[1]);
  assert.equal(first.outcome, "snapshot_pending");
  assert.equal(first.receiver.assembly.partCount, 1);
  assert.ok(first.receiver.assembly.decodedBytes > 0);
  assert.equal(Array.isArray(first.receiver.assembly), false);
  assert.equal("chunks" in first.receiver.assembly, false, "assembly does not allocate from declared part count or copy a growing chunk array");

  const overrun = { ...units[2], data: Buffer.alloc(units[0].byteLength).toString("base64url") };
  assert.equal(reducer.applyProjectedSessionUnit(first.receiver, overrun).outcome, "invalid");
  assert.deepEqual(first.receiver.state, prior);
});

test("ordinary receiver precommit enforces node, UTF-8 byte, snapshot-part, and depth budgets atomically", () => {
  const applyDraft = (receiver, draft) => reducer.applyProjectedSessionUnit(
    receiver,
    reducer.makeLogicalFrame("epoch", receiver.cursor + 1, draft),
  );

  let nodeReceiver = reducer.createSessionReceiver(undefined, { canonicalNodeLimit: 21 });
  let result = applyDraft(nodeReceiver, { type: "extension_status_set", key: "a", text: "v" });
  assert.equal(result.outcome, "applied");
  nodeReceiver = result.receiver;
  const nodeBefore = nodeReceiver;
  result = applyDraft(nodeReceiver, { type: "extension_status_set", key: "b", text: "v" });
  assert.equal(result.outcome, "invalid");
  assert.strictEqual(result.receiver, nodeBefore);
  assert.equal(result.effect, undefined);

  let byteReceiver = reducer.createSessionReceiver(undefined, { snapshotByteLimit: 313 });
  result = applyDraft(byteReceiver, { type: "extension_status_set", key: "a", text: "v" });
  assert.equal(result.outcome, "applied");
  byteReceiver = result.receiver;
  assert.equal(byteReceiver.stateMetrics.bytes, Buffer.byteLength(JSON.stringify(byteReceiver.state)));
  const byteBefore = byteReceiver;
  result = applyDraft(byteReceiver, { type: "extension_status_set", key: "b", text: "v" });
  assert.equal(result.outcome, "invalid");
  assert.strictEqual(result.receiver, byteBefore);

  let partReceiver = reducer.createSessionReceiver(undefined, { encodedUnitByteLimit: 400, snapshotPartLimit: 3 });
  for (const key of ["a", "b", "c", "d", "e", "f"]) {
    result = applyDraft(partReceiver, { type: "extension_status_set", key, text: "v" });
    assert.equal(result.outcome, "applied");
    partReceiver = result.receiver;
  }
  const partBefore = partReceiver;
  result = applyDraft(partReceiver, { type: "extension_status_set", key: "g", text: "v" });
  assert.equal(result.outcome, "invalid");
  assert.strictEqual(result.receiver, partBefore);

  let depthReceiver = reducer.createSessionReceiver(undefined, { canonicalDepthLimit: 4 });
  for (const draft of [
    { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" } },
    { type: "content_block_started", contentIndex: 0, blockType: "toolCall" },
  ]) {
    result = applyDraft(depthReceiver, draft);
    assert.equal(result.outcome, "applied");
    depthReceiver = result.receiver;
  }
  let input = { leaf: "value" };
  for (let index = 0; index < 5; index += 1) input = { nested: input };
  const depthBefore = depthReceiver;
  result = applyDraft(depthReceiver, {
    type: "content_block_finished", contentIndex: 0, blockType: "toolCall",
    toolCall: { type: "toolCall", toolCallId: "call", toolName: "fixture", input },
  });
  assert.equal(result.outcome, "invalid");
  assert.strictEqual(result.receiver, depthBefore);
});

test("receiver metrics stay exact across multi-step split-surrogate deltas without whole-state validation", () => {
  const drafts = [
    { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" } },
    { type: "content_block_started", contentIndex: 0, blockType: "text" },
    { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "\ud83d" },
    { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "\ude42" },
  ];
  let receiver = reducer.createSessionReceiver(undefined, { snapshotByteLimit: 407 });
  for (const draft of drafts) {
    const result = reducer.applyProjectedSessionUnit(receiver, reducer.makeLogicalFrame("epoch", receiver.cursor + 1, draft));
    assert.equal(result.outcome, "applied");
    receiver = result.receiver;
    assert.equal(receiver.stateMetrics.bytes, Buffer.byteLength(JSON.stringify(receiver.state)));
  }
  assert.equal(receiver.state.draft.blocks[0].text, "🙂");
  const before = receiver;
  const rejected = reducer.applyProjectedSessionUnit(receiver, reducer.makeLogicalFrame("epoch", receiver.cursor + 1, {
    type: "content_delta", contentIndex: 0, deltaType: "text", delta: "xxx",
  }));
  assert.equal(rejected.outcome, "invalid");
  assert.strictEqual(rejected.receiver, before);

  let escaped = reducer.createSessionReceiver();
  for (const draft of [
    { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" } },
    { type: "content_block_started", contentIndex: 0, blockType: "text" },
    ...["\"", "\\", "\n", "雪", "\ud83d", "\ude42"].map((delta) => ({ type: "content_delta", contentIndex: 0, deltaType: "text", delta })),
  ]) {
    const applied = reducer.applyProjectedSessionUnit(escaped, reducer.makeLogicalFrame("escape-epoch", escaped.cursor + 1, draft));
    assert.equal(applied.outcome, "applied");
    escaped = applied.receiver;
    assert.equal(escaped.stateMetrics.bytes, Buffer.byteLength(JSON.stringify(escaped.state)), "escape and Unicode deltas retain exact cached bytes");
  }
});

test("unsafe transcript revision transitions reject before cursor, state, assembly, or effect commit", () => {
  const state = { ...protocol.createInitialProjectedSessionState(), transcriptRevision: Number.MAX_SAFE_INTEGER };
  const message = { role: "assistant", provider: "p", model: "m", content: [{ type: "text", text: "done" }] };

  for (const draft of [
    { type: "transcript_changed" },
    { type: "message_completed", message },
  ]) {
    const receiver = reducer.createSessionReceiver(state);
    const before = receiver;
    const result = reducer.applyProjectedSessionUnit(receiver, reducer.makeLogicalFrame("epoch", 1, draft));
    assert.equal(result.outcome, "invalid");
    assert.strictEqual(result.receiver, before);
    assert.equal(result.receiver.cursor, 0);
    assert.equal(result.receiver.state.transcriptRevision, Number.MAX_SAFE_INTEGER);
    assert.equal(result.receiver.assembly, null);
    assert.equal(result.effect, undefined, "rejected message completion cannot escape as an effect");
  }
});

test("rejected ordinary frames preserve an in-progress snapshot assembly exactly", () => {
  const state = protocol.createInitialProjectedSessionState({ steering: ["recovery"], followUp: [] });
  const units = hubModule.createSnapshotTransfer("new", 4, "recovery", state, 512, "assembly");
  const started = reducer.applyProjectedSessionUnit(reducer.createSessionReceiver(), units[0]).receiver;
  const result = reducer.applyProjectedSessionUnit(started, reducer.makeLogicalFrame("old", 1, { type: "transcript_changed" }));
  assert.equal(result.outcome, "invalid");
  assert.strictEqual(result.receiver, started);
  assert.strictEqual(result.receiver.assembly, started.assembly);
});

test("settlement representability accounts exactly for draft, tool, retry, and compaction cleanup shapes", () => {
  const shapes = [
    [
      { type: "activity_started", activity: "prompt" },
      { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" } },
      { type: "content_block_started", contentIndex: 0, blockType: "text" },
      { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "雪".repeat(20) },
    ],
    [{ type: "activity_started", activity: "prompt" }, { type: "tool_started", toolCallId: "call", toolName: "fixture" }],
    [{ type: "activity_started", activity: "prompt" }, { type: "retry_started", attempt: 1, maxAttempts: 2, errorMessage: "retry" }],
    [{ type: "compaction_started", reason: "threshold" }],
  ];
  for (const frames of shapes) {
    let state = protocol.createInitialProjectedSessionState();
    for (const frame of frames) state = reducer.freezeProjectedSessionTransition(reducer.reduceProjectedSessionFrame(state, frame).state);
    const metrics = reducer.measureProjectedSessionState(state);
    const settled = reducer.freezeProjectedSessionTransition(reducer.reduceProjectedSessionFrame(state, { type: "run_settled" }).state);
    const settledMetrics = reducer.measureProjectedSessionTransition(state, settled, { type: "run_settled" });
    const limits = protocol.resolveProjectedSessionStateLimits({ snapshotByteLimit: Math.max(metrics.bytes, settledMetrics.bytes) });
    assert.equal(reducer.isProjectedSessionStateWithSettlementRepresentable(state, metrics, limits, 512, "shape"), true);
    assert.equal(metrics.bytes, Buffer.byteLength(JSON.stringify(state)));
    assert.equal(settledMetrics.bytes, Buffer.byteLength(JSON.stringify(settled)));
    assert.equal(settled.active, false);
    assert.equal(settled.draft, null);
    assert.deepEqual(settled.activeTools, []);
    assert.equal(settled.retry, null);
    assert.equal(settled.compaction?.active ?? false, false);
  }
});

test("ordered draft locate-and-copy preserves the exact plain sorted array and cached aggregate metrics", () => {
  let state = protocol.createInitialProjectedSessionState();
  state = reducer.freezeProjectedSessionTransition(reducer.reduceProjectedSessionFrame(state, {
    type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m" },
  }).state);
  for (const contentIndex of [20, 0, 10]) {
    state = reducer.freezeProjectedSessionTransition(reducer.reduceProjectedSessionFrame(state, {
      type: "content_block_started", contentIndex, blockType: "text",
    }).state);
  }
  assert.deepEqual(state.draft.blocks.map((block) => block.contentIndex), [0, 10, 20]);
  const prior = state;
  state = reducer.freezeProjectedSessionTransition(reducer.reduceProjectedSessionFrame(state, {
    type: "content_delta", contentIndex: 20, deltaType: "text", delta: "last",
  }).state);
  let metrics = reducer.measureProjectedSessionTransition(prior, state, {
    type: "content_delta", contentIndex: 20, deltaType: "text", delta: "last",
  });
  assert.equal(metrics.bytes, Buffer.byteLength(JSON.stringify(state)));
  const beforeMiddle = state;
  state = reducer.freezeProjectedSessionTransition(reducer.reduceProjectedSessionFrame(state, {
    type: "content_delta", contentIndex: 10, deltaType: "text", delta: "middle",
  }).state);
  metrics = reducer.measureProjectedSessionTransition(beforeMiddle, state, {
    type: "content_delta", contentIndex: 10, deltaType: "text", delta: "middle",
  });
  assert.equal(metrics.bytes, Buffer.byteLength(JSON.stringify(state)));
  assert.deepEqual(state.draft.blocks.map((block) => block.contentIndex), [0, 10, 20]);
  assert.ok(Array.isArray(state.draft.blocks));
  assert.equal(Object.getPrototypeOf(state.draft.blocks), Array.prototype);
  assert.equal(beforeMiddle.draft.blocks[1].text, "", "pure immutable input remains untouched");
});
