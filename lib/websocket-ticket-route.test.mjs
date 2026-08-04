import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const {
  PI_WEB_TRANSPORT_GATEWAY_SLOT,
  createPiWebTransportGateway,
  installPiWebTransportGateway,
} = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const ticketRoute = await jiti.import("../app/api/transport/ticket/route.ts");
const { POST } = ticketRoute;
const { createFileWatchTicketIssuer, createSessionTicketIssuer } = await jiti.import("./transport-ticket-route.ts");
const { ProjectedSessionEventHub } = await jiti.import("./session-event-hub.ts");
const { activateRpcRuntimeOwner, getRpcSession } = await jiti.import("./rpc-manager.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");

const HOST = "localhost:30141";
const ORIGIN = `http://${HOST}`;

function clearGateway() {
  const gateway = globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  if (gateway?.version === 1 && typeof gateway.close === "function") gateway.close();
  delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
}

function installTestGateway() {
  const gateway = createPiWebTransportGateway();
  installPiWebTransportGateway(gateway);
  return gateway;
}

function ticketRequest(options = {}) {
  const headers = new Headers({
    Host: HOST,
    Origin: ORIGIN,
    "Content-Type": "application/json",
    "X-Pi-Web-Transport": "1",
    ...options.headers,
  });
  const body = options.body ?? JSON.stringify({ channel: "test.route" });
  return new Request(`http://${HOST}/api/transport/ticket`, {
    method: "POST",
    headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

async function responseError(response) {
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  return body.error;
}

test.beforeEach(clearGateway);
test.afterEach(clearGateway);

test("transport/ticket adapter exposes only supported Next route exports", () => {
  const exportNames = Object.getOwnPropertyNames(ticketRoute)
    .filter((name) => name !== "__esModule")
    .sort();
  assert.deepEqual(exportNames, ["POST", "dynamic"]);
  assert.equal(typeof ticketRoute.POST, "function");
  assert.equal(ticketRoute.dynamic, "force-dynamic");
});

test("requires the custom bootstrap header", async () => {
  installTestGateway();
  for (const value of [undefined, "", "0", "2", "1, 1"]) {
    const headers = {};
    if (value === undefined) headers["X-Pi-Web-Transport"] = undefined;
    else headers["X-Pi-Web-Transport"] = value;
    const request = ticketRequest();
    if (value === undefined) request.headers.delete("X-Pi-Web-Transport");
    else request.headers.set("X-Pi-Web-Transport", value);

    const response = await POST(request);
    assert.equal(response.status, 403);
    assert.equal(await responseError(response), "transport_forbidden");
  }
});

test("requires an exact same-host browser origin", async () => {
  installTestGateway();
  for (const [origin, host] of [
    [null, HOST],
    ["null", HOST],
    ["file://localhost", HOST],
    [`${ORIGIN}/`, HOST],
    [`${ORIGIN}/path`, HOST],
    ["http://other:30141", HOST],
    [ORIGIN, "localhost:30142"],
    [ORIGIN, "@localhost:30141"],
    [ORIGIN, "localhost:"],
    [ORIGIN, "localhost:not-a-port"],
    [ORIGIN, "localhost:65536"],
    ["http://[::1]:30141", "[::1]:"],
    [ORIGIN, ""],
    [`${ORIGIN}, ${ORIGIN}`, HOST],
  ]) {
    const request = ticketRequest();
    if (origin === null) request.headers.delete("Origin");
    else request.headers.set("Origin", origin);
    if (host === "") request.headers.delete("Host");
    else request.headers.set("Host", host);

    const response = await POST(request);
    assert.equal(response.status, 403);
    assert.equal(await responseError(response), "origin_forbidden");
  }
});

test("rejects unsupported content types and malformed request objects", async () => {
  const gateway = installTestGateway();
  gateway.registerChannel("test.route", () => {});

  const unsupported = await POST(ticketRequest({ headers: { "Content-Type": "text/plain" } }));
  assert.equal(unsupported.status, 415);
  assert.equal(await responseError(unsupported), "unsupported_media_type");

  for (const body of [
    "not-json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ channel: "test.route", extra: true }),
    JSON.stringify({ channel: 1 }),
    JSON.stringify({ channel: "INVALID" }),
  ]) {
    const response = await POST(ticketRequest({ body }));
    assert.equal(response.status, 400);
    assert.equal(await responseError(response), "invalid_request");
  }
});

test("reads the request body incrementally and enforces the byte limit", async () => {
  const gateway = installTestGateway();
  gateway.registerChannel("test.route", () => {});

  const declared = ticketRequest({ body: JSON.stringify({ channel: "test.route" }) });
  declared.headers.set("Content-Length", "1025");
  const declaredResponse = await POST(declared);
  assert.equal(declaredResponse.status, 413);
  assert.equal(await responseError(declaredResponse), "body_too_large");

  const streamedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(700));
      controller.enqueue(new Uint8Array(400));
      controller.close();
    },
  });
  const streamedResponse = await POST(ticketRequest({ body: streamedBody }));
  assert.equal(streamedResponse.status, 413);
  assert.equal(await responseError(streamedResponse), "body_too_large");
});

