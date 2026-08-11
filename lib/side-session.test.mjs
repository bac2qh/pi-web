import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SIDE_SESSION_COMPACTION_NOTICE,
  SIDE_SESSION_MARKER_CONTENT,
  SIDE_SESSION_MARKER_TYPE,
  SIDE_SESSION_POLICY_VERSION,
  SIDE_SESSION_SYSTEM_PROMPT,
  appendSideSystemPrompt,
  classifySideSession,
  extensionMatchesSideSessionExclusion,
  isEntryDescendantOrSelf,
  projectSideSessionContext,
  projectSideSessionTree,
  selectSideSessionCutoff,
  sideConversationName,
  sideNavigationAllowed,
} = await jiti.import("./side-session.ts");

const timestamp = "2026-08-11T12:34:56.789Z";
function user(id, parentId, content = id) {
  return { type: "message", id, parentId, timestamp, message: { role: "user", content } };
}
function assistant(id, parentId, content = [{ type: "text", text: id }]) {
  return { type: "message", id, parentId, timestamp, message: { role: "assistant", provider: "test", model: "test", content } };
}
function result(id, parentId, toolCallId, extra = {}) {
  return { type: "message", id, parentId, timestamp, message: { role: "toolResult", toolCallId, content: [{ type: "text", text: id }], ...extra } };
}
function metadata(id, parentId, type = "thinking_level_change") {
  return type === "thinking_level_change"
    ? { type, id, parentId, timestamp, thinkingLevel: "high" }
    : { type: "custom", id, parentId, timestamp, customType: "fixture" };
}
function marker(id, parentId, targetSessionId = "side-id", overrides = {}) {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp,
    customType: SIDE_SESSION_MARKER_TYPE,
    content: SIDE_SESSION_MARKER_CONTENT,
    display: false,
    details: { version: SIDE_SESSION_POLICY_VERSION, targetSessionId },
    ...overrides,
  };
}

function chain(...entries) {
  return entries.map((entry, index) => ({ ...entry, parentId: index === 0 ? null : entries[index - 1].id }));
}

test("selects text, active-user, and complete tool-batch snapshot cutoffs", () => {
  let branch = chain(user("u1"), assistant("a1"));
  assert.deepEqual(selectSideSessionCutoff(branch), { status: "selected", cutoffId: "a1" });

  branch = chain(user("u1"), assistant("a1"), user("u2"));
  assert.deepEqual(selectSideSessionCutoff(branch), { status: "selected", cutoffId: "u2" });

  branch = chain(
    user("u1"),
    assistant("a1"),
    user("u2"),
    assistant("a2", null, [
      { type: "toolCall", id: "call-a", name: "read", arguments: {} },
      { type: "toolCall", toolCallId: "call-b", toolName: "bash", input: {} },
    ]),
    metadata("m1"),
    result("r2", null, "call-b"),
    result("r1", null, "call-a", { isError: true }),
  );
  assert.deepEqual(selectSideSessionCutoff(branch), { status: "selected", cutoffId: "r1" });
});

test("cuts an unresolved tool batch and all partial results at the assistant parent", () => {
  const branch = chain(
    user("u1"), assistant("a1"), user("u2"),
    assistant("a2", null, [
      { type: "toolCall", id: "call-a", name: "read", arguments: {} },
      { type: "toolCall", id: "call-b", name: "read", arguments: {} },
    ]),
    result("r1", null, "call-a"),
  );
  assert.deepEqual(selectSideSessionCutoff(branch), { status: "selected", cutoffId: "u2" });
  assert.deepEqual(selectSideSessionCutoff(chain(user("u1"))), {
    status: "unavailable", reason: "no_safe_assistant",
  });

  const continuedAfterAbort = chain(
    user("u1"), assistant("a1"), user("u2"),
    assistant("a2", null, [
      { type: "toolCall", id: "call-a", name: "read", arguments: {} },
      { type: "toolCall", id: "call-b", name: "read", arguments: {} },
    ]),
    result("r1", null, "call-a"),
    user("u3"), assistant("a3"),
  );
  assert.deepEqual(selectSideSessionCutoff(continuedAfterAbort), {
    status: "selected", cutoffId: "u2",
  });
});

test("refuses malformed call and result normalization instead of guessing", () => {
  const malformedTails = [
    [assistant("a2", null, [{ type: "toolCall", id: "", name: "read", arguments: {} }])],
    [assistant("a2", null, [{ type: "toolCall", id: "a", toolCallId: "b", name: "read", arguments: {} }])],
    [assistant("a2", null, [
      { type: "toolCall", id: "a", name: "read", arguments: {} },
      { type: "toolCall", id: "a", name: "read", arguments: {} },
    ])],
    [assistant("a2", null, [{ type: "toolCall", id: "a", name: "read", arguments: {} }]), result("r1", null, "foreign")],
    [assistant("a2", null, [{ type: "toolCall", id: "a", name: "read", arguments: {} }]), result("r1", null, "a"), result("r2", null, "a")],
    [result("orphan", null, "a")],
  ];
  for (const tail of malformedTails) {
    const branch = chain(user("u1"), assistant("a1"), user("u2"), ...tail);
    assert.deepEqual(selectSideSessionCutoff(branch), {
      status: "refused", reason: "malformed_tool_batch",
    });
  }

  const broken = [user("u1", null), assistant("a1", "missing")];
  assert.deepEqual(selectSideSessionCutoff(broken), { status: "refused", reason: "malformed_entries" });
});

