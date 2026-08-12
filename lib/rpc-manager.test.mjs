import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import {
  ExtensionRunner,
  SessionManager,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const { createPiWebTransportGateway, installPiWebTransportGateway } = require("../bin/pi-web-transport-gateway.js");
const { createWebSocketHeartbeat } = require("../bin/pi-web-server.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  AgentSessionWrapper,
  activateRpcRuntimeOwner,
  RPC_RECOGNIZED_COMMAND_TYPES,
  RPC_SESSION_IDLE_TIMEOUT_MS,
  assertExistingRpcSessionIdentity,
  getOrCreateRpcSession,
  getRpcSession,
  getRunningRpcSessionIds,
  getRunningRpcSessionProjection,
  isCurrentRpcSession,
  getSessionListRefreshGeneration,
  notifySessionListRefresh,
  parseOpenAiFastStatusNotification,
  publishRunningSessionState,
  startRpcSession,
  subscribeRunningSessions,
  subscribeSessionListRefresh,
} = await jiti.import("./rpc-manager.ts");
const {
  PI_WEB_OPENAI_FAST_MODE_ESCAPED_EXTENSION_STATUS_KEY,
  PI_WEB_OPENAI_FAST_MODE_STATUS_KEY,
} = await jiti.import("./openai-fast-mode-status.ts");
const { HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL } = await jiti.import("./hosted-implementation-session.ts");
const {
  SIDE_SESSION_EXCLUDED_TOOL_NAMES,
  SIDE_SESSION_FORBIDDEN_EXTENSION_COMMANDS,
  SIDE_SESSION_SYSTEM_PROMPT,
  classifySideSession,
} = await jiti.import("./side-session.ts");
const { createGlobalStatusChannelHandler } = await jiti.import("./global-status-channel.ts");
const { createFileWatchChannelHandler, createFileWatchTicketContext } = await jiti.import("./file-watch-channel.ts");
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
  const emitShutdown = state.emitShutdown ?? (async (event) => {
    (state.shutdownEvents ??= []).push(event);
  });
  if (state.extensionRunner && typeof state.extensionRunner.emit !== "function") {
    state.extensionRunner.emit = emitShutdown;
  }
  const defaultExtensionRunner = { emit: emitShutdown, setUIContext: () => {} };
  return {
    get sessionId() { return manager.getSessionId(); },
    get sessionFile() { return manager.getSessionFile(); },
    get isStreaming() { return state.isStreaming ?? false; },
    get isCompacting() { return state.isCompacting ?? false; },
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    get model() { return state.model; },
    pendingMessageCount: 0,
    sessionManager: manager,
    agent: { state: {} },
    get extensionRunner() { return state.extensionRunner ?? defaultExtensionRunner; },
    promptTemplates: state.promptTemplates ?? [],
    resourceLoader: state.resourceLoader ?? { getSkills: () => ({ skills: [] }) },
    modelRuntime: {
      getModel: (provider, modelId) => state.models?.find((model) => model.provider === provider && model.id === modelId),
    },
    bindExtensions: state.bindExtensions,
    reload: state.reload ?? (async () => {}),
    subscribe: state.subscribe ?? (() => () => {}),
    dispose: state.dispose ?? (() => { state.disposeCalls = (state.disposeCalls ?? 0) + 1; }),
    prompt: state.prompt ?? (async () => {}),
    setModel: state.setModel ?? (async (model) => { state.model = model; }),
    abort: state.abort ?? (async () => { state.abortCalls = (state.abortCalls ?? 0) + 1; }),
    steer: state.steer ?? (async (message) => { (state.steerCalls ??= []).push(message); }),
    followUp: state.followUp ?? (async (message) => { (state.followUpCalls ??= []).push(message); }),
    compact: state.compact ?? (async () => ({})),
    navigateTree: state.navigateTree ?? (async (targetId) => { (state.navigateCalls ??= []).push(targetId); return { cancelled: false }; }),
    getAllTools: state.getAllTools ?? (() => state.allTools ?? []),
    getActiveToolNames: state.getActiveToolNames ?? (() => state.activeToolNames ?? []),
    setActiveToolsByName: state.setActiveToolsByName ?? ((names) => { state.activeToolNames = [...names]; }),
    setThinkingLevel: state.setThinkingLevel ?? (() => {}),
    setSessionName: state.setSessionName ?? ((name) => { state.sessionName = name; }),
    getSessionStats: state.getSessionStats ?? (() => ({})),
    getLastAssistantText: state.getLastAssistantText ?? (() => undefined),
    setAutoCompactionEnabled: state.setAutoCompactionEnabled ?? (() => {}),
    setAutoRetryEnabled: state.setAutoRetryEnabled ?? (() => {}),
    clearQueue: state.clearQueue ?? (() => ({ steering: [], followUp: [] })),
    abortCompaction: state.abortCompaction ?? (() => { state.abortCompactionCalls = (state.abortCompactionCalls ?? 0) + 1; }),
    getContextUsage: () => undefined,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
  };
}

function createOpenAiFastFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-openai-fast-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageDir = join(root, "node_modules", "@benvargas", "pi-openai-fast");
  const extensionPath = join(packageDir, "extensions", "index.ts");
  mkdirSync(join(packageDir, "extensions"), { recursive: true });
  writeFileSync(join(packageDir, "package.json"), options.manifestRaw ?? JSON.stringify({
    name: options.packageName ?? "@benvargas/pi-openai-fast",
    version: options.version ?? "1.1.0",
  }));
  writeFileSync(extensionPath, "// fixture only\n");

  const unrelatedDir = join(root, "node_modules", "unrelated-fast");
  const unrelatedPath = join(unrelatedDir, "index.js");
  mkdirSync(unrelatedDir, { recursive: true });
  writeFileSync(join(unrelatedDir, "package.json"), JSON.stringify({ name: "unrelated-fast", version: "1.0.0" }));
  writeFileSync(unrelatedPath, "// fixture only\n");

  const runtime = {
    active: options.active ?? false,
    model: options.model === null ? undefined : (options.model ?? { provider: "openai", id: "gpt-5.4" }),
    models: [
      { provider: "openai", id: "gpt-5.4" },
      { provider: "other", id: "unsupported" },
    ],
    supportedModelKeys: new Set(options.supportedModelKeys ?? ["openai/gpt-5.4"]),
    statusBehavior: options.statusBehavior ?? "normal",
    statusCalls: 0,
    commandCalls: [],
    originalNotifications: [],
    statusGate: null,
    statusGateResolve: null,
    nativeListener: null,
    extensionRunner: null,
  };

  const describeStatus = (model) => {
    const modelKey = model ? `${model.provider}/${model.id}` : null;
    if (!runtime.active) return `Fast mode is off. Current model: ${modelKey ?? "none"}.`;
    if (!modelKey) return "Fast mode is on. No model is selected. Supported models: openai/gpt-5.4.";
    if (runtime.supportedModelKeys.has(modelKey)) return `Fast mode is on for ${modelKey}.`;
    return `Fast mode is on, but ${modelKey} does not support it. Supported models: openai/gpt-5.4.`;
  };

  const emitStatus = (ctx) => {
    switch (runtime.statusBehavior) {
      case "missing": return;
      case "multiple":
        ctx.ui.notify(describeStatus(ctx.model), "info");
        ctx.ui.notify(describeStatus(ctx.model), "info");
        return;
      case "oversized":
        ctx.ui.notify(`Fast mode is on. No model is selected. Supported models: ${"x".repeat(5_000)}.`, "info");
        return;
      case "mismatched":
        ctx.ui.notify("Fast mode is on for openai/different.", "info");
        return;
      case "wrong_type":
        ctx.ui.notify(describeStatus(ctx.model), "warning");
        return;
      case "throw": throw new Error("fixture probe failure");
      default:
        ctx.ui.notify(describeStatus(ctx.model), "info");
    }
  };

  const handler = async (args, ctx) => {
    const command = args.trim().toLowerCase();
    runtime.commandCalls.push(command);
    if (command === "status") {
      runtime.statusCalls += 1;
      if (runtime.statusGate) await runtime.statusGate;
      emitStatus(ctx);
      return;
    }
    if (command === "on") runtime.active = true;
    else if (command === "off") runtime.active = false;
    else runtime.active = !runtime.active;
    ctx.ui.notify(runtime.active ? describeStatus(ctx.model) : "Fast mode disabled.", "info");
  };

  const invocationName = options.invocationName ?? (options.duplicate ? "fast:2" : "fast");
  const fastCommand = {
    name: "fast",
    invocationName,
    description: "fixture Fast command",
    sourceInfo: {
      path: extensionPath,
      source: "npm:@benvargas/pi-openai-fast",
      scope: "user",
      origin: options.origin ?? "package",
      baseDir: packageDir,
    },
    handler,
  };
  const unrelatedCommand = {
    name: "fast",
    invocationName: options.duplicate ? "fast:1" : "fast",
    description: "unrelated command",
    sourceInfo: {
      path: unrelatedPath,
      source: "npm:unrelated-fast",
      scope: "user",
      origin: "package",
      baseDir: unrelatedDir,
    },
    handler: async () => {},
  };
  const commands = options.absent
    ? (options.includeUnrelated ? [unrelatedCommand] : [])
    : (options.duplicate ? [unrelatedCommand, fastCommand] : [fastCommand]);
  const contextUi = {
    notify(message, type) { runtime.originalNotifications.push({ message, type }); },
  };
  const runner = {
    getRegisteredCommands: () => commands.map((command) => ({ ...command })),
    getCommand: (name) => {
      const command = commands.find((candidate) => candidate.invocationName === name);
      return command ? { ...command } : undefined;
    },
    createCommandContext: () => ({
      model: options.contextModel === null ? undefined : (options.contextModel ?? runtime.model),
      ui: contextUi,
    }),
    setUIContext: () => {},
  };
  runtime.extensionRunner = runner;

  const manager = SessionManager.create(join(root, "cwd"), join(root, "sessions"));
  const inner = fakeInner(manager, {
    ...runtime,
    bindExtensions: async ({ uiContext }) => {
      if (options.collisionText) {
        uiContext.setStatus(PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, options.collisionText);
      }
    },
    subscribe: (listener) => {
      runtime.nativeListener = listener;
      return () => { runtime.nativeListener = null; };
    },
    prompt: async (text) => {
      if (!text.startsWith("/")) return;
      const spaceIndex = text.indexOf(" ");
      const name = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
      const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
      const command = runner.getCommand(name);
      if (command) await command.handler(args, runner.createCommandContext());
    },
    reload: async () => { await options.onReload?.(runtime); },
  });
  // Keep fakeInner's mutable state object and the fixture runtime synchronized.
  Object.defineProperties(inner, {
    model: { get: () => runtime.model },
    extensionRunner: { get: () => runtime.extensionRunner },
  });
  inner.modelRuntime = { getModel: (provider, modelId) => runtime.models.find((model) => model.provider === provider && model.id === modelId) };
  inner.setModel = async (model) => { runtime.model = model; };

  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  wrapper.beginExtensionBinding();
  t.after(() => { if (wrapper.isAlive()) wrapper.destroy(); });

  return {
    wrapper,
    inner,
    manager,
    runtime,
    invocationName,
    ready: () => wrapper.send({ type: "get_state" }),
    emitNative(event) { runtime.nativeListener?.(event); },
    blockNextStatus() {
      runtime.statusGate = new Promise((resolve) => { runtime.statusGateResolve = resolve; });
      return () => {
        runtime.statusGateResolve?.();
        runtime.statusGate = null;
        runtime.statusGateResolve = null;
      };
    },
  };
}

function resetRunningProjectionState(initial = new Set()) {
  globalThis.__piRunningSessionIds = initial;
  globalThis.__piRunningSessionPublishers = new Map();
  globalThis.__piRunningPublisherEpochs = new WeakMap();
  globalThis.__piRunningListeners = new Set();
}

function createIdleClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  const diagnostics = [];
  return {
    now: () => now,
    diagnostics,
    schedule(callback, delay) {
      const timer = { id: next++, at: now + delay, callback, unrefCalls: 0, unref() { this.unrefCalls += 1; } };
      timers.set(timer.id, timer);
      return timer;
    },
    cancel(timer) { if (timer) timers.delete(timer.id); },
    diagnostic(entry) { diagnostics.push(entry.category); },
    advance(milliseconds) {
      now += milliseconds;
      for (;;) {
        const due = [...timers.values()].filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.delete(due.id);
        due.callback();
      }
    },
    timerCount: () => timers.size,
  };
}

test("OpenAI Fast 1.1.0 status parsing is exact, model-bound, and bounded", () => {
  assert.equal(parseOpenAiFastStatusNotification("Fast mode is off. Current model: openai/gpt-5.4.", "info", "openai/gpt-5.4"), "off");
  assert.equal(parseOpenAiFastStatusNotification("Fast mode is off. Current model: none.", "info", null), "off");
  assert.equal(parseOpenAiFastStatusNotification("Fast mode is on for openai/gpt-5.4.", "info", "openai/gpt-5.4"), "effective");
  assert.equal(parseOpenAiFastStatusNotification(
    "Fast mode is on, but other/model does not support it. Supported models: openai/gpt-5.4.",
    "info",
    "other/model",
  ), "unavailable");
  assert.equal(parseOpenAiFastStatusNotification(
    "Fast mode is on. No model is selected. Supported models: openai/gpt-5.4.",
    "info",
    null,
  ), "unavailable");
  assert.equal(parseOpenAiFastStatusNotification("Fast mode is on for openai/other.", "info", "openai/gpt-5.4"), null);
  assert.equal(parseOpenAiFastStatusNotification("Fast mode is on for openai/gpt-5.4.", "warning", "openai/gpt-5.4"), null);
  assert.equal(parseOpenAiFastStatusNotification(`Fast mode is on for ${"x".repeat(5_000)}.`, "info", "x".repeat(5_000)), null);
  assert.equal(parseOpenAiFastStatusNotification("x".repeat(1_000_000), "info", null), null);
  assert.equal(parseOpenAiFastStatusNotification("Fast mode is on. No model is selected. Supported models: .", "info", null), null);
});

