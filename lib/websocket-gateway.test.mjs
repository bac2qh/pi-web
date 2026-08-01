import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  PI_WEB_TRANSPORT_GATEWAY_SLOT,
  PI_WEB_TRANSPORT_GATEWAY_VERSION,
  PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES,
  PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER,
  PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL,
  PI_WEB_TRANSPORT_PATH,
  PI_WEB_TRANSPORT_TICKET_TTL_MS,
  createPiWebTransportGateway,
  getInstalledPiWebTransportGateway,
  installPiWebTransportGateway,
  uninstallPiWebTransportGateway,
  isSameHostBrowserOrigin,
} = require("../bin/pi-web-transport-gateway.js");

function clearInstalledGateway() {
  delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
}

function gatewayErrorCode(action) {
  try {
    action();
  } catch (error) {
    return error?.code;
  }
  return null;
}

function createFakeClock() {
  let now = 1_000;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now: () => now,
    setTimeout(callback, delay) {
      const timer = {
        id: nextTimerId,
        at: now + delay,
        callback,
        unref() {},
      };
      nextTimerId += 1;
      timers.set(timer.id, timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timers.delete(timer.id);
    },
    advance(milliseconds) {
      now += milliseconds;
      const due = [...timers.values()]
        .filter((timer) => timer.at <= now)
        .sort((first, second) => first.at - second.at);
      for (const timer of due) {
        timers.delete(timer.id);
        timer.callback();
      }
    },
    timerCount: () => timers.size,
  };
}

function deterministicRandomBytes() {
  let nextByte = 1;
  return (size) => {
    const value = Buffer.alloc(size, nextByte);
    nextByte = (nextByte + 1) & 0xff;
    return value;
  };
}

function createTestGateway(options = {}) {
  return createPiWebTransportGateway({
    randomUUID: () => options.instanceId ?? "00000000-0000-4000-8000-000000000001",
    randomBytes: options.randomBytes ?? deterministicRandomBytes(),
    now: options.clock?.now,
    setTimeout: options.clock?.setTimeout,
    clearTimeout: options.clock?.clearTimeout,
    diagnostics: options.diagnostics,
  });
}

test.beforeEach(clearInstalledGateway);
test.afterEach(clearInstalledGateway);

test("defines the exact V1 transport constants", () => {
  assert.equal(PI_WEB_TRANSPORT_GATEWAY_VERSION, 1);
  assert.equal(PI_WEB_TRANSPORT_GATEWAY_SLOT, "__piWebTransportGatewayV1");
  assert.equal(PI_WEB_TRANSPORT_TICKET_TTL_MS, 30_000);
  assert.equal(PI_WEB_TRANSPORT_PATH, "/_pi/websocket");
  assert.equal(PI_WEB_TRANSPORT_MAX_PAYLOAD_BYTES, 16 * 1024);
  assert.equal(PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER, 64);
  assert.equal(PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL, 256);
});

test("installs one versioned process gateway and uninstalls by identity", () => {
  const first = createTestGateway();
  const second = createTestGateway({ instanceId: "00000000-0000-4000-8000-000000000002" });

  assert.equal(installPiWebTransportGateway(first), first);
  assert.equal(getInstalledPiWebTransportGateway(), first);
  assert.equal(gatewayErrorCode(() => installPiWebTransportGateway(second)), "gateway_already_installed");
  assert.equal(uninstallPiWebTransportGateway(second), false);
  assert.equal(getInstalledPiWebTransportGateway(), first);
  assert.equal(uninstallPiWebTransportGateway(first), true);
  assert.equal(getInstalledPiWebTransportGateway(), undefined);

  globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] = { version: 2 };
  assert.equal(gatewayErrorCode(() => getInstalledPiWebTransportGateway()), "gateway_version_mismatch");
  assert.equal(gatewayErrorCode(() => installPiWebTransportGateway(second)), "gateway_version_mismatch");

  for (const occupiedValue of [undefined, null, false, 0, ""]) {
    globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT] = occupiedValue;
    assert.equal(gatewayErrorCode(() => getInstalledPiWebTransportGateway()), "gateway_version_mismatch");
    assert.equal(gatewayErrorCode(() => installPiWebTransportGateway(second)), "gateway_version_mismatch");
    assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], occupiedValue);
    delete globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT];
  }
});