test("classifies only one exact own-session marker and fails closed on reserved corruption", () => {
  const entries = chain(user("u1"), assistant("a1"), marker("boundary"), { type: "session_info", id: "name", timestamp, name: "side" });
  assert.deepEqual(classifySideSession(entries, "side-id", "name"), {
    kind: "side",
    metadata: { markerEntryId: "boundary", targetSessionId: "side-id" },
  });
  assert.deepEqual(classifySideSession(entries, "other-id", "name"), { kind: "ordinary" });
  assert.deepEqual(classifySideSession(entries.slice(0, 2), "side-id", "a1"), { kind: "ordinary" });

  const malformed = [...entries.slice(0, 2), marker("bad", "a1", "side-id", { display: true })];
  assert.deepEqual(classifySideSession(malformed, "side-id", "bad"), { kind: "invalid", reason: "malformed_marker" });
  assert.deepEqual(classifySideSession([...entries, marker("again", "name")], "side-id", "again"), {
    kind: "invalid", reason: "duplicate_marker",
  });

  const branchEntries = [
    user("u1", null),
    assistant("a1", "u1"),
    marker("boundary", "a1"),
    user("side-user", "boundary"),
    user("sibling", "a1"),
  ];
  assert.deepEqual(classifySideSession(branchEntries, "side-id", "sibling"), {
    kind: "invalid", reason: "marker_off_branch",
  });
  const cyclic = [user("cycle-a", "cycle-b"), assistant("cycle-b", "cycle-a")];
  assert.deepEqual(classifySideSession(cyclic, "side-id", "cycle-b"), {
    kind: "invalid", reason: "malformed_entries",
  });
});

test("enforces marker-descendant navigation and allows same-file side branches", () => {
  const entries = [
    user("u1", null), assistant("a1", "u1"), marker("boundary", "a1"),
    user("side-a", "boundary"), assistant("side-a-answer", "side-a"),
    user("side-b", "boundary"),
  ];
  const side = { markerEntryId: "boundary", targetSessionId: "side-id" };
  assert.equal(isEntryDescendantOrSelf(entries, "boundary", "side-a-answer"), true);
  assert.equal(sideNavigationAllowed(entries, side, "side-a"), true);
  assert.equal(sideNavigationAllowed(entries, side, "side-b"), true);
  assert.equal(sideNavigationAllowed(entries, side, "boundary"), false);
  assert.equal(sideNavigationAllowed(entries, side, "a1"), false);
});

test("projects only the post-boundary transcript and replaces compaction summaries", () => {
  const entries = [
    user("u1", null), assistant("a1", "u1"), marker("boundary", "a1"),
    user("u2", "boundary"),
    {
      type: "compaction", id: "cmp", parentId: "u2", timestamp,
      summary: "private inherited summary", firstKeptEntryId: "a1", tokensBefore: 100,
    },
    assistant("a2", "cmp"),
  ];
  const context = {
    messages: [
      { role: "custom", customType: "compaction", content: "private inherited summary", display: true },
      { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "side answer" }] },
      { role: "assistant", provider: "test", model: "test", content: [{ type: "text", text: "inherited answer" }] },
    ],
    entryIds: ["cmp", "a2", "a1"],
    thinkingLevel: "high",
    model: null,
  };
  const projected = projectSideSessionContext(context, entries, { markerEntryId: "boundary", targetSessionId: "side-id" });
  assert.deepEqual(projected.entryIds, ["cmp", "a2"]);
  assert.equal(projected.messages[0].content, SIDE_SESSION_COMPACTION_NOTICE);
  assert.equal(JSON.stringify(projected).includes("private inherited summary"), false);
  assert.equal(JSON.stringify(projected).includes("inherited answer"), false);
});

test("projects the branch tree from the marker children", () => {
  const inherited = user("u1", null);
  const boundary = marker("boundary", "u1");
  const sideA = user("side-a", "boundary");
  const sideB = user("side-b", "boundary");
  const roots = [{ entry: inherited, children: [{ entry: boundary, children: [
    { entry: sideA, children: [] },
    { entry: sideB, children: [] },
  ] }] }];
  const projected = projectSideSessionTree(roots, { markerEntryId: "boundary", targetSessionId: "side-id" });
  assert.deepEqual(projected.map((node) => node.entry.id), ["side-a", "side-b"]);
  assert.deepEqual(projected.map((node) => node.entry.parentId), [null, null]);
});

test("filters exact launching extensions, preserves near names, and appends policy idempotently", () => {
  const extension = (tools = [], commands = []) => ({ tools: new Map(tools.map((name) => [name, {}])), commands: new Map(commands.map((name) => [name, {}])) });
  assert.equal(extensionMatchesSideSessionExclusion(extension(["subagent"])), true);
  assert.equal(extensionMatchesSideSessionExclusion(extension([], ["start-implementation"])), true);
  assert.equal(extensionMatchesSideSessionExclusion(extension([], ["open-implementation"])), true);
  assert.equal(extensionMatchesSideSessionExclusion(extension([], ["orchestrate-implementation"])), true);
  assert.equal(extensionMatchesSideSessionExclusion(extension(["subagent-helper"], ["start-implementation-later"])), false);
  assert.deepEqual(appendSideSystemPrompt(["base"]), ["base", SIDE_SESSION_SYSTEM_PROMPT]);
  assert.deepEqual(appendSideSystemPrompt(["base", SIDE_SESSION_SYSTEM_PROMPT]), ["base", SIDE_SESSION_SYSTEM_PROMPT]);
  assert.equal(sideConversationName(new Date(timestamp)), "side-conversation-2026-08-11T12-34-56-789Z");
});
