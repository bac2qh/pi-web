import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const { startPiWebServer } = require("../bin/pi-web-server.js");
const { PI_WEB_TRANSPORT_PATH } = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST: postTicket } = await jiti.import("../app/api/transport/ticket/route.ts");
const { createNewAgentPost } = await jiti.import("../app/api/agent/new/route.ts");
const { POST: postAgent } = await jiti.import("../app/api/agent/[id]/route.ts");
const { AgentSessionWrapper, getOrCreateRpcSession } = await jiti.import("./rpc-manager.ts");
const { SESSION_REGISTRATION_TEST_SYMBOL } = await jiti.import("./session-channel.ts");
const {
  cacheSessionPath,
  invalidateSessionPathCache,
  resolveSessionIdByPath,
  resolveSessionPath,
} = await jiti.import("./session-reader.ts");

function nextFactoryForTicketRoute(options = {}) {
  return () => ({
    async prepare() {},
    getRequestHandler() {
      return async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
          else if (value !== undefined) headers.set(key, value);
        }
        const request = new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers,
          ...(req.method === "GET" || req.method === "HEAD" ? {} : { body, duplex: "half" }),
        });
        let response;
        if (req.url === "/api/transport/ticket" && req.method === "POST") {
          response = await postTicket(request);
        } else if (req.url === "/api/agent/new" && req.method === "POST" && options.newAgentPost) {
          response = await options.newAgentPost(request);
        } else {
          const match = req.url?.match(/^\/api\/agent\/([^/?]+)$/);
          if (match && req.method === "POST" && options.agentPost !== false) {
            response = await postAgent(request, {
              params: Promise.resolve({ id: decodeURIComponent(match[1]) }),
            });
          }
        }
        if (response) {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ method: req.method, bytes: body.byteLength }));
      };
    },
    async close() {},
  });
}

function syntheticAgentSessionWrapper(manager, options = {}) {
  const state = { emit: null, abortCalls: 0, disposeCalls: 0, promptCalls: 0 };
  const inner = {
    get sessionId() { return manager.getSessionId(); },
    get sessionFile() {
      if (typeof options.sessionFile === "function") return options.sessionFile(manager);
      return options.exposeSessionFile === false ? "" : manager.getSessionFile();
    },
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: options.model,
    modelRuntime: {
      getModel(provider, modelId) {
        return options.getModel?.(provider, modelId) ?? { provider, id: modelId };
      },
    },
    pendingMessageCount: 0,
    sessionManager: manager,
    agent: { state: {} },
    extensionRunner: {},
    bindExtensions: options.bindExtensions,
    subscribe(callback) { state.emit = callback; return () => { state.emit = null; }; },
    dispose() { state.disposeCalls += 1; },
    abort: async () => { state.abortCalls += 1; },
    setModel: options.setModel ?? (async () => {}),
    setThinkingLevel: options.setThinkingLevel ?? (() => {}),
    reload: async () => {}, prompt: async (...args) => {
      state.promptCalls += 1;
      options.onPrompt?.(...args);
    }, steer: async () => {}, followUp: async () => {},
    compact: async () => ({}), abortCompaction() {}, getContextUsage: () => undefined,
    getSteeringMessages: () => [], getFollowUpMessages: () => [],
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  return { wrapper, state, emit(event) { state.emit?.(event); } };
}

async function issueChannel(base, origin, body) {
  const response = await fetch(`${base}/api/transport/ticket`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Pi-Web-Transport": "1" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
const issue = (base, origin, id) => issueChannel(base, origin, { channel: "session", sessionId: id });

function rejectedUpgradeStatus(base, origin, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`, { origin });
    socket.once("open", () => { socket.terminate(); reject(new Error("upgrade_unexpectedly_opened")); });
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      response.resume();
      resolve(status);
    });
    socket.once("error", (error) => {
      if (!String(error.message).startsWith("Unexpected server response:")) reject(error);
    });
  });
}

function openRaw(base, origin, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`, { origin });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function open(base, origin, ticket, resume) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(ticket)}`, { origin });
    const frames = [];
    socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
    socket.once("open", () => {
      socket.send(JSON.stringify({
        protocol: "pi-web-session-transport", version: 1, type: "resume",
        streamEpoch: resume?.epoch ?? null, cursor: resume?.cursor ?? null,
      }));
      resolve({ socket, frames });
    });
    socket.once("error", reject);
  });
}

async function waitFor(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label}_timeout`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    socket.once("close", resolve);
    socket.close(1000);
  });
}

