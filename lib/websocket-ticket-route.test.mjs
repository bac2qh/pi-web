import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const {
  PI_WEB_TRANSPORT_GATEWAY_SLOT,
  createPiWebTransportGateway,
  installPiWebTransportGateway,
} = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("../app/api/transport/ticket/route.ts");

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
