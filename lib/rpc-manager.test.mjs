import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  AgentSessionWrapper,
  assertExistingRpcSessionIdentity,
  getOrCreateRpcSession,
  getRpcSession,
  getRunningRpcSessionIds,
  getSessionListRefreshGeneration,
  notifySessionListRefresh,
  publishRunningSessionState,
  startRpcSession,
  subscribeRunningSessions,
  subscribeSessionListRefresh,
} = await jiti.import("./rpc-manager.ts");
const { HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL } = await jiti.import("./hosted-implementation-session.ts");
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
    reload: state.reload ?? (async () => {}),
    subscribe: state.subscribe ?? (() => () => {}),
    dispose: state.dispose ?? (() => { state.disposeCalls = (state.disposeCalls ?? 0) + 1; }),
    prompt: state.prompt ?? (async () => {}),
    abort: state.abort ?? (async () => { state.abortCalls = (state.abortCalls ?? 0) + 1; }),
    steer: state.steer ?? (async (message) => { (state.steerCalls ??= []).push(message); }),
    followUp: state.followUp ?? (async (message) => { (state.followUpCalls ??= []).push(message); }),
    compact: state.compact ?? (async () => ({})),
    abortCompaction: state.abortCompaction ?? (() => { state.abortCompactionCalls = (state.abortCompactionCalls ?? 0) + 1; }),
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

test("existing-file startup baseline validates prepared ID, file, and actual manager cwd", (t) => {
  const { manager } = createSource(t);
  const wrapper = new AgentSessionWrapper(fakeInner(manager));
  t.after(() => wrapper.destroy());
  const expected = {
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    cwd: manager.getCwd(),
  };
  assert.doesNotThrow(() => assertExistingRpcSessionIdentity(wrapper, expected.sessionId, expected));
  for (const mismatch of [
    ["wrong", expected],
    [expected.sessionId, { ...expected, sessionId: "wrong" }],
    [expected.sessionId, { ...expected, sessionFile: `${expected.sessionFile}.wrong` }],
    [expected.sessionId, { ...expected, cwd: `${expected.cwd}-wrong` }],
    [expected.sessionId, { ...expected, sessionFile: "relative" }],
  ]) assert.throws(() => assertExistingRpcSessionIdentity(wrapper, mismatch[0], mismatch[1]), /identity_mismatch/);
});