test("authenticated Fast package provenance controls host state and duplicate invocation resolution", async (t) => {
  await t.test("package absent or source mismatch has no host badge", async (t) => {
    for (const options of [
      { absent: true, includeUnrelated: true },
      { packageName: "lookalike-fast" },
      { origin: "top-level" },
      { manifestRaw: "{" },
      { manifestRaw: " ".repeat(40_000) },
    ]) {
      const fixture = createOpenAiFastFixture(t, options);
      const state = await fixture.ready();
      assert.equal(state.extensionStatuses.some((status) => status.key === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY), false);
      assert.equal(fixture.runtime.statusCalls, 0);
    }
  });

  await t.test("identified unsupported version fails closed without invocation", async (t) => {
    const fixture = createOpenAiFastFixture(t, { version: "1.2.0", active: true });
    const state = await fixture.ready();
    assert.deepEqual(state.extensionStatuses.at(-1), {
      key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY,
      text: "unknown",
    });
    assert.equal(fixture.runtime.statusCalls, 0);
  });

  await t.test("exact duplicate command uses its resolved name and keeps host authority reserved", async (t) => {
    const fixture = createOpenAiFastFixture(t, { duplicate: true, active: true, collisionText: "extension collision" });
    const statusEvents = [];
    fixture.wrapper.onEvent((event) => {
      if (event.type === "extension_ui_request" && event.method === "setStatus") statusEvents.push(event);
    });
    const state = await fixture.ready();
    assert.equal(fixture.invocationName, "fast:2");
    assert.equal(fixture.runtime.statusCalls, 1);
    assert.deepEqual(fixture.runtime.originalNotifications, [], "the authenticated probe must not emit a browser toast");
    assert.deepEqual(state.extensionStatuses, [
      { key: PI_WEB_OPENAI_FAST_MODE_ESCAPED_EXTENSION_STATUS_KEY, text: "extension collision" },
      { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
    ]);
    assert.ok(statusEvents.some((event) => event.statusKey === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY && event.statusText === "effective"));
  });

  await t.test("same-runner lookup ambiguity retains an identified package as unknown", async (t) => {
    for (const breakLookup of [
      (runner) => { runner.getRegisteredCommands = () => { throw new Error("lookup failed"); }; },
      (runner) => { runner.getRegisteredCommands = () => Array.from({ length: 257 }, () => ({})); },
    ]) {
      const fixture = createOpenAiFastFixture(t, { active: true });
      let state = await fixture.ready();
      assert.equal(state.extensionStatuses.at(-1).text, "effective");
      const calls = fixture.runtime.statusCalls;
      breakLookup(fixture.runtime.extensionRunner);
      await fixture.wrapper.send({ type: "reload" });
      state = await fixture.ready();
      assert.equal(state.extensionStatuses.at(-1).text, "unknown");
      assert.equal(fixture.runtime.statusCalls, calls);
    }
  });

  await t.test("reload replacement clears the badge and rejects stale old-runner completion", async (t) => {
    const fixture = createOpenAiFastFixture(t, {
      active: true,
      onReload(runtime) {
        runtime.extensionRunner = {
          getRegisteredCommands: () => [],
          getCommand: () => undefined,
          createCommandContext: () => ({ model: runtime.model, ui: { notify() {} } }),
          setUIContext() {},
        };
      },
    });
    let state = await fixture.ready();
    assert.equal(state.extensionStatuses.at(-1).text, "effective");
    const release = fixture.blockNextStatus();
    const calls = fixture.runtime.statusCalls;
    const oldRunnerRefresh = fixture.wrapper.send({ type: "set_model", provider: "openai", modelId: "gpt-5.4" });
    for (let attempt = 0; attempt < 20 && fixture.runtime.statusCalls === calls; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const reload = fixture.wrapper.send({ type: "reload" });
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await Promise.all([oldRunnerRefresh, reload]);
    state = await fixture.ready();
    assert.equal(state.extensionStatuses.some((status) => status.key === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY), false);
    await new Promise((resolve) => setImmediate(resolve));
    state = await fixture.ready();
    assert.equal(state.extensionStatuses.some((status) => status.key === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY), false,
      "completion from the replaced runner cannot restore host state");
  });
});

test("Fast state converges only at approved wrapper transitions without changing prompt persistence", async (t) => {
  const fixture = createOpenAiFastFixture(t, { duplicate: true });
  const sessionFile = fixture.manager.getSessionFile();
  const sessionBefore = existsSync(sessionFile) ? readFileSync(sessionFile, "utf8") : null;
  let state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "off");
  assert.equal(typeof state.projection.streamEpoch, "string");
  assert.ok(Number.isSafeInteger(state.projection.cursor));
  assert.equal(fixture.runtime.statusCalls, 1);

  await fixture.wrapper.send({ type: "prompt", message: "ordinary prompt" });
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.ready();
  await fixture.ready();
  assert.equal(fixture.runtime.statusCalls, 1, "ordinary prompts and unchanged get_state calls do not probe");

  await fixture.wrapper.send({ type: "prompt", message: `/${fixture.invocationName}` });
  state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "effective");
  assert.equal(fixture.runtime.statusCalls, 2);
  assert.equal(fixture.runtime.originalNotifications.length, 1, "only the user-entered toggle notification is delivered");

  state = await fixture.wrapper.send({ type: "set_model", provider: "other", modelId: "unsupported" });
  assert.equal(state.id, "unsupported");
  assert.equal(state.provider, "other");
  assert.equal(typeof state.projection.streamEpoch, "string");
  assert.ok(Number.isSafeInteger(state.projection.cursor));
  state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "unavailable");
  assert.equal(fixture.runtime.statusCalls, 3);

  await fixture.wrapper.send({ type: "reload" });
  state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "unavailable");
  assert.equal(fixture.runtime.statusCalls, 4);

  fixture.emitNative({ type: "agent_start" });
  fixture.runtime.model = undefined;
  fixture.emitNative({ type: "agent_end", willRetry: false });
  fixture.emitNative({ type: "agent_settled" });
  for (let attempt = 0; attempt < 20 && fixture.runtime.statusCalls < 5; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(fixture.runtime.statusCalls, 5, "native settlement itself schedules the model-drift probe");
  state = await fixture.ready();
  assert.equal(state.model, null);
  assert.equal(state.extensionStatuses.at(-1).text, "unavailable");

  await fixture.wrapper.send({ type: "prompt", message: `/${fixture.invocationName} off` });
  state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "off");
  assert.equal(fixture.runtime.statusCalls, 6);
  const sessionAfter = existsSync(sessionFile) ? readFileSync(sessionFile, "utf8") : null;
  assert.equal(sessionAfter, sessionBefore, "adapter probes never append session entries");
});

test("Fast refresh coalesces same-model triggers and discards superseded model completion", async (t) => {
  const fixture = createOpenAiFastFixture(t, { active: true });
  await fixture.ready();

  let release = fixture.blockNextStatus();
  const beforeCoalesced = fixture.runtime.statusCalls;
  const first = fixture.wrapper.send({ type: "set_model", provider: "openai", modelId: "gpt-5.4" });
  const second = fixture.wrapper.send({ type: "set_model", provider: "openai", modelId: "gpt-5.4" });
  for (let attempt = 0; attempt < 20 && fixture.runtime.statusCalls === beforeCoalesced; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  release();
  await Promise.all([first, second]);
  assert.equal(fixture.runtime.statusCalls, beforeCoalesced + 1, "same-generation same-model refreshes share one handler call");

  const statusTexts = [];
  fixture.wrapper.onEvent((event) => {
    if (event.type === "extension_ui_request" && event.statusKey === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY) {
      statusTexts.push(event.statusText);
    }
  });
  release = fixture.blockNextStatus();
  const beforeStale = fixture.runtime.statusCalls;
  const stale = fixture.wrapper.send({ type: "set_model", provider: "other", modelId: "unsupported" });
  for (let attempt = 0; attempt < 20 && fixture.runtime.statusCalls === beforeStale; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  fixture.runtime.model = { provider: "openai", id: "gpt-5.4" };
  release();
  await stale;
  const state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "effective");
  assert.equal(statusTexts.includes("unavailable"), false, "a stale unsupported-model result is never published");
});

test("different model mutations serialize so the latest accepted request remains authoritative", async (t) => {
  const fixture = createOpenAiFastFixture(t, { active: true });
  await fixture.ready();
  const modelCalls = [];
  const statusTexts = [];
  fixture.wrapper.onEvent((event) => {
    if (event.type === "extension_ui_request" && event.statusKey === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY) {
      statusTexts.push(event.statusText);
    }
  });
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  fixture.inner.setModel = async (model) => {
    modelCalls.push(`${model.provider}/${model.id}`);
    fixture.runtime.model = model;
    if (modelCalls.length === 1) await firstBlocked;
  };

  const older = fixture.wrapper.send({ type: "set_model", provider: "other", modelId: "unsupported" });
  for (let attempt = 0; attempt < 20 && modelCalls.length === 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(statusTexts.at(-1), "unknown",
    "server authority invalidates before an asynchronous model_select handler can expose the new model");
  const latest = fixture.wrapper.send({ type: "set_model", provider: "openai", modelId: "gpt-5.4" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(modelCalls, ["other/unsupported"], "the newer mutation waits for the active model transition");
  releaseFirst();
  await Promise.all([older, latest]);
  assert.deepEqual(modelCalls, ["other/unsupported", "openai/gpt-5.4"]);
  assert.deepEqual(fixture.runtime.model, { provider: "openai", id: "gpt-5.4" });
  const state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "effective");
});

test("a failed model mutation re-probes the actual model before rejecting", async (t) => {
  const fixture = createOpenAiFastFixture(t, { active: true });
  await fixture.ready();
  const calls = fixture.runtime.statusCalls;
  const statusTexts = [];
  fixture.wrapper.onEvent((event) => {
    if (event.type === "extension_ui_request" && event.statusKey === PI_WEB_OPENAI_FAST_MODE_STATUS_KEY) {
      statusTexts.push(event.statusText);
    }
  });
  fixture.inner.setModel = async () => { throw new Error("model_select failed"); };

  await assert.rejects(
    fixture.wrapper.send({ type: "set_model", provider: "other", modelId: "unsupported" }),
    /model_select failed/,
  );
  assert.deepEqual(statusTexts, ["unknown", "effective"]);
  assert.equal(fixture.runtime.statusCalls, calls + 1);
  const state = await fixture.ready();
  assert.equal(state.extensionStatuses.at(-1).text, "effective");
});

test("Fast probe failures and ambiguous output fail closed until another approved transition", async (t) => {
  for (const statusBehavior of ["missing", "multiple", "oversized", "mismatched", "wrong_type", "throw"]) {
    await t.test(statusBehavior, async (t) => {
      const fixture = createOpenAiFastFixture(t, { active: true, statusBehavior });
      let state = await fixture.ready();
      assert.equal(state.extensionStatuses.at(-1).text, "unknown");
      const calls = fixture.runtime.statusCalls;
      assert.deepEqual(fixture.runtime.originalNotifications, []);
      state = await fixture.ready();
      assert.equal(state.extensionStatuses.at(-1).text, "unknown");
      assert.equal(fixture.runtime.statusCalls, calls, "unchanged reconciliation does not retry a failed probe");
      await fixture.wrapper.send({ type: "reload" });
      assert.equal(fixture.runtime.statusCalls, calls + 1, "reload is an approved retry transition");
    });
  }

  await t.test("fresh context model mismatch is unknown without invoking the handler", async (t) => {
    const fixture = createOpenAiFastFixture(t, {
      active: true,
      contextModel: { provider: "openai", id: "different" },
    });
    const state = await fixture.ready();
    assert.equal(state.extensionStatuses.at(-1).text, "unknown");
    assert.equal(fixture.runtime.statusCalls, 0);
  });

  const source = await readFileAsync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pi-openai-fast\.json|before_provider_request|service_tier\s*=/,
    "Pi Web observes the command contract and does not read config or mutate provider payloads");
});

test("runtime cleanup is gateway-generation-owned and imports install no process handlers", async () => {
  const source = await readFileAsync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.(?:on|once)\s*\(/);
  assert.match(source, /registerRuntimeOwner\("rpc"/);
  const cleanup = source.slice(source.indexOf("function closeRpcRuntimeGeneration"), source.indexOf("export function activateRpcRuntimeOwner"));
  assert.ok(cleanup.indexOf("invalidateHostedImplementationCapability()") >= 0);
  assert.ok(cleanup.indexOf("session.shutdown()") > cleanup.indexOf("invalidateHostedImplementationCapability()"));
  assert.match(cleanup, /generation\.cleanupPromise/);
  assert.match(cleanup, /Promise\.allSettled\(shutdowns\)/);
});

test("published shutdown joins binding, closes admission, and strictly orders abort and disposal", async (t) => {
  const { manager } = createSource(t);
  const timeline = [];
  let resolveBinding;
  let resolveAbort;
  let resolveDispatch;
  const binding = new Promise((resolve) => { resolveBinding = resolve; });
  const abort = new Promise((resolve) => { resolveAbort = resolve; });
  const dispatch = new Promise((resolve) => { resolveDispatch = resolve; });
  let wrapper;
  let reentrantShutdown;
  const state = {
    extensionRunner: {
      emit(event) {
        timeline.push(`shutdown:${event.reason}`);
        reentrantShutdown = wrapper.shutdown();
        return dispatch;
      },
    },
    async bindExtensions() {
      timeline.push("binding:start");
      await binding;
      timeline.push("binding:end");
    },
    abortCompaction() { timeline.push("abort_compaction"); },
    abort() { timeline.push("abort"); return abort; },
    dispose() { timeline.push("dispose"); state.disposeCalls = (state.disposeCalls ?? 0) + 1; },
  };
  wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  wrapper.start();
  wrapper.beginExtensionBinding();
  assert.deepEqual(timeline, ["binding:start"]);

  const first = wrapper.shutdown();
  const second = wrapper.shutdown();
  assert.strictEqual(second, first, "concurrent callers receive the exact shared operation");
  assert.equal(wrapper.isAlive(), false, "shutdown closes admission synchronously");
  await assert.rejects(wrapper.send({ type: "get_state" }), /generation_closed/);
  assert.equal(wrapper.startHostedPrompt("late", noOpHostedLifecycle()), false);
  assert.deepEqual(timeline, ["binding:start"], "native work waits for started binding");

  resolveBinding();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timeline, ["binding:start", "binding:end", "abort_compaction", "abort"]);
  assert.equal(state.disposeCalls ?? 0, 0);

  resolveAbort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timeline, ["binding:start", "binding:end", "abort_compaction", "abort", "shutdown:quit"]);
  assert.strictEqual(reentrantShutdown, first, "reentrant release joins the same operation");
  assert.equal(state.disposeCalls ?? 0, 0, "strict shutdown dispatch remains pending");

  resolveDispatch();
  await first;
  await second;
  assert.deepEqual(timeline, ["binding:start", "binding:end", "abort_compaction", "abort", "shutdown:quit", "dispose"]);
  assert.equal(state.disposeCalls, 1);
});

test("binding failure is reported once and does not skip published shutdown", async (t) => {
  const { manager } = createSource(t);
  const state = {
    async bindExtensions() { throw new Error("private binding failure"); },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  const lines = [];
  const originalError = console.error;
  console.error = (line) => lines.push(String(line));
  t.after(() => { console.error = originalError; });

  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.shutdown();

  assert.deepEqual(lines, ["[pi-web] extension_binding stage=failed errorClass=Error"]);
  assert.equal(state.abortCompactionCalls, 1);
  assert.equal(state.abortCalls, 1);
  assert.deepEqual(state.shutdownEvents, [{ type: "session_shutdown", reason: "quit" }]);
  assert.equal(state.disposeCalls, 1);
});

test("the real extension runner isolates rejecting shutdown handlers and waits for later handlers", async (t) => {
  const { manager } = createSource(t);
  const timeline = [];
  let resolveHandler;
  const handler = new Promise((resolve) => { resolveHandler = resolve; });
  const extension = {
    path: "shutdown-fixture",
    resolvedPath: "shutdown-fixture",
    sourceInfo: {},
    handlers: new Map([["session_shutdown", [
      async () => { timeline.push("rejecting_handler"); throw new Error("private handler failure"); },
      async () => { timeline.push("deferred_handler"); await handler; timeline.push("handler_settled"); },
    ]]]),
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
  const runner = new ExtensionRunner(
    [extension],
    createExtensionRuntime(),
    manager.getCwd(),
    manager,
    {},
  );
  runner.onError((error) => timeline.push(`isolated:${error.event}`));
  const state = { extensionRunner: runner };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));

  const closing = wrapper.shutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timeline, ["rejecting_handler", "isolated:session_shutdown", "deferred_handler"]);
  assert.equal(state.disposeCalls ?? 0, 0);
  resolveHandler();
  await closing;
  assert.deepEqual(timeline, [
    "rejecting_handler", "isolated:session_shutdown", "deferred_handler", "handler_settled",
  ]);
  assert.equal(state.disposeCalls, 1);
});

