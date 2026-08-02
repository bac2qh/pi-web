import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const reducer = await jiti.import("./session-reducer.ts");

const epoch = "synthetic-epoch";
const message = {
  role: "assistant", provider: "fixture-provider", model: "fixture-model",
  content: [
    { type: "text", text: "hello" },
    { type: "thinking", thinking: "why", deferred: true },
    { type: "toolCall", toolCallId: "call", toolName: "fixture", input: { unicode: "雪" } },
    { type: "image", source: { type: "url", media_type: "image/png", url: "data:fixture" } },
  ],
  stopReason: "stop", timestamp: 1,
  usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};

const drafts = [
  { type: "activity_started", activity: "prompt" },
  { type: "attempt_ended", willRetry: true },
  { type: "native_settled" },
  { type: "run_settled" },
  { type: "assistant_message_started", metadata: { role: "assistant", provider: "p", model: "m", timestamp: 1 } },
  { type: "content_block_started", contentIndex: 0, blockType: "text" },
  { type: "content_delta", contentIndex: 0, deltaType: "text", delta: "雪" },
  { type: "content_block_finished", contentIndex: 0, blockType: "text" },
  { type: "content_block_finished", contentIndex: 2, blockType: "toolCall", toolCall: message.content[2] },
  { type: "assistant_terminal", reason: "stop" },
  { type: "message_completed", message },
  { type: "tool_started", toolCallId: "a", toolName: "b" },
  { type: "tool_finished", toolCallId: "a" },
  { type: "queue_replaced", steering: ["s"], followUp: ["f"] },
  { type: "retry_started", attempt: 1, maxAttempts: 3, errorMessage: "public" },
  { type: "retry_finished" },
  { type: "compaction_started", reason: "manual" },
  { type: "compaction_finished", reason: "overflow", aborted: false, tokensBefore: 100, estimatedTokensAfter: 20 },
  { type: "transcript_changed" },
  { type: "runtime_refresh_required" },
  { type: "extension_dialog_opened", dialog: { id: "d", method: "confirm", title: "T", message: "M", timeout: 5, expiresAt: 10 } },
  { type: "extension_dialog_closed", id: "d" },
  { type: "extension_custom_replaced", id: "c", lines: ["x"] },
  { type: "extension_custom_closed", id: "c" },
  { type: "extension_status_set", key: "k", text: "v" },
  { type: "extension_status_cleared", key: "k" },
  { type: "extension_widget_set", key: "w", lines: ["x"], placement: "belowEditor" },
  { type: "extension_widget_cleared", key: "w" },
  { type: "extension_title_set", title: "title" },
  { type: "notice", level: "warning", message: "notice" },
  { type: "editor_inserted", text: "insert" },
];

test("strict V1 parser accepts every logical discriminant and rejects excess/unsafe/unknown/version shapes", () => {
  drafts.forEach((draft, index) => {
    const frame = reducer.makeLogicalFrame(epoch, index + 1, draft);
    const parsed = protocol.parseProjectedSessionFrame(frame);
    assert.equal(parsed.ok, true, draft.type);
    assert.deepEqual(JSON.parse(protocol.encodeProjectedSessionFrame(frame)), frame);
  });
  const base = reducer.makeLogicalFrame(epoch, 1, drafts[0]);
  assert.deepEqual(protocol.parseProjectedSessionFrame({ ...base, extra: true }), { ok: false, reason: "malformed" });
  assert.deepEqual(protocol.parseProjectedSessionFrame({ ...base, version: 2 }), { ok: false, reason: "unsupported_version" });
  assert.deepEqual(protocol.parseProjectedSessionFrame({ ...base, type: "future" }), { ok: false, reason: "unknown_type" });
  assert.deepEqual(protocol.parseProjectedSessionFrame({ ...base, sequence: Number.MAX_SAFE_INTEGER + 1 }), { ok: false, reason: "malformed" });
  assert.deepEqual(protocol.parseProjectedSessionFrame({ ...base, streamEpoch: "" }), { ok: false, reason: "malformed" });
});

