import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const { createPiWebTransportGateway } = require("../bin/pi-web-transport-gateway.js");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const channel = await jiti.import("./session-channel.ts");
const protocol = await jiti.import("./session-protocol.ts");
const transport = await jiti.import("./session-transport-protocol.ts");
const { ProjectedSessionEventHub } = await jiti.import("./session-event-hub.ts");

class FakeSocket extends EventEmitter {
  constructor({ autoComplete = true } = {}) {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.bufferedAmount = 0;
    this.autoComplete = autoComplete;
    this.sent = [];
    this.pending = [];
    this.closeCalls = [];
    this.terminateCalls = 0;
    this.bufferedAfterSend = null;
  }
  send(text, callback) {
    this.sent.push(text);
    if (this.bufferedAfterSend !== null) this.bufferedAmount = this.bufferedAfterSend;
    if (this.autoComplete) callback?.();
    else this.pending.push(callback);
  }
  settle(error) { this.pending.shift()?.(error); }
  close(code, reason) {
    this.closeCalls.push([code, reason]);
    this.readyState = 3;
    this.emit("close", code, Buffer.from(reason));
  }
  terminate() {
    this.terminateCalls += 1;
    this.readyState = 3;
    this.emit("close", 1006);
  }
  clientMessage(value, isBinary = false) {
    this.emit("message", Buffer.isBuffer(value) ? value : Buffer.from(value), isBinary);
  }
}

class FakeWrapper {
  constructor(hub) {
    this.hub = hub;
    this.alive = true;
    this.destroyObservers = [];
    this.abortCalls = 0;
    this.destroyCalls = 0;
    this.disposeCalls = 0;
  }
  isAlive() { return this.alive; }
  getProjectedEventHub() { return this.hub; }
  onDestroy(callback) { this.destroyObservers.push(callback); }
  destroyOwner() {
    if (!this.alive) return;
    this.alive = false;
    this.hub.close();
    for (const callback of this.destroyObservers.splice(0)) callback();
  }
}

const resume = (streamEpoch = null, cursor = null) => JSON.stringify({
  protocol: "pi-web-session-transport", version: 1, type: "resume", streamEpoch, cursor,
});
const context = (wrapper, hub, serverInstanceId = "server") => ({
  channel: "session",
  serverInstanceId,
  ticketContext: channel.createSessionTicketContext(wrapper, hub),
});
const frames = (socket) => socket.sent.map((text) => JSON.parse(text));

function attach({ hub = new ProjectedSessionEventHub({ streamEpoch: "epoch", encodedUnitByteLimit: 400 }), socket = new FakeSocket(), registry = new Map(), options = {} } = {}) {
  const wrapper = new FakeWrapper(hub);
  const handler = channel.createSessionChannelHandler(registry, options);
  handler(socket, context(wrapper, hub));
  return { hub, socket, wrapper, registry, handler };
}

test.afterEach(() => { delete globalThis[channel.SESSION_REGISTRATION_TEST_SYMBOL]; });

test("initial resume sends strict ready then a complete canonical snapshot", () => {
  const { socket, wrapper, hub, registry } = attach();
  socket.clientMessage(resume());
  const sent = frames(socket);
  assert.equal(sent[0].type, "ready");
  assert.equal(sent[0].outcome, "initial_snapshot");
  assert.equal(sent[0].cursor, 0, "ready describes the target but applies no state");
  assert.equal(sent[1].type, "snapshot_start");
  assert.equal(sent.at(-1).type, "snapshot_end");
  assert.ok(sent.slice(2, -1).every((frame) => frame.type === "snapshot_chunk"));
  assert.equal(registry.size, 1);
  assert.equal(wrapper.destroyObservers.length, 1);
  assert.equal(hub.isClosed(), false);
});

