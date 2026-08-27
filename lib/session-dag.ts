import {
  deriveShortestUniqueProjectPrefixes,
  getSessionDisplayTitle,
} from "./sidebar-session-state";
import type { SessionInfo } from "./types";

export const SESSION_DAG_VERSION = 1 as const;
export const SESSION_DAG_DEFAULT_FORM_ID = "default";
export const SESSION_DAG_MAX_STATE_BYTES = 8 * 1024 * 1024;
export const SESSION_DAG_MAX_FORMS = 256;
export const SESSION_DAG_MAX_EDGE_RECORDS = 10_000;
export const SESSION_DAG_MAX_BATCHES = 10_000;
export const SESSION_DAG_MAX_RECEIPTS = 512;
export const SESSION_DAG_MAX_SESSION_ID_LENGTH = 512;
export const SESSION_DAG_MAX_OPAQUE_ID_LENGTH = 128;
export const SESSION_DAG_ACCESSIBLE_TITLE = "Session dependency graph";
export const SESSION_DAG_ACCESSIBLE_DESCRIPTION = "Session dependencies and available completion and edge action controls";

const SESSION_DAG_MAX_LABEL_SEGMENT_LENGTH = 160;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type SessionDagDirection = "TD" | "LR";

export interface SessionDagForm {
  id: string;
}

export interface SessionDagEdge {
  id: string;
  formId: string;
  fromSessionId: string;
  toSessionId: string;
  order: number;
}

export interface SessionDagNodeFormHint {
  sessionId: string;
  formId: string;
}

export interface SessionDagCompletionBatch {
  id: string;
  completedSessionId: string;
  archivedEdges: SessionDagEdge[];
  nodeFormHints: SessionDagNodeFormHint[];
  completedAt: string;
  sequence: number;
}

export interface SessionDagMutationReceipt {
  mutationId: string;
  digest: string;
  revision: number;
}

export interface SessionDagState {
  version: typeof SESSION_DAG_VERSION;
  revision: number;
  direction: SessionDagDirection;
  forms: SessionDagForm[];
  activeEdges: SessionDagEdge[];
  applied: SessionDagCompletionBatch[];
  redo: SessionDagCompletionBatch[];
  nextSequence: number;
  nextEdgeOrder: number;
}

export interface StoredSessionDagState extends SessionDagState {
  receipts: SessionDagMutationReceipt[];
}

export interface SessionDagEdgeExpectation {
  formId: string;
  fromSessionId: string;
  toSessionId: string;
}

export type SessionDagOperation =
  | {
      type: "set_direction";
      expectedDirection: SessionDagDirection;
      direction: SessionDagDirection;
    }
  | {
      type: "create_form";
      formId: string;
    }
  | {
      type: "delete_form";
      formId: string;
    }
  | {
      type: "add_edge";
      edgeId: string;
      formId: string;
      fromSessionId: string;
      toSessionId: string;
    }
  | {
      type: "replace_edge";
      edgeId: string;
      expected: SessionDagEdgeExpectation;
      next: Pick<SessionDagEdgeExpectation, "fromSessionId" | "toSessionId">;
    }
  | {
      type: "insert_edge";
      edgeId: string;
      expected: SessionDagEdgeExpectation;
      insertedSessionId: string;
      firstEdgeId: string;
      secondEdgeId: string;
    }
  | {
      type: "delete_edge";
      edgeId: string;
      expected: SessionDagEdgeExpectation;
    }
  | {
      type: "complete";
      batchId: string;
      sessionId: string;
      expectedOutgoingEdgeIds: string[];
    }
  | {
      type: "undo";
      expectedBatchId: string;
    }
  | {
      type: "redo";
      expectedBatchId: string;
    };

export interface SessionDagMutationEnvelope {
  mutationId: string;
  baseRevision: number;
  operation: SessionDagOperation;
}

export type SessionDagConflictCode =
  | "session_dag_target_changed"
  | "session_dag_duplicate_edge"
  | "session_dag_insert_endpoint"
  | "session_dag_session_not_found"
  | "session_dag_session_completed"
  | "session_dag_node_not_active"
  | "session_dag_node_blocked"
  | "session_dag_form_not_empty"
  | "session_dag_limit_exceeded"
  | "session_dag_history_empty"
  | "session_dag_counter_overflow";

export class SessionDagValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionDagValueError";
  }
}

export class SessionDagConflictError extends Error {
  readonly code: SessionDagConflictCode;

  constructor(code: SessionDagConflictCode, message: string) {
    super(message);
    this.name = "SessionDagConflictError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return actual.length === canonicalExpected.length
    && actual.every((key, index) => key === canonicalExpected[index]);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (!hasExactKeys(value, expected)) {
    throw new SessionDagValueError(`${label} has unsupported fields`);
  }
}

export function isValidSessionDagSessionId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= SESSION_DAG_MAX_SESSION_ID_LENGTH
    && value === value.trim()
    && !CONTROL_CHARACTERS.test(value);
}

export function isValidSessionDagOpaqueId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= SESSION_DAG_MAX_OPAQUE_ID_LENGTH
    && value === value.trim()
    && !CONTROL_CHARACTERS.test(value);
}

function parseDirection(value: unknown, label: string): SessionDagDirection {
  if (value !== "TD" && value !== "LR") {
    throw new SessionDagValueError(`${label} is invalid`);
  }
  return value;
}

function parseSafeCounter(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new SessionDagValueError(`${label} is invalid`);
  }
  return value as number;
}

function parseOpaqueId(value: unknown, label: string): string {
  if (!isValidSessionDagOpaqueId(value)) throw new SessionDagValueError(`${label} is invalid`);
  return value;
}

function parseSessionId(value: unknown, label: string): string {
  if (!isValidSessionDagSessionId(value)) throw new SessionDagValueError(`${label} is invalid`);
  return value;
}

function parseForm(value: unknown): SessionDagForm {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG form must be an object");
  assertExactKeys(value, ["id"], "Session DAG form");
  return { id: parseOpaqueId(value.id, "Session DAG form id") };
}

function parseEdgeExpectation(value: unknown, label: string): SessionDagEdgeExpectation {
  if (!isRecord(value)) throw new SessionDagValueError(`${label} must be an object`);
  assertExactKeys(value, ["formId", "fromSessionId", "toSessionId"], label);
  return {
    formId: parseOpaqueId(value.formId, `${label} form id`),
    fromSessionId: parseSessionId(value.fromSessionId, `${label} from session id`),
    toSessionId: parseSessionId(value.toSessionId, `${label} to session id`),
  };
}

