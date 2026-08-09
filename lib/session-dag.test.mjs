import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SESSION_DAG_DEFAULT_FORM_ID,
  SESSION_DAG_MAX_BATCHES,
  SESSION_DAG_MAX_FORMS,
  SessionDagConflictError,
  applySessionDagOperation,
  buildSessionDagLabel,
  canDeleteSessionDagForm,
  compileSessionDag,
  createDefaultStoredSessionDagState,
  createEdgeExpectation,
  deriveSessionDagNodeFormAssignments,
  getActiveSessionIds,
  getEligibleSessionIds,
  parseSessionDagMutationEnvelope,
  parseSessionDagState,
  parseStoredSessionDagState,
  toPublicSessionDagState,
} = await jiti.import("./session-dag.ts");

const AVAILABLE = new Set(["A", "B", "C", "D", "X", "Y"]);
const NOW = () => new Date("2026-08-08T12:00:00.000Z");

function initialState() {
  return toPublicSessionDagState(createDefaultStoredSessionDagState());
}

function apply(state, operation, options = {}) {
  return applySessionDagOperation(state, operation, {
    availableSessionIds: AVAILABLE,
    now: NOW,
    ...options,
  }).state;
}

function add(state, edgeId, fromSessionId, toSessionId, formId = SESSION_DAG_DEFAULT_FORM_ID) {
  return apply(state, { type: "add_edge", edgeId, formId, fromSessionId, toSessionId });
}

function complete(state, batchId, sessionId) {
  const expectedOutgoingEdgeIds = state.activeEdges
    .filter((edge) => edge.fromSessionId === sessionId)
    .sort((left, right) => left.order - right.order)
    .map((edge) => edge.id);
  return apply(state, { type: "complete", batchId, sessionId, expectedOutgoingEdgeIds });
}

function session(id, overrides = {}) {
  return {
    path: `/sessions/${id}.jsonl`,
    id,
    cwd: "/work/acme/app",
    created: "2026-08-08T00:00:00.000Z",
    modified: "2026-08-08T00:00:00.000Z",
    messageCount: 1,
    firstMessage: `Work on ${id}`,
    projectRoot: "/work/acme/app",
    ...overrides,
  };
}

test("state and mutation parsing are strict, bounded, and privacy-preserving by construction", () => {
  const stored = createDefaultStoredSessionDagState();
  assert.deepEqual(parseStoredSessionDagState(stored), stored);
  assert.deepEqual(parseSessionDagState(toPublicSessionDagState(stored)), toPublicSessionDagState(stored));
  assert.equal("receipts" in toPublicSessionDagState(stored), false);

  assert.throws(() => parseStoredSessionDagState({ ...stored, extra: true }));
  assert.throws(() => parseStoredSessionDagState({ ...stored, version: 2 }));
  assert.throws(() => parseStoredSessionDagState({
    ...stored,
    forms: Array.from({ length: SESSION_DAG_MAX_FORMS + 1 }, (_, index) => ({ id: `f-${index}` })),
  }));
  assert.throws(() => parseStoredSessionDagState({ ...stored, direction: "BT" }));
  assert.throws(() => parseStoredSessionDagState({ ...stored, forms: [{ id: " bad " }] }));

  assert.deepEqual(parseSessionDagMutationEnvelope({
    mutationId: "mutation-1",
    baseRevision: 0,
    operation: {
      type: "add_edge",
      edgeId: "edge-1",
      formId: "default",
      fromSessionId: "A",
      toSessionId: "B",
    },
  }).operation.type, "add_edge");
  assert.throws(() => parseSessionDagMutationEnvelope({
    mutationId: "mutation-1",
    baseRevision: 0,
    operation: { type: "undo", expectedBatchId: "batch", payload: "private" },
  }));
  assert.throws(() => parseSessionDagMutationEnvelope({
    mutationId: "x".repeat(129),
    baseRevision: 0,
    operation: { type: "undo", expectedBatchId: "batch" },
  }));
});