test("dispatch-level shutdown rejection still disposes once and reports only a bounded class", async (t) => {
  const { manager } = createSource(t);
  const state = {
    emitShutdown: async () => {
      const error = new Error("private dispatch payload");
      error.name = "PrivateDispatchFailure";
      throw error;
    },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  const lines = [];
  const originalError = console.error;
  console.error = (line) => lines.push(String(line));
  t.after(() => { console.error = originalError; });

  const first = wrapper.shutdown();
  assert.strictEqual(wrapper.shutdown(), first);
  await assert.rejects(first, /private dispatch payload/);
  assert.equal(state.disposeCalls, 1);
  assert.deepEqual(lines, ["[pi-web] session_shutdown stage=failed errorClass=Error"]);
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

test("ensured transport identity is immutable, exact, and invalid after owner death or replacement", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-rpc-ensured-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(join(directory, "cwd"), directory);
  const wrapper = new AgentSessionWrapper(fakeInner(manager));
  const id = manager.getSessionId();
  globalThis.__piSessions ??= new Map();
  globalThis.__piSessions.set(id, wrapper);
  t.after(() => {
    if (wrapper.isAlive()) wrapper.destroy();
    globalThis.__piSessions?.delete(id);
  });

  assert.equal(wrapper.hasEnsuredSessionTransportTarget(), false);
  wrapper.enableEnsuredSessionTransport();
  const target = wrapper.getEnsuredSessionTransportTarget();
  assert.deepEqual(target, {
    sessionId: id,
    sessionFile: manager.getSessionFile(),
    cwd: manager.getCwd(),
  });
  assert.equal(Object.isFrozen(target), true);
  assert.equal(isCurrentRpcSession(id, wrapper), true);

  const replacement = new AgentSessionWrapper(fakeInner(manager));
  globalThis.__piSessions.set(id, replacement);
  assert.equal(isCurrentRpcSession(id, wrapper), false);
  replacement.destroy();
  wrapper.destroy();
  assert.equal(wrapper.getEnsuredSessionTransportTarget(), null);
});

test("ensured transport identity rejects wrapper/manager mismatches", (t) => {
  const { manager } = createSource(t);
  const wrongFileInner = fakeInner(manager);
  Object.defineProperty(wrongFileInner, "sessionFile", { value: `${manager.getSessionFile()}.wrong` });
  const wrongFile = new AgentSessionWrapper(wrongFileInner);
  t.after(() => wrongFile.destroy());
  assert.throws(() => wrongFile.enableEnsuredSessionTransport(), /identity_unavailable/);

  const wrongIdManager = Object.create(manager);
  wrongIdManager.getSessionId = () => "wrong";
  const wrongId = new AgentSessionWrapper({ ...fakeInner(manager), sessionManager: wrongIdManager });
  t.after(() => wrongId.destroy());
  assert.throws(() => wrongId.enableEnsuredSessionTransport(), /identity_unavailable/);
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

test("side snapshots an active source without changing or settling its wrapper", async (t) => {
  const { sessionDir, manager } = createSource(t);
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  const state = { prompt: () => prompt };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  t.after(() => wrapper.destroy());
  const sourceId = manager.getSessionId();
  const sourceFile = manager.getSessionFile();
  const sourceLeaf = manager.getLeafId();
  const sourceBytes = readFileSync(sourceFile);

  await wrapper.send({ type: "prompt", message: "long source turn" });
  assert.equal(wrapper.isRunning(), true);
  const result = await wrapper.send({ type: "side" });

  assert.equal(result.created, true);
  assert.equal(wrapper.isAlive(), true);
  assert.equal(wrapper.isRunning(), true);
  assert.equal(manager.getSessionId(), sourceId);
  assert.equal(manager.getLeafId(), sourceLeaf);
  assert.deepEqual(readFileSync(sourceFile), sourceBytes);
  assert.equal(state.abortCalls ?? 0, 0);
  assert.equal(state.disposeCalls ?? 0, 0);
  const sidePath = await resolveSessionPath(result.newSessionId);
  const side = SessionManager.open(sidePath, sessionDir);
  assert.equal(side.getHeader().parentSession, sourceFile);
  assert.match(side.getSessionName(), /^side-conversation-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  assert.equal(classifySideSession(side.getEntries(), result.newSessionId, side.getLeafId()).kind, "side");

  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrapper.isRunning(), false);
});

test("side uses the same safe snapshot while idle and permits repeated siblings", async (t) => {
  const { manager } = createSource(t);
  const wrapper = new AgentSessionWrapper(fakeInner(manager));
  t.after(() => wrapper.destroy());
  const first = await wrapper.send({ type: "side" });
  const second = await wrapper.send({ type: "side" });
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(first.newSessionId, second.newSessionId);
  assert.equal(wrapper.isAlive(), true);
});

test("side wrappers refuse derivation and pre-boundary navigation through direct and extension actions", async (t) => {
  const { sessionDir, manager } = createSource(t);
  const source = new AgentSessionWrapper(fakeInner(manager));
  const created = await source.send({ type: "side" });
  source.destroy();
  const sidePath = await resolveSessionPath(created.newSessionId);
  const sideManager = SessionManager.open(sidePath, sessionDir);
  const classification = classifySideSession(sideManager.getEntries(), created.newSessionId, sideManager.getLeafId());
  assert.equal(classification.kind, "side");
  const sideUser = sideManager.appendMessage(userMessage("side request"));
  const sideAnswer = sideManager.appendMessage(assistantMessage("side answer"));
  const state = {};
  const wrapper = new AgentSessionWrapper(fakeInner(sideManager, state), RPC_SESSION_IDLE_TIMEOUT_MS, {}, classification.metadata);
  t.after(() => wrapper.destroy());

  assert.deepEqual(await wrapper.send({ type: "side" }), { created: false, reason: "side_session" });
  assert.deepEqual(await wrapper.send({ type: "clone", activeLeafId: sideAnswer }), { created: false, reason: "side_session" });
  assert.deepEqual(await wrapper.send({ type: "fork", entryId: sideUser }), { cancelled: true, reason: "side_session" });
  assert.deepEqual(await wrapper.send({ type: "navigate_tree", targetId: manager.getLeafId() }), { cancelled: true, reason: "side_boundary" });
  assert.deepEqual(await wrapper.send({ type: "navigate_tree", targetId: sideUser }), { cancelled: false });

  const actions = wrapper.createExtensionCommandContextActions();
  assert.deepEqual(await actions.navigateTree(manager.getLeafId()), { cancelled: true });
  assert.deepEqual(await actions.navigateTree(sideAnswer), { cancelled: false });
  assert.deepEqual(state.navigateCalls, [sideUser, sideAnswer]);
  assert.equal(wrapper.isAlive(), true);
});

test("side wrapper tool and command surfaces defensively exclude launching capabilities", async (t) => {
  const { manager } = createSource(t);
  const side = { markerEntryId: "boundary", targetSessionId: manager.getSessionId() };
  const commands = [
    ...SIDE_SESSION_FORBIDDEN_EXTENSION_COMMANDS.map((name) => ({ invocationName: name, description: name, sourceInfo: {} })),
    { invocationName: "safe-command", description: "safe", sourceInfo: {} },
  ];
  const state = {
    allTools: [
      ...SIDE_SESSION_EXCLUDED_TOOL_NAMES.map((name) => ({ name, description: name })),
      { name: "bash", description: "shell" },
      { name: "safe-extension", description: "safe" },
    ],
    activeToolNames: [...SIDE_SESSION_EXCLUDED_TOOL_NAMES, "bash"],
    extensionRunner: { emit: async () => {}, getRegisteredCommands: () => commands },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state), RPC_SESSION_IDLE_TIMEOUT_MS, {}, side);
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });
  assert.deepEqual(tools.map((tool) => tool.name), ["bash", "safe-extension"]);
  const listed = await wrapper.send({ type: "get_commands" });
  assert.deepEqual(listed.commands.map((command) => command.name), ["safe-command"]);
  await wrapper.send({ type: "set_tools", toolNames: ["bash", "subagent"] });
  assert.equal(state.activeToolNames.includes("subagent"), false);
  assert.equal(state.activeToolNames.includes("bash"), true);
  assert.equal(state.activeToolNames.includes("safe-extension"), true);
  wrapper.setForceEmptySystemPrompt(true);
  assert.equal(wrapper.inner.agent.state.systemPrompt, SIDE_SESSION_SYSTEM_PROMPT);
});

test("real side startup filters whole launching extensions and preserves policy across reload and reopen", async (t) => {
  const { manager } = createSource(t);
  const cwd = manager.getCwd();
  const extensionDir = join(cwd, ".pi", "extensions");
  mkdirSync(extensionDir, { recursive: true });
  const toolSource = (name, command) => `export default function (pi) {
    pi.registerTool({
      name: ${JSON.stringify(name)}, label: ${JSON.stringify(name)}, description: ${JSON.stringify(name)},
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; }
    });
    pi.registerCommand(${JSON.stringify(command)}, { description: ${JSON.stringify(command)}, async handler() {} });
  }`;
  writeFileSync(join(extensionDir, "blocked-subagent.ts"), toolSource("subagent", "blocked-companion"));
  writeFileSync(join(extensionDir, "blocked-launcher.ts"), `export default function (pi) {
    pi.registerCommand("start-implementation", { description: "blocked", async handler() {} });
    pi.registerCommand("launcher-companion", { description: "blocked companion", async handler() {} });
  }`);
  writeFileSync(join(extensionDir, "safe.ts"), toolSource("safe-side-tool", "safe-side-command"));

  const source = new AgentSessionWrapper(fakeInner(manager));
  const created = await source.send({ type: "side" });
  source.destroy();
  assert.equal(created.created, true);
  const sidePath = await resolveSessionPath(created.newSessionId);
  let running = await startRpcSession(created.newSessionId, sidePath, cwd);
  t.after(async () => { await running.session.shutdown().catch(() => {}); });

  const assertFiltered = async (expectToolsOffPolicy = false) => {
    const tools = await running.session.send({ type: "get_tools" });
    const toolNames = tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("subagent"), false);
    assert.equal(
      toolNames.includes("safe-side-tool"),
      true,
      JSON.stringify(running.session.inner.resourceLoader.getExtensions().errors),
    );
    const commands = await running.session.send({ type: "get_commands" });
    const commandNames = commands.commands.map((command) => command.name);
    assert.equal(commandNames.includes("start-implementation"), false);
    assert.equal(commandNames.includes("blocked-companion"), false);
    assert.equal(commandNames.includes("launcher-companion"), false);
    assert.equal(commandNames.includes("safe-side-command"), true);
    const state = await running.session.send({ type: "get_state" });
    assert.equal(state.systemPrompt.includes(SIDE_SESSION_SYSTEM_PROMPT), true);
    assert.equal(state.systemPrompt.split(SIDE_SESSION_SYSTEM_PROMPT).length - 1, 1);
    if (expectToolsOffPolicy) assert.equal(state.systemPrompt, SIDE_SESSION_SYSTEM_PROMPT);
  };

  await assertFiltered();
  await running.session.send({ type: "set_tools", toolNames: ["bash", "subagent"] });
  await assertFiltered();
  await running.session.send({ type: "reload" });
  await assertFiltered();
  await running.session.send({ type: "set_tools", toolNames: [] });
  await assertFiltered(true);

  await running.session.shutdown();
  running = await startRpcSession(created.newSessionId, sidePath, cwd);
  await assertFiltered();
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

test("contextual Fork creates and caches its child before awaiting source shutdown", async (t) => {
  const { sessionDir, manager, leafId } = createSource(t);
  let resolveShutdown;
  const shutdownHandler = new Promise((resolve) => { resolveShutdown = resolve; });
  const shutdownEvents = [];
  const state = {
    emitShutdown: async (event) => { shutdownEvents.push(event); return shutdownHandler; },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  const sourceId = manager.getSessionId();
  let settled = false;

  const forking = wrapper.send({ type: "fork", entryId: leafId });
  void forking.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "Fork joins strict source shutdown before returning");
  assert.equal(wrapper.isAlive(), false);
  assert.equal(state.disposeCalls ?? 0, 0);
  assert.deepEqual(shutdownEvents, [{ type: "session_shutdown", reason: "quit" }]);
  const cachedChild = [...(globalThis.__piSessionPathCache?.entries() ?? [])].find(
    ([id, path]) => id !== sourceId && String(path).startsWith(`${sessionDir}/`),
  );
  assert.ok(cachedChild, "the native child identity is cached before source shutdown settles");

  resolveShutdown();
  const result = await forking;
  assert.equal(result.cancelled, false);
  assert.equal(result.newSessionId, cachedChild[0]);
  assert.notEqual(result.newSessionId, sourceId);
  assert.equal(await resolveSessionPath(result.newSessionId), cachedChild[1]);
  assert.equal(state.disposeCalls, 1);
});

test("failed extension binding rolls back the accepted prompt running claim", async (t) => {
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  rejectBinding(new Error("binding failed"));
  await assert.rejects(acceptedPrompt, /binding failed/);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
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
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.equal((await wrapper.send({ type: "get_state" })).isCompacting, true);
  assert.deepEqual(
    await wrapper.send({ type: "clone", activeLeafId: leafId }),
    { created: false, reason: "busy" },
  );

  resolveCompaction({ compacted: true });
  await activeCompaction;
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
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

test("gateway generations isolate shared starts and an old finalizer cannot delete a replacement lock", async (t) => {
  const { manager } = createSource(t);
  const sessionId = manager.getSessionId();
  const firstGateway = createPiWebTransportGateway();
  installPiWebTransportGateway(firstGateway);
  activateRpcRuntimeOwner();
  let resolveOld;
  const oldPreparation = new Promise((resolve) => { resolveOld = resolve; });
  const oldWrapper = new AgentSessionWrapper(fakeInner(manager));
  const oldStart = getOrCreateRpcSession(sessionId, async () => {
    await oldPreparation;
    return { session: oldWrapper, realSessionId: sessionId };
  });
  assert.equal(globalThis.__piStartLocks.has(sessionId), true);
  firstGateway.beginShutdown();
  firstGateway.close();

  const secondGateway = createPiWebTransportGateway();
  installPiWebTransportGateway(secondGateway);
  activateRpcRuntimeOwner();
  const newWrapper = new AgentSessionWrapper(fakeInner(manager));
  let resolveNew;
  const newPreparation = new Promise((resolve) => { resolveNew = resolve; });
  const newStart = getOrCreateRpcSession(sessionId, async () => {
    await newPreparation;
    return { session: newWrapper, realSessionId: sessionId };
  });
  assert.equal(globalThis.__piStartLocks.has(sessionId), true);
  resolveOld();
  await assert.rejects(oldStart, /generation_closed/);
  assert.equal(globalThis.__piStartLocks.has(sessionId), true, "old finalizer cannot delete the new generation lock");
  resolveNew();
  const published = await newStart;
  assert.equal(published.session, newWrapper);
  assert.equal(getRpcSession(sessionId), newWrapper);
  assert.equal(oldWrapper.isAlive(), false);
  secondGateway.beginShutdown();
  secondGateway.close();
  activateRpcRuntimeOwner();
});

test("late unpublished generation cannot revoke a same-ID running wrapper from the current generation", async (t) => {
  const { manager } = createSource(t);
  const sessionId = manager.getSessionId();
  resetRunningProjectionState();

  const firstGateway = createPiWebTransportGateway();
  installPiWebTransportGateway(firstGateway);
  activateRpcRuntimeOwner();
  let resolveOldPreparation;
  const oldPreparation = new Promise((resolve) => { resolveOldPreparation = resolve; });
  const oldState = {};
  const oldWrapper = new AgentSessionWrapper(fakeInner(manager, oldState));
  const oldStart = getOrCreateRpcSession(sessionId, async () => {
    await oldPreparation;
    return { session: oldWrapper, realSessionId: sessionId };
  });
  assert.equal(globalThis.__piStartLocks.has(sessionId), true);
  firstGateway.beginShutdown();
  firstGateway.close();

  const secondGateway = createPiWebTransportGateway();
  installPiWebTransportGateway(secondGateway);
  activateRpcRuntimeOwner();
  let resolveCurrentPrompt;
  const currentPrompt = new Promise((resolve) => { resolveCurrentPrompt = resolve; });
  const currentState = { prompt: async () => currentPrompt };
  const currentWrapper = new AgentSessionWrapper(fakeInner(manager, currentState));
  const published = await getOrCreateRpcSession(sessionId, async () => ({
    session: currentWrapper,
    realSessionId: sessionId,
  }));
  assert.strictEqual(published.session, currentWrapper);

  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids].sort()));
  await currentWrapper.send({ type: "prompt", message: "held current-generation run" });
  assert.strictEqual(getRpcSession(sessionId), currentWrapper);
  assert.equal(currentWrapper.isAlive(), true);
  assert.equal(currentWrapper.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [sessionId]);
  assert.deepEqual(transitions, [[sessionId]]);
  assert.equal(globalThis.__piRunningSessionPublishers.size, 1);
  const currentPublisher = globalThis.__piRunningSessionPublishers.get(sessionId);
  assert.ok(currentPublisher);

  resolveOldPreparation();
  await assert.rejects(oldStart, /generation_closed/);
  assert.equal(oldState.disposeCalls, 1, "the unpublished old-generation native owner disposes exactly once");
  assert.equal(oldWrapper.isAlive(), false);
  assert.strictEqual(getRpcSession(sessionId), currentWrapper);
  assert.equal(currentWrapper.isAlive(), true);
  assert.equal(currentWrapper.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [sessionId]);
  assert.deepEqual(transitions, [[sessionId]], "late old-generation destroy emits no false empty transition");
  assert.equal(globalThis.__piRunningSessionPublishers.size, 1);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(sessionId), currentPublisher,
    "late generation A cleanup preserves generation B's exact active publisher identity");
  assert.equal(globalThis.__piStartLocks.has(sessionId), false, "old lock finalization cannot retain or alter current ownership");

  resolveCurrentPrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(currentWrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[sessionId], []]);
  assert.equal(globalThis.__piRunningSessionPublishers.size, 0, "settlement releases the opaque publisher reference");
  currentWrapper.destroy();
  oldWrapper.destroy();
  assert.equal(currentState.disposeCalls, 1);
  assert.equal(oldState.disposeCalls, 1);
  assert.deepEqual(transitions, [[sessionId], []], "settlement plus destruction removes exactly once");
  assert.equal(globalThis.__piRunningSessionPublishers.size, 0);

  unsubscribe();
  secondGateway.beginShutdown();
  secondGateway.close();
  activateRpcRuntimeOwner();
});

