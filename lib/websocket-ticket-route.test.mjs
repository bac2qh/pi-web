import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const { POST, createSessionTicketIssuer } = await jiti.import("../app/api/transport/ticket/route.ts");
const { ProjectedSessionEventHub } = await jiti.import("./session-event-hub.ts");
const { getRpcSession } = await jiti.import("./rpc-manager.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");

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

function fakeSessionTarget({ id = "synthetic", file = "/synthetic/session.jsonl", cwd = "/synthetic/cwd", alive = true, closed = false } = {}) {
  const hub = new ProjectedSessionEventHub({ streamEpoch: "synthetic-epoch" });
  if (closed) hub.close();
  return {
    hub,
    wrapper: {
      sessionId: id,
      sessionFile: file,
      inner: { sessionManager: { getCwd: () => cwd } },
      isAlive: () => alive,
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
  assert.deepEqual(fixture.calls, ["ensure", "resolve", "header", "get"]);
  const authorization = gateway.consumeTicket(outcome.ticket);
  assert.equal(authorization.channel, "session");
  assert.deepEqual(Reflect.ownKeys(authorization.ticketContext), ["protocol", "version", "owner", "wrapper", "hub"]);
  assert.equal(Object.isFrozen(authorization.ticketContext), true);
  assert.strictEqual(authorization.ticketContext.wrapper, fixture.target.wrapper);
  assert.strictEqual(authorization.ticketContext.hub, fixture.target.hub);
  assert.deepEqual(Object.keys(outcome).sort(), ["expiresAt", "ok", "ticket"]);
  assert.equal(JSON.stringify(outcome).includes("synthetic"), false);
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
  const cwd = join(directory, "cwd");
  const manager = SessionManager.create(cwd, directory);
  const sessionId = manager.getSessionId();
  const sessionFile = manager.getSessionFile();
  writeFileSync(sessionFile, `${JSON.stringify({
    type: "session", version: 3, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd,
  })}\n`);
  cacheSessionPath(sessionId, sessionFile);
  const previousLocks = globalThis.__piStartLocks;
  class TrackingStartLocks extends Map {
    setCalls = 0;
    set(key, value) { this.setCalls += 1; return super.set(key, value); }
  }
  const trackingLocks = new TrackingStartLocks();
  globalThis.__piStartLocks = trackingLocks;
  const gateway = installTestGateway();

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

    const wrapper = getRpcSession(sessionId);
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
    getRpcSession(sessionId)?.destroy();
    globalThis.__piSessions?.delete(sessionId);
    invalidateSessionPathCache(sessionId);
    globalThis.__piStartLocks = previousLocks;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("session issuer applies validatePrepared and post-start identity checks", async () => {
  const gateway = installTestGateway();
  const fixture = sessionIssuerDependencies({ existing: false });
  const outcome = await createSessionTicketIssuer(fixture.dependencies)(gateway, "synthetic");
  assert.equal(outcome.ok, true);
  assert.deepEqual(fixture.calls, ["ensure", "resolve", "header", "get", "start"]);

  clearGateway();
  const conflictGateway = installTestGateway();
  const wrong = fakeSessionTarget({ id: "wrong" });
  const conflict = sessionIssuerDependencies({ existing: false, target: wrong });
  const rejected = await createSessionTicketIssuer(conflict.dependencies)(conflictGateway, "synthetic");
  assert.deepEqual(rejected, { ok: false, status: 409, error: "session_transport_unavailable" });
  assert.equal(conflictGateway.getStats().pendingTicketCount, 0);
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