function parseEdge(value: unknown): SessionDagEdge {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG edge must be an object");
  assertExactKeys(value, ["id", "formId", "fromSessionId", "toSessionId", "order"], "Session DAG edge");
  return {
    id: parseOpaqueId(value.id, "Session DAG edge id"),
    formId: parseOpaqueId(value.formId, "Session DAG edge form id"),
    fromSessionId: parseSessionId(value.fromSessionId, "Session DAG edge from session id"),
    toSessionId: parseSessionId(value.toSessionId, "Session DAG edge to session id"),
    order: parseSafeCounter(value.order, "Session DAG edge order", 1),
  };
}

function parseNodeFormHint(value: unknown): SessionDagNodeFormHint {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG node form hint must be an object");
  assertExactKeys(value, ["sessionId", "formId"], "Session DAG node form hint");
  return {
    sessionId: parseSessionId(value.sessionId, "Session DAG node form hint session id"),
    formId: parseOpaqueId(value.formId, "Session DAG node form hint form id"),
  };
}

function parseCompletionBatch(value: unknown): SessionDagCompletionBatch {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG completion batch must be an object");
  assertExactKeys(
    value,
    ["id", "completedSessionId", "archivedEdges", "nodeFormHints", "completedAt", "sequence"],
    "Session DAG completion batch",
  );
  if (!Array.isArray(value.archivedEdges) || value.archivedEdges.length > SESSION_DAG_MAX_EDGE_RECORDS) {
    throw new SessionDagValueError("Session DAG archived edges must be a bounded array");
  }
  if (!Array.isArray(value.nodeFormHints) || value.nodeFormHints.length > SESSION_DAG_MAX_EDGE_RECORDS + 1) {
    throw new SessionDagValueError("Session DAG node form hints must be a bounded array");
  }
  if (typeof value.completedAt !== "string" || value.completedAt.length > 64) {
    throw new SessionDagValueError("Session DAG completion timestamp is invalid");
  }
  const completedTime = Date.parse(value.completedAt);
  if (!Number.isFinite(completedTime) || new Date(completedTime).toISOString() !== value.completedAt) {
    throw new SessionDagValueError("Session DAG completion timestamp is invalid");
  }
  const batch: SessionDagCompletionBatch = {
    id: parseOpaqueId(value.id, "Session DAG completion batch id"),
    completedSessionId: parseSessionId(value.completedSessionId, "Session DAG completed session id"),
    archivedEdges: value.archivedEdges.map(parseEdge),
    nodeFormHints: value.nodeFormHints.map(parseNodeFormHint),
    completedAt: value.completedAt,
    sequence: parseSafeCounter(value.sequence, "Session DAG completion sequence", 1),
  };
  if (batch.archivedEdges.some((edge) => edge.fromSessionId !== batch.completedSessionId)) {
    throw new SessionDagValueError("Session DAG batch contains a non-outgoing archived edge");
  }
  if (new Set(batch.nodeFormHints.map((hint) => hint.sessionId)).size !== batch.nodeFormHints.length) {
    throw new SessionDagValueError("Session DAG batch contains duplicate node form hints");
  }
  const expectedHintIds = new Set([
    batch.completedSessionId,
    ...batch.archivedEdges.map((edge) => edge.toSessionId),
  ]);
  if (batch.nodeFormHints.length !== expectedHintIds.size
    || batch.nodeFormHints.some((hint) => !expectedHintIds.has(hint.sessionId))) {
    throw new SessionDagValueError("Session DAG batch node form hints are incomplete");
  }
  return batch;
}

function parseReceipt(value: unknown): SessionDagMutationReceipt {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG mutation receipt must be an object");
  assertExactKeys(value, ["mutationId", "digest", "revision"], "Session DAG mutation receipt");
  if (typeof value.digest !== "string" || !/^[a-f0-9]{64}$/u.test(value.digest)) {
    throw new SessionDagValueError("Session DAG mutation receipt digest is invalid");
  }
  return {
    mutationId: parseOpaqueId(value.mutationId, "Session DAG mutation receipt id"),
    digest: value.digest,
    revision: parseSafeCounter(value.revision, "Session DAG mutation receipt revision"),
  };
}

function compareEdges(left: SessionDagEdge, right: SessionDagEdge): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function edgesEqual(left: SessionDagEdge, right: SessionDagEdge): boolean {
  return left.id === right.id
    && left.formId === right.formId
    && left.fromSessionId === right.fromSessionId
    && left.toSessionId === right.toSessionId
    && left.order === right.order;
}

function edgeMatchesExpectation(edge: SessionDagEdge, expected: SessionDagEdgeExpectation): boolean {
  return edge.formId === expected.formId
    && edge.fromSessionId === expected.fromSessionId
    && edge.toSessionId === expected.toSessionId;
}

function edgePairKey(edge: Pick<SessionDagEdge, "fromSessionId" | "toSessionId">): string {
  return `${edge.fromSessionId.length}:${edge.fromSessionId}${edge.toSessionId}`;
}