test("current, exact, recovery, and zero-subscriber resumes use one atomic attach contract", () => {
  const hub = new ProjectedSessionEventHub({ streamEpoch: "epoch", replayByteLimit: 700, replayUnitLimit: 8, encodedUnitByteLimit: 400 });
  hub.accept({ type: "agent_start" });
  const current = attach({ hub });
  current.socket.clientMessage(resume("epoch", hub.cursor));
  assert.deepEqual(frames(current.socket).map((frame) => frame.type), ["ready"]);
  assert.equal(frames(current.socket)[0].outcome, "empty");

  const exact = attach({ hub });
  exact.socket.clientMessage(resume("epoch", 0));
  assert.equal(frames(exact.socket)[0].outcome, "exact");
  assert.deepEqual(frames(exact.socket).slice(1).map((frame) => frame.sequence), [1]);

  for (const [epoch, cursor, expected] of [["wrong", 0, "wrong_epoch"], ["epoch", hub.cursor + 1, "invalid_cursor"]]) {
    const recovered = attach({ hub });
    recovered.socket.clientMessage(resume(epoch, cursor));
    assert.equal(frames(recovered.socket)[0].outcome, expected);
    assert.equal(frames(recovered.socket)[1].type, "snapshot_start");
    assert.equal(frames(recovered.socket).at(-1).type, "snapshot_end");
  }

  current.socket.emit("close", 1000);
  exact.socket.emit("close", 1000);
  hub.accept({ type: "entry_appended", entry: { synthetic: true } });
  const later = attach({ hub });
  later.socket.clientMessage(resume("epoch", 1));
  assert.equal(frames(later.socket)[0].outcome, "exact");
  assert.deepEqual(frames(later.socket).slice(1).map((frame) => frame.sequence), [2]);
});

test("ready and returned reentrant units precede post-return listener FIFO", () => {
  let hub;
  let reentered = false;
  hub = new ProjectedSessionEventHub({
    streamEpoch: "epoch",
    diagnostic(entry) {
      if (!reentered && entry.kind === "replay") {
        reentered = true;
        hub.accept({ type: "entry_appended", entry: { synthetic: true } });
      }
    },
  });
  hub.accept({ type: "agent_start" });
  const attached = attach({ hub });
  attached.socket.clientMessage(resume("epoch", 0));
  hub.accept({ type: "agent_settled" });
  const sent = frames(attached.socket);
  assert.equal(sent[0].type, "ready");
  assert.deepEqual(sent.slice(1).map((frame) => frame.sequence), [1, 2, 3]);
});

test("channel ready preserves every reentrant selected target before buffered live units", () => {
  const cases = [
    { outcome: "empty", seed: 1, epoch: "epoch", cursor: 1 },
    { outcome: "initial_snapshot", seed: 1, epoch: null, cursor: null },
    { outcome: "wrong_epoch", seed: 1, epoch: "wrong", cursor: 0 },
    { outcome: "invalid_cursor", seed: 1, epoch: "epoch", cursor: 99 },
    { outcome: "exact", seed: 2, epoch: "epoch", cursor: 0 },
    { outcome: "overflow_snapshot", seed: 4, epoch: "epoch", cursor: 0, replayUnitLimit: 1 },
  ];
  for (const fixture of cases) {
    let hub;
    let reentered = false;
    hub = new ProjectedSessionEventHub({
      streamEpoch: "epoch",
      replayUnitLimit: fixture.replayUnitLimit ?? 100,
      replayByteLimit: 100_000,
      encodedUnitByteLimit: 400,
      diagnostic(entry) {
        if (!reentered && entry.kind === "replay") {
          reentered = true;
          hub.accept({ type: "entry_appended", entry: { synthetic: true } });
        }
      },
    });
    for (let index = 0; index < fixture.seed; index += 1) hub.accept({ type: "agent_settled" });
    const selectedCursor = hub.cursor;
    const attached = attach({ hub });
    attached.socket.clientMessage(resume(fixture.epoch, fixture.cursor));
    const sent = frames(attached.socket);
    assert.equal(sent[0].outcome, fixture.outcome);
    assert.equal(sent[0].cursor, selectedCursor, `${fixture.outcome} ready cursor`);
    assert.equal(sent.at(-1).sequence, selectedCursor + 1, `${fixture.outcome} buffered live sequence`);
    const targetUnits = sent.slice(1, -1);
    if (["initial_snapshot", "wrong_epoch", "invalid_cursor", "overflow_snapshot"].includes(fixture.outcome)) {
      assert.equal(targetUnits[0].type, "snapshot_start");
      assert.equal(targetUnits.at(-1).type, "snapshot_end");
      assert.ok(targetUnits.every((unit) => unit.sequence === selectedCursor));
    } else if (fixture.outcome === "empty") assert.equal(targetUnits.length, 0);
    else assert.ok(targetUnits.every((unit) => unit.sequence <= selectedCursor));
  }
});

