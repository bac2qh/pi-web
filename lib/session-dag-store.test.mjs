import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SESSION_DAG_STATE_FILENAME,
  SessionDagListingChangedError,
  SessionDagMutationConflictResponseError,
  digestSessionDagMutation,
  mutateSessionDagState,
  readSessionDagState,
} = await jiti.import("./session-dag-store.ts");
const {
  SESSION_DAG_MAX_RECEIPTS,
  createDefaultStoredSessionDagState,
} = await jiti.import("./session-dag.ts");

const AVAILABLE = new Set(["A", "B", "C", "D"]);

async function withStore(t, run) {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-session-dag-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  return run(agentDir);
}

function mutation(mutationId, baseRevision, operation) {
  return { mutationId, baseRevision, operation };
}

function add(mutationId, baseRevision, edgeId, fromSessionId = "A", toSessionId = "B") {
  return mutation(mutationId, baseRevision, {
    type: "add_edge",
    edgeId,
    formId: "default",
    fromSessionId,
    toSessionId,
  });
}

function complete(mutationId, baseRevision, batchId, sessionId, expectedOutgoingEdgeIds) {
  return mutation(mutationId, baseRevision, {
    type: "complete",
    batchId,
    sessionId,
    expectedOutgoingEdgeIds,
  });
}

async function withCapturedErrors(run) {
  const original = console.error;
  const calls = [];
  console.error = (...args) => { calls.push(args); };
  try {
    return { value: await run(), calls };
  } finally {
    console.error = original;
  }
}

async function withMutedErrors(run) {
  return (await withCapturedErrors(run)).value;
}

test("missing storage returns a private default without creating a file", (t) => withStore(t, async (agentDir) => {
  const state = await readSessionDagState({ agentDir });
  assert.deepEqual(state, {
    version: 1,
    revision: 0,
    direction: "TD",
    forms: [{ id: "default" }],
    activeEdges: [],
    applied: [],
    redo: [],
    nextSequence: 1,
    nextEdgeOrder: 1,
  });
  assert.deepEqual(await readdir(agentDir), []);
  assert.equal("receipts" in state, false);
}));

test("mutations write atomically with private permissions and one semantic revision", (t) => withStore(t, async (agentDir) => {
  const result = await mutateSessionDagState(add("mutation-1", 0, "edge-1"), {
    agentDir,
    availableSessionIds: AVAILABLE,
  });
  assert.equal(result.changed, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.activeEdges[0].order, 1);

  const path = join(agentDir, SESSION_DAG_STATE_FILENAME);
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.equal(stored.revision, 1);
  assert.equal(stored.receipts.length, 1);
  assert.equal(stored.receipts[0].mutationId, "mutation-1");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(agentDir)).mode & 0o077, 0, "the owning directory is private");
  assert.deepEqual((await readdir(agentDir)).filter((name) => name.includes(".tmp-")), []);
  assert.equal((await readdir(agentDir)).some((name) => name.endsWith(".lock")), false);
}));

test("an exact retry is idempotent before stale-revision checks and mutation-id reuse conflicts", (t) => withStore(t, async (agentDir) => {
  const request = add("stable-mutation", 0, "edge-1");
  await mutateSessionDagState(request, { agentDir, availableSessionIds: AVAILABLE });
  const secondMutation = mutation("other-mutation", 1, {
    type: "create_form",
    formId: "second",
  });
  await mutateSessionDagState(secondMutation, { agentDir });

  const retry = await mutateSessionDagState(request, { agentDir, availableSessionIds: new Set() });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.changed, false);
  assert.equal(retry.state.revision, 2, "the retry returns current authority after later mutations");
  assert.equal(retry.state.activeEdges.length, 1);

  await assert.rejects(
    mutateSessionDagState(add("stable-mutation", 0, "different-edge", "A", "C"), {
      agentDir,
      availableSessionIds: AVAILABLE,
    }),
    (error) => error instanceof SessionDagMutationConflictResponseError
      && error.code === "session_dag_mutation_id_conflict"
      && error.state.revision === 2,
  );
  assert.equal((await readSessionDagState({ agentDir })).revision, 2);
}));

