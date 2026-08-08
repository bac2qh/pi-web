import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const protocol = await jiti.import("../lib/session-protocol.ts");
const { PI_WEB_OPENAI_FAST_MODE_STATUS_KEY } = await jiti.import("../lib/openai-fast-mode-status.ts");
const { SessionRegistryProvider, useSessionViewTransport } = await jiti.import("./SessionRegistryProvider.tsx");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { clearDraft, getDraft } = await jiti.import("../lib/draft-store.ts");
const { SessionViewTransport } = await jiti.import("../lib/session-view-transport.ts");
const { useAgentSession } = await jiti.import("../hooks/useAgentSession.ts");

async function source(path) { return readFile(new URL(path, import.meta.url), "utf8"); }
function transportSnapshot(connectionState = "idle", active = false, cursor = 0) {
  return protocol.freezeCanonicalData({
    connectionState, serverInstanceId: connectionState === "idle" ? null : "server",
    streamEpoch: connectionState === "idle" ? null : "epoch", cursor,
    state: { ...protocol.createInitialProjectedSessionState(), active }, readyOutcome: connectionState === "idle" ? null : "exact",
    errorClass: null, revision: cursor,
  });
}
function transportSnapshotWithState(connectionState, active, cursor, statePatch = {}, transportPatch = {}) {
  const base = transportSnapshot(connectionState, active, cursor);
  return protocol.freezeCanonicalData({
    ...base,
    ...transportPatch,
    state: { ...base.state, ...statePatch, active },
  });
}
class Handle {
  constructor(snapshot, owner = null, id = null) { this.snapshot = snapshot; this.owner = owner; this.id = id; this.snapshots = new Set(); this.effects = new Set(); this.releases = 0; }
  getSnapshot() { return this.snapshot; }
  subscribe(listener) { this.snapshots.add(listener); listener(this.snapshot); return () => this.snapshots.delete(listener); }
  subscribeEffects(listener) { this.effects.add(listener); return () => this.effects.delete(listener); }
  updateOwnership(value) { this.owner?.operations.push(["ownership", this.id, value]); }
  release() { this.releases += 1; this.owner?.operations.push(["release", this.id]); }
  publish(snapshot) { this.snapshot = snapshot; for (const listener of [...this.snapshots]) listener(snapshot); }
  effect(value) { for (const listener of [...this.effects]) listener(value); }
}
class Registry {
  constructor() { this.handles = new Map(); this.operations = []; this.disposes = 0; this.initialSnapshot = transportSnapshot(); }
  acquire(id, options) { this.operations.push(["acquire", id, options.ownership]); const handle = new Handle(this.initialSnapshot, this, id); this.handles.set(id, handle); if (options.onSnapshot) handle.snapshots.add(options.onSnapshot); if (options.onEffect) handle.effects.add(options.onEffect); options.onSnapshot?.(handle.snapshot); return handle; }
  dispose() { this.disposes += 1; }
}
function createMinimalDom() {
  const noop = () => {};
  const makeEventTarget = (target) => {
    const listeners = new Map();
    target.addEventListener = (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    };
    target.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
    target.dispatchEvent = (event) => {
      if (!event.target) event.target = target;
      event.currentTarget = target;
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener.call(target, event);
      if (event.bubbles !== false && !event.cancelBubble && target.parentNode?.dispatchEvent) target.parentNode.dispatchEvent(event);
      return !event.defaultPrevented;
    };
    return target;
  };
  const make = (tag, document) => makeEventTarget({
    nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document, parentNode: null, childNodes: [], style: {}, attributes: {}, value: "", disabled: false,
    selectionStart: 0, selectionEnd: 0, scrollHeight: 24, focus: noop, click() { this.dispatchEvent({ type: "click", bubbles: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; } }); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, before) { child.parentNode = this; const index = this.childNodes.indexOf(before); this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child); return child; },
    removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; },
    get firstChild() { return this.childNodes[0] ?? null; }, get lastChild() { return this.childNodes.at(-1) ?? null; }, textContent: "",
  });
  const document = makeEventTarget({
    nodeType: 9, nodeName: "#document", namespaceURI: "http://www.w3.org/1999/xhtml",
    createElement(tag) { return make(tag, this); },
    createElementNS(namespaceURI, tag) { const element = make(tag, this); element.namespaceURI = namespaceURI; return element; },
    createTextNode(text) { return { nodeType: 3, nodeName: "#text", nodeValue: text, data: text, ownerDocument: this, parentNode: null }; },
    defaultView: null,
  });
  const window = makeEventTarget({ document, event: undefined, HTMLIFrameElement: class {}, HTMLElement: class {}, Node: class {} });
  document.defaultView = window;
  return { document, window, container: make("div", document) };
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.childNodes ?? []) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function elementText(root) {
  if (root.nodeType === 3) return root.nodeValue ?? "";
  return (root.childNodes ?? []).map(elementText).join("");
}

async function flushMountedWork() {
  await React.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function mountExistingSessionHook(fetchImpl) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.fetch = fetchImpl;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  registry.initialSnapshot = transportSnapshot("connected", false, 0);
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  let latest = null;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding,
      sessionViewTransport: views,
      newScreenGeneration: 1,
      newSessionCwd: null,
    });
    return React.createElement("span", null, "hook");
  }
  const root = createRoot(dom.container);
  await React.act(async () => root.render(React.createElement(Consumer)));
  await flushMountedWork();
  return {
    dom,
    registry,
    latest: () => latest,
    async cleanup() {
      await React.act(async () => root.unmount());
      views.dispose();
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.fetch = previous.fetch;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    },
  };
}

test("mounted mobile ChatInput keeps the non-interactive Fast badge anchored while model selection is disabled", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  dom.window.matchMedia = (query) => ({
    matches: query === "(max-width: 640px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(ChatInput, {
      onSend: () => true,
      onAbort: () => {},
      isStreaming: true,
      model: { provider: "other", modelId: "unsupported" },
      modelList: [{ provider: "other", id: "unsupported", name: "A very long mobile model display name" }],
      onModelChange: () => {},
      openAiFastModeState: "unavailable",
    })));
    const badge = findElement(dom.container, (element) => element.attributes?.["data-openai-fast-mode"] === "unavailable");
    assert.ok(badge);
    assert.equal(elementText(badge) || badge.textContent, "Fast unavailable");
    assert.ok(badge.style.flexShrink === 0 || badge.style.flexShrink === "0");
    const modelButton = badge.parentNode;
    assert.equal(modelButton.tagName, "BUTTON");
    assert.ok(modelButton.disabled === true || Object.hasOwn(modelButton.attributes, "disabled"));
    assert.equal(modelButton.style.width, "100%");
    assert.match(modelButton.attributes["aria-label"], /other\/unsupported/);
    assert.match(modelButton.attributes.title, /OpenAI priority service tier/);
  } finally {
    await React.act(async () => root.unmount());
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted model changes keep Fast unknown until the projected status watermark reaches the selected model", async () => {
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: null,
        context: {
          messages: [], entryIds: [], thinkingLevel: "off",
          model: { provider: "openai", modelId: "gpt-5.4" },
        },
      });
    }
    if (url.startsWith("/api/models")) {
      return Response.json({
        models: {}, defaultModel: null,
        modelList: [
          { provider: "openai", id: "gpt-5.4", name: "GPT" },
          { provider: "other", id: "unsupported", name: "Unsupported" },
        ],
      });
    }
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const command = JSON.parse(String(init.body));
      if (command.type === "set_model") {
        return Response.json({ success: true, data: {
          id: "unsupported", provider: "other",
          projection: { streamEpoch: "epoch", cursor: 4 },
        } });
      }
      throw new Error(`unexpected command ${command.type}`);
    }
    if (url === "/api/agent/synthetic") {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    throw new Error(`unexpected ${url}`);
  });
  try {
    const handle = mounted.registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "effective");

    await React.act(async () => { await mounted.latest().handleModelChange("other", "unsupported"); });
    assert.deepEqual(mounted.latest().displayModel, { provider: "other", modelId: "unsupported" });
    assert.equal(mounted.latest().openAiFastModeState, "unknown", "the old effective state is demoted before model intent renders");

    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 2, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unknown", "a delayed pre-watermark effective frame cannot claim Fast");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 3, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unknown" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unknown");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 4, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unavailable" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unavailable");
    assert.deepEqual(mounted.latest().extensionStatuses, []);
  } finally {
    await mounted.cleanup();
  }
});

test("mounted overlapping model intents serialize and only the latest watermark can reveal Fast", async () => {
  const requests = [];
  let resolveFirstResponse;
  const firstResponse = new Promise((resolve) => { resolveFirstResponse = resolve; });
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: null,
        context: {
          messages: [], entryIds: [], thinkingLevel: "off",
          model: { provider: "openai", modelId: "gpt-5.4" },
        },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const command = JSON.parse(String(init.body));
      requests.push(command.modelId);
      if (command.modelId === "first") return firstResponse;
      return Response.json({ success: true, data: {
        id: "unsupported", provider: "other",
        projection: { streamEpoch: "epoch", cursor: 5 },
      } });
    }
    if (url === "/api/agent/synthetic") {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    throw new Error(`unexpected ${url}`);
  });
  try {
    const handle = mounted.registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    let first;
    let latest;
    await React.act(async () => {
      first = mounted.latest().handleModelChange("openai", "first");
      await Promise.resolve();
    });
    for (let attempt = 0; attempt < 20 && requests.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await React.act(async () => {
      latest = mounted.latest().handleModelChange("other", "unsupported");
      await Promise.resolve();
    });
    assert.deepEqual(requests, ["first"], "the latest browser intent waits instead of racing the first HTTP mutation");
    assert.equal(mounted.latest().openAiFastModeState, "unknown");

    await React.act(async () => {
      resolveFirstResponse(Response.json({ success: true, data: {
        id: "first", provider: "openai",
        projection: { streamEpoch: "epoch", cursor: 2 },
      } }));
      await first;
      await latest;
    });
    assert.deepEqual(requests, ["first", "unsupported"]);
    assert.deepEqual(mounted.latest().displayModel, { provider: "other", modelId: "unsupported" });
    assert.equal(mounted.latest().openAiFastModeState, "unknown");

    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 2, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unknown", "the superseded request watermark cannot complete the latest intent");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 5, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unavailable" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unavailable");
  } finally {
    await mounted.cleanup();
  }
});

test("an independent model transition confirms model and Fast state at one exact runtime watermark", async () => {
  let resolveRuntimeResponse;
  let runtimeRequests = 0;
  const runtimeResponse = new Promise((resolve) => { resolveRuntimeResponse = resolve; });
  const mounted = await mountExistingSessionHook(async (input) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: null,
        context: {
          messages: [], entryIds: [], thinkingLevel: "off",
          model: { provider: "other", modelId: "unsupported-a" },
        },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic") {
      runtimeRequests += 1;
      return runtimeResponse;
    }
    throw new Error(`unexpected ${url}`);
  });
  try {
    const handle = mounted.registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unavailable" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unavailable");

    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 2, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unknown" }]),
    })));
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 3, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    for (let attempt = 0; attempt < 20 && runtimeRequests === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtimeRequests, 1);
    assert.deepEqual(mounted.latest().displayModel, { provider: "other", modelId: "unsupported-a" });
    assert.equal(mounted.latest().openAiFastModeState, "unknown",
      "the final projection cannot claim Fast beside the prior caller's model");

    await React.act(async () => {
      resolveRuntimeResponse(Response.json({
        running: false,
        state: {
          model: { provider: "openai", id: "gpt-5.4" },
          projection: { streamEpoch: "epoch", cursor: 3 },
          extensionStatuses: [{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }],
          isStreaming: false,
          isPromptRunning: false,
          isCompacting: false,
        },
      }));
      await Promise.resolve();
    });
    await flushMountedWork();
    assert.deepEqual(mounted.latest().displayModel, { provider: "openai", modelId: "gpt-5.4" });
    assert.equal(mounted.latest().openAiFastModeState, "effective");
  } finally {
    await mounted.cleanup();
  }
});

test("exact runtime authority clears a stale displayed model when no model remains selected", async () => {
  let resolveRuntimeResponse;
  let runtimeRequests = 0;
  const runtimeResponse = new Promise((resolve) => { resolveRuntimeResponse = resolve; });
  const mounted = await mountExistingSessionHook(async (input) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: null,
        context: {
          messages: [], entryIds: [], thinkingLevel: "off",
          model: { provider: "openai", modelId: "gpt-5.4" },
        },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic") {
      runtimeRequests += 1;
      return runtimeResponse;
    }
    throw new Error(`unexpected ${url}`);
  });
  try {
    const handle = mounted.registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 2, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unknown" }]),
    })));
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 3, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unavailable" }]),
    })));
    for (let attempt = 0; attempt < 20 && runtimeRequests === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtimeRequests, 1);
    assert.equal(mounted.latest().openAiFastModeState, "unknown");

    await React.act(async () => {
      resolveRuntimeResponse(Response.json({
        running: false,
        state: {
          model: null,
          projection: { streamEpoch: "epoch", cursor: 3 },
          extensionStatuses: [{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unavailable" }],
          isStreaming: false,
          isPromptRunning: false,
          isCompacting: false,
        },
      }));
      await Promise.resolve();
    });
    await flushMountedWork();
    assert.equal(mounted.latest().displayModel, null);
    assert.equal(mounted.latest().openAiFastModeState, "unavailable");
  } finally {
    await mounted.cleanup();
  }
});

