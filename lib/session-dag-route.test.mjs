import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SESSION_DAG_MAX_MUTATION_BYTES,
  createSessionDagRouteHandlers,
} = await jiti.import("./session-dag-route.ts");
const {
  SessionDagListingChangedError,
  SessionDagMutationConflictResponseError,
} = await jiti.import("./session-dag-store.ts");

const STATE = {
  version: 1,
  revision: 0,
  direction: "TD",
  forms: [{ id: "default" }],
  activeEdges: [],
  applied: [],
  redo: [],
  nextSequence: 1,
  nextEdgeOrder: 1,
};

function request(body) {
  return new Request("http://localhost/api/session-dag", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handlers(overrides = {}) {
  return createSessionDagRouteHandlers({
    readState: async () => STATE,
    mutateState: async () => ({ state: STATE, changed: false, idempotent: false }),
    listSessionIds: async () => ({ sessionIds: new Set(), generation: 0 }),
    ...overrides,
  });
}

test("GET is no-store and never lists or reconciles native sessions", async () => {
  let listCalls = 0;
  const route = handlers({ listSessionIds: async () => { listCalls += 1; throw new Error("must not list"); } });
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), STATE);
  assert.equal(listCalls, 0);
});

test("PATCH strictly rejects malformed envelopes before storage", async () => {
  let mutations = 0;
  const route = handlers({ mutateState: async () => { mutations += 1; throw new Error("unexpected"); } });
  for (const body of [
    {
      mutationId: "one",
      baseRevision: 0,
      operation: { type: "undo", expectedBatchId: "batch", extra: true },
    },
    {
      mutationId: "insert",
      baseRevision: 0,
      operation: {
        type: "insert_edge",
        edgeId: "edge-ab",
        expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
        insertedSessionId: "C",
        firstEdgeId: "edge-ac",
        secondEdgeId: "edge-cb",
        extra: true,
      },
    },
  ]) {
    const response = await route.PATCH(request(body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "session_dag_bad_request");
  }
  assert.equal(mutations, 0);
});

test("PATCH rejects oversized streamed bodies before parsing or storage", async () => {
  let mutations = 0;
  const route = handlers({ mutateState: async () => { mutations += 1; throw new Error("unexpected"); } });
  const half = Math.floor(SESSION_DAG_MAX_MUTATION_BYTES / 2) + 1;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(half));
      controller.enqueue(new Uint8Array(half));
      controller.close();
    },
  });
  const oversizedRequest = new Request("http://localhost/api/session-dag", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  });

  const response = await route.PATCH(oversizedRequest);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).code, "session_dag_request_too_large");
  assert.equal(mutations, 0);
});

test("add, replace, and insert pass the complete exact-ID set and generation unchanged", async () => {
  const operations = [
    {
      type: "add_edge",
      edgeId: "edge-ab",
      formId: "default",
      fromSessionId: "A",
      toSessionId: "B",
    },
    {
      type: "replace_edge",
      edgeId: "edge-ab",
      expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
      next: { fromSessionId: "B", toSessionId: "C" },
    },
    {
      type: "insert_edge",
      edgeId: "edge-ab",
      expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
      insertedSessionId: "C",
      firstEdgeId: "edge-ac",
      secondEdgeId: "edge-cb",
    },
  ];

  for (const operation of operations) {
    const sessionIds = new Set(["A", "B", "C"]);
    let receivedOptions;
    const route = handlers({
      listSessionIds: async () => ({ sessionIds, generation: 17 }),
      mutateState: async (_envelope, options) => {
        receivedOptions = options;
        return { state: { ...STATE, revision: 1 }, changed: true, idempotent: false };
      },
    });
    const response = await route.PATCH(request({
      mutationId: `operation-${operation.type}`,
      baseRevision: 0,
      operation,
    }));
    assert.equal(response.status, 200, operation.type);
    assert.equal(receivedOptions.availableSessionIds, sessionIds, operation.type);
    assert.equal(receivedOptions.expectedSessionListGeneration, 17, operation.type);
  }
});