test("real existing-file validatePrepared failure disposes the unpublished no-provider owner", { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-rpc-unpublished-"));
  const cwd = join(directory, "cwd");
  const manager = SessionManager.create(cwd, directory);
  const sessionId = manager.getSessionId();
  const sessionFile = manager.getSessionFile();
  writeFileSync(sessionFile, `${JSON.stringify({
    type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd,
  })}\n`);
  let preparedWrapper;
  const validationError = new Error("synthetic_prepublication_rejection");
  await assert.rejects(startRpcSession(sessionId, sessionFile, cwd, undefined, {
    validatePrepared(prepared) {
      preparedWrapper = prepared.session;
      assert.equal(prepared.realSessionId, sessionId);
      assert.equal(prepared.session.sessionId, sessionId);
      assert.equal(prepared.session.sessionFile, sessionFile);
      assert.equal(prepared.session.inner.sessionManager.getCwd(), cwd);
      assert.ok(prepared.session.getProjectedEventHub());
      throw validationError;
    },
  }), (error) => error === validationError);
  assert.ok(preparedWrapper);
  assert.equal(preparedWrapper.isAlive(), false, "failed prepublication validation destroys the prepared wrapper");
  assert.equal(getRpcSession(sessionId), undefined, "failed preparation is never published");
  assert.equal(globalThis.__piStartLocks?.has(sessionId) ?? false, false);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
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
  let losingValidationCalls = 0;
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
  }, {
    validatePrepared() { losingValidationCalls += 1; },
  });

  resolvePreparation({ session: wrapper, realSessionId: sessionId });
  const [hosted, selected] = await Promise.all([hostedStart, overlappingSelection]);
  assert.equal(preparationCalls, 1);
  assert.equal(losingFactoryCalls, 0);
  assert.equal(losingValidationCalls, 0, "a caller joining another start lock must post-validate the result");
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
  const projectedCursor = wrapper.getProjectedEventHub().cursor;

  await wrapper.send({ type: "abort" });
  assert.equal(wrapper.isRunning(), false);
  assert.equal(state.abortCalls, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, "AbortError");
  assert.equal(events.filter((event) => event.type === "prompt_done").length, 1);
  const projectedStop = wrapper.getProjectedEventHub().replayAfter(wrapper.getProjectedEventHub().streamEpoch, projectedCursor).units;
  assert.equal(projectedStop.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(projectedStop.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);

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
  const projectedHub = wrapper.getProjectedEventHub();
  const projectedUnits = [];
  projectedHub.attach(projectedHub.streamEpoch, projectedHub.cursor, (unit) => projectedUnits.push(unit));

  wrapper.destroy();
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.isRunning(), false);
  assert.equal(state.disposeCalls, 1);
  assert.equal(projectedUnits.some((unit) => unit.type === "snapshot_start"), false, "destruction closes without a final snapshot");
  assert.equal(projectedHub.isClosed(), true);
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
  const projectedCursor = wrapper.getProjectedEventHub().cursor;
  wrapper.startHostedPrompt("private kickoff", {
    ...noOpHostedLifecycle(),
    targetFailed(error) { lifecycleFailures.push(error); },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wrapper.isRunning(), false);
  assert.equal(lifecycleFailures.length, 1);
  assert.ok(events.some((event) => event.type === "prompt_error" && event.errorMessage === "Hosted target prompt failed"));
  assert.ok(events.some((event) => event.type === "prompt_done"));
  const projected = wrapper.getProjectedEventHub().replayAfter(wrapper.getProjectedEventHub().streamEpoch, projectedCursor).units;
  assert.equal(projected.filter((unit) => unit.type === "notice" && unit.message === "Hosted target prompt failed").length, 1);
  assert.equal(projected.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(projected.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.equal(wrapper.getProjectedEventHub().getState().active, false);
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

test("running projection is deterministic, HMR-global, de-duplicated, and wrapper-independent", () => {
  globalThis.__piRunningSessionIds = new Set();
  globalThis.__piLastRunningSnapshot = undefined;
  const received = [];
  const unsubscribe = subscribeRunningSessions((ids) => received.push(ids));

  publishRunningSessionState("session-b", true);
  publishRunningSessionState("session-a", true);
  publishRunningSessionState("session-a", true);
  assert.deepEqual(getRunningRpcSessionIds(), ["session-a", "session-b"]);
  assert.deepEqual(received, [
    ["session-b"],
    ["session-a", "session-b"],
  ]);

  publishRunningSessionState("session-b", false);
  publishRunningSessionState("session-b", false);
  assert.deepEqual(getRunningRpcSessionIds(), ["session-a"]);
  assert.deepEqual(received.at(-1), ["session-a"]);
  unsubscribe();
  publishRunningSessionState("session-a", false);
});

test("wrapper-owned prompt transitions publish running state and destruction removes it", async (t) => {
  const { manager } = createSource(t);
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { prompt: async () => prompt }));
  wrapper.start();
  await wrapper.send({ type: "prompt", message: "bounded fixture" });
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(getRunningRpcSessionIds(), []);

  publishRunningSessionState(wrapper.sessionId, true);
  wrapper.destroy();
  assert.deepEqual(getRunningRpcSessionIds(), []);
});

test("projected hub is installed before native subscription and captures native events with zero listeners", async (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  let wrapper;
  const inner = fakeInner(manager, {
    subscribe(listener) {
      assert.ok(wrapper.getProjectedEventHub(), "capability must predate native subscribe");
      nativeListener = listener;
      return () => {};
    },
  });
  wrapper = new AgentSessionWrapper(inner);
  const hub = wrapper.getProjectedEventHub();
  assert.ok(hub);
  assert.equal(Object.keys(wrapper).includes("pi-web.projected-session-hub.v1"), false);
  wrapper.start();
  nativeListener({ type: "agent_start" });
  nativeListener({ type: "agent_end", messages: [{ private: true }], willRetry: true });
  nativeListener({ type: "agent_settled" });
  assert.equal(hub.cursor, 5);
  assert.deepEqual(hub.replayAfter(hub.streamEpoch, 0).units.map((unit) => unit.type).filter((type) => type !== "snapshot_chunk"), ["activity_started", "attempt_ended", "native_settled", "run_settled", "snapshot_start", "snapshot_end"]);
  assert.doesNotMatch(JSON.stringify(hub.replayAfter(hub.streamEpoch, 0).units), /messages|private/);
  wrapper.destroy();
  assert.equal(hub.isClosed(), true);
  wrapper.destroy();
});

test("wrapper destruction closes the hub, disposes native once, and isolates every destruction observer", (t) => {
  const { manager } = createSource(t);
  const state = {};
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  const observed = [];
  wrapper.onDestroy(() => { observed.push("first"); throw new Error("isolated observer"); });
  wrapper.onDestroy(() => observed.push("second"));
  const hub = wrapper.getProjectedEventHub();
  assert.doesNotThrow(() => wrapper.destroy());
  wrapper.destroy();
  assert.deepEqual(observed, ["first", "second"]);
  assert.equal(state.disposeCalls, 1);
  assert.equal(hub.isClosed(), true);
  assert.equal(hub.replayAfter(hub.streamEpoch, 0).outcome, "closed");
});

test("deep rejected projection never escapes native emit or suppresses preserved legacy fanout", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  t.after(() => wrapper.destroy());
  const legacy = [];
  wrapper.onEvent((event) => legacy.push(event));
  let details = { leaf: true };
  for (let index = 0; index < 100; index += 1) details = { nested: details };
  const raw = { type: "message_end", message: { role: "custom", customType: "deep", content: "raw", display: true, details } };
  const before = wrapper.getProjectedEventHub().cursor;
  assert.doesNotThrow(() => nativeListener(raw));
  assert.strictEqual(legacy.at(-1), raw);
  assert.equal(wrapper.getProjectedEventHub().cursor, before);

  const revokedOuter = Proxy.revocable({ type: "agent_start" }, {}); revokedOuter.revoke();
  const revokedContent = Proxy.revocable([], {}); revokedContent.revoke();
  const hostileNested = { type: "message_update", assistantMessageEvent: { type: "start", partial: { role: "assistant", model: "fixture", provider: "fixture", content: revokedContent.proxy } } };
  assert.doesNotThrow(() => nativeListener(revokedOuter.proxy));
  assert.strictEqual(legacy.at(-1), revokedOuter.proxy, "outer hostile raw identity still fans out");
  assert.doesNotThrow(() => nativeListener(hostileNested));
  assert.strictEqual(legacy.at(-1), hostileNested, "nested hostile raw identity still fans out");
  assert.equal(wrapper.getProjectedEventHub().cursor, before);
});

test("native zero-claim run and direct compaction each settle exactly once at their public terminal boundary", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  t.after(() => wrapper.destroy());
  const hub = wrapper.getProjectedEventHub();

  let cursor = hub.cursor;
  nativeListener({ type: "agent_start" });
  nativeListener({ type: "compaction_start", reason: "threshold" });
  nativeListener({ type: "compaction_end", reason: "threshold", result: undefined, aborted: false, willRetry: false });
  nativeListener({ type: "turn_start" });
  nativeListener({ type: "entry_appended", entry: { private: true } });
  let units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0, "automatic compaction cannot settle its enclosing native turn");
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 0);
  assert.equal(hub.getState().active, true);
  nativeListener({ type: "agent_settled" });
  units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.equal(hub.getState().active, false);
  nativeListener({ type: "agent_settled" });
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1, "duplicate native finality does not settle twice");

  cursor = hub.cursor;
  nativeListener({ type: "compaction_start", reason: "manual" });
  nativeListener({ type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false });
  units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.equal(hub.getState().active, false);
});