test("reconnect keeps Fast unknown until the replayed state is model-correlated", async () => {
  let resolveRuntimeResponse;
  let runtimeRequests = 0;
  const runtimeResponse = new Promise((resolve) => { resolveRuntimeResponse = resolve; });
  const mounted = await mountExistingSessionHook(async (input) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: null,
        context: {
          messages: [], entryIds: [], thinkingLevel: "off",
          model: { provider: "openai", modelId: "gpt-5.4" },
        },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic") {
      runtimeRequests += 1;
      return runtimeResponse;
    }
    throw new Error(`unexpected ${url}`);
  });
  try {
    const handle = mounted.registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "effective");

    await React.act(async () => handle.publish(transportSnapshotWithState("recovering", false, 2, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    }, { streamEpoch: "reconnected-epoch" })));
    for (let attempt = 0; attempt < 20 && runtimeRequests === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtimeRequests, 1);
    assert.equal(mounted.latest().openAiFastModeState, "unknown");

    await React.act(async () => {
      resolveRuntimeResponse(Response.json({
        running: false,
        state: {
          model: { provider: "openai", id: "gpt-5.4" },
          projection: { streamEpoch: "reconnected-epoch", cursor: 2 },
          extensionStatuses: [{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }],
          isStreaming: false,
          isPromptRunning: false,
          isCompacting: false,
        },
      }));
      await Promise.resolve();
    });
    await flushMountedWork();
    assert.equal(mounted.latest().openAiFastModeState, "effective");
  } finally {
    await mounted.cleanup();
  }
});

test("a delayed model response cannot consume a later independent caller's Fast projection", async () => {
  let resolveModelResponse;
  let resolveRuntimeResponse;
  let runtimeRequests = 0;
  const modelResponse = new Promise((resolve) => { resolveModelResponse = resolve; });
  const runtimeResponse = new Promise((resolve) => { resolveRuntimeResponse = resolve; });
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) {
      return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: null,
        context: {
          messages: [], entryIds: [], thinkingLevel: "off",
          model: { provider: "openai", modelId: "gpt-5.4" },
        },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return modelResponse;
    if (url === "/api/agent/synthetic") {
      runtimeRequests += 1;
      return runtimeResponse;
    }
    throw new Error(`unexpected ${url}`);
  });
  try {
    const handle = mounted.registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));

    let change;
    await React.act(async () => {
      change = mounted.latest().handleModelChange("other", "unsupported-a");
      await Promise.resolve();
    });
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 3, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unknown" }]),
    })));
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 4, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    assert.equal(mounted.latest().openAiFastModeState, "unknown",
      "the independent caller's effective projection stays hidden while model A is unresolved");

    await React.act(async () => {
      resolveModelResponse(Response.json({ success: true, data: {
        id: "unsupported-a", provider: "other",
        projection: { streamEpoch: "epoch", cursor: 2 },
      } }));
      await change;
    });
    for (let attempt = 0; attempt < 20 && runtimeRequests === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtimeRequests, 1);
    assert.deepEqual(mounted.latest().displayModel, { provider: "other", modelId: "unsupported-a" });
    assert.equal(mounted.latest().openAiFastModeState, "unknown",
      "cursor 4 cannot satisfy model A's exact cursor-2 authority");

    await React.act(async () => {
      resolveRuntimeResponse(Response.json({
        running: false,
        state: {
          model: { provider: "openai", id: "gpt-5.4" },
          projection: { streamEpoch: "epoch", cursor: 4 },
          extensionStatuses: [{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }],
          isStreaming: false,
          isPromptRunning: false,
          isCompacting: false,
        },
      }));
      await Promise.resolve();
    });
    await flushMountedWork();
    assert.deepEqual(mounted.latest().displayModel, { provider: "openai", modelId: "gpt-5.4" });
    assert.equal(mounted.latest().openAiFastModeState, "effective");
  } finally {
    await mounted.cleanup();
  }
});

test("mounted React DOM consumer receives canonical state before effect and provider releases view before registry", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  const order = [];
  function Consumer() {
    const views = useSessionViewTransport();
    useEffect(() => {
      const binding = views.select("synthetic");
      const offSnapshot = binding.subscribe((snapshot) => order.push(["snapshot", snapshot.transport.cursor]));
      const offEffect = binding.subscribeEffects((effect) => order.push(["effect", effect.sequence, binding.getSnapshot().transport.cursor]));
      return () => { offSnapshot(); offEffect(); };
    }, [views]);
    return React.createElement("span", null, "mounted");
  }
  try {
    const root = createRoot(dom.container);
    await React.act(async () => root.render(React.createElement(SessionRegistryProvider, { createRegistry: () => registry }, React.createElement(Consumer))));
    const handle = registry.handles.get("synthetic");
    await React.act(async () => {
      handle.publish(transportSnapshot("connected", true, 1));
      handle.effect({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "synthetic" } });
    });
    assert.deepEqual(order.slice(-2), [["snapshot", 1], ["effect", 1, 1]]);
    await React.act(async () => root.unmount());
    await Promise.resolve();
    assert.equal(handle.releases, 1);
    assert.equal(registry.disposes, 1);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted useAgentSession gates HTTP prompt on the binding and completes one visible projected lineage", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let current = Object.freeze({ generation: 1, transport: transportSnapshot("connected", false, 0), canonicalCommitted: true, localPromptPending: false });
  const snapshotListeners = new Set(), effectListeners = new Set(), completionListeners = new Set();
  let nextLineage = 1, promptLineage = null, completionDelivered = false;
  const claim = { lineage: 0, acceptedCalls: 0, failedCalls: 0, settledCalls: 0, accepted() { this.acceptedCalls += 1; }, failed() { this.failedCalls += 1; promptLineage = null; }, settled() { this.settledCalls += 1; binding.settlePromptLineage(this.lineage); } };
  const binding = {
    getSnapshot: () => current,
    getPromptLineage: () => promptLineage,
    subscribe(listener) { snapshotListeners.add(listener); listener(current); return () => snapshotListeners.delete(listener); },
    subscribeEffects(listener) { effectListeners.add(listener); return () => effectListeners.delete(listener); },
    subscribeCompletions(listener) { completionListeners.add(listener); return () => completionListeners.delete(listener); },
    waitUntilAttached: async () => {},
    beginPromptClaim() { claim.lineage = nextLineage++; promptLineage = claim.lineage; completionDelivered = false; return claim; },
    settlePromptLineage(lineage) { if (lineage !== promptLineage || completionDelivered) return; completionDelivered = true; promptLineage = null; for (const listener of [...completionListeners]) listener(lineage); },
    publish(next) { const wasActive = current.transport.state.active; current = next; for (const listener of [...snapshotListeners]) listener(next); if (wasActive && !next.transport.state.active && promptLineage !== null) this.settlePromptLineage(promptLineage); },
    effect(next) { for (const listener of [...effectListeners]) listener(next); },
  };
  const transportCounters = { select: 0, beginPrompt: 0 };
  const transport = {
    select: () => { transportCounters.select += 1; return binding; },
    beginPrompt: () => { transportCounters.beginPrompt += 1; return { binding, claim: binding.beginPromptClaim() }; },
    dispose() {},
  };
  let transcriptMessages = [];
  const fetchOrder = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); fetchOrder.push([url, init.method ?? "GET"]);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) return Response.json({ context: { messages: transcriptMessages, entryIds: [] } });
    if (url.startsWith("/api/sessions/synthetic?")) return Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: "leaf", context: { messages: transcriptMessages, entryIds: [], thinkingLevel: "off", model: null } });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
      if (command.type === "fork") return Response.json({ success: true, data: { newSessionId: "child" } });
      if (command.type === "clone") return Response.json({ success: true, data: { created: true, newSessionId: "clone" } });
      return Response.json({ success: true, data: {} });
    }
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error("unexpected synthetic request");
  };
  let latest = null, completions = 0, forks = 0, clones = 0;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding, sessionViewTransport: transport, newScreenGeneration: 1, newSessionCwd: null,
      onAgentEnd: () => { completions += 1; },
      onSessionForked: () => { forks += 1; },
      onSessionCloned: () => { clones += 1; },
    });
    return React.createElement("span", null, "hook");
  }
  try {
    const root = createRoot(dom.container);
    await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); await Promise.resolve(); });
    const finishedCompactionTransport = transportSnapshot("connected", false, 0);
    await React.act(async () => binding.publish(Object.freeze({ generation: 1, transport: Object.freeze({ ...finishedCompactionTransport, state: Object.freeze({ ...finishedCompactionTransport.state, compaction: Object.freeze({ active: false, reason: "manual", tokensBefore: 10, estimatedTokensAfter: 5 }) }) }), localPromptPending: false })));
    assert.equal(latest.compactResult?.tokensBefore, 10);
    const activeCompactionTransport = transportSnapshot("connected", true, 0);
    await React.act(async () => binding.publish(Object.freeze({ generation: 1, transport: Object.freeze({ ...activeCompactionTransport, state: Object.freeze({ ...activeCompactionTransport.state, compaction: Object.freeze({ active: true, reason: "manual" }) }) }), localPromptPending: false })));
    assert.equal(latest.compactResult, null, "a new canonical compaction clears the prior result");
    const richTransport = transportSnapshot("connected", true, 1);
    await React.act(async () => binding.publish(Object.freeze({
      generation: 1,
      transport: Object.freeze({ ...richTransport, state: Object.freeze({
        ...richTransport.state,
        queue: Object.freeze({ steering: Object.freeze(["steer"]), followUp: Object.freeze(["follow"]) }),
        retry: Object.freeze({ attempt: 2, maxAttempts: 4, errorMessage: "retry" }),
        statuses: Object.freeze([
          { key: "status", text: "working" },
          { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
        ]),
        widgets: Object.freeze([{ key: "widget", lines: Object.freeze(["line"]), placement: "aboveEditor" }]),
      }) }),
      canonicalCommitted: true,
      localPromptPending: false,
    })));
    assert.deepEqual(latest.queuedMessages, { steering: ["steer"], followUp: ["follow"] });
    assert.equal(latest.retryInfo.attempt, 2);
    assert.deepEqual(latest.extensionStatuses, [{ key: "status", text: "working" }]);
    assert.equal(latest.openAiFastModeState, "effective");
    assert.equal(latest.extensionWidgets[0].key, "widget");
    await React.act(async () => binding.publish(Object.freeze({ generation: 1, transport: transportSnapshot("connected", false, 2), canonicalCommitted: true, localPromptPending: false })));
    assert.equal(latest.openAiFastModeState, null, "a canonical host-key clear removes only the Fast badge");
    await React.act(async () => { await latest.handleSend("synthetic prompt"); });
    const promptPost = fetchOrder.findIndex(([url, method]) => url === "/api/agent/synthetic" && method === "POST");
    assert.ok(promptPost >= 0);
    assert.equal(claim.acceptedCalls, 1);
    await React.act(async () => {
      binding.publish(Object.freeze({ generation: 1, transport: transportSnapshot("connected", true, 1), localPromptPending: false }));
      binding.publish(Object.freeze({ generation: 1, transport: transportSnapshot("connected", true, 2), localPromptPending: false }));
      binding.effect({ streamEpoch: "epoch", sequence: 2, effect: { type: "message_completed", message: { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "complete" }] } } });
    });
    assert.equal(latest.agentRunning, true);
    transcriptMessages = [
      { role: "user", content: "synthetic prompt" },
      { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "complete" }] },
    ];
    await React.act(async () => {
      binding.publish(Object.freeze({ generation: 1, transport: transportSnapshot("connected", false, 3), localPromptPending: false }));
      await Promise.resolve(); await Promise.resolve();
    });
    assert.equal(completions, 1);
    assert.equal(latest.agentRunning, false);
    assert.equal(latest.messages.length, 2);
    await React.act(async () => { await latest.handleNavigate("leaf"); });
    await React.act(async () => { await latest.handleFork("entry"); });
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
    try {
      await React.act(async () => { await latest.handleBuiltinSlashCommand("/clone"); await Promise.resolve(); await Promise.resolve(); });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    assert.equal(forks, 1);
    assert.equal(clones, 1);
    assert.deepEqual(transportCounters, { select: 0, beginPrompt: 0 }, "navigation/fork/clone do not churn page transport");
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted attach and prompt POST failures roll back text-plus-image optimistic state and return composer retention", async (t) => {
  for (const failure of ["attach", "post"]) {
    await t.test(failure, async () => {
      const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      let current = Object.freeze({ generation: 1, transport: transportSnapshot("connected", false, 0), canonicalCommitted: true, localPromptPending: false });
      const snapshots = new Set(), completions = new Set();
      let lineage = null;
      const claim = { lineage: 1, failedCalls: 0, accepted() {}, failed() { this.failedCalls += 1; lineage = null; }, settled() {} };
      const binding = {
        getSnapshot: () => current,
        getPromptLineage: () => lineage,
        subscribe(listener) { snapshots.add(listener); listener(current); return () => snapshots.delete(listener); },
        subscribeEffects() { return () => {}; },
        subscribeCompletions(listener) { completions.add(listener); return () => completions.delete(listener); },
        waitUntilAttached: async () => { if (failure === "attach") throw new Error("attach failed"); },
        beginPromptClaim() { lineage = claim.lineage; return claim; },
        settlePromptLineage() {},
      };
      const transport = { select: () => binding, beginPrompt: () => ({ binding, claim: binding.beginPromptClaim() }), dispose() {} };
      const posts = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
        if (url.startsWith("/api/sessions/synthetic?")) return Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [], entryIds: [], thinkingLevel: "off", model: null } });
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/synthetic" && init.method === "POST") {
          posts.push(init.body);
          return failure === "post" ? Response.json({}, { status: 500 }) : Response.json({});
        }
        if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
        throw new Error(`unexpected ${url}`);
      };
      let latest = null;
      function Consumer() {
        latest = useAgentSession({
          session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
          sessionViewBinding: binding, sessionViewTransport: transport, newScreenGeneration: 1, newSessionCwd: null,
        });
        return React.createElement("span", null, "hook");
      }
      try {
        const root = createRoot(dom.container);
        await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); await Promise.resolve(); });
        const image = { data: "synthetic-image", mimeType: "image/png", previewUrl: "blob:synthetic" };
        let accepted;
        const previousConsoleError = console.error;
        console.error = () => {};
        try {
          await React.act(async () => { accepted = await latest.handleSend("restore me", [image]); });
        } finally {
          console.error = previousConsoleError;
        }
        assert.equal(accepted, false, "ChatInput retains unchanged submitted composer when hook rejects");
        assert.equal(latest.messages.length, 0, "optimistic text/image bubble rolls back");
        assert.equal(claim.failedCalls, 1);
        assert.equal(posts.length, failure === "post" ? 1 : 0);
        await React.act(async () => root.unmount());
      } finally {
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      }
    });
  }
});