test("add and replace validate current exact IDs, completed nodes, global duplicates, and CAS targets", () => {
  let state = initialState();
  state = add(state, "e1", "A", "B");
  state = add(state, "e2", "B", "A");
  state = add(state, "self", "C", "C");
  assert.deepEqual(state.activeEdges.map((edge) => [edge.fromSessionId, edge.toSessionId]), [
    ["A", "B"],
    ["B", "A"],
    ["C", "C"],
  ]);

  assert.throws(
    () => add(state, "duplicate", "A", "B"),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_duplicate_edge",
  );
  assert.throws(
    () => apply(state, { type: "add_edge", edgeId: "missing", formId: "default", fromSessionId: "A", toSessionId: "missing" }),
    (error) => error.code === "session_dag_session_not_found",
  );

  const edge = state.activeEdges[0];
  state = apply(state, {
    type: "replace_edge",
    edgeId: edge.id,
    expected: createEdgeExpectation(edge),
    next: { fromSessionId: "A", toSessionId: "D" },
  });
  assert.deepEqual(state.activeEdges[0], { ...edge, toSessionId: "D" });
  assert.throws(
    () => apply(state, {
      type: "delete_edge",
      edgeId: edge.id,
      expected: { ...createEdgeExpectation(edge), toSessionId: "B" },
    }),
    (error) => error.code === "session_dag_target_changed",
  );

  let completed = initialState();
  completed = add(completed, "done-edge", "A", "B");
  completed = complete(completed, "done-A", "A");
  assert.throws(
    () => add(completed, "reuse", "A", "C"),
    (error) => error.code === "session_dag_session_completed",
  );

  let unavailable = initialState();
  unavailable = add(unavailable, "unavailable-edge", "A", "B");
  const unavailableEdge = unavailable.activeEdges[0];
  assert.throws(
    () => applySessionDagOperation(unavailable, {
      type: "replace_edge",
      edgeId: unavailableEdge.id,
      expected: createEdgeExpectation(unavailableEdge),
      next: { fromSessionId: "A", toSessionId: "B" },
    }, { availableSessionIds: new Set(["A"]) }),
    (error) => error.code === "session_dag_session_not_found",
    "even an unchanged replacement must prove both current session IDs",
  );
});

test("forms are bookkeeping only and derive globally synchronized active node controls", () => {
  let state = initialState();
  state = apply(state, { type: "create_form", formId: "second" });
  state = add(state, "e1", "A", "B", "second");
  state = add(state, "e2", "B", "C", "default");

  assert.deepEqual(getActiveSessionIds(state), ["A", "B", "C"]);
  assert.deepEqual([...getEligibleSessionIds(state)], ["A"]);
  assert.deepEqual([...deriveSessionDagNodeFormAssignments(state)], [
    ["B", "default"],
    ["C", "default"],
    ["A", "second"],
  ]);
  assert.equal(canDeleteSessionDagForm(state, "second"), false);
  assert.equal(canDeleteSessionDagForm(state, "default"), false);
});

test("chains, branches, joins, sinks, cycles, and disconnected components use active incoming edges only", () => {
  let state = initialState();
  state = add(state, "ab", "A", "B");
  state = add(state, "ac", "A", "C");
  state = add(state, "bd", "B", "D");
  state = add(state, "cd", "C", "D");
  state = add(state, "xy", "X", "Y");
  assert.deepEqual([...getEligibleSessionIds(state)].sort(), ["A", "X"]);

  state = complete(state, "batch-A", "A");
  assert.deepEqual(state.activeEdges.map((edge) => edge.id), ["bd", "cd", "xy"]);
  assert.deepEqual(getActiveSessionIds(state), ["B", "C", "D", "X", "Y"]);
  assert.deepEqual([...getEligibleSessionIds(state)].sort(), ["B", "C", "X"]);

  state = complete(state, "batch-B", "B");
  assert.deepEqual([...getEligibleSessionIds(state)].sort(), ["C", "X"]);
  state = complete(state, "batch-C", "C");
  assert.deepEqual([...getEligibleSessionIds(state)].sort(), ["D", "X"]);
  state = complete(state, "batch-D", "D");
  assert.equal(state.applied.at(-1).archivedEdges.length, 0, "a sink completion is a real zero-visible-edge batch");
  assert.deepEqual(getActiveSessionIds(state), ["X", "Y"]);

  let cycle = initialState();
  cycle = add(cycle, "ab", "A", "B");
  cycle = add(cycle, "ba", "B", "A");
  cycle = add(cycle, "self", "C", "C");
  assert.deepEqual([...getEligibleSessionIds(cycle)], []);
});