test("native and current or legacy manual lifecycles remain causal under same-kind terminal reentrancy", async (t) => {
  const createWrapper = () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    return { wrapper, hub: wrapper.getProjectedEventHub(), emit: (event) => nativeListener(event) };
  };
  const assertNoFinality = (hub, cursor) => {
    const units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 0);
    assert.equal(hub.getState().active, true);
  };
  const assertOneFinality = (hub, cursor) => {
    const units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
    assert.equal(hub.getState().active, false);
  };

  await t.test("agent_settled reenters agent_start", () => {
    const { wrapper, hub, emit } = createWrapper();
    let reentered = false;
    wrapper.onEvent((event) => {
      if (event.type === "agent_settled" && !reentered) {
        reentered = true;
        emit({ type: "agent_start" });
      }
    });
    const cursor = hub.cursor;
    emit({ type: "agent_start" });
    emit({ type: "agent_settled" });
    assertNoFinality(hub, cursor);
    emit({ type: "agent_settled" });
    assertOneFinality(hub, cursor);
    emit({ type: "agent_settled" });
    assertOneFinality(hub, cursor);
    wrapper.destroy();
  });

  for (const alias of [false, true]) {
    await t.test(`${alias ? "legacy" : "current"} manual compaction terminal reenters same-kind start`, () => {
      const { wrapper, hub, emit } = createWrapper();
      const startType = alias ? "auto_compaction_start" : "compaction_start";
      const endType = alias ? "auto_compaction_end" : "compaction_end";
      let reentered = false;
      wrapper.onEvent((event) => {
        if (event.type === endType && !reentered) {
          reentered = true;
          emit({ type: startType, reason: "manual" });
        }
      });
      const cursor = hub.cursor;
      emit({ type: startType, reason: "manual" });
      emit({ type: endType, reason: "manual", result: undefined, aborted: false, ...(alias ? {} : { willRetry: false }) });
      assertNoFinality(hub, cursor);
      emit({ type: endType, reason: "manual", result: undefined, aborted: false, ...(alias ? {} : { willRetry: false }) });
      assertOneFinality(hub, cursor);
      emit({ type: endType, reason: "manual", result: undefined, aborted: false, ...(alias ? {} : { willRetry: false }) });
      assertOneFinality(hub, cursor);
      wrapper.destroy();
    });
  }

  await t.test("legacy manual success settles standalone exactly once", () => {
    const { wrapper, hub, emit } = createWrapper();
    const cursor = hub.cursor;
    emit({ type: "auto_compaction_start", reason: "manual" });
    emit({ type: "auto_compaction_end", reason: "manual", result: { tokensBefore: 20, estimatedTokensAfter: 10 }, aborted: false });
    assertOneFinality(hub, cursor);
    wrapper.destroy();
  });

  for (const reason of [undefined, "threshold", "overflow"]) {
    await t.test(`legacy automatic ${reason ?? "default"} remains nested until native settlement`, () => {
      const { wrapper, hub, emit } = createWrapper();
      const cursor = hub.cursor;
      emit({ type: "auto_compaction_start", ...(reason === undefined ? {} : { reason }) });
      emit({ type: "auto_compaction_end", ...(reason === undefined ? {} : { reason }), result: undefined, aborted: false });
      assertNoFinality(hub, cursor);
      emit({ type: "agent_start" });
      emit({ type: "turn_start" });
      assertNoFinality(hub, cursor);
      emit({ type: "agent_settled" });
      assertOneFinality(hub, cursor);
      wrapper.destroy();
    });
  }
});

test("same-kind reentrant terminals reserve exclusively and finalize after complete outer fanout", async (t) => {
  const createWrapper = () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    return { wrapper, hub: wrapper.getProjectedEventHub(), emit: (event) => nativeListener(event) };
  };

  const cases = [
    { name: "native", start: { type: "agent_start" }, end: { type: "agent_settled" }, countKey: "nativeAgentTurnCount", reservedKey: "reservedNativeTerminalCount" },
    { name: "current manual", start: { type: "compaction_start", reason: "manual" }, end: { type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false }, countKey: "standaloneNativeCompactionCount", reservedKey: "reservedStandaloneCompactionTerminalCount" },
    { name: "legacy manual", start: { type: "auto_compaction_start", reason: "manual" }, end: { type: "auto_compaction_end", reason: "manual", result: undefined, aborted: false }, countKey: "standaloneNativeCompactionCount", reservedKey: "reservedStandaloneCompactionTerminalCount" },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const { wrapper, hub, emit } = createWrapper();
      const timeline = [];
      let nested = false;
      wrapper.onEvent((event) => {
        if (event.type !== fixture.end.type) return;
        timeline.push(nested ? "listener1:nested" : "listener1:outer");
        if (!nested) { nested = true; emit({ ...fixture.end }); }
      });
      wrapper.onEvent((event) => { if (event.type === fixture.end.type) timeline.push(event === fixture.end ? "listener2:outer" : "listener2:nested"); });
      hub.attach(hub.streamEpoch, hub.cursor, (unit) => { if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final"); });
      const cursor = hub.cursor;
      emit({ ...fixture.start });
      emit(fixture.end);
      assert.deepEqual(timeline, ["listener1:outer", "listener1:nested", "listener2:nested", "listener2:outer", "projected:final"]);
      assert.equal(wrapper[fixture.countKey], 0);
      assert.equal(wrapper[fixture.reservedKey], 0);
      let units = hub.replayAfter(hub.streamEpoch, cursor).units;
      assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
      assert.equal(hub.getState().active, false);

      const nextCursor = hub.cursor;
      emit({ ...fixture.start });
      emit({ ...fixture.end });
      units = hub.replayAfter(hub.streamEpoch, nextCursor).units;
      assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1, "the next balanced run settles normally");
      assert.equal(wrapper[fixture.countKey], 0);
      assert.equal(wrapper[fixture.reservedKey], 0);
      assert.equal(hub.getState().active, false);
      emit({ ...fixture.end });
      assert.equal(wrapper[fixture.countKey], 0, "duplicate terminals never decrement below zero");
      assert.equal(wrapper[fixture.reservedKey], 0);
      wrapper.destroy();
    });
  }
});

test("start-to-terminal reentrancy defers finality until every enclosing start observer returns", async (t) => {
  const cases = [
    { name: "native", start: { type: "agent_start" }, end: { type: "agent_settled" } },
    { name: "current manual", start: { type: "compaction_start", reason: "manual" }, end: { type: "compaction_end", reason: "manual", aborted: false, willRetry: false } },
    { name: "legacy manual", start: { type: "auto_compaction_start", reason: "manual" }, end: { type: "auto_compaction_end", reason: "manual", aborted: false } },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const { manager } = createSource(t);
      let nativeListener;
      const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
      wrapper.start();
      const hub = wrapper.getProjectedEventHub();
      const timeline = [];
      let nested = false;
      wrapper.onEvent((event) => {
        timeline.push(`first:${event.type}`);
        if (event.type === fixture.start.type && !nested) {
          nested = true;
          nativeListener({ ...fixture.end });
        }
      });
      wrapper.onEvent((event) => timeline.push(`second:${event.type}`));
      hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
        if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final");
      });
      const cursor = hub.cursor;
      nativeListener({ ...fixture.start });
      assert.deepEqual(timeline, [
        `first:${fixture.start.type}`,
        `first:${fixture.end.type}`,
        `second:${fixture.end.type}`,
        `second:${fixture.start.type}`,
        "projected:final",
      ]);
      const units = hub.replayAfter(hub.streamEpoch, cursor).units;
      assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
      assert.equal(hub.getState().active, false);

      const next = hub.cursor;
      nativeListener({ ...fixture.start });
      nativeListener({ ...fixture.end });
      assert.equal(hub.replayAfter(hub.streamEpoch, next).units.filter((unit) => unit.type === "run_settled").length, 1);
      wrapper.destroy();
    });
  }
});

