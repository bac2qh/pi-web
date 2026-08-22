import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./message-display.ts");
}

function assistant(content) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content,
  };
}

test("splits trailing final answer blocks from process blocks", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
    { type: "image", source: { type: "url", url: "https://example.com/final.png" } },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text", "image"]);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking", "toolCall"]);
});

test("keeps pre-tool text in process blocks", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "text", text: "I will inspect the repo first." },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.equal(result.answerBlocks[0].text, "Final answer");
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["text", "toolCall"]);
});

test("does not expose text before a trailing tool call as final answer", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "work through it" },
    { type: "text", text: "I need to call a tool." },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.answerBlocks, []);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking", "text", "toolCall"]);
});

test("drops empty thinking blocks after completion", async () => {
  const { getDisplayableAssistantBlocks, splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["text"],
  );

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });
  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.deepEqual(result.processBlocks, []);
});

test("keeps empty thinking while streaming", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "text", text: "Partial answer" },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: true });

  assert.deepEqual(result.answerBlocks.map((block) => block.type), ["text"]);
  assert.deepEqual(result.processBlocks.map((block) => block.type), ["thinking"]);
});

test("keeps deferred historical thinking placeholders", async () => {
  const { getDisplayableAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "", deferred: true },
    { type: "text", text: "Final answer" },
  ]);

  assert.deepEqual(
    getDisplayableAssistantBlocks(message, { isStreaming: false }).map((block) => block.type),
    ["thinking", "text"],
  );
});

test("preserves original content positions when final answer blocks are split", async () => {
  const { splitFinalAssistantBlocks } = await loadSubject();
  const message = assistant([
    { type: "thinking", thinking: "" },
    { type: "thinking", thinking: "work through it" },
    { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: {} },
    { type: "text", text: "Final answer" },
    { type: "image", source: { type: "url", url: "https://example.com/final.png" } },
  ]);

  const result = splitFinalAssistantBlocks(message, { isStreaming: false });

  assert.deepEqual(result.processBlockIndices, [1, 2]);
  assert.deepEqual(result.answerBlockIndices, [3, 4]);
});

test("keeps completed text identity stable when the entry id arrives", async () => {
  const { buildAssistantBlockKey } = await loadSubject();
  const provisional = buildAssistantBlockKey("text", {
    sessionId: "session-1",
    messageTimestamp: 1_725_000_000_123,
    originalIndex: 2,
  });
  const reconciled = buildAssistantBlockKey("text", {
    sessionId: "session-1",
    entryId: "entry-1",
    messageTimestamp: 1_725_000_000_123,
    originalIndex: 2,
  });

  assert.equal(reconciled, provisional);
  assert.notEqual(
    provisional,
    buildAssistantBlockKey("text", {
      sessionId: "session-1",
      entryId: "entry-2",
      messageTimestamp: 1_725_000_000_124,
      originalIndex: 2,
    }),
  );
  assert.notEqual(
    provisional,
    buildAssistantBlockKey("text", {
      sessionId: "session-1",
      entryId: "entry-1",
      messageTimestamp: 1_725_000_000_123,
      originalIndex: 3,
    }),
  );
});

test("shares the existing edit-tool recognition policy without broadening near matches", async () => {
  const { containsEditToolCall, isEditToolName } = await loadSubject();
  const recognized = [
    "edit",
    "EDIT",
    "edit_file",
    "workspace.edit",
    "file_edit",
    "mcp_str_replace_based_edit_tool",
    "replace_editor",
  ];
  const unrecognized = [
    "editor",
    "editing",
    "credit",
    "file.edit.preview",
    "string-replace",
    "replacement-editor",
    "write",
  ];

  for (const name of recognized) assert.equal(isEditToolName(name), true, name);
  for (const name of unrecognized) assert.equal(isEditToolName(name), false, name);
  assert.equal(containsEditToolCall([
    { type: "thinking", thinking: "inspect" },
    { type: "toolCall", toolCallId: "call-1", toolName: "workspace.edit", input: {} },
  ]), true);
  assert.equal(containsEditToolCall([
    { type: "toolCall", toolCallId: "call-2", toolName: "editor", input: {} },
    { type: "text", text: "done" },
  ]), false);
});

test("retains entry isolation for non-text and timestamp-less blocks", async () => {
  const { buildAssistantBlockKey } = await loadSubject();
  const provisionalThinking = buildAssistantBlockKey("thinking", {
    sessionId: "session-1",
    messageTimestamp: 1_725_000_000_123,
    originalIndex: 0,
  });
  const reconciledThinking = buildAssistantBlockKey("thinking", {
    sessionId: "session-1",
    entryId: "entry-1",
    messageTimestamp: 1_725_000_000_123,
    originalIndex: 0,
  });
  const provisionalLegacyText = buildAssistantBlockKey("text", {
    sessionId: "session-1",
    originalIndex: 1,
  });
  const reconciledLegacyText = buildAssistantBlockKey("text", {
    sessionId: "session-1",
    entryId: "entry-1",
    originalIndex: 1,
  });

  assert.notEqual(reconciledThinking, provisionalThinking);
  assert.notEqual(reconciledLegacyText, provisionalLegacyText);
  assert.notEqual(
    reconciledThinking,
    buildAssistantBlockKey("thinking", {
      sessionId: "session-2",
      entryId: "entry-1",
      messageTimestamp: 1_725_000_000_123,
      originalIndex: 0,
    }),
  );
});
