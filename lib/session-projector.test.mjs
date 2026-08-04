import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const projector = await jiti.import("./session-projector.ts");
const reducer = await jiti.import("./session-reducer.ts");

function assistant(content, extra = {}) {
  return { role: "assistant", provider: "fixture", model: "fixture", content, timestamp: 1, ...extra };
}
function apply(state, frames) {
  let current = state;
  let effect;
  for (const frame of frames) {
    const result = reducer.reduceProjectedSessionFrame(current, frame);
    current = result.state;
    effect = result.effect ?? effect;
  }
  return { state: current, effect };
}
function projectAndApply(state, input, diagnostics = []) {
  const frames = projector.projectSessionInput(input, state, (entry) => diagnostics.push(entry));
  return { frames, ...apply(state, frames) };
}
const partial = assistant([{ type: "text", text: "growing provider snapshot" }], { responseId: "forbidden" });

test("all nested assistant variants use actionable deltas and exclude partial/terminal complete objects", () => {
  let state = protocol.createInitialProjectedSessionState();
  ({ state } = projectAndApply(state, { type: "message_start", message: partial }));
  const nested = [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    { type: "text_delta", contentIndex: 0, delta: "雪", partial },
    { type: "text_end", contentIndex: 0, content: "forbidden accumulated", partial },
    { type: "thinking_start", contentIndex: 1, partial },
    { type: "thinking_delta", contentIndex: 1, delta: "think", partial },
    { type: "thinking_end", contentIndex: 1, content: "forbidden accumulated", partial },
    { type: "toolcall_start", contentIndex: 2, partial },
    { type: "toolcall_delta", contentIndex: 2, delta: "{\"x\":", partial },
    { type: "toolcall_delta", contentIndex: 2, delta: "1}", partial },
    { type: "toolcall_end", contentIndex: 2, toolCall: { type: "toolCall", id: "call", name: "fixture-tool", arguments: { x: 1 }, thoughtSignature: "forbidden" }, partial },
    { type: "done", reason: "toolUse", message: { ...partial, errorMessage: "forbidden terminal" } },
  ];
  const projected = [];
  for (const assistantMessageEvent of nested) {
    const result = projectAndApply(state, { type: "message_update", message: partial, assistantMessageEvent });
    state = result.state;
    projected.push(...result.frames);
  }
  const encoded = JSON.stringify(projected);
  assert.doesNotMatch(encoded, /partial|growing provider snapshot|forbidden accumulated|thoughtSignature|responseId|errorMessage/);
  assert.deepEqual(state.draft.blocks, [
    { contentIndex: 0, type: "text", text: "雪" },
    { contentIndex: 1, type: "thinking", thinking: "think" },
    { contentIndex: 2, type: "toolCall", argumentsText: "{\"x\":1}", toolCall: { type: "toolCall", toolCallId: "call", toolName: "fixture-tool", input: { x: 1 } } },
  ]);
  assert.equal(state.draft.terminalReason, "toolUse");

  const errorFrames = projector.projectSessionInput({ type: "message_update", message: partial, assistantMessageEvent: { type: "error", reason: "aborted", error: { ...partial, errorMessage: "private complete error" } } }, state);
  assert.deepEqual(errorFrames, [{ type: "assistant_terminal", reason: "aborted" }]);
  assert.doesNotMatch(JSON.stringify(errorFrames), /private|errorMessage|message/);
  const unknownDiagnostics = [];
  assert.doesNotThrow(() => {
    assert.deepEqual(projector.projectSessionInput({ type: "message_update", message: partial, assistantMessageEvent: { type: "future_delta", partial, payload: "private" } }, state, (entry) => unknownDiagnostics.push(entry)), []);
  });
  assert.deepEqual(unknownDiagnostics.at(-1), { kind: "input", outcome: "unknown", inputClass: "assistant" });
});

