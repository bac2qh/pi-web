import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const { PI_WEB_OPENAI_FAST_MODE_STATUS_KEY } = await jiti.import("./openai-fast-mode-status.ts");
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
  { type: "extension_status_set", key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unknown" },
  { type: "extension_status_cleared", key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY },
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
    const canonical = protocol.freezeCanonicalData(parsed.frame);
    const encoded = protocol.encodeProjectedSessionFrame(canonical);
    assert.deepEqual(
      protocol.createBoundedProjectedSessionFrameEncoder(Buffer.byteLength(encoded))(canonical),
      { ok: true, text: encoded, bytes: Buffer.byteLength(encoded) },
      `${draft.type} has one byte-identical bounded V1 encoding`,
    );
  });
  for (const frame of [
    {
      protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: 1, streamEpoch: epoch, sequence: 1,
      type: "snapshot_start", transferId: "transfer", reason: "recovery", partCount: 1, byteLength: 1,
      transcriptRefreshRequired: true, runtimeRefreshRequired: true,
    },
    {
      protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: 1, streamEpoch: epoch, sequence: 1,
      type: "snapshot_chunk", transferId: "transfer", partIndex: 0, data: "eA",
    },
    {
      protocol: protocol.PROJECTED_SESSION_PROTOCOL, version: 1, streamEpoch: epoch, sequence: 1,
      type: "snapshot_end", transferId: "transfer",
    },
  ]) {
    const parsed = protocol.parseProjectedSessionFrame(frame);
    assert.equal(parsed.ok, true, frame.type);
    const canonical = protocol.freezeCanonicalData(parsed.frame);
    const encoded = protocol.encodeProjectedSessionFrame(canonical);
    assert.deepEqual(protocol.createBoundedProjectedSessionFrameEncoder(Buffer.byteLength(encoded))(canonical), {
      ok: true, text: encoded, bytes: Buffer.byteLength(encoded),
    });
  }
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

test("bounded projected encoder is byte-identical and stops at exact UTF-8 boundaries", () => {
  const values = [
    "ascii\\\"\\b\\f\\n\\r\\t",
    "雪🙂",
    "\ud83d",
    "\ude42",
    "\ud83d\ude42",
    String.fromCharCode(0, 1, 31),
  ];
  for (const delta of values) {
    const parsed = protocol.parseProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 1, {
      type: "content_delta", contentIndex: 0, deltaType: "text", delta,
    }));
    assert.equal(parsed.ok, true);
    const frame = protocol.freezeCanonicalData(parsed.frame);
    const expected = protocol.encodeProjectedSessionFrame(frame);
    const bytes = Buffer.byteLength(expected);
    const exact = protocol.createBoundedProjectedSessionFrameEncoder(bytes);
    const oneUnder = protocol.createBoundedProjectedSessionFrameEncoder(bytes - 1);
    assert.deepEqual(exact(frame), { ok: true, text: expected, bytes });
    assert.deepEqual(exact(frame), { ok: true, text: expected, bytes }, "immutable identity is safely reusable");
    assert.deepEqual(oneUnder(frame), { ok: false, reason: "over_limit" });
  }

  const huge = protocol.freezeCanonicalData(protocol.parseProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 1, {
    type: "notice", level: "info", message: "雪🙂\\\"".repeat(2_000_000),
  })).frame);
  const bounded = protocol.createBoundedProjectedSessionFrameEncoder(512)(huge);
  assert.deepEqual(bounded, { ok: false, reason: "over_limit" });
});

test("trusted canonical bounded encoding stops before wide tails and shares a safe weak cache", () => {
  const observeTraversal = (target, operation) => {
    const originalDescriptor = Object.getOwnPropertyDescriptor;
    const originalOwnKeys = Reflect.ownKeys;
    let descriptors = 0;
    let ownKeys = 0;
    Object.getOwnPropertyDescriptor = (value, key) => {
      if (value === target) descriptors += 1;
      return originalDescriptor(value, key);
    };
    Reflect.ownKeys = (value) => {
      if (value === target) ownKeys += 1;
      return originalOwnKeys(value);
    };
    try { return { result: operation(), counts: () => ({ descriptors, ownKeys }) }; }
    finally {
      Object.getOwnPropertyDescriptor = originalDescriptor;
      Reflect.ownKeys = originalOwnKeys;
    }
  };

  const parsedObject = protocol.parseProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 1, {
    type: "message_completed",
    message: { role: "custom", customType: "fixture", content: "visible", display: true, details: {
      prefix: "x".repeat(2_000),
      ...Object.fromEntries(Array.from({ length: 5_000 }, (_, index) => [`tail${index}`, index])),
    } },
  }));
  assert.equal(parsedObject.ok, true);
  const objectTarget = parsedObject.frame.message.details;
  const objectObservation = observeTraversal(objectTarget, () => protocol.createBoundedProjectedSessionFrameEncoder(512)(parsedObject.frame));
  assert.deepEqual(objectObservation.result, { ok: false, reason: "over_limit" });
  assert.deepEqual(objectObservation.counts(), { descriptors: 1, ownKeys: 1 }, "one bounded key list but no tail descriptor is retrieved");

  const parsedArray = protocol.parseProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 2, {
    type: "queue_replaced",
    steering: ["x".repeat(2_000), ...Array.from({ length: 5_000 }, (_, index) => `tail-${index}`)],
    followUp: [],
  }));
  assert.equal(parsedArray.ok, true);
  const arrayTarget = parsedArray.frame.steering;
  const arrayObservation = observeTraversal(arrayTarget, () => protocol.createBoundedProjectedSessionFrameEncoder(512)(parsedArray.frame));
  assert.deepEqual(arrayObservation.result, { ok: false, reason: "over_limit" });
  assert.deepEqual(arrayObservation.counts(), { descriptors: 2, ownKeys: 0 }, "only length and the oversized first element are inspected");

  const parsedFitting = protocol.parseProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 3, {
    type: "queue_replaced", steering: ["雪🙂", "\ud83d"], followUp: ["ok"],
  }));
  assert.equal(parsedFitting.ok, true);
  const expected = protocol.encodeProjectedSessionFrame(parsedFitting.frame);
  const encoder = protocol.createBoundedProjectedSessionFrameEncoder(Buffer.byteLength(expected));
  const fittingTarget = parsedFitting.frame.steering;
  const fittingObservation = observeTraversal(fittingTarget, () => {
    assert.deepEqual(encoder(parsedFitting.frame), { ok: true, text: expected, bytes: Buffer.byteLength(expected) });
    assert.deepEqual(encoder(parsedFitting.frame), { ok: true, text: expected, bytes: Buffer.byteLength(expected) });
  });
  assert.deepEqual(fittingObservation.counts(), { descriptors: 3, ownKeys: 1 }, "the second call uses the trusted-identity cache");
});