function createRouteOwner(t, label, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), `pi-web-new-route-${label}-`));
  const cwd = join(directory, "cwd");
  mkdirSync(cwd);
  const manager = SessionManager.create(cwd, directory);
  const synthetic = syntheticAgentSessionWrapper(manager, {
    exposeSessionFile: false,
    ...options,
  });
  const { wrapper } = synthetic;
  const id = manager.getSessionId();
  globalThis.__piSessions ??= new Map();
  globalThis.__piSessions.set(id, wrapper);
  wrapper.onDestroy(() => {
    if (globalThis.__piSessions?.get(id) === wrapper) globalThis.__piSessions.delete(id);
  });
  const originalDestroy = wrapper.destroy.bind(wrapper);
  let destroyCalls = 0;
  wrapper.destroy = () => {
    destroyCalls += 1;
    originalDestroy();
  };
  t.after(() => {
    if (wrapper.isAlive()) wrapper.destroy();
    globalThis.__piSessions?.delete(id);
    rmSync(directory, { recursive: true, force: true });
  });
  return { ...synthetic, cwd, id, manager, get destroyCalls() { return destroyCalls; } };
}

function createRealPublishedRouteOwner(t, label, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), `pi-web-real-new-route-${label}-`));
  const cwd = join(directory, "cwd");
  mkdirSync(cwd);
  const manager = SessionManager.create(cwd, directory);
  const synthetic = syntheticAgentSessionWrapper(manager, options);
  const { wrapper } = synthetic;
  const id = manager.getSessionId();
  const allocatedFile = manager.getSessionFile();
  const originalDestroy = wrapper.destroy.bind(wrapper);
  let destroyCalls = 0;
  wrapper.destroy = () => {
    destroyCalls += 1;
    originalDestroy();
  };
  t.after(() => {
    if (wrapper.isAlive()) wrapper.destroy();
    globalThis.__piSessions?.delete(id);
    invalidateSessionPathCache(id);
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    ...synthetic,
    allocatedFile,
    cwd,
    id,
    manager,
    startSession(startupKey) {
      return getOrCreateRpcSession(startupKey, async () => ({
        session: wrapper,
        realSessionId: id,
      }));
    },
    get destroyCalls() { return destroyCalls; },
  };
}

function newAgentRequest(cwd, body) {
  return new Request("http://localhost/api/agent/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, ...body }),
  });
}

test("failed ensure cleanup removes both cache directions from real publication exactly once", async (t) => {
  const owner = createRealPublishedRouteOwner(t, "cache-failure");
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:real-cache-failure",
    startSession: owner.startSession,
    allowRoot() {
      assert.equal(globalThis.__piSessionPathCache?.get(owner.id), owner.allocatedFile);
      assert.equal(globalThis.__piPathToSessionIdCache?.get(owner.allocatedFile), owner.id);
      throw new Error("allow_failed");
    },
    invalidateSessions() {},
  });

  const response = await post(newAgentRequest(owner.cwd, { type: "ensure_session" }));
  assert.equal(response.status, 500);
  assert.equal(owner.destroyCalls, 1, "the published owner is destroyed exactly once");
  assert.equal(owner.state.disposeCalls, 1, "native disposal remains exact once");
  assert.equal(owner.wrapper.isAlive(), false);
  assert.notStrictEqual(globalThis.__piSessions?.get(owner.id), owner.wrapper);
  assert.equal(globalThis.__piSessionPathCache?.has(owner.id), false);
  assert.equal(globalThis.__piPathToSessionIdCache?.has(owner.allocatedFile), false);
});

test("failed ensure cleanup preserves a replacement reverse-cache owner", async (t) => {
  const owner = createRealPublishedRouteOwner(t, "cache-replacement");
  const replacementId = `${owner.id}-replacement`;
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:real-cache-replacement",
    startSession: owner.startSession,
    allowRoot() {
      cacheSessionPath(replacementId, owner.allocatedFile);
      throw new Error("allow_failed");
    },
    invalidateSessions() {},
  });
  t.after(() => invalidateSessionPathCache(replacementId));

  const response = await post(newAgentRequest(owner.cwd, { type: "ensure_session" }));
  assert.equal(response.status, 500);
  assert.equal(owner.destroyCalls, 1);
  assert.equal(globalThis.__piSessionPathCache?.has(owner.id), false);
  assert.equal(globalThis.__piSessionPathCache?.get(replacementId), owner.allocatedFile);
  assert.equal(globalThis.__piPathToSessionIdCache?.get(owner.allocatedFile), replacementId);
});