test("hides channel registration details and incompatible gateway state", async () => {
  const gateway = installTestGateway();
  const unknown = await POST(ticketRequest({ body: JSON.stringify({ channel: "test.missing" }) }));
  assert.equal(unknown.status, 404);
  assert.equal(await responseError(unknown), "channel_unavailable");
  gateway.close();

  const unavailableCrossOrigin = ticketRequest();
  unavailableCrossOrigin.headers.set("Origin", "http://other:30141");
  const unavailableCrossOriginResponse = await POST(unavailableCrossOrigin);
  assert.equal(unavailableCrossOriginResponse.status, 403);
  assert.equal(await responseError(unavailableCrossOriginResponse), "origin_forbidden");

  const unavailable = await POST(ticketRequest());
  assert.equal(unavailable.status, 503);
  assert.equal(await responseError(unavailable), "transport_unavailable");

  globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] = null;
  const falsyOccupied = await POST(ticketRequest());
  assert.equal(falsyOccupied.status, 503);
  assert.equal(await responseError(falsyOccupied), "transport_unavailable");

  globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] = { version: 2 };
  const mismatchedCrossOrigin = ticketRequest();
  mismatchedCrossOrigin.headers.set("Origin", "http://other:30141");
  const mismatchedCrossOriginResponse = await POST(mismatchedCrossOrigin);
  assert.equal(mismatchedCrossOriginResponse.status, 403);
  assert.equal(await responseError(mismatchedCrossOriginResponse), "origin_forbidden");

  const mismatched = await POST(ticketRequest());
  assert.equal(mismatched.status, 503);
  assert.equal(await responseError(mismatched), "transport_unavailable");
});

test("lazily registers and reuses exactly one running production channel", async () => {
  const gateway = installTestGateway();
  assert.equal(gateway.getStats().registeredChannelCount, 0);

  const first = await POST(ticketRequest({ body: JSON.stringify({ channel: "running" }) }));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(gateway.getStats().registeredChannelCount, 1);
  const firstAuthorization = gateway.consumeTicket(firstBody.ticket);
  assert.equal(firstAuthorization.channel, "running");
  assert.equal(typeof firstAuthorization.handler, "function");

  const second = await POST(ticketRequest({ body: JSON.stringify({ channel: "running" }) }));
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(gateway.getStats().registeredChannelCount, 1);
  assert.equal(gateway.consumeTicket(secondBody.ticket).handler, firstAuthorization.handler);
});