test("normalized message parser is exact and JSON-safe across display roles", () => {
  assert.deepEqual(protocol.parseNormalizedMessage(message), message);
  const roles = [
    { role: "user", content: [{ type: "text", text: "u" }], timestamp: 1 },
    { role: "toolResult", toolCallId: "id", toolName: "tool", content: [{ type: "text", text: "r" }], isError: false, details: { patch: "display diff" }, timestamp: 2 },
    { role: "custom", customType: "fixture", content: "c", display: true, details: [1], timestamp: 3 },
  ];
  roles.forEach((value) => assert.deepEqual(protocol.parseNormalizedMessage(value), value));
  assert.equal(protocol.parseNormalizedMessage({ ...message, responseId: "provider-only" }), null);
  assert.equal(protocol.parseNormalizedMessage({ ...message, stopReason: "future-provider-reason" }), null);
  assert.equal(protocol.parseNormalizedMessage({ role: "toolResult", toolCallId: "id", content: [], details: { rawResult: "forbidden" } }), null);
  assert.equal(protocol.parseNormalizedMessage({ ...message, content: [{ type: "toolCall", toolCallId: "x", toolName: "y", input: { bad: Infinity } }] }), null);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(protocol.cloneJsonSafe(cyclic), undefined);
});

test("strict parsing reconstructs canonical data and rejects accessors, symbols, hidden fields, hooks, and foreign prototypes without invocation", () => {
  const frame = reducer.makeLogicalFrame(epoch, 1, { type: "activity_started", activity: "native" });
  const parsed = protocol.parseProjectedSessionFrame(frame);
  assert.equal(parsed.ok, true);
  assert.notStrictEqual(parsed.frame, frame);
  frame.activity = "prompt";
  assert.equal(parsed.frame.activity, "native", "the parser returns a fresh canonical value");

  let getterCalls = 0;
  const getterFrame = { ...reducer.makeLogicalFrame(epoch, 1, { type: "activity_started", activity: "native" }) };
  Object.defineProperty(getterFrame, "activity", { enumerable: true, get() { getterCalls += 1; return "native"; } });
  assert.deepEqual(protocol.parseProjectedSessionFrame(getterFrame), { ok: false, reason: "malformed" });
  assert.equal(getterCalls, 0);

  for (const hostile of [
    Object.assign(reducer.makeLogicalFrame(epoch, 1, { type: "activity_started", activity: "native" }), { [Symbol("private")]: true }),
    Object.assign(Object.create({ inherited: true }), reducer.makeLogicalFrame(epoch, 1, { type: "activity_started", activity: "native" })),
  ]) assert.deepEqual(protocol.parseProjectedSessionFrame(hostile), { ok: false, reason: "malformed" });

  const hidden = reducer.makeLogicalFrame(epoch, 1, { type: "activity_started", activity: "native" });
  Object.defineProperty(hidden, "toJSON", { enumerable: false, value: () => ({ substituted: true }) });
  assert.deepEqual(protocol.parseProjectedSessionFrame(hidden), { ok: false, reason: "malformed" });
  assert.throws(() => protocol.encodeProjectedSessionFrame(hidden), /invalid_projected_session_frame/);

  const custom = { role: "custom", customType: "fixture", content: "ok", display: true, details: { safe: true } };
  const normalized = protocol.parseNormalizedMessage(custom);
  assert.notStrictEqual(normalized, custom);
  assert.notStrictEqual(normalized.details, custom.details);
  const hookedDetails = { safe: true, toJSON() { throw new Error("must not run"); } };
  assert.equal(protocol.parseNormalizedMessage({ ...custom, details: hookedDetails }), null);
});

test("projected state parser requires the exact bounded live-state shape", () => {
  const state = protocol.createInitialProjectedSessionState({ steering: ["a"], followUp: ["b"] });
  assert.deepEqual(protocol.parseProjectedSessionState(state), state);
  assert.equal(protocol.parseProjectedSessionState({ ...state, messages: [] }), null);
  assert.equal(protocol.parseProjectedSessionState({ ...state, transcriptRevision: -1 }), null);
});