test("terminal fanout containing a complete nested start-terminal pair settles once after the outer observer", async (t) => {
  const cases = [
    { name: "native", start: { type: "agent_start" }, end: { type: "agent_settled" } },
    { name: "current manual", start: { type: "compaction_start", reason: "manual" }, end: { type: "compaction_end", reason: "manual", aborted: false, willRetry: false } },
    { name: "legacy manual", start: { type: "auto_compaction_start", reason: "manual" }, end: { type: "auto_compaction_end", reason: "manual", aborted: false } },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const { manager } = createSource(t);
      let nativeListener;
      const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
      wrapper.start();
      const hub = wrapper.getProjectedEventHub();
      const timeline = [];
      let nested = false;
      wrapper.onEvent((event) => {
        if (event.type !== fixture.end.type || nested) return;
        nested = true;
        timeline.push("first:outer-terminal");
        nativeListener({ ...fixture.start });
        nativeListener({ ...fixture.end });
      });
      wrapper.onEvent((event) => { if (event.type === fixture.end.type) timeline.push(nested ? "second:terminal" : "second:unexpected"); });
      hub.attach(hub.streamEpoch, hub.cursor, (unit) => { if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final"); });
      const cursor = hub.cursor;
      nativeListener({ ...fixture.start });
      nativeListener({ ...fixture.end });
      assert.deepEqual(timeline, ["first:outer-terminal", "second:terminal", "second:terminal", "projected:final"]);
      const units = hub.replayAfter(hub.streamEpoch, cursor).units;
      assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
      assert.equal(hub.getState().active, false);
      wrapper.destroy();
    });
  }
});

test("destruction during a deferred terminal request closes without invented finality", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  const hub = wrapper.getProjectedEventHub();
  let nested = false;
  wrapper.onEvent((event) => {
    if (event.type === "agent_start" && !nested) {
      nested = true;
      nativeListener({ type: "agent_settled" });
    }
  });
  wrapper.onEvent((event) => { if (event.type === "agent_start") wrapper.destroy(); });
  nativeListener({ type: "agent_start" });
  assert.equal(hub.isClosed(), true);
  assert.equal(hub.replayAfter(hub.streamEpoch, 0).outcome, "closed");
});

test("malformed native terminals preserve activity and exact raw fanout until a valid projected terminal", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  t.after(() => wrapper.destroy());
  const hub = wrapper.getProjectedEventHub();
  const raw = [];
  wrapper.onEvent((event) => raw.push(event));

  let cursor = hub.cursor;
  const malformedStart = { type: "compaction_start", reason: "invalid" };
  nativeListener(malformedStart);
  nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
  let units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "compaction_started").length, 0);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
  assert.strictEqual(raw.at(-2), malformedStart);

  cursor = hub.cursor;
  nativeListener({ type: "compaction_start", reason: "manual" });
  const missingRetry = { type: "compaction_end", reason: "manual", aborted: false };
  const invalidAbort = { type: "compaction_end", reason: "manual", aborted: "no", willRetry: false };
  nativeListener(missingRetry);
  nativeListener(invalidAbort);
  units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "compaction_finished").length, 0);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
  assert.equal(hub.getState().active, true);
  assert.strictEqual(raw.at(-2), missingRetry);
  assert.strictEqual(raw.at(-1), invalidAbort);
  nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
  units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "compaction_finished").length, 1);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);

  cursor = hub.cursor;
  nativeListener({ type: "agent_start" });
  const accessorTerminal = {};
  Object.defineProperty(accessorTerminal, "type", { enumerable: true, get() { return "agent_settled"; } });
  nativeListener(accessorTerminal);
  units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "native_settled").length, 0);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
  assert.strictEqual(raw.at(-1), accessorTerminal);
  nativeListener({ type: "agent_settled" });
  units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "native_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);

  const next = hub.cursor;
  nativeListener({ type: "agent_start" });
  nativeListener({ type: "agent_settled" });
  assert.equal(hub.replayAfter(hub.streamEpoch, next).units.filter((unit) => unit.type === "run_settled").length, 1, "subsequent balanced activity is not stranded");
});

test("native lifecycle and projection inspect a hostile raw object only once", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  t.after(() => wrapper.destroy());
  const hub = wrapper.getProjectedEventHub();
  nativeListener({ type: "agent_start" });
  let ownKeysCalls = 0;
  const rawTerminal = new Proxy({ type: "agent_settled" }, {
    ownKeys(target) {
      ownKeysCalls += 1;
      return ownKeysCalls === 1 ? Reflect.ownKeys(target) : ["type", "unexpected"];
    },
  });
  let delivered;
  wrapper.onEvent((event) => { delivered = event; });
  const cursor = hub.cursor;
  nativeListener(rawTerminal);
  assert.equal(ownKeysCalls, 0, "fixed discriminant inspection never enumerates discarded keys");
  assert.strictEqual(delivered, rawTerminal);
  const units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "native_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
});

test("pre-prompt threshold and overflow compaction wait for the eventual native settlement across every outcome", async (t) => {
  const cases = [
    { name: "success", event: { result: { tokensBefore: 100, estimatedTokensAfter: 20 }, aborted: false, willRetry: false } },
    { name: "abort", event: { result: undefined, aborted: true, willRetry: false } },
    { name: "error", event: { result: undefined, aborted: false, willRetry: false, errorMessage: "bounded error" } },
    { name: "retry", event: { result: { tokensBefore: 100 }, aborted: false, willRetry: true } },
  ];
  for (const reason of ["threshold", "overflow"]) {
    for (const fixture of cases) {
      await t.test(`${reason}-${fixture.name}`, () => {
        const { manager } = createSource(t);
        let nativeListener;
        const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
        wrapper.start();
        const hub = wrapper.getProjectedEventHub();
        const cursor = hub.cursor;
        nativeListener({ type: "compaction_start", reason });
        nativeListener({ type: "compaction_end", reason, ...fixture.event });
        let units = hub.replayAfter(hub.streamEpoch, cursor).units;
        assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
        assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 0);
        assert.equal(hub.getState().active, true);

        nativeListener({ type: "agent_start" });
        nativeListener({ type: "turn_start" });
        nativeListener({ type: "entry_appended", entry: { private: true } });
        nativeListener({ type: "agent_end", messages: [{ private: true }], willRetry: false });
        units = hub.replayAfter(hub.streamEpoch, cursor).units;
        assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0, "continued turn events remain nonfinal");
        nativeListener({ type: "agent_settled" });
        units = hub.replayAfter(hub.streamEpoch, cursor).units;
        assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
        assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
        assert.equal(hub.getState().active, false);
        wrapper.destroy();
      });
    }
  }
});