test("mounted failed prompt response preserves a canonically covered exact lineage", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  registry.handles.get("synthetic").publish(transportSnapshot("connected", false, 0));
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic?")) return Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [], entryIds: [], thinkingLevel: "off", model: null } });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      registry.handles.get("synthetic").publish(transportSnapshot("connected", true, 1));
      return Response.json({}, { status: 500 });
    }
    if (url === "/api/agent/synthetic") return Response.json({ running: true, state: { isStreaming: true, isPromptRunning: true, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({ session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }, sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null });
    return React.createElement("span", null, "hook");
  }
  try {
    const root = createRoot(dom.container);
    await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); await Promise.resolve(); });
    let accepted;
    await React.act(async () => { accepted = await latest.handleSend("covered"); });
    assert.equal(accepted, true, "covered ambiguous failure is accepted by the composer lineage");
    assert.equal(latest.messages.length, 1, "optimistic bubble remains");
    assert.equal(latest.agentRunning, true, "canonical activity remains authoritative");
    assert.equal(latest.notices.length, 0, "covered failure does not fabricate a send error");
    await React.act(async () => root.unmount());
    views.dispose();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted initial HTTP seeds standalone compaction before canonical commit while prior-epoch recovery stays projected-authoritative", async (t) => {
  for (const mode of ["initial", "prior"]) {
    await t.test(mode, async () => {
      const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const base = transportSnapshot("recovering", false, mode === "initial" ? 0 : 5);
      const projectedTransport = Object.freeze({ ...base,
        streamEpoch: mode === "initial" ? null : "prior",
        state: Object.freeze({ ...base.state,
          queue: Object.freeze({ steering: Object.freeze(["projected"]), followUp: Object.freeze([]) }),
          statuses: Object.freeze([
            { key: "projected", text: "yes" },
            { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" },
          ]),
        }),
      });
      let view = Object.freeze({ generation: 1, transport: projectedTransport, canonicalCommitted: mode === "prior", localPromptPending: false });
      const viewListeners = new Set();
      const binding = {
        getSnapshot: () => view, getPromptLineage: () => null,
        subscribe(listener) { viewListeners.add(listener); listener(view); return () => viewListeners.delete(listener); }, subscribeEffects() { return () => {}; }, subscribeCompletions() { return () => {}; },
        waitUntilAttached: async () => {}, beginPromptClaim() { throw new Error("unused"); }, settlePromptLineage() {},
        publish(next) { view = next; for (const listener of [...viewListeners]) listener(next); },
      };
      const transport = { select: () => binding, beginPrompt() { throw new Error("unused"); }, dispose() {} };
      const requests = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        requests.push(url);
        if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: true, state: {
          isStreaming: false, isPromptRunning: false, isCompacting: true,
          queuedMessages: { steering: ["http"], followUp: ["retry"] },
          extensionStatuses: [
            { key: "http", text: "seed" },
            { key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unavailable" },
          ], extensionWidgets: [{ key: "http-widget", lines: ["seed"], placement: "belowEditor" }],
        } });
        if (url.startsWith("/api/sessions/synthetic?")) return Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [], entryIds: [], thinkingLevel: "off", model: null } });
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json([]);
        throw new Error(`unexpected ${url}`);
      };
      let latest = null;
      function Consumer() {
        latest = useAgentSession({ session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }, sessionViewBinding: binding, sessionViewTransport: transport, newScreenGeneration: 1, newSessionCwd: null });
        return React.createElement("span", null, "hook");
      }
      try {
        const root = createRoot(dom.container);
        await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); await Promise.resolve(); });
        if (mode === "initial") {
          for (let attempt = 0; attempt < 20 && !latest.isCompacting; attempt += 1) {
            await React.act(async () => new Promise((resolve) => setTimeout(resolve, 1)));
          }
          assert.equal(latest.isCompacting, true, JSON.stringify({ requests, queue: latest.queuedMessages, statuses: latest.extensionStatuses }));
          assert.deepEqual(latest.queuedMessages, { steering: ["http"], followUp: ["retry"] });
          assert.deepEqual(latest.extensionStatuses, [{ key: "http", text: "seed" }]);
          assert.equal(latest.openAiFastModeState, "unavailable");
          assert.equal(latest.extensionWidgets[0].key, "http-widget");
          const laterRecovering = Object.freeze({
            generation: 1,
            transport: Object.freeze({ ...projectedTransport, revision: projectedTransport.revision + 1 }),
            canonicalCommitted: false,
            localPromptPending: false,
          });
          await React.act(async () => binding.publish(laterRecovering));
          assert.equal(latest.isCompacting, true, "later pre-commit transport publication cannot erase HTTP live seed");
          assert.deepEqual(latest.queuedMessages, { steering: ["http"], followUp: ["retry"] });
          const committed = transportSnapshot("connected", false, 1);
          await React.act(async () => binding.publish(Object.freeze({
            generation: 1,
            transport: Object.freeze({ ...committed, state: Object.freeze({
              ...committed.state,
              queue: Object.freeze({ steering: Object.freeze(["canonical"]), followUp: Object.freeze([]) }),
              statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "off" }]),
            }) }),
            canonicalCommitted: true,
            localPromptPending: false,
          })));
          assert.equal(latest.isCompacting, false, "exact canonical commit supersedes the HTTP seed");
          assert.deepEqual(latest.queuedMessages, { steering: ["canonical"], followUp: [] });
          assert.equal(latest.openAiFastModeState, "off");
          const exactReplay = Object.freeze({
            generation: 1,
            transport: Object.freeze({ ...committed, connectionState: "recovering", revision: committed.revision + 1, state: Object.freeze({
              ...committed.state,
              queue: Object.freeze({ steering: Object.freeze(["canonical"]), followUp: Object.freeze([]) }),
              statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "off" }]),
            }) }),
            canonicalCommitted: true,
            localPromptPending: false,
          });
          await React.act(async () => binding.publish(exactReplay));
          assert.deepEqual(latest.queuedMessages, { steering: ["canonical"], followUp: [] }, "mounted exact replay retains committed canonical view during reconnect");
          assert.equal(latest.openAiFastModeState, "off", "reconnect replay retains wrapper-owned Fast state without a new probe");
          const recovered = transportSnapshot("connected", false, 2);
          await React.act(async () => binding.publish(Object.freeze({
            generation: 1,
            transport: Object.freeze({ ...recovered, readyOutcome: "wrong_epoch", state: Object.freeze({
              ...recovered.state,
              queue: Object.freeze({ steering: Object.freeze(["recovered"]), followUp: Object.freeze([]) }),
              statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "unknown" }]),
            }) }),
            canonicalCommitted: true,
            localPromptPending: false,
          })));
          assert.deepEqual(latest.queuedMessages, { steering: ["recovered"], followUp: [] }, "mounted snapshot recovery atomically replaces the committed view");
          assert.equal(latest.openAiFastModeState, "unknown");
        } else {
          assert.equal(latest.isCompacting, false, "prior canonical state wins over HTTP standalone compaction fallback");
          assert.deepEqual(latest.queuedMessages, { steering: ["projected"], followUp: [] });
          assert.deepEqual(latest.extensionStatuses, [{ key: "projected", text: "yes" }]);
          assert.equal(latest.openAiFastModeState, "effective");
        }
        await React.act(async () => root.unmount());
      } finally {
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      }
    });
  }
});

test("mounted new-ID flow atomically claim-acquires, attaches, posts, and reports same-binding promotion", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const order = [];
  let current = Object.freeze({ generation: 7, transport: transportSnapshot("connected", false, 0), canonicalCommitted: true, localPromptPending: false });
  const snapshots = new Set(), effects = new Set(), completions = new Set();
  let lineage = null;
  const claim = { lineage: 41, accepted() { order.push("accepted"); }, failed() { order.push("failed"); lineage = null; }, settled() {} };
  const binding = {
    getSnapshot: () => current, getPromptLineage: () => lineage,
    subscribe(listener) { order.push("snapshot-subscribed"); snapshots.add(listener); listener(current); return () => snapshots.delete(listener); },
    subscribeEffects(listener) { order.push("effect-subscribed"); effects.add(listener); return () => effects.delete(listener); },
    subscribeCompletions(listener) { completions.add(listener); return () => completions.delete(listener); },
    waitUntilAttached: async () => { order.push("attached"); },
    beginPromptClaim() { order.push("claim"); lineage = claim.lineage; return claim; }, settlePromptLineage() {},
  };
  const transport = {
    select() { throw new Error("new materialization must not select before AppShell adoption"); },
    prepareSelection(id) { order.push(`prepare:${id}`); return binding; },
    activate(candidate, ownership) { assert.strictEqual(candidate, binding); order.push(`activate:${ownership}`); },
    beginPrompt(id) { order.push(`begin:${id}`); lineage = claim.lineage; return { binding, claim }; }, dispose() {},
  };
  let ensureBody = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [{ id: "model", name: "Model", provider: "provider" }], defaultModel: { provider: "provider", modelId: "model" } });
    if (url === "/api/agent/new") { ensureBody = JSON.parse(init.body); order.push("ensure-id"); return Response.json({ sessionId: "materialized" }); }
    if (url === "/api/agent/materialized" && init.method === "POST") { order.push("prompt-post"); return Response.json({}); }
    throw new Error(`unexpected ${url}`);
  };
  let latest = null, promotion = null;
  function Consumer() {
    latest = useAgentSession({
      session: null, sessionViewBinding: null, sessionViewTransport: transport, newScreenGeneration: 9, newSessionCwd: "/synthetic",
      onSessionCreated: (session, generation, promotedBinding) => { promotion = { session, generation, promotedBinding }; order.push("promoted"); },
    });
    return React.createElement("span", null, "new-hook");
  }
  try {
    const root = createRoot(dom.container);
    await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    let accepted;
    await React.act(async () => { accepted = await latest.handleSend("new prompt"); });
    assert.equal(accepted, true);
    assert.deepEqual(order.filter((item) => ["ensure-id", "prepare:materialized", "claim", "effect-subscribed", "snapshot-subscribed", "activate:visible", "attached", "prompt-post", "accepted", "promoted"].includes(item)),
      ["ensure-id", "prepare:materialized", "claim", "effect-subscribed", "snapshot-subscribed", "activate:visible", "attached", "prompt-post", "accepted", "promoted"]);
    assert.equal(promotion.generation, 9);
    assert.strictEqual(promotion.promotedBinding, binding);
    assert.equal(ensureBody.provider, "provider");
    assert.equal(ensureBody.modelId, "model");
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted current-new covered HTTP failure promotes once while stale coverage refreshes without stealing selection or URL", async (t) => {
  for (const stale of [false, true]) {
    await t.test(stale ? "stale" : "current", async () => {
      const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const registry = new Registry();
      registry.initialSnapshot = transportSnapshot("connected", false, 0);
      const views = new SessionViewTransport(registry);
      let screenGeneration = 9;
      let resolvePost, markPostStarted;
      const postStarted = new Promise((resolve) => { markPostStarted = resolve; });
      const postResponse = new Promise((resolve) => { resolvePost = resolve; });
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/new") return Response.json({ sessionId: "materialized" });
        if (url === "/api/agent/materialized" && init.method === "POST") {
          markPostStarted();
          return postResponse;
        }
        if (url === "/api/agent/materialized") return Response.json({ running: true, state: { isStreaming: true, isPromptRunning: true, isCompacting: false } });
        throw new Error(`unexpected ${url}`);
      };
      let latest = null, selected = null, url = "/", refreshes = 0, moveToNewerScreen = null;
      function PromptChild({ onCreated }) {
        latest = useAgentSession({
          session: null,
          sessionViewBinding: null,
          sessionViewTransport: views,
          newScreenGeneration: 9,
          isNewScreenCurrent: (generation) => generation === screenGeneration,
          newSessionCwd: "/synthetic",
          onSessionCreated: onCreated,
        });
        return React.createElement("span", null, "new");
      }
      function ShellHarness() {
        const [selectedState, setSelectedState] = React.useState(null);
        selected = selectedState;
        const onCreated = React.useCallback((session, generation, binding) => {
          refreshes += 1;
          if (generation !== screenGeneration) return;
          views.activate(binding, "visible");
          url = `/?session=${session.id}`;
          setSelectedState(session.id);
        }, []);
        moveToNewerScreen = () => {
          screenGeneration = 10;
          const b = views.prepareSelection("newer-B");
          b.subscribe(() => {});
          b.subscribeEffects(() => {});
          views.activate(b, "visible");
          url = "/?session=newer-B";
          setSelectedState("newer-B");
        };
        return selectedState === null
          ? React.createElement(PromptChild, { onCreated })
          : React.createElement("span", null, selectedState);
      }
      try {
        const root = createRoot(dom.container);
        await React.act(async () => { root.render(React.createElement(ShellHarness)); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
        let sendPromise;
        await React.act(async () => { sendPromise = latest.handleSend("covered new"); await postStarted; });
        if (stale) await React.act(async () => moveToNewerScreen());
        await React.act(async () => registry.handles.get("materialized").publish(transportSnapshot("connected", true, 1)));
        let accepted;
        await React.act(async () => { resolvePost(Response.json({}, { status: 500 })); accepted = await sendPromise; });
        assert.equal(accepted, true, "ordered canonical activity covers the ambiguous HTTP failure");
        assert.equal(refreshes, 1, "covered success boundary reports materialization exactly once");
        assert.equal(latest.messages.length, 1, "optimistic bubble and run lineage remain");
        if (stale) {
          assert.equal(selected, "newer-B");
          assert.equal(url, "/?session=newer-B", "stale covered result cannot steal selection or URL");
        } else {
          assert.equal(selected, "materialized");
          assert.equal(url, "/?session=materialized", "current covered result crosses the AppShell adoption boundary");
        }
        await React.act(async () => root.unmount());
        views.dispose();
      } finally {
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      }
    });
  }
});