test("linear Undo and Redo restore and rearchive exact edges without changing sequence or timestamp", () => {
  let state = initialState();
  state = add(state, "ab", "A", "B");
  state = add(state, "bc", "B", "C");
  state = complete(state, "batch-A", "A");
  state = complete(state, "batch-B", "B");
  const originalBatch = structuredClone(state.applied.at(-1));

  state = apply(state, { type: "undo", expectedBatchId: "batch-B" });
  assert.deepEqual(state.activeEdges.map((edge) => edge.id), ["bc"]);
  assert.deepEqual(state.applied.map((batch) => batch.id), ["batch-A"]);
  assert.deepEqual(state.redo.map((batch) => batch.id), ["batch-B"]);
  assert.deepEqual(state.redo[0], originalBatch);
  assert.deepEqual([...getEligibleSessionIds(state)], ["B"]);

  state = apply(state, { type: "undo", expectedBatchId: "batch-A" });
  assert.deepEqual(state.activeEdges.map((edge) => edge.id), ["ab", "bc"]);
  assert.deepEqual(state.redo.map((batch) => batch.id), ["batch-B", "batch-A"]);
  assert.deepEqual([...getEligibleSessionIds(state)], ["A"]);

  state = apply(state, { type: "redo", expectedBatchId: "batch-A" });
  state = apply(state, { type: "redo", expectedBatchId: "batch-B" });
  assert.deepEqual(state.activeEdges, []);
  assert.deepEqual(state.applied.map((batch) => batch.id), ["batch-A", "batch-B"]);
  assert.equal(state.applied[1].sequence, originalBatch.sequence);
  assert.equal(state.applied[1].completedAt, originalBatch.completedAt);
});

test("Redo revalidates eligibility and persisted redo tips cannot be blocked", () => {
  let state = initialState();
  state = add(state, "ab", "A", "B");
  state = add(state, "bc", "B", "C");
  state = complete(state, "batch-A", "A");
  state = complete(state, "batch-B", "B");
  state = apply(state, { type: "undo", expectedBatchId: "batch-B" });
  state = apply(state, { type: "undo", expectedBatchId: "batch-A" });

  const blocked = {
    ...state,
    activeEdges: [...state.activeEdges, {
      id: "xa",
      formId: "default",
      fromSessionId: "X",
      toSessionId: "A",
      order: state.nextEdgeOrder,
    }],
    nextEdgeOrder: state.nextEdgeOrder + 1,
  };
  assert.throws(
    () => apply(blocked, { type: "redo", expectedBatchId: "batch-A" }),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_node_blocked",
  );
  assert.throws(() => parseStoredSessionDagState({ ...blocked, receipts: [] }), /redo tip is not eligible/);
});

test("direct semantic mutations and new completion branch from redo while no-ops do not", () => {
  let state = initialState();
  state = add(state, "ab", "A", "B");
  state = complete(state, "batch-A", "A");
  state = apply(state, { type: "undo", expectedBatchId: "batch-A" });
  assert.equal(state.redo.length, 1);

  const noOp = applySessionDagOperation(state, {
    type: "set_direction",
    expectedDirection: "TD",
    direction: "TD",
  });
  assert.equal(noOp.changed, false);
  assert.equal(noOp.state.redo.length, 1);

  state = apply(state, { type: "set_direction", expectedDirection: "TD", direction: "LR" });
  assert.equal(state.redo.length, 0);

  state = complete(state, "batch-A-2", "A");
  state = apply(state, { type: "undo", expectedBatchId: "batch-A-2" });
  state = complete(state, "batch-A-3", "A");
  assert.equal(state.redo.length, 0);
  assert.equal(state.applied.at(-1).id, "batch-A-3");
});