test("standalone manual native compaction remains active across independent wrapper claim releases", async (t) => {
  const assertNoFinality = (hub, cursor) => {
    const units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 0);
    assert.equal(hub.getState().active, true);
  };
  const finishManual = (nativeListener, hub, cursor) => {
    nativeListener({ type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false });
    const units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  };

  await t.test("synchronous prompt failure", async () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, {
      subscribe(listener) { nativeListener = listener; return () => {}; },
      prompt: () => { throw new Error("sync failure"); },
    }));
    wrapper.start();
    const hub = wrapper.getProjectedEventHub();
    const cursor = hub.cursor;
    let reentrantPrompt;
    wrapper.onEvent((event) => {
      if (event.type === "compaction_start") reentrantPrompt = wrapper.send({ type: "prompt", message: "overlap" });
    });
    nativeListener({ type: "compaction_start", reason: "manual" });
    await assert.rejects(reentrantPrompt, /sync failure/);
    assertNoFinality(hub, cursor);
    finishManual(nativeListener, hub, cursor);
    wrapper.destroy();
  });

  for (const mode of ["success", "failure", "abort"]) {
    await t.test(`wrapper compaction ${mode}`, async () => {
      const { manager } = createSource(t);
      let nativeListener;
      let settleClaim;
      const claim = new Promise((resolve, reject) => { settleClaim = mode === "success" ? () => resolve({ ok: true }) : () => reject(new Error(mode)); });
      const wrapper = new AgentSessionWrapper(fakeInner(manager, {
        subscribe(listener) { nativeListener = listener; return () => {}; },
        compact: () => claim,
        abortCompaction: () => settleClaim(),
      }));
      wrapper.start();
      const hub = wrapper.getProjectedEventHub();
      const cursor = hub.cursor;
      nativeListener({ type: "compaction_start", reason: "manual" });
      const pending = wrapper.send({ type: "compact" });
      if (mode === "abort") await wrapper.send({ type: "abort_compaction" });
      else settleClaim();
      if (mode === "success") await pending;
      else await assert.rejects(pending, new RegExp(mode));
      assertNoFinality(hub, cursor);
      finishManual(nativeListener, hub, cursor);
      wrapper.destroy();
    });
  }
});

test("every prompt terminal path settles after public events and retrying agent_end never finalizes", async (t) => {
  const { manager } = createSource(t);
  const promptResolvers = [];
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
    prompt: () => new Promise((resolve, reject) => promptResolvers.push({ resolve, reject })),
  }));
  wrapper.start();
  const hub = wrapper.getProjectedEventHub();
  const legacy = [];
  wrapper.onEvent((event) => legacy.push(event.type));

  await wrapper.send({ type: "prompt", message: "one" });
  nativeListener({ type: "agent_end", messages: [{ private: true }], willRetry: true });
  assert.equal(hub.replayAfter(hub.streamEpoch, 0).units.some((unit) => unit.type === "snapshot_start"), false);
  promptResolvers[0].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(legacy.at(-1), "prompt_done");
  let units = hub.replayAfter(hub.streamEpoch, 0).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);

  const beforeStreaming = hub.cursor;
  await wrapper.send({ type: "prompt", message: "stream", streamingBehavior: "steer" });
  promptResolvers[1].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  units = hub.replayAfter(hub.streamEpoch, beforeStreaming).units;
  assert.equal(legacy.filter((type) => type === "prompt_done").length, 1, "streaming behavior keeps legacy prompt_done suppressed");
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);

  const beforeRejected = hub.cursor;
  await wrapper.send({ type: "prompt", message: "reject" });
  promptResolvers[2].reject(new Error("bounded rejection"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(legacy.slice(-2), ["prompt_error", "prompt_done"]);
  units = hub.replayAfter(hub.streamEpoch, beforeRejected).units;
  assert.equal(units.filter((unit) => unit.type === "notice").length, 1);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.equal(hub.getState().active, false);

  wrapper.destroy();
});

test("legacy fanout snapshots start observers, isolates mutation/throws/reentrancy, and settles native activity afterward", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  t.after(() => wrapper.destroy());
  const hub = wrapper.getProjectedEventHub();
  const calls = [];
  let outerEvent;
  let reentered = false;
  let unsubscribeFirst;
  unsubscribeFirst = wrapper.onEvent((event) => {
    if (event.type !== "agent_settled") return;
    calls.push(["first", event]);
    unsubscribeFirst();
    wrapper.onEvent((nested) => calls.push(["added", nested]));
  });
  wrapper.onEvent((event) => {
    if (event.type === "agent_settled" || event.type === "turn_start") {
      calls.push(["throwing", event]);
      throw new Error("isolated legacy listener");
    }
  });
  wrapper.onEvent((event) => {
    if (event.type !== "agent_settled") return;
    calls.push(["reentrant", event]);
    if (!reentered) {
      reentered = true;
      nativeListener({ type: "turn_start" });
    }
  });
  wrapper.onEvent((event) => {
    if (event.type === "agent_settled") calls.push(["last", event]);
  });

  nativeListener({ type: "agent_start" });
  const cursor = hub.cursor;
  outerEvent = { type: "agent_settled" };
  assert.doesNotThrow(() => nativeListener(outerEvent));
  for (const name of ["first", "throwing", "reentrant", "last"]) {
    const delivered = calls.find(([candidate, event]) => candidate === name && event.type === "agent_settled");
    assert.ok(delivered, `${name} receives the outer terminal event`);
    assert.strictEqual(delivered[1], outerEvent, "raw event identity is preserved");
  }
  assert.equal(calls.some(([name, event]) => name === "added" && event === outerEvent), false, "listener added mid-fanout waits for a later event");
  assert.equal(calls.some(([name, event]) => name === "added" && event.type === "turn_start"), true, "reentrant fanout uses its own stable start snapshot");
  const units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.equal(hub.getState().active, false);
});

