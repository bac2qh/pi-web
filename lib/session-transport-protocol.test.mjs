import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-transport-protocol.ts");

const resume = (overrides = {}) => ({
  protocol: "pi-web-session-transport",
  version: 1,
  type: "resume",
  streamEpoch: null,
  cursor: null,
  ...overrides,
});
const ready = (overrides = {}) => ({
  protocol: "pi-web-session-transport",
  version: 1,
  type: "ready",
  serverInstanceId: "server",
  streamEpoch: "epoch",
  cursor: 42,
  outcome: "exact",
  ...overrides,
});

test("resume parser accepts only the exact null pair or bounded opaque cursor pair", () => {
  assert.deepEqual(protocol.parseSessionTransportResumeFrame(resume()).frame, resume());
  assert.equal(protocol.parseSessionTransportResumeFrame(resume({ streamEpoch: "e".repeat(128), cursor: Number.MAX_SAFE_INTEGER })).ok, true);
  for (const value of [
    resume({ streamEpoch: "epoch" }),
    resume({ cursor: 0 }),
    resume({ streamEpoch: "", cursor: 0 }),
    resume({ streamEpoch: "e".repeat(129), cursor: 0 }),
    resume({ streamEpoch: "epoch", cursor: -1 }),
    resume({ streamEpoch: "epoch", cursor: Number.MAX_SAFE_INTEGER + 1 }),
    resume({ extra: true }),
    { ...resume(), version: 2 },
    { ...resume(), type: "command" },
  ]) assert.equal(protocol.parseSessionTransportResumeFrame(value).ok, false);
  assert.equal(protocol.parseSessionTransportResumeText(JSON.stringify(resume())).ok, true);
  assert.equal(protocol.encodeSessionTransportResumeFrame(resume()), JSON.stringify(resume()));
  assert.throws(() => protocol.encodeSessionTransportResumeFrame(resume({ extra: true })), /invalid_session_transport_resume/);
  assert.equal(protocol.parseSessionTransportResumeText("not json").ok, false);
});

test("ready parser freezes the exact target-only V1 control vocabulary", () => {
  for (const outcome of ["exact", "empty", "initial_snapshot", "overflow_snapshot", "wrong_epoch", "invalid_cursor"]) {
    const frame = ready({ outcome });
    assert.deepEqual(protocol.parseSessionTransportReadyText(protocol.encodeSessionTransportReadyFrame(frame)).frame, frame);
  }
  assert.equal(protocol.parseSessionTransportReadyFrame(ready({ serverInstanceId: "s".repeat(128), streamEpoch: "e".repeat(128) })).ok, true);
  for (const value of [
    ready({ serverInstanceId: "" }), ready({ serverInstanceId: "s".repeat(129) }),
    ready({ streamEpoch: "" }), ready({ cursor: -1 }), ready({ outcome: "closed" }), ready({ sessionId: "forbidden" }),
  ]) assert.equal(protocol.parseSessionTransportReadyFrame(value).ok, false);
});

test("exports the exact S3 bounds and close codes", () => {
  assert.equal(protocol.SESSION_TRANSPORT_RESUME_TIMEOUT_MS, 10_000);
  assert.equal(protocol.SESSION_TRANSPORT_CLOSE_FALLBACK_MS, 1_000);
  assert.equal(protocol.SESSION_TRANSPORT_OUTPUT_BYTES, 4 * 1024 * 1024);
  assert.deepEqual(protocol.SESSION_TRANSPORT_CLOSE, { binary: 1003, policy: 1008, internal: 1011, owner: 1012, slow: 1013 });
});
