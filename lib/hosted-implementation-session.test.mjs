import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL,
  HOSTED_IMPLEMENTATION_OWNER,
  HOSTED_IMPLEMENTATION_PROTOCOL,
  HOSTED_IMPLEMENTATION_VERSION,
  invalidateHostedImplementationCapability,
  registerHostedImplementationCapability,
} = await jiti.import("./hosted-implementation-session.ts");

function request(overrides = {}) {
  return {
    targetSessionId: "11111111-1111-4111-8111-111111111111",
    targetSessionFile: "/tmp/hosted-target.jsonl",
    targetCwd: "/tmp/hosted-target",
    kickoff: "PRIVATE_KICKOFF_SENTINEL",
    launchKind: "start",
    sourceSignal: undefined,
    ...overrides,
  };
}

function recordingLogger() {
  const lines = [];
  return {
    lines,
    logger: {
      info: (message) => lines.push(String(message)),
      error: (message) => lines.push(String(message)),
    },
  };
}

test("compatible capability exposes the narrow v1 request and response", async () => {
  const scope = Object.create(null);
  const { lines, logger } = recordingLogger();
  const calls = [];
  const registration = registerHostedImplementationCapability({
    logger,
    async startTarget(received, options) {
      calls.push({ received, options });
      options.lifecycle.ownershipAccepted();
      options.lifecycle.kickoffScheduled();
    },
  }, scope);

  assert.equal(registration.registered, true);
  const record = scope[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL];
  assert.equal(record.protocol, HOSTED_IMPLEMENTATION_PROTOCOL);
  assert.equal(record.version, HOSTED_IMPLEMENTATION_VERSION);
  assert.equal(record.owner, HOSTED_IMPLEMENTATION_OWNER);
  assert.equal(record.active, true);

  const controller = new AbortController();
  const launchRequest = request({ sourceSignal: controller.signal, launchKind: "orchestrate" });
  const response = await record.launch(launchRequest);

  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0].received, launchRequest);
  assert.deepEqual(Object.keys(calls[0].received).sort(), [
    "kickoff",
    "launchKind",
    "sourceSignal",
    "targetCwd",
    "targetSessionFile",
    "targetSessionId",
  ]);
  assert.equal("targetEnvironment" in calls[0].received, false);
  assert.equal("environment" in calls[0].received, false);
  assert.deepEqual(response, {
    protocol: HOSTED_IMPLEMENTATION_PROTOCOL,
    version: HOSTED_IMPLEMENTATION_VERSION,
    owner: HOSTED_IMPLEMENTATION_OWNER,
    runtimeId: record.runtimeId,
    outcome: "hosted",
    targetSessionId: launchRequest.targetSessionId,
  });
  assert.ok(lines.some((line) => line.includes("stage=ownership_accepted")));
  assert.ok(lines.every((line) => line.length <= 512));
  assert.ok(lines.every((line) => !line.includes(launchRequest.kickoff)));
  assert.ok(lines.every((line) => !line.includes(launchRequest.targetSessionFile)));
  assert.ok(lines.every((line) => !line.includes(launchRequest.targetCwd)));
});

test("same-runtime reload invalidates the old callback and replaces only the capability record", async () => {
  const scope = Object.create(null);
  const first = registerHostedImplementationCapability({ startTarget: async () => {} }, scope);
  assert.equal(first.registered, true);
  const firstRecord = first.record;
  const runtimeId = firstRecord.runtimeId;

  const second = registerHostedImplementationCapability({ startTarget: async () => {} }, scope);
  assert.equal(second.registered, true);
  assert.equal(firstRecord.active, false);
  assert.equal(second.record.runtimeId, runtimeId);
  assert.notStrictEqual(second.record, firstRecord);
  await assert.rejects(() => firstRecord.launch(request()), /invalidated/);

  invalidateHostedImplementationCapability(scope);
  assert.equal(second.record.active, false);
  await assert.rejects(() => second.record.launch(request()), /invalidated/);
});