test("complete interleaved text/thinking/tool delta subset equals final and full final effect is exact", () => {
  let state = protocol.createInitialProjectedSessionState();
  const diagnostics = [];
  const final = assistant([
    { type: "text", text: "hello雪" },
    { type: "thinking", thinking: "because" },
    { type: "toolCall", toolCallId: "id", toolName: "tool", input: { query: "🙂" } },
    { type: "image", source: { type: "url", url: "fixture:image" } },
  ], { stopReason: "toolUse", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  ({ state } = projectAndApply(state, { type: "message_start", message: final }, diagnostics));
  const events = [
    { type: "text_start", contentIndex: 0, partial },
    { type: "thinking_start", contentIndex: 1, partial },
    { type: "text_delta", contentIndex: 0, delta: "hello", partial },
    { type: "thinking_delta", contentIndex: 1, delta: "because", partial },
    { type: "text_delta", contentIndex: 0, delta: "雪", partial },
    { type: "toolcall_start", contentIndex: 2, partial },
    { type: "toolcall_delta", contentIndex: 2, delta: "{\"query\":\"🙂\"}", partial },
    { type: "toolcall_end", contentIndex: 2, toolCall: { type: "toolCall", id: "id", name: "tool", arguments: { query: "🙂" } }, partial },
    { type: "text_end", contentIndex: 0, content: "hello雪", partial },
    { type: "thinking_end", contentIndex: 1, content: "because", partial },
  ];
  for (const assistantMessageEvent of events) ({ state } = projectAndApply(state, { type: "message_update", message: partial, assistantMessageEvent }, diagnostics));
  assert.equal(projector.compareAssistantDeltaSubset(state.draft, final), "equal");
  const completed = projectAndApply(state, { type: "message_end", message: final }, diagnostics);
  assert.deepEqual(completed.frames, [{ type: "message_completed", message: final }]);
  assert.deepEqual(completed.effect, { type: "message_completed", message: final });
  assert.equal(completed.state.draft, null);
  assert.ok(diagnostics.some((entry) => entry.kind === "final_equality" && entry.outcome === "equal"));

  let emptyState = protocol.createInitialProjectedSessionState();
  ({ state: emptyState } = projectAndApply(emptyState, { type: "message_start", message: assistant([]) }));
  assert.equal(projector.compareAssistantDeltaSubset(emptyState.draft, assistant([])), "equal");
  assert.equal(projector.compareAssistantDeltaSubset(null, assistant([])), "not_comparable");
});

test("known assistant variants validate every projected field and malformed input is content-free", () => {
  const state = protocol.createInitialProjectedSessionState();
  const diagnostics = [];
  for (const assistantMessageEvent of [
    { type: "text_delta", contentIndex: -1, delta: "private", partial },
    { type: "thinking_delta", contentIndex: 0, delta: 1, partial },
    { type: "toolcall_end", contentIndex: 0, toolCall: { type: "toolCall", id: "id", name: "tool", arguments: { bad: Infinity } }, partial },
    { type: "done", reason: "future", message: partial },
    { type: "error", reason: "stop", error: partial },
  ]) {
    assert.deepEqual(projector.projectSessionInput({ type: "message_update", message: partial, assistantMessageEvent }, state, (entry) => diagnostics.push(entry)), []);
  }
  assert.equal(diagnostics.filter((entry) => entry.outcome === "malformed" && entry.inputClass === "assistant").length, 5);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|future|tool/);
});

test("getter-backed nested terminal tool data is never invoked or projected", () => {
  const partial = { role: "assistant", provider: "fixture", model: "fixture", content: [] };
  let getterCalls = 0;
  const toolCall = { type: "toolCall", id: "id", name: "tool" };
  Object.defineProperty(toolCall, "arguments", {
    enumerable: true,
    get() { getterCalls += 1; return { private: true }; },
  });
  const diagnostics = [];
  const state = protocol.createInitialProjectedSessionState();
  const frames = projector.projectSessionInput({
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall, partial },
  }, state, (entry) => diagnostics.push(entry));
  assert.equal(getterCalls, 0);
  assert.deepEqual(frames, []);
  assert.deepEqual(diagnostics, [{ kind: "input", outcome: "malformed", inputClass: "assistant" }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|arguments|tool/);
});

test("streamed tool arguments must parse and equal terminal normalized input", () => {
  const final = assistant([{ type: "toolCall", toolCallId: "id", toolName: "tool", input: { a: 1, b: "雪" } }]);
  const buildDraft = (deltas, terminal = final.content[0]) => {
    let state = protocol.createInitialProjectedSessionState();
    ({ state } = projectAndApply(state, { type: "message_start", message: final }));
    ({ state } = projectAndApply(state, { type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial } }));
    for (const delta of deltas) ({ state } = projectAndApply(state, { type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta, partial } }));
    ({ state } = projectAndApply(state, { type: "message_update", message: partial, assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: terminal, partial } }));
    return state.draft;
  };
  assert.equal(projector.compareAssistantDeltaSubset(buildDraft(['{"b":"雪",', '"a":1}']), final), "equal", "JSON object key order is immaterial");
  assert.equal(projector.compareAssistantDeltaSubset(buildDraft([]), final), "mismatch");
  assert.equal(projector.compareAssistantDeltaSubset(buildDraft(["{"]), final), "mismatch");
  assert.equal(projector.compareAssistantDeltaSubset(buildDraft(['{"a":2,"b":"雪"}']), final), "mismatch");
  assert.equal(projector.compareAssistantDeltaSubset(buildDraft(['{"a":1,"b":"雪"}'], { ...final.content[0], toolCallId: "different" }), final), "mismatch");
  assert.equal(projector.compareAssistantDeltaSubset(buildDraft(['{"a":1,"b":"雪"}'], { ...final.content[0], toolName: "different" }), final), "mismatch");
});