test("healthy subscribers stay ordered while one stalled subscriber closes 1013", () => {
  const hub = new ProjectedSessionEventHub({ streamEpoch: "epoch", encodedUnitByteLimit: 400 });
  const registry = new Map();
  const wrapper = new FakeWrapper(hub);
  const stalled = new FakeSocket({ autoComplete: false });
  const healthy = new FakeSocket();
  const handler = channel.createSessionChannelHandler(registry, { outputByteLimit: 700 });
  handler(stalled, context(wrapper, hub));
  handler(healthy, context(wrapper, hub));
  stalled.clientMessage(resume("epoch", 0));
  healthy.clientMessage(resume("epoch", 0));
  for (let index = 0; index < 20 && stalled.closeCalls.length === 0; index += 1) {
    hub.accept({ type: "extension_ui_request", method: "setStatus", statusKey: `k${index}`, statusText: "v".repeat(100) });
  }
  assert.deepEqual(stalled.closeCalls.at(-1), [1013, "slow"]);
  assert.equal(healthy.closeCalls.length, 0);
  assert.ok(frames(healthy).some((frame) => frame.type === "extension_status_set"));
  const before = hub.cursor;
  hub.accept({ type: "entry_appended", entry: { synthetic: true } });
  assert.equal(hub.cursor, before + 1);
  assert.equal(wrapper.abortCalls + wrapper.destroyCalls + wrapper.disposeCalls, 0);
});

test("a mutable 8192-unit catch-up source drains nonrecursively through exactly one attach", () => {
  const seed = new ProjectedSessionEventHub({ streamEpoch: "epoch" });
  seed.accept({ type: "agent_start" });
  const unit = seed.replayAfter("epoch", 0).units[0];
  let attachCalls = 0;
  const hub = {
    streamEpoch: "epoch", cursor: 1,
    isClosed: () => false,
    replayAfter: () => { throw new Error("must not compose replay"); },
    snapshot: () => [], getState: () => ({}), getReplayOccupancy: () => ({ bytes: 0, units: 0, groups: 0, floor: 0, cursor: 1 }),
    attach() {
      attachCalls += 1;
      return { outcome: "exact", units: Array.from({ length: 8_192 }, () => unit), cursor: 1, streamEpoch: "epoch", unsubscribe() {} };
    },
  };
  const wrapper = new FakeWrapper(hub);
  const socket = new FakeSocket();
  channel.createSessionChannelHandler()(socket, context(wrapper, hub));
  assert.doesNotThrow(() => socket.clientMessage(resume("epoch", 0)));
  assert.equal(attachCalls, 1);
  assert.equal(socket.sent.length, 8_193);
  assert.equal(JSON.parse(socket.sent[0]).type, "ready");
});