test("synchronous native subscribe shutdown cannot publish a stale wrapper", async (t) => {
  const { manager } = createSource(t);
  const sessionId = manager.getSessionId();
  const gateway = createPiWebTransportGateway();
  installPiWebTransportGateway(gateway);
  activateRpcRuntimeOwner();
  const state = {
    subscribe() {
      gateway.beginShutdown();
      return () => {};
    },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  await assert.rejects(
    getOrCreateRpcSession(sessionId, async () => ({ session: wrapper, realSessionId: sessionId })),
    /generation_closed/,
  );
  assert.equal(globalThis.__piSessions.has(sessionId), false);
  assert.equal(globalThis.__piStartLocks.has(sessionId), false);
  assert.equal(state.disposeCalls, 1);
  assert.equal(state.abortCalls ?? 0, 0);
  assert.equal(state.abortCompactionCalls ?? 0, 0);
  assert.deepEqual(state.shutdownEvents ?? [], [], "unpublished cleanup invents no lifecycle");
  wrapper.destroy();
  assert.equal(state.disposeCalls, 1, "unpublished native owner is disposed exactly once");
  gateway.close();
  activateRpcRuntimeOwner();
});

test("synchronous extension-binding shutdown rejects a published start without a registry ghost", async (t) => {
  const { manager } = createSource(t);
  const sessionId = manager.getSessionId();
  const gateway = createPiWebTransportGateway();
  installPiWebTransportGateway(gateway);
  activateRpcRuntimeOwner();
  const state = {
    bindExtensions() {
      gateway.beginShutdown();
      return Promise.resolve();
    },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  await assert.rejects(
    getOrCreateRpcSession(sessionId, async () => ({ session: wrapper, realSessionId: sessionId })),
    /generation_closed/,
  );
  await gateway.waitForRuntimeOwnerCleanup();
  assert.equal(globalThis.__piSessions.has(sessionId), false);
  assert.equal(globalThis.__piStartLocks.has(sessionId), false);
  assert.equal(state.abortCompactionCalls, 1);
  assert.equal(state.abortCalls, 1);
  assert.deepEqual(state.shutdownEvents, [{ type: "session_shutdown", reason: "quit" }]);
  assert.equal(state.disposeCalls, 1);
  gateway.close();
  activateRpcRuntimeOwner();
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
  assert.equal(state.abortCalls ?? 0, 0);
  assert.equal(state.abortCompactionCalls ?? 0, 0);
  assert.deepEqual(state.shutdownEvents ?? [], []);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(getRpcSession(sessionId), undefined);
  t.after(() => globalThis.__piSessions?.delete(sessionId));
});

test("host capability acknowledges publication and kickoff scheduling before binding or target settlement", async (t) => {
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), [targetId]);

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
  assert.deepEqual(getRunningRpcSessionIds(), [targetId]);

  resolveBinding();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(targetPromptCalls, 1);
  assert.equal(target.isRunning(), true);
  resolveTarget();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(target.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), [], "hosted success settles without Stop, timeout, or follow-up publication");

  t.after(() => {
    unsubscribeRefresh();
    source.destroy();
    target.destroy();
    globalThis.__piSessions?.delete(targetId);
  });
});

