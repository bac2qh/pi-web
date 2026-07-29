import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  AgentSessionWrapper,
  getOrCreateRpcSession,
  getRpcSession,
  getSessionListRefreshGeneration,
  notifySessionListRefresh,
  subscribeSessionListRefresh,
} = await jiti.import("./rpc-manager.ts");
const { HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL } = await jiti.import("./hosted-implementation-session.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");
const { POST: postAgentCommand } = await jiti.import("../app/api/agent/[id]/route.ts");
const { GET: getRunningEvents } = await jiti.import("../app/api/agent/running/events/route.ts");

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
    subscribe: state.subscribe ?? (() => () => {}),
    dispose: state.dispose ?? (() => { state.disposeCalls = (state.disposeCalls ?? 0) + 1; }),
    prompt: state.prompt ?? (async () => {}),
    abort: state.abort ?? (async () => { state.abortCalls = (state.abortCalls ?? 0) + 1; }),
    steer: state.steer ?? (async (message) => { (state.steerCalls ??= []).push(message); }),
    followUp: state.followUp ?? (async (message) => { (state.followUpCalls ??= []).push(message); }),
    compact: state.compact ?? (async () => ({})),
    getContextUsage: () => undefined,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
  };
}

test("process cleanup invalidates hosted callbacks before destroying registered owners", async () => {
  const source = await readFileAsync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const cleanup = source.slice(source.indexOf("const cleanup = () =>"), source.indexOf("process.once(\"exit\", cleanup)"));
  assert.ok(cleanup.indexOf("invalidateHostedImplementationCapability()") >= 0);
  assert.ok(cleanup.indexOf("session.destroy()") > cleanup.indexOf("invalidateHostedImplementationCapability()"));
});

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

function noOpHostedLifecycle() {
  return {
    ownershipAccepted() {},
    kickoffScheduled() {},
    kickoffDispatched() {},
    targetSettled() {},
    targetFailed() {},
    ownerCleanedUp() {},
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("shared startup promise publishes one wrapper for overlapping launch and selection", async (t) => {
  const { manager } = createSource(t);
  const state = {};
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  const sessionId = manager.getSessionId();
  let resolvePreparation;
  let preparationCalls = 0;
  let losingFactoryCalls = 0;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });

  const hostedStart = getOrCreateRpcSession(sessionId, async () => {
    preparationCalls += 1;
    return preparation;
  }, {
    afterPublication({ session }) {
      assert.strictEqual(globalThis.__piSessions?.get(sessionId), session);
    },
  });
  const overlappingSelection = getOrCreateRpcSession(sessionId, async () => {
    losingFactoryCalls += 1;
    throw new Error("overlapping selection must share the first startup");
  });

  resolvePreparation({ session: wrapper, realSessionId: sessionId });
  const [hosted, selected] = await Promise.all([hostedStart, overlappingSelection]);
  assert.equal(preparationCalls, 1);
  assert.equal(losingFactoryCalls, 0);
  assert.strictEqual(hosted.session, wrapper);
  assert.strictEqual(selected.session, wrapper);
  assert.strictEqual(getRpcSession(sessionId), wrapper);

  t.after(() => {
    wrapper.destroy();
    globalThis.__piSessions?.delete(sessionId);
  });
});

test("cancellation immediately before publication disposes the unpublished owner", async (t) => {
  const { manager } = createSource(t);
  const state = {};
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  const sessionId = manager.getSessionId();
  const controller = new AbortController();
  let resolvePreparation;
  let afterPublicationCalls = 0;
  const preparation = new Promise((resolve) => { resolvePreparation = resolve; });

  const starting = getOrCreateRpcSession(sessionId, async () => preparation, {
    beforePublication() {
      if (controller.signal.aborted) {
        const error = new Error("cancelled");
        error.name = "AbortError";
        throw error;
      }
    },
    afterPublication() {
      afterPublicationCalls += 1;
    },
  });
  controller.abort();
  resolvePreparation({ session: wrapper, realSessionId: sessionId });

  await assert.rejects(starting, { name: "AbortError" });
  assert.equal(afterPublicationCalls, 0);
  assert.equal(state.disposeCalls, 1);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(getRpcSession(sessionId), undefined);
  t.after(() => globalThis.__piSessions?.delete(sessionId));
});