test("hostile legacy terminal listeners cannot strand prompt success/error or manual compaction cleanup", async (t) => {
  await t.test("prompt success and error", async () => {
    const { manager } = createSource(t);
    const promptResolvers = [];
    const wrapper = new AgentSessionWrapper(fakeInner(manager, {
      prompt: () => new Promise((resolve, reject) => promptResolvers.push({ resolve, reject })),
    }));
    const hub = wrapper.getProjectedEventHub();
    const timeline = [];
    wrapper.onEvent((event) => {
      if (event.type === "prompt_done" || event.type === "prompt_error") throw new Error("hostile prompt observer");
    });
    wrapper.onEvent((event) => {
      if (event.type === "prompt_done" || event.type === "prompt_error") timeline.push(`legacy:${event.type}`);
    });
    hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
      if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final");
    });

    await wrapper.send({ type: "prompt", message: "success" });
    promptResolvers.shift().resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(timeline.slice(-2), ["legacy:prompt_done", "projected:final"]);
    assert.equal(hub.getState().active, false);

    const cursor = hub.cursor;
    await wrapper.send({ type: "prompt", message: "failure" });
    promptResolvers.shift().reject(new Error("bounded failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(timeline.slice(-3), ["legacy:prompt_error", "legacy:prompt_done", "projected:final"]);
    const units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
    assert.equal(hub.getState().active, false);
    wrapper.destroy();
  });

  await t.test("manual native compaction", () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    const hub = wrapper.getProjectedEventHub();
    const timeline = [];
    wrapper.onEvent((event) => { if (event.type === "compaction_end") throw new Error("hostile compaction observer"); });
    wrapper.onEvent((event) => { if (event.type === "compaction_end") timeline.push("legacy:compaction_end"); });
    hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
      if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final");
    });
    nativeListener({ type: "compaction_start", reason: "manual" });
    const cursor = hub.cursor;
    assert.doesNotThrow(() => nativeListener({ type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false }));
    assert.deepEqual(timeline.slice(-2), ["legacy:compaction_end", "projected:final"]);
    const units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(hub.getState().active, false);
    wrapper.destroy();
  });
});

test("binding rejection, synchronous prompt failure, and overlapping claims settle exactly at the last release", async (t) => {
  const { manager } = createSource(t);
  let rejectBinding;
  const binding = new Promise((_, reject) => { rejectBinding = reject; });
  const bound = new AgentSessionWrapper(fakeInner(manager, { bindExtensions: async () => binding }));
  bound.beginExtensionBinding();
  const failed = bound.send({ type: "prompt", message: "binding" });
  rejectBinding(new Error("binding failed"));
  await assert.rejects(failed, /binding failed/);
  let units = bound.getProjectedEventHub().replayAfter(bound.getProjectedEventHub().streamEpoch, 0).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  bound.destroy();

  const synchronous = new AgentSessionWrapper(fakeInner(manager, { prompt: () => { throw new Error("sync"); } }));
  await assert.rejects(() => synchronous.send({ type: "prompt", message: "sync" }), /sync/);
  units = synchronous.getProjectedEventHub().replayAfter(synchronous.getProjectedEventHub().streamEpoch, 0).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  synchronous.destroy();

  const resolvers = [];
  const overlap = new AgentSessionWrapper(fakeInner(manager, { prompt: () => new Promise((resolve) => resolvers.push(resolve)) }));
  await overlap.send({ type: "prompt", message: "one" });
  await overlap.send({ type: "prompt", message: "two" });
  const cursor = overlap.getProjectedEventHub().cursor;
  resolvers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(overlap.getProjectedEventHub().replayAfter(overlap.getProjectedEventHub().streamEpoch, cursor).units.some((unit) => unit.type === "run_settled"), false);
  resolvers[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(overlap.getProjectedEventHub().replayAfter(overlap.getProjectedEventHub().streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);
  overlap.destroy();
});

test("hosted extension-binding failure emits public events before one authoritative projected settlement", async (t) => {
  const { manager } = createSource(t);
  let rejectBinding;
  const binding = new Promise((_, reject) => { rejectBinding = reject; });
  const legacy = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { bindExtensions: async () => binding }));
  wrapper.onEvent((event) => {
    if (event.type === "prompt_error" || event.type === "prompt_done") throw new Error("hostile hosted observer");
  });
  wrapper.onEvent((event) => legacy.push(event.type));
  wrapper.beginExtensionBinding();
  wrapper.startHostedPrompt("hosted", noOpHostedLifecycle());
  const cursor = wrapper.getProjectedEventHub().cursor;
  rejectBinding(new Error("private binding payload"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(legacy.slice(-2), ["prompt_error", "prompt_done"]);
  const units = wrapper.getProjectedEventHub().replayAfter(wrapper.getProjectedEventHub().streamEpoch, cursor).units;
  assert.deepEqual(units.filter((unit) => unit.type === "notice").map((unit) => unit.message), ["Hosted target prompt failed"]);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  wrapper.destroy();
});

test("standalone compaction success/error and prompt overlap obey last-claim settlement", async (t) => {
  const { manager } = createSource(t);
  const compactResolvers = [];
  let compactMode = "success";
  let abortCompaction;
  let abortCalls = 0;
  const promptResolvers = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    compact: () => {
      if (compactMode === "error") return Promise.reject(new Error("compact failure"));
      return new Promise((resolve, reject) => {
        if (compactMode === "abort") abortCompaction = () => reject(new Error("abort"));
        else compactResolvers.push(resolve);
      });
    },
    abortCompaction: () => { abortCalls += 1; abortCompaction?.(); },
    prompt: () => new Promise((resolve) => promptResolvers.push(resolve)),
  }));
  const hub = wrapper.getProjectedEventHub();
  let cursor = hub.cursor;
  const compact = wrapper.send({ type: "compact" });
  compactResolvers.shift()({ ok: true });
  await compact;
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);

  compactMode = "error";
  cursor = hub.cursor;
  await assert.rejects(wrapper.send({ type: "compact" }), /compact failure/);
  let failureUnits = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(failureUnits.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(failureUnits.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);

  compactMode = "abort";
  cursor = hub.cursor;
  const aborted = wrapper.send({ type: "compact" });
  await wrapper.send({ type: "abort_compaction" });
  await assert.rejects(aborted, /abort/);
  assert.equal(abortCalls, 1);
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);

  compactMode = "success";
  await wrapper.send({ type: "prompt", message: "overlap" });
  const overlappingCompact = wrapper.send({ type: "compact" });
  cursor = hub.cursor;
  promptResolvers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.some((unit) => unit.type === "run_settled"), false);
  compactResolvers.shift()({ ok: true });
  await overlappingCompact;
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);
  wrapper.destroy();
});