test("target Stop cancels a hosted kickoff that is still waiting for extension binding", async (t) => {
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  const projectedCursor = wrapper.getProjectedEventHub().cursor;

  await wrapper.send({ type: "abort" });
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
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
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  const projectedHub = wrapper.getProjectedEventHub();
  const projectedUnits = [];
  projectedHub.attach(projectedHub.streamEpoch, projectedHub.cursor, (unit) => projectedUnits.push(unit));

  wrapper.destroy();
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
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
  resetRunningProjectionState();
  const { manager } = createSource(t);
  const lifecycleFailures = [];
  const events = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    prompt: async () => { throw new Error("private provider and tool payload"); },
  }));
  wrapper.onEvent((event) => events.push(event));
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  const projectedCursor = wrapper.getProjectedEventHub().cursor;
  wrapper.startHostedPrompt("private kickoff", {
    ...noOpHostedLifecycle(),
    targetFailed(error) { lifecycleFailures.push(error); },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[wrapper.sessionId], []]);
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

test("semantic idle uses the exact 30-minute default and an injected touch boundary", async (t) => {
  assert.equal(RPC_SESSION_IDLE_TIMEOUT_MS, 30 * 60 * 1000);
  const { manager } = createSource(t);
  const state = {};
  const clock = createIdleClock();
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 30, clock);
  wrapper.start();
  assert.deepEqual(clock.diagnostics, ["startup"]);
  clock.advance(29);
  assert.equal(wrapper.isAlive(), true);
  await wrapper.send({ type: "get_state" });
  assert.equal(clock.diagnostics.at(-1), "command");
  clock.advance(29);
  assert.equal(wrapper.isAlive(), true);
  clock.advance(1);
  assert.equal(wrapper.isAlive(), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.abortCompactionCalls, 1);
  assert.equal(state.abortCalls, 1);
  assert.deepEqual(state.shutdownEvents, [{ type: "session_shutdown", reason: "quit" }]);
  assert.equal(state.disposeCalls, 1);

  const unsupportedClock = createIdleClock();
  const unsupported = new AgentSessionWrapper(fakeInner(manager), 30, unsupportedClock);
  unsupported.start();
  unsupportedClock.advance(10);
  await assert.rejects(unsupported.send({ type: "not_supported" }), /Unsupported command/);
  assert.equal(unsupportedClock.diagnostics.includes("command"), false);
  unsupportedClock.advance(20);
  assert.equal(unsupported.isAlive(), false, "unsupported traffic cannot retain a wrapper");
});

test("every recognized command dispatch touches once while unsupported dispatch never touches", async (t) => {
  assert.deepEqual([...RPC_RECOGNIZED_COMMAND_TYPES], [
    "prompt", "abort", "get_state", "set_model", "side", "clone", "fork", "navigate_tree",
    "set_thinking_level", "compact", "set_session_name", "get_session_stats",
    "get_last_assistant_text", "set_auto_compaction", "clear_queue", "steer", "follow_up",
    "get_tools", "get_commands", "set_tools", "reload", "abort_compaction",
    "extension_ui_response", "extension_ui_input", "set_auto_retry",
  ]);
  for (const type of RPC_RECOGNIZED_COMMAND_TYPES) {
    const { manager } = createSource(t);
    const clock = createIdleClock();
    const wrapper = new AgentSessionWrapper(fakeInner(manager), 1_000, clock);
    wrapper.start();
    clock.diagnostics.length = 0;
    try { await wrapper.send({ type }); } catch { /* malformed recognized commands still touch */ }
    assert.equal(clock.diagnostics.filter((category) => category === "command").length, 1, type);
    wrapper.destroy();
  }
});

test("native, legacy, direct projected, and final settlement causes use bounded semantic categories", async (t) => {
  const { manager } = createSource(t);
  let nativeListener;
  const clock = createIdleClock();
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }), 100, clock);
  wrapper.start();
  clock.diagnostics.length = 0;
  nativeListener({ type: "agent_start" });
  assert.equal(clock.diagnostics[0], "native_event");
  await wrapper.send({ type: "prompt" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(clock.diagnostics.includes("wrapper_event"), "wrapper activity and legacy events touch");
  assert.ok(clock.diagnostics.includes("settlement"), "direct projected settlement touches");
  assert.ok(clock.diagnostics.every((value) => ["command", "native_event", "wrapper_event", "settlement"].includes(value)));
  wrapper.destroy();
});

test("every direct projected wrapper input uses the bounded semantic touch seam", (t) => {
  const events = [
    [{ type: "wrapper_activity_started", activity: "prompt" }, "wrapper_event"],
    [{ type: "wrapper_settled" }, "settlement"],
    [{ type: "extension_dialog_closed", id: "dialog" }, "wrapper_event"],
    [{ type: "extension_status_cleared", key: "status" }, "wrapper_event"],
    [{ type: "extension_widget_cleared", key: "widget" }, "wrapper_event"],
  ];
  for (const [event, category] of events) {
    const { manager } = createSource(t);
    const clock = createIdleClock();
    const wrapper = new AgentSessionWrapper(fakeInner(manager), 100, clock);
    wrapper.start();
    clock.diagnostics.length = 0;
    wrapper.acceptProjectedWrapperInput(event, category);
    assert.equal(clock.diagnostics[0], category, event.type);
    wrapper.destroy();
  }
});

test("binding-dependent continuations cannot dispatch or mutate after destruction", async (t) => {
  const { manager } = createSource(t);
  let resolveBinding;
  let bindings;
  const binding = new Promise((resolve) => { resolveBinding = resolve; });
  const state = {
    bindExtensions: async (value) => { bindings = value; await binding; },
    prompt: async () => { state.promptCalls = (state.promptCalls ?? 0) + 1; },
    steer: async () => { state.steerCalls = (state.steerCalls ?? 0) + 1; },
    followUp: async () => { state.followCalls = (state.followCalls ?? 0) + 1; },
    reload: async () => { state.reloadCalls = (state.reloadCalls ?? 0) + 1; },
  };
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state));
  wrapper.start();
  wrapper.beginExtensionBinding();
  await new Promise((resolve) => setImmediate(resolve));
  const pending = [
    wrapper.send({ type: "prompt", message: "synthetic" }),
    wrapper.send({ type: "steer", message: "synthetic" }),
    wrapper.send({ type: "follow_up", message: "synthetic" }),
    wrapper.send({ type: "get_commands" }),
    wrapper.send({ type: "reload" }),
  ];
  wrapper.destroy();
  assert.doesNotThrow(() => bindings.uiContext.setStatus("key", "private"));
  resolveBinding();
  const results = await Promise.allSettled(pending);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(state.promptCalls ?? 0, 0);
  assert.equal(state.steerCalls ?? 0, 0);
  assert.equal(state.followCalls ?? 0, 0);
  assert.equal(state.reloadCalls ?? 0, 0);
  assert.equal(state.disposeCalls, 1);
});

test("active wrappers survive injected deadlines and receive a full window after settlement", async (t) => {
  const { manager } = createSource(t);
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  const state = { prompt: async () => prompt };
  const clock = createIdleClock();
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 30, clock);
  wrapper.start();
  await wrapper.send({ type: "prompt" });
  clock.advance(30);
  assert.equal(wrapper.isAlive(), true);
  assert.equal(clock.diagnostics.at(-1), "deferred_active");
  clock.advance(30);
  assert.equal(wrapper.isAlive(), true);
  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(29);
  assert.equal(wrapper.isAlive(), true);
  clock.advance(1);
  assert.equal(wrapper.isAlive(), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.disposeCalls, 1);
});

test("actual hosted kickoff claim survives deadlines and receives a full post-target window", async (t) => {
  const { manager } = createSource(t);
  let resolvePrompt;
  const prompt = new Promise((resolve) => { resolvePrompt = resolve; });
  const state = { prompt: async () => prompt, bindExtensions: async () => {} };
  const clock = createIdleClock();
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 30, clock);
  wrapper.start();
  assert.equal(wrapper.startHostedPrompt("synthetic", noOpHostedLifecycle()), true);
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(60);
  assert.equal(wrapper.isAlive(), true);
  assert.equal(wrapper.isRunning(), true);
  resolvePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  clock.advance(29);
  assert.equal(wrapper.isAlive(), true);
  clock.advance(1);
  assert.equal(wrapper.isAlive(), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.disposeCalls, 1);
});

test("actual compaction and reentrant native fanout survive deadlines and receive full settlement windows", async (t) => {
  const { manager } = createSource(t);
  let resolveCompaction;
  const compaction = new Promise((resolve) => { resolveCompaction = resolve; });
  const state = { compact: async () => compaction };
  const clock = createIdleClock();
  const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 30, clock);
  wrapper.start();

  const compacting = wrapper.send({ type: "compact" });
  clock.advance(30);
  assert.equal(wrapper.isAlive(), true, "actual wrapper compaction claim survives");
  resolveCompaction({});
  await compacting;
  clock.advance(29);
  assert.equal(wrapper.isAlive(), true);
  clock.advance(1);
  assert.equal(wrapper.isAlive(), false, "actual compaction settlement receives one complete window");

  const reentrantClock = createIdleClock();
  let reentrantNativeListener;
  const reentrant = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { reentrantNativeListener = listener; return () => {}; },
  }), 30, reentrantClock);
  reentrant.start();
  let checkedInsideFanout = false;
  reentrant.onEvent((event) => {
    if (event.type !== "agent_start" || checkedInsideFanout) return;
    reentrantNativeListener({ type: "agent_settled" });
    reentrantClock.advance(30);
    checkedInsideFanout = true;
    assert.equal(reentrant.isAlive(), true, "reserved terminal/deferred fanout survives its deadline");
  });
  reentrantNativeListener({ type: "agent_start" });
  assert.equal(checkedInsideFanout, true);
  assert.equal(reentrant.getProjectedEventHub().getState().active, false, "actual projected state settles after outer fanout");
  reentrantClock.advance(29);
  assert.equal(reentrant.isAlive(), true);
  reentrantClock.advance(1);
  assert.equal(reentrant.isAlive(), false, "actual final fanout settlement receives one complete window");
});

test("every modeled active predicate survives a deadline and final settlement receives a full window", async (t) => {
  const cases = [
    ["prompt claim", (wrapper) => { wrapper.promptRunningCount = 1; }, (wrapper) => { wrapper.promptRunningCount = 0; }],
    ["hosted kickoff prompt claim", (wrapper) => { wrapper.promptRunningCount = 1; wrapper.hostedKickoffState = "dispatched"; }, (wrapper) => { wrapper.promptRunningCount = 0; }],
    ["compaction claim", (wrapper) => { wrapper.compactionRunningCount = 1; }, (wrapper) => { wrapper.compactionRunningCount = 0; }],
    ["native agent causal", (wrapper) => { wrapper.nativeAgentTurnCount = 1; }, (wrapper) => { wrapper.nativeAgentTurnCount = 0; }],
    ["reserved native terminal", (wrapper) => { wrapper.reservedNativeTerminalCount = 1; }, (wrapper) => { wrapper.reservedNativeTerminalCount = 0; }],
    ["standalone compaction causal", (wrapper) => { wrapper.standaloneNativeCompactionCount = 1; }, (wrapper) => { wrapper.standaloneNativeCompactionCount = 0; }],
    ["reserved compaction terminal", (wrapper) => { wrapper.reservedStandaloneCompactionTerminalCount = 1; }, (wrapper) => { wrapper.reservedStandaloneCompactionTerminalCount = 0; }],
    ["native causal claim array", (wrapper) => { wrapper.nativeCausalClaims = [{}]; }, (wrapper) => { wrapper.nativeCausalClaims = []; }],
    ["compaction causal claim array", (wrapper) => { wrapper.standaloneCompactionCausalClaims = [{}]; }, (wrapper) => { wrapper.standaloneCompactionCausalClaims = []; }],
    ["event fanout and deferred settlement", (wrapper) => { wrapper.eventFanoutDepth = 1; wrapper.deferredSettlementRequested = true; }, (wrapper) => { wrapper.eventFanoutDepth = 0; wrapper.deferredSettlementRequested = false; }],
    ["projected active", (wrapper) => { wrapper.projectedHub.accept({ type: "wrapper_activity_started", activity: "prompt" }); }, (wrapper) => { wrapper.projectedHub.accept({ type: "wrapper_settled" }); }],
    ["native streaming", (_wrapper, state) => { state.isStreaming = true; }, (_wrapper, state) => { state.isStreaming = false; }],
    ["native compacting", (_wrapper, state) => { state.isCompacting = true; }, (_wrapper, state) => { state.isCompacting = false; }],
  ];
  for (const [name, activate, settle] of cases) {
    const { manager } = createSource(t);
    const state = {};
    const clock = createIdleClock();
    const wrapper = new AgentSessionWrapper(fakeInner(manager, state), 30, clock);
    wrapper.start();
    activate(wrapper, state);
    clock.advance(30);
    assert.equal(wrapper.isAlive(), true, name);
    assert.equal(clock.diagnostics.at(-1), "deferred_active", name);
    settle(wrapper, state);
    wrapper.touchSemanticIdle("settlement");
    clock.advance(29);
    assert.equal(wrapper.isAlive(), true, `${name} full settlement window`);
    clock.advance(1);
    assert.equal(wrapper.isAlive(), false, `${name} expiry`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.disposeCalls, 1, `${name} exact disposal`);
  }
});