test("default output admits exactly 4 MiB, rejects one over, and distinguishes transient retry recovery", () => {
  const limit = transport.SESSION_TRANSPORT_OUTPUT_BYTES;
  const base = {
    protocol: protocol.PROJECTED_SESSION_PROTOCOL,
    version: protocol.PROJECTED_SESSION_VERSION,
    streamEpoch: "epoch",
    sequence: 1,
    type: "notice",
    level: "info",
    message: "",
  };
  const envelopeBytes = Buffer.byteLength(JSON.stringify(base));
  const makeSizedFrame = (bytes) => {
    const candidate = { ...base, message: "x".repeat(bytes - envelopeBytes) };
    const parsed = protocol.parseProjectedSessionFrame(candidate);
    assert.equal(parsed.ok, true);
    const frame = protocol.freezeCanonicalData(parsed.frame);
    assert.equal(Buffer.byteLength(protocol.encodeProjectedSessionFrame(frame)), bytes);
    return frame;
  };
  const exactFrame = makeSizedFrame(limit);
  const oneOverFrame = makeSizedFrame(limit + 1);
  const hubForUnits = (units) => ({
    streamEpoch: "epoch", cursor: 1,
    isClosed: () => false,
    replayAfter: () => { throw new Error("unused"); },
    snapshot: () => [], getState: () => ({}),
    getReplayOccupancy: () => ({ bytes: 0, units: 0, groups: 0, floor: 0, cursor: 1 }),
    attach: () => ({ outcome: "exact", units, cursor: 1, streamEpoch: "epoch", unsubscribe() {} }),
  });

  const exactHub = hubForUnits([exactFrame]);
  const exactSocket = new FakeSocket();
  channel.createSessionChannelHandler()(exactSocket, context(new FakeWrapper(exactHub), exactHub));
  exactSocket.clientMessage(resume("epoch", 0));
  assert.equal(Buffer.byteLength(exactSocket.sent[1]), limit);
  assert.equal(exactSocket.closeCalls.length, 0);

  const overHub = hubForUnits([oneOverFrame]);
  const overSocket = new FakeSocket();
  channel.createSessionChannelHandler()(overSocket, context(new FakeWrapper(overHub), overHub));
  overSocket.clientMessage(resume("epoch", 0));
  assert.deepEqual(overSocket.closeCalls.at(-1), [1013, "slow"]);
  assert.equal(overSocket.sent.length, 1, "the one-over application frame is never sent or retained as text");

  const transientHub = new ProjectedSessionEventHub({ streamEpoch: "transient-epoch" });
  const wrapper = new FakeWrapper(transientHub);
  const transientSocket = new FakeSocket();
  const handler = channel.createSessionChannelHandler();
  handler(transientSocket, context(wrapper, transientHub));
  transientSocket.clientMessage(resume("transient-epoch", transientHub.cursor));
  const beforeTransient = transientHub.cursor;
  transientHub.accept({
    type: "extension_ui_request",
    method: "notify",
    notifyType: "warning",
    message: "x".repeat(limit + 1),
  });
  assert.deepEqual(transientSocket.closeCalls.at(-1), [1013, "slow"]);
  assert.equal(wrapper.alive, true);
  assert.equal(transientHub.cursor, beforeTransient + 1);
  assert.ok(transientHub.floor >= transientHub.cursor, "the oversized one-shot is not retained as replayable durable state");

  const recoveredSocket = new FakeSocket();
  handler(recoveredSocket, context(wrapper, transientHub));
  recoveredSocket.clientMessage(resume("transient-epoch", beforeTransient));
  const recovered = frames(recoveredSocket);
  assert.equal(recovered[0].outcome, "overflow_snapshot");
  assert.equal(recovered.some((frame) => frame.type === "notice"), false, "retry does not claim to recreate the transient effect");
  assert.equal(recovered[1].type, "snapshot_start");
  assert.equal(recovered[1].transcriptRefreshRequired, true, "canonical/HTTP refresh recovery remains explicit");
  assert.equal(recovered[1].runtimeRefreshRequired, true);
});