test("a new completion at the history boundary clears redo before enforcing the batch limit", () => {
  const completedAt = "2026-08-08T12:00:00.000Z";
  const applied = Array.from({ length: SESSION_DAG_MAX_BATCHES - 1 }, (_, index) => ({
    id: `historical-${index}`,
    completedSessionId: `completed-${index}`,
    archivedEdges: [],
    nodeFormHints: [{ sessionId: `completed-${index}`, formId: "default" }],
    completedAt,
    sequence: index + 1,
  }));
  const state = {
    ...initialState(),
    activeEdges: [{
      id: "edge-live",
      formId: "default",
      fromSessionId: "A",
      toSessionId: "B",
      order: 1,
    }],
    applied,
    redo: [{
      id: "redo-tip",
      completedSessionId: "redo-session",
      archivedEdges: [],
      nodeFormHints: [{ sessionId: "redo-session", formId: "default" }],
      completedAt,
      sequence: SESSION_DAG_MAX_BATCHES,
    }],
    nextSequence: SESSION_DAG_MAX_BATCHES + 1,
    nextEdgeOrder: 2,
  };

  const completed = apply(state, {
    type: "complete",
    batchId: "boundary-completion",
    sessionId: "A",
    expectedOutgoingEdgeIds: ["edge-live"],
  });
  assert.equal(completed.applied.length, SESSION_DAG_MAX_BATCHES);
  assert.equal(completed.redo.length, 0);
  assert.throws(
    () => apply(completed, {
      type: "complete",
      batchId: "over-limit",
      sessionId: "B",
      expectedOutgoingEdgeIds: [],
    }),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_limit_exceeded",
  );
});

test("edge-order and completion-sequence counters fail closed before unsafe advancement", () => {
  assert.throws(
    () => add({ ...initialState(), nextEdgeOrder: Number.MAX_SAFE_INTEGER }, "edge-overflow", "A", "B"),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_counter_overflow",
  );

  const active = add(initialState(), "edge-ab", "A", "B");
  assert.throws(
    () => complete({ ...active, nextSequence: Number.MAX_SAFE_INTEGER }, "batch-overflow", "A"),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_counter_overflow",
  );
});

test("terminal Undo falls back to the first form or atomically recreates the default form", () => {
  let state = initialState();
  state = apply(state, { type: "create_form", formId: "temporary" });
  state = add(state, "ab", "A", "B", "temporary");
  state = complete(state, "batch-A", "A");
  state = complete(state, "batch-B", "B");
  assert.deepEqual(getActiveSessionIds(state), []);

  state = apply(state, { type: "delete_form", formId: "temporary" });
  state = apply(state, { type: "delete_form", formId: "default" });
  assert.deepEqual(state.forms, []);
  state = apply(state, { type: "undo", expectedBatchId: "batch-B" });
  assert.deepEqual(state.forms, [{ id: "default" }]);
  assert.deepEqual(getActiveSessionIds(state), ["B"]);
  assert.equal(deriveSessionDagNodeFormAssignments(state).get("B"), "default");

  state = apply(state, { type: "undo", expectedBatchId: "batch-A" });
  assert.equal(state.activeEdges[0].formId, "default");
  assert.equal(state.redo.at(-1).archivedEdges[0].formId, "default", "Redo retains the exact restored fallback edge");
});

test("compiler assigns deterministic aliases, declares terminals, escapes bounded labels, and keeps unavailable IDs out of visible Mermaid text", () => {
  let state = initialState();
  state = add(state, "za", "X", "A");
  state = add(state, "ab", "A", "B");
  state = complete(state, "batch-X", "X");
  const hostile = session("A", {
    name: "<script>\n\"unsafe\" & still text",
    worktreeBranch: "feature/<svg>",
  });
  const sessions = [hostile, session("X"), session("other", { projectRoot: "/other/acme/app" })];
  const compiled = compileSessionDag(state, sessions);

  assert.deepEqual(compiled.activeSessionIds, ["A", "B"]);
  assert.equal(compiled.activeEdgeCount, 1);
  assert.equal(compiled.aliasesBySessionId.get("A"), "n0");
  assert.equal(compiled.aliasesBySessionId.get("B"), "n1");
  assert.match(compiled.source, /^flowchart TD\naccTitle: Session dependency graph\naccDescr: Session dependencies and available completion controls\n/u);
  assert.match(compiled.source, /n0\["work\/acme\/app · feature\/&lt;svg&gt; · &lt;script&gt; &quot;unsafe&quot; &amp; still text"\]/u);
  assert.match(compiled.source, /n1\["Session unavailable"\]/u);
  assert.equal(compiled.source.includes("B ·"), false, "Preview IDs remain tooltip-only");
  assert.match(compiled.source, /n0 --> n1/u);
  assert.equal(compiled.source.includes("X ·"), false, "completed nodes are not rendered");
  assert.deepEqual([...compiled.eligibleSessionIds], ["A"]);

  const missingId = "missing-session-id-that-must-remain-complete";
  assert.equal(buildSessionDagLabel(missingId, undefined, new Map()), "Session unavailable");
});