test("a first semantic no-op records a receipt without advancing revision", (t) => withStore(t, async (agentDir) => {
  const request = mutation("no-op", 0, {
    type: "set_direction",
    expectedDirection: "TD",
    direction: "TD",
  });
  const first = await mutateSessionDagState(request, { agentDir });
  assert.equal(first.changed, false);
  assert.equal(first.idempotent, false);
  assert.equal(first.state.revision, 0);
  const retry = await mutateSessionDagState(request, { agentDir });
  assert.equal(retry.idempotent, true);
  const stored = JSON.parse(await readFile(join(agentDir, SESSION_DAG_STATE_FILENAME), "utf8"));
  assert.equal(stored.receipts.length, 1);
}));

test("stale concurrent writers get authority and can explicitly retry without lost updates", (t) => withStore(t, async (agentDir) => {
  const outcomes = await Promise.allSettled([
    mutateSessionDagState(add("one", 0, "edge-ab", "A", "B"), {
      agentDir,
      availableSessionIds: AVAILABLE,
      lockRetryMs: 2,
    }),
    mutateSessionDagState(add("two", 0, "edge-cd", "C", "D"), {
      agentDir,
      availableSessionIds: AVAILABLE,
      lockRetryMs: 2,
    }),
  ]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "session_dag_revision_conflict");
  assert.equal(rejected[0].reason.state.revision, 1);

  const successfulEdgeId = fulfilled[0].value.state.activeEdges[0].id;
  const retryRequest = successfulEdgeId === "edge-ab"
    ? add("two-retry", 1, "edge-cd", "C", "D")
    : add("one-retry", 1, "edge-ab", "A", "B");
  const retried = await mutateSessionDagState(retryRequest, {
    agentDir,
    availableSessionIds: AVAILABLE,
  });
  assert.equal(retried.state.revision, 2);
  assert.deepEqual(new Set(retried.state.activeEdges.map((edge) => edge.id)), new Set(["edge-ab", "edge-cd"]));
}));

test("mixed edit, delete, complete, Undo, and Redo contenders serialize without lost updates", async (t) => {
  const runRace = async (agentDir, requests, expectedRevision) => {
    const outcomes = await Promise.allSettled(requests.map(({ envelope, options = {} }) => (
      mutateSessionDagState(envelope, { agentDir, lockRetryMs: 2, ...options })
    )));
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.equal(rejected?.reason.code, "session_dag_revision_conflict");
    assert.equal(rejected?.reason.state.revision, expectedRevision);
    assert.equal((await readSessionDagState({ agentDir })).revision, expectedRevision);
  };

  await withStore(t, async (agentDir) => {
    await mutateSessionDagState(add("setup-add", 0, "edge-ab"), { agentDir, availableSessionIds: AVAILABLE });
    const expected = { formId: "default", fromSessionId: "A", toSessionId: "B" };
    await runRace(agentDir, [
      {
        envelope: mutation("replace", 1, {
          type: "replace_edge",
          edgeId: "edge-ab",
          expected,
          next: { fromSessionId: "A", toSessionId: "C" },
        }),
        options: { availableSessionIds: AVAILABLE },
      },
      { envelope: mutation("delete", 1, { type: "delete_edge", edgeId: "edge-ab", expected }) },
    ], 2);
  });

  await withStore(t, async (agentDir) => {
    await mutateSessionDagState(add("setup-add", 0, "edge-ab"), { agentDir, availableSessionIds: AVAILABLE });
    await runRace(agentDir, [
      { envelope: complete("complete", 1, "batch-A", "A", ["edge-ab"]) },
      { envelope: mutation("direction", 1, { type: "set_direction", expectedDirection: "TD", direction: "LR" }) },
    ], 2);
  });

  await withStore(t, async (agentDir) => {
    await mutateSessionDagState(add("setup-add", 0, "edge-ab"), { agentDir, availableSessionIds: AVAILABLE });
    await mutateSessionDagState(complete("setup-complete", 1, "batch-A", "A", ["edge-ab"]), { agentDir });
    await runRace(agentDir, [
      { envelope: mutation("undo", 2, { type: "undo", expectedBatchId: "batch-A" }) },
      { envelope: mutation("direction", 2, { type: "set_direction", expectedDirection: "TD", direction: "LR" }) },
    ], 3);
  });

  await withStore(t, async (agentDir) => {
    await mutateSessionDagState(add("setup-add", 0, "edge-ab"), { agentDir, availableSessionIds: AVAILABLE });
    await mutateSessionDagState(complete("setup-complete", 1, "batch-A", "A", ["edge-ab"]), { agentDir });
    await mutateSessionDagState(mutation("setup-undo", 2, { type: "undo", expectedBatchId: "batch-A" }), { agentDir });
    const expected = { formId: "default", fromSessionId: "A", toSessionId: "B" };
    await runRace(agentDir, [
      { envelope: mutation("redo", 3, { type: "redo", expectedBatchId: "batch-A" }) },
      { envelope: mutation("delete", 3, { type: "delete_edge", edgeId: "edge-ab", expected }) },
    ], 4);
  });
});