test("success, retry, error, abort, empty, and missing-terminal-delta equality classes are explicit", () => {
  for (const stopReason of ["stop", "length", "error", "aborted"]) {
    let state = protocol.createInitialProjectedSessionState();
    const final = assistant([{ type: "text", text: "complete" }], { stopReason, ...(stopReason === "error" ? { errorMessage: "public" } : {}) });
    ({ state } = projectAndApply(state, { type: "message_start", message: final }));
    for (const assistantMessageEvent of [
      { type: "text_start", contentIndex: 0, partial },
      { type: "text_delta", contentIndex: 0, delta: "complete", partial },
      { type: "text_end", contentIndex: 0, content: "complete", partial },
      stopReason === "error" || stopReason === "aborted"
        ? { type: "error", reason: stopReason, error: final }
        : { type: "done", reason: stopReason, message: final },
    ]) ({ state } = projectAndApply(state, { type: "message_update", message: partial, assistantMessageEvent }));
    assert.equal(projector.compareAssistantDeltaSubset(state.draft, final), "equal", stopReason);
  }

  let retryState = protocol.createInitialProjectedSessionState();
  ({ state: retryState } = projectAndApply(retryState, { type: "auto_retry_start", attempt: 1, maxAttempts: 2, errorMessage: "public" }));
  ({ state: retryState } = projectAndApply(retryState, { type: "auto_retry_end", success: true, attempt: 1 }));
  ({ state: retryState } = projectAndApply(retryState, { type: "message_start", message: assistant([{ type: "text", text: "retry" }]) }));
  ({ state: retryState } = projectAndApply(retryState, { type: "message_update", message: partial, assistantMessageEvent: { type: "text_start", contentIndex: 0, partial } }));
  ({ state: retryState } = projectAndApply(retryState, { type: "message_update", message: partial, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "retry", partial } }));
  assert.equal(projector.compareAssistantDeltaSubset(retryState.draft, assistant([{ type: "text", text: "retry" }])), "equal");

  let mismatchState = protocol.createInitialProjectedSessionState();
  const diagnostics = [];
  ({ state: mismatchState } = projectAndApply(mismatchState, { type: "message_start", message: assistant([{ type: "text", text: "final" }]) }, diagnostics));
  ({ state: mismatchState } = projectAndApply(mismatchState, { type: "message_update", message: partial, assistantMessageEvent: { type: "text_start", contentIndex: 0, partial } }, diagnostics));
  const mismatch = projectAndApply(mismatchState, { type: "message_end", message: assistant([{ type: "text", text: "final" }]) }, diagnostics);
  assert.deepEqual(mismatch.effect.message, assistant([{ type: "text", text: "final" }]));
  assert.ok(diagnostics.some((entry) => entry.kind === "final_equality" && entry.outcome === "mismatch"));
});

test("normalizer preserves exact display fields and rejects or refreshes unsupported/sensitive roles", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "u" }, { type: "image", data: "bytes", mimeType: "image/png" }], timestamp: 1 },
    { role: "toolResult", toolCallId: "id", toolName: "tool", content: [{ type: "text", text: "r" }], details: { patch: "display patch", rawResult: "forbidden" }, isError: false, usage: { forbidden: true }, addedToolNames: ["forbidden"], timestamp: 2 },
    { role: "custom", customType: "x", content: "c", display: true, details: { shown: true }, timestamp: 3 },
  ];
  for (const raw of messages) {
    const normalized = projector.normalizeProjectedMessage(raw);
    assert.ok(normalized);
    assert.doesNotMatch(JSON.stringify(normalized), /addedToolNames|forbidden/);
  }
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(projector.normalizeProjectedMessage({ role: "custom", customType: "x", content: "c", display: true, details: cyclic }), null);

  for (const message of [
    { role: "bashExecution", command: "private", output: "private", fullOutputPath: "/private" },
    { role: "branchSummary", summary: "private", fromId: "private" },
    { role: "compactionSummary", summary: "private", tokensBefore: 99 },
  ]) {
    const frames = projector.projectSessionInput({ type: "message_end", message }, protocol.createInitialProjectedSessionState());
    assert.deepEqual(frames, [{ type: "transcript_changed" }, { type: "runtime_refresh_required" }]);
    assert.doesNotMatch(JSON.stringify(frames), /private|summary|command|output|fromId|tokensBefore|fullOutputPath/);
  }
});