test("registers exact handlers and consumes opaque tickets only once", () => {
  const clock = createFakeClock();
  const gateway = createTestGateway({ clock });
  const handler = () => {};
  const unregister = gateway.registerChannel("test.echo", handler);

  assert.equal(gatewayErrorCode(() => gateway.registerChannel("test.echo", handler)), "duplicate_channel");
  assert.equal(gatewayErrorCode(() => gateway.registerChannel("INVALID", handler)), "invalid_channel");
  assert.equal(gatewayErrorCode(() => gateway.issueTicket("missing")), "channel_unavailable");

  const first = gateway.issueTicket("test.echo");
  const second = gateway.issueTicket("test.echo");
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(first.ticket), true);
  assert.equal(first.ticket === second.ticket, false);
  assert.equal(first.expiresAt, clock.now() + PI_WEB_TRANSPORT_TICKET_TTL_MS);
  assert.equal(gateway.getStats().pendingTicketCount, 2);

  const consumed = gateway.consumeTicket(first.ticket);
  assert.equal(consumed.handler, handler);
  assert.equal(consumed.channel, "test.echo");
  assert.equal(gatewayErrorCode(() => gateway.consumeTicket(first.ticket)), "invalid_ticket");

  assert.equal(unregister(), true);
  assert.equal(unregister(), false);
  assert.equal(gatewayErrorCode(() => gateway.consumeTicket(second.ticket)), "invalid_ticket");
  assert.deepEqual(gateway.getStats(), {
    closed: false,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
});

test("enforces exact per-peer and total admission with idempotent reusable release", () => {
  const diagnostics = [];
  const gateway = createTestGateway({ diagnostics: (entry) => diagnostics.push(entry) });
  const peerReleases = [];
  for (let index = 0; index < PI_WEB_TRANSPORT_MAX_CONNECTIONS_PER_PEER; index += 1) {
    peerReleases.push(gateway.reserveConnection("direct-peer-a"));
  }
  assert.equal(gateway.getStats().activeConnectionCount, 64);
  assert.equal(gateway.getStats().activePeerKeyCount, 1);
  assert.equal(
    gatewayErrorCode(() => gateway.reserveConnection("direct-peer-a")),
    "connection_limit",
  );

  assert.equal(peerReleases[0](), true);
  assert.equal(peerReleases[0](), false);
  const readmittedPeer = gateway.reserveConnection("direct-peer-a");
  assert.equal(gateway.getStats().activeConnectionCount, 64);
  for (const release of peerReleases.slice(1)) release();
  readmittedPeer();
  assert.equal(gateway.getStats().activePeerKeyCount, 0);

  const totalReleases = [];
  for (let peer = 0; peer < 4; peer += 1) {
    for (let index = 0; index < 64; index += 1) {
      totalReleases.push(gateway.reserveConnection(`direct-peer-${peer}`));
    }
  }
  assert.deepEqual(gateway.getStats(), {
    closed: false,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: PI_WEB_TRANSPORT_MAX_CONNECTIONS_TOTAL,
    activePeerKeyCount: 4,
  });
  assert.equal(
    gatewayErrorCode(() => gateway.reserveConnection("direct-peer-fifth")),
    "connection_limit",
  );
  assert.equal(totalReleases[0](), true);
  const reusedTotal = gateway.reserveConnection("direct-peer-fifth");
  assert.equal(gateway.getStats().activeConnectionCount, 256);
  assert.equal(reusedTotal(), true);
  for (const release of totalReleases) release();
  assert.equal(gateway.getStats().activeConnectionCount, 0);
  assert.equal(gateway.getStats().activePeerKeyCount, 0);

  for (const unavailable of [undefined, null, "", " peer", "peer "]) {
    assert.equal(gatewayErrorCode(() => gateway.reserveConnection(unavailable)), "peer_unavailable");
  }
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("direct-peer"), false);
  assert.match(serialized, /peer_limit/);
  assert.match(serialized, /total_limit/);
  assert.match(serialized, /peer_unavailable/);
});

