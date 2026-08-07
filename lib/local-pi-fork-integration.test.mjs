import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION as CODING_AGENT_VERSION,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  Type,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  AgentSessionWrapper,
  getRunningRpcSessionIds,
  subscribeRunningSessions,
} = await jiti.import("./rpc-manager.ts");

function resetRunningProjectionState() {
  globalThis.__piRunningSessionIds = new Set();
  globalThis.__piRunningSessionPublishers = new Map();
  globalThis.__piRunningPublisherEpochs = new WeakMap();
  globalThis.__piRunningListeners = new Set();
}

function indexOfType(trace, type) {
  return trace.findIndex((entry) => entry.type === type);
}

function countType(trace, type) {
  return trace.filter((entry) => entry.type === type).length;
}

function waitForPromptDone(wrapper) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the packaged fork prompt"));
    }, 10_000);
    const unsubscribe = wrapper.onEvent((event) => {
      if (event.type !== "prompt_done") return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

test("packaged fork compacts between tool turns without projecting or publishing idle before native settlement", { timeout: 30_000 }, async (t) => {
  assert.equal(CODING_AGENT_VERSION, "0.84.0-bac2qh.734502cb8", "test must load the installed fork artifact");
  resetRunningProjectionState();
  const root = mkdtempSync(join(tmpdir(), "pi-web-local-fork-integration-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  t.after(() => {
    resetRunningProjectionState();
    rmSync(root, { recursive: true, force: true });
  });

  const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 2_000 }] });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "synthetic-key" }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 0, keepRecentTokens: 100 },
    retry: { enabled: false },
  });
  const sessionManager = SessionManager.inMemory(cwd);
  const now = Date.now() - 100_000;
  for (let index = 0; index < 12; index += 1) {
    sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: `synthetic-user-${index}-${"u".repeat(800)}` }],
      timestamp: now + index * 2,
    });
    sessionManager.appendMessage({
      ...fauxAssistantMessage(`synthetic-assistant-${index}-${"a".repeat(800)}`, {
        timestamp: now + index * 2 + 1,
      }),
      api: faux.getModel().api,
      provider: faux.getModel().provider,
      model: faux.getModel().id,
    });
  }

  const services = await createAgentSessionServices({ cwd, agentDir, settingsManager, modelRuntime });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model: faux.getModel(),
    tools: ["probe_tool"],
    customTools: [{
      name: "probe_tool",
      label: "Probe Tool",
      description: "Returns one synthetic result",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [{ type: "text", text: "synthetic-result" }],
        details: {},
      }),
    }],
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("probe_tool", {}, { id: "synthetic-tool-call" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("synthetic-compaction-summary"),
    fauxAssistantMessage("synthetic-turn-prefix-summary"),
    fauxAssistantMessage("synthetic-final-answer"),
  ]);

  const nativeTrace = [];
  const timeline = [];
  const projectedBeforeNativeSettlement = [];
  let nativeSettledObserved = false;
  let compactionEndChecked = false;
  const unsubscribeNative = session.subscribe((event) => {
    const entry = { type: event.type };
    if (event.type === "compaction_start" || event.type === "compaction_end") {
      entry.reason = event.reason;
      if (event.type === "compaction_end") entry.aborted = event.aborted;
    }
    nativeTrace.push(entry);
    if (event.type === "agent_settled") nativeSettledObserved = true;
    if (event.type === "compaction_end") {
      const hub = wrapper.getProjectedEventHub();
      const units = hub.replayAfter(hub.streamEpoch, 0).units;
      assert.equal(wrapper.isRunning(), true, "between-turn compaction must remain inside the active run");
      assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
      assert.equal(units.some((unit) => unit.type === "run_settled"), false);
      assert.equal(units.some((unit) => unit.type === "snapshot_start" && unit.reason === "final"), false);
      compactionEndChecked = true;
    }
  });
  t.after(unsubscribeNative);

  const wrapper = new AgentSessionWrapper(session);
  t.after(() => { if (wrapper.isAlive()) wrapper.destroy(); });
  const hub = wrapper.getProjectedEventHub();
  const projectedCursor = hub.cursor;
  const projected = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "run_settled") {
      if (!nativeSettledObserved) projectedBeforeNativeSettlement.push("run_settled");
      timeline.push("projected-settled");
    }
    if (unit.type === "snapshot_start" && unit.reason === "final") {
      if (!nativeSettledObserved) projectedBeforeNativeSettlement.push("final_snapshot");
      timeline.push("projected-final");
    }
  });
  t.after(projected.unsubscribe);
  const unsubscribeRunning = subscribeRunningSessions((ids) => {
    const state = ids.size === 0 ? "global-idle" : "global-running";
    if (state === "global-idle") assert.equal(nativeSettledObserved, true, "global idle preceded native agent_settled");
    timeline.push(state);
  });
  t.after(unsubscribeRunning);

  wrapper.start();
  wrapper.beginExtensionBinding();
  const promptDone = waitForPromptDone(wrapper);
  await wrapper.send({ type: "prompt", message: "synthetic-start" });
  await promptDone;

  assert.equal(compactionEndChecked, true);
  assert.equal(
    faux.state.callCount,
    4,
    "tool response, split-turn compaction summaries, and continued response must all run",
  );
  assert.equal(faux.getPendingResponseCount(), 0);
  assert.equal(countType(nativeTrace, "agent_start"), 1);
  assert.equal(countType(nativeTrace, "compaction_start"), 1);
  assert.equal(countType(nativeTrace, "compaction_end"), 1);
  assert.equal(countType(nativeTrace, "agent_end"), 1);
  assert.equal(countType(nativeTrace, "agent_settled"), 1);
  assert.equal(nativeTrace.find((entry) => entry.type === "compaction_start")?.reason, "threshold");
  assert.deepEqual(
    nativeTrace.find((entry) => entry.type === "compaction_end"),
    { type: "compaction_end", reason: "threshold", aborted: false },
  );

  const startIndex = indexOfType(nativeTrace, "agent_start");
  const compactionStartIndex = indexOfType(nativeTrace, "compaction_start");
  const compactionEndIndex = indexOfType(nativeTrace, "compaction_end");
  const agentEndIndex = indexOfType(nativeTrace, "agent_end");
  const settledIndex = indexOfType(nativeTrace, "agent_settled");
  assert.ok(startIndex < compactionStartIndex);
  assert.ok(compactionStartIndex < compactionEndIndex);
  assert.ok(compactionEndIndex < agentEndIndex);
  assert.ok(agentEndIndex < settledIndex);
  const continuedMessageEndIndex = nativeTrace.findIndex(
    (entry, index) => index > compactionEndIndex && entry.type === "message_end",
  );
  assert.ok(continuedMessageEndIndex > compactionEndIndex, "the continued response must finish after compaction");
  assert.ok(continuedMessageEndIndex < agentEndIndex, "the continued response must finish before agent_end");

  const projectedUnits = hub.replayAfter(hub.streamEpoch, projectedCursor).units;
  assert.equal(projectedUnits.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(projectedUnits.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.deepEqual(projectedBeforeNativeSettlement, [], "projected finality preceded native agent_settled");
  assert.equal(hub.getState().active, false);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.equal(timeline.filter((entry) => entry === "global-running").length, 1);
  assert.equal(timeline.filter((entry) => entry === "global-idle").length, 1);
  assert.ok(timeline.indexOf("projected-final") < timeline.indexOf("global-idle"));
});
