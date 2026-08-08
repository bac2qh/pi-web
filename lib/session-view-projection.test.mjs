import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const { PI_WEB_OPENAI_FAST_MODE_STATUS_KEY } = await jiti.import("./openai-fast-mode-status.ts");
const { projectSessionView, projectSessionEffect, isEffectCurrent } = await jiti.import("./session-view-projection.ts");

function view(statePatch = {}, options = {}) {
  const state = protocol.freezeCanonicalData({ ...protocol.createInitialProjectedSessionState(), ...statePatch });
  const transport = protocol.freezeCanonicalData({
    connectionState: options.connectionState ?? "connected", serverInstanceId: "server", streamEpoch: "epoch",
    cursor: options.cursor ?? 7, state, readyOutcome: "exact", errorClass: null, revision: options.revision ?? 3,
  });
  return Object.freeze({ generation: options.generation ?? 2, transport, localPromptPending: options.localPromptPending ?? false });
}

test("draft conversion preserves ordered text/thinking and only complete tool identity", () => {
  const snapshot = view({
    active: true,
    draft: {
      metadata: { role: "assistant", model: "model", provider: "provider", timestamp: 1 },
      blocks: [
        { contentIndex: 2, type: "toolCall", argumentsText: "partial" },
        { contentIndex: 1, type: "thinking", thinking: "thought" },
        { contentIndex: 0, type: "text", text: "answer" },
        { contentIndex: 3, type: "toolCall", argumentsText: "{}", toolCall: { type: "toolCall", toolCallId: "call", toolName: "read", input: {} } },
      ],
      terminalReason: "stop",
    },
    activeTools: [{ toolCallId: "call", toolName: "read" }],
  });
  const projected = projectSessionView(snapshot, "prompt");
  assert.equal(projected.running, true);
  assert.equal(projected.isStreaming, true);
  assert.equal(projected.phase, "running_tools");
  assert.deepEqual(projected.streamingMessage.content, [
    { type: "text", text: "answer" },
    { type: "thinking", thinking: "thought" },
    { type: "toolCall", toolCallId: "call", toolName: "read", input: {} },
  ]);
  assert.equal(projected.streamingMessage.stopReason, "stop");
  assert.deepEqual(projected.activeTools, [{ id: "call", name: "read" }]);
});

test("local claim keeps effective running and slash-command phase across an idle baseline", () => {
  const pending = projectSessionView(view({}, { localPromptPending: true }), "slash_command");
  assert.equal(pending.running, true);
  assert.equal(pending.isStreaming, false);
  assert.equal(pending.phase, "running_command");
  const canonical = projectSessionView(view({ active: true }), "slash_command");
  assert.equal(canonical.phase, "waiting_model");
  assert.equal(projectSessionView(view(), null).running, false);
});