test("externally marked stateful proxies never gain trusted identity caching", () => {
  const child = { role: "custom", customType: "fixture", content: "one", display: true };
  const target = reducer.makeLogicalFrame(epoch, 4, { type: "message_completed", message: child });
  let ownKeyCalls = 0;
  const root = new Proxy(target, {
    ownKeys(inner) {
      ownKeyCalls += 1;
      const keys = Reflect.ownKeys(inner);
      return ownKeyCalls === 1 ? keys.filter((key) => key !== "message") : keys;
    },
  });
  protocol.freezeCanonicalData(root);
  assert.equal(Object.isFrozen(root), true);
  assert.equal(Object.isFrozen(child), false, "the proxy hid its mutable child from the exported freeze traversal");
  assert.equal(protocol.parseProjectedSessionFrame(root).ok, true);

  const encoder = protocol.createBoundedProjectedSessionFrameEncoder(10_000);
  const first = encoder(root);
  assert.equal(first.ok, true);
  assert.equal(JSON.parse(first.text).message.content, "one");
  child.content = "two";
  const ordinary = protocol.encodeProjectedSessionFrame(root);
  const second = encoder(root);
  assert.equal(second.ok, true);
  assert.equal(second.text, ordinary, "bounded output comes from its one strict reconstructed view");
  assert.equal(JSON.parse(second.text).message.content, "two", "no stale success is cached by the proxy identity");
  child.content = Symbol("invalid");
  assert.deepEqual(protocol.parseProjectedSessionFrame(root), { ok: false, reason: "malformed" });
  assert.throws(() => encoder(root), /invalid_projected_session_frame:malformed/, "a later malformed view cannot reuse prior output");
});

test("alternating proxy key order is reconstructed once before fitting bounded serialization", () => {
  const detailsTarget = { alpha: 1, beta: 2, gamma: 3 };
  const orders = [
    ["alpha", "beta", "gamma"],
    ["beta", "gamma", "alpha"],
    ["gamma", "alpha", "beta"],
  ];
  let ownKeyCalls = 0;
  const details = new Proxy(detailsTarget, {
    ownKeys() { return orders[ownKeyCalls++ % orders.length]; },
  });
  const frame = reducer.makeLogicalFrame(epoch, 5, {
    type: "message_completed",
    message: { role: "custom", customType: "fixture", content: "visible", display: true, details },
  });
  protocol.freezeCanonicalData(frame);
  const encoder = protocol.createBoundedProjectedSessionFrameEncoder(10_000);

  const expectedThirdOrder = protocol.encodeProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 5, {
    type: "message_completed",
    message: { role: "custom", customType: "fixture", content: "visible", display: true, details: { gamma: 3, alpha: 1, beta: 2 } },
  }));
  const first = encoder(frame);
  assert.deepEqual(first, { ok: true, text: expectedThirdOrder, bytes: Buffer.byteLength(expectedThirdOrder) });

  const expectedFirstOrder = protocol.encodeProjectedSessionFrame(reducer.makeLogicalFrame(epoch, 5, {
    type: "message_completed",
    message: { role: "custom", customType: "fixture", content: "visible", display: true, details: { alpha: 1, beta: 2, gamma: 3 } },
  }));
  const second = encoder(frame);
  assert.deepEqual(second, { ok: true, text: expectedFirstOrder, bytes: Buffer.byteLength(expectedFirstOrder) });
  assert.notEqual(second.text, first.text, "the untrusted proxy identity has no stale wire cache");

  let getterCalls = 0;
  const malformed = reducer.makeLogicalFrame(epoch, 6, { type: "activity_started", activity: "native" });
  Object.defineProperty(malformed, "activity", { enumerable: true, get() { getterCalls += 1; return "native"; } });
  protocol.freezeCanonicalData(malformed);
  assert.throws(() => encoder(malformed), /invalid_projected_session_frame:malformed/);
  assert.equal(getterCalls, 0, "strict reconstruction rejects accessors without invocation");
});