test("native/wrapper/legacy/extension inputs are exhaustively projected or explicitly omitted", () => {
  const state = protocol.createInitialProjectedSessionState();
  const cases = [
    [{ type: "agent_start" }, ["activity_started"]],
    [{ type: "agent_end", messages: [{ private: true }], willRetry: true }, ["attempt_ended"]],
    [{ type: "agent_settled" }, ["native_settled"]],
    [{ type: "turn_start" }, []], [{ type: "turn_end", message: partial, toolResults: [{ private: true }] }, []],
    [{ type: "tool_execution_start", toolCallId: "id", toolName: "tool", args: { private: true } }, ["tool_started"]],
    [{ type: "tool_execution_update", toolCallId: "id", toolName: "tool", args: {}, partialResult: { private: true } }, []],
    [{ type: "tool_execution_end", toolCallId: "id", toolName: "tool", result: { private: true }, isError: false }, ["tool_finished"]],
    [{ type: "queue_update", steering: ["s"], followUp: ["f"] }, ["queue_replaced"]],
    [{ type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 100, errorMessage: "public" }, ["retry_started"]],
    [{ type: "auto_retry_end", success: false, attempt: 2, finalError: "public" }, ["retry_finished"]],
    [{ type: "compaction_start", reason: "manual" }, ["compaction_started"]],
    [{ type: "compaction_end", reason: "overflow", result: { summary: "private", details: { private: true }, firstKeptEntryId: "private", tokensBefore: 90, estimatedTokensAfter: 20 }, aborted: false, willRetry: false }, ["compaction_finished"]],
    [{ type: "auto_compaction_start", reason: "threshold" }, ["compaction_started"]],
    [{ type: "auto_compaction_end", reason: "threshold", result: { summary: "private", tokensBefore: 50 }, aborted: true }, ["compaction_finished"]],
    [{ type: "entry_appended", entry: { private: true } }, ["transcript_changed"]],
    [{ type: "session_info_changed", name: "private" }, ["runtime_refresh_required"]],
    [{ type: "thinking_level_changed", level: "high" }, ["runtime_refresh_required"]],
    [{ type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 2, delayMs: 1, errorMessage: "private" }, []],
    [{ type: "summarization_retry_attempt_start", source: "branchSummary" }, []],
    [{ type: "summarization_retry_finished" }, []], [{ type: "bash_execution_update", id: "private", delta: "private" }, []],
    [{ type: "prompt_error", errorMessage: "public" }, ["notice"]], [{ type: "prompt_done" }, []],
    [{ type: "extension_error", extensionPath: "/private", event: "private", error: "public" }, ["notice"]],
    [{ type: "future_sdk_event", payload: "private" }, []],
  ];
  for (const [input, expected] of cases) {
    const frames = projector.projectSessionInput(input, state);
    assert.deepEqual(frames.map((frame) => frame.type), expected, input.type);
    const encoded = JSON.stringify(frames);
    assert.doesNotMatch(encoded, /"messages"|"args"|partialResult|firstKeptEntryId|extensionPath|future_sdk_event/);
    if (!["prompt_error", "extension_error", "auto_retry_start"].includes(input.type)) assert.doesNotMatch(encoded, /private/);
  }
});