test("failed ensure cleanup preserves a real-published same-ID replacement and its cache pair", async (t) => {
  let rejectModelSetup;
  let markModelSetupStarted;
  const modelSetupStarted = new Promise((resolve) => { markModelSetupStarted = resolve; });
  const modelSetup = new Promise((_, reject) => { rejectModelSetup = reject; });
  const owner = createRealPublishedRouteOwner(t, "cache-same-id-replacement", {
    setModel() {
      markModelSetupStarted();
      return modelSetup;
    },
  });
  const replacementDirectory = mkdtempSync(join(tmpdir(), "pi-web-real-new-route-cache-same-id-current-"));
  const replacementFile = join(replacementDirectory, "replacement.jsonl");
  writeFileSync(replacementFile, `${JSON.stringify({
    type: "session",
    version: 3,
    id: owner.id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: owner.cwd,
  })}\n`);
  const replacementManager = SessionManager.open(replacementFile, replacementDirectory);
  const replacement = syntheticAgentSessionWrapper(replacementManager);
  t.after(() => {
    if (replacement.wrapper.isAlive()) replacement.wrapper.destroy();
    if (globalThis.__piSessions?.get(owner.id) === replacement.wrapper) {
      globalThis.__piSessions.delete(owner.id);
    }
    invalidateSessionPathCache(owner.id);
    rmSync(replacementDirectory, { recursive: true, force: true });
  });

  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:real-cache-same-id-old",
    startSession: owner.startSession,
    allowRoot() {},
    invalidateSessions() {},
  });
  const responsePromise = post(newAgentRequest(owner.cwd, {
    type: "ensure_session",
    provider: "synthetic",
    modelId: "synthetic-model",
  }));
  await modelSetupStarted;

  const replacementPublication = await getOrCreateRpcSession(
    "__pi_web_new_request__:real-cache-same-id-current",
    async () => ({ session: replacement.wrapper, realSessionId: owner.id }),
  );
  assert.strictEqual(replacementPublication.session, replacement.wrapper);
  assert.strictEqual(globalThis.__piSessions?.get(owner.id), replacement.wrapper);
  assert.equal(globalThis.__piSessionPathCache?.get(owner.id), replacementFile);
  assert.equal(globalThis.__piPathToSessionIdCache?.get(replacementFile), owner.id);

  rejectModelSetup(new Error("model_failed"));
  const response = await responsePromise;
  assert.equal(response.status, 500);
  assert.equal(owner.destroyCalls, 1, "the failed owner is destroyed exactly once");
  assert.equal(owner.state.disposeCalls, 1, "the failed native owner is disposed exactly once");
  assert.equal(owner.wrapper.isAlive(), false);
  assert.equal(replacement.wrapper.isAlive(), true);
  assert.strictEqual(globalThis.__piSessions?.get(owner.id), replacement.wrapper);
  assert.equal(globalThis.__piSessionPathCache?.get(owner.id), replacementFile);
  assert.equal(globalThis.__piPathToSessionIdCache?.get(replacementFile), owner.id);
});

test("successful ensure retains both real publication cache directions before persistence", async (t) => {
  const owner = createRealPublishedRouteOwner(t, "cache-success");
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:real-cache-success",
    startSession: owner.startSession,
    allowRoot() {},
    invalidateSessions() {},
  });

  assert.equal(existsSync(owner.allocatedFile), false);
  const response = await post(newAgentRequest(owner.cwd, { type: "ensure_session" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, sessionId: owner.id, data: null });
  assert.equal(owner.destroyCalls, 0);
  assert.equal(owner.wrapper.isAlive(), true);
  assert.equal(existsSync(owner.allocatedFile), false, "ensure does not fabricate persistence");
  assert.equal(await resolveSessionPath(owner.id), owner.allocatedFile);
  assert.equal(await resolveSessionIdByPath(owner.allocatedFile), owner.id);
});

test("ordinary prompt failure retains both real publication cache directions", async (t) => {
  const owner = createRealPublishedRouteOwner(t, "cache-prompt-failure", {
    bindExtensions: async () => { throw new Error("binding_failed"); },
  });
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:real-cache-prompt-failure",
    startSession: owner.startSession,
    allowRoot() {},
    invalidateSessions() {},
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await post(newAgentRequest(owner.cwd, { type: "prompt", message: "synthetic" }));
    assert.equal(response.status, 500);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(owner.destroyCalls, 0);
  assert.equal(owner.wrapper.isAlive(), true);
  assert.strictEqual(globalThis.__piSessions?.get(owner.id), owner.wrapper);
  assert.equal(await resolveSessionPath(owner.id), owner.allocatedFile);
  assert.equal(await resolveSessionIdByPath(owner.allocatedFile), owner.id);
});