test("actual passive gateway, hub, global, file-watch, heartbeat, and shutdown operations never touch wrapper idle", async (t) => {
  const { manager } = createSource(t);
  const clock = createIdleClock();
  const wrapper = new AgentSessionWrapper(fakeInner(manager), 30, clock);
  wrapper.start();
  clock.diagnostics.length = 0;
  const gateway = createPiWebTransportGateway();
  gateway.registerChannel("running", () => {}, () => {});
  const passiveOperations = [
    ["registry lookup", () => getRpcSession(wrapper.sessionId)],
    ["subscriber attach/detach", () => { const off = wrapper.onEvent(() => {}); off(); }],
    ["resume/replay snapshot", () => { const attached = wrapper.getProjectedEventHub().attach(null, null, () => {}); attached.unsubscribe(); }],
    ["projected state read", () => wrapper.getProjectedEventHub().getState()],
    ["ticket issue/consume", () => { const ticket = gateway.issueTicket("running"); gateway.consumeTicket(ticket.ticket); }],
    ["socket admission/release", () => { const release = gateway.reserveConnection("127.0.0.1"); release(); }],
    ["global publication", () => {
      const unsubscribe = subscribeRunningSessions(() => {});
      publishRunningSessionState("passive-global", true);
      publishRunningSessionState("passive-global", false);
      unsubscribe();
    }],
    ["socket liveness read", () => { wrapper.isAlive(); wrapper.isRunning(); }],
  ];
  for (const [name, operation] of passiveOperations) {
    operation();
    assert.deepEqual(clock.diagnostics, [], name);
  }

  class PassiveSocket extends EventEmitter {
    constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.pings = 0; this.frames = []; }
    send(value, callback) { this.frames.push(value); callback?.(); }
    close() { this.readyState = 3; this.emit("close"); }
    terminate() { this.close(); }
    ping() { this.pings += 1; }
  }
  const globalSocket = new PassiveSocket();
  createGlobalStatusChannelHandler()(globalSocket, { channel: "running", serverInstanceId: "passive" });
  publishRunningSessionState("passive-global", true);
  publishRunningSessionState("passive-global", false);
  globalSocket.close();
  assert.deepEqual(clock.diagnostics, [], "actual global subscriber publication");

  let watchListener;
  let changeTimer;
  const fileSocket = new PassiveSocket();
  await createFileWatchChannelHandler({
    watch(_target, listener) { watchListener = listener; return { on() {}, close() {} }; },
    stat() { return { isFile: () => true, size: 1 }; },
    setTimeout(callback) { changeTimer = callback; return { unref() {} }; },
    clearTimeout() { changeTimer = undefined; },
  })(fileSocket, {
    channel: "file-watch", serverInstanceId: "passive",
    ticketContext: createFileWatchTicketContext("/tmp/passive.txt", "ordinary"),
  });
  watchListener("change", "passive.txt");
  changeTimer();
  fileSocket.close();
  assert.deepEqual(clock.diagnostics, [], "actual file observation and change");

  let heartbeatSweep;
  const heartbeatSocket = new PassiveSocket();
  const heartbeat = createWebSocketHeartbeat({
    webSocketServer: { clients: new Set([heartbeatSocket]) },
    gateway: { getSocketChannelClass: () => "running" },
    setInterval(callback) { heartbeatSweep = callback; return { unref() {} }; },
    clearInterval() {},
  });
  heartbeat.track(heartbeatSocket);
  heartbeatSweep();
  heartbeatSocket.emit("pong");
  heartbeat.close();
  assert.equal(heartbeatSocket.pings, 1);
  assert.deepEqual(clock.diagnostics, [], "actual heartbeat ping and pong");

  gateway.beginShutdown();
  assert.deepEqual(clock.diagnostics, [], "transport shutdown cleanup");
  gateway.close();
  clock.advance(30);
  assert.equal(wrapper.isAlive(), false, "passive work cannot retain the wrapper");
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
  resetRunningProjectionState();
  const authoritativeProjection = globalThis.__piRunningSessionIds;
  const received = [];
  const hostileAttempts = [];
  const hostileUnsubscribe = subscribeRunningSessions((ids) => {
    hostileAttempts.push({
      frozen: Object.isFrozen(ids),
      add: typeof ids.add,
      delete: typeof ids.delete,
      clear: typeof ids.clear,
      order: [...ids],
    });
    assert.throws(() => { ids.add = () => {}; }, TypeError);
  });
  const unsubscribe = subscribeRunningSessions((ids) => received.push([...ids].sort()));

  publishRunningSessionState("session-b", true);
  publishRunningSessionState("session-a", true);
  publishRunningSessionState("session-a", true);
  assert.deepEqual(getRunningRpcSessionIds(), ["session-a", "session-b"]);
  assert.strictEqual(globalThis.__piRunningSessionIds, authoritativeProjection);
  const view = getRunningRpcSessionProjection();
  assert.equal(Object.isFrozen(view), true);
  assert.deepEqual([view.add, view.delete, view.clear], [undefined, undefined, undefined]);
  assert.deepEqual(received, [
    ["session-b"],
    ["session-a", "session-b"],
  ]);

  const firstPublisher = {};
  const replacementPublisher = {};
  const beforeOwnedReplacement = received.length;
  publishRunningSessionState("session-a", true, firstPublisher);
  publishRunningSessionState("session-a", true, replacementPublisher);
  publishRunningSessionState("session-a", true, replacementPublisher);
  publishRunningSessionState("session-a", false, firstPublisher);
  publishRunningSessionState("session-a", false);
  assert.equal(received.length, beforeOwnedReplacement, "authority replacement and stale/ownerless updates preserve structural no-op suppression");

  publishRunningSessionState("session-b", false);
  publishRunningSessionState("session-b", false);
  assert.deepEqual(getRunningRpcSessionIds(), ["session-a"]);
  assert.deepEqual(received.at(-1), ["session-a"]);
  assert.ok(hostileAttempts.every((attempt) => attempt.frozen
    && attempt.add === "undefined" && attempt.delete === "undefined" && attempt.clear === "undefined"));
  assert.deepEqual(hostileAttempts[1].order, ["session-b", "session-a"], "hostile listener cannot corrupt authoritative order");
  assert.deepEqual(hostileAttempts.at(-1).order, ["session-a"], "later frames remain authoritative");
  unsubscribe();
  hostileUnsubscribe();
  publishRunningSessionState("session-a", false, replacementPublisher);
  assert.equal(globalThis.__piRunningSessionPublishers.size, 0);
});

test("inherited ownerless membership remains compatible without overriding active ownership", () => {
  const inherited = new Set(["inherited"]);
  resetRunningProjectionState(inherited);
  const frames = [];
  const unsubscribe = subscribeRunningSessions((ids) => frames.push([...ids]));
  const publisher = {};

  publishRunningSessionState("inherited", false, publisher);
  assert.deepEqual(getRunningRpcSessionIds(), ["inherited"], "an identity without ownership cannot remove inherited membership");
  publishRunningSessionState("inherited", false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(frames, [[]]);

  publishRunningSessionState("inherited", true);
  publishRunningSessionState("inherited", true, publisher);
  publishRunningSessionState("inherited", false);
  assert.deepEqual(getRunningRpcSessionIds(), ["inherited"], "ownerless false cannot remove active owned membership");
  publishRunningSessionState("inherited", false, publisher);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(frames, [[], ["inherited"], []]);
  assert.strictEqual(globalThis.__piRunningSessionIds, inherited);
  unsubscribe();
});

test("idle native metadata delivery never publishes a running membership", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => wrapper.destroy());
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();
  const projectedCursor = wrapper.getProjectedEventHub().cursor;

  nativeListener({ type: "session_info_changed", name: "renamed" });

  assert.equal(wrapper.getProjectedEventHub().cursor, projectedCursor + 1, "the idle metadata event commits its runtime-refresh projection");
  assert.equal(wrapper.getProjectedEventHub().getState().runtimeRefreshRequired, true);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [], "temporary event fanout is not browser-visible running activity");

  class CapturingSocket extends EventEmitter {
    constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.frames = []; }
    send(value, callback) { this.frames.push(JSON.parse(value)); callback?.(); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close"); }
    terminate() { this.close(); }
  }
  const handler = createGlobalStatusChannelHandler();
  const initial = new CapturingSocket();
  const reconnected = new CapturingSocket();
  handler(initial, { channel: "running", serverInstanceId: "initial" });
  handler(reconnected, { channel: "running", serverInstanceId: "reconnected" });
  t.after(() => { initial.close(); reconnected.close(); });
  assert.deepEqual(
    [initial, reconnected].map((socket) => socket.frames.find((frame) => frame.type === "running")?.runningSessionIds),
    [[], []],
    "initial and reconnected global-status views replay the corrected authoritative set",
  );
});

test("nested idle native delivery remains absent from the running projection", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => wrapper.destroy());
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();
  let nested = false;
  wrapper.onEvent((event) => {
    if (event.type === "session_info_changed" && !nested) {
      nested = true;
      nativeListener({ type: "thinking_level_changed" });
    }
  });

  nativeListener({ type: "session_info_changed", name: "outer" });

  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, []);
});

test("a delayed rejected native receipt publishes release of its final temporary claim", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => {
    wrapper.projectedHub.processing = false;
    wrapper.destroy();
  });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();

  wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;
  wrapper.projectedHub.processing = true;
  nativeListener({ type: "agent_start" });
  assert.equal(wrapper.isRunning(), true, "the pending causal start claim remains active until its receipt resolves");
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.deepEqual(transitions, [[wrapper.sessionId]]);

  wrapper.projectedHub.processing = false;
  wrapper.projectedHub.drainAcceptedInputs();

  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[wrapper.sessionId], []]);
});

test("a pending obsolete start cannot displace an existing replacement before commit", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let obsoleteNativeListener;
  let replacementNativeListener;
  const obsolete = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { obsoleteNativeListener = listener; return () => {}; },
  }));
  const replacement = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { replacementNativeListener = listener; return () => {}; },
  }));
  t.after(() => {
    obsolete.projectedHub.processing = false;
    obsolete.destroy();
    replacement.destroy();
  });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  obsolete.start();
  replacement.start();
  replacementNativeListener({ type: "agent_start" });
  const replacementPublisher = globalThis.__piRunningSessionPublishers.get(replacement.sessionId);
  assert.ok(replacementPublisher);

  obsolete.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;
  obsolete.projectedHub.processing = true;
  obsoleteNativeListener({ type: "agent_start" });
  assert.equal(obsolete.isRunning(), true);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);

  obsolete.projectedHub.processing = false;
  obsolete.projectedHub.drainAcceptedInputs();
  assert.equal(obsolete.isRunning(), false);
  assert.equal(replacement.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  assert.deepEqual(transitions, [[replacement.sessionId]]);
});

test("a delayed committed terminal batch publishes idle only after projected finality", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => {
    wrapper.projectedHub.processing = false;
    wrapper.destroy();
  });
  const timeline = [];
  const unsubscribe = subscribeRunningSessions((ids) => timeline.push(ids.size === 0 ? "idle" : "running"));
  t.after(unsubscribe);
  wrapper.start();
  nativeListener({ type: "agent_start" });
  nativeListener({ type: "agent_start" });
  const hub = wrapper.getProjectedEventHub();
  const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected-final");
  });
  t.after(attached.unsubscribe);

  wrapper.projectedHub.processing = true;
  nativeListener({ type: "agent_settled" });
  assert.equal(wrapper.nativeAgentTurnCount, 0);
  assert.equal(wrapper.reservedNativeTerminalCount, 2);
  assert.equal(wrapper.nativeCausalClaims.length, 2);
  assert.equal(wrapper.isRunning(), true, "the reserved terminal batch remains active while its shared receipt is queued");
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.deepEqual(timeline, ["running"]);

  wrapper.projectedHub.processing = false;
  wrapper.projectedHub.drainAcceptedInputs();

  assert.equal(wrapper.nativeAgentTurnCount, 0);
  assert.equal(wrapper.reservedNativeTerminalCount, 0);
  assert.equal(wrapper.nativeCausalClaims.length, 0);
  assert.equal(hub.getState().active, false);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(timeline, ["running", "projected-final", "idle"]);
});

test("a delayed rejected terminal batch restores every captured native claim", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => {
    wrapper.projectedHub.processing = false;
    wrapper.destroy();
  });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();
  nativeListener({ type: "agent_start" });
  nativeListener({ type: "agent_start" });
  const hub = wrapper.getProjectedEventHub();
  const recoverableCursor = hub.cursor;

  wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;
  wrapper.projectedHub.processing = true;
  nativeListener({ type: "agent_settled" });
  assert.equal(wrapper.nativeAgentTurnCount, 0);
  assert.equal(wrapper.reservedNativeTerminalCount, 2);
  assert.equal(wrapper.nativeCausalClaims.length, 2);
  assert.equal(wrapper.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);

  wrapper.projectedHub.processing = false;
  wrapper.projectedHub.drainAcceptedInputs();

  assert.equal(wrapper.nativeAgentTurnCount, 2, "rejection restores the complete batch to unreserved activity");
  assert.equal(wrapper.reservedNativeTerminalCount, 0);
  assert.equal(wrapper.nativeCausalClaims.length, 2);
  assert.equal(wrapper.nativeCausalClaims.every((claim) => !claim.terminalReserved && claim.terminalOutcome === null), true);
  assert.equal(hub.getState().active, true);
  assert.equal(wrapper.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.deepEqual(transitions, [[wrapper.sessionId]], "rejected finality cannot publish idle");

  wrapper.projectedHub.sequence = recoverableCursor;
  nativeListener({ type: "agent_settled" });
  assert.equal(wrapper.nativeAgentTurnCount, 0);
  assert.equal(wrapper.reservedNativeTerminalCount, 0);
  assert.equal(wrapper.nativeCausalClaims.length, 0);
  assert.equal(hub.getState().active, false);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[wrapper.sessionId], []]);
});