test("host capability acknowledges publication and kickoff scheduling before binding or target settlement", async (t) => {
  const { manager: targetManager } = createSource(t);
  const targetId = targetManager.getSessionId();
  let resolveBinding;
  const binding = new Promise((resolve) => { resolveBinding = resolve; });
  let resolveTarget;
  const targetTurn = new Promise((resolve) => { resolveTarget = resolve; });
  let targetPromptCalls = 0;
  const targetState = {
    bindExtensions: async () => binding,
    prompt: async () => {
      targetPromptCalls += 1;
      return targetTurn;
    },
  };
  const target = new AgentSessionWrapper(fakeInner(targetManager, targetState));
  target.start();
  target.beginExtensionBinding();
  globalThis.__piSessions?.set(targetId, target);

  let refreshCalls = 0;
  const unsubscribeRefresh = subscribeSessionListRefresh(() => { refreshCalls += 1; });
  const capability = globalThis[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL];
  assert.ok(capability?.active);
  const sourceController = new AbortController();
  const launch = await capability.launch({
    targetSessionId: targetId,
    targetSessionFile: targetManager.getSessionFile(),
    targetCwd: targetManager.getCwd(),
    kickoff: "Implement the approved plan at .agents/plans/test.md.",
    launchKind: "start",
    sourceSignal: sourceController.signal,
  });

  assert.equal(launch.outcome, "hosted");
  assert.equal(launch.targetSessionId, targetId);
  assert.strictEqual(getRpcSession(targetId), target);
  assert.equal(refreshCalls, 1);
  assert.equal(targetPromptCalls, 0, "extension binding must remain unresolved");
  assert.equal(target.isRunning(), true);

  // Publication is the transfer boundary: later source cancellation has no
  // listener or authority over the hosted target.
  sourceController.abort();
  assert.equal(target.isAlive(), true);
  assert.equal(target.isRunning(), true);

  const { manager: sourceManager } = createSource(t);
  const source = new AgentSessionWrapper(fakeInner(sourceManager));
  await source.send({ type: "prompt", message: "source remains responsive" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(source.isRunning(), false);
  assert.equal(target.isRunning(), true);

  resolveBinding();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(targetPromptCalls, 1);
  assert.equal(target.isRunning(), true);
  resolveTarget();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.isRunning(), false);

  t.after(() => {
    unsubscribeRefresh();
    source.destroy();
    target.destroy();
    globalThis.__piSessions?.delete(targetId);
  });
});

test("target Stop cancels a hosted kickoff that is still waiting for extension binding", async (t) => {
  const { manager } = createSource(t);
  let resolveBinding;
  const binding = new Promise((resolve) => { resolveBinding = resolve; });
  let promptCalls = 0;
  const state = {
    bindExtensions: async () => binding,
    prompt: async () => { promptCalls += 1; },
  };
  const failures = [];
  const events = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  wrapper.onEvent((event) => events.push(event));
  wrapper.beginExtensionBinding();
  wrapper.startHostedPrompt("delayed kickoff", {
    ...noOpHostedLifecycle(),
    targetFailed(error) { failures.push(error); },
  });
  assert.equal(wrapper.isRunning(), true);

  await wrapper.send({ type: "abort" });
  assert.equal(wrapper.isRunning(), false);
  assert.equal(state.abortCalls, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, "AbortError");
  assert.equal(events.filter((event) => event.type === "prompt_done").length, 1);

  resolveBinding();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(promptCalls, 0);
  assert.equal(wrapper.isRunning(), false);
  t.after(() => wrapper.destroy());
});

test("owner destruction cancels a deferred hosted kickoff without duplicate acceptance", async (t) => {
  const { manager } = createSource(t);
  let resolveBinding;
  const binding = new Promise((resolve) => { resolveBinding = resolve; });
  let promptCalls = 0;
  const state = {
    bindExtensions: async () => binding,
    prompt: async () => { promptCalls += 1; },
  };
  const lifecycleEvents = [];
  const lifecycle = {
    ...noOpHostedLifecycle(),
    ownershipAccepted() { lifecycleEvents.push("ownership_accepted"); },
    kickoffScheduled() { lifecycleEvents.push("kickoff_scheduled"); },
    targetFailed(error) { lifecycleEvents.push(`target_failed:${error.name}`); },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  wrapper.beginExtensionBinding();

  assert.equal(wrapper.startHostedPrompt("delayed kickoff", lifecycle), true);
  assert.equal(wrapper.startHostedPrompt("duplicate kickoff", lifecycle), false);
  assert.deepEqual(lifecycleEvents, ["ownership_accepted", "kickoff_scheduled"]);
  assert.equal(wrapper.isRunning(), true);

  wrapper.destroy();
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.isRunning(), false);
  assert.equal(state.disposeCalls, 1);
  assert.deepEqual(lifecycleEvents, [
    "ownership_accepted",
    "kickoff_scheduled",
    "target_failed:AbortError",
  ]);

  resolveBinding();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(promptCalls, 0);
  assert.equal(state.disposeCalls, 1);
});

test("a duplicate hosted launch rejects without dispatching or refreshing twice", async (t) => {
  const { manager } = createSource(t);
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  let promptCalls = 0;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    prompt: async () => { promptCalls += 1; return prompt; },
  }));
  const sessionId = manager.getSessionId();
  globalThis.__piSessions ??= new Map();
  globalThis.__piSessions.set(sessionId, wrapper);
  let refreshCalls = 0;
  const unsubscribeRefresh = subscribeSessionListRefresh(() => { refreshCalls += 1; });
  const capability = globalThis[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL];
  const request = {
    targetSessionId: sessionId,
    targetSessionFile: manager.getSessionFile(),
    targetCwd: manager.getCwd(),
    kickoff: "private kickoff",
    launchKind: "start",
    sourceSignal: undefined,
  };

  await capability.launch(request);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => capability.launch(request), /registration failed/i);
  assert.equal(promptCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.strictEqual(getRpcSession(sessionId), wrapper);

  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  t.after(() => {
    unsubscribeRefresh();
    wrapper.destroy();
    globalThis.__piSessions?.delete(sessionId);
  });
});