test("session request shape and exact ID bounds fail before authorization side effects", async () => {
  const gateway = installTestGateway();
  for (const body of [
    { channel: "session" },
    { channel: "session.opaque", sessionId: "opaque" },
    { channel: "session", sessionId: "" },
    { channel: "session", sessionId: " padded " },
    { channel: "session", sessionId: "x".repeat(257) },
    { channel: "session", sessionId: "bad\u007f" },
    { channel: "session", sessionId: "ok", cursor: 0 },
  ]) {
    const response = await POST(ticketRequest({ body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
    assert.equal(await responseError(response), "invalid_request");
  }
  assert.equal(gateway.getStats().registeredChannelCount, 0);
});

function fakeSessionTarget({
  id = "synthetic",
  file = "/synthetic/session.jsonl",
  cwd = "/synthetic/cwd",
  alive = true,
  closed = false,
  ensured = false,
  ensuredTarget,
} = {}) {
  const hub = new ProjectedSessionEventHub({ streamEpoch: "synthetic-epoch" });
  if (closed) hub.close();
  const target = ensuredTarget ?? { sessionId: id, sessionFile: file, cwd };
  return {
    hub,
    wrapper: {
      sessionId: id,
      sessionFile: file,
      inner: { sessionManager: {
        getSessionId: () => id,
        getSessionFile: () => file,
        getCwd: () => cwd,
      } },
      isAlive: () => alive,
      hasEnsuredSessionTransportTarget: () => ensured,
      getEnsuredSessionTransportTarget: () => ensured ? target : null,
      getProjectedEventHub: () => hub,
      onDestroy() {},
    },
  };
}

function sessionIssuerDependencies(overrides = {}) {
  const target = overrides.target ?? fakeSessionTarget();
  const calls = [];
  return {
    target,
    calls,
    dependencies: {
      ensureChannel(gateway) {
        calls.push("ensure");
        if (overrides.ensureChannel) return overrides.ensureChannel(gateway);
        gateway.registerChannel("session", () => {});
      },
      async resolvePath() { calls.push("resolve"); return Object.hasOwn(overrides, "file") ? overrides.file : "/synthetic/session.jsonl"; },
      readHeader() { calls.push("header"); return Object.hasOwn(overrides, "header") ? overrides.header : { type: "session", id: "synthetic", timestamp: "", cwd: "/synthetic/cwd" }; },
      getSession() { calls.push("get"); return overrides.existing === false ? undefined : target.wrapper; },
      isCurrentSession(_id, wrapper) {
        calls.push("current");
        if (overrides.currentSequence?.length) return overrides.currentSequence.shift();
        return overrides.current === false ? false : wrapper === target.wrapper;
      },
      async startSession(_id, _file, _cwd, _tools, hooks) {
        calls.push("start");
        const result = overrides.startResult ?? { session: target.wrapper, realSessionId: target.wrapper.sessionId };
        hooks?.validatePrepared?.(result);
        return result;
      },
    },
  };
}

test("session issuer requires context capability before registration, resolution, or startup", async () => {
  const gateway = installTestGateway();
  delete gateway.ticketContextVersion;
  const fixture = sessionIssuerDependencies();
  const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
  assert.deepEqual(outcome, { ok: false, status: 503, error: "transport_unavailable" });
  assert.deepEqual(fixture.calls, []);
});

test("session issuer binds the exact live wrapper and hub only in opaque ticket context", async () => {
  const gateway = installTestGateway();
  const fixture = sessionIssuerDependencies();
  const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
  assert.equal(outcome.ok, true);
  assert.deepEqual(fixture.calls, ["ensure", "get", "resolve", "header", "get", "current", "current"]);
  const authorization = gateway.consumeTicket(outcome.ticket);
  assert.equal(authorization.channel, "session");
  assert.deepEqual(Reflect.ownKeys(authorization.ticketContext), ["protocol", "version", "owner", "wrapper", "hub"]);
  assert.equal(Object.isFrozen(authorization.ticketContext), true);
  assert.strictEqual(authorization.ticketContext.wrapper, fixture.target.wrapper);
  assert.strictEqual(authorization.ticketContext.hub, fixture.target.hub);
  assert.deepEqual(Object.keys(outcome).sort(), ["expiresAt", "ok", "ticket"]);
  assert.equal(JSON.stringify(outcome).includes("synthetic"), false);
});

test("session issuer admits only the exact current live ensured owner before disk discovery", async () => {
  const gateway = installTestGateway();
  const target = fakeSessionTarget({ ensured: true, file: "/synthetic/allocated.jsonl" });
  const fixture = sessionIssuerDependencies({ target, file: null });
  const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
  assert.equal(outcome.ok, true);
  assert.deepEqual(fixture.calls, ["ensure", "get", "current", "current"]);
  const authorization = gateway.consumeTicket(outcome.ticket);
  assert.strictEqual(authorization.ticketContext.wrapper, target.wrapper);
  assert.strictEqual(authorization.ticketContext.hub, target.hub);
  assert.equal(JSON.stringify(outcome).includes("synthetic"), false);
});

test("session issuer fails closed for stale, dead, mismatched, or incompatible ensured owners", async () => {
  const cases = [
    { current: false, target: fakeSessionTarget({ ensured: true }) },
    { target: fakeSessionTarget({ ensured: true, alive: false }) },
    { target: fakeSessionTarget({ ensured: true, ensuredTarget: {
      sessionId: "other", sessionFile: "/synthetic/session.jsonl", cwd: "/synthetic/cwd",
    } }) },
    { target: fakeSessionTarget({ ensured: true, file: "relative" }) },
    { target: fakeSessionTarget({ ensured: true, closed: true }) },
  ];
  for (const overrides of cases) {
    clearGateway();
    const gateway = installTestGateway();
    const fixture = sessionIssuerDependencies({ ...overrides, file: null });
    const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
    assert.deepEqual(outcome, { ok: false, status: 409, error: "session_transport_unavailable" });
    assert.equal(gateway.getStats().pendingTicketCount, 0);
    assert.equal(fixture.calls.includes("resolve"), false, "marked owners never fall through to disk/start");
  }
});

test("session issuer spends no ticket when an ensured owner is replaced during binding", async () => {
  const gateway = installTestGateway();
  const fixture = sessionIssuerDependencies({
    target: fakeSessionTarget({ ensured: true }),
    file: null,
    currentSequence: [true, false],
  });
  assert.deepEqual(await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic"), {
    ok: false, status: 409, error: "session_transport_unavailable",
  });
  assert.equal(gateway.getStats().pendingTicketCount, 0);
  assert.deepEqual(fixture.calls, ["ensure", "get", "current", "current"]);
});

test("an HMR-incompatible live owner cannot use the pre-prompt admission path", async () => {
  const gateway = installTestGateway();
  const target = fakeSessionTarget();
  delete target.wrapper.getEnsuredSessionTransportTarget;
  delete target.wrapper.hasEnsuredSessionTransportTarget;
  const fixture = sessionIssuerDependencies({ target, file: null });
  assert.deepEqual(await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic"), {
    ok: false, status: 404, error: "session_not_found",
  });
  assert.equal(gateway.getStats().pendingTicketCount, 0);
  assert.deepEqual(fixture.calls, ["ensure", "get", "resolve"]);
});

test("session issuer accepts exact 4096-byte file/cwd boundaries and rejects one over", async () => {
  const exactFile = `/${"f".repeat(4095)}`;
  const exactCwd = `/${"c".repeat(4095)}`;
  const target = fakeSessionTarget({ file: exactFile, cwd: exactCwd });
  const gateway = installTestGateway();
  const exact = sessionIssuerDependencies({
    file: exactFile,
    header: { type: "session", id: "synthetic", timestamp: "", cwd: exactCwd },
    target,
  });
  assert.equal((await createSessionTicketIssuer(exact.dependencies)(gateway, "synthetic")).ok, true);

  clearGateway();
  const overGateway = installTestGateway();
  const over = sessionIssuerDependencies({
    header: { type: "session", id: "synthetic", timestamp: "", cwd: `/${"c".repeat(4096)}` },
  });
  assert.deepEqual(await createSessionTicketIssuer(over.dependencies)(overGateway, "synthetic"), {
    ok: false, status: 409, error: "session_transport_unavailable",
  });
});

test("session issuer maps header/path/start/capability conflicts finitely without ticket issue", async () => {
  const cases = [
    [{ file: null }, 404, "session_not_found"],
    [{ header: null }, 404, "session_not_found"],
    [{ header: { type: "session", id: "other", timestamp: "", cwd: "/synthetic/cwd" } }, 409, "session_transport_unavailable"],
    [{ header: { type: "session", id: "synthetic", timestamp: "", cwd: "relative" } }, 409, "session_transport_unavailable"],
    [{ file: `/${"x".repeat(4097)}` }, 409, "session_transport_unavailable"],
    [{ target: fakeSessionTarget({ file: "/wrong" }) }, 409, "session_transport_unavailable"],
    [{ target: fakeSessionTarget({ alive: false }) }, 409, "session_transport_unavailable"],
    [{ target: fakeSessionTarget({ closed: true }) }, 409, "session_transport_unavailable"],
  ];
  for (const [overrides, status, error] of cases) {
    clearGateway();
    const gateway = installTestGateway();
    const fixture = sessionIssuerDependencies(overrides);
    const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
    assert.deepEqual(outcome, { ok: false, status, error });
    assert.equal(gateway.getStats().pendingTicketCount, 0);
  }
});

test("concurrent session bootstraps share one no-provider startup and receive independent tickets", async () => {
  const gateway = installTestGateway();
  const target = fakeSessionTarget();
  let registered = false;
  let startCalls = 0;
  let sharedStart;
  const fixture = sessionIssuerDependencies({ existing: false, target });
  fixture.dependencies.ensureChannel = (currentGateway) => {
    if (!registered) {
      currentGateway.registerChannel("session", () => {});
      registered = true;
    }
  };
  fixture.dependencies.startSession = async (_id, _file, _cwd, _tools, hooks) => {
    if (!sharedStart) {
      startCalls += 1;
      sharedStart = new Promise((resolve) => setImmediate(() => resolve({ session: target.wrapper, realSessionId: "synthetic" })));
    }
    const result = await sharedStart;
    hooks?.validatePrepared?.(result);
    return result;
  };
  const issuer = createSessionTicketIssuer(fixture.dependencies);
  const [first, second] = await Promise.all([
    issuer(gateway, "synthetic"),
    issuer(gateway, "synthetic"),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(startCalls, 1);
  assert.notEqual(first.ticket, second.ticket);
  const firstContext = gateway.consumeTicket(first.ticket).ticketContext;
  const secondContext = gateway.consumeTicket(second.ticket).ticketContext;
  assert.strictEqual(firstContext.wrapper, secondContext.wrapper);
  assert.strictEqual(firstContext.hub, secondContext.hub);
});

test("production session issuer composes the real existing-file shared slow start without a provider", { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-ticket-production-start-"));
  const agentDirectory = join(directory, "agent");
  const cwd = join(directory, "cwd");
  mkdirSync(agentDirectory);
  mkdirSync(cwd);
  const hadAgentDirectory = Object.hasOwn(process.env, "PI_CODING_AGENT_DIR");
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;

  try {
    const manager = SessionManager.create(cwd, directory);
    const sessionId = manager.getSessionId();
    const sessionFile = manager.getSessionFile();
    writeFileSync(sessionFile, `${JSON.stringify({
      type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd,
    })}\n`);
    cacheSessionPath(sessionId, sessionFile);
    const gateway = installTestGateway();
    activateRpcRuntimeOwner();
    const previousLocks = globalThis.__piStartLocks;
    class TrackingStartLocks extends Map {
      setCalls = 0;
      set(key, value) { this.setCalls += 1; return super.set(key, value); }
    }
    const trackingLocks = new TrackingStartLocks();
    globalThis.__piStartLocks = trackingLocks;
    let wrapper = null;

    try {
      const requestBody = JSON.stringify({ channel: "session", sessionId });
      const [firstResponse, secondResponse] = await Promise.all([
        POST(ticketRequest({ body: requestBody })),
        POST(ticketRequest({ body: requestBody })),
      ]);
      assert.equal(firstResponse.status, 200);
      assert.equal(secondResponse.status, 200);
      const first = await firstResponse.json();
      const second = await secondResponse.json();
      assert.notEqual(first.ticket, second.ticket);
      assert.equal(trackingLocks.setCalls, 1, "both production bootstraps share one getOrCreateRpcSession slow path");
      assert.equal(trackingLocks.size, 0, "the startup lock is released after publication");

      wrapper = getRpcSession(sessionId);
      assert.ok(wrapper?.isAlive());
      assert.equal(wrapper.sessionId, sessionId);
      assert.equal(wrapper.sessionFile, sessionFile);
      assert.equal(wrapper.inner.sessionManager.getCwd(), cwd);
      const hub = wrapper.getProjectedEventHub();
      assert.ok(hub && !hub.isClosed());
      const firstContext = gateway.consumeTicket(first.ticket).ticketContext;
      const secondContext = gateway.consumeTicket(second.ticket).ticketContext;
      assert.strictEqual(firstContext.wrapper, wrapper);
      assert.strictEqual(secondContext.wrapper, wrapper);
      assert.strictEqual(firstContext.hub, hub);
      assert.strictEqual(secondContext.hub, hub, "post-start issue binds the published wrapper's identical hub");
    } finally {
      const wrapperForCleanup = wrapper ?? getRpcSession(sessionId);
      try {
        if (wrapperForCleanup?.isAlive()) await wrapperForCleanup.send({ type: "get_commands" });
      } finally {
        try {
          wrapperForCleanup?.destroy();
        } finally {
          globalThis.__piSessions?.delete(sessionId);
          try {
            invalidateSessionPathCache(sessionId);
          } finally {
            globalThis.__piStartLocks = previousLocks;
          }
        }
      }
    }
  } finally {
    if (hadAgentDirectory) process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    else delete process.env.PI_CODING_AGENT_DIR;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("session issuer applies validatePrepared and post-start identity checks", async () => {
  const gateway = installTestGateway();
  const fixture = sessionIssuerDependencies({ existing: false });
  const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
  assert.equal(outcome.ok, true);
  assert.deepEqual(fixture.calls, ["ensure", "get", "resolve", "header", "get", "start", "current", "current"]);

  clearGateway();
  const conflictGateway = installTestGateway();
  const wrong = fakeSessionTarget({ id: "wrong" });
  const conflict = sessionIssuerDependencies({ existing: false, target: wrong });
  const rejected = await createSessionTicketIssuer(conflict.dependencies)(conflictGateway, "synthetic");
  assert.deepEqual(rejected, { ok: false, status: 409, error: "session_transport_unavailable" });
  assert.equal(conflictGateway.getStats().pendingTicketCount, 0);
});

test("file-watch request shape rejects malformed sessions, NUL, relative paths, and excess keys before authorization", async () => {
  const gateway = installTestGateway();
  for (const body of [
    { channel: "file-watch" },
    { channel: "file-watch", path: 1 },
    { channel: "file-watch", path: "" },
    { channel: "file-watch", path: "relative/file" },
    { channel: "file-watch", path: "/contains\0nul" },
    { channel: "file-watch", path: "/synthetic/file", extra: true },
    { channel: "file-watch", path: "/synthetic/file", sessionId: "" },
    { channel: "file-watch", path: "/synthetic/file", sessionId: " padded " },
    { channel: "file-watch", path: "/synthetic/file", sessionId: "bad\u007f" },
    { channel: "file-watch", path: "/synthetic/file", sessionId: "x".repeat(257) },
  ]) {
    const response = await POST(ticketRequest({ body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
    assert.equal(await responseError(response), "invalid_request");
  }
  assert.equal(gateway.getStats().registeredChannelCount, 0);
});

test("file-watch issuer freshly authorizes a regular file and binds only frozen opaque server context", async () => {
  const gateway = installTestGateway();
  let ensureCalls = 0;
  let authorizationCalls = 0;
  let watcherCalls = 0;
  const issuer = createFileWatchTicketIssuer({
    async authorize(filePath, sessionId) {
      authorizationCalls += 1;
      assert.equal(filePath, "/synthetic/control\u0001.txt");
      assert.equal(sessionId, "source-session");
      return "allowed_session_reference";
    },
    stat() { return { isFile: () => true }; },
    lstat() { return { isSymbolicLink: () => false }; },
    ensureChannel(currentGateway) {
      ensureCalls += 1;
      currentGateway.registerChannel("file-watch", () => { watcherCalls += 1; });
    },
  });
  const issued = await issuer(gateway, "/synthetic/control\u0001.txt", "source-session");
  assert.equal(issued.ok, true);
  assert.equal(authorizationCalls, 1);
  assert.equal(ensureCalls, 1);
  assert.equal(watcherCalls, 0, "issuing and storing a ticket allocate no watcher");
  const authorization = gateway.consumeTicket(issued.ticket);
  assert.equal(watcherCalls, 0, "consumption alone still does not dispatch the handler");
  assert.equal(authorization.channel, "file-watch");
  assert.equal(Object.isFrozen(authorization.ticketContext), true);
  assert.deepEqual(Reflect.ownKeys(authorization.ticketContext), ["protocol", "version", "owner", "filePath", "observationClass"]);
  assert.equal(JSON.stringify(issued).includes("synthetic"), false);
});

test("production file-watch route preserves authorized non-NUL POSIX controls and allocates no wrapper or watcher before dispatch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-ticket-file-watch-"));
  const filePath = join(directory, "control\u0001name.txt");
  writeFileSync(filePath, "fixture");
  allowFileRoot(directory);
  const gateway = installTestGateway();
  const wrapperCountBefore = globalThis.__piSessions?.size ?? 0;
  try {
    const response = await POST(ticketRequest({ body: JSON.stringify({ channel: "file-watch", path: filePath }) }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(gateway.getStats().registeredChannelCount, 1);
    const authorization = gateway.consumeTicket(body.ticket);
    assert.equal(authorization.ticketContext.filePath, filePath);
    assert.equal(authorization.ticketContext.observationClass, "ordinary");
    assert.equal(globalThis.__piSessions?.size ?? 0, wrapperCountBefore);
  } finally {
    globalThis.__piAdditionalAllowedRoots?.delete(directory);
    globalThis.__piAllowedRootsCache?.roots.delete(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production file-watch route uses exact session-reference fallback outside ordinary roots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-ticket-file-reference-"));
  const sessionDirectory = join(directory, "sessions");
  const cwd = join(directory, "cwd");
  const outsideFile = join(directory, "outside.txt");
  writeFileSync(outsideFile, "fixture");
  const manager = SessionManager.create(cwd, sessionDirectory);
  const sessionId = manager.getSessionId();
  const sessionFile = manager.getSessionFile();
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd }),
    JSON.stringify({ type: "message", id: "00000001", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: outsideFile } }),
  ].join("\n") + "\n");
  cacheSessionPath(sessionId, sessionFile);
  const gateway = installTestGateway();
  try {
    const authorized = await POST(ticketRequest({ body: JSON.stringify({ channel: "file-watch", path: outsideFile, sessionId }) }));
    assert.equal(authorized.status, 200);
    gateway.consumeTicket((await authorized.json()).ticket);
    const wrong = await POST(ticketRequest({ body: JSON.stringify({ channel: "file-watch", path: outsideFile, sessionId: "00000000-0000-4000-8000-000000000000" }) }));
    assert.equal(wrong.status, 403);
    assert.equal(await responseError(wrong), "access_denied");
    const absent = await POST(ticketRequest({ body: JSON.stringify({ channel: "file-watch", path: outsideFile }) }));
    assert.equal(absent.status, 403);
  } finally {
    invalidateSessionPathCache(sessionId);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file-watch issuer rejects denied, missing, directory, and symlink-classifies without session startup", async () => {
  for (const [authorization, statValue, expected] of [
    ["denied", { isFile: () => true }, [403, "access_denied"]],
    ["allowed_root", new Error("missing"), [404, "file_unavailable"]],
    ["allowed_root", { isFile: () => false }, [400, "invalid_request"]],
  ]) {
    clearGateway(); const gateway = installTestGateway(); let ensureCalls = 0;
    const outcome = await createFileWatchTicketIssuer({
      async authorize() { return authorization; },
      stat() { if (statValue instanceof Error) throw statValue; return statValue; },
      lstat() { return { isSymbolicLink: () => false }; },
      ensureChannel() { ensureCalls += 1; },
    })(gateway, "/synthetic/file", null);
    assert.deepEqual(outcome, { ok: false, status: expected[0], error: expected[1] });
    assert.equal(ensureCalls, 0);
  }
  clearGateway();
  const symlinkGateway = installTestGateway();
  const symlink = await createFileWatchTicketIssuer({
    async authorize() { return "allowed_root"; },
    stat() { return { isFile: () => true }; },
    lstat() { return { isSymbolicLink: () => true }; },
    ensureChannel(currentGateway) { currentGateway.registerChannel("file-watch", () => {}); },
  })(symlinkGateway, "/synthetic/link", null);
  assert.equal(symlink.ok, true);
  assert.equal(symlinkGateway.consumeTicket(symlink.ticket).ticketContext.observationClass, "symlink");

  const routeSource = await readFile(new URL("./transport-ticket-route.ts", import.meta.url), "utf8");
  const fileIssuerStartMarker = "export function createFileWatchTicketIssuer";
  const fileIssuerEndMarker = "const issueFileWatchTicket";
  const fileIssuerStart = routeSource.indexOf(fileIssuerStartMarker);
  const fileIssuerEnd = routeSource.indexOf(fileIssuerEndMarker);
  assert.notEqual(fileIssuerStart, -1, "file-watch issuer start marker must exist");
  assert.notEqual(fileIssuerEnd, -1, "file-watch issuer end marker must exist");
  assert.ok(fileIssuerStart < fileIssuerEnd, "file-watch issuer markers must be ordered");
  const fileIssuerSource = routeSource.slice(fileIssuerStart, fileIssuerEnd);
  assert.doesNotMatch(fileIssuerSource, /startRpcSession|getOrCreateRpcSession|getRpcSession/);
});

test("file-watch exact body and decoded path limits preserve legacy 1024-byte ceilings", async () => {
  installTestGateway();
  const exact = JSON.stringify({ channel: "file-watch", path: "/missing" });
  const padded = exact.slice(0, -1) + " ".repeat(26_624 - Buffer.byteLength(exact)) + "}";
  assert.equal(Buffer.byteLength(padded), 26_624);
  const acceptedBoundary = await POST(ticketRequest({ body: padded }));
  assert.notEqual(acceptedBoundary.status, 413, "exact parsed file-watch shape reaches authorization at the body boundary");
  assert.equal(await responseError(acceptedBoundary), "access_denied");

  const over = exact.slice(0, -1) + " ".repeat(26_625 - Buffer.byteLength(exact)) + "}";
  const rejectedBoundary = await POST(ticketRequest({ body: over }));
  assert.equal(rejectedBoundary.status, 413);
  assert.equal(await responseError(rejectedBoundary), "body_too_large");

  const legacy = JSON.stringify({ channel: "test.route" }).slice(0, -1) + " ".repeat(1_025 - Buffer.byteLength(JSON.stringify({ channel: "test.route" }))) + "}";
  assert.equal((await POST(ticketRequest({ body: legacy }))).status, 413);
  const unknown = JSON.stringify({ channel: "unknown.route" }).slice(0, -1) + " ".repeat(1_025 - Buffer.byteLength(JSON.stringify({ channel: "unknown.route" }))) + "}";
  assert.equal((await POST(ticketRequest({ body: unknown }))).status, 413);
  const oversizedSession = JSON.stringify({ channel: "session", sessionId: "valid" }).slice(0, -1) + " ".repeat(1_025 - Buffer.byteLength(JSON.stringify({ channel: "session", sessionId: "valid" }))) + "}";
  assert.equal((await POST(ticketRequest({ body: oversizedSession }))).status, 413);

  const oneOverDecoded = JSON.stringify({ channel: "file-watch", path: `/${"x".repeat(4096)}` });
  const decodedResponse = await POST(ticketRequest({ body: oneOverDecoded }));
  assert.equal(decodedResponse.status, 400);
  assert.equal(await responseError(decodedResponse), "invalid_request");
});

test("canonical worst-case controls and alternate escapes are measured after JSON decoding", async () => {
  installTestGateway();
  const canonical = JSON.stringify({
    channel: "file-watch",
    path: `/${"\u0001".repeat(4095)}`,
    sessionId: "s".repeat(256),
  });
  assert.ok(Buffer.byteLength(canonical) <= 26_161);
  const canonicalResponse = await POST(ticketRequest({ body: canonical }));
  assert.notEqual(canonicalResponse.status, 413);
  assert.equal(await responseError(canonicalResponse), "access_denied");

  const alternateExact = `{"channel":"file-watch","path":"/${"\\u0061".repeat(4095)}"}`;
  assert.equal(Buffer.byteLength(JSON.parse(alternateExact).path), 4096);
  const alternateResponse = await POST(ticketRequest({ body: alternateExact }));
  assert.notEqual(alternateResponse.status, 400, "alternate escapes are bounded after parsing");
  const alternateOver = `{"channel":"file-watch","path":"/${"\\u0061".repeat(4096)}"}`;
  assert.equal((await POST(ticketRequest({ body: alternateOver }))).status, 400);
});

test("returns only a no-store ticket and expiry for a registered channel", async () => {
  const gateway = installTestGateway();
  const handler = () => {};
  gateway.registerChannel("test.route", handler);

  const response = await POST(ticketRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.equal(response.headers.has("access-control-allow-headers"), false);

  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "ticket"]);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(body.ticket), true);
  assert.equal(Number.isSafeInteger(body.expiresAt), true);
  assert.equal(gateway.consumeTicket(body.ticket).handler, handler);
});