test("add and replace reject an invalidated complete session listing under the lock", (t) => withStore(t, async (agentDir) => {
  const originalGeneration = globalThis.__piSessionListGeneration;
  try {
    globalThis.__piSessionListGeneration = 9;
    await assert.rejects(
      mutateSessionDagState(add("stale-list", 0, "edge-1"), {
        agentDir,
        availableSessionIds: AVAILABLE,
        expectedSessionListGeneration: 8,
      }),
      (error) => error instanceof SessionDagListingChangedError,
    );
    assert.deepEqual(await readdir(agentDir), []);
  } finally {
    globalThis.__piSessionListGeneration = originalGeneration;
  }
}));

test("add and replace recheck listing generation after asynchronous state reading", (t) => withStore(t, async (agentDir) => {
  let generationReads = 0;
  await assert.rejects(
    mutateSessionDagState(add("raced-list", 0, "edge-1"), {
      agentDir,
      availableSessionIds: AVAILABLE,
      expectedSessionListGeneration: 9,
      getCurrentSessionListGeneration: () => (++generationReads === 1 ? 9 : 10),
    }),
    (error) => error instanceof SessionDagListingChangedError,
  );
  assert.equal(generationReads, 2);
  assert.deepEqual(await readdir(agentDir), []);
}));

test("accepted missing sessions are retained across reads and remain completable", (t) => withStore(t, async (agentDir) => {
  const added = await mutateSessionDagState(add("add", 0, "edge-ab"), {
    agentDir,
    availableSessionIds: AVAILABLE,
  });
  const restarted = await readSessionDagState({ agentDir });
  assert.deepEqual(restarted.activeEdges, added.state.activeEdges);

  const completed = await mutateSessionDagState(
    complete("complete", 1, "batch-A", "A", ["edge-ab"]),
    { agentDir, now: () => new Date("2026-08-08T12:00:00.000Z") },
  );
  assert.equal(completed.state.applied[0].completedSessionId, "A");
  assert.equal(completed.state.activeEdges.length, 0);
  assert.equal((await readSessionDagState({ agentDir })).applied.length, 1);
}));

test("completion, Undo, Redo, and direct branching survive restart exactly", (t) => withStore(t, async (agentDir) => {
  await mutateSessionDagState(add("add", 0, "edge-ab"), { agentDir, availableSessionIds: AVAILABLE });
  await mutateSessionDagState(
    complete("complete", 1, "batch-A", "A", ["edge-ab"]),
    { agentDir, now: () => new Date("2026-08-08T12:00:00.000Z") },
  );
  let state = await readSessionDagState({ agentDir });
  const batch = structuredClone(state.applied[0]);
  state = (await mutateSessionDagState(mutation("undo", 2, {
    type: "undo",
    expectedBatchId: "batch-A",
  }), { agentDir })).state;
  assert.equal(state.redo.length, 1);
  state = (await mutateSessionDagState(mutation("redo", 3, {
    type: "redo",
    expectedBatchId: "batch-A",
  }), { agentDir })).state;
  assert.deepEqual(state.applied[0], batch);

  state = (await mutateSessionDagState(mutation("undo-again", 4, {
    type: "undo",
    expectedBatchId: "batch-A",
  }), { agentDir })).state;
  state = (await mutateSessionDagState(mutation("branch", 5, {
    type: "create_form",
    formId: "branch-form",
  }), { agentDir })).state;
  assert.deepEqual(state.redo, []);
  assert.deepEqual((await readSessionDagState({ agentDir })), state);
}));