test("mounted pre-acceptance idle reconciliation cannot cover a definitive prompt POST failure", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  registry.handles.get("synthetic").publish(transportSnapshot("connected", false, 0));
  let completions = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic?")) return Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [], entryIds: [], thinkingLevel: "off", model: null } });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const lineage = binding.getPromptLineage();
      assert.notEqual(lineage, null);
      binding.settlePromptLineage(lineage);
      return Response.json({}, { status: 500 });
    }
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding,
      sessionViewTransport: views,
      newScreenGeneration: 1,
      newSessionCwd: null,
      onAgentEnd: () => { completions += 1; },
    });
    return React.createElement("span", null, "hook");
  }
  try {
    const root = createRoot(dom.container);
    await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); await Promise.resolve(); });
    let accepted;
    await React.act(async () => { accepted = await latest.handleSend("definitive"); });
    assert.equal(accepted, false);
    assert.equal(latest.messages.length, 0, "optimistic message rolls back after definitive rejection");
    assert.equal(latest.agentRunning, false);
    assert.equal(completions, 0, "pre-acceptance idle produces no false completion");
    await React.act(async () => root.unmount());
    views.dispose();
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted A to B to A preserves page lineage once, while hidden settlement emits no completion", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  const views = new SessionViewTransport(registry);
  let serverBusy = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const match = url.match(/^\/api\/sessions\/([^/?]+)/);
    const id = match?.[1] ?? "A";
    if (url.includes("/state")) return Response.json({ running: serverBusy, state: { isStreaming: serverBusy, isPromptRunning: false, isCompacting: false } });
    if (url.startsWith("/api/sessions/")) return Response.json({ sessionId: id, filePath: "", tree: [], leafId: null, context: { messages: [], entryIds: [], thinkingLevel: "off", model: null } });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url.startsWith("/api/agent/") && init.method === "POST") { serverBusy = true; return Response.json({}); }
    if (url.startsWith("/api/agent/")) return Response.json({ running: serverBusy, state: { isStreaming: serverBusy, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null, completions = 0;
  const session = (id) => ({ id, path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" });
  function Consumer({ id, binding, mountKey }) {
    latest = useAgentSession({ session: session(id), sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null, onAgentEnd: () => { completions += 1; } });
    return React.createElement("span", { key: mountKey }, id);
  }
  const root = createRoot(dom.container);
  try {
    const a = views.prepareSelection("A");
    await React.act(async () => {
      root.render(React.createElement(Consumer, { key: "A1", id: "A", binding: a, mountKey: "A1" }));
      await Promise.resolve();
    });
    await React.act(async () => registry.handles.get("A").publish(transportSnapshotWithState("connected", false, 0, {
      statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "effective" }]),
    })));
    assert.equal(latest.openAiFastModeState, "effective");
    await React.act(async () => { await latest.handleSend("/remote-command"); });
    const b = views.prepareSelection("B");
    await React.act(async () => root.render(React.createElement(Consumer, { key: "B", id: "B", binding: b, mountKey: "B" })));
    const acquireB = registry.handles.has("B");
    assert.equal(acquireB, true, "B activates only after its mounted hook consumers exist");
    const acquireBIndex = registry.operations.findIndex((entry) => entry[0] === "acquire" && entry[1] === "B");
    const hideAIndex = registry.operations.findIndex((entry, index) => index > acquireBIndex
      && entry[0] === "ownership" && entry[1] === "A" && entry[2] === "retained_hidden");
    assert.ok(acquireBIndex >= 0 && hideAIndex > acquireBIndex, "B raw ownership precedes every A ownership change");
    const operations = registry.handles;
    await React.act(async () => {
      registry.handles.get("B").publish(transportSnapshotWithState("connected", false, 1, {
        statuses: Object.freeze([{ key: PI_WEB_OPENAI_FAST_MODE_STATUS_KEY, text: "off" }]),
      }));
      registry.handles.get("B").effect({ streamEpoch: "epoch", sequence: 1, effect: { type: "notice", level: "info", message: "edge" } });
    });
    assert.equal(latest.notices.at(-1)?.message, "edge", "transient effect at the acquisition/mount edge reaches selected B");
    assert.equal(latest.openAiFastModeState, "off", "selected B never inherits A's Fast state");
    assert.ok(operations.has("A") && operations.has("B"));
    const aAgain = views.prepareSelection("A");
    assert.strictEqual(aAgain, a);
    await React.act(async () => root.render(React.createElement(Consumer, { key: "A2", id: "A", binding: aAgain, mountKey: "A2" })));
    assert.equal(latest.agentPhase?.kind, "running_command", "page-stable slash classification survives keyed remount");
    assert.equal(latest.openAiFastModeState, "effective", "reselected A restores only A's projected Fast state");
    await React.act(async () => registry.handles.get("A").publish(transportSnapshot("connected", true, 1)));
    assert.equal(latest.agentPhase?.kind, "waiting_model", "ordered canonical prompt activity supersedes command waiting classification");
    serverBusy = false;
    await React.act(async () => registry.handles.get("A").publish(transportSnapshot("connected", false, 2)));
    assert.equal(completions, 1, "reselected A receives its one page-lineage completion");
    await React.act(async () => registry.handles.get("A").publish(transportSnapshot("connected", false, 3)));
    assert.equal(completions, 1, "duplicate inactive/remount state cannot notify again");

    await React.act(async () => { await latest.handleSend("second"); });
    await React.act(async () => {
      registry.handles.get("A").publish(transportSnapshot("connected", true, 4));
    });
    const bAgain = views.prepareSelection("B");
    await React.act(async () => root.render(React.createElement(Consumer, { key: "B2", id: "B", binding: bAgain, mountKey: "B2" })));
    serverBusy = false;
    await React.act(async () => registry.handles.get("A").publish(transportSnapshot("connected", false, 5)));
    assert.equal(completions, 1, "hidden settlement is suppressed and cannot play sound/refresh through hook callback");
  } finally {
    await React.act(async () => root.unmount());
    views.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted slow transcript and leaf responses cannot erase a newer optimistic run or branch", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const current = Object.freeze({ generation: 1, transport: transportSnapshot("connected", false, 0), canonicalCommitted: true, localPromptPending: false });
  let lineage = null;
  const claim = { lineage: 1, accepted() {}, failed() { lineage = null; }, settled() {} };
  const binding = {
    getSnapshot: () => current, getPromptLineage: () => lineage,
    subscribe(listener) { listener(current); return () => {}; }, subscribeEffects() { return () => {}; }, subscribeCompletions() { return () => {}; },
    waitUntilAttached: async () => {}, beginPromptClaim() { lineage = claim.lineage; return claim; }, settlePromptLineage() {},
  };
  const transport = { select: () => binding, beginPrompt: () => ({ binding, claim }), dispose() {} };
  let transcriptRequest = 0, resolveStaleTranscript, resolveFinalTranscript, resolveOldLeaf;
  const staleTranscript = new Promise((resolve) => { resolveStaleTranscript = resolve; });
  const finalTranscript = new Promise((resolve) => { resolveFinalTranscript = resolve; });
  const oldLeaf = new Promise((resolve) => { resolveOldLeaf = resolve; });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/context?")) {
      if (url.includes("leafId=old-leaf")) return oldLeaf;
      return Response.json({ context: { messages: [{ role: "user", content: "new branch" }], entryIds: ["new-entry"] } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      transcriptRequest += 1;
      if (transcriptRequest === 1) return staleTranscript;
      if (transcriptRequest === 2) return finalTranscript;
      return Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [{ role: "user", content: "optimistic" }], entryIds: ["final"], thinkingLevel: "off", model: null } });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({});
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({ session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }, sessionViewBinding: binding, sessionViewTransport: transport, newScreenGeneration: 1, newSessionCwd: null });
    return React.createElement("span", null, "hook");
  }
  try {
    const root = createRoot(dom.container);
    await React.act(async () => { root.render(React.createElement(Consumer)); await Promise.resolve(); });
    await React.act(async () => { await latest.handleSend("optimistic"); });
    assert.equal(latest.messages.at(-1).content, "optimistic");
    await React.act(async () => {
      resolveStaleTranscript(Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [{ role: "user", content: "stale" }], entryIds: ["stale"], thinkingLevel: "off", model: null } }));
      await Promise.resolve(); await Promise.resolve();
    });
    assert.equal(latest.messages.at(-1).content, "optimistic", "stale initial response cannot erase optimistic UI before cursor advance");
    await React.act(async () => {
      resolveFinalTranscript(Response.json({ sessionId: "synthetic", filePath: "", tree: [], leafId: null, context: { messages: [{ role: "user", content: "optimistic" }], entryIds: ["final"], thinkingLevel: "off", model: null } }));
      await Promise.resolve(); await Promise.resolve();
    });

    let oldNavigation;
    await React.act(async () => {
      oldNavigation = latest.handleNavigate("old-leaf");
      await Promise.resolve();
      await latest.handleNavigate("new-leaf");
    });
    assert.equal(latest.messages.at(-1).content, "new branch");
    await React.act(async () => {
      resolveOldLeaf(Response.json({ context: { messages: [{ role: "user", content: "old branch" }], entryIds: ["old-entry"] } }));
      await oldNavigation;
    });
    assert.equal(latest.messages.at(-1).content, "new branch", "superseded leaf response cannot overwrite current branch");
    await React.act(async () => root.unmount());
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted live-tip transcript repair follows advancing non-null leaves with and without completion effects", async (t) => {
  for (const scenario of [
    { name: "prior tip with live completion", intermediateUserTip: false, deliverCompletion: true },
    { name: "user tip with effect-less recovery", intermediateUserTip: true, deliverCompletion: false },
  ]) {
    await t.test(scenario.name, async () => {
      const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const registry = new Registry();
      registry.initialSnapshot = transportSnapshot("connected", false, 0);
      const views = new SessionViewTransport(registry);
      const binding = views.select("synthetic");
      const baselineMessages = [
        { role: "user", content: "baseline" },
        { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "baseline answer" }] },
      ];
      const completedMessages = [
        ...baselineMessages,
        { role: "user", content: "advance" },
        { role: "assistant", model: "m", provider: "p", content: [{ type: "toolCall", toolCallId: "call", toolName: "tool", input: {} }] },
        { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "result" }] },
        { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "final answer" }] },
      ];
      let transcript = { leafId: "prior-tip", messages: baselineMessages, entryIds: ["baseline-user", "prior-tip"] };
      let rootRequests = 0;
      const contextRequests = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
        if (url.startsWith("/api/sessions/synthetic/context?")) {
          contextRequests.push(url);
          return Response.json({ context: { messages: baselineMessages, entryIds: ["baseline-user", "prior-tip"] } });
        }
        if (url.startsWith("/api/sessions/synthetic?")) {
          rootRequests += 1;
          return Response.json({
            sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
            context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
          });
        }
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({ success: true, data: {} });
        if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
        throw new Error(`unexpected ${url}`);
      };
      let latest = null;
      function Consumer() {
        latest = useAgentSession({
          session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
          sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
        });
        return React.createElement("span", null, "hook");
      }
      const root = createRoot(dom.container);
      try {
        await React.act(async () => root.render(React.createElement(Consumer)));
        await flushMountedWork();
        assert.equal(latest.activeLeafId, "prior-tip");
        await React.act(async () => { assert.equal(await latest.handleSend("advance"), true); });
        assert.equal(latest.messages.at(-1).content, "advance");

        const handle = registry.handles.get("synthetic");
        if (scenario.intermediateUserTip) {
          transcript = {
            leafId: "user-tip",
            messages: [...baselineMessages, { role: "user", content: "advance" }],
            entryIds: ["baseline-user", "prior-tip", "user-tip"],
          };
          await React.act(async () => handle.publish(transportSnapshotWithState("connected", true, 2, {
            transcriptRevision: 1,
            transcriptRefreshRequired: true,
          })));
          await flushMountedWork();
          assert.equal(latest.activeLeafId, "user-tip", "a persisted user entry becomes the displayed live tip");
          assert.equal(latest.messages.at(-1).content, "advance");
        } else {
          await React.act(async () => handle.publish(transportSnapshot("connected", true, 2)));
        }

        if (scenario.deliverCompletion) {
          await React.act(async () => {
            handle.effect({ streamEpoch: "epoch", sequence: 1, effect: { type: "message_completed", message: { role: "user", content: "advance" } } });
            handle.effect({ streamEpoch: "epoch", sequence: 2, effect: { type: "message_completed", message: { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "final answer" }] } } });
          });
          assert.equal(latest.messages.at(-1).content[0].text, "final answer", "projected completion remains immediate");
        }

        transcript = {
          leafId: "assistant-tip",
          messages: completedMessages,
          entryIds: ["baseline-user", "prior-tip", "user-tip", "tool-call", "tool-result", "assistant-tip"],
        };
        const settled = scenario.deliverCompletion
          ? transportSnapshotWithState("connected", false, 3, { transcriptRevision: 2, transcriptRefreshRequired: true })
          : transportSnapshotWithState("recovering", false, 3, { transcriptRevision: 2, transcriptRefreshRequired: true }, { streamEpoch: "recovered" });
        await React.act(async () => handle.publish(settled));
        await flushMountedWork();
        await flushMountedWork();

        assert.equal(latest.activeLeafId, "assistant-tip");
        assert.deepEqual(latest.messages, completedMessages);
        assert.deepEqual(latest.entryIds, transcript.entryIds);
        assert.equal(contextRequests.length, 0, "ordinary live-tip repair never falls back to prior-leaf context");
        const minimumRootRequests = scenario.intermediateUserTip ? 3 : 2;
        assert.ok(rootRequests >= minimumRootRequests && rootRequests <= minimumRootRequests + 1,
          `bounded live-tip repair count: ${rootRequests}`);
      } finally {
        await React.act(async () => root.unmount());
        views.dispose();
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      }
    });
  }
});