test("all extension methods distinguish durable state from transient effects", () => {
  const state = protocol.createInitialProjectedSessionState();
  const events = [
    { method: "select", id: "d1", title: "Select", options: ["a"], timeout: 5, expiresAt: 10 },
    { method: "confirm", id: "d2", title: "Confirm", message: "m" },
    { method: "input", id: "d3", title: "Input", placeholder: "p" },
    { method: "editor", id: "d4", title: "Editor", prefill: "p" },
    { method: "custom", id: "c", lines: ["line"] },
    { method: "custom", id: "c", lines: [], closed: true },
    { method: "setStatus", id: "x", statusKey: "s", statusText: "text" },
    { method: "setStatus", id: "x", statusKey: "s" },
    { method: "setWidget", id: "x", widgetKey: "w", widgetLines: ["line"], widgetPlacement: "belowEditor" },
    { method: "setWidget", id: "x", widgetKey: "w" },
    { method: "setTitle", id: "x", title: "title" },
    { method: "notify", id: "x", message: "notice", notifyType: "warning" },
    { method: "set_editor_text", id: "x", text: "insert" },
  ];
  assert.deepEqual(events.map((event) => projector.projectSessionInput({ type: "extension_ui_request", ...event }, state).map((frame) => frame.type)), [
    ["extension_dialog_opened"], ["extension_dialog_opened"], ["extension_dialog_opened"], ["extension_dialog_opened"],
    ["extension_custom_replaced"], ["extension_custom_closed"], ["extension_status_set"], ["extension_status_cleared"],
    ["extension_widget_set"], ["extension_widget_cleared"], ["extension_title_set"], ["notice"], ["editor_inserted"],
  ]);
});

function byteGrowth(chunks) {
  const unit = "雪🙂";
  let growing = "";
  let legacyBytes = 0;
  let projectedBytes = 0;
  for (let index = 0; index < chunks; index += 1) {
    growing += unit;
    legacyBytes += Buffer.byteLength(JSON.stringify({ type: "message_update", message: assistant([{ type: "text", text: growing }]), assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: unit, partial: assistant([{ type: "text", text: growing }]) } }));
    projectedBytes += Buffer.byteLength(JSON.stringify({ type: "content_delta", contentIndex: 0, deltaType: "text", delta: unit }));
  }
  legacyBytes += Buffer.byteLength(JSON.stringify({ type: "agent_end", messages: [assistant([{ type: "text", text: growing }])] }));
  projectedBytes += Buffer.byteLength(JSON.stringify({ type: "message_completed", message: assistant([{ type: "text", text: growing }]) }));
  return { legacyBytes, projectedBytes };
}

test("Unicode projected bytes grow approximately linearly while modeled legacy snapshots approach quadratic", () => {
  const small = byteGrowth(256);
  const large = byteGrowth(512);
  assert.ok(large.projectedBytes / small.projectedBytes < 2.2, JSON.stringify({ small: small.projectedBytes, large: large.projectedBytes }));
  assert.ok(large.legacyBytes / small.legacyBytes > 3.5, JSON.stringify({ small: small.legacyBytes, large: large.legacyBytes }));
  assert.ok(large.projectedBytes * 5 < large.legacyBytes);
});

test("accepted-input capture retains only bounded canonical projection data", () => {
  const growing = assistant([{ type: "text", text: "growing" }], { responseId: "forbidden-response" });
  const textEnd = projector.captureSessionProjectionInput({
    type: "message_update",
    message: growing,
    assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "x".repeat(10_000), partial: growing },
  });
  assert.equal(textEnd.assistantMessageEvent.content, "", "accumulated block-end content becomes a sentinel");
  assert.deepEqual(textEnd.assistantMessageEvent.partial.content, []);
  assert.doesNotMatch(JSON.stringify(textEnd), /forbidden-response|growing|responseId/);

  const terminal = projector.captureSessionProjectionInput({ type: "message_update", assistantMessageEvent: { type: "done", reason: "stop", message: growing } });
  assert.deepEqual(terminal.assistantMessageEvent.message.content, []);
  assert.doesNotMatch(JSON.stringify(terminal), /forbidden-response|growing|responseId/);

  const toolEnd = projector.captureSessionProjectionInput({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end", contentIndex: 1, partial: growing,
      toolCall: { type: "toolCall", id: "call", name: "fixture-tool", arguments: { value: 1 }, thoughtSignature: "forbidden-signature" },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(toolEnd.assistantMessageEvent.toolCall)), { type: "toolCall", toolCallId: "call", toolName: "fixture-tool", input: { value: 1 } });
  assert.doesNotMatch(JSON.stringify(toolEnd), /thoughtSignature|forbidden-signature|responseId/);

  const completed = projector.captureSessionProjectionInput({
    type: "message_end",
    message: assistant([{ type: "toolCall", id: "call", name: "fixture-tool", arguments: { value: 1 }, thoughtSignature: "forbidden" }], { responseId: "forbidden" }),
  });
  assert.deepEqual(completed.message.content[0], { type: "toolCall", toolCallId: "call", toolName: "fixture-tool", input: { value: 1 } });
  assert.doesNotMatch(JSON.stringify(completed), /thoughtSignature|responseId/);
  assert.deepEqual(JSON.parse(JSON.stringify(projector.captureSessionProjectionInput({ type: "agent_end", messages: [growing], willRetry: false }))), { type: "agent_end", willRetry: false });

  const shared = Array.from({ length: 1_000 }, (_, index) => index);
  const unknown = { type: "future_assistant_variant" };
  for (let index = 0; index < 101; index += 1) unknown[`extra${index}`] = shared;
  const boundedUnknown = projector.captureSessionProjectionInput({ type: "message_update", assistantMessageEvent: unknown });
  assert.deepEqual(JSON.parse(JSON.stringify(boundedUnknown.assistantMessageEvent)), { type: "__unknown_assistant_variant__" }, "unknown values use a bounded sentinel without aggregate copying");

  const details = {};
  for (let index = 0; index < 101; index += 1) details[`selected${index}`] = shared;
  assert.equal(projector.captureSessionProjectionInput({ type: "message_end", message: { role: "custom", customType: "fixture", content: "ok", display: true, details } }), null,
    "one aggregate budget covers every selected alias copy");
});

