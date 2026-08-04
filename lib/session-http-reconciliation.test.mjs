import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const protocol = await jiti.import("./session-protocol.ts");
const { SessionHttpReconciliation } = await jiti.import("./session-http-reconciliation.ts");

function observation(patch = {}) {
  const state = protocol.freezeCanonicalData({
    ...protocol.createInitialProjectedSessionState(),
    transcriptRevision: patch.transcriptRevision ?? 0,
    transcriptRefreshRequired: patch.transcriptRefreshRequired ?? false,
    runtimeRefreshRequired: patch.runtimeRefreshRequired ?? false,
  });
  const transport = patch.transport ?? protocol.freezeCanonicalData({
    connectionState: "connected", serverInstanceId: "server", streamEpoch: patch.streamEpoch ?? "epoch",
    cursor: patch.cursor ?? 3, state, readyOutcome: "exact", errorClass: null, revision: patch.revision ?? 4,
  });
  return Object.freeze({
    sessionId: patch.sessionId ?? "session",
    viewGeneration: patch.viewGeneration ?? 2,
    transport,
    selectedLeafId: patch.selectedLeafId ?? "leaf",
    leafGeneration: patch.leafGeneration ?? 5,
    promptUiGeneration: patch.promptUiGeneration ?? 7,
    promptRunGeneration: patch.promptRunGeneration ?? 11,
    promptLineage: patch.promptLineage === undefined ? 13 : patch.promptLineage,
  });
}

test("unchanged current token applies and records sticky marker tuple without clearing it", () => {
  const coordinator = new SessionHttpReconciliation();
  const current = observation({ transcriptRefreshRequired: true, runtimeRefreshRequired: true });
  assert.equal(coordinator.needsRepair("transcript", current), true);
  const token = coordinator.begin("transcript", current);
  assert.equal(coordinator.decide(token, current), "accepted");
  assert.equal(coordinator.finish(token, current, true), "accepted");
  assert.equal(current.transport.state.transcriptRefreshRequired, true, "server marker remains sticky");
  assert.equal(coordinator.needsRepair("transcript", current), false, "same observed tuple is already repaired");
});

test("every view cursor epoch leaf request and runtime run advance rejects stale response", () => {
  const cases = [
    ["session", { sessionId: "other" }, "stale_view"],
    ["session", { viewGeneration: 3 }, "stale_view"],
    ["session", { cursor: 4 }, "stale_cursor"],
    ["session", { streamEpoch: "next" }, "stale_cursor"],
    ["session", { revision: 5 }, "stale_cursor"],
    ["session", { transcriptRevision: 1 }, "stale_cursor"],
    ["session", { selectedLeafId: "other-leaf" }, "stale_leaf"],
    ["session", { leafGeneration: 6 }, "stale_leaf"],
  ];
  for (const [, patch, expected] of cases) {
    const coordinator = new SessionHttpReconciliation();
    const before = observation();
    const token = coordinator.begin("transcript", before);
    assert.equal(coordinator.decide(token, observation(patch)), expected);
  }
  const coordinator = new SessionHttpReconciliation();
  const before = observation();
  const first = coordinator.begin("transcript", before);
  coordinator.begin("transcript", before);
  assert.equal(coordinator.decide(first, before), "superseded");
  const runtime = coordinator.begin("runtime", before);
  assert.equal(coordinator.decide(runtime, observation({ promptRunGeneration: 12 })), "stale_run");
  assert.equal(coordinator.decide(runtime, observation({ promptLineage: 14 })), "stale_run");
});

 test("initial null epoch and exact/recovery prior epochs are accepted according to committed receiver identity", () => {
  for (const before of [
    observation({ streamEpoch: null, cursor: 0, revision: 1 }),
    observation({ streamEpoch: "prior", cursor: 8, revision: 9 }),
  ]) {
    const coordinator = new SessionHttpReconciliation();
    const token = coordinator.begin("runtime", before);
    assert.equal(coordinator.finish(token, before, true), "accepted");
    assert.equal(coordinator.needsRepair("runtime", before), false);
  }
});

 test("after-apply transport advance retains dirty repair until a newest unchanged response succeeds", () => {
  const coordinator = new SessionHttpReconciliation();
  const before = observation({ transcriptRefreshRequired: true });
  const token = coordinator.begin("transcript", before);
  assert.equal(coordinator.decide(token, before), "accepted", "response was current immediately before application");
  const afterApply = observation({ cursor: before.transport.cursor + 1, revision: before.transport.revision + 1, transcriptRevision: 1, transcriptRefreshRequired: true });
  assert.equal(coordinator.finish(token, afterApply, true), "stale_cursor");
  assert.equal(coordinator.needsRepair("transcript", afterApply), true);
  const retry = coordinator.begin("transcript", afterApply);
  assert.equal(coordinator.finish(retry, afterApply, true), "accepted");
  assert.equal(coordinator.needsRepair("transcript", afterApply), false, "final quiescent tuple is repaired exactly once");
});