test("failed ensure setup destroys the published owner exactly once", async (t) => {
  const setupFailures = [
    {
      name: "allow-root",
      configure: () => ({ allowRoot() { throw new Error("allow_failed"); } }),
      body: { type: "ensure_session" },
    },
    {
      name: "session-list-invalidation",
      configure: () => ({ invalidateSessions() { throw new Error("invalidate_failed"); } }),
      body: { type: "ensure_session" },
    },
    {
      name: "selected-model",
      ownerOptions: { setModel: async () => { throw new Error("model_failed"); } },
      body: { type: "ensure_session", provider: "synthetic", modelId: "synthetic-model" },
    },
    {
      name: "selected-thinking",
      ownerOptions: { setThinkingLevel: () => { throw new Error("thinking_failed"); } },
      body: { type: "ensure_session", thinkingLevel: "high" },
    },
    {
      name: "ensured-identity",
      ownerOptions: { sessionFile: (manager) => `${manager.getSessionFile()}.wrong` },
      body: { type: "ensure_session" },
    },
  ];

  for (const failure of setupFailures) {
    await t.test(failure.name, async (t) => {
      const owner = createRouteOwner(t, failure.name, failure.ownerOptions);
      const overrides = failure.configure?.() ?? {};
      const post = createNewAgentPost({
        cwdExists: () => true,
        createStartupKey: () => `__pi_web_new_request__:${failure.name}`,
        async startSession() {
          return { session: owner.wrapper, realSessionId: owner.id };
        },
        allowRoot: overrides.allowRoot ?? (() => {}),
        invalidateSessions: overrides.invalidateSessions ?? (() => {}),
      });

      const response = await post(newAgentRequest(owner.cwd, failure.body));
      assert.equal(response.status, 500);
      assert.equal(owner.destroyCalls, 1, "the route invokes destruction exactly once");
      assert.equal(owner.state.disposeCalls, 1, "native disposal is exact once");
      assert.equal(owner.wrapper.isAlive(), false);
      assert.equal(owner.wrapper.getProjectedEventHub().isClosed(), true);
      assert.notStrictEqual(globalThis.__piSessions?.get(owner.id), owner.wrapper);
    });
  }
});

test("successful ensure preserves its published owner", async (t) => {
  const owner = createRouteOwner(t, "success");
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:success",
    async startSession() {
      return { session: owner.wrapper, realSessionId: owner.id };
    },
    allowRoot() {},
    invalidateSessions() {},
  });

  const response = await post(newAgentRequest(owner.cwd, { type: "ensure_session" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, sessionId: owner.id, data: null });
  assert.equal(owner.destroyCalls, 0);
  assert.equal(owner.state.disposeCalls, 0);
  assert.equal(owner.wrapper.isAlive(), true);
  assert.equal(owner.wrapper.hasEnsuredSessionTransportTarget(), true);
  assert.strictEqual(globalThis.__piSessions?.get(owner.id), owner.wrapper);
});

test("an awaited ordinary prompt binding failure does not destroy ambiguous command work", async (t) => {
  const owner = createRouteOwner(t, "binding", {
    bindExtensions: async () => { throw new Error("binding_failed"); },
  });
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:binding",
    async startSession() {
      owner.wrapper.beginExtensionBinding();
      return { session: owner.wrapper, realSessionId: owner.id };
    },
    allowRoot() {},
    invalidateSessions() {},
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await post(newAgentRequest(owner.cwd, { type: "prompt", message: "synthetic" }));
    assert.equal(response.status, 500);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(owner.destroyCalls, 0);
  assert.equal(owner.state.disposeCalls, 0);
  assert.equal(owner.wrapper.isAlive(), true);
  assert.strictEqual(globalThis.__piSessions?.get(owner.id), owner.wrapper);
});