test("gateway close releases residual admission without underflow", () => {
  const gateway = createTestGateway();
  const release = gateway.reserveConnection("direct-peer");
  gateway.close();
  assert.equal(release(), false);
  assert.equal(release(), false);
  assert.deepEqual(gateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
});

test("expires unused tickets at the 30-second boundary", () => {
  const clock = createFakeClock();
  const gateway = createTestGateway({ clock });
  gateway.registerChannel("test.expiry", () => {});

  const beforeBoundary = gateway.issueTicket("test.expiry");
  clock.advance(PI_WEB_TRANSPORT_TICKET_TTL_MS - 1);
  assert.equal(typeof gateway.consumeTicket(beforeBoundary.ticket).handler, "function");

  const atBoundary = gateway.issueTicket("test.expiry");
  clock.advance(PI_WEB_TRANSPORT_TICKET_TTL_MS);
  assert.equal(gatewayErrorCode(() => gateway.consumeTicket(atBoundary.ticket)), "invalid_ticket");
  assert.equal(clock.timerCount(), 0);
});

test("close clears timers, registrations, tickets, and the global slot", () => {
  const clock = createFakeClock();
  const gateway = createTestGateway({ clock });
  installPiWebTransportGateway(gateway);
  gateway.registerChannel("test.close", () => {});
  const issued = gateway.issueTicket("test.close");
  assert.equal(clock.timerCount(), 1);

  gateway.close();
  gateway.close();

  assert.equal(clock.timerCount(), 0);
  assert.equal(globalThis[PI_WEB_TRANSPORT_GATEWAY_SLOT], undefined);
  assert.deepEqual(gateway.getStats(), {
    closed: true,
    registeredChannelCount: 0,
    pendingTicketCount: 0,
    activeConnectionCount: 0,
    activePeerKeyCount: 0,
  });
  assert.equal(gatewayErrorCode(() => gateway.consumeTicket(issued.ticket)), "gateway_closed");
  assert.equal(gatewayErrorCode(() => gateway.issueTicket("test.close")), "gateway_closed");
  assert.equal(gatewayErrorCode(() => gateway.registerChannel("test.close", () => {})), "gateway_closed");
});

test("same-host origin validation rejects malformed and cross-host values", () => {
  assert.equal(isSameHostBrowserOrigin("http://localhost:30141", "localhost:30141"), true);
  assert.equal(isSameHostBrowserOrigin("https://example.com", "EXAMPLE.com:443"), true);
  assert.equal(isSameHostBrowserOrigin("http://[::1]:30141", "[::1]:30141"), true);

  for (const [origin, host] of [
    [null, "localhost:30141"],
    ["null", "localhost:30141"],
    ["file://localhost", "localhost"],
    ["http://localhost:30141/", "localhost:30141"],
    ["http://user@localhost:30141", "localhost:30141"],
    ["http://localhost:30141/path", "localhost:30141"],
    ["http://localhost:30141", "other:30141"],
    ["http://localhost:30141", "localhost:30142"],
    ["http://localhost:30141", "@localhost:30141"],
    ["http://localhost:30141", "localhost:"],
    ["http://localhost:30141", "localhost:not-a-port"],
    ["http://localhost:30141", "localhost:65536"],
    ["http://[::1]:30141", "[::1]:"],
    ["http://localhost:30141, http://localhost:30141", "localhost:30141"],
  ]) {
    assert.equal(isSameHostBrowserOrigin(origin, host), false);
  }
});

test("diagnostics and error messages never contain ticket secrets", () => {
  const diagnostics = [];
  const gateway = createTestGateway({ diagnostics: (entry) => diagnostics.push(entry) });
  gateway.registerChannel("test.redaction", () => {});
  const issued = gateway.issueTicket("test.redaction");
  gateway.consumeTicket(issued.ticket);
  const reusedCode = gatewayErrorCode(() => gateway.consumeTicket(issued.ticket));

  assert.equal(reusedCode, "invalid_ticket");
  assert.equal(JSON.stringify(diagnostics).includes(issued.ticket), false);
  assert.equal(String(gatewayErrorCode(() => gateway.consumeTicket("not-a-ticket"))).includes(issued.ticket), false);
});