test("ignored assistant capture is content-free constant work and known variants reject excess keys", () => {
  let contentOwnKeys = 0;
  const content = new Proxy(Array.from({ length: 10_000 }, () => ({ private: true })), {
    ownKeys() { contentOwnKeys += 1; throw new Error("ignored content must not be enumerated"); },
  });
  const captured = projector.captureSessionProjectionInput({
    type: "message_update",
    assistantMessageEvent: {
      type: "done",
      reason: "stop",
      message: { role: "assistant", model: "private-model", provider: "private-provider", content },
    },
  }, 20, 10);
  assert.deepEqual(captured.assistantMessageEvent.message, { role: "assistant", model: "", provider: "", content: [] });
  assert.equal(contentOwnKeys, 0);
  assert.doesNotMatch(JSON.stringify(captured), /private-model|private-provider|private/);

  const excessKey = `x${"z".repeat(1_000_000)}`;
  const assistantEvent = { type: "text_delta", contentIndex: 0, delta: "ok", partial: assistant([]) };
  Object.defineProperty(assistantEvent, excessKey, { value: { private: true }, enumerable: true });
  assert.equal(projector.captureSessionProjectionInput({ type: "message_update", assistantMessageEvent: assistantEvent }, 20, 10), null);
});

test("extension capture queues exact method-specific fields and bounded unknown classification", () => {
  const capture = (method, fields) => projector.captureSessionProjectionInput({
    type: "extension_ui_request", method, id: "unused-id", options: ["unused"], message: "unused-message", title: "unused-title",
    statusKey: "status", statusText: "text", widgetKey: "widget", widgetLines: ["line"], widgetPlacement: "belowEditor",
    text: "editor", closed: false, lines: ["custom"], notifyType: "warning", placeholder: "hint", prefill: "prefill", timeout: 1, expiresAt: 2,
    ...fields,
  });
  assert.deepEqual(capture("setStatus"), { type: "extension_ui_request", method: "setStatus", statusKey: "status", statusText: "text" });
  assert.deepEqual(capture("setWidget"), { type: "extension_ui_request", method: "setWidget", widgetKey: "widget", widgetLines: ["line"], widgetPlacement: "belowEditor" });
  assert.deepEqual(capture("setTitle"), { type: "extension_ui_request", method: "setTitle", title: "unused-title" });
  assert.deepEqual(capture("set_editor_text"), { type: "extension_ui_request", method: "set_editor_text", text: "editor" });
  assert.deepEqual(capture("notify"), { type: "extension_ui_request", method: "notify", message: "unused-message", notifyType: "warning" });
  assert.deepEqual(capture("custom"), { type: "extension_ui_request", method: "custom", id: "unused-id", closed: false, lines: ["custom"] });
  assert.deepEqual(capture("select"), { type: "extension_ui_request", method: "select", id: "unused-id", title: "unused-title", options: ["unused"], timeout: 1, expiresAt: 2 });
  assert.deepEqual(capture("confirm"), { type: "extension_ui_request", method: "confirm", id: "unused-id", title: "unused-title", message: "unused-message", timeout: 1, expiresAt: 2 });
  assert.deepEqual(capture("input"), { type: "extension_ui_request", method: "input", id: "unused-id", title: "unused-title", placeholder: "hint", timeout: 1, expiresAt: 2 });
  assert.deepEqual(capture("editor"), { type: "extension_ui_request", method: "editor", id: "unused-id", title: "unused-title", prefill: "prefill", timeout: 1, expiresAt: 2 });
  assert.deepEqual(capture("future-method"), { type: "extension_ui_request", method: "__unknown_extension_method__" });
});