test("supported depth configuration and hostile deep input fail closed without traversal escape or mutation", () => {
  assert.deepEqual(protocol.resolveProjectedSessionStateLimits({ canonicalDepthLimit: 64 }).canonicalDepthLimit, 64);
  assert.throws(() => protocol.resolveProjectedSessionStateLimits({ canonicalDepthLimit: 65 }), /invalid_projected_session_state_limits/);

  let hostile = { leaf: "bounded" };
  for (let index = 0; index < 20_000; index += 1) hostile = { nested: hostile };
  const original = hostile;
  assert.doesNotThrow(() => protocol.cloneJsonSafe(hostile));
  assert.equal(protocol.cloneJsonSafe(hostile), undefined);
  assert.equal(protocol.cloneJsonSafe(hostile, 100_000, 10_000), undefined, "direct traversal cannot opt into an unsupported recursive depth");
  assert.strictEqual(hostile, original);

  const state = {
    ...protocol.createInitialProjectedSessionState(),
    draft: {
      metadata: { role: "assistant", provider: "fixture", model: "fixture" },
      blocks: [{ contentIndex: 0, type: "toolCall", argumentsText: "{}", toolCall: {
        type: "toolCall", toolCallId: "call", toolName: "fixture", input: hostile,
      } }],
    },
  };
  assert.doesNotThrow(() => protocol.parseProjectedSessionState(state, { canonicalDepthLimit: 10_000 }));
  assert.equal(protocol.parseProjectedSessionState(state, { canonicalDepthLimit: 10_000 }), null);
  assert.strictEqual(state.draft.blocks[0].toolCall.input, hostile, "rejection never rewrites attacker-owned input");
});

test("strict clone and state parser preflight wide selected descriptors before child retrieval", () => {
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

  const directObject = trap(Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`field${index}`, index])));
  assert.equal(protocol.cloneJsonSafe(directObject.proxy, 20, 10), undefined);
  assert.ok(directObject.counts().descriptors <= 20);
  assert.equal(directObject.counts().ownKeys, 1);

  const directArray = trap(Array.from({ length: 1_000 }, (_, index) => index));
  assert.equal(protocol.cloneJsonSafe(directArray.proxy, 20, 10), undefined);
  assert.ok(directArray.counts().descriptors <= 20);
  assert.ok(directArray.counts().ownKeys <= 1);

  const parserObject = trap(Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`field${index}`, index])));
  const objectState = {
    ...protocol.createInitialProjectedSessionState(),
    draft: {
      metadata: { role: "assistant", provider: "fixture", model: "fixture" },
      blocks: [{ contentIndex: 0, type: "toolCall", argumentsText: "{}", toolCall: {
        type: "toolCall", toolCallId: "call", toolName: "fixture", input: parserObject.proxy,
      } }],
    },
  };
  assert.equal(protocol.parseProjectedSessionState(objectState, { canonicalNodeLimit: 60, canonicalDepthLimit: 10 }), null);
  assert.ok(parserObject.counts().descriptors <= 60);
  assert.equal(parserObject.counts().ownKeys, 1, "the parser reaches and preflights the selected tool input");

  const parserArray = trap(Array.from({ length: 1_000 }, (_, index) => `item-${index}`));
  const arrayState = {
    ...protocol.createInitialProjectedSessionState(),
    queue: { steering: parserArray.proxy, followUp: [] },
  };
  assert.equal(protocol.parseProjectedSessionState(arrayState, { canonicalNodeLimit: 60, canonicalDepthLimit: 10 }), null);
  assert.ok(parserArray.counts().descriptors <= 60);
  assert.ok(parserArray.counts().ownKeys <= 1);

  assert.deepEqual(protocol.cloneJsonSafe({ first: { values: [1, 2] }, second: { values: [1, 2] } }, 20, 10), {
    first: { values: [1, 2] }, second: { values: [1, 2] },
  });
});

test("strict cloning rejects repeated selected aliases and accepts distinct equal values", () => {
  const shared = { nested: [1] };
  assert.equal(protocol.cloneJsonSafe({ first: shared, second: shared }), undefined);
  assert.equal(protocol.cloneJsonSafe([shared, shared]), undefined);
  assert.deepEqual(protocol.cloneJsonSafe({ first: { nested: [1] }, second: { nested: [1] } }), {
    first: { nested: [1] }, second: { nested: [1] },
  });
});