function validateStateRelationships(state: StoredSessionDagState): void {
  if (state.forms.length > SESSION_DAG_MAX_FORMS) {
    throw new SessionDagValueError("Session DAG has too many forms");
  }
  if (state.applied.length + state.redo.length > SESSION_DAG_MAX_BATCHES) {
    throw new SessionDagValueError("Session DAG has too many completion batches");
  }

  const formIds = new Set(state.forms.map((form) => form.id));
  if (formIds.size !== state.forms.length) throw new SessionDagValueError("Session DAG has duplicate form ids");
  if (state.activeEdges.some((edge) => !formIds.has(edge.formId))) {
    throw new SessionDagValueError("Session DAG active edge references a missing form");
  }
  if (new Set(state.activeEdges.map((edge) => edge.id)).size !== state.activeEdges.length) {
    throw new SessionDagValueError("Session DAG has duplicate active edge ids");
  }
  if (new Set(state.activeEdges.map(edgePairKey)).size !== state.activeEdges.length) {
    throw new SessionDagValueError("Session DAG has duplicate active directed pairs");
  }
  for (let index = 1; index < state.activeEdges.length; index += 1) {
    if (compareEdges(state.activeEdges[index - 1], state.activeEdges[index]) >= 0) {
      throw new SessionDagValueError("Session DAG active edge order is invalid");
    }
  }

  const allBatches = [...state.applied, ...state.redo];
  if (new Set(allBatches.map((batch) => batch.id)).size !== allBatches.length) {
    throw new SessionDagValueError("Session DAG has duplicate completion batch ids");
  }
  if (new Set(allBatches.map((batch) => batch.sequence)).size !== allBatches.length) {
    throw new SessionDagValueError("Session DAG has duplicate completion sequences");
  }
  if (new Set(allBatches.map((batch) => batch.completedSessionId)).size !== allBatches.length) {
    throw new SessionDagValueError("Session DAG has duplicate completed session ids in history");
  }
  for (let index = 1; index < state.applied.length; index += 1) {
    if (state.applied[index - 1].sequence >= state.applied[index].sequence) {
      throw new SessionDagValueError("Session DAG applied history order is invalid");
    }
  }
  for (let index = 1; index < state.redo.length; index += 1) {
    if (state.redo[index - 1].sequence <= state.redo[index].sequence) {
      throw new SessionDagValueError("Session DAG redo history order is invalid");
    }
  }

  const canonicalEdges = new Map<string, SessionDagEdge>();
  const canonicalPairs = new Map<string, string>();
  const addCanonicalEdge = (edge: SessionDagEdge, allowExactDuplicate: boolean) => {
    const previous = canonicalEdges.get(edge.id);
    if (previous) {
      if (!allowExactDuplicate || !edgesEqual(previous, edge)) {
        throw new SessionDagValueError("Session DAG has conflicting edge records");
      }
      return;
    }
    const pair = edgePairKey(edge);
    const previousPairId = canonicalPairs.get(pair);
    if (previousPairId && previousPairId !== edge.id) {
      throw new SessionDagValueError("Session DAG has duplicate directed pairs");
    }
    canonicalEdges.set(edge.id, edge);
    canonicalPairs.set(pair, edge.id);
  };
  for (const edge of state.activeEdges) addCanonicalEdge(edge, false);
  for (const batch of state.applied) {
    for (const edge of batch.archivedEdges) addCanonicalEdge(edge, false);
  }
  const activeById = new Map(state.activeEdges.map((edge) => [edge.id, edge]));
  for (const batch of state.redo) {
    for (const edge of batch.archivedEdges) {
      const active = activeById.get(edge.id);
      if (!active || !edgesEqual(active, edge)) {
        throw new SessionDagValueError("Session DAG redo edge is not active");
      }
      addCanonicalEdge(edge, true);
    }
  }
  if (canonicalEdges.size > SESSION_DAG_MAX_EDGE_RECORDS) {
    throw new SessionDagValueError("Session DAG has too many edge records");
  }

  const completed = new Set(state.applied.map((batch) => batch.completedSessionId));
  if (state.activeEdges.some((edge) => completed.has(edge.fromSessionId) || completed.has(edge.toSessionId))) {
    throw new SessionDagValueError("Session DAG active edge references a completed session");
  }
  const redoTip = state.redo.at(-1);
  if (redoTip) {
    const active = new Set(getActiveSessionIds(state));
    if (!active.has(redoTip.completedSessionId)
      || state.activeEdges.some((edge) => edge.toSessionId === redoTip.completedSessionId)) {
      throw new SessionDagValueError("Session DAG redo tip is not eligible");
    }
  }
  if (getActiveSessionIds(state).length > 0 && state.forms.length === 0) {
    throw new SessionDagValueError("Session DAG active nodes require a form");
  }

  const maximumSequence = Math.max(0, ...allBatches.map((batch) => batch.sequence));
  if (state.nextSequence <= maximumSequence) {
    throw new SessionDagValueError("Session DAG next completion sequence is invalid");
  }
  const maximumEdgeOrder = Math.max(0, ...canonicalEdges.values().map((edge) => edge.order));
  if (state.nextEdgeOrder <= maximumEdgeOrder) {
    throw new SessionDagValueError("Session DAG next edge order is invalid");
  }

  if (state.receipts.length > SESSION_DAG_MAX_RECEIPTS) {
    throw new SessionDagValueError("Session DAG has too many mutation receipts");
  }
  if (new Set(state.receipts.map((receipt) => receipt.mutationId)).size !== state.receipts.length) {
    throw new SessionDagValueError("Session DAG has duplicate mutation receipt ids");
  }
  if (state.receipts.some((receipt) => receipt.revision > state.revision)) {
    throw new SessionDagValueError("Session DAG mutation receipt revision is invalid");
  }
}

function parseStateBase(value: Record<string, unknown>, includeReceipts: boolean): StoredSessionDagState {
  const expectedKeys = [
    "version",
    "revision",
    "direction",
    "forms",
    "activeEdges",
    "applied",
    "redo",
    "nextSequence",
    "nextEdgeOrder",
    ...(includeReceipts ? ["receipts"] : []),
  ];
  assertExactKeys(value, expectedKeys, "Session DAG state");
  if (value.version !== SESSION_DAG_VERSION) throw new SessionDagValueError("Session DAG state version is unsupported");
  if (!Array.isArray(value.forms) || value.forms.length > SESSION_DAG_MAX_FORMS) {
    throw new SessionDagValueError("Session DAG forms must be a bounded array");
  }
  if (!Array.isArray(value.activeEdges) || value.activeEdges.length > SESSION_DAG_MAX_EDGE_RECORDS) {
    throw new SessionDagValueError("Session DAG active edges must be a bounded array");
  }
  if (!Array.isArray(value.applied) || !Array.isArray(value.redo)
    || value.applied.length + value.redo.length > SESSION_DAG_MAX_BATCHES) {
    throw new SessionDagValueError("Session DAG history must be bounded arrays");
  }
  const receiptsValue = includeReceipts ? value.receipts : [];
  if (!Array.isArray(receiptsValue) || receiptsValue.length > SESSION_DAG_MAX_RECEIPTS) {
    throw new SessionDagValueError("Session DAG receipts must be a bounded array");
  }
  const state: StoredSessionDagState = {
    version: SESSION_DAG_VERSION,
    revision: parseSafeCounter(value.revision, "Session DAG revision"),
    direction: parseDirection(value.direction, "Session DAG direction"),
    forms: value.forms.map(parseForm),
    activeEdges: value.activeEdges.map(parseEdge),
    applied: value.applied.map(parseCompletionBatch),
    redo: value.redo.map(parseCompletionBatch),
    nextSequence: parseSafeCounter(value.nextSequence, "Session DAG next sequence", 1),
    nextEdgeOrder: parseSafeCounter(value.nextEdgeOrder, "Session DAG next edge order", 1),
    receipts: receiptsValue.map(parseReceipt),
  };
  validateStateRelationships(state);
  return state;
}