test("host capability rejects an existing owner whose file or cwd does not match", async (t) => {
  const { manager } = createSource(t);
  const sessionId = manager.getSessionId();
  let promptCalls = 0;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    prompt: async () => { promptCalls += 1; },
  }));
  globalThis.__piSessions?.set(sessionId, wrapper);
  const capability = globalThis[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL];

  await assert.rejects(() => capability.launch({
    targetSessionId: sessionId,
    targetSessionFile: join(manager.getSessionDir(), "different.jsonl"),
    targetCwd: manager.getCwd(),
    kickoff: "private kickoff",
    launchKind: "start",
    sourceSignal: undefined,
  }), /hosted target registration failed/i);
  assert.equal(promptCalls, 0);
  assert.strictEqual(getRpcSession(sessionId), wrapper);

  t.after(() => {
    wrapper.destroy();
    globalThis.__piSessions?.delete(sessionId);
  });
});

test("hosted target failure clears running state, emits a bounded target error, and leaves native JSONL resumable", async (t) => {
  const { manager } = createSource(t);
  const lifecycleFailures = [];
  const events = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    prompt: async () => { throw new Error("private provider and tool payload"); },
  }));
  wrapper.onEvent((event) => events.push(event));
  wrapper.startHostedPrompt("private kickoff", {
    ...noOpHostedLifecycle(),
    targetFailed(error) { lifecycleFailures.push(error); },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wrapper.isRunning(), false);
  assert.equal(lifecycleFailures.length, 1);
  assert.ok(events.some((event) => event.type === "prompt_error" && event.errorMessage === "Hosted target prompt failed"));
  assert.ok(events.some((event) => event.type === "prompt_done"));
  const reopened = SessionManager.open(manager.getSessionFile(), manager.getSessionDir());
  assert.equal(reopened.getSessionId(), manager.getSessionId());
  t.after(() => wrapper.destroy());
});

