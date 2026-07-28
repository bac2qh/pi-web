import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper, getRpcSession } = await jiti.import("./rpc-manager.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");
const { POST: postAgentCommand } = await jiti.import("../app/api/agent/[id]/route.ts");

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

function createSource(t) {
  const sessionDir = mkdtempSync(join(tmpdir(), "pi-web-rpc-clone-"));
  t.after(() => rmSync(sessionDir, { recursive: true, force: true }));
  const manager = SessionManager.create(join(sessionDir, "cwd"), sessionDir);
  manager.appendMessage(userMessage("request"));
  const leafId = manager.appendMessage(assistantMessage("answer"));
  return { sessionDir, manager, leafId };
}

function fakeInner(manager, state = {}) {
  return {
    get sessionId() { return manager.getSessionId(); },
    get sessionFile() { return manager.getSessionFile(); },
    get isStreaming() { return state.isStreaming ?? false; },
    get isCompacting() { return state.isCompacting ?? false; },
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    pendingMessageCount: 0,
    sessionManager: manager,
    agent: { state: {} },
    extensionRunner: {},
    bindExtensions: state.bindExtensions,
    prompt: state.prompt ?? (async () => {}),
    compact: state.compact ?? (async () => ({})),
    getContextUsage: () => undefined,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
  };
}

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFileAsync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("clone keeps the live source wrapper and manager unchanged", async (t) => {
  const { sessionDir, manager, leafId } = createSource(t);
  const wrapper = new AgentSessionWrapper(fakeInner(manager));
  t.after(() => wrapper.destroy());
  const sourceFile = manager.getSessionFile();
  assert.ok(sourceFile && existsSync(sourceFile));
  const sourceId = manager.getSessionId();
  const sourceBytes = readFileSync(sourceFile);
  const cacheGenerationBefore = globalThis.__piSessionListGeneration ?? 0;

  const result = await wrapper.send({ type: "clone", activeLeafId: leafId });

  assert.equal(result.created, true);
  assert.notEqual(result.newSessionId, sourceId);
  assert.equal(wrapper.isAlive(), true);
  assert.equal(manager.getSessionId(), sourceId);
  assert.equal(manager.getLeafId(), leafId);
  assert.deepEqual(readFileSync(sourceFile), sourceBytes);
  assert.equal(readdirSync(sessionDir).length, 2);
  assert.equal(globalThis.__piSessionListGeneration, cacheGenerationBefore + 1);
  const clonedPath = await resolveSessionPath(result.newSessionId);
  assert.ok(clonedPath && existsSync(clonedPath));
});

test("clone rejects streaming and compaction as busy", async (t) => {
  const { manager, leafId } = createSource(t);

  for (const state of [{ isStreaming: true }, { isCompacting: true }]) {
    const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
    const result = await wrapper.send({ type: "clone", activeLeafId: leafId });
    assert.deepEqual(result, { created: false, reason: "busy" });
    wrapper.destroy();
  }
});

test("clone rejects a stale displayed leaf without writing", async (t) => {
  const { sessionDir, manager } = createSource(t);
  const wrapper = new AgentSessionWrapper(fakeInner(manager));
  t.after(() => wrapper.destroy());
  const filesBefore = readdirSync(sessionDir).sort();

  const result = await wrapper.send({ type: "clone", activeLeafId: "stale-browser-leaf" });

  assert.deepEqual(result, { created: false, reason: "stale_leaf" });
  assert.deepEqual(readdirSync(sessionDir).sort(), filesBefore);
});

test("failed extension binding rolls back the accepted prompt running claim", async (t) => {
  const { manager } = createSource(t);
  let rejectBinding;
  const binding = new Promise((_, reject) => { rejectBinding = reject; });
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    bindExtensions: async () => binding,
  }));
  t.after(() => wrapper.destroy());
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });
  wrapper.beginExtensionBinding();

  const acceptedPrompt = wrapper.send({ type: "prompt", message: "continue" });
  assert.equal(wrapper.isRunning(), true);
  rejectBinding(new Error("binding failed"));
  await assert.rejects(acceptedPrompt, /binding failed/);
  assert.equal(wrapper.isRunning(), false);
});