test("captured output is one strict canonical graph under the configured limits", () => {
  const small = projector.captureSessionProjectionInput({ type: "message_end", message: assistant([{ type: "text", text: "ok" }]) }, 50, 10);
  assert.ok(small);
  assert.deepEqual(small, protocol.cloneJsonSafe(small, 50, 10));

  const blocks = Array.from({ length: 20 }, (_, index) => ({ type: "text", text: `block-${index}` }));
  assert.equal(projector.captureSessionProjectionInput({ type: "message_end", message: assistant(blocks) }, 50, 10), null,
    "reconstructed output cannot exceed the same strict node budget");
});

test("outer and nested prototype keys cannot install inherited getters during descriptor inspection", () => {
  const state = protocol.createInitialProjectedSessionState();
  const diagnostics = [];
  let getterCalls = 0;

  const outerPrototypePayload = {};
  Object.defineProperty(outerPrototypePayload, "message", {
    enumerable: true,
    get() { getterCalls += 1; return { role: "branchSummary", summary: "forbidden" }; },
  });
  const outer = { type: "message_end" };
  Object.defineProperty(outer, "__proto__", { value: outerPrototypePayload, enumerable: true });

  const nestedPrototypePayload = {};
  Object.defineProperty(nestedPrototypePayload, "role", {
    enumerable: true,
    get() { getterCalls += 1; return "branchSummary"; },
  });
  const nested = {};
  Object.defineProperty(nested, "__proto__", { value: nestedPrototypePayload, enumerable: true });

  assert.deepEqual(projector.projectSessionInput(outer, state, (entry) => diagnostics.push(entry)), []);
  assert.deepEqual(projector.projectSessionInput({ type: "message_end", message: nested }, state, (entry) => diagnostics.push(entry)), []);
  assert.equal(getterCalls, 0);
  assert.deepEqual(diagnostics.map((entry) => entry.outcome), ["malformed", "malformed"]);
  assert.ok(diagnostics.every((entry) => !Object.values(entry).some((value) => String(value).includes("forbidden"))));

  const nullPrototypeInput = Object.assign(Object.create(null), { type: "agent_start" });
  assert.deepEqual(projector.projectSessionInput(nullPrototypeInput, state), [{ type: "activity_started", activity: "native" }]);
});

test("capture uses bounded discriminant-first and selected-field descriptor inspection", () => {
  const trapProxy = (target) => {
    let descriptors = 0;
    let ownKeys = 0;
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(inner, key) { descriptors += 1; return Reflect.getOwnPropertyDescriptor(inner, key); },
      ownKeys(inner) { ownKeys += 1; return Reflect.ownKeys(inner); },
    });
    return { proxy, counts: () => ({ descriptors, ownKeys }) };
  };
  const ignored = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`discarded${index}`, index]));

  const unknownAssistant = trapProxy({ type: "future_assistant", ...ignored });
  const unknownAssistantInput = trapProxy({ type: "message_update", assistantMessageEvent: unknownAssistant.proxy, ...ignored });
  assert.ok(projector.captureSessionProjectionInput(unknownAssistantInput.proxy, 10, 10));
  assert.ok(unknownAssistant.counts().descriptors <= 2);
  assert.equal(unknownAssistant.counts().ownKeys, 0);

  const unknownExtension = trapProxy({ type: "extension_ui_request", method: "future_method", ...ignored });
  assert.ok(projector.captureSessionProjectionInput(unknownExtension.proxy, 10, 10));
  assert.ok(unknownExtension.counts().descriptors <= 4);
  assert.equal(unknownExtension.counts().ownKeys, 0);

  const unused = trapProxy({ type: "entry_appended", ...ignored });
  assert.ok(projector.captureSessionProjectionInput(unused.proxy, 10, 10));
  assert.ok(unused.counts().descriptors <= 3);
  assert.equal(unused.counts().ownKeys, 0);

  const agentEnd = trapProxy({ type: "agent_end", willRetry: false, messages: [ignored], ...ignored });
  assert.ok(projector.captureSessionProjectionInput(agentEnd.proxy, 10, 10));
  assert.ok(agentEnd.counts().descriptors <= 4);
  assert.equal(agentEnd.counts().ownKeys, 0);

  const method = trapProxy({ type: "extension_ui_request", method: "notify", message: "bounded", notifyType: "info", ...ignored });
  assert.ok(projector.captureSessionProjectionInput(method.proxy, 20, 10));
  assert.ok(method.counts().descriptors <= 8);
  assert.equal(method.counts().ownKeys, 0);

  const tool = trapProxy({ type: "toolCall", id: "id", name: "tool", arguments: { value: 1 }, providerMetadata: ignored, ...ignored });
  assert.ok(projector.captureSessionProjectionInput({
    type: "message_update",
    assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: tool.proxy, partial: assistant([]) },
  }, 50, 10));
  assert.ok(tool.counts().descriptors <= 8);
  assert.equal(tool.counts().ownKeys, 0);

  const completed = trapProxy({ role: "assistant", provider: "p", model: "m", content: [], responseId: "discarded", ...ignored });
  assert.ok(projector.captureSessionProjectionInput({ type: "message_end", message: completed.proxy }, 30, 10));
  assert.ok(completed.counts().descriptors <= 10);
  assert.equal(completed.counts().ownKeys, 0);

  const result = trapProxy({ tokensBefore: 10, estimatedTokensAfter: 5, summary: ignored, ...ignored });
  assert.ok(projector.captureSessionProjectionInput({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, result: result.proxy }, 30, 10));
  assert.ok(result.counts().descriptors <= 3);
  assert.equal(result.counts().ownKeys, 0);
});