test("malformed, unsupported, and oversized state is refused without overwrite", (t) => withStore(t, async (agentDir) => {
  const path = join(agentDir, SESSION_DAG_STATE_FILENAME);
  const malformed = "{ private-payload\n";
  await writeFile(path, malformed);
  await withMutedErrors(async () => {
    await assert.rejects(readSessionDagState({ agentDir }), (error) => error.code === "session_dag_state_invalid");
    await assert.rejects(
      mutateSessionDagState(mutation("form", 0, { type: "create_form", formId: "two" }), { agentDir }),
      (error) => error.code === "session_dag_state_invalid",
    );
  });
  assert.equal(await readFile(path, "utf8"), malformed);

  const unsupported = createDefaultStoredSessionDagState();
  unsupported.version = 2;
  await writeFile(path, `${JSON.stringify(unsupported)}\n`);
  await withMutedErrors(async () => {
    await assert.rejects(readSessionDagState({ agentDir }), (error) => error.code === "session_dag_state_invalid");
  });

  const oversized = "x".repeat(257);
  await writeFile(path, oversized);
  await withMutedErrors(async () => {
    await assert.rejects(
      readSessionDagState({ agentDir, maximumStateBytes: 256 }),
      (error) => error.code === "session_dag_state_invalid",
    );
  });
  assert.equal(await readFile(path, "utf8"), oversized);
}));

test("revision overflow returns authoritative conflict without rewriting state", (t) => withStore(t, async (agentDir) => {
  const stored = {
    ...createDefaultStoredSessionDagState(),
    revision: Number.MAX_SAFE_INTEGER,
  };
  const path = join(agentDir, SESSION_DAG_STATE_FILENAME);
  const serialized = `${JSON.stringify(stored, null, 2)}\n`;
  await writeFile(path, serialized, { mode: 0o600 });

  await assert.rejects(
    mutateSessionDagState(mutation("overflow", Number.MAX_SAFE_INTEGER, {
      type: "set_direction",
      expectedDirection: "TD",
      direction: "LR",
    }), { agentDir }),
    (error) => error instanceof SessionDagMutationConflictResponseError
      && error.code === "session_dag_counter_overflow"
      && error.state.revision === Number.MAX_SAFE_INTEGER,
  );
  assert.equal(await readFile(path, "utf8"), serialized);
}));

test("a prospective state-byte overflow returns authoritative capacity conflict without writing", (t) => withStore(t, async (agentDir) => {
  await assert.rejects(
    mutateSessionDagState(mutation("too-large", 0, {
      type: "create_form",
      formId: "second",
    }), {
      agentDir,
      maximumStateBytes: 128,
    }),
    (error) => error instanceof SessionDagMutationConflictResponseError
      && error.code === "session_dag_limit_exceeded"
      && error.state.revision === 0,
  );
  assert.deepEqual(await readdir(agentDir), []);
}));

test("lock timeout preserves the existing lock and state", (t) => withStore(t, async (agentDir) => {
  const lockPath = join(agentDir, `${SESSION_DAG_STATE_FILENAME}.lock`);
  await writeFile(lockPath, "held\n");
  await withMutedErrors(async () => {
    await assert.rejects(
      mutateSessionDagState(mutation("form", 0, { type: "create_form", formId: "two" }), {
        agentDir,
        lockTimeoutMs: 20,
        lockRetryMs: 2,
      }),
      (error) => error.code === "session_dag_lock_timeout",
    );
  });
  assert.deepEqual(await readdir(agentDir), [`${SESSION_DAG_STATE_FILENAME}.lock`]);
}));

