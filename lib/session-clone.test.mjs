import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { cloneSessionBranch, createSideSessionBranch } = await jiti.import("./session-clone.ts");
const {
  SIDE_SESSION_MARKER_CONTENT,
  SIDE_SESSION_MARKER_TYPE,
  SIDE_SESSION_POLICY_VERSION,
  classifySideSession,
} = await jiti.import("./side-session.ts");

function userMessage(content) {
  return { role: "user", content, timestamp: Date.now() };
}

function assistantMessage(text) {
  return {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function withTempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-clone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("clones exactly the selected native branch without mutating the source", (t) => {
  const sessionDir = withTempDir(t);
  const source = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
  const rootUserId = source.appendMessage(userMessage("root request"));
  const sharedAssistantId = source.appendMessage(assistantMessage("shared answer"));
  source.appendLabelChange(sharedAssistantId, "shared-label");
  const selectedUserId = source.appendMessage(userMessage("selected request"));
  const selectedAssistantId = source.appendMessage(assistantMessage("selected answer"));

  source.branch(sharedAssistantId);
  const siblingUserId = source.appendMessage(userMessage("abandoned sibling"));
  const siblingAssistantId = source.appendMessage(assistantMessage("sibling answer"));
  source.appendLabelChange(selectedUserId, "selected-label");

  const sourceFile = source.getSessionFile();
  assert.ok(sourceFile && existsSync(sourceFile));
  const sourceId = source.getSessionId();
  const sourceEntriesById = new Map(source.getEntries().map((entry) => [entry.id, entry]));
  const sourceBytesBefore = readFileSync(sourceFile);
  const filesBefore = readdirSync(sessionDir).sort();

  const result = cloneSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: sourceId,
    activeLeafId: selectedAssistantId,
  });

  assert.equal(result.status, "created");
  assert.notEqual(result.newSessionId, sourceId);
  assert.ok(existsSync(result.newSessionFile));
  assert.deepEqual(readFileSync(sourceFile), sourceBytesBefore);
  assert.equal(readdirSync(sessionDir).length, filesBefore.length + 1);

  const cloned = SessionManager.open(result.newSessionFile, sessionDir);
  const clonedEntries = cloned.getEntries();
  const clonedCoreEntries = clonedEntries.filter((entry) => entry.type !== "label");
  assert.deepEqual(
    clonedCoreEntries.map((entry) => entry.id),
    [rootUserId, sharedAssistantId, selectedUserId, selectedAssistantId],
  );
  assert.equal(clonedEntries.some((entry) => entry.id === siblingUserId || entry.id === siblingAssistantId), false);
  assert.equal(cloned.getLabel(sharedAssistantId), "shared-label");
  assert.equal(cloned.getLabel(selectedUserId), "selected-label");
  assert.equal(normalize(cloned.getHeader().parentSession), normalize(sourceFile));

  for (let index = 0; index < clonedCoreEntries.length; index += 1) {
    const clonedEntry = clonedCoreEntries[index];
    const sourceEntry = sourceEntriesById.get(clonedEntry.id);
    assert.ok(sourceEntry);
    assert.equal(clonedEntry.parentId, index === 0 ? null : clonedCoreEntries[index - 1].id);
    assert.deepEqual(
      { ...clonedEntry, parentId: sourceEntry.parentId },
      sourceEntry,
      `entry ${clonedEntry.id} changed beyond native parent re-chaining`,
    );
  }
});

test("rejects missing and invalid source leaves without creating a candidate", (t) => {
  const sessionDir = withTempDir(t);
  const source = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
  source.appendMessage(userMessage("request"));
  source.appendMessage(assistantMessage("answer"));
  const sourceFile = source.getSessionFile();
  const filesBefore = readdirSync(sessionDir).sort();

  assert.deepEqual(cloneSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: source.getSessionId(),
    activeLeafId: "missing-leaf",
  }), { status: "stale_leaf" });
  assert.deepEqual(readdirSync(sessionDir).sort(), filesBefore);

  assert.deepEqual(cloneSessionBranch({
    sourceSessionFile: join(sessionDir, "missing.jsonl"),
    sourceSessionDir: sessionDir,
    sourceSessionId: source.getSessionId(),
    activeLeafId: "missing-leaf",
  }), { status: "missing_source" });
  assert.deepEqual(readdirSync(sessionDir).sort(), filesBefore);
});

test("maps Pi's non-materialized user-only branch to nothing_to_clone", (t) => {
  const sessionDir = withTempDir(t);
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const sourceFile = join(sessionDir, `source_${sourceId}.jsonl`);
  writeFileSync(sourceFile, [
    JSON.stringify({
      type: "session",
      version: 3,
      id: sourceId,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: join(sessionDir, "cwd"),
    }),
    JSON.stringify({
      type: "message",
      id: "user-only",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "not answered" },
    }),
  ].join("\n") + "\n");

  const result = cloneSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: sourceId,
    activeLeafId: "user-only",
  });

  assert.deepEqual(result, { status: "nothing_to_clone" });
  assert.deepEqual(readdirSync(sessionDir), [`source_${sourceId}.jsonl`]);
});