test("accepted prompts claim running state before extension binding completes", async (t) => {
  const { sessionDir, manager, leafId } = createSource(t);
  let resolveBinding;
  const binding = new Promise((resolve) => { resolveBinding = resolve; });
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  const inner = fakeInner(manager, {
    bindExtensions: async () => binding,
    prompt: async () => prompt,
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.beginExtensionBinding();
  const filesBefore = readdirSync(sessionDir).sort();

  const acceptedPrompt = wrapper.send({ type: "prompt", message: "continue" });
  assert.equal(wrapper.isRunning(), true);
  assert.deepEqual(
    await wrapper.send({ type: "clone", activeLeafId: leafId }),
    { created: false, reason: "busy" },
  );
  assert.deepEqual(readdirSync(sessionDir).sort(), filesBefore);

  resolveBinding();
  await acceptedPrompt;
  assert.equal(wrapper.isRunning(), true);
  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.isRunning(), false);
});

test("overlapping accepted prompts retain independent running claims", async (t) => {
  const { manager, leafId } = createSource(t);
  const promptResolvers = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    prompt: async () => new Promise((resolve) => { promptResolvers.push(resolve); }),
  }));
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "prompt", message: "first" });
  await wrapper.send({ type: "prompt", message: "second" });
  assert.equal(promptResolvers.length, 2);
  assert.equal(wrapper.isRunning(), true);

  // Settle out of submission order: either claim may finish first without
  // releasing the other accepted prompt's busy state.
  promptResolvers[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.isRunning(), true);
  assert.equal((await wrapper.send({ type: "get_state" })).isPromptRunning, true);
  assert.deepEqual(
    await wrapper.send({ type: "clone", activeLeafId: leafId }),
    { created: false, reason: "busy" },
  );

  promptResolvers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.isRunning(), false);
  assert.equal((await wrapper.send({ type: "get_state" })).isPromptRunning, false);
});

test("compaction claims busy state before the native flag changes", async (t) => {
  const { manager, leafId } = createSource(t);
  let resolveCompaction;
  const compaction = new Promise((resolve) => { resolveCompaction = resolve; });
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    isCompacting: false,
    compact: async () => compaction,
  }));
  t.after(() => wrapper.destroy());

  const activeCompaction = wrapper.send({ type: "compact" });
  assert.equal(wrapper.isRunning(), true);
  assert.equal((await wrapper.send({ type: "get_state" })).isCompacting, true);
  assert.deepEqual(
    await wrapper.send({ type: "clone", activeLeafId: leafId }),
    { created: false, reason: "busy" },
  );

  resolveCompaction({ compacted: true });
  await activeCompaction;
  assert.equal(wrapper.isRunning(), false);
  assert.equal((await wrapper.send({ type: "get_state" })).isCompacting, false);
});

test("cold agent commands reject and evict a deleted cached session path", async (t) => {
  const sessionDir = mkdtempSync(join(tmpdir(), "pi-web-cold-missing-"));
  t.after(() => rmSync(sessionDir, { recursive: true, force: true }));
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const missingPath = join(sessionDir, "deleted.jsonl");
  cacheSessionPath(sessionId, missingPath);
  t.after(() => invalidateSessionPathCache(sessionId));

  const response = await postAgentCommand(new Request(`http://localhost/api/agent/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clone", activeLeafId: "leaf" }),
  }), { params: Promise.resolve({ id: sessionId }) });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
  assert.equal(globalThis.__piSessionPathCache?.has(sessionId), false);
  assert.equal(getRpcSession(sessionId), undefined);
  assert.equal(await resolveSessionPath(sessionId), null);
});