test("mounted new-session user tip remains live until effect-less assistant settlement", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  registry.initialSnapshot = transportSnapshot("connected", false, 0);
  const views = new SessionViewTransport(registry);
  const userMessages = [{ role: "user", content: "first prompt" }];
  const completedMessages = [
    ...userMessages,
    { role: "assistant", model: "m", provider: "p", content: [{ type: "toolCall", toolCallId: "first-call", toolName: "tool", input: {} }] },
    { role: "toolResult", toolCallId: "first-call", content: [{ type: "text", text: "first result" }] },
    { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "first answer" }] },
  ];
  let transcript = { leafId: "user-tip", messages: userMessages, entryIds: ["user-tip"] };
  let rootRequests = 0;
  const contextRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/new") return Response.json({ sessionId: "materialized" });
    if (url.startsWith("/api/sessions/materialized/context?")) {
      contextRequests.push(url);
      return Response.json({ context: { messages: userMessages, entryIds: ["user-tip"] } });
    }
    if (url.startsWith("/api/sessions/materialized?")) {
      rootRequests += 1;
      return Response.json({
        sessionId: "materialized", filePath: "", tree: [], leafId: transcript.leafId,
        context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
      });
    }
    if (url === "/api/agent/materialized" && init.method === "POST") return Response.json({ success: true, data: {} });
    if (url === "/api/agent/materialized") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  let promotions = 0;
  function Consumer() {
    latest = useAgentSession({
      session: null, sessionViewBinding: null, sessionViewTransport: views,
      newScreenGeneration: 1, newSessionCwd: "/synthetic",
      onSessionCreated: () => { promotions += 1; },
    });
    return React.createElement("span", null, "new-hook");
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Consumer)));
    await flushMountedWork();
    await React.act(async () => { assert.equal(await latest.handleSend("first prompt"), true); });
    const handle = registry.handles.get("materialized");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", true, 1, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();
    assert.equal(latest.activeLeafId, "user-tip");
    assert.deepEqual(latest.messages, userMessages);

    transcript = { leafId: "assistant-tip", messages: completedMessages, entryIds: ["user-tip", "tool-call", "tool-result", "assistant-tip"] };
    await React.act(async () => handle.publish(transportSnapshotWithState("recovering", false, 2, {
      transcriptRevision: 2,
      transcriptRefreshRequired: true,
    }, { streamEpoch: "recovered" })));
    await flushMountedWork();
    await flushMountedWork();

    assert.equal(latest.activeLeafId, "assistant-tip");
    assert.deepEqual(latest.messages, completedMessages);
    assert.deepEqual(latest.entryIds, transcript.entryIds);
    assert.equal(contextRequests.length, 0);
    assert.ok(rootRequests >= 2 && rootRequests <= 3, `bounded settlement repair count: ${rootRequests}`);
    const settledRootRequests = rootRequests;
    await React.act(async () => {
      dom.window.dispatchEvent({ type: "online", bubbles: false });
      dom.window.dispatchEvent({ type: "online", bubbles: false });
    });
    await flushMountedWork();
    assert.equal(rootRequests, settledRootRequests, "quiescent sticky markers do not loop on recovery triggers");
    assert.equal(promotions, 1);
  } finally {
    await React.act(async () => root.unmount());
    views.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted queued root and ancestor context repairs re-evaluate explicit pin intent when they run", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  registry.initialSnapshot = transportSnapshot("connected", false, 0);
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  const latestMessages = [{ role: "user", content: "latest" }];
  const ancestorMessages = [{ role: "user", content: "ancestor" }];
  const descendantMessages = [
    ...ancestorMessages,
    { role: "user", content: "branch prompt" },
    { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "descendant" }] },
  ];
  let transcript = { leafId: "latest-tip", messages: latestMessages, entryIds: ["latest-tip"] };
  let rootRequests = 0;
  const contextRequests = [];
  let deferContext = false;
  let resolveDeferredContext;
  const deferredContext = new Promise((resolve) => { resolveDeferredContext = resolve; });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) {
      contextRequests.push(url);
      if (deferContext) {
        deferContext = false;
        return deferredContext;
      }
      return Response.json({ context: { messages: ancestorMessages, entryIds: ["ancestor"] } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      rootRequests += 1;
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
        context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({ success: true, data: {} });
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
    });
    return React.createElement("span", null, "hook");
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Consumer)));
    await flushMountedWork();
    assert.equal(latest.activeLeafId, "latest-tip");

    const handle = registry.handles.get("synthetic");
    await React.act(async () => {
      handle.publish(transportSnapshotWithState("connected", false, 1, {
        transcriptRevision: 1,
        transcriptRefreshRequired: true,
      }));
      await latest.handleNavigate("ancestor");
    });
    await flushMountedWork();
    assert.equal(rootRequests, 1, "a queued live-root repair reroutes to the pin instead of issuing a stale root request");
    assert.equal(latest.activeLeafId, "ancestor");
    assert.deepEqual(latest.messages, ancestorMessages);

    deferContext = true;
    let oldContextNavigation;
    await React.act(async () => {
      oldContextNavigation = latest.handleNavigate("ancestor");
      await Promise.resolve();
    });
    await React.act(async () => { assert.equal(await latest.handleSend("branch prompt"), true); });
    transcript = { leafId: "descendant-tip", messages: descendantMessages, entryIds: ["ancestor", "branch-user", "descendant-tip"] };
    await React.act(async () => registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 2, {
      transcriptRevision: 2,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();
    assert.equal(latest.activeLeafId, "descendant-tip", "live root repair is not blocked by an older in-flight context request");

    await React.act(async () => {
      resolveDeferredContext(Response.json({ context: { messages: ancestorMessages, entryIds: ["ancestor"] } }));
      await oldContextNavigation;
    });
    await flushMountedWork();
    await flushMountedWork();

    assert.equal(latest.activeLeafId, "descendant-tip");
    assert.deepEqual(latest.messages, descendantMessages);
    assert.deepEqual(latest.entryIds, transcript.entryIds);
    assert.equal(contextRequests.length, 2, "the pre-prompt ancestor request is rejected rather than retried after pin release");
    assert.ok(rootRequests >= 2 && rootRequests <= 3, `bounded live-root convergence count: ${rootRequests}`);
  } finally {
    await React.act(async () => root.unmount());
    views.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted post-prompt stale root keeps the optimistic exchange until a current live transcript covers it", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  registry.initialSnapshot = transportSnapshot("connected", false, 0);
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  const baselineMessages = [{ role: "user", content: "baseline" }];
  const completedMessages = [
    ...baselineMessages,
    { role: "user", content: "advance" },
    { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "answer" }] },
  ];
  let transcript = { leafId: "baseline-tip", messages: baselineMessages, entryIds: ["baseline-tip"] };
  let rootRequests = 0;
  let deferNextRoot = false;
  let resolveDeferredRoot;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic?")) {
      rootRequests += 1;
      if (deferNextRoot) {
        deferNextRoot = false;
        return new Promise((resolve) => { resolveDeferredRoot = resolve; });
      }
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
        context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({ success: true, data: {} });
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
    });
    return React.createElement("span", null, "hook");
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Consumer)));
    await flushMountedWork();
    await React.act(async () => { assert.equal(await latest.handleSend("advance"), true); });

    deferNextRoot = true;
    const handle = registry.handles.get("synthetic");
    await React.act(async () => handle.publish(transportSnapshotWithState("connected", true, 1, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();
    assert.equal(rootRequests, 2, "the stale request starts after the prompt generation");

    await React.act(async () => {
      resolveDeferredRoot(Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: "baseline-tip",
        context: { messages: baselineMessages, entryIds: ["baseline-tip"], thinkingLevel: "off", model: null },
      }));
    });
    await flushMountedWork();
    assert.equal(latest.activeLeafId, "baseline-tip");
    assert.equal(latest.messages.at(-1).content, "advance", "a current-token response still must contain the current prompt");

    transcript = { leafId: "assistant-tip", messages: completedMessages, entryIds: ["baseline-tip", "advance-tip", "assistant-tip"] };
    await React.act(async () => dom.window.dispatchEvent({ type: "online", bubbles: false }));
    await flushMountedWork();
    assert.equal(latest.activeLeafId, "assistant-tip");
    assert.deepEqual(latest.messages, completedMessages);
    assert.equal(rootRequests, 4, "urgent recovery plus one settlement refresh replace the delayed stale-response retry without looping");
  } finally {
    await React.act(async () => root.unmount());
    views.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted prompt POST failure is covered by an accepted HTTP transcript without projected activity", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  registry.initialSnapshot = transportSnapshot("connected", false, 0);
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  const ancestorMessages = [{ role: "user", content: "ancestor" }];
  const descendantMessages = [
    ...ancestorMessages,
    { role: "user", content: "persisted prompt" },
    { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "persisted answer" }] },
  ];
  let transcript = { leafId: "root-tip", messages: [{ role: "user", content: "root" }], entryIds: ["root-tip"] };
  let resolvePromptResponse;
  let markPromptStarted;
  const promptStarted = new Promise((resolve) => { markPromptStarted = resolve; });
  const promptResponse = new Promise((resolve) => { resolvePromptResponse = resolve; });
  const contextRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) {
      contextRequests.push(url);
      return Response.json({ context: { messages: ancestorMessages, entryIds: ["ancestor"] } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) return Response.json({
      sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
      context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
    });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
      if (command.type === "prompt") {
        markPromptStarted();
        return promptResponse;
      }
      return Response.json({ success: true, data: {} });
    }
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
    });
    return React.createElement("span", null, "hook");
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Consumer)));
    await flushMountedWork();
    await React.act(async () => { await latest.handleNavigate("ancestor"); });

    let sendPromise;
    await React.act(async () => {
      sendPromise = latest.handleSend("persisted prompt");
      await promptStarted;
    });
    transcript = { leafId: "descendant-tip", messages: descendantMessages, entryIds: ["ancestor", "prompt-tip", "descendant-tip"] };
    await React.act(async () => registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 1, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();
    assert.equal(latest.activeLeafId, "descendant-tip");
    assert.deepEqual(latest.messages, descendantMessages);

    let accepted;
    await React.act(async () => {
      resolvePromptResponse(Response.json({}, { status: 500 }));
      accepted = await sendPromise;
    });
    assert.equal(accepted, true, "the persisted prompt proves execution despite the lost POST response");
    assert.equal(latest.activeLeafId, "descendant-tip");
    assert.deepEqual(latest.messages, descendantMessages);
    assert.equal(contextRequests.length, 1, "failure coverage does not restore the ancestor pin");

    await React.act(async () => dom.window.dispatchEvent({ type: "online", bubbles: false }));
    await flushMountedWork();
    assert.equal(latest.agentRunning, false, "idle runtime recovery settles the accepted HTTP-covered lineage");
  } finally {
    await React.act(async () => root.unmount());
    views.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted urgent live repair cancels a delayed pinned-context retry", async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const delayedRepairs = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 250) {
      const timer = { delayedRepair: true, callback, args, cancelled: false };
      delayedRepairs.push(timer);
      return timer;
    }
    return previous.setTimeout(callback, delay, ...args);
  };
  globalThis.clearTimeout = (timer) => {
    if (timer?.delayedRepair) timer.cancelled = true;
    else previous.clearTimeout(timer);
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const registry = new Registry();
  registry.initialSnapshot = transportSnapshot("connected", false, 0);
  const views = new SessionViewTransport(registry);
  const binding = views.select("synthetic");
  const liveMessages = [{ role: "user", content: "live" }];
  const descendantMessages = [
    { role: "user", content: "ancestor" },
    { role: "user", content: "branch prompt" },
    { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "branch answer" }] },
  ];
  let transcript = { leafId: "live-tip", messages: liveMessages, entryIds: ["live-tip"] };
  let contextRequests = 0;
  let rootRequests = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) {
      contextRequests += 1;
      return Response.json({}, { status: 503 });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      rootRequests += 1;
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
        context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({ success: true, data: {} });
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  };
  let latest = null;
  function Consumer() {
    latest = useAgentSession({
      session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
      sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
    });
    return React.createElement("span", null, "hook");
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Consumer)));
    await flushMountedWork();
    await React.act(async () => { await latest.handleNavigate("ancestor"); });
    assert.equal(contextRequests, 1);
    assert.equal(delayedRepairs.length, 1, "failed context repair installs one delayed retry");
    assert.equal(delayedRepairs[0].cancelled, false);

    await React.act(async () => { assert.equal(await latest.handleSend("branch prompt"), true); });
    transcript = { leafId: "descendant-tip", messages: descendantMessages, entryIds: ["ancestor", "prompt-tip", "descendant-tip"] };
    await React.act(async () => registry.handles.get("synthetic").publish(transportSnapshotWithState("recovering", false, 1, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
    }, { streamEpoch: "recovered" })));
    await flushMountedWork();

    assert.equal(delayedRepairs[0].cancelled, true, "the old context backoff cannot suppress urgent live convergence");
    assert.equal(contextRequests, 1, "the cancelled context timer never executes");
    assert.equal(rootRequests, 3, "the immediate live root and one settlement refresh run without advancing the delayed timer");
    assert.equal(latest.activeLeafId, "descendant-tip");
    assert.deepEqual(latest.messages, descendantMessages);
  } finally {
    await React.act(async () => root.unmount());
    views.dispose();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch;
    globalThis.setTimeout = previous.setTimeout; globalThis.clearTimeout = previous.clearTimeout; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("mounted prompt waits for native leaf navigation and current cancellation or error restores live intent", async (t) => {
  for (const mode of ["success", "cancelled", "error"]) {
    await t.test(mode, async () => {
      const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const registry = new Registry();
      registry.initialSnapshot = transportSnapshot("connected", false, 0);
      const views = new SessionViewTransport(registry);
      const binding = views.select("synthetic");
      const liveMessages = [{ role: "user", content: "live" }];
      const ancestorMessages = [{ role: "user", content: "ancestor" }];
      let resolveNavigation;
      let markNavigationStarted;
      const navigationStarted = new Promise((resolve) => { markNavigationStarted = resolve; });
      const navigationResponse = new Promise((resolve) => { resolveNavigation = resolve; });
      let promptRequests = 0;
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
        if (url.startsWith("/api/sessions/synthetic/context?")) return Response.json({ context: { messages: ancestorMessages, entryIds: ["ancestor"] } });
        if (url.startsWith("/api/sessions/synthetic?")) return Response.json({
          sessionId: "synthetic", filePath: "", tree: [], leafId: "live-tip",
          context: { messages: liveMessages, entryIds: ["live-tip"], thinkingLevel: "off", model: null },
        });
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/synthetic" && init.method === "POST") {
          const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
          if (command.type === "navigate_tree") {
            markNavigationStarted();
            return navigationResponse;
          }
          if (command.type === "prompt") promptRequests += 1;
          return Response.json({ success: true, data: {} });
        }
        if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
        throw new Error(`unexpected ${url}`);
      };
      let latest = null;
      function Consumer() {
        latest = useAgentSession({
          session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
          sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
        });
        return React.createElement("span", null, "hook");
      }
      const root = createRoot(dom.container);
      try {
        await React.act(async () => root.render(React.createElement(Consumer)));
        await flushMountedWork();
        let navigationPromise;
        await React.act(async () => {
          navigationPromise = latest.handleNavigate("ancestor");
          await navigationStarted;
        });
        let sendPromise;
        await React.act(async () => {
          sendPromise = latest.handleSend("branch prompt");
          await Promise.resolve();
        });
        assert.equal(promptRequests, 0, "the prompt cannot overtake native navigation");

        let sendAccepted;
        await React.act(async () => {
          resolveNavigation(mode === "success"
            ? Response.json({ success: true, data: {} })
            : mode === "cancelled"
              ? Response.json({ success: true, data: { cancelled: true } })
              : Response.json({ error: "navigation failed" }, { status: 500 }));
          await navigationPromise;
          sendAccepted = await sendPromise;
        });
        await flushMountedWork();

        assert.equal(sendAccepted, mode === "success");
        assert.equal(promptRequests, mode === "success" ? 1 : 0);
        if (mode === "success") {
          assert.equal(latest.activeLeafId, "ancestor");
          assert.equal(latest.messages.at(-1).content, "branch prompt");
        } else {
          assert.equal(latest.activeLeafId, "live-tip");
          assert.deepEqual(latest.messages, liveMessages);
        }
      } finally {
        await React.act(async () => root.unmount());
        views.dispose();
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      }
    });
  }
});