test("catch-up callbacks release source references and reuse only the weak trusted-frame cache", () => {
  const parsed = protocol.parseProjectedSessionFrame({
    protocol: protocol.PROJECTED_SESSION_PROTOCOL,
    version: protocol.PROJECTED_SESSION_VERSION,
    streamEpoch: "epoch",
    sequence: 1,
    type: "notice",
    level: "info",
    message: "cached",
  });
  assert.equal(parsed.ok, true);
  const frame = parsed.frame;
  let descriptors = 0;
  const originalDescriptor = Object.getOwnPropertyDescriptor;
  Object.getOwnPropertyDescriptor = (value, key) => {
    if (value === frame) descriptors += 1;
    return originalDescriptor(value, key);
  };
  try {
    const hub = {
      streamEpoch: "epoch", cursor: 1,
      isClosed: () => false,
      replayAfter: () => { throw new Error("unused"); },
      snapshot: () => [], getState: () => ({}),
      getReplayOccupancy: () => ({ bytes: 0, units: 0, groups: 0, floor: 0, cursor: 1 }),
      attach: () => ({ outcome: "exact", units: [frame, frame], cursor: 1, streamEpoch: "epoch", unsubscribe() {} }),
    };
    const observations = [];
    const socket = new FakeSocket({ autoComplete: false });
    channel.createSessionChannelHandler(new Map(), {
      referenceObserver(state) { observations.push(state); },
    })(socket, context(new FakeWrapper(hub), hub));
    socket.clientMessage(resume("epoch", 0));
    assert.deepEqual(observations.at(-1), {
      outcome: "catch_up_loaded", catchUpRetained: 2, liveRetained: 0, inFlightSource: false,
    });
    socket.settle();
    const afterFirstEncoding = descriptors;
    assert.ok(afterFirstEncoding > 0);
    socket.settle();
    assert.deepEqual(observations.findLast((item) => item.outcome === "source_released"), {
      outcome: "source_released", catchUpRetained: 1, liveRetained: 0, inFlightSource: false,
    });
    assert.equal(descriptors, afterFirstEncoding, "the second identical canonical frame is served from the shared weak cache");
    socket.emit("close", 1000);
    assert.deepEqual(observations.at(-1), {
      outcome: "cleanup_released", catchUpRetained: 0, liveRetained: 0, inFlightSource: false,
    });
  } finally {
    Object.getOwnPropertyDescriptor = originalDescriptor;
  }
});

test("binary, malformed, duplicate, timeout, send failure, and owner teardown use exact closes", () => {
  const binary = attach(); binary.socket.clientMessage(Buffer.from([1]), true);
  assert.deepEqual(binary.socket.closeCalls, [[1003, "binary"]]);
  const malformed = attach(); malformed.socket.clientMessage("{}");
  assert.deepEqual(malformed.socket.closeCalls, [[1008, "policy"]]);
  const duplicate = attach(); duplicate.socket.clientMessage(resume()); duplicate.socket.clientMessage(resume());
  assert.deepEqual(duplicate.socket.closeCalls.at(-1), [1008, "policy"]);

  const timers = [];
  const timeout = attach({ options: {
    setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
  } });
  assert.equal(timers[0].delay, 10_000);
  timers[0].callback();
  assert.deepEqual(timeout.socket.closeCalls.at(-1), [1008, "timeout"]);

  const callbackFailure = attach();
  callbackFailure.socket.autoComplete = false;
  callbackFailure.socket.clientMessage(resume());
  callbackFailure.socket.settle(new Error("synthetic"));
  assert.deepEqual(callbackFailure.socket.closeCalls.at(-1), [1011, "send"]);

  const preResumeOwner = attach();
  preResumeOwner.wrapper.destroyOwner();
  assert.deepEqual(preResumeOwner.socket.closeCalls.at(-1), [1012, "owner"]);
  assert.equal(preResumeOwner.registry.size, 0);

  const owner = attach();
  owner.socket.clientMessage(resume());
  owner.wrapper.destroyOwner();
  assert.deepEqual(owner.socket.closeCalls.at(-1), [1012, "owner"]);
  assert.equal(owner.registry.size, 0);
  assert.equal(owner.wrapper.destroyObservers.length, 0);
});