test("insert retries only its bounded generation race with a fresh exact-ID listing", async () => {
  let listCalls = 0;
  const mutationOptions = [];
  const mutationEnvelopes = [];
  const route = handlers({
    listSessionIds: async () => {
      listCalls += 1;
      return {
        sessionIds: new Set(["A", "B", "C"]),
        generation: listCalls,
      };
    },
    mutateState: async (envelope, options) => {
      mutationEnvelopes.push(envelope);
      mutationOptions.push(options);
      if (mutationOptions.length === 1) throw new SessionDagListingChangedError();
      return { state: { ...STATE, revision: 1 }, changed: true, idempotent: false };
    },
  });
  const response = await route.PATCH(request({
    mutationId: "insert",
    baseRevision: 0,
    operation: {
      type: "insert_edge",
      edgeId: "edge-ab",
      expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
      insertedSessionId: "C",
      firstEdgeId: "edge-ac",
      secondEdgeId: "edge-cb",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(listCalls, 2);
  assert.equal(mutationEnvelopes[1].operation.type, "insert_edge");
  assert.deepEqual([...mutationOptions[1].availableSessionIds], ["A", "B", "C"]);
  assert.equal(mutationOptions[1].expectedSessionListGeneration, 2);
});

test("completion, history, form, and direction operations never require current session discovery", async () => {
  let listCalls = 0;
  let mutateCalls = 0;
  const route = handlers({
    listSessionIds: async () => { listCalls += 1; throw new Error("unexpected list"); },
    mutateState: async (_envelope, options) => {
      mutateCalls += 1;
      assert.equal(options, undefined);
      return { state: STATE, changed: false, idempotent: false };
    },
  });
  const response = await route.PATCH(request({
    mutationId: "undo",
    baseRevision: 0,
    operation: { type: "undo", expectedBatchId: "batch" },
  }));
  assert.equal(response.status, 200);
  assert.equal(listCalls, 0);
  assert.equal(mutateCalls, 1);
});

test("conflicts return 409 authority while listing failures and unknown failures are sanitized", async () => {
  const authoritative = { ...STATE, revision: 7 };
  const conflictRoute = handlers({
    mutateState: async () => {
      throw new SessionDagMutationConflictResponseError(
        "session_dag_insert_endpoint",
        "Insert a session ID different from both dependency endpoints",
        authoritative,
      );
    },
  });
  const conflictResponse = await conflictRoute.PATCH(request({
    mutationId: "undo",
    baseRevision: 0,
    operation: { type: "undo", expectedBatchId: "batch" },
  }));
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflictResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await conflictResponse.json(), {
    error: "Insert a session ID different from both dependency endpoints",
    code: "session_dag_insert_endpoint",
    state: authoritative,
  });

  const listingRoute = handlers({ listSessionIds: async () => { throw new Error("private session path"); } });
  const listingResponse = await listingRoute.PATCH(request({
    mutationId: "insert",
    baseRevision: 0,
    operation: {
      type: "insert_edge",
      edgeId: "edge-ab",
      expected: { formId: "default", fromSessionId: "A", toSessionId: "B" },
      insertedSessionId: "C",
      firstEdgeId: "edge-ac",
      secondEdgeId: "edge-cb",
    },
  }));
  assert.equal(listingResponse.status, 500);
  assert.deepEqual(await listingResponse.json(), {
    error: "Sessions could not be listed",
    code: "session_dag_sessions_failed",
  });
});

test("the App Router endpoint is force-dynamic and exposes only GET/PATCH", async () => {
  const source = await readFile(new URL("../app/api/session-dag/route.ts", import.meta.url), "utf8");
  assert.match(source, /dynamic = "force-dynamic"/u);
  assert.match(source, /export const GET = handlers\.GET/u);
  assert.match(source, /export const PATCH = handlers\.PATCH/u);
  assert.doesNotMatch(source, /DELETE|POST|PUT/u);
});