test("custom UI promises settle across pre-mount destruction and eventually produced components dispose exactly once", async (t) => {
  for (const waitForFactory of [false, true]) {
    const { manager } = createSource(t);
    let ui;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { bindExtensions: async ({ uiContext }) => { ui = uiContext; } }));
    wrapper.beginExtensionBinding();
    await new Promise((resolve) => setImmediate(resolve));

    let resolveComponent;
    let factoryStarted = false;
    let disposeCalls = 0;
    const component = new Promise((resolve) => { resolveComponent = resolve; });
    const pending = ui.custom(() => {
      factoryStarted = true;
      return component;
    });
    if (waitForFactory) {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(factoryStarted, true);
    }
    wrapper.destroy();
    assert.equal(await pending, undefined, "public custom promise settles at destruction");
    resolveComponent({ render: () => ["late"], dispose: () => { disposeCalls += 1; } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(factoryStarted, true, "already scheduled factory setup is allowed to finish safely");
    assert.equal(disposeCalls, 1);
    assert.deepEqual(wrapper.getProjectedEventHub().getState().customUis, []);
    assert.equal(wrapper.getProjectedEventHub().isClosed(), true);
  }
});

test("extension durable state and every dialog cleanup path reach projection before destruction closes it", async (t) => {
  const { manager } = createSource(t);
  let ui;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    bindExtensions: async ({ uiContext }) => { ui = uiContext; },
  }));
  wrapper.beginExtensionBinding();
  await new Promise((resolve) => setImmediate(resolve));
  const hub = wrapper.getProjectedEventHub();
  ui.setStatus("status", "ready");
  ui.setWidget("widget", ["line"], { placement: "belowEditor" });
  ui.setTitle("title");
  const controller = new AbortController();
  const pending = ui.input("Input", "placeholder", { signal: controller.signal });
  assert.equal(hub.getState().dialogs.length, 1);
  controller.abort();
  await pending;
  assert.deepEqual(hub.getState().dialogs, []);
  assert.deepEqual(hub.getState().statuses, [{ key: "status", text: "ready" }]);
  assert.deepEqual(hub.getState().widgets, [{ key: "widget", lines: ["line"], placement: "belowEditor" }]);
  assert.equal(hub.getState().title, "title");
  await wrapper.send({ type: "reload" });
  assert.deepEqual(hub.getState().statuses, []);
  assert.deepEqual(hub.getState().widgets, []);
  assert.equal(hub.getState().title, "title");

  const responsePending = ui.select("Select", ["a"]);
  const responseId = hub.getState().dialogs[0].id;
  await wrapper.send({ type: "extension_ui_response", id: responseId, value: "a" });
  assert.equal(await responsePending, "a");
  assert.deepEqual(hub.getState().dialogs, []);

  const timedOut = ui.input("Timeout", undefined, { timeout: 2 });
  assert.equal(hub.getState().dialogs.length, 1);
  await timedOut;
  assert.deepEqual(hub.getState().dialogs, []);

  let finishCustom;
  let customDisposed = 0;
  const custom = ui.custom((_tui, _theme, _keys, done) => {
    finishCustom = done;
    return { render: () => ["custom"], dispose: () => { customDisposed += 1; } };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hub.getState().customUis.length, 1);
  finishCustom("done");
  assert.equal(await custom, "done");
  assert.deepEqual(hub.getState().customUis, []);
  assert.equal(customDisposed, 1);

  const unresolvedCustom = ui.custom(() => ({ render: () => ["pending"], dispose: () => { customDisposed += 1; } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hub.getState().customUis.length, 1);
  const unresolved = ui.confirm("Confirm", "message");
  assert.equal(hub.getState().dialogs.length, 1);
  const seen = [];
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => seen.push(unit.type));
  wrapper.destroy();
  await unresolved;
  await unresolvedCustom;
  assert.ok(seen.includes("extension_dialog_closed"));
  assert.ok(seen.includes("extension_custom_closed"));
  assert.equal(customDisposed, 2);
  assert.equal(seen.some((type) => type === "snapshot_start"), false, "destruction does not invent finality");
  assert.equal(hub.isClosed(), true);
});

test("retained extension dialog context fails closed immediately after destruction with documented defaults", async (t) => {
  const { manager } = createSource(t);
  let ui;
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
    bindExtensions: async ({ uiContext }) => { ui = uiContext; },
  }));
  wrapper.start();
  wrapper.beginExtensionBinding();
  await new Promise((resolve) => setImmediate(resolve));
  const hub = wrapper.getProjectedEventHub();
  const legacy = [];
  wrapper.onEvent((event) => legacy.push(event));
  nativeListener({ type: "agent_start" });
  wrapper.destroy();
  const before = { cursor: hub.cursor, floor: hub.floor, state: hub.getState(), legacy: legacy.length };

  const originalSetTimeout = globalThis.setTimeout;
  let timersCreated = 0;
  globalThis.setTimeout = (...args) => { timersCreated += 1; return originalSetTimeout(...args); };
  try {
    const values = await Promise.all([
      ui.select("Select", ["a"], { timeout: 10 }),
      ui.confirm("Confirm", "message", { timeout: 10 }),
      ui.input("Input", "placeholder", { timeout: 10 }),
      ui.editor("Editor", "prefill", { timeout: 10 }),
    ]);
    assert.deepEqual(values, [undefined, false, undefined, undefined]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(timersCreated, 0);
  assert.equal(hub.isClosed(), true);
  assert.equal(hub.cursor, before.cursor);
  assert.equal(hub.floor, before.floor);
  assert.deepEqual(hub.getState(), before.state);
  assert.equal(legacy.length, before.legacy);
  assert.deepEqual(hub.getState().dialogs, []);
});

test("extension-binding diagnostics are bounded and contain no session identifier", async (t) => {
  const { manager } = createSource(t);
  const lines = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line) => lines.push(String(line));
  console.error = (line) => lines.push(String(line));
  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  const successful = new AgentSessionWrapper(fakeInner(manager, { bindExtensions: async () => {} }));
  successful.beginExtensionBinding();
  await new Promise((resolve) => setImmediate(resolve));
  successful.destroy();
  const failed = new AgentSessionWrapper(fakeInner(manager, {
    bindExtensions: async () => { throw new Error("private extension payload"); },
  }));
  failed.beginExtensionBinding();
  await new Promise((resolve) => setImmediate(resolve));
  failed.destroy();

  assert.ok(lines.some((line) => line.includes("stage=dispatched outcome=ok")));
  assert.ok(lines.some((line) => line.includes("stage=failed errorClass=Error")));
  assert.ok(lines.every((line) => line.length <= 160));
  assert.ok(lines.every((line) => !line.includes(manager.getSessionId())));
  assert.ok(lines.every((line) => !line.includes("private extension payload")));
});