test("same-tick concurrent new requests use distinct startup keys and native owners deterministically", async (t) => {
  const first = createRouteOwner(t, "concurrent-first");
  const second = createRouteOwner(t, "concurrent-second");
  const startupKeys = [
    "__pi_web_new_request__:deterministic-first",
    "__pi_web_new_request__:deterministic-second",
  ];
  const observedKeys = [];
  const starts = new Map();
  let nextOwner = 0;
  const owners = [first, second];
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => startupKeys[observedKeys.length],
    startSession(key) {
      observedKeys.push(key);
      let start = starts.get(key);
      if (!start) {
        const owner = owners[nextOwner++];
        start = Promise.resolve({ session: owner.wrapper, realSessionId: owner.id });
        starts.set(key, start);
      }
      return start;
    },
    allowRoot() {},
    invalidateSessions() {},
  });

  const [firstResponse, secondResponse] = await Promise.all([
    post(newAgentRequest(first.cwd, { type: "ensure_session" })),
    post(newAgentRequest(second.cwd, { type: "ensure_session" })),
  ]);
  assert.deepEqual(observedKeys, startupKeys);
  assert.notEqual(observedKeys[0], observedKeys[1]);
  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  const firstBody = await firstResponse.json();
  const secondBody = await secondResponse.json();
  assert.equal(firstBody.sessionId, first.id);
  assert.equal(secondBody.sessionId, second.id);
  assert.notEqual(firstBody.sessionId, secondBody.sessionId);
  assert.equal(first.destroyCalls, 0);
  assert.equal(second.destroyCalls, 0);
});

test("new ensure fails closed when startup returns a mismatched native owner ID", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-session-ensure-mismatch-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const manager = SessionManager.create(join(directory, "cwd"), directory);
  const synthetic = syntheticAgentSessionWrapper(manager, { exposeSessionFile: false });
  const originalDestroy = synthetic.wrapper.destroy.bind(synthetic.wrapper);
  let destroyCalls = 0;
  synthetic.wrapper.destroy = () => {
    destroyCalls += 1;
    originalDestroy();
  };
  t.after(() => {
    if (synthetic.wrapper.isAlive()) synthetic.wrapper.destroy();
  });
  const post = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:mismatch",
    async startSession() {
      return { session: synthetic.wrapper, realSessionId: "mismatched" };
    },
    allowRoot() {},
    invalidateSessions() {},
  });
  const response = await post(new Request("http://localhost/api/agent/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: manager.getCwd(), type: "ensure_session" }),
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Error: rpc_ensured_session_id_mismatch" });
  assert.equal(synthetic.wrapper.hasEnsuredSessionTransportTarget(), false);
  assert.equal(synthetic.wrapper.isAlive(), false, "an unreachable failed ensure owner is disposed");
  assert.equal(destroyCalls, 1);
  assert.equal(synthetic.state.disposeCalls, 1);
});

test("new ensure obtains a session ticket, attaches ready, then accepts its first HTTP prompt", { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-session-ensure-"));
  const cwd = join(directory, "cwd");
  mkdirSync(cwd);
  const manager = SessionManager.create(cwd, directory);
  const id = manager.getSessionId();
  const allocatedFile = manager.getSessionFile();
  assert.equal(existsSync(allocatedFile), false, "the native owner is allocated but not fabricated on disk");

  let attachedReady = false;
  const synthetic = syntheticAgentSessionWrapper(manager, {
    exposeSessionFile: false,
    onPrompt() {
      assert.equal(attachedReady, true, "the first prompt cannot reach the wrapper before S3 ready");
    },
  });
  const wrapper = synthetic.wrapper;
  const newAgentPost = createNewAgentPost({
    cwdExists: () => true,
    createStartupKey: () => "__pi_web_new_request__:integration",
    async startSession() {
      globalThis.__piSessions ??= new Map();
      globalThis.__piSessions.set(id, wrapper);
      wrapper.onDestroy(() => {
        if (globalThis.__piSessions?.get(id) === wrapper) globalThis.__piSessions.delete(id);
      });
      return { session: wrapper, realSessionId: id };
    },
    allowRoot() {},
    invalidateSessions() {},
  });

  const server = await startPiWebServer({
    dev: false,
    hostname: "127.0.0.1",
    port: 0,
    diagnostics: () => {},
    dependencies: { nextFactory: nextFactoryForTicketRoute({ newAgentPost }) },
  });
  t.after(async () => {
    await server.close().catch(() => {});
    if (wrapper.isAlive()) wrapper.destroy();
    globalThis.__piSessions?.delete(id);
    invalidateSessionPathCache(id);
    rmSync(directory, { recursive: true, force: true });
  });
  const httpBase = `http://127.0.0.1:${server.address.port}`;
  const wsBase = `ws://127.0.0.1:${server.address.port}`;

  const ensuredResponse = await fetch(`${httpBase}/api/agent/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, type: "ensure_session" }),
  });
  assert.equal(ensuredResponse.status, 200);
  const ensured = await ensuredResponse.json();
  assert.equal(ensured.success, true);
  assert.equal(ensured.sessionId, id);
  assert.equal(existsSync(allocatedFile), false, "ensure does not fabricate persistence");

  const issued = await issue(httpBase, httpBase, id);
  assert.equal(issued.response.status, 200, "the exact live ensured owner is ticket-authorized");
  assert.deepEqual(Object.keys(issued.body).sort(), ["expiresAt", "ticket"]);
  assert.equal(JSON.stringify(issued.body).includes(id), false);
  const client = await open(wsBase, httpBase, issued.body.ticket);
  await waitFor(() => client.frames.at(-1)?.type === "snapshot_end", "ensured_initial_snapshot");
  assert.equal(client.frames[0]?.type, "ready");
  assert.equal(client.frames[0]?.outcome, "initial_snapshot");
  attachedReady = true;

  const promptResponse = await fetch(`${httpBase}/api/agent/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "prompt", message: "synthetic" }),
  });
  assert.equal(promptResponse.status, 200);
  assert.equal((await promptResponse.json()).success, true);
  assert.equal(synthetic.state.promptCalls, 1);
  await waitFor(() => client.frames.some((frame) => frame.type === "activity_started"), "first_prompt_activity");
  await closeSocket(client.socket);
});