test("mounted rapid native navigations serialize before the following prompt", async () => {
  const contexts = {
    first: [{ role: "user", content: "first branch" }],
    second: [{ role: "user", content: "second branch" }],
  };
  const navigationTargets = [];
  const navigationResolvers = [];
  let promptRequests = 0;
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) {
      const leafId = new URL(url, "http://synthetic").searchParams.get("leafId");
      return Response.json({ context: { messages: contexts[leafId], entryIds: [leafId] } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) return Response.json({
      sessionId: "synthetic", filePath: "", tree: [], leafId: "live-tip",
      context: { messages: [{ role: "user", content: "live" }], entryIds: ["live-tip"], thinkingLevel: "off", model: null },
    });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
      if (command.type === "navigate_tree") {
        navigationTargets.push(command.targetId);
        return new Promise((resolve) => navigationResolvers.push(resolve));
      }
      if (command.type === "prompt") promptRequests += 1;
      return Response.json({ success: true, data: {} });
    }
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  });
  try {
    let firstNavigation;
    await React.act(async () => {
      firstNavigation = mounted.latest().handleNavigate("first");
      await Promise.resolve();
    });
    let secondNavigation;
    await React.act(async () => {
      secondNavigation = mounted.latest().handleNavigate("second");
      await Promise.resolve();
    });
    let sendPromise;
    await React.act(async () => {
      sendPromise = mounted.latest().handleSend("branch prompt");
      await Promise.resolve();
    });
    assert.deepEqual(navigationTargets, ["first"], "the second native navigation is queued behind the first");
    assert.equal(promptRequests, 0);

    await React.act(async () => {
      navigationResolvers[0](Response.json({ success: true, data: {} }));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepEqual(navigationTargets, ["first", "second"]);
    assert.equal(promptRequests, 0, "the prompt still waits for the latest requested branch");

    let accepted;
    await React.act(async () => {
      navigationResolvers[1](Response.json({ success: true, data: {} }));
      await firstNavigation;
      await secondNavigation;
      accepted = await sendPromise;
    });
    assert.equal(accepted, true);
    assert.equal(promptRequests, 1);
    assert.equal(mounted.latest().activeLeafId, "second");
    assert.equal(mounted.latest().messages.at(-1).content, "branch prompt");
  } finally {
    await mounted.cleanup();
  }
});

test("mounted identical prompt after selecting a user entry requires a distinct native sibling", async () => {
  const baseUser = { role: "user", content: "base" };
  const baseAssistant = { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "base answer" }] };
  const selectedUser = { role: "user", content: "replacement" };
  const oldAssistant = { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "old answer" }] };
  const tree = [{
    entry: { type: "message", id: "base-user", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: baseUser },
    children: [{
      entry: { type: "message", id: "base-assistant", parentId: "base-user", timestamp: "2026-01-01T00:00:01Z", message: baseAssistant },
      children: [{
        entry: { type: "message", id: "selected-user", parentId: "base-assistant", timestamp: "2026-01-01T00:00:02Z", message: selectedUser },
        children: [{
          entry: { type: "message", id: "old-assistant", parentId: "selected-user", timestamp: "2026-01-01T00:00:03Z", message: oldAssistant },
          children: [],
        }],
      }],
    }],
  }];
  let transcript = {
    leafId: "old-assistant",
    messages: [baseUser, baseAssistant, selectedUser, oldAssistant],
    entryIds: ["base-user", "base-assistant", "selected-user", "old-assistant"],
  };
  let resolvePromptResponse;
  let markPromptStarted;
  let promptRequests = 0;
  const promptStarted = new Promise((resolve) => { markPromptStarted = resolve; });
  const promptResponse = new Promise((resolve) => { resolvePromptResponse = resolve; });
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) return Response.json({
      context: { messages: [baseUser, baseAssistant, selectedUser], entryIds: ["base-user", "base-assistant", "selected-user"] },
    });
    if (url.startsWith("/api/sessions/synthetic?")) return Response.json({
      sessionId: "synthetic", filePath: "", tree, leafId: transcript.leafId,
      context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
    });
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") {
      const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
      if (command.type === "prompt") {
        promptRequests += 1;
        if (promptRequests === 1) {
          markPromptStarted();
          return promptResponse;
        }
      }
      return Response.json({ success: true, data: {} });
    }
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  });
  try {
    await React.act(async () => { await mounted.latest().handleNavigate("selected-user"); });
    let sendPromise;
    await React.act(async () => {
      sendPromise = mounted.latest().handleSend("replacement");
      await promptStarted;
    });
    await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 1, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();
    assert.equal(mounted.latest().messages.at(-1).role, "user", "the old identical entry cannot cover the optimistic replacement");

    await React.act(async () => {
      resolvePromptResponse(Response.json({}, { status: 500 }));
      assert.equal(await sendPromise, false, "the old entry cannot convert a failed POST into acceptance");
    });
    await flushMountedWork();
    assert.equal(mounted.latest().activeLeafId, "selected-user");
    await React.act(async () => { assert.equal(await mounted.latest().handleSend("replacement"), true); });
    const replacementAssistant = { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "replacement answer" }] };
    transcript = {
      leafId: "replacement-assistant",
      messages: [baseUser, baseAssistant, { role: "user", content: "replacement" }, replacementAssistant],
      entryIds: ["base-user", "base-assistant", "replacement-user", "replacement-assistant"],
    };
    await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 2, {
      transcriptRevision: 2,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();

    assert.equal(mounted.latest().activeLeafId, "replacement-assistant");
    assert.deepEqual(mounted.latest().messages, transcript.messages);
    assert.ok(!mounted.latest().entryIds.includes("selected-user"), "the replacement is a sibling of the selected user entry");
  } finally {
    await mounted.cleanup();
  }
});