test("selected JSON object and array descriptor work is preflight-bounded by remaining nodes", () => {
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
  const wideObject = trap(Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`field${index}`, index])));
  assert.equal(projector.captureSessionProjectionInput({
    type: "message_end",
    message: { role: "custom", customType: "x", content: "ok", display: true, details: wideObject.proxy },
  }, 20, 10), null);
  assert.ok(wideObject.counts().descriptors <= 20, "rejected object descriptors cannot exceed the configured node budget");
  assert.equal(wideObject.counts().ownKeys, 1);

  const wideArray = trap(Array.from({ length: 1_000 }, (_, index) => index));
  assert.equal(projector.captureSessionProjectionInput({ type: "queue_update", steering: wideArray.proxy, followUp: [] }, 20, 10), null);
  assert.ok(wideArray.counts().descriptors <= 20, "only the fixed array length descriptor is needed before rejection");
  assert.ok(wideArray.counts().ownKeys <= 1);

  assert.deepEqual(projector.captureSessionProjectionInput({
    type: "message_end",
    message: { role: "custom", customType: "x", content: "ok", display: true, details: { a: 1, b: 2 } },
  }, 30, 10).message.details, { a: 1, b: 2 });
  assert.deepEqual(projector.captureSessionProjectionInput({ type: "queue_update", steering: ["a", "b"], followUp: ["a", "b"] }, 30, 10), {
    type: "queue_update", steering: ["a", "b"], followUp: ["a", "b"],
  });
});

test("capture rejects every selected ancestor or sibling alias while ignored aliases remain discarded", () => {
  const shared = ["same"];
  assert.equal(projector.captureSessionProjectionInput({ type: "queue_update", steering: shared, followUp: shared }, 100, 10), null);
  assert.ok(projector.captureSessionProjectionInput({ type: "queue_update", steering: ["same"], followUp: ["same"] }, 100, 10));

  const nested = { value: 1 };
  assert.equal(projector.captureSessionProjectionInput({
    type: "message_end",
    message: { role: "custom", customType: "x", content: "ok", display: true, details: { first: nested, second: nested } },
  }, 100, 10), null);

  const messageRoot = { type: "message_start" };
  messageRoot.message = messageRoot;
  assert.equal(projector.captureSessionProjectionInput(messageRoot, 100, 10), null);
  const compactionRoot = { type: "compaction_end", reason: "manual", aborted: false, willRetry: false };
  compactionRoot.result = compactionRoot;
  assert.equal(projector.captureSessionProjectionInput(compactionRoot, 100, 10), null);
  assert.ok(projector.captureSessionProjectionInput({
    type: "message_start", message: { role: "assistant", model: "m", provider: "p" },
  }, 100, 10));
  assert.ok(projector.captureSessionProjectionInput({
    type: "compaction_end", reason: "manual", aborted: false, willRetry: false,
    result: { tokensBefore: 10, estimatedTokensAfter: 5 },
  }, 100, 10));

  const ignoredContent = [];
  assert.ok(projector.captureSessionProjectionInput({
    type: "message_update",
    message: { role: "assistant", provider: "p", model: "m", content: ignoredContent },
    assistantMessageEvent: { type: "start", partial: { role: "assistant", provider: "p", model: "m", content: ignoredContent } },
  }, 30, 10), "the discarded outer message does not select an ignored content alias");
});