test("receipt retention is bounded and old receipt ids may be safely reused after pruning", (t) => withStore(t, async (agentDir) => {
  for (let index = 0; index < SESSION_DAG_MAX_RECEIPTS + 1; index += 1) {
    await mutateSessionDagState(mutation(`noop-${index}`, 0, {
      type: "set_direction",
      expectedDirection: "TD",
      direction: "TD",
    }), { agentDir });
  }
  const stored = JSON.parse(await readFile(join(agentDir, SESSION_DAG_STATE_FILENAME), "utf8"));
  assert.equal(stored.receipts.length, SESSION_DAG_MAX_RECEIPTS);
  assert.equal(stored.receipts.some((receipt) => receipt.mutationId === "noop-0"), false);
  assert.equal(stored.receipts.at(-1).mutationId, `noop-${SESSION_DAG_MAX_RECEIPTS}`);
}));

test("canonical mutation digests ignore object key order but retain semantic differences", () => {
  const first = add("digest", 0, "edge-ab");
  const reordered = {
    operation: {
      toSessionId: "B",
      fromSessionId: "A",
      formId: "default",
      edgeId: "edge-ab",
      type: "add_edge",
    },
    baseRevision: 0,
    mutationId: "digest",
  };
  assert.equal(digestSessionDagMutation(first), digestSessionDagMutation(reordered));
  assert.notEqual(digestSessionDagMutation(first), digestSessionDagMutation(add("digest", 0, "edge-ac", "A", "C")));
});

test("diagnostics contain only bounded operation, stage, revision, counts, status, and error class", (t) => withStore(t, async (agentDir) => {
  const privateId = "private-session-id-sentinel";
  const privatePayload = "private-payload-sentinel";
  const invalidDir = join(agentDir, "invalid");
  await mkdir(invalidDir);
  await writeFile(join(invalidDir, SESSION_DAG_STATE_FILENAME), `{ ${privatePayload}\n`);
  const lockDir = join(agentDir, "lock");
  await mkdir(lockDir);
  await writeFile(join(lockDir, `${SESSION_DAG_STATE_FILENAME}.lock`), "held\n");

  const { calls } = await withCapturedErrors(async () => {
    await assert.rejects(readSessionDagState({ agentDir: invalidDir }));
    await assert.rejects(mutateSessionDagState(add("private-mutation", 0, "private-edge", privateId, "B"), {
      agentDir: lockDir,
      availableSessionIds: new Set([privateId, "B"]),
      lockTimeoutMs: 10,
      lockRetryMs: 2,
    }));
  });

  assert.ok(calls.length >= 2);
  for (const [category, details] of calls) {
    assert.match(category, /^\[pi-web\] session_dag_(state_invalid|lock_timeout|read_failed|write_failed)$/u);
    assert.deepEqual(Object.keys(details).sort(), [
      "activeEdgeCount",
      "batchCount",
      "errorClass",
      "formCount",
      "operation",
      "revision",
      "stage",
      "status",
    ]);
    assert.match(details.errorClass, /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/u);
    const serialized = JSON.stringify([category, details]);
    assert.equal(serialized.includes(privateId), false);
    assert.equal(serialized.includes(privatePayload), false);
    assert.equal(serialized.includes(agentDir), false);
  }
}));

test("directory preparation failures map to a stable sanitized category", (t) => withStore(t, async (agentDir) => {
  const notDirectory = join(agentDir, "not-directory");
  await writeFile(notDirectory, "file\n");
  await withMutedErrors(async () => {
    await assert.rejects(
      mutateSessionDagState(mutation("form", 0, { type: "create_form", formId: "two" }), {
        agentDir: notDirectory,
      }),
      (error) => error.code === "session_dag_write_failed" && !error.message.includes(notDirectory),
    );
  });

  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    const path = join(agentDir, SESSION_DAG_STATE_FILENAME);
    await writeFile(path, `${JSON.stringify(createDefaultStoredSessionDagState())}\n`);
    await chmod(path, 0);
    try {
      await withMutedErrors(async () => {
        await assert.rejects(readSessionDagState({ agentDir }), (error) => error.code === "session_dag_read_failed");
      });
    } finally {
      await chmod(path, 0o600);
    }
  }
}));