test("mounted successful projected and built-in compaction retire the exact prompt floor", async (t) => {
  for (const mode of ["projected", "builtin"]) {
    await t.test(mode, async () => {
      const baseline = [{ role: "user", content: "baseline" }];
      const persistedPrompt = [...baseline, { role: "user", content: "compact me" }];
      const compacted = [
        { role: "custom", customType: "compaction", content: "summary", display: true },
        { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "retained suffix" }] },
      ];
      let transcript = { leafId: "baseline-tip", messages: baseline, entryIds: ["baseline-tip"] };
      const mounted = await mountExistingSessionHook(async (input, init = {}) => {
        const url = String(input);
        if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
        if (url.startsWith("/api/sessions/synthetic?")) return Response.json({
          sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
          context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
        });
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/synthetic" && init.method === "POST") {
          const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
          if (command.type === "compact") {
            transcript = { leafId: "compaction-tip", messages: compacted, entryIds: ["compaction-tip", "retained-assistant"] };
            return Response.json({ success: true, data: { tokensBefore: 10, estimatedTokensAfter: 5 } });
          }
          return Response.json({ success: true, data: {} });
        }
        if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
        throw new Error(`unexpected ${url}`);
      });
      try {
        await React.act(async () => { assert.equal(await mounted.latest().handleSend("compact me"), true); });
        transcript = { leafId: "prompt-tip", messages: persistedPrompt, entryIds: ["baseline-tip", "prompt-tip"] };
        await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", true, 1, {
          transcriptRevision: 1,
          transcriptRefreshRequired: true,
        })));
        await flushMountedWork();
        assert.deepEqual(mounted.latest().messages, persistedPrompt, "the prompt floor is established before compaction");

        if (mode === "projected") {
          await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", true, 2, {
            transcriptRevision: 1,
            transcriptRefreshRequired: true,
            compaction: { active: true, reason: "threshold" },
          })));
          transcript = { leafId: "compaction-tip", messages: compacted, entryIds: ["compaction-tip", "retained-assistant"] };
          await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 3, {
            transcriptRevision: 2,
            transcriptRefreshRequired: true,
            compaction: { active: false, reason: "threshold", tokensBefore: 10, estimatedTokensAfter: 5 },
          })));
          await flushMountedWork();
          await flushMountedWork();
        } else {
          let result;
          await React.act(async () => { result = await mounted.latest().handleBuiltinSlashCommand("/compact"); });
          assert.equal(result.handled, true);
        }

        assert.equal(mounted.latest().activeLeafId, "compaction-tip");
        assert.deepEqual(mounted.latest().messages, compacted, "summary-only compaction converges without the exact user prompt");
      } finally {
        await mounted.cleanup();
      }
    });
  }
});

test("mounted recovery clone of an older completed compaction preserves the later prompt floor", async () => {
  const baseline = [{ role: "user", content: "baseline" }];
  const completed = [
    ...baseline,
    { role: "user", content: "later prompt" },
    { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "later answer" }] },
  ];
  let transcript = { leafId: "baseline-tip", messages: baseline, entryIds: ["baseline-tip"] };
  let rootRequests = 0;
  const oldCompaction = { active: false, reason: "threshold", tokensBefore: 40, estimatedTokensAfter: 20 };
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic?")) {
      rootRequests += 1;
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
        context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({ success: true, data: {} });
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  });
  try {
    await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 1, {
      compaction: oldCompaction,
    })));
    await React.act(async () => { assert.equal(await mounted.latest().handleSend("later prompt"), true); });

    await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("recovering", false, 2, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
      compaction: { ...oldCompaction },
    }, { streamEpoch: "recovered" })));
    await flushMountedWork();
    await flushMountedWork();
    assert.equal(mounted.latest().messages.at(-1).content, "later prompt", "semantic cloning of old compaction state cannot expose the stale root");

    transcript = { leafId: "later-assistant", messages: completed, entryIds: ["baseline-tip", "later-user", "later-assistant"] };
    await React.act(async () => mounted.dom.window.dispatchEvent({ type: "online", bubbles: false }));
    await flushMountedWork();
    await flushMountedWork();
    assert.equal(mounted.latest().activeLeafId, "later-assistant");
    assert.deepEqual(mounted.latest().messages, completed);
    assert.ok(rootRequests >= 3 && rootRequests <= 5, `bounded stale-compaction recovery count: ${rootRequests}`);
  } finally {
    await mounted.cleanup();
  }
});

test("mounted extension slash command preserves an explicit historical pin", async () => {
  const latestMessages = [{ role: "user", content: "latest" }];
  const ancestorMessages = [{ role: "user", content: "ancestor" }];
  let rootRequests = 0;
  let contextRequests = 0;
  const mounted = await mountExistingSessionHook(async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
    if (url.startsWith("/api/sessions/synthetic/context?")) {
      contextRequests += 1;
      return Response.json({ context: { messages: ancestorMessages, entryIds: ["ancestor"] } });
    }
    if (url.startsWith("/api/sessions/synthetic?")) {
      rootRequests += 1;
      return Response.json({
        sessionId: "synthetic", filePath: "", tree: [], leafId: "latest-tip",
        context: { messages: latestMessages, entryIds: ["latest-tip"], thinkingLevel: "off", model: null },
      });
    }
    if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
    if (url === "/api/agent/synthetic" && init.method === "POST") return Response.json({ success: true, data: {} });
    if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
    throw new Error(`unexpected ${url}`);
  });
  try {
    await React.act(async () => { await mounted.latest().handleNavigate("ancestor"); });
    await React.act(async () => { assert.equal(await mounted.latest().handleSend("/extension-command"), true); });
    await React.act(async () => mounted.registry.handles.get("synthetic").publish(transportSnapshotWithState("connected", false, 1, {
      transcriptRevision: 1,
      transcriptRefreshRequired: true,
    })));
    await flushMountedWork();

    assert.equal(mounted.latest().activeLeafId, "ancestor");
    assert.deepEqual(mounted.latest().messages, ancestorMessages);
    assert.equal(rootRequests, 1, "command settlement cannot switch pinned context to the live root");
    assert.ok(contextRequests >= 2 && contextRequests <= 3, `bounded pinned repair count: ${contextRequests}`);
  } finally {
    await mounted.cleanup();
  }
});

test("mounted prompt failure restores only the current prior pin while navigation and canonical coverage win", async (t) => {
  for (const mode of ["restore", "later-navigation", "covered"]) {
    await t.test(mode, async () => {
      const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      const registry = new Registry();
      registry.initialSnapshot = transportSnapshot("connected", false, 0);
      const views = new SessionViewTransport(registry);
      const binding = views.select("synthetic");
      const rootMessages = [{ role: "user", content: "root" }];
      const ancestorMessages = [{ role: "user", content: "ancestor" }];
      const laterMessages = [{ role: "user", content: "later" }];
      const descendantMessages = [
        ...ancestorMessages,
        { role: "user", content: "pending" },
        { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "covered descendant" }] },
      ];
      let transcript = { leafId: "root-tip", messages: rootMessages, entryIds: ["root-tip"] };
      let rootRequests = 0;
      const contextRequests = [];
      let resolvePromptResponse;
      let markPromptStarted;
      const promptStarted = new Promise((resolve) => { markPromptStarted = resolve; });
      const promptResponse = new Promise((resolve) => { resolvePromptResponse = resolve; });
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.startsWith("/api/sessions/synthetic/state")) return Response.json({ running: false });
        if (url.startsWith("/api/sessions/synthetic/context?")) {
          const leafId = new URL(url, "http://synthetic").searchParams.get("leafId");
          contextRequests.push(leafId);
          const messages = leafId === "later" ? laterMessages : ancestorMessages;
          return Response.json({ context: { messages, entryIds: [leafId] } });
        }
        if (url.startsWith("/api/sessions/synthetic?")) {
          rootRequests += 1;
          return Response.json({
            sessionId: "synthetic", filePath: "", tree: [], leafId: transcript.leafId,
            context: { messages: transcript.messages, entryIds: transcript.entryIds, thinkingLevel: "off", model: null },
          });
        }
        if (url.startsWith("/api/models")) return Response.json({ models: {}, modelList: [], defaultModel: null });
        if (url === "/api/agent/synthetic" && init.method === "POST") {
          const command = typeof init.body === "string" ? JSON.parse(init.body) : {};
          if (command.type === "prompt") {
            markPromptStarted();
            return promptResponse;
          }
          return Response.json({ success: true, data: {} });
        }
        if (url === "/api/agent/synthetic") return Response.json({ running: false, state: { isStreaming: false, isPromptRunning: false, isCompacting: false } });
        throw new Error(`unexpected ${url}`);
      };
      let latest = null;
      function Consumer() {
        latest = useAgentSession({
          session: { id: "synthetic", path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" },
          sessionViewBinding: binding, sessionViewTransport: views, newScreenGeneration: 1, newSessionCwd: null,
        });
        return React.createElement("span", null, "hook");
      }
      const root = createRoot(dom.container);
      try {
        await React.act(async () => root.render(React.createElement(Consumer)));
        await flushMountedWork();
        await React.act(async () => { await latest.handleNavigate("ancestor"); });
        assert.equal(latest.activeLeafId, "ancestor");

        let sendPromise;
        await React.act(async () => {
          sendPromise = latest.handleSend("pending");
          await promptStarted;
        });
        const handle = registry.handles.get("synthetic");
        if (mode === "restore") {
          transcript = { leafId: "other-live-tip", messages: rootMessages, entryIds: ["other-live-tip"] };
          await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
            transcriptRevision: 1,
            transcriptRefreshRequired: true,
          })));
          await flushMountedWork();
          assert.equal(latest.activeLeafId, "ancestor", "a current root transcript that omits the prompt cannot replace the optimistic branch");
          assert.equal(latest.messages.at(-1).content, "pending", "the optimistic prompt remains visible until execution is decided");
        } else if (mode === "later-navigation") {
          await React.act(async () => { await latest.handleNavigate("later"); });
          assert.equal(latest.activeLeafId, "later");
        } else {
          transcript = { leafId: "covered-tip", messages: descendantMessages, entryIds: ["ancestor", "pending", "covered-tip"] };
          await React.act(async () => handle.publish(transportSnapshot("connected", true, 1)));
        }

        let accepted;
        await React.act(async () => {
          resolvePromptResponse(Response.json({}, { status: 500 }));
          accepted = await sendPromise;
        });
        assert.equal(accepted, mode === "covered");

        if (mode === "covered") {
          await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 2, {
            transcriptRevision: 1,
            transcriptRefreshRequired: true,
          })));
          await flushMountedWork();
          await flushMountedWork();
          assert.equal(latest.activeLeafId, "covered-tip", "canonical coverage keeps descendant-following mode after an ambiguous POST failure");
          assert.deepEqual(latest.messages, descendantMessages);
          assert.deepEqual(contextRequests, ["ancestor"]);
          assert.equal(rootRequests, 2);
        } else if (mode === "restore") {
          await flushMountedWork();
          assert.equal(latest.activeLeafId, "ancestor");
          assert.deepEqual(latest.messages, ancestorMessages);
          assert.deepEqual(contextRequests, ["ancestor", "ancestor"]);
        } else {
          transcript = { leafId: "new-root", messages: rootMessages, entryIds: ["new-root"] };
          await React.act(async () => handle.publish(transportSnapshotWithState("connected", false, 1, {
            transcriptRevision: 1,
            transcriptRefreshRequired: true,
          })));
          await flushMountedWork();
          assert.equal(latest.activeLeafId, "later", "navigation after prompt start prevents restoration of the older pin");
          assert.deepEqual(latest.messages, laterMessages);
          assert.equal(rootRequests, 1, "background transcript repair remains routed to the later explicit pin");
          assert.deepEqual(contextRequests, ["ancestor", "later", "later"]);
        }
      } finally {
        await React.act(async () => root.unmount());
        views.dispose();
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.fetch = previous.fetch; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      }
    });
  }
});

test("actual mounted ChatInput keeps definitive failure and clears canonically covered acceptance", async (t) => {
  for (const outcome of [false, true]) {
    await t.test(outcome ? "covered" : "failure", async () => {
      const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
      let resolveSend;
      const sendResult = new Promise((resolve) => { resolveSend = resolve; });
      const submissions = [];
      const inputRef = React.createRef();
      const root = createRoot(dom.container);
      try {
        await React.act(async () => root.render(React.createElement(ChatInput, {
          ref: inputRef,
          onSend: async (message, images) => { submissions.push({ message, images }); return sendResult; },
          onAbort() {}, isStreaming: false,
        })));
        const textarea = findElement(dom.container, (node) => node.nodeName === "TEXTAREA");
        const send = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
        assert.ok(textarea && send, "mounted composer controls exist");
        await React.act(async () => inputRef.current.insertText("preserve-or-clear"));
        assert.equal(textarea.value, "preserve-or-clear");
        await React.act(async () => send.click());
        assert.equal(submissions.length, 1);
        assert.equal(textarea.value, "", "pending submitted state is detached from the live queue editor");
        await React.act(async () => { resolveSend(outcome); await sendResult; await Promise.resolve(); });
        assert.equal(textarea.value, outcome ? "" : "preserve-or-clear");
      } finally {
        await React.act(async () => root.unmount());
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act; globalThis.requestAnimationFrame = previous.requestAnimationFrame;
      }
    });
  }
});