test("active wrappers survive idle deadlines and dispose once after a full idle window", async (t) => {
  const { manager } = createSource(t);
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  const state = { prompt: async () => prompt };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 20);
  wrapper.start();
  wrapper.startHostedPrompt("delayed target", noOpHostedLifecycle());
  await new Promise((resolve) => setImmediate(resolve));

  await delay(55);
  assert.equal(wrapper.isAlive(), true);
  assert.equal(wrapper.isRunning(), true);
  assert.equal(state.disposeCalls ?? 0, 0);

  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.isRunning(), false);
  await delay(35);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(state.disposeCalls, 1);
  wrapper.destroy();
  assert.equal(state.disposeCalls, 1);
});

test("native streaming and compaction flags also defer idle cleanup", async (t) => {
  for (const activeFlag of ["isStreaming", "isCompacting"]) {
    const { manager } = createSource(t);
    const state = { [activeFlag]: true };
    const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 15);
    wrapper.start();
    await delay(40);
    assert.equal(wrapper.isAlive(), true, `${activeFlag} owner was evicted while active`);
    assert.equal(state.disposeCalls ?? 0, 0);
    state[activeFlag] = false;
    await delay(25);
    assert.equal(wrapper.isAlive(), false);
    assert.equal(state.disposeCalls, 1);
  }
});

test("target commands and source Stop remain isolated by registered session ID", async (t) => {
  const { manager: sourceManager } = createSource(t);
  const { manager: targetManager } = createSource(t);
  const sourceState = {};
  const targetState = {};
  const source = new AgentSessionWrapper(fakeInner(sourceManager, sourceState));
  const target = new AgentSessionWrapper(fakeInner(targetManager, targetState));
  globalThis.__piSessions?.set(source.sessionId, source);
  globalThis.__piSessions?.set(target.sessionId, target);

  const command = async (id, body) => postAgentCommand(new Request(`http://localhost/api/agent/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

  assert.equal((await command(target.sessionId, { type: "steer", message: "target steer" })).status, 200);
  assert.equal((await command(target.sessionId, { type: "follow_up", message: "target follow-up" })).status, 200);
  assert.equal((await command(source.sessionId, { type: "abort" })).status, 200);
  assert.deepEqual(targetState.steerCalls, ["target steer"]);
  assert.deepEqual(targetState.followUpCalls, ["target follow-up"]);
  assert.equal(sourceState.abortCalls, 1);
  assert.equal(targetState.abortCalls ?? 0, 0);
  assert.equal(target.isAlive(), true);

  assert.equal((await command(target.sessionId, { type: "abort" })).status, 200);
  assert.equal(targetState.abortCalls, 1);
  assert.equal(sourceState.abortCalls, 1);

  t.after(() => {
    source.destroy();
    target.destroy();
    globalThis.__piSessions?.delete(source.sessionId);
    globalThis.__piSessions?.delete(target.sessionId);
  });
});

test("hosted discovery invalidates the ordinary list and advances a replayable refresh generation", () => {
  const listGenerationBefore = globalThis.__piSessionListGeneration ?? 0;
  const refreshGenerationBefore = getSessionListRefreshGeneration();
  const received = [];
  const unsubscribe = subscribeSessionListRefresh((generation) => { received.push(generation); });
  notifySessionListRefresh();
  unsubscribe();
  assert.equal(globalThis.__piSessionListGeneration, listGenerationBefore + 1);
  assert.equal(getSessionListRefreshGeneration(), refreshGenerationBefore + 1);
  assert.deepEqual(received, [refreshGenerationBefore + 1]);
});

test("running SSE replays session discovery generation to a late or reconnected browser", async () => {
  notifySessionListRefresh();
  const expectedGeneration = getSessionListRefreshGeneration();
  const controller = new AbortController();
  const response = await getRunningEvents(new Request("http://localhost/api/agent/running/events", {
    signal: controller.signal,
  }));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let replay;
  for (let index = 0; index < 4 && !replay; index += 1) {
    const chunk = await reader.read();
    text += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
    replay = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)))
      .find((event) => event.type === "sessions_changed");
  }
  controller.abort();
  await reader.cancel().catch(() => {});
  assert.deepEqual(replay, {
    type: "sessions_changed",
    sessionListGeneration: expectedGeneration,
  });
});