test("actual ticket POST and same-port session channel stay resumable and HTTP-schedulable", { timeout: 60_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-session-channel-"));
  const cwd = join(directory, "cwd");
  const manager = SessionManager.create(cwd, directory);
  manager.appendMessage({ role: "user", content: "synthetic", timestamp: 1 });
  const file = manager.getSessionFile();
  const id = manager.getSessionId();
  writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd })}\n`);
  cacheSessionPath(id, file);
  const synthetic = syntheticAgentSessionWrapper(manager);
  const wrapper = synthetic.wrapper;
  const hub = wrapper.getProjectedEventHub();
  assert.ok(hub);
  globalThis.__piSessions ??= new Map();
  globalThis.__piSessions.set(id, wrapper);
  t.after(() => {
    if (wrapper.isAlive()) wrapper.destroy();
    globalThis.__piSessions?.delete(id);
    invalidateSessionPathCache(id);
    rmSync(directory, { recursive: true, force: true });
  });

  const start = (port = 0) => startPiWebServer({
    dev: false, hostname: "127.0.0.1", port, diagnostics: () => {},
    dependencies: { nextFactory: nextFactoryForTicketRoute() },
  });
  let server = await start();
  t.after(() => server.close().catch(() => {}));
  let httpBase = `http://127.0.0.1:${server.address.port}`;
  let wsBase = `ws://127.0.0.1:${server.address.port}`;

  const firstTicket = await issue(httpBase, httpBase, id);
  assert.equal(firstTicket.response.status, 200);
  assert.deepEqual(Object.keys(firstTicket.body).sort(), ["expiresAt", "ticket"]);
  assert.equal(JSON.stringify(firstTicket.body).includes(id), false);
  const first = await open(wsBase, httpBase, firstTicket.body.ticket);
  await waitFor(() => first.frames.at(-1)?.type === "snapshot_end", "initial_snapshot");
  assert.equal(first.frames[0].type, "ready");
  assert.equal(first.frames[0].outcome, "initial_snapshot");
  assert.equal(first.socket.url.includes(id), false);

  const reuseStatus = await new Promise((resolve, reject) => {
    const reused = new WebSocket(`${wsBase}${PI_WEB_TRANSPORT_PATH}?ticket=${encodeURIComponent(firstTicket.body.ticket)}`, { origin: httpBase });
    reused.once("unexpected-response", (_request, response) => { const status = response.statusCode; response.resume(); resolve(status); });
    reused.once("error", (error) => { if (!String(error.message).startsWith("Unexpected server response:")) reject(error); });
  });
  assert.equal(reuseStatus, 401);

  const clients = [first];
  for (let index = 1; index < 7; index += 1) {
    const issued = await issue(httpBase, httpBase, id);
    clients.push(await open(wsBase, httpBase, issued.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor }));
  }
  await waitFor(() => clients.every((client) => client.frames.length > 0), "seven_ready");

  const runningSockets = [];
  for (let index = 0; index < 57; index += 1) {
    const runningTicket = await issueChannel(httpBase, httpBase, { channel: "running" });
    runningSockets.push(await openRaw(wsBase, httpBase, runningTicket.body.ticket));
  }
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 64, "mixed_capacity");
  const rejectedTicket = await issue(httpBase, httpBase, id);
  assert.equal(await rejectedUpgradeStatus(wsBase, httpBase, rejectedTicket.body.ticket), 429);
  await closeSocket(runningSockets.pop());
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 63, "mixed_release");
  assert.equal(await rejectedUpgradeStatus(wsBase, httpBase, rejectedTicket.body.ticket), 401, "cap rejection spends the ticket");
  const readmissionTicket = await issue(httpBase, httpBase, id);
  const readmitted = await open(wsBase, httpBase, readmissionTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => readmitted.frames[0]?.type === "ready", "mixed_readmission");
  await closeSocket(readmitted.socket);
  await Promise.all(runningSockets.map(closeSocket));
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 7, "mixed_cleanup");

  const getResponse = await fetch(`${httpBase}/bounded`);
  assert.equal(getResponse.status, 200);
  const postResponse = await fetch(`${httpBase}/bounded`, { method: "POST", body: "synthetic" });
  assert.deepEqual(await postResponse.json(), { method: "POST", bytes: 9 });

  synthetic.emit({ type: "agent_start" });
  await waitFor(() => clients.every((client) => client.frames.some((frame) => frame.type === "activity_started")), "live_all");
  const liveFrames = clients.map((client) => client.frames.filter((frame) => frame.type === "activity_started"));
  assert.ok(liveFrames.every((items) => JSON.stringify(items) === JSON.stringify(liveFrames[0])));

  for (const resumeTarget of [
    { epoch: "wrong-stream", cursor: 0, outcome: "wrong_epoch" },
    { epoch: hub.streamEpoch, cursor: hub.cursor + 1, outcome: "invalid_cursor" },
  ]) {
    const issued = await issue(httpBase, httpBase, id);
    const recovered = await open(wsBase, httpBase, issued.body.ticket, resumeTarget);
    await waitFor(() => recovered.frames.at(-1)?.type === "snapshot_end", resumeTarget.outcome);
    assert.equal(recovered.frames[0].outcome, resumeTarget.outcome);
    await closeSocket(recovered.socket);
  }

  for (const hostile of [
    { send(socket) { socket.send(Buffer.from([1])); }, code: 1003 },
    { send(socket) { socket.send("{}"); }, code: 1008 },
  ]) {
    const issued = await issue(httpBase, httpBase, id);
    const socket = await openRaw(wsBase, httpBase, issued.body.ticket);
    const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
    hostile.send(socket);
    assert.equal(await closed, hostile.code);
  }
  const duplicateTicket = await issue(httpBase, httpBase, id);
  const duplicate = await open(wsBase, httpBase, duplicateTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => duplicate.frames[0]?.type === "ready", "duplicate_ready");
  const duplicateClose = new Promise((resolve) => duplicate.socket.once("close", (code) => resolve(code)));
  duplicate.socket.send(JSON.stringify({ protocol: "pi-web-session-transport", version: 1, type: "resume", streamEpoch: hub.streamEpoch, cursor: hub.cursor }));
  assert.equal(await duplicateClose, 1008);

  await Promise.all(clients.map((client) => closeSocket(client.socket)));
  const stalledTicket = await issue(httpBase, httpBase, id);
  const healthyTicket = await issue(httpBase, httpBase, id);
  const stalled = await open(wsBase, httpBase, stalledTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  const healthy = await open(wsBase, httpBase, healthyTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => stalled.frames[0]?.type === "ready" && healthy.frames[0]?.type === "ready", "slow_pair_ready");
  const stalledClose = new Promise((resolve) => stalled.socket.once("close", (code) => resolve(code)));
  stalled.socket.pause();
  let lastStatusKey = "";
  for (let index = 0; index < 100 && server.gateway.getStats().activeConnectionCount === 2; index += 1) {
    lastStatusKey = `slow-${index}`;
    synthetic.emit({
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: lastStatusKey,
      statusText: "v".repeat(80_000),
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
  await waitFor(() => server.gateway.getStats().activeConnectionCount === 1, "real_slow_detach", 15_000);
  assert.equal(healthy.socket.readyState, WebSocket.OPEN);
  await waitFor(() => healthy.frames.some((frame) => frame.type === "extension_status_set" && frame.key === lastStatusKey), "healthy_continues");
  stalled.socket.resume();
  assert.ok([1006, 1013].includes(await stalledClose), "retryable close is best effort before terminate fallback");
  await closeSocket(healthy.socket);

  synthetic.emit({ type: "agent_end", messages: [] });
  const cursor = hub.cursor;
  // The wrapper-owned hub keeps projecting a complete prompt lifecycle with
  // zero browser subscribers. A later client recovers it; disconnect never
  // aborts or disposes the run.
  synthetic.emit({ type: "agent_start" });
  synthetic.emit({ type: "entry_appended", entry: { synthetic: true } });
  synthetic.emit({ type: "agent_end", messages: [] });
  const reconnectTicket = await issue(httpBase, httpBase, id);
  const reconnect = await open(wsBase, httpBase, reconnectTicket.body.ticket, { epoch: hub.streamEpoch, cursor });
  await waitFor(() => reconnect.frames.some((frame) => typeof frame.sequence === "number" && frame.sequence > cursor), "zero_subscriber_replay");
  assert.equal(reconnect.frames[0].outcome, "exact");
  assert.ok(reconnect.frames.some((frame) => frame.type === "activity_started"));
  assert.ok(reconnect.frames.some((frame) => frame.type === "transcript_changed"));
  await closeSocket(reconnect.socket);

  const overflowCursor = hub.cursor;
  synthetic.emit({
    type: "extension_ui_request",
    id: "durable-overflow",
    method: "custom",
    lines: ["x".repeat(4 * 1024 * 1024 + 1_024)],
  });
  assert.ok(hub.floor > overflowCursor, "an individually over-replay-bound durable frame advances the floor");
  const overflowTicket = await issue(httpBase, httpBase, id);
  const overflow = await open(wsBase, httpBase, overflowTicket.body.ticket, { epoch: hub.streamEpoch, cursor: overflowCursor });
  await waitFor(() => overflow.frames.at(-1)?.type === "snapshot_end", "overflow_snapshot", 30_000);
  assert.equal(overflow.frames[0].outcome, "overflow_snapshot");
  await closeSocket(overflow.socket);
  assert.equal(synthetic.state.abortCalls + synthetic.state.disposeCalls, 0);

  const shutdownTicket = await issue(httpBase, httpBase, id);
  const shutdownOpen = await open(wsBase, httpBase, shutdownTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => shutdownOpen.frames[0]?.outcome === "empty", "shutdown_open_ready");
  const registration = globalThis[SESSION_REGISTRATION_TEST_SYMBOL];
  const ownerRecord = registration.ownerRegistry.get(wrapper);
  assert.equal(ownerRecord.subscribers.size, 1, "one genuine session subscriber remains owned before server close");
  assert.equal(server.gateway.getStats().activeConnectionCount, 1);
  const shutdownSocketClosed = new Promise((resolve) => shutdownOpen.socket.once("close", (code) => resolve(code)));

  const port = server.address.port;
  await server.close();
  assert.equal(await shutdownSocketClosed, 1006, "custom-server close terminates its still-open authorized session socket");
  assert.equal(ownerRecord.subscribers.size, 0, "socket termination releases the channel subscriber");
  assert.deepEqual(server.gateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
  assert.equal(wrapper.isAlive(), true);
  assert.equal(hub.isClosed(), false);

  server = await start(port);
  httpBase = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
  const restartTicket = await issue(httpBase, httpBase, id);
  const restarted = await open(wsBase, httpBase, restartTicket.body.ticket, { epoch: hub.streamEpoch, cursor: hub.cursor });
  await waitFor(() => restarted.frames[0]?.outcome === "empty", "restart_empty");

  const oversizedTicket = await issue(httpBase, httpBase, id);
  const oversized = await openRaw(wsBase, httpBase, oversizedTicket.body.ticket);
  const oversizedClose = new Promise((resolve) => oversized.once("close", (code) => resolve(code)));
  oversized.send("x".repeat(16 * 1024 + 1));
  assert.equal(await oversizedClose, 1009, "installed ws owns maximum-payload closure");

  const utf8Ticket = await issue(httpBase, httpBase, id);
  const invalidUtf8 = await openRaw(wsBase, httpBase, utf8Ticket.body.ticket);
  const utf8Close = new Promise((resolve) => invalidUtf8.once("close", (code) => resolve(code)));
  invalidUtf8._sender.send(Buffer.from([0xff]), { binary: false, compress: false, fin: true, mask: true }, () => {});
  assert.equal(await utf8Close, 1007, "installed ws owns invalid-UTF-8 closure");

  assert.equal(wrapper.onDestroyCallbacks.size, 1, "HMR-stable owner registry installs one destruction observer");
  const ownerClose = new Promise((resolve) => restarted.socket.once("close", (code) => resolve(code)));
  wrapper.destroy();
  assert.equal(await ownerClose, 1012);
  assert.equal(synthetic.state.abortCalls, 0);
  assert.equal(synthetic.state.disposeCalls, 1, "only wrapper destruction owns native disposal");
});