test("bufferedAmount fails closed and close fallback terminates at exactly 1000 ms", () => {
  const buffered = attach({ options: { outputByteLimit: 700 } });
  buffered.socket.bufferedAmount = 701;
  buffered.socket.clientMessage(resume());
  assert.deepEqual(buffered.socket.closeCalls.at(-1), [1013, "slow"]);

  const afterSend = attach({ options: { outputByteLimit: 700 } });
  afterSend.socket.bufferedAfterSend = 701;
  afterSend.socket.clientMessage(resume());
  assert.deepEqual(afterSend.socket.closeCalls.at(-1), [1013, "slow"]);

  const timers = [];
  const socket = new FakeSocket();
  socket.close = function close(code, reason) { this.closeCalls.push([code, reason]); this.readyState = 2; };
  const fallback = attach({ socket, options: {
    setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
  } });
  fallback.socket.clientMessage("{}");
  assert.deepEqual(fallback.socket.closeCalls, [[1008, "policy"]]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1_000);
  timers[0].callback();
  assert.equal(fallback.socket.terminateCalls, 1);
});

test("malformed internal context fails 1011 and disconnect never owns wrapper lifecycle", () => {
  const closedHub = new ProjectedSessionEventHub({ streamEpoch: "closed-before-dispatch" });
  const closedWrapper = new FakeWrapper(closedHub);
  const closedSocket = new FakeSocket();
  closedSocket.readyState = 3;
  const closedRegistry = new Map();
  const timerDelays = [];
  channel.createSessionChannelHandler(closedRegistry, {
    setTimeout(_callback, delay) { timerDelays.push(delay); return { unref() {} }; },
    clearTimeout() {},
  })(closedSocket, context(closedWrapper, closedHub));
  assert.equal(closedRegistry.size, 0);
  assert.deepEqual(timerDelays, []);

  const socket = new FakeSocket();
  channel.createSessionChannelHandler()(socket, { channel: "session", serverInstanceId: "server", ticketContext: Object.freeze({}) });
  assert.deepEqual(socket.closeCalls, [[1011, "internal"]]);

  const attached = attach();
  attached.socket.clientMessage(resume());
  attached.socket.emit("close", 1000);
  assert.equal(attached.wrapper.alive, true);
  assert.equal(attached.hub.isClosed(), false);
  assert.equal(attached.wrapper.abortCalls + attached.wrapper.destroyCalls + attached.wrapper.disposeCalls, 0);
});

test("registration is static, HMR-safe, preserves one owner observer, and revokes stale tickets", () => {
  const firstGateway = createPiWebTransportGateway();
  assert.deepEqual(channel.ensureSessionChannel(firstGateway), { channel: "session", reused: false });
  assert.deepEqual(channel.ensureSessionChannel(firstGateway), { channel: "session", reused: true });
  const hub = new ProjectedSessionEventHub({ streamEpoch: "epoch" });
  const wrapper = new FakeWrapper(hub);
  const ticketContext = channel.createSessionTicketContext(wrapper, hub);
  const firstTicket = firstGateway.issueTicket("session", ticketContext);

  const secondGateway = createPiWebTransportGateway();
  assert.deepEqual(channel.ensureSessionChannel(secondGateway), { channel: "session", reused: false });
  assert.throws(() => firstGateway.consumeTicket(firstTicket.ticket), (error) => error?.code === "invalid_ticket");
  const authorization = secondGateway.consumeTicket(secondGateway.issueTicket("session", ticketContext).ticket);
  const socket = new FakeSocket();
  authorization.handler(socket, { channel: authorization.channel, serverInstanceId: secondGateway.serverInstanceId, ticketContext: authorization.ticketContext });
  socket.emit("close", 1000);
  authorization.handler(new FakeSocket(), { channel: authorization.channel, serverInstanceId: secondGateway.serverInstanceId, ticketContext: authorization.ticketContext });
  assert.equal(wrapper.destroyObservers.length, 1);
  firstGateway.close(); secondGateway.close();
});