test("actual mounted ChatInput preserves submitted text, image, and stored draft after definitive rejection", async () => {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    FileReader: globalThis.FileReader,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  globalThis.FileReader = class {
    readAsDataURL() {
      this.result = "data:image/png;base64,c3ludGhldGlj";
      queueMicrotask(() => this.onload?.());
    }
  };
  URL.createObjectURL = () => "blob:synthetic-mounted";
  URL.revokeObjectURL = () => {};
  const draftKey = "mounted-definitive-image";
  clearDraft(draftKey);
  const submissions = [];
  const inputRef = React.createRef();
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(ChatInput, {
      ref: inputRef,
      draftKey,
      onSend: async (message, images) => { submissions.push({ message, images }); return false; },
      onAbort() {},
      isStreaming: false,
    })));
    await React.act(async () => {
      inputRef.current.insertText("keep with image");
      inputRef.current.addImages([{ type: "image/png" }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    const send = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
    assert.ok(send);
    await React.act(async () => send.click());
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].message, "keep with image");
    assert.equal(submissions[0].images.length, 1);
    assert.equal(submissions[0].images[0].data, "c3ludGhldGlj");
    const textarea = findElement(dom.container, (node) => node.nodeName === "TEXTAREA");
    assert.equal(textarea.value, "keep with image");
    assert.deepEqual(getDraft(draftKey), {
      value: "keep with image",
      images: [{ data: "c3ludGhldGlj", mimeType: "image/png" }],
    });
    const sendAgain = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
    await React.act(async () => sendAgain.click());
    assert.equal(submissions[1].images.length, 1, "a second submission proves the mounted image state was retained");
  } finally {
    await React.act(async () => root.unmount());
    clearDraft(draftKey);
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.FileReader = previous.FileReader;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("mounted pending prompt leaves only fresh text available to steer or follow-up", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  let resolveSend;
  const pending = new Promise((resolve) => { resolveSend = resolve; });
  const ordinary = [], steered = [], followed = [];
  const inputRef = React.createRef();
  function Harness() {
    const [streaming, setStreaming] = React.useState(false);
    return React.createElement(ChatInput, {
      ref: inputRef,
      isStreaming: streaming,
      onAbort() {},
      onSteer: (message) => steered.push(message),
      onFollowUp: (message) => followed.push(message),
      async onSend(message) {
        ordinary.push(message);
        setStreaming(true);
        const result = await pending;
        setStreaming(false);
        return result;
      },
    });
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    await React.act(async () => inputRef.current.insertText("initial prompt"));
    const send = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
    await React.act(async () => { send.click(); await Promise.resolve(); });
    const textarea = findElement(dom.container, (node) => node.nodeName === "TEXTAREA");
    assert.equal(textarea.value, "", "the submitted prompt is not queueable while acceptance is pending");
    const emptySteer = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Steer"));
    const emptyFollow = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Follow-up"));
    await React.act(async () => { emptySteer.click(); emptyFollow.click(); });
    assert.deepEqual(steered, []);
    assert.deepEqual(followed, []);

    await React.act(async () => inputRef.current.insertText("fresh follow-up"));
    const steer = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Steer"));
    await React.act(async () => steer.click());
    assert.deepEqual(ordinary, ["initial prompt"]);
    assert.deepEqual(steered, ["fresh follow-up"]);
    assert.deepEqual(followed, []);
    assert.equal(textarea.value, "");
    await React.act(async () => { resolveSend(true); await pending; await Promise.resolve(); });
  } finally {
    await React.act(async () => root.unmount());
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act; globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  }
});

test("mounted new-ID promotion migrates a newer pending composer and draft to the real key", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT, requestAnimationFrame: globalThis.requestAnimationFrame };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  const blankKey = "new:/synthetic-promotion", realKey = "synthetic-real-session";
  clearDraft(blankKey); clearDraft(realKey);
  let resolveSend, promote;
  const pending = new Promise((resolve) => { resolveSend = resolve; });
  const inputRef = React.createRef();
  function Harness() {
    const [streaming, setStreaming] = React.useState(false);
    const [draftKey, setDraftKey] = React.useState(blankKey);
    promote = () => setDraftKey(realKey);
    return React.createElement(ChatInput, {
      ref: inputRef, draftKey, isStreaming: streaming, onAbort() {},
      onSteer() {}, onFollowUp() {},
      async onSend() { setStreaming(true); const result = await pending; setStreaming(false); return result; },
    });
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    await React.act(async () => inputRef.current.insertText("submitted old state"));
    const send = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
    await React.act(async () => { send.click(); await Promise.resolve(); });
    await React.act(async () => inputRef.current.insertText("newer follow-up draft"));
    assert.deepEqual(getDraft(blankKey), { value: "newer follow-up draft", images: [] });
    await React.act(async () => { promote(); await Promise.resolve(); });
    const textarea = findElement(dom.container, (node) => node.nodeName === "TEXTAREA");
    assert.equal(textarea.value, "newer follow-up draft");
    assert.equal(getDraft(blankKey), null);
    assert.deepEqual(getDraft(realKey), { value: "newer follow-up draft", images: [] });
    await React.act(async () => { resolveSend(true); await pending; await Promise.resolve(); });
    assert.equal(textarea.value, "newer follow-up draft", "acceptance clears only the detached submitted state");
    assert.deepEqual(getDraft(realKey), { value: "newer follow-up draft", images: [] });
  } finally {
    await React.act(async () => root.unmount());
    clearDraft(blankKey); clearDraft(realKey);
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act; globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  }
});

test("mounted definitive failure restores submitted image state and prepends it to a newer edit", async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    requestAnimationFrame: globalThis.requestAnimationFrame, FileReader: globalThis.FileReader,
    createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  globalThis.FileReader = class { readAsDataURL() { this.result = "data:image/png;base64,c3VibWl0dGVk"; queueMicrotask(() => this.onload?.()); } };
  URL.createObjectURL = () => "blob:pending-failure";
  const revoked = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  const draftKey = "mounted-pending-failure";
  clearDraft(draftKey);
  let resolveSend;
  const pending = new Promise((resolve) => { resolveSend = resolve; });
  const inputRef = React.createRef();
  function Harness() {
    const [streaming, setStreaming] = React.useState(false);
    return React.createElement(ChatInput, {
      ref: inputRef, draftKey, isStreaming: streaming, onAbort() {}, onSteer() {}, onFollowUp() {},
      async onSend() { setStreaming(true); const result = await pending; setStreaming(false); return result; },
    });
  }
  const root = createRoot(dom.container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Harness));
      await Promise.resolve();
    });
    await React.act(async () => {
      inputRef.current.insertText("submitted text");
      inputRef.current.addImages([{ type: "image/png" }]);
      await Promise.resolve(); await Promise.resolve();
    });
    const send = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
    await React.act(async () => { send.click(); await Promise.resolve(); });
    assert.equal(findElement(dom.container, (node) => node.nodeName === "TEXTAREA").value, "");
    assert.equal(getDraft(draftKey), null, "submitted draft is detached while pending");
    assert.deepEqual(revoked, [], "pending submission still owns its preview");
    await React.act(async () => inputRef.current.insertText("newer text"));
    await React.act(async () => { resolveSend(false); await pending; await Promise.resolve(); });
    const textarea = findElement(dom.container, (node) => node.nodeName === "TEXTAREA");
    assert.equal(textarea.value, "submitted text\n\nnewer text");
    assert.deepEqual(getDraft(draftKey), {
      value: "submitted text\n\nnewer text",
      images: [{ data: "c3VibWl0dGVk", mimeType: "image/png" }],
    });
    assert.deepEqual(revoked, [], "failure transfers the submitted preview back to the composer");
    await React.act(async () => root.unmount());
    assert.deepEqual(revoked, ["blob:pending-failure"]);
  } finally {
    clearDraft(draftKey);
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame; globalThis.FileReader = previous.FileReader;
    URL.createObjectURL = previous.createObjectURL; URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("pending success and unmount-late resolution revoke submitted blob previews exactly once", async (t) => {
  for (const mode of ["success", "unmount-failure"]) {
    await t.test(mode, async () => {
      const previous = {
        window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
        requestAnimationFrame: globalThis.requestAnimationFrame, FileReader: globalThis.FileReader,
        createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
      };
      const dom = createMinimalDom();
      globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
      globalThis.FileReader = class { readAsDataURL() { this.result = "data:image/png;base64,cHJldmlldw=="; queueMicrotask(() => this.onload?.()); } };
      const blobUrl = `blob:${mode}`;
      URL.createObjectURL = () => blobUrl;
      const revoked = [];
      URL.revokeObjectURL = (url) => revoked.push(url);
      const draftKey = `mounted-${mode}`;
      clearDraft(draftKey);
      let resolveSend;
      const pending = new Promise((resolve) => { resolveSend = resolve; });
      const inputRef = React.createRef();
      const root = createRoot(dom.container);
      try {
        await React.act(async () => root.render(React.createElement(ChatInput, {
          ref: inputRef, draftKey, isStreaming: false, onAbort() {}, onSend: () => pending,
        })));
        await React.act(async () => {
          inputRef.current.insertText("preview owner");
          inputRef.current.addImages([{ type: "image/png" }]);
          await Promise.resolve(); await Promise.resolve();
        });
        const send = findElement(dom.container, (node) => node.nodeName === "BUTTON" && elementText(node).includes("Send"));
        await React.act(async () => { send.click(); await Promise.resolve(); });
        assert.deepEqual(revoked, []);
        if (mode === "success") {
          await React.act(async () => { resolveSend(true); await pending; await Promise.resolve(); });
          assert.deepEqual(revoked, [blobUrl]);
          await React.act(async () => root.unmount());
          assert.deepEqual(revoked, [blobUrl]);
        } else {
          await React.act(async () => root.unmount());
          assert.deepEqual(revoked, [blobUrl], "unmount releases the detached pending preview");
          resolveSend(false);
          await pending;
          await Promise.resolve();
          assert.deepEqual(revoked, [blobUrl], "late failure cannot revoke or set mounted state twice");
          assert.deepEqual(getDraft(draftKey), {
            value: "preview owner", images: [{ data: "cHJldmlldw==", mimeType: "image/png" }],
          });
        }
      } finally {
        clearDraft(draftKey);
        globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
        globalThis.requestAnimationFrame = previous.requestAnimationFrame; globalThis.FileReader = previous.FileReader;
        URL.createObjectURL = previous.createObjectURL; URL.revokeObjectURL = previous.revokeObjectURL;
      }
    });
  }
});

test("late image decoding after ChatInput unmount revokes the newly created preview without state work", async () => {
  const previous = {
    window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    requestAnimationFrame: globalThis.requestAnimationFrame, FileReader: globalThis.FileReader,
    createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL,
  };
  const dom = createMinimalDom();
  globalThis.window = dom.window; globalThis.document = dom.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  const readers = [];
  globalThis.FileReader = class {
    constructor() { readers.push(this); }
    readAsDataURL() {}
  };
  URL.createObjectURL = () => "blob:late-decoder";
  const revoked = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  const inputRef = React.createRef();
  const root = createRoot(dom.container);
  try {
    await React.act(async () => root.render(React.createElement(ChatInput, {
      ref: inputRef, isStreaming: false, onAbort() {}, onSend: async () => true,
    })));
    inputRef.current.addImages([{ type: "image/png" }]);
    await React.act(async () => root.unmount());
    readers[0].result = "data:image/png;base64,bGF0ZQ==";
    readers[0].onload();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(revoked, ["blob:late-decoder"]);
  } finally {
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame; globalThis.FileReader = previous.FileReader;
    URL.createObjectURL = previous.createObjectURL; URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("source ordering gates prompt on attached binding and stale promotion on new-screen generation", async () => {
  const [hook, shell, routeListing] = await Promise.all([
    source("../hooks/useAgentSession.ts"), source("./AppShell.tsx"),
    readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  const prepare = hook.indexOf("sessionViewTransport.prepareSelection(sid)");
  const claim = hook.indexOf("claim = binding.beginPromptClaim(classification)", prepare);
  const attach = hook.indexOf("attachViewBinding(binding)", claim);
  const activate = hook.indexOf('sessionViewTransport.activate(binding, "visible")', attach);
  const ready = hook.indexOf("await binding.waitUntilAttached()", activate);
  const prompt = hook.indexOf('type: "prompt"', ready);
  assert.ok(prepare < claim && claim < attach && attach < activate && activate < ready && ready < prompt);
  assert.match(shell, /generation !== newScreenGenerationRef\.current/);
  assert.match(shell, /sessionViews\.activate\(binding, "visible"\)/);
  assert.match(shell, /sessionViews\.prepareSelection\(session\.id\)/);
  assert.match(routeListing, /sendAgentCommand|startRpcSession/);
  assert.doesNotMatch(hook, /EventSource|handleAgentEvent|connectEvents|ensureEventsConnected/);
});

test("HTTP polling, visibility, online, commands and branch operations remain transport-neutral", async () => {
  const hook = await source("../hooks/useAgentSession.ts");
  for (const literal of ["AGENT_STATE_RECONCILE_MS", "visibilitychange", 'addEventListener("online"', 'type: "navigate_tree"', 'type: "fork"', 'type: "clone"', 'type: "compact"', 'type: "abort"', 'type: "set_model"', 'type: "set_tools"']) {
    assert.ok(hook.includes(literal), literal);
  }
  assert.match(hook, /SessionHttpReconciliation/);
  assert.match(hook, /promptUiGenerationRef\.current \+= 1/);
  assert.match(hook, /applyProjectedSnapshotRef\.current/);
});
