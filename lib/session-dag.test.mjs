import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SESSION_DAG_DEFAULT_FORM_ID,
  SESSION_DAG_MAX_BATCHES,
  SESSION_DAG_MAX_EDGE_RECORDS,
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
  getSessionDagRawEndpointPresentation,
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

function insert(state, edge, insertedSessionId, firstEdgeId = "insert-first", secondEdgeId = "insert-second", options = {}) {
  return applySessionDagOperation(state, {
    type: "insert_edge",
    edgeId: edge.id,
    expected: createEdgeExpectation(edge),
    insertedSessionId,
    firstEdgeId,
    secondEdgeId,
  }, {
    availableSessionIds: AVAILABLE,
    now: NOW,
    ...options,
  }).state;
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
  assert.deepEqual(parseSessionDagMutationEnvelope({
    mutationId: "insert-1",
    baseRevision: 0,
    operation: {
      type: "insert_edge",
      edgeId: "edge-1",
      expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
      insertedSessionId: "C",
      firstEdgeId: "edge-a-c",
      secondEdgeId: "edge-c-b",
    },
  }).operation, {
    type: "insert_edge",
    edgeId: "edge-1",
    expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
    insertedSessionId: "C",
    firstEdgeId: "edge-a-c",
    secondEdgeId: "edge-c-b",
  });
  assert.throws(() => parseSessionDagMutationEnvelope({
    mutationId: "insert-extra",
    baseRevision: 0,
    operation: {
      type: "insert_edge",
      edgeId: "edge-1",
      expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
      insertedSessionId: "C",
      firstEdgeId: "edge-a-c",
      secondEdgeId: "edge-c-b",
      payload: "private",
    },
  }));
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

test("swapping an edge reverses eligibility, clears redo, and rejects an existing reverse pair", () => {
  let state = initialState();
  state = add(state, "ab", "A", "B");
  state = complete(state, "batch-A", "A");
  state = apply(state, { type: "undo", expectedBatchId: "batch-A" });
  assert.deepEqual([...getEligibleSessionIds(state)], ["A"]);
  assert.equal(state.redo.length, 1);

  const edge = state.activeEdges[0];
  state = apply(state, {
    type: "replace_edge",
    edgeId: edge.id,
    expected: createEdgeExpectation(edge),
    next: { fromSessionId: edge.toSessionId, toSessionId: edge.fromSessionId },
  });
  assert.deepEqual(
    state.activeEdges.map(({ fromSessionId, toSessionId }) => [fromSessionId, toSessionId]),
    [["B", "A"]],
  );
  assert.deepEqual([...getEligibleSessionIds(state)], ["B"]);
  assert.equal(state.redo.length, 0);

  let reversePair = initialState();
  reversePair = add(reversePair, "ab", "A", "B");
  reversePair = add(reversePair, "ba", "B", "A");
  const forward = reversePair.activeEdges[0];
  assert.throws(
    () => apply(reversePair, {
      type: "replace_edge",
      edgeId: forward.id,
      expected: createEdgeExpectation(forward),
      next: { fromSessionId: forward.toSessionId, toSessionId: forward.fromSessionId },
    }),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_duplicate_edge",
  );
});

test("inserting an edge atomically preserves form/order, clears Redo, and leaves unrelated state", () => {
  let state = initialState();
  state = apply(state, { type: "create_form", formId: "second" });
  state = add(state, "ab", "A", "B", "second");
  state = add(state, "xy", "X", "Y");
  state = complete(state, "batch-X", "X");
  state = apply(state, { type: "undo", expectedBatchId: "batch-X" });
  const selected = state.activeEdges.find((edge) => edge.id === "ab");
  const unrelated = structuredClone(state.activeEdges.find((edge) => edge.id === "xy"));
  const priorNextOrder = state.nextEdgeOrder;
  assert.equal(state.redo.length, 1);

  state = insert(state, selected, "C", "ac", "cb");
  assert.deepEqual(state.forms, [{ id: "default" }, { id: "second" }]);
  assert.deepEqual(state.activeEdges, [
    {
      id: "ac",
      formId: "second",
      fromSessionId: "A",
      toSessionId: "C",
      order: selected.order,
    },
    unrelated,
    {
      id: "cb",
      formId: "second",
      fromSessionId: "C",
      toSessionId: "B",
      order: priorNextOrder,
    },
  ]);
  assert.equal(state.activeEdges.some((edge) => edge.id === "ab"), false);
  assert.equal(state.nextEdgeOrder, priorNextOrder + 1);
  assert.deepEqual(state.applied, []);
  assert.deepEqual(state.redo, []);
  assert.deepEqual([...getEligibleSessionIds(state)].sort(), ["A", "X"]);

  let self = initialState();
  self = add(self, "self", "A", "A");
  self = insert(self, self.activeEdges[0], "C", "self-ac", "self-ca");
  assert.deepEqual(
    self.activeEdges.map(({ fromSessionId, toSessionId }) => [fromSessionId, toSessionId]),
    [["A", "C"], ["C", "A"]],
    "self-edge insertion remains available even though swapping it is a no-op",
  );
});

test("insertion rejects stale targets, endpoint reuse, unavailable/completed sessions, duplicate pairs, and edge-id reuse", () => {
  let base = initialState();
  base = add(base, "ab", "A", "B");
  const selected = base.activeEdges[0];

  const expectUnchangedConflict = (state, operation, code, options = { availableSessionIds: AVAILABLE }) => {
    const before = structuredClone(state);
    assert.throws(
      () => applySessionDagOperation(state, operation, options),
      (error) => error instanceof SessionDagConflictError && error.code === code,
    );
    assert.deepEqual(state, before);
  };
  const operation = (overrides = {}) => ({
    type: "insert_edge",
    edgeId: selected.id,
    expected: createEdgeExpectation(selected),
    insertedSessionId: "C",
    firstEdgeId: "ac",
    secondEdgeId: "cb",
    ...overrides,
  });

  expectUnchangedConflict(base, operation({
    expected: { ...createEdgeExpectation(selected), toSessionId: "D" },
  }), "session_dag_target_changed");
  for (const insertedSessionId of ["A", "B"]) {
    expectUnchangedConflict(
      base,
      operation({ insertedSessionId }),
      "session_dag_insert_endpoint",
    );
  }
  for (const availableSessionIds of [new Set(["B", "C"]), new Set(["A", "C"]), new Set(["A", "B"])]) {
    expectUnchangedConflict(
      base,
      operation(),
      "session_dag_session_not_found",
      { availableSessionIds },
    );
  }

  let completed = initialState();
  completed = add(completed, "cd", "C", "D");
  completed = complete(completed, "batch-C", "C");
  completed = add(completed, "ab", "A", "B");
  const completedSelected = completed.activeEdges[0];
  expectUnchangedConflict(completed, {
    ...operation(),
    edgeId: completedSelected.id,
    expected: createEdgeExpectation(completedSelected),
  }, "session_dag_session_completed");

  for (const duplicate of [
    add(base, "existing-ac", "A", "C"),
    add(base, "existing-cb", "C", "B"),
  ]) {
    expectUnchangedConflict(duplicate, operation(), "session_dag_duplicate_edge");
  }
  for (const ids of [
    { firstEdgeId: "same", secondEdgeId: "same" },
    { firstEdgeId: selected.id, secondEdgeId: "fresh" },
    { firstEdgeId: "fresh", secondEdgeId: selected.id },
  ]) {
    expectUnchangedConflict(base, operation(ids), "session_dag_target_changed");
  }

  let historical = initialState();
  historical = add(historical, "historical-edge", "X", "Y");
  historical = complete(historical, "batch-X", "X");
  historical = add(historical, "ab", "A", "B");
  const historicalSelected = historical.activeEdges[0];
  expectUnchangedConflict(historical, {
    ...operation({ firstEdgeId: "historical-edge" }),
    edgeId: historicalSelected.id,
    expected: createEdgeExpectation(historicalSelected),
  }, "session_dag_target_changed");
});

test("adding an edge enforces capacity and branches from Redo", () => {
  const capacityState = {
    ...initialState(),
    activeEdges: Array.from({ length: SESSION_DAG_MAX_EDGE_RECORDS }, (_, index) => ({
      id: `edge-${index}`,
      formId: "default",
      fromSessionId: `from-${index}`,
      toSessionId: `to-${index}`,
      order: index + 1,
    })),
    nextEdgeOrder: SESSION_DAG_MAX_EDGE_RECORDS + 1,
  };
  assert.throws(
    () => add(capacityState, "over-capacity", "A", "B"),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_limit_exceeded",
  );

  let state = add(initialState(), "ab", "A", "B");
  state = complete(state, "batch-A", "A");
  state = apply(state, { type: "undo", expectedBatchId: "batch-A" });
  assert.equal(state.redo.length, 1);
  state = add(state, "cd", "C", "D");
  assert.equal(state.redo.length, 0);
  assert.deepEqual(
    state.activeEdges.map(({ id, fromSessionId, toSessionId }) => ({ id, fromSessionId, toSessionId })),
    [
      { id: "ab", fromSessionId: "A", toSessionId: "B" },
      { id: "cd", fromSessionId: "C", toSessionId: "D" },
    ],
  );
});

test("insertion validates final logical-edge capacity and its one new order allocation", () => {
  const selected = {
    id: "selected",
    formId: "default",
    fromSessionId: "A",
    toSessionId: "B",
    order: 1,
  };
  const capacityState = {
    ...initialState(),
    activeEdges: [
      selected,
      ...Array.from({ length: SESSION_DAG_MAX_EDGE_RECORDS - 1 }, (_, index) => ({
        id: `edge-${index}`,
        formId: "default",
        fromSessionId: `from-${index}`,
        toSessionId: `to-${index}`,
        order: index + 2,
      })),
    ],
    nextEdgeOrder: SESSION_DAG_MAX_EDGE_RECORDS + 1,
  };
  assert.throws(
    () => insert(capacityState, selected, "C", "capacity-first", "capacity-second"),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_limit_exceeded",
  );
  assert.throws(
    () => insert(
      { ...initialState(), activeEdges: [selected], nextEdgeOrder: Number.MAX_SAFE_INTEGER },
      selected,
      "C",
      "overflow-first",
      "overflow-second",
    ),
    (error) => error instanceof SessionDagConflictError && error.code === "session_dag_counter_overflow",
  );
});

test("Raw endpoint presentation distinguishes resolved, accepted unavailable, and unresolved values", () => {
  const resolvedSession = session("A", { name: "Named session", worktreeBranch: "feature/swap" });
  const sessionsById = new Map([[resolvedSession.id, resolvedSession]]);
  const prefixes = new Map([[resolvedSession.projectRoot, "acme/app"]]);

  assert.deepEqual(
    getSessionDagRawEndpointPresentation("A", "A", sessionsById, prefixes),
    { label: "acme/app · feature/swap · Named session", status: "resolved" },
  );
  assert.deepEqual(
    getSessionDagRawEndpointPresentation("missing", "missing", sessionsById, prefixes),
    { label: "Session unavailable", status: "unavailable" },
  );
  assert.deepEqual(
    getSessionDagRawEndpointPresentation("miss", "missing", sessionsById, prefixes),
    { label: "Session unresolved", status: "unresolved" },
  );
  assert.deepEqual(
    getSessionDagRawEndpointPresentation("", null, sessionsById, prefixes),
    { label: "Session unresolved", status: "unresolved" },
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

test("compiler assigns deterministic node and edge aliases, escapes bounded labels, and keeps persisted IDs out of Mermaid structure", () => {
  let state = initialState();
  state = add(state, "za", "X", "A");
  state = add(state, "persisted-edge-should-not-render", "A", "B");
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
  assert.match(compiled.source, /^flowchart TD\naccTitle: Session dependency graph\naccDescr: Session dependencies and available completion, node-add, go-to-session, and edge action controls\n/u);
  assert.match(compiled.source, /n0\["work\/acme\/app · feature\/&lt;svg&gt; · &lt;script&gt; &quot;unsafe&quot; &amp; still text"\]/u);
  assert.match(compiled.source, /n1\["Session unavailable"\]/u);
  assert.equal(compiled.source.includes("B ·"), false, "Preview IDs remain tooltip-only");
  assert.equal(compiled.aliasesByEdgeId.get("persisted-edge-should-not-render"), "e0");
  assert.deepEqual(compiled.edgesByAlias.get("e0"), state.activeEdges[0]);
  assert.match(compiled.source, /n0 e0@--> n1/u);
  assert.equal(compiled.source.includes("persisted-edge-should-not-render"), false);
  assert.equal(compiled.source.includes("X ·"), false, "completed nodes are not rendered");
  assert.deepEqual([...compiled.eligibleSessionIds], ["A"]);

  const missingId = "missing-session-id-that-must-remain-complete";
  assert.equal(buildSessionDagLabel(missingId, undefined, new Map()), "Session unavailable");
});