export function parseStoredSessionDagState(value: unknown): StoredSessionDagState {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG state must be an object");
  return parseStateBase(value, true);
}

export function parseSessionDagState(value: unknown): SessionDagState {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG state must be an object");
  return toPublicSessionDagState(parseStateBase(value, false));
}

export function createDefaultStoredSessionDagState(): StoredSessionDagState {
  return {
    version: SESSION_DAG_VERSION,
    revision: 0,
    direction: "TD",
    forms: [{ id: SESSION_DAG_DEFAULT_FORM_ID }],
    activeEdges: [],
    applied: [],
    redo: [],
    nextSequence: 1,
    nextEdgeOrder: 1,
    receipts: [],
  };
}

export function toPublicSessionDagState(state: StoredSessionDagState): SessionDagState {
  return {
    version: state.version,
    revision: state.revision,
    direction: state.direction,
    forms: state.forms.map((form) => ({ ...form })),
    activeEdges: state.activeEdges.map((edge) => ({ ...edge })),
    applied: state.applied.map(cloneBatch),
    redo: state.redo.map(cloneBatch),
    nextSequence: state.nextSequence,
    nextEdgeOrder: state.nextEdgeOrder,
  };
}

function cloneBatch(batch: SessionDagCompletionBatch): SessionDagCompletionBatch {
  return {
    ...batch,
    archivedEdges: batch.archivedEdges.map((edge) => ({ ...edge })),
    nodeFormHints: batch.nodeFormHints.map((hint) => ({ ...hint })),
  };
}

function parseExpectedOutgoingEdgeIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > SESSION_DAG_MAX_EDGE_RECORDS) {
    throw new SessionDagValueError("Expected outgoing edge ids must be a bounded array");
  }
  const ids = value.map((id) => parseOpaqueId(id, "Expected outgoing edge id"));
  if (new Set(ids).size !== ids.length) {
    throw new SessionDagValueError("Expected outgoing edge ids contain duplicates");
  }
  return ids;
}

export function parseSessionDagOperation(value: unknown): SessionDagOperation {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new SessionDagValueError("Session DAG operation must be an object");
  }
  switch (value.type) {
    case "set_direction":
      assertExactKeys(value, ["type", "expectedDirection", "direction"], "Set direction operation");
      return {
        type: value.type,
        expectedDirection: parseDirection(value.expectedDirection, "Expected direction"),
        direction: parseDirection(value.direction, "Direction"),
      };
    case "create_form":
      assertExactKeys(value, ["type", "formId"], "Create form operation");
      return { type: value.type, formId: parseOpaqueId(value.formId, "Form id") };
    case "delete_form":
      assertExactKeys(value, ["type", "formId"], "Delete form operation");
      return { type: value.type, formId: parseOpaqueId(value.formId, "Form id") };
    case "add_edge":
      assertExactKeys(value, ["type", "edgeId", "formId", "fromSessionId", "toSessionId"], "Add edge operation");
      return {
        type: value.type,
        edgeId: parseOpaqueId(value.edgeId, "Edge id"),
        formId: parseOpaqueId(value.formId, "Form id"),
        fromSessionId: parseSessionId(value.fromSessionId, "From session id"),
        toSessionId: parseSessionId(value.toSessionId, "To session id"),
      };
    case "replace_edge": {
      assertExactKeys(value, ["type", "edgeId", "expected", "next"], "Replace edge operation");
      if (!isRecord(value.next)) throw new SessionDagValueError("Replacement edge must be an object");
      assertExactKeys(value.next, ["fromSessionId", "toSessionId"], "Replacement edge");
      return {
        type: value.type,
        edgeId: parseOpaqueId(value.edgeId, "Edge id"),
        expected: parseEdgeExpectation(value.expected, "Expected edge"),
        next: {
          fromSessionId: parseSessionId(value.next.fromSessionId, "Replacement from session id"),
          toSessionId: parseSessionId(value.next.toSessionId, "Replacement to session id"),
        },
      };
    }
    case "insert_edge":
      assertExactKeys(
        value,
        ["type", "edgeId", "expected", "insertedSessionId", "firstEdgeId", "secondEdgeId"],
        "Insert edge operation",
      );
      return {
        type: value.type,
        edgeId: parseOpaqueId(value.edgeId, "Edge id"),
        expected: parseEdgeExpectation(value.expected, "Expected edge"),
        insertedSessionId: parseSessionId(value.insertedSessionId, "Inserted session id"),
        firstEdgeId: parseOpaqueId(value.firstEdgeId, "First edge id"),
        secondEdgeId: parseOpaqueId(value.secondEdgeId, "Second edge id"),
      };
    case "delete_edge":
      assertExactKeys(value, ["type", "edgeId", "expected"], "Delete edge operation");
      return {
        type: value.type,
        edgeId: parseOpaqueId(value.edgeId, "Edge id"),
        expected: parseEdgeExpectation(value.expected, "Expected edge"),
      };
    case "complete":
      assertExactKeys(value, ["type", "batchId", "sessionId", "expectedOutgoingEdgeIds"], "Complete operation");
      return {
        type: value.type,
        batchId: parseOpaqueId(value.batchId, "Completion batch id"),
        sessionId: parseSessionId(value.sessionId, "Completed session id"),
        expectedOutgoingEdgeIds: parseExpectedOutgoingEdgeIds(value.expectedOutgoingEdgeIds),
      };
    case "undo":
    case "redo":
      assertExactKeys(value, ["type", "expectedBatchId"], `${value.type === "undo" ? "Undo" : "Redo"} operation`);
      return {
        type: value.type,
        expectedBatchId: parseOpaqueId(value.expectedBatchId, "Expected completion batch id"),
      };
    default:
      throw new SessionDagValueError("Session DAG operation type is invalid");
  }
}