test("transactionally creates a named targeted side child without mutating the source", (t) => {
  const sessionDir = withTempDir(t);
  const source = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
  source.appendMessage(userMessage("root request"));
  const firstAssistantId = source.appendMessage(assistantMessage("root answer"));
  source.appendMessage(userMessage("active request"));
  const sourceFile = source.getSessionFile();
  const sourceBytes = readFileSync(sourceFile);
  const name = "side-conversation-2026-08-11T12-34-56-789Z";

  const result = createSideSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: source.getSessionId(),
    cutoffId: firstAssistantId,
    name,
  });

  assert.equal(result.status, "created");
  assert.deepEqual(readFileSync(sourceFile), sourceBytes);
  const side = SessionManager.open(result.newSessionFile, sessionDir);
  assert.equal(side.getSessionName(), name);
  assert.equal(normalize(side.getHeader().parentSession), normalize(sourceFile));
  assert.equal(side.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === SIDE_SESSION_MARKER_TYPE).length, 1);
  const marker = side.getEntry(result.markerEntryId);
  assert.deepEqual({
    customType: marker.customType,
    content: marker.content,
    display: marker.display,
    details: marker.details,
    parentId: marker.parentId,
  }, {
    customType: SIDE_SESSION_MARKER_TYPE,
    content: SIDE_SESSION_MARKER_CONTENT,
    display: false,
    details: { version: SIDE_SESSION_POLICY_VERSION, targetSessionId: result.newSessionId },
    parentId: firstAssistantId,
  });
  assert.equal(classifySideSession(side.getEntries(), result.newSessionId, side.getLeafId()).kind, "side");
  assert.deepEqual(side.getBranch().slice(-2).map((entry) => entry.type), ["custom_message", "session_info"]);
});

test("finalizes a side after native extraction regenerates a selected label cutoff", (t) => {
  const sessionDir = withTempDir(t);
  const source = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
  source.appendMessage(userMessage("request"));
  const assistantId = source.appendMessage(assistantMessage("answer"));
  const labelId = source.appendLabelChange(assistantId, "safe cutoff");

  const result = createSideSessionBranch({
    sourceSessionFile: source.getSessionFile(),
    sourceSessionDir: sessionDir,
    sourceSessionId: source.getSessionId(),
    cutoffId: labelId,
    name: "side-conversation-2026-08-11T12-34-56-789Z",
  });

  assert.equal(result.status, "created");
  const side = SessionManager.open(result.newSessionFile, sessionDir);
  const marker = side.getEntry(result.markerEntryId);
  assert.notEqual(marker.parentId, labelId);
  assert.equal(side.getEntry(marker.parentId).type, "label");
  assert.deepEqual(
    side.getEntries().filter((entry) => entry.type !== "label" && entry.id !== result.markerEntryId && entry.type !== "session_info").map((entry) => entry.id),
    source.getBranch(labelId).filter((entry) => entry.type !== "label").map((entry) => entry.id),
  );
});

test("cleans every unadvertised side candidate when finalization fails", async (t) => {
  for (const hookName of ["afterExtract", "afterMarker", "afterName", "beforeVerify"]) {
    await t.test(hookName, (t) => {
      const sessionDir = withTempDir(t);
      const source = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
      source.appendMessage(userMessage("request"));
      const cutoffId = source.appendMessage(assistantMessage("answer"));
      const sourceFile = source.getSessionFile();
      const filesBefore = readdirSync(sessionDir).sort();
      const sourceBytes = readFileSync(sourceFile);
      const originalError = console.error;
      console.error = () => {};
      t.after(() => { console.error = originalError; });

      const result = createSideSessionBranch({
        sourceSessionFile: sourceFile,
        sourceSessionDir: sessionDir,
        sourceSessionId: source.getSessionId(),
        cutoffId,
        name: "side-conversation-2026-08-11T12-34-56-789Z",
        testHooks: { [hookName]: () => { throw new Error("injected"); } },
      });

      assert.deepEqual(result, { status: "side_failed" });
      assert.deepEqual(readdirSync(sessionDir).sort(), filesBefore);
      assert.deepEqual(readFileSync(sourceFile), sourceBytes);
    });
  }
});

test("maps missing, stale, and non-materialized side sources to bounded outcomes", (t) => {
  const sessionDir = withTempDir(t);
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const sourceFile = join(sessionDir, `source_${sourceId}.jsonl`);
  writeFileSync(sourceFile, [
    JSON.stringify({ type: "session", version: 3, id: sourceId, timestamp: "2026-01-01T00:00:00.000Z", cwd: join(sessionDir, "cwd") }),
    JSON.stringify({ type: "message", id: "user-only", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "not answered" } }),
  ].join("\n") + "\n");

  assert.deepEqual(createSideSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: sourceId,
    cutoffId: "missing",
    name: "side-conversation-2026-08-11T12-34-56-789Z",
  }), { status: "stale_cutoff" });
  assert.deepEqual(createSideSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: sourceId,
    cutoffId: "user-only",
    name: "side-conversation-2026-08-11T12-34-56-789Z",
  }), { status: "nothing_to_clone" });
  assert.deepEqual(createSideSessionBranch({
    sourceSessionFile: join(sessionDir, "missing.jsonl"),
    sourceSessionDir: sessionDir,
    sourceSessionId: sourceId,
    cutoffId: "user-only",
    name: "side-conversation-2026-08-11T12-34-56-789Z",
  }), { status: "missing_source" });
});

test("unexpected failures log only bounded clone diagnostics", (t) => {
  const sessionDir = withTempDir(t);
  const sourceFile = join(sessionDir, "broken.jsonl");
  writeFileSync(sourceFile, "not-json\n");
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args);
  t.after(() => { console.error = originalError; });

  const result = cloneSessionBranch({
    sourceSessionFile: sourceFile,
    sourceSessionDir: sessionDir,
    sourceSessionId: "bounded-source-id",
    activeLeafId: "leaf",
  });

  assert.deepEqual(result, { status: "clone_failed" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[pi-web] session_clone_failed");
  assert.deepEqual(Object.keys(logs[0][1]).sort(), ["errorName", "sourceSessionId", "stage"]);
  assert.equal(logs[0][1].sourceSessionId, "bounded-source-id");
  assert.equal(logs[0][1].stage, "eligibility");
  assert.equal(JSON.stringify(logs).includes(sessionDir), false);
});