test("queued multi-start receipts resolve one captured terminal batch transactionally", async (t) => {
  for (const terminalOutcome of ["committed", "rejected"]) {
    await t.test(terminalOutcome, (t) => {
      resetRunningProjectionState();
      const { manager } = createSource(t);
      let nativeListener;
      const wrapper = new AgentSessionWrapper(fakeInner(manager, {
        subscribe(listener) { nativeListener = listener; return () => {}; },
      }));
      t.after(() => {
        wrapper.projectedHub.processing = false;
        wrapper.destroy();
      });
      const timeline = [];
      const unsubscribe = subscribeRunningSessions((ids) => timeline.push(ids.size === 0 ? "idle" : "running"));
      t.after(unsubscribe);
      wrapper.start();
      const hub = wrapper.getProjectedEventHub();
      const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
        if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected-final");
      });
      t.after(attached.unsubscribe);
      if (terminalOutcome === "rejected") wrapper.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 4;

      wrapper.projectedHub.processing = true;
      nativeListener({ type: "agent_start" });
      nativeListener({ type: "agent_start" });
      nativeListener({ type: "agent_settled" });

      assert.equal(wrapper.nativeAgentTurnCount, 0);
      assert.equal(wrapper.reservedNativeTerminalCount, 2);
      assert.equal(wrapper.nativeCausalClaims.length, 2);
      assert.equal(wrapper.nativeCausalClaims.every((claim) => claim.startOutcome === "pending" && claim.terminalOutcome === "pending"), true);
      assert.equal(hub.getState().active, false, "queued starts have not committed projected activity");
      assert.equal(wrapper.isRunning(), true, "pending causal claims retain wrapper activity");
      assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
      assert.deepEqual(timeline, ["running"]);

      wrapper.projectedHub.processing = false;
      wrapper.projectedHub.drainAcceptedInputs();

      if (terminalOutcome === "committed") {
        assert.equal(wrapper.nativeAgentTurnCount, 0);
        assert.equal(wrapper.reservedNativeTerminalCount, 0);
        assert.equal(wrapper.nativeCausalClaims.length, 0);
        assert.equal(hub.getState().active, false);
        assert.equal(wrapper.isRunning(), false);
        assert.deepEqual(getRunningRpcSessionIds(), []);
        assert.deepEqual(timeline, ["running", "projected-final", "idle"]);
      } else {
        assert.equal(wrapper.nativeAgentTurnCount, 2);
        assert.equal(wrapper.reservedNativeTerminalCount, 0);
        assert.equal(wrapper.nativeCausalClaims.length, 2);
        assert.equal(wrapper.nativeCausalClaims.every((claim) => claim.startOutcome === "committed" && !claim.terminalReserved && claim.terminalOutcome === null), true);
        assert.equal(hub.getState().active, true);
        assert.equal(wrapper.isRunning(), true);
        assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
        assert.deepEqual(timeline, ["running"], "shared terminal rejection restores every now-committed start");
      }
    });
  }
});

test("a delayed obsolete-wrapper settlement cannot clear replacement-owned running status", async (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let obsoleteNativeListener;
  const obsolete = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { obsoleteNativeListener = listener; return () => {}; },
  }));
  let resolveReplacementPrompt;
  const replacementPrompt = new Promise((resolve) => { resolveReplacementPrompt = resolve; });
  const replacement = new AgentSessionWrapper(fakeInner(manager, {
    prompt: () => replacementPrompt,
  }));
  t.after(() => {
    obsolete.projectedHub.processing = false;
    obsolete.destroy();
    replacement.destroy();
  });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);

  obsolete.start();
  obsoleteNativeListener({ type: "agent_start" });
  obsoleteNativeListener({ type: "agent_start" });
  const obsoletePublisher = globalThis.__piRunningSessionPublishers.get(obsolete.sessionId);
  assert.ok(obsoletePublisher);
  obsolete.projectedHub.processing = true;
  obsoleteNativeListener({ type: "agent_settled" });
  assert.equal(obsolete.nativeAgentTurnCount, 0);
  assert.equal(obsolete.reservedNativeTerminalCount, 2);

  replacement.start();
  await replacement.send({ type: "prompt", message: "replacement-owned" });
  const replacementPublisher = globalThis.__piRunningSessionPublishers.get(replacement.sessionId);
  assert.ok(replacementPublisher);
  assert.notStrictEqual(replacementPublisher, obsoletePublisher);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);

  obsolete.projectedHub.processing = false;
  obsolete.projectedHub.drainAcceptedInputs();
  assert.equal(obsolete.isRunning(), false);
  assert.equal(replacement.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  assert.deepEqual(transitions, [[replacement.sessionId]], "the obsolete delayed release emits no false idle frame");

  resolveReplacementPrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replacement.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[replacement.sessionId], []]);
});

test("a reentrant replacement start retains authority through obsolete terminal finality", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let obsoleteNativeListener;
  let replacementNativeListener;
  const obsolete = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { obsoleteNativeListener = listener; return () => {}; },
  }));
  const replacement = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { replacementNativeListener = listener; return () => {}; },
  }));
  t.after(() => { obsolete.destroy(); replacement.destroy(); });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  obsolete.start();
  replacement.start();
  obsoleteNativeListener({ type: "agent_start" });
  obsoleteNativeListener({ type: "agent_start" });
  const obsoletePublisher = globalThis.__piRunningSessionPublishers.get(obsolete.sessionId);
  assert.ok(obsoletePublisher);
  let replacementPublisher;
  obsolete.onEvent((event) => {
    if (event.type !== "agent_settled" || replacementPublisher) return;
    replacementNativeListener({ type: "agent_start" });
    replacementPublisher = globalThis.__piRunningSessionPublishers.get(replacement.sessionId);
    assert.ok(replacementPublisher);
    assert.notStrictEqual(replacementPublisher, obsoletePublisher);
  });

  obsoleteNativeListener({ type: "agent_settled" });

  assert.equal(obsolete.isRunning(), false);
  assert.equal(replacement.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  assert.deepEqual(transitions, [[replacement.sessionId]], "obsolete finality emits no idle frame for the reentrant replacement");
});

test("a newer nested replacement start outranks an older outer start", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let obsoleteNativeListener;
  let replacementNativeListener;
  const obsolete = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { obsoleteNativeListener = listener; return () => {}; },
  }));
  const replacement = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { replacementNativeListener = listener; return () => {}; },
  }));
  t.after(() => { obsolete.destroy(); replacement.destroy(); });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  obsolete.start();
  replacement.start();
  let replacementPublisher;
  obsolete.onEvent((event) => {
    if (event.type !== "agent_start" || replacementPublisher) return;
    replacementNativeListener({ type: "agent_start" });
    replacementPublisher = globalThis.__piRunningSessionPublishers.get(replacement.sessionId);
    assert.ok(replacementPublisher);
  });

  obsoleteNativeListener({ type: "agent_start" });

  assert.equal(obsolete.isRunning(), true);
  assert.equal(replacement.isRunning(), true);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  obsoleteNativeListener({ type: "agent_settled" });
  assert.equal(obsolete.isRunning(), false);
  assert.equal(replacement.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  assert.deepEqual(transitions, [[replacement.sessionId]], "the older outer start and settlement emit no stale authority transition");
});

test("a rejected nested start cannot authorize an older outer authority claim", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let obsoleteNativeListener;
  let replacementNativeListener;
  const obsolete = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { obsoleteNativeListener = listener; return () => {}; },
  }));
  const replacement = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { replacementNativeListener = listener; return () => {}; },
  }));
  t.after(() => { obsolete.destroy(); replacement.destroy(); });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  obsolete.start();
  replacement.start();
  let replacementPublisher;
  obsolete.onEvent((event) => {
    if (event.type !== "agent_start" || replacementPublisher) return;
    replacementNativeListener({ type: "agent_start" });
    replacementPublisher = globalThis.__piRunningSessionPublishers.get(replacement.sessionId);
    assert.ok(replacementPublisher);
    const sequence = obsolete.projectedHub.sequence;
    obsolete.projectedHub.sequence = Number.MAX_SAFE_INTEGER - 2;
    obsoleteNativeListener({ type: "agent_start" });
    obsolete.projectedHub.sequence = sequence;
  });

  obsoleteNativeListener({ type: "agent_start" });
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  obsoleteNativeListener({ type: "agent_settled" });

  assert.equal(obsolete.isRunning(), false);
  assert.equal(replacement.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  assert.deepEqual(transitions, [[replacement.sessionId]]);
});

test("a newer same-publisher reclaim outranks an older outer start", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let incumbentNativeListener;
  let transientNativeListener;
  let obsoleteNativeListener;
  const incumbent = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { incumbentNativeListener = listener; return () => {}; },
  }));
  const transient = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { transientNativeListener = listener; return () => {}; },
  }));
  const obsolete = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { obsoleteNativeListener = listener; return () => {}; },
  }));
  t.after(() => { incumbent.destroy(); transient.destroy(); obsolete.destroy(); });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  incumbent.start();
  transient.start();
  obsolete.start();
  incumbentNativeListener({ type: "agent_start" });
  const incumbentPublisher = globalThis.__piRunningSessionPublishers.get(incumbent.sessionId);
  assert.ok(incumbentPublisher);
  obsolete.onEvent((event) => {
    if (event.type !== "agent_start" || !transient.isAlive()) return;
    transientNativeListener({ type: "agent_start" });
    transientNativeListener({ type: "agent_settled" });
    transient.destroy();
    incumbentNativeListener({ type: "session_info_changed", name: "newer-incumbent-publication" });
    assert.strictEqual(globalThis.__piRunningSessionPublishers.get(incumbent.sessionId), incumbentPublisher);
  });

  obsoleteNativeListener({ type: "agent_start" });
  obsoleteNativeListener({ type: "agent_settled" });

  assert.equal(incumbent.isRunning(), true);
  assert.equal(obsolete.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), [incumbent.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(incumbent.sessionId), incumbentPublisher);
  assert.deepEqual(transitions, [[incumbent.sessionId], [], [incumbent.sessionId]]);
});

test("a newer reentrant prompt claim outranks an older projected prompt claim", async (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let resolveObsoletePrompt;
  let resolveReplacementPrompt;
  const obsoletePrompt = new Promise((resolve) => { resolveObsoletePrompt = resolve; });
  const replacementPrompt = new Promise((resolve) => { resolveReplacementPrompt = resolve; });
  const obsolete = new AgentSessionWrapper(fakeInner(manager, { prompt: () => obsoletePrompt }));
  const replacement = new AgentSessionWrapper(fakeInner(manager, { prompt: () => replacementPrompt }));
  t.after(() => { obsolete.destroy(); replacement.destroy(); });
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  const hub = obsolete.getProjectedEventHub();
  let replacementAccepted;
  let replacementPublisher;
  const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type !== "activity_started" || unit.activity !== "prompt" || replacementAccepted) return;
    replacementAccepted = replacement.send({ type: "prompt", message: "newer-reentrant" });
    replacementPublisher = globalThis.__piRunningSessionPublishers.get(replacement.sessionId);
    assert.ok(replacementPublisher);
  });
  t.after(attached.unsubscribe);

  const obsoleteAccepted = obsolete.send({ type: "prompt", message: "older-outer" });
  await Promise.all([obsoleteAccepted, replacementAccepted]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);
  resolveObsoletePrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(obsolete.isRunning(), false);
  assert.equal(replacement.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [replacement.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(replacement.sessionId), replacementPublisher);

  resolveReplacementPrompt();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replacement.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[replacement.sessionId], []]);
});

test("native start and settlement publish one balanced running lifecycle", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => wrapper.destroy());
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();

  nativeListener({ type: "agent_start" });
  assert.equal(wrapper.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  nativeListener({ type: "session_info_changed", name: "during-run" });
  assert.deepEqual(transitions, [[wrapper.sessionId]], "ordinary active events do not duplicate the running frame");

  nativeListener({ type: "agent_settled" });
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[wrapper.sessionId], []]);
});

test("one native settlement retires every continued-attempt start captured before terminal fanout", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => wrapper.destroy());
  const timeline = [];
  const unsubscribe = subscribeRunningSessions((ids) => timeline.push(ids.size === 0 ? "idle" : "running"));
  t.after(unsubscribe);
  wrapper.start();
  const hub = wrapper.getProjectedEventHub();
  const cursor = hub.cursor;
  const attached = hub.attach(hub.streamEpoch, hub.cursor, (unit) => {
    if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected-final");
  });
  t.after(attached.unsubscribe);

  nativeListener({ type: "agent_start" });
  nativeListener({ type: "agent_end", willRetry: true });
  nativeListener({ type: "compaction_start", reason: "threshold" });
  nativeListener({ type: "compaction_end", reason: "threshold", result: undefined, aborted: false, willRetry: false });
  nativeListener({ type: "agent_start" });
  nativeListener({ type: "agent_end", willRetry: false });

  assert.equal(wrapper.nativeAgentTurnCount, 2);
  assert.equal(wrapper.reservedNativeTerminalCount, 0);
  assert.equal(wrapper.nativeCausalClaims.length, 2);
  assert.equal(hub.getState().active, true);
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.deepEqual(timeline, ["running"]);

  nativeListener({ type: "agent_settled" });

  const units = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(wrapper.nativeAgentTurnCount, 0, "session settlement retires every captured native start");
  assert.equal(wrapper.reservedNativeTerminalCount, 0);
  assert.equal(wrapper.nativeCausalClaims.length, 0);
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(units.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);
  assert.equal(hub.getState().active, false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(timeline, ["running", "projected-final", "idle"]);
});