export function parseSessionDagMutationEnvelope(value: unknown): SessionDagMutationEnvelope {
  if (!isRecord(value)) throw new SessionDagValueError("Session DAG mutation must be an object");
  assertExactKeys(value, ["mutationId", "baseRevision", "operation"], "Session DAG mutation");
  return {
    mutationId: parseOpaqueId(value.mutationId, "Mutation id"),
    baseRevision: parseSafeCounter(value.baseRevision, "Base revision"),
    operation: parseSessionDagOperation(value.operation),
  };
}

export function getCompletedSessionIds(state: Pick<SessionDagState, "applied">): Set<string> {
  return new Set(state.applied.map((batch) => batch.completedSessionId));
}

export function getActiveSessionIds(
  state: Pick<SessionDagState, "activeEdges" | "applied">,
): string[] {
  const ids = new Set<string>();
  for (const edge of state.activeEdges) {
    ids.add(edge.fromSessionId);
    ids.add(edge.toSessionId);
  }
  for (const batch of state.applied) {
    for (const edge of batch.archivedEdges) {
      ids.add(edge.fromSessionId);
      ids.add(edge.toSessionId);
    }
  }
  for (const completedId of getCompletedSessionIds(state)) ids.delete(completedId);
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function getEligibleSessionIds(
  state: Pick<SessionDagState, "activeEdges" | "applied">,
): Set<string> {
  const eligible = new Set(getActiveSessionIds(state));
  for (const edge of state.activeEdges) eligible.delete(edge.toSessionId);
  return eligible;
}

export function deriveSessionDagNodeFormAssignments(
  state: Pick<SessionDagState, "forms" | "activeEdges" | "applied" | "redo">,
): Map<string, string> {
  const activeIds = getActiveSessionIds(state);
  const active = new Set(activeIds);
  const survivingForms = new Set(state.forms.map((form) => form.id));
  const formOrder = new Map(state.forms.map((form, index) => [form.id, index]));
  const assignments = new Map<string, string>();
  const assign = (sessionId: string, formId: string) => {
    if (active.has(sessionId) && survivingForms.has(formId) && !assignments.has(sessionId)) {
      assignments.set(sessionId, formId);
    }
  };

  // An undone terminal has no restored outgoing edge. Its own redo-resident
  // completion hint is therefore the first source of its prior form.
  for (let index = state.redo.length - 1; index >= 0; index -= 1) {
    const batch = state.redo[index];
    const ownHint = batch.nodeFormHints.find((hint) => hint.sessionId === batch.completedSessionId);
    if (ownHint) assign(batch.completedSessionId, ownHint.formId);
  }
  // Newer applied hints represent the latest surviving historical assignment.
  for (let index = state.applied.length - 1; index >= 0; index -= 1) {
    for (const hint of state.applied[index].nodeFormHints) assign(hint.sessionId, hint.formId);
  }
  const activeEdges = [...state.activeEdges].sort((left, right) => (
    (formOrder.get(left.formId) ?? Number.MAX_SAFE_INTEGER)
      - (formOrder.get(right.formId) ?? Number.MAX_SAFE_INTEGER)
    || compareEdges(left, right)
  ));
  for (const edge of activeEdges) {
    assign(edge.fromSessionId, edge.formId);
    assign(edge.toSessionId, edge.formId);
  }
  for (let index = state.applied.length - 1; index >= 0; index -= 1) {
    for (const edge of [...state.applied[index].archivedEdges].sort(compareEdges)) {
      assign(edge.fromSessionId, edge.formId);
      assign(edge.toSessionId, edge.formId);
    }
  }

  const fallbackFormId = state.forms[0]?.id;
  if (fallbackFormId) {
    for (const sessionId of activeIds) {
      if (!assignments.has(sessionId)) assignments.set(sessionId, fallbackFormId);
    }
  }
  return assignments;
}

export function canDeleteSessionDagForm(state: SessionDagState, formId: string): boolean {
  if (state.activeEdges.some((edge) => edge.formId === formId)) return false;
  for (const assignedFormId of deriveSessionDagNodeFormAssignments(state).values()) {
    if (assignedFormId === formId) return false;
  }
  return state.forms.some((form) => form.id === formId);
}

function stateHasEdgeId(state: SessionDagState, edgeId: string): boolean {
  return state.activeEdges.some((edge) => edge.id === edgeId)
    || state.applied.some((batch) => batch.archivedEdges.some((edge) => edge.id === edgeId))
    || state.redo.some((batch) => batch.archivedEdges.some((edge) => edge.id === edgeId));
}

function stateHasBatchId(state: SessionDagState, batchId: string): boolean {
  return state.applied.some((batch) => batch.id === batchId)
    || state.redo.some((batch) => batch.id === batchId);
}

function countLogicalEdges(state: SessionDagState): number {
  const ids = new Set(state.activeEdges.map((edge) => edge.id));
  for (const batch of [...state.applied, ...state.redo]) {
    for (const edge of batch.archivedEdges) ids.add(edge.id);
  }
  return ids.size;
}

function withRedoCleared<T extends SessionDagState>(state: T): T {
  return state.redo.length === 0 ? state : { ...state, redo: [] };
}

function assertCurrentSessionIds(
  availableSessionIds: ReadonlySet<string> | undefined,
  sessionIds: readonly string[],
  message: string,
): void {
  if (!availableSessionIds || sessionIds.some((sessionId) => !availableSessionIds.has(sessionId))) {
    throw new SessionDagConflictError("session_dag_session_not_found", message);
  }
}

function assertCurrentSessions(
  availableSessionIds: ReadonlySet<string> | undefined,
  fromSessionId: string,
  toSessionId: string,
): void {
  assertCurrentSessionIds(
    availableSessionIds,
    [fromSessionId, toSessionId],
    "Both sessions must exist in the current session listing",
  );
}

function assertSessionsNotCompleted(state: SessionDagState, ...sessionIds: string[]): void {
  const completed = getCompletedSessionIds(state);
  if (sessionIds.some((sessionId) => completed.has(sessionId))) {
    throw new SessionDagConflictError("session_dag_session_completed", "Completed sessions cannot be used in an edge");
  }
}

function assertNoDuplicatePair(
  state: SessionDagState,
  fromSessionId: string,
  toSessionId: string,
  excludedEdgeId?: string,
): void {
  if (state.activeEdges.some((edge) => edge.id !== excludedEdgeId
    && edge.fromSessionId === fromSessionId
    && edge.toSessionId === toSessionId)) {
    throw new SessionDagConflictError("session_dag_duplicate_edge", "That directed session pair already exists");
  }
}

function requireForm(state: SessionDagState, formId: string): void {
  if (!state.forms.some((form) => form.id === formId)) {
    throw new SessionDagConflictError("session_dag_target_changed", "The target form changed");
  }
}

function requireEdge(state: SessionDagState, edgeId: string, expected: SessionDagEdgeExpectation): SessionDagEdge {
  const edge = state.activeEdges.find((candidate) => candidate.id === edgeId);
  if (!edge || !edgeMatchesExpectation(edge, expected)) {
    throw new SessionDagConflictError("session_dag_target_changed", "The target edge changed");
  }
  return edge;
}

function edgeExpectation(edge: SessionDagEdge): SessionDagEdgeExpectation {
  return {
    formId: edge.formId,
    fromSessionId: edge.fromSessionId,
    toSessionId: edge.toSessionId,
  };
}

export interface ApplySessionDagOperationOptions {
  availableSessionIds?: ReadonlySet<string>;
  now?: () => Date;
}

export interface ApplySessionDagOperationResult {
  state: SessionDagState;
  changed: boolean;
}

export function applySessionDagOperation(
  state: SessionDagState,
  operation: SessionDagOperation,
  options: ApplySessionDagOperationOptions = {},
): ApplySessionDagOperationResult {
  switch (operation.type) {
    case "set_direction": {
      if (state.direction !== operation.expectedDirection) {
        throw new SessionDagConflictError("session_dag_target_changed", "The graph direction changed");
      }
      if (state.direction === operation.direction) return { state, changed: false };
      return {
        state: withRedoCleared({ ...state, direction: operation.direction }),
        changed: true,
      };
    }
    case "create_form": {
      if (state.forms.some((form) => form.id === operation.formId)) {
        throw new SessionDagConflictError("session_dag_target_changed", "The form id is already in use");
      }
      if (state.forms.length >= SESSION_DAG_MAX_FORMS) {
        throw new SessionDagConflictError("session_dag_limit_exceeded", "The graph has reached its form limit");
      }
      return {
        state: withRedoCleared({ ...state, forms: [...state.forms, { id: operation.formId }] }),
        changed: true,
      };
    }
    case "delete_form": {
      if (!state.forms.some((form) => form.id === operation.formId)) {
        throw new SessionDagConflictError("session_dag_target_changed", "The target form changed");
      }
      if (!canDeleteSessionDagForm(state, operation.formId)) {
        throw new SessionDagConflictError("session_dag_form_not_empty", "Only an empty form can be deleted");
      }
      return {
        state: withRedoCleared({
          ...state,
          forms: state.forms.filter((form) => form.id !== operation.formId),
        }),
        changed: true,
      };
    }
    case "add_edge": {
      requireForm(state, operation.formId);
      if (stateHasEdgeId(state, operation.edgeId)) {
        throw new SessionDagConflictError("session_dag_target_changed", "The edge id is already in use");
      }
      if (countLogicalEdges(state) >= SESSION_DAG_MAX_EDGE_RECORDS) {
        throw new SessionDagConflictError("session_dag_limit_exceeded", "The graph has reached its edge limit");
      }
      if (state.nextEdgeOrder >= Number.MAX_SAFE_INTEGER) {
        throw new SessionDagConflictError("session_dag_counter_overflow", "The graph edge order cannot advance");
      }
      assertCurrentSessions(options.availableSessionIds, operation.fromSessionId, operation.toSessionId);
      assertSessionsNotCompleted(state, operation.fromSessionId, operation.toSessionId);
      assertNoDuplicatePair(state, operation.fromSessionId, operation.toSessionId);
      const edge: SessionDagEdge = {
        id: operation.edgeId,
        formId: operation.formId,
        fromSessionId: operation.fromSessionId,
        toSessionId: operation.toSessionId,
        order: state.nextEdgeOrder,
      };
      return {
        state: withRedoCleared({
          ...state,
          activeEdges: [...state.activeEdges, edge],
          nextEdgeOrder: state.nextEdgeOrder + 1,
        }),
        changed: true,
      };
    }
    case "replace_edge": {
      const edge = requireEdge(state, operation.edgeId, operation.expected);
      assertCurrentSessions(options.availableSessionIds, operation.next.fromSessionId, operation.next.toSessionId);
      assertSessionsNotCompleted(state, operation.next.fromSessionId, operation.next.toSessionId);
      if (edge.fromSessionId === operation.next.fromSessionId
        && edge.toSessionId === operation.next.toSessionId) {
        return { state, changed: false };
      }
      assertNoDuplicatePair(state, operation.next.fromSessionId, operation.next.toSessionId, edge.id);
      return {
        state: withRedoCleared({
          ...state,
          activeEdges: state.activeEdges.map((candidate) => candidate.id === edge.id
            ? {
                ...candidate,
                fromSessionId: operation.next.fromSessionId,
                toSessionId: operation.next.toSessionId,
              }
            : candidate),
        }),
        changed: true,
      };
    }
    case "insert_edge": {
      const edge = requireEdge(state, operation.edgeId, operation.expected);
      if (operation.insertedSessionId === edge.fromSessionId
        || operation.insertedSessionId === edge.toSessionId) {
        throw new SessionDagConflictError(
          "session_dag_insert_endpoint",
          "Insert a session ID different from both dependency endpoints",
        );
      }
      if (operation.firstEdgeId === operation.secondEdgeId
        || stateHasEdgeId(state, operation.firstEdgeId)
        || stateHasEdgeId(state, operation.secondEdgeId)) {
        throw new SessionDagConflictError("session_dag_target_changed", "A new edge id is already in use");
      }
      if (state.nextEdgeOrder >= Number.MAX_SAFE_INTEGER) {
        throw new SessionDagConflictError("session_dag_counter_overflow", "The graph edge order cannot advance");
      }
      assertCurrentSessionIds(
        options.availableSessionIds,
        [edge.fromSessionId, edge.toSessionId, operation.insertedSessionId],
        "All three sessions must exist in the current session listing",
      );
      assertSessionsNotCompleted(
        state,
        edge.fromSessionId,
        edge.toSessionId,
        operation.insertedSessionId,
      );
      assertNoDuplicatePair(
        state,
        edge.fromSessionId,
        operation.insertedSessionId,
        edge.id,
      );
      assertNoDuplicatePair(
        state,
        operation.insertedSessionId,
        edge.toSessionId,
        edge.id,
      );

      const firstEdge: SessionDagEdge = {
        id: operation.firstEdgeId,
        formId: edge.formId,
        fromSessionId: edge.fromSessionId,
        toSessionId: operation.insertedSessionId,
        order: edge.order,
      };
      const secondEdge: SessionDagEdge = {
        id: operation.secondEdgeId,
        formId: edge.formId,
        fromSessionId: operation.insertedSessionId,
        toSessionId: edge.toSessionId,
        order: state.nextEdgeOrder,
      };
      const nextState = withRedoCleared({
        ...state,
        activeEdges: [
          ...state.activeEdges.filter((candidate) => candidate.id !== edge.id),
          firstEdge,
          secondEdge,
        ].sort(compareEdges),
        nextEdgeOrder: state.nextEdgeOrder + 1,
      });
      if (countLogicalEdges(nextState) > SESSION_DAG_MAX_EDGE_RECORDS) {
        throw new SessionDagConflictError("session_dag_limit_exceeded", "The graph has reached its edge limit");
      }
      return {
        // Validate every persisted relationship on the complete one-to-two result.
        state: parseSessionDagState(nextState),
        changed: true,
      };
    }
    case "delete_edge": {
      const edge = requireEdge(state, operation.edgeId, operation.expected);
      return {
        state: withRedoCleared({
          ...state,
          activeEdges: state.activeEdges.filter((candidate) => candidate.id !== edge.id),
        }),
        changed: true,
      };
    }
    case "complete": {
      if (stateHasBatchId(state, operation.batchId)) {
        throw new SessionDagConflictError("session_dag_target_changed", "The completion batch id is already in use");
      }
      // A new completion branches from the applied tip and discards redo, so
      // only the resulting applied stack counts toward the prospective limit.
      if (state.applied.length >= SESSION_DAG_MAX_BATCHES) {
        throw new SessionDagConflictError("session_dag_limit_exceeded", "The graph has reached its completion-history limit");
      }
      if (state.nextSequence >= Number.MAX_SAFE_INTEGER) {
        throw new SessionDagConflictError("session_dag_counter_overflow", "The completion sequence cannot advance");
      }
      const activeIds = new Set(getActiveSessionIds(state));
      if (!activeIds.has(operation.sessionId)) {
        throw new SessionDagConflictError("session_dag_node_not_active", "The session is not an active graph node");
      }
      if (state.activeEdges.some((edge) => edge.toSessionId === operation.sessionId)) {
        throw new SessionDagConflictError("session_dag_node_blocked", "The session still has an active prerequisite");
      }
      const outgoingEdges = state.activeEdges
        .filter((edge) => edge.fromSessionId === operation.sessionId)
        .sort(compareEdges);
      if (outgoingEdges.length !== operation.expectedOutgoingEdgeIds.length
        || outgoingEdges.some((edge, index) => edge.id !== operation.expectedOutgoingEdgeIds[index])) {
        throw new SessionDagConflictError("session_dag_target_changed", "The session's outgoing edges changed");
      }
      const assignments = deriveSessionDagNodeFormAssignments(state);
      const hintedIds = new Set<string>([operation.sessionId]);
      for (const edge of outgoingEdges) {
        hintedIds.add(edge.fromSessionId);
        hintedIds.add(edge.toSessionId);
      }
      const nodeFormHints = [...hintedIds]
        .sort((left, right) => left.localeCompare(right))
        .flatMap((sessionId) => {
          const formId = assignments.get(sessionId);
          return formId ? [{ sessionId, formId }] : [];
        });
      const completedAt = (options.now ?? (() => new Date()))().toISOString();
      const outgoingIds = new Set(outgoingEdges.map((edge) => edge.id));
      const batch: SessionDagCompletionBatch = {
        id: operation.batchId,
        completedSessionId: operation.sessionId,
        archivedEdges: outgoingEdges.map((edge) => ({ ...edge })),
        nodeFormHints,
        completedAt,
        sequence: state.nextSequence,
      };
      return {
        state: {
          ...state,
          activeEdges: state.activeEdges.filter((edge) => !outgoingIds.has(edge.id)),
          applied: [...state.applied, batch],
          redo: [],
          nextSequence: state.nextSequence + 1,
        },
        changed: true,
      };
    }
    case "undo": {
      const batch = state.applied.at(-1);
      if (!batch) throw new SessionDagConflictError("session_dag_history_empty", "There is no completion to undo");
      if (batch.id !== operation.expectedBatchId) {
        throw new SessionDagConflictError("session_dag_target_changed", "The completion history tip changed");
      }
      let forms = state.forms;
      if (forms.length === 0) forms = [{ id: SESSION_DAG_DEFAULT_FORM_ID }];
      const formIds = new Set(forms.map((form) => form.id));
      const fallbackFormId = forms[0].id;
      const restoredEdges = batch.archivedEdges.map((edge) => ({
        ...edge,
        formId: formIds.has(edge.formId) ? edge.formId : fallbackFormId,
      }));
      const restoredHints = batch.nodeFormHints.map((hint) => ({
        ...hint,
        formId: formIds.has(hint.formId) ? hint.formId : fallbackFormId,
      }));
      for (const restored of restoredEdges) {
        const existing = state.activeEdges.find((edge) => edge.id === restored.id);
        if (existing && !edgesEqual(existing, restored)) {
          throw new SessionDagConflictError("session_dag_target_changed", "An archived edge id is already in use");
        }
        assertNoDuplicatePair(state, restored.fromSessionId, restored.toSessionId, restored.id);
      }
      const adjustedBatch = {
        ...cloneBatch(batch),
        archivedEdges: restoredEdges,
        nodeFormHints: restoredHints,
      };
      return {
        state: {
          ...state,
          forms,
          activeEdges: [...state.activeEdges, ...restoredEdges].sort(compareEdges),
          applied: state.applied.slice(0, -1),
          redo: [...state.redo, adjustedBatch],
        },
        changed: true,
      };
    }
    case "redo": {
      const batch = state.redo.at(-1);
      if (!batch) throw new SessionDagConflictError("session_dag_history_empty", "There is no completion to redo");
      if (batch.id !== operation.expectedBatchId) {
        throw new SessionDagConflictError("session_dag_target_changed", "The redo history tip changed");
      }
      const activeIds = new Set(getActiveSessionIds(state));
      if (!activeIds.has(batch.completedSessionId)) {
        throw new SessionDagConflictError("session_dag_node_not_active", "The redone session is not an active graph node");
      }
      if (state.activeEdges.some((edge) => edge.toSessionId === batch.completedSessionId)) {
        throw new SessionDagConflictError("session_dag_node_blocked", "The redone session still has an active prerequisite");
      }
      const activeById = new Map(state.activeEdges.map((edge) => [edge.id, edge]));
      for (const archived of batch.archivedEdges) {
        const active = activeById.get(archived.id);
        if (!active || !edgesEqual(active, archived)) {
          throw new SessionDagConflictError("session_dag_target_changed", "An edge needed for redo changed");
        }
      }
      const archivedIds = new Set(batch.archivedEdges.map((edge) => edge.id));
      return {
        state: {
          ...state,
          activeEdges: state.activeEdges.filter((edge) => !archivedIds.has(edge.id)),
          applied: [...state.applied, cloneBatch(batch)],
          redo: state.redo.slice(0, -1),
        },
        changed: true,
      };
    }
  }
}

export function createEdgeExpectation(edge: SessionDagEdge): SessionDagEdgeExpectation {
  return edgeExpectation(edge);
}

function boundedLabelSegment(value: string, maximumLength = SESSION_DAG_MAX_LABEL_SEGMENT_LENGTH): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maximumLength - 1))}…`;
}

function escapeMermaidLabel(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function projectRoot(session: SessionInfo): string {
  return session.projectRoot ?? session.cwd;
}

export function buildSessionDagLabel(
  _sessionId: string,
  session: SessionInfo | undefined,
  projectPrefixes: ReadonlyMap<string, string>,
): string {
  if (!session) return "Session unavailable";
  const projectLabel = boundedLabelSegment(
    projectPrefixes.get(projectRoot(session)) ?? projectRoot(session),
  );
  const branchLabel = session.worktreeBranch ? boundedLabelSegment(session.worktreeBranch) : null;
  const title = boundedLabelSegment(getSessionDisplayTitle(session));
  return [projectLabel, branchLabel, title].filter((segment): segment is string => Boolean(segment)).join(" · ");
}

export type SessionDagRawEndpointStatus = "resolved" | "unavailable" | "unresolved";

export interface SessionDagRawEndpointPresentation {
  label: string;
  status: SessionDagRawEndpointStatus;
}

export function getSessionDagRawEndpointPresentation(
  displayedSessionId: string,
  acceptedSessionId: string | null,
  sessionsById: ReadonlyMap<string, SessionInfo>,
  projectPrefixes: ReadonlyMap<string, string>,
): SessionDagRawEndpointPresentation {
  const session = sessionsById.get(displayedSessionId);
  if (session) {
    return {
      label: buildSessionDagLabel(displayedSessionId, session, projectPrefixes),
      status: "resolved",
    };
  }
  if (acceptedSessionId !== null && displayedSessionId === acceptedSessionId) {
    return { label: "Session unavailable", status: "unavailable" };
  }
  return { label: "Session unresolved", status: "unresolved" };
}

export interface CompiledSessionDag {
  source: string;
  activeSessionIds: string[];
  activeEdgeCount: number;
  eligibleSessionIds: Set<string>;
  aliasesBySessionId: Map<string, string>;
  sessionIdsByAlias: Map<string, string>;
  labelsBySessionId: Map<string, string>;
  aliasesByEdgeId: Map<string, string>;
  edgesByAlias: Map<string, SessionDagEdge>;
}

export function compileSessionDag(
  state: Pick<SessionDagState, "direction" | "activeEdges" | "applied">,
  sessions: readonly SessionInfo[],
): CompiledSessionDag {
  const activeSessionIds = getActiveSessionIds(state);
  const eligibleSessionIds = getEligibleSessionIds(state);
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const prefixes = deriveShortestUniqueProjectPrefixes(sessions);
  const aliasesBySessionId = new Map<string, string>();
  const sessionIdsByAlias = new Map<string, string>();
  const labelsBySessionId = new Map<string, string>();
  const aliasesByEdgeId = new Map<string, string>();
  const edgesByAlias = new Map<string, SessionDagEdge>();
  const lines = [
    `flowchart ${state.direction}`,
    `accTitle: ${SESSION_DAG_ACCESSIBLE_TITLE}`,
    `accDescr: ${SESSION_DAG_ACCESSIBLE_DESCRIPTION}`,
  ];

  activeSessionIds.forEach((sessionId, index) => {
    const alias = `n${index}`;
    const label = buildSessionDagLabel(sessionId, sessionsById.get(sessionId), prefixes);
    aliasesBySessionId.set(sessionId, alias);
    sessionIdsByAlias.set(alias, sessionId);
    labelsBySessionId.set(sessionId, label);
    lines.push(`    ${alias}["${escapeMermaidLabel(label)}"]`);
  });

  const activeEdges = [...state.activeEdges].sort(compareEdges);
  activeEdges.forEach((edge, index) => {
    const fromAlias = aliasesBySessionId.get(edge.fromSessionId);
    const toAlias = aliasesBySessionId.get(edge.toSessionId);
    if (!fromAlias || !toAlias) {
      throw new SessionDagValueError("An active edge endpoint is missing from the compiled graph");
    }
    const edgeAlias = `e${index}`;
    aliasesByEdgeId.set(edge.id, edgeAlias);
    edgesByAlias.set(edgeAlias, { ...edge });
    lines.push(`    ${fromAlias} ${edgeAlias}@--> ${toAlias}`);
  });

  return {
    source: `${lines.join("\n")}\n`,
    activeSessionIds,
    activeEdgeCount: activeEdges.length,
    eligibleSessionIds,
    aliasesBySessionId,
    sessionIdsByAlias,
    labelsBySessionId,
    aliasesByEdgeId,
    edgesByAlias,
  };
}