test("a callback invalidated during registration cannot publish ownership", async () => {
  const scope = Object.create(null);
  let releasePreparation;
  const preparation = new Promise((resolve) => { releasePreparation = resolve; });
  let finalCapabilityCheck;
  const first = registerHostedImplementationCapability({
    async startTarget(_request, options) {
      await preparation;
      finalCapabilityCheck = options.isCapabilityActive();
      if (!finalCapabilityCheck) throw new Error("invalidated before publication");
    },
  }, scope);
  assert.equal(first.registered, true);
  const pendingLaunch = first.record.launch(request());

  const replacement = registerHostedImplementationCapability({ startTarget: async () => {} }, scope);
  assert.equal(replacement.registered, true);
  releasePreparation();
  await assert.rejects(pendingLaunch, /registration failed/);
  assert.equal(finalCapabilityCheck, false);
  assert.equal(replacement.record.active, true);
});

test("foreign and incompatible records are preserved instead of overwritten", () => {
  for (const foreign of [
    { protocol: HOSTED_IMPLEMENTATION_PROTOCOL, version: 1, owner: "another-host", runtimeId: "foreign", active: true, launch() {} },
    { protocol: HOSTED_IMPLEMENTATION_PROTOCOL, version: 2, owner: HOSTED_IMPLEMENTATION_OWNER, runtimeId: "future", active: true, launch() {} },
    { protocol: HOSTED_IMPLEMENTATION_PROTOCOL, version: 1, owner: HOSTED_IMPLEMENTATION_OWNER, runtimeId: "", active: true, launch() {} },
    { malformed: true },
  ]) {
    const scope = Object.create(null);
    scope[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL] = foreign;
    const result = registerHostedImplementationCapability({ startTarget: async () => {} }, scope);
    assert.equal(result.registered, false);
    assert.strictEqual(scope[HOSTED_IMPLEMENTATION_CAPABILITY_SYMBOL], foreign);
  }
});

test("registration failures and lifecycle errors never log private payloads", async () => {
  const scope = Object.create(null);
  const { lines, logger } = recordingLogger();
  const privateError = new Error(
    "PRIVATE_KICKOFF_SENTINEL SECRET_ENV=credential provider-payload tool-payload conversation-text\n" + "x".repeat(2_000),
  );
  const registration = registerHostedImplementationCapability({
    logger,
    async startTarget() {
      throw privateError;
    },
  }, scope);
  assert.equal(registration.registered, true);

  await assert.rejects(
    () => registration.record.launch(request()),
    /Pi Web hosted target registration failed \(Error\)/,
  );
  const output = lines.join("\n");
  for (const forbidden of [
    "PRIVATE_KICKOFF_SENTINEL",
    "SECRET_ENV",
    "credential",
    "provider-payload",
    "tool-payload",
    "conversation-text",
  ]) {
    assert.equal(output.includes(forbidden), false, `diagnostics leaked ${forbidden}`);
  }
  assert.ok(lines.some((line) => line.includes("stage=registration_failed")));
  assert.ok(lines.every((line) => line.length <= 512));
});

test("request validation accepts an unavailable idle source signal but rejects malformed or widened requests", async () => {
  const scope = Object.create(null);
  let calls = 0;
  const registration = registerHostedImplementationCapability({
    startTarget: async () => { calls += 1; },
  }, scope);
  assert.equal(registration.registered, true);

  await registration.record.launch(request({ sourceSignal: undefined }));
  assert.equal(calls, 1);
  await assert.rejects(() => registration.record.launch(request({ targetSessionFile: "relative.jsonl" })), /must be absolute/);
  await assert.rejects(() => registration.record.launch(request({ targetCwd: "relative" })), /must be absolute/);
  await assert.rejects(() => registration.record.launch(request({ targetSessionId: "bad id" })), /session ID/);
  await assert.rejects(() => registration.record.launch(request({ launchKind: "other" })), /launch kind/);
  await assert.rejects(() => registration.record.launch(request({ sourceSignal: {} })), /source signal/);
  await assert.rejects(
    () => registration.record.launch(request({ targetEnvironment: { PRIVATE_VALUE: "must-not-cross" } })),
    /exactly the supported fields/,
  );
  await assert.rejects(
    () => registration.record.launch(request({ environment: { PRIVATE_VALUE: "must-not-cross" } })),
    /exactly the supported fields/,
  );
  assert.equal(calls, 1, "invalid or widened requests must not reach target registration");
});