test("reentrant native settlement publishes one balanced lifecycle after outer fanout", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => wrapper.destroy());
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();
  const cursor = wrapper.getProjectedEventHub().cursor;
  let nested = false;
  wrapper.onEvent((event) => {
    if (event.type === "agent_start" && !nested) {
      nested = true;
      nativeListener({ type: "agent_settled" });
    }
  });

  nativeListener({ type: "agent_start" });

  const projected = wrapper.getProjectedEventHub().replayAfter(wrapper.getProjectedEventHub().streamEpoch, cursor).units;
  assert.equal(projected.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[wrapper.sessionId], []]);
});

test("retry and compaction events retain membership until native settlement", (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let nativeListener;
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    subscribe(listener) { nativeListener = listener; return () => {}; },
  }));
  t.after(() => wrapper.destroy());
  const transitions = [];
  const unsubscribe = subscribeRunningSessions((ids) => transitions.push([...ids]));
  t.after(unsubscribe);
  wrapper.start();

  nativeListener({ type: "agent_start" });
  nativeListener({ type: "compaction_start", reason: "threshold" });
  nativeListener({ type: "compaction_end", reason: "threshold", result: undefined, aborted: false, willRetry: false });
  nativeListener({ type: "agent_end", willRetry: true });
  nativeListener({ type: "auto_retry_start", attempt: 1, maxAttempts: 2 });
  nativeListener({ type: "auto_retry_end" });
  assert.equal(wrapper.isRunning(), true);
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.deepEqual(transitions, [[wrapper.sessionId]], "retry and compaction do not clear or duplicate active membership");

  nativeListener({ type: "agent_settled" });
  assert.equal(wrapper.isRunning(), false);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.deepEqual(transitions, [[wrapper.sessionId], []]);
});

test("wrapper-owned prompt transitions settle and active destruction removes exactly its publication", async (t) => {
  resetRunningProjectionState();
  const { manager } = createSource(t);
  const promptResolvers = [];
  const wrapper = new AgentSessionWrapper(fakeInner(manager, {
    prompt: async () => new Promise((resolve) => promptResolvers.push(resolve)),
  }));
  wrapper.start();

  await wrapper.send({ type: "prompt", message: "settled fixture" });
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  const publicationIdentity = globalThis.__piRunningSessionPublishers.get(wrapper.sessionId);
  assert.ok(publicationIdentity);
  promptResolvers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.equal(globalThis.__piRunningSessionPublishers.size, 0);

  await wrapper.send({ type: "prompt", message: "destroyed fixture" });
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  assert.strictEqual(globalThis.__piRunningSessionPublishers.get(wrapper.sessionId), publicationIdentity,
    "one wrapper reuses its stable opaque publication identity");
  wrapper.destroy();
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.equal(globalThis.__piRunningSessionPublishers.size, 0);
  promptResolvers.shift()();
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
    emit({ type: "agent_start" });
    emit({ type: "agent_settled" });
    assertNoFinality(hub, cursor);
    assert.equal(wrapper.nativeAgentTurnCount, 1, "the start created during terminal fanout remains active");
    assert.equal(wrapper.reservedNativeTerminalCount, 0);
    assert.equal(wrapper.nativeCausalClaims.length, 1);
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
    { name: "native", start: { type: "agent_start" }, startCount: 2, end: { type: "agent_settled" }, countKey: "nativeAgentTurnCount", reservedKey: "reservedNativeTerminalCount" },
    { name: "current manual", start: { type: "compaction_start", reason: "manual" }, startCount: 1, end: { type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false }, countKey: "standaloneNativeCompactionCount", reservedKey: "reservedStandaloneCompactionTerminalCount" },
    { name: "legacy manual", start: { type: "auto_compaction_start", reason: "manual" }, startCount: 1, end: { type: "auto_compaction_end", reason: "manual", result: undefined, aborted: false }, countKey: "standaloneNativeCompactionCount", reservedKey: "reservedStandaloneCompactionTerminalCount" },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const { wrapper, hub, emit } = createWrapper();
      const timeline = [];
      let nested = false;
      wrapper.onEvent((event) => {
        if (event.type !== fixture.end.type) return;
        timeline.push(nested ? "listener1:nested" : "listener1:outer");
        if (!nested) {
          assert.equal(wrapper[fixture.reservedKey], fixture.startCount, "the outer terminal reserves its complete pre-fanout batch");
          nested = true;
          emit({ ...fixture.end });
        }
      });
      wrapper.onEvent((event) => { if (event.type === fixture.end.type) timeline.push(event === fixture.end ? "listener2:outer" : "listener2:nested"); });
      hub.attach(hub.streamEpoch, hub.cursor, (unit) => { if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final"); });
      const cursor = hub.cursor;
      for (let index = 0; index < fixture.startCount; index += 1) emit({ ...fixture.start });
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

test("standalone manual compaction terminals remain one-to-one", async (t) => {
  const cases = [
    {
      name: "current",
      start: { type: "compaction_start", reason: "manual" },
      end: { type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false },
    },
    {
      name: "legacy",
      start: { type: "auto_compaction_start", reason: "manual" },
      end: { type: "auto_compaction_end", reason: "manual", result: undefined, aborted: false },
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      resetRunningProjectionState();
      const { manager } = createSource(t);
      let nativeListener;
      const wrapper = new AgentSessionWrapper(fakeInner(manager, {
        subscribe(listener) { nativeListener = listener; return () => {}; },
      }));
      wrapper.start();
      const hub = wrapper.getProjectedEventHub();
      const cursor = hub.cursor;

      nativeListener({ ...fixture.start });
      nativeListener({ ...fixture.start });
      nativeListener({ ...fixture.end });

      let units = hub.replayAfter(hub.streamEpoch, cursor).units;
      assert.equal(wrapper.standaloneNativeCompactionCount, 1, "one terminal retires only one manual claim");
      assert.equal(wrapper.reservedStandaloneCompactionTerminalCount, 0);
      assert.equal(wrapper.standaloneCompactionCausalClaims.length, 1);
      assert.equal(units.filter((unit) => unit.type === "run_settled").length, 0);
      assert.equal(hub.getState().active, true);
      assert.equal(wrapper.isRunning(), true);
      assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);

      nativeListener({ ...fixture.end });

      units = hub.replayAfter(hub.streamEpoch, cursor).units;
      assert.equal(wrapper.standaloneNativeCompactionCount, 0);
      assert.equal(wrapper.reservedStandaloneCompactionTerminalCount, 0);
      assert.equal(wrapper.standaloneCompactionCausalClaims.length, 0);
      assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
      assert.equal(hub.getState().active, false);
      assert.equal(wrapper.isRunning(), false);
      assert.deepEqual(getRunningRpcSessionIds(), []);
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
    { name: "native", start: { type: "agent_start" }, startCount: 2, end: { type: "agent_settled" }, reservedKey: "reservedNativeTerminalCount" },
    { name: "current manual", start: { type: "compaction_start", reason: "manual" }, startCount: 1, end: { type: "compaction_end", reason: "manual", aborted: false, willRetry: false }, reservedKey: "reservedStandaloneCompactionTerminalCount" },
    { name: "legacy manual", start: { type: "auto_compaction_start", reason: "manual" }, startCount: 1, end: { type: "auto_compaction_end", reason: "manual", aborted: false }, reservedKey: "reservedStandaloneCompactionTerminalCount" },
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
        assert.equal(wrapper[fixture.reservedKey], fixture.startCount, "the outer reservation excludes the later nested claim");
        nested = true;
        timeline.push("first:outer-terminal");
        nativeListener({ ...fixture.start });
        nativeListener({ ...fixture.end });
      });
      wrapper.onEvent((event) => { if (event.type === fixture.end.type) timeline.push(nested ? "second:terminal" : "second:unexpected"); });
      hub.attach(hub.streamEpoch, hub.cursor, (unit) => { if (unit.type === "snapshot_start" && unit.reason === "final") timeline.push("projected:final"); });
      const cursor = hub.cursor;
      for (let index = 0; index < fixture.startCount; index += 1) nativeListener({ ...fixture.start });
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
  resetRunningProjectionState();
  const { manager } = createSource(t);
  let rejectBinding;
  const binding = new Promise((_, reject) => { rejectBinding = reject; });
  const bound = new AgentSessionWrapper(fakeInner(manager, { bindExtensions: async () => binding }));
  bound.beginExtensionBinding();
  const failed = bound.send({ type: "prompt", message: "binding" });
  assert.deepEqual(getRunningRpcSessionIds(), [bound.sessionId]);
  rejectBinding(new Error("binding failed"));
  await assert.rejects(failed, /binding failed/);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  let units = bound.getProjectedEventHub().replayAfter(bound.getProjectedEventHub().streamEpoch, 0).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  bound.destroy();

  const synchronous = new AgentSessionWrapper(fakeInner(manager, { prompt: () => { throw new Error("sync"); } }));
  const synchronousFailure = synchronous.send({ type: "prompt", message: "sync" });
  assert.deepEqual(getRunningRpcSessionIds(), [synchronous.sessionId]);
  await assert.rejects(synchronousFailure, /sync/);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  units = synchronous.getProjectedEventHub().replayAfter(synchronous.getProjectedEventHub().streamEpoch, 0).units;
  assert.equal(units.filter((unit) => unit.type === "run_settled").length, 1);
  synchronous.destroy();

  const resolvers = [];
  const overlap = new AgentSessionWrapper(fakeInner(manager, { prompt: () => new Promise((resolve) => resolvers.push(resolve)) }));
  await overlap.send({ type: "prompt", message: "one" });
  await overlap.send({ type: "prompt", message: "two" });
  assert.deepEqual(getRunningRpcSessionIds(), [overlap.sessionId]);
  const cursor = overlap.getProjectedEventHub().cursor;
  resolvers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(overlap.getProjectedEventHub().replayAfter(overlap.getProjectedEventHub().streamEpoch, cursor).units.some((unit) => unit.type === "run_settled"), false);
  assert.deepEqual(getRunningRpcSessionIds(), [overlap.sessionId]);
  resolvers[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(overlap.getProjectedEventHub().replayAfter(overlap.getProjectedEventHub().streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  overlap.destroy();
});

test("hosted extension-binding failure emits public events before one authoritative projected settlement", async (t) => {
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), []);
  wrapper.destroy();
});

test("standalone compaction success/error and prompt overlap obey last-claim settlement", async (t) => {
  resetRunningProjectionState();
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
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  compactResolvers.shift()({ ok: true });
  await compact;
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);

  compactMode = "error";
  cursor = hub.cursor;
  const failedCompaction = wrapper.send({ type: "compact" });
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  await assert.rejects(failedCompaction, /compact failure/);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  let failureUnits = hub.replayAfter(hub.streamEpoch, cursor).units;
  assert.equal(failureUnits.filter((unit) => unit.type === "run_settled").length, 1);
  assert.equal(failureUnits.filter((unit) => unit.type === "snapshot_start" && unit.reason === "final").length, 1);

  compactMode = "abort";
  cursor = hub.cursor;
  const aborted = wrapper.send({ type: "compact" });
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  await wrapper.send({ type: "abort_compaction" });
  await assert.rejects(aborted, /abort/);
  assert.deepEqual(getRunningRpcSessionIds(), []);
  assert.equal(abortCalls, 1);
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);

  compactMode = "success";
  await wrapper.send({ type: "prompt", message: "overlap" });
  const overlappingCompact = wrapper.send({ type: "compact" });
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId]);
  cursor = hub.cursor;
  promptResolvers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.some((unit) => unit.type === "run_settled"), false);
  assert.deepEqual(getRunningRpcSessionIds(), [wrapper.sessionId], "overlapping compaction retains global running membership");
  compactResolvers.shift()({ ok: true });
  await overlappingCompact;
  assert.equal(hub.replayAfter(hub.streamEpoch, cursor).units.filter((unit) => unit.type === "run_settled").length, 1);
  assert.deepEqual(getRunningRpcSessionIds(), []);
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
  const failures = [
    new Error("private extension payload"),
    Object.assign(new Error("secret custom message"), { name: "PrivateExtensionFailure" }),
    Object.defineProperties({}, {
      name: { get() { throw new Error("private name getter"); } },
      message: { get() { throw new Error("private message getter"); } },
    }),
  ];
  for (const failure of failures) {
    const failed = new AgentSessionWrapper(fakeInner(manager, {
      bindExtensions: async () => { throw failure; },
    }));
    failed.beginExtensionBinding();
    await new Promise((resolve) => setImmediate(resolve));
    failed.destroy();
  }

  assert.ok(lines.some((line) => line.includes("stage=dispatched outcome=ok")));
  assert.equal(lines.filter((line) => line.includes("stage=failed errorClass=Error")).length, failures.length);
  assert.ok(lines.every((line) => line.length <= 160));
  assert.ok(lines.every((line) => !line.includes(manager.getSessionId())));
  for (const secret of ["private extension payload", "secret custom message", "PrivateExtensionFailure", "private name getter", "private message getter"]) {
    assert.ok(lines.every((line) => !line.includes(secret)));
  }
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