test("native lifecycle promotion and release require the matching projected input commit", async (t) => {
  await t.test("sequence rejection preserves the committed native start without false finality", () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    t.after(() => wrapper.destroy());
    const hub = wrapper.getProjectedEventHub();
    wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 3;
    const raw = [];
    wrapper.onEvent((event) => raw.push(event));
    nativeListener({ type: "agent_start" });
    const terminal = { type: "agent_settled" };
    nativeListener(terminal);
    assert.strictEqual(raw.at(-1), terminal);
    assert.equal(hub.cursor, Number.MAX_SAFE_INTEGER - 2);
    assert.equal(hub.getState().active, true);
    assert.equal(wrapper.nativeAgentTurnCount, 1);
    assert.equal(wrapper.reservedNativeTerminalCount, 0);
    const units = hub.replayAfter(hub.streamEpoch, Number.MAX_SAFE_INTEGER - 3).units;
    assert.equal(units.filter((unit) => unit.type === "native_settled").length, 0);
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 0);
    wrapper.destroy();
  });

  await t.test("aggregate terminal rejection restores the manual claim for a smaller valid recovery", () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    t.after(() => wrapper.destroy());
    const hub = wrapper.getProjectedEventHub();
    nativeListener({ type: "compaction_start", reason: "manual" });
    const cursor = hub.cursor;
    const originalLimits = wrapper.projectedHub.stateLimits;
    wrapper.projectedHub.stateLimits = Object.freeze({
      ...originalLimits,
      snapshotByteLimit: Buffer.byteLength(JSON.stringify(hub.getState())) + 8,
    });
    nativeListener({
      type: "compaction_end",
      reason: "manual",
      aborted: false,
      willRetry: false,
      errorMessage: "bounded".repeat(20),
    });
    let units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "compaction_finished").length, 0);
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 0);
    assert.equal(wrapper.standaloneNativeCompactionCount, 1);
    assert.equal(wrapper.reservedStandaloneCompactionTerminalCount, 0);
    assert.equal(hub.getState().active, true);

    wrapper.projectedHub.stateLimits = originalLimits;
    nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
    units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "compaction_finished").length, 1);
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
    assert.equal(wrapper.standaloneNativeCompactionCount, 0);
    assert.equal(hub.getState().active, false);
    wrapper.destroy();
  });

  await t.test("a rejected projected start never promotes a causal activity claim", () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    t.after(() => wrapper.destroy());
    const hub = wrapper.getProjectedEventHub();
    wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;
    const start = { type: "agent_start" };
    let delivered;
    wrapper.onEvent((event) => { delivered = event; });
    nativeListener(start);
    assert.strictEqual(delivered, start);
    assert.equal(wrapper.nativeAgentTurnCount, 0);
    assert.equal(wrapper.reservedNativeTerminalCount, 0);
    assert.equal(hub.getState().active, false);
    assert.equal(hub.cursor, Number.MAX_SAFE_INTEGER - 2);
    wrapper.destroy();
  });
});

test("current manual willRetry true releases exactly once only after compaction_finished commits", async (t) => {
  await t.test("standalone completion finalizes and the next run remains balanced", () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    const hub = wrapper.getProjectedEventHub();
    const cursor = hub.cursor;
    nativeListener({ type: "compaction_start", reason: "manual" });
    nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: true });
    let units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.deepEqual(units.filter((unit) => ["compaction_finished", "run_settled"].includes(unit.type)).map((unit) => unit.type), ["compaction_finished", "run_settled"]);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
    assert.equal(wrapper.standaloneNativeCompactionCount, 0);
    assert.equal(hub.getState().active, false);
    nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: true });
    assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);

    const next = hub.cursor;
    nativeListener({ type: "compaction_start", reason: "manual" });
    nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false });
    units = hub.replayAfter(hub.streamEpoch, next).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    wrapper.destroy();
  });

  await t.test("an enclosing wrapper prompt claim prevents premature manual retry finality", async () => {
    const { manager } = createSource(t);
    let nativeListener;
    let resolvePrompt;
    const pendingPrompt = new Promise((resolve) => { resolvePrompt = resolve; });
    const wrapper = new AgentSessionWrapper(fakeInner(manager, {
      subscribe(listener) { nativeListener = listener; return () => {}; },
      prompt: () => pendingPrompt,
    }));
    wrapper.start();
    t.after(() => wrapper.destroy());
    const hub = wrapper.getProjectedEventHub();
    const cursor = hub.cursor;
    const run = wrapper.send({ type: "prompt", message: "overlap" });
    await new Promise((resolve) => setImmediate(resolve));
    nativeListener({ type: "compaction_start", reason: "manual" });
    nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: true });
    let units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "compaction_finished").length, 1);
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
    assert.equal(hub.getState().active, true);
    resolvePrompt();
    await run;
    units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  });

  await t.test("enclosing native activity prevents premature manual retry finality", () => {
    const { manager } = createSource(t);
    let nativeListener;
    const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
    wrapper.start();
    const hub = wrapper.getProjectedEventHub();
    const cursor = hub.cursor;
    nativeListener({ type: "agent_start" });
    nativeListener({ type: "compaction_start", reason: "manual" });
    nativeListener({ type: "compaction_end", reason: "manual", aborted: false, willRetry: true });
    let units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "compaction_finished").length, 1);
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
    assert.equal(hub.getState().active, true);
    nativeListener({ type: "agent_settled" });
    units = hub.replayAfter(hub.streamEpoch, cursor).units;
    assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
    assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
    wrapper.destroy();
  });
});

test("queued native receipt settlement waits for nested raw and every enclosing fanout observer", (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, { subscribe(listener) { nativeListener = listener; return () => {}; } }));
  wrapper.start();
  const hub = wrapper.getProjectedEventHub();
  const timeline = [];
  let nested = false;
  hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "activity_started" && !nested) {
      nested = true;
      nativeListener({ type: "agent_settled" });
      timeline.push("projected-listener-returned");
    }
    if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("final");
  });
  wrapper.onEvent((event) => timeline.push(`raw:${event.type}`));
  nativeListener({ type: "agent_start" });
  assert.deepEqual(timeline, ["raw:agent_settled", "projected-listener-returned", "raw:agent_start", "final"]);
  assert.equal(hub.getState().active, false);
  wrapper.destroy();
});