test("initial transcript and context reject optimistic UI generation advance before any cursor changes", () => {
  for (const resource of ["transcript", "context"]) {
    const coordinator = new SessionHttpReconciliation();
    const before = observation();
    const token = coordinator.begin(resource, before);
    const afterPrompt = observation({ transport: before.transport, promptUiGeneration: before.promptUiGeneration + 1 });
    assert.equal(afterPrompt.transport, before.transport, "cursor identity deliberately did not advance");
    assert.equal(coordinator.decide(token, afterPrompt), "stale_ui");
    coordinator.finish(token, afterPrompt, false);
    assert.equal(coordinator.needsRepair(resource, afterPrompt), true);
  }
});

test("selected context success also satisfies the transcript marker for the same observed tuple", () => {
  const coordinator = new SessionHttpReconciliation();
  const current = observation({ transcriptRefreshRequired: true });
  const token = coordinator.begin("context", current);
  assert.equal(coordinator.finish(token, current, true), "accepted");
  assert.equal(coordinator.needsRepair("context", current), false);
  assert.equal(coordinator.needsRepair("transcript", current), false);
});

test("context leaf and transcript UI gates are unconditional while runtime uses prompt run", () => {
  const coordinator = new SessionHttpReconciliation();
  const before = observation();
  const context = coordinator.begin("context", before);
  assert.equal(coordinator.decide(context, observation({ leafGeneration: 8 })), "stale_leaf");
  const runtime = coordinator.begin("runtime", before);
  assert.equal(coordinator.decide(runtime, observation({ transport: before.transport, promptUiGeneration: 99 })), "accepted");
  assert.equal(coordinator.decide(runtime, observation({ transport: before.transport, promptRunGeneration: 99 })), "stale_run");
});

test("failed unchanged HTTP tuples saturate at one slow retry until selected quiescence succeeds", () => {
  const coordinator = new SessionHttpReconciliation();
  const current = observation();
  assert.deepEqual([
    coordinator.consumeFailureRetryDelay("runtime", current),
    coordinator.consumeFailureRetryDelay("runtime", current),
    coordinator.consumeFailureRetryDelay("runtime", current),
    coordinator.consumeFailureRetryDelay("runtime", current),
    coordinator.consumeFailureRetryDelay("runtime", current),
  ], [250, 750, 2_000, 15_000, 15_000]);
  coordinator.markDirty("runtime");
  assert.equal(coordinator.needsRepair("runtime", current), true);
  assert.equal(coordinator.requestSchedule("runtime"), true);
  assert.equal(coordinator.requestSchedule("runtime"), false, "only one timer may be represented");
  coordinator.cancelSchedule("runtime");
  const token = coordinator.begin("runtime", current);
  assert.equal(coordinator.finish(token, current, true), "accepted");
  assert.equal(coordinator.needsRepair("runtime", current), false, "final unchanged success reaches quiescence");
  assert.equal(coordinator.consumeFailureRetryDelay("runtime", current), 250, "success resets bounded backoff");
});

test("failure backoff resets on every relevant leaf UI run lineage and transcript observation change", () => {
  const patches = [
    { sessionId: "other" }, { viewGeneration: 3 }, { streamEpoch: "next" }, { cursor: 4 },
    { revision: 5 }, { transcriptRevision: 1 }, { selectedLeafId: "next-leaf" },
    { leafGeneration: 6 }, { promptUiGeneration: 8 }, { promptRunGeneration: 12 },
    { promptLineage: 14 },
  ];
  for (const patch of patches) {
    const coordinator = new SessionHttpReconciliation();
    const before = observation();
    assert.equal(coordinator.consumeFailureRetryDelay("runtime", before), 250);
    assert.equal(coordinator.consumeFailureRetryDelay("runtime", before), 750);
    assert.equal(coordinator.consumeFailureRetryDelay("runtime", observation(patch)), 250, JSON.stringify(patch));
  }
});

test("dirty and scheduled repairs coalesce while one request is in flight and retry newest tuple", () => {
  const coordinator = new SessionHttpReconciliation();
  const before = observation({ transcriptRefreshRequired: true });
  const token = coordinator.begin("transcript", before);
  assert.equal(coordinator.requestSchedule("transcript"), false, "in-flight request coalesces marker");
  const after = observation({ cursor: 4, transcriptRevision: 1, transcriptRefreshRequired: true });
  assert.equal(coordinator.finish(token, after, false), "stale_cursor");
  assert.equal(coordinator.requestSchedule("transcript"), true);
  assert.equal(coordinator.requestSchedule("transcript"), false);
  coordinator.cancelSchedule("transcript");
  const retry = coordinator.begin("transcript", after);
  assert.equal(coordinator.finish(retry, after, true), "accepted");
  assert.equal(coordinator.needsRepair("transcript", after), false);
});