test("queue retry compaction and extension state map deterministically", () => {
  const projected = projectSessionView(view({
    queue: { steering: ["one"], followUp: ["two"] },
    retry: { attempt: 2, maxAttempts: 4, errorMessage: "retry" },
    compaction: { active: false, reason: "threshold", tokensBefore: 12, estimatedTokensAfter: 6 },
    dialogs: [
      { id: "older-dialog", method: "input", title: "Older" },
      { id: "dialog", method: "confirm", title: "Confirm", message: "Continue?" },
    ],
    customUis: [{ id: "older-custom", lines: ["old"] }, { id: "custom", lines: ["line"] }],
    statuses: [
      { key: "status", text: "working" },
      { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
    ],
    widgets: [{ key: "widget", lines: ["value"], placement: "belowEditor" }],
    title: "Title",
  }), "compaction");
  assert.deepEqual(projected.queue, { steering: ["one"], followUp: ["two"] });
  assert.deepEqual(projected.retry, { attempt: 2, maxAttempts: 4, errorMessage: "retry" });
  assert.equal(projected.compaction.reason, "threshold");
  assert.deepEqual(projected.dialog, { type: "extension_ui_request", id: "dialog", method: "confirm", title: "Confirm", message: "Continue?" });
  assert.deepEqual(projected.customUi, { type: "extension_ui_request", id: "custom", method: "custom", lines: ["line"] });
  assert.deepEqual(projected.statuses, [
    { key: "status", text: "working" },
    { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
  ]);
  assert.deepEqual(projected.widgets, [{ key: "widget", lines: ["value"], placement: "belowEditor" }]);
  assert.equal(projected.title, "Title");
  assert.ok(Object.isFrozen(projected) && Object.isFrozen(projected.queue));
});

test("effects normalize completed tools and preserve notice/editor sequence without snapshot recreation", () => {
  const completed = projectSessionEffect({
    streamEpoch: "epoch", sequence: 7,
    effect: { type: "message_completed", message: { role: "assistant", model: "m", provider: "p", content: [{ type: "toolCall", id: "id", name: "tool", arguments: { value: 1 } }] } },
  });
  assert.deepEqual(completed.message.content[0], { type: "toolCall", toolCallId: "id", toolName: "tool", input: { value: 1 } });
  assert.deepEqual(projectSessionEffect({ streamEpoch: "epoch", sequence: 8, effect: { type: "notice", level: "warning", message: "note" } }),
    { type: "notice", level: "warning", message: "note", streamEpoch: "epoch", sequence: 8 });
  assert.deepEqual(projectSessionEffect({ streamEpoch: "epoch", sequence: 9, effect: { type: "editor_inserted", text: "insert" } }),
    { type: "editor_inserted", text: "insert", streamEpoch: "epoch", sequence: 9 });
});

test("draft evolution and terminal finality do not fabricate incomplete tool identity", () => {
  const stages = [
    [{ active: true, draft: { metadata: { role: "assistant", model: "m", provider: "p" }, blocks: [{ contentIndex: 0, type: "text", text: "a" }] } }, "a", undefined],
    [{ active: true, draft: { metadata: { role: "assistant", model: "m", provider: "p" }, blocks: [{ contentIndex: 0, type: "text", text: "answer" }, { contentIndex: 1, type: "toolCall", argumentsText: "{\"x\":" }] } }, "answer", undefined],
    [{ active: false, draft: { metadata: { role: "assistant", model: "m", provider: "p" }, blocks: [{ contentIndex: 0, type: "text", text: "answer" }], terminalReason: "error" } }, "answer", "error"],
  ];
  for (const [state, text, terminal] of stages) {
    const projected = projectSessionView(view(state), "prompt");
    assert.equal(projected.streamingMessage.content[0].text, text);
    assert.equal(projected.streamingMessage.content.some((block) => block.type === "toolCall"), false);
    assert.equal(projected.streamingMessage.stopReason, terminal);
  }
});

test("compaction success error abort and overlapping extension replacement/close project exactly", () => {
  const cases = [
    [{ active: false, reason: "manual", tokensBefore: 20, estimatedTokensAfter: 7 }, { aborted: undefined, errorMessage: undefined }],
    [{ active: false, reason: "threshold", errorMessage: "failed" }, { errorMessage: "failed" }],
    [{ active: false, reason: "overflow", aborted: true }, { aborted: true }],
  ];
  for (const [compaction, expected] of cases) {
    const projected = projectSessionView(view({ compaction }), "compaction");
    for (const [key, value] of Object.entries(expected)) assert.equal(projected.compaction[key], value);
  }
  const overlap = projectSessionView(view({
    dialogs: [{ id: "open-1", method: "input", title: "One" }, { id: "open-2", method: "editor", title: "Two" }],
    customUis: [{ id: "replaced", lines: ["old"] }, { id: "replacement", lines: ["new"] }],
  }), null);
  assert.equal(overlap.dialog.id, "open-2");
  assert.equal(overlap.customUi.id, "replacement");
  const closed = projectSessionView(view({ dialogs: [], customUis: [], statuses: [], widgets: [] }), null);
  assert.equal(closed.dialog, null);
  assert.equal(closed.customUi, null);
});

test("effect currency suppresses stale view epochs and future/uncommitted sequence", () => {
  const snapshot = view({}, { cursor: 7 });
  assert.equal(isEffectCurrent(snapshot, { streamEpoch: "epoch", sequence: 7, effect: { type: "notice", level: "info", message: "x" } }), true);
  assert.equal(isEffectCurrent(snapshot, { streamEpoch: "epoch", sequence: 8, effect: { type: "notice", level: "info", message: "x" } }), false);
  assert.equal(isEffectCurrent(snapshot, { streamEpoch: "old", sequence: 7, effect: { type: "notice", level: "info", message: "x" } }), false);
});
