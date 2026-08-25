"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { scaledMenuFontSize } from "@/lib/display-preferences";
import { copyText } from "@/lib/clipboard";
import {
  buildSessionDagLabel,
  compileSessionDag,
  createEdgeExpectation,
  deriveSessionDagNodeFormAssignments,
  getActiveSessionIds,
  getEligibleSessionIds,
  getSessionDagRawEndpointPresentation,
  parseSessionDagState,
  type CompiledSessionDag,
  type SessionDagEdge,
  type SessionDagOperation,
  type SessionDagState,
} from "@/lib/session-dag";
import { deriveShortestUniqueProjectPrefixes } from "@/lib/sidebar-session-state";
import type { SessionInfo } from "@/lib/types";
import { useGlobalStatus } from "./GlobalStatusProvider";
import { SessionDagPreview } from "./SessionDagPreview";

interface Props {
  active: boolean;
  selectedSessionId: string | null;
}

type DagMode = "preview" | "raw";
interface PairDraft {
  fromSessionId: string;
  toSessionId: string;
}
interface Feedback {
  kind: "success" | "error" | "info";
  message: string;
  source?: "graph-load" | "session-load";
}

type OperationBuilder = (state: SessionDagState) => SessionDagOperation | null;

const EMPTY_PAIR: PairDraft = { fromSessionId: "", toSessionId: "" };
let fallbackEntityCounter = 0;

function createClientEntityId(prefix: "mutation" | "form" | "edge" | "batch"): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${(++fallbackEntityCounter).toString(36)}`;
  return `${prefix}-${suffix}`;
}

function responseErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const message = (value as { error?: unknown }).error;
  return typeof message === "string" && message.length > 0 && message.length <= 240
    ? message
    : fallback;
}

function isConflictBody(value: unknown): value is { code: string; state: unknown } {
  return Boolean(value && typeof value === "object"
    && typeof (value as { code?: unknown }).code === "string"
    && "state" in value);
}

function edgeDraftValue(drafts: ReadonlyMap<string, PairDraft>, edge: SessionDagEdge): PairDraft {
  return drafts.get(edge.id) ?? {
    fromSessionId: edge.fromSessionId,
    toSessionId: edge.toSessionId,
  };
}

function operationButtonStyle(active = false): React.CSSProperties {
  return {
    minHeight: 28,
    padding: "4px 8px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: active ? "var(--bg-selected)" : "var(--bg-panel)",
    color: active ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: scaledMenuFontSize(11),
    whiteSpace: "nowrap",
  };
}

export function SessionDagPanel({ active, selectedSessionId }: Props) {
  const { subscribeSessionsChanged } = useGlobalStatus();
  const [graphState, setGraphState] = useState<SessionDagState | null>(null);
  const graphStateRef = useRef<SessionDagState | null>(null);
  graphStateRef.current = graphState;
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [mode, setMode] = useState<DagMode>("preview");
  const [loading, setLoading] = useState(false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [formDrafts, setFormDrafts] = useState<Map<string, PairDraft>>(() => new Map());
  const [edgeDrafts, setEdgeDrafts] = useState<Map<string, PairDraft>>(() => new Map());
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const graphRequestRef = useRef(0);
  const sessionRequestRef = useRef(0);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mutationEpochRef = useRef(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reconcileDrafts = useCallback((state: SessionDagState) => {
    const formIds = new Set(state.forms.map((form) => form.id));
    const edgeIds = new Set(state.activeEdges.map((edge) => edge.id));
    setFormDrafts((current) => new Map([...current].filter(([formId]) => formIds.has(formId))));
    setEdgeDrafts((current) => new Map([...current].filter(([edgeId]) => edgeIds.has(edgeId))));
  }, []);

  const adoptGraphState = useCallback((incoming: SessionDagState, preserveDrafts = true) => {
    const current = graphStateRef.current;
    if (current && incoming.revision < current.revision) return false;
    graphStateRef.current = incoming;
    setGraphState(incoming);
    if (preserveDrafts) reconcileDrafts(incoming);
    return true;
  }, [reconcileDrafts]);

  const loadGraph = useCallback(async (announceFailure = false): Promise<boolean> => {
    const requestId = ++graphRequestRef.current;
    setLoading(true);
    try {
      const response = await fetch("/api/session-dag", { cache: "no-store" });
      const value: unknown = await response.json().catch(() => null);
      if (requestId !== graphRequestRef.current) return false;
      if (!response.ok) throw new Error(responseErrorMessage(value, "Dependency graph could not be loaded"));
      const state = parseSessionDagState(value);
      adoptGraphState(state);
      setFeedback((current) => current?.source === "graph-load" ? null : current);
      return true;
    } catch {
      if (requestId === graphRequestRef.current && (announceFailure || !graphStateRef.current)) {
        setFeedback({
          kind: "error",
          message: "Dependency graph could not be loaded. Refresh to retry.",
          source: "graph-load",
        });
      }
      return false;
    } finally {
      if (requestId === graphRequestRef.current) setLoading(false);
    }
  }, [adoptGraphState]);

  const loadSessions = useCallback(async (): Promise<boolean> => {
    const requestId = ++sessionRequestRef.current;
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      const value = await response.json() as { sessions?: unknown };
      if (requestId !== sessionRequestRef.current) return false;
      if (!response.ok || !Array.isArray(value.sessions)) throw new Error("session_metadata_failed");
      setSessions(value.sessions as SessionInfo[]);
      setFeedback((current) => current?.source === "session-load" ? null : current);
      return true;
    } catch {
      if (requestId === sessionRequestRef.current) {
        setFeedback({
          kind: "error",
          message: "Session labels could not be refreshed.",
          source: "session-load",
        });
      }
      return false;
    }
  }, []);

  const refresh = useCallback((announceFailure = false) => {
    void Promise.all([loadGraph(announceFailure), loadSessions()]);
  }, [loadGraph, loadSessions]);

  useEffect(() => {
    if (active) refresh(false);
  }, [active, refresh]);

  useEffect(() => {
    const onFocus = () => refresh(false);
    const onOnline = () => refresh(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  useEffect(() => subscribeSessionsChanged(() => {
    void loadSessions();
  }), [loadSessions, subscribeSessionsChanged]);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const runMutation = useCallback((buildOperation: OperationBuilder): Promise<boolean> => {
    const mutationId = createClientEntityId("mutation");
    const queuedEpoch = mutationEpochRef.current;
    setPendingMutations((count) => count + 1);
    let resolveResult: (value: boolean) => void = () => {};
    const result = new Promise<boolean>((resolve) => { resolveResult = resolve; });

    mutationQueueRef.current = mutationQueueRef.current.then(async () => {
      if (queuedEpoch !== mutationEpochRef.current) {
        resolveResult(false);
        return;
      }
      const baseState = graphStateRef.current;
      if (!baseState) {
        setFeedback({ kind: "error", message: "Dependency graph is not loaded." });
        resolveResult(false);
        return;
      }
      const operation = buildOperation(baseState);
      if (!operation) {
        resolveResult(false);
        return;
      }
      const envelope = { mutationId, baseRevision: baseState.revision, operation };

      try {
        let response: Response | null = null;
        let value: unknown;
        let networkError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            response = await fetch("/api/session-dag", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(envelope),
            });
            value = await response.json();
            networkError = undefined;
            break;
          } catch (error) {
            response = null;
            networkError = error;
          }
        }
        if (!response) throw networkError ?? new Error("graph_mutation_failed");
        if (response.status === 409 && isConflictBody(value)) {
          const authoritative = parseSessionDagState(value.state);
          graphRequestRef.current += 1;
          setLoading(false);
          adoptGraphState(authoritative);
          mutationEpochRef.current += 1;
          setFeedback({ kind: "error", message: "Graph changed elsewhere; review and retry" });
          resolveResult(false);
          return;
        }
        if (!response.ok) {
          setFeedback({ kind: "error", message: responseErrorMessage(value, "Dependency graph could not be updated") });
          resolveResult(false);
          return;
        }
        const authoritative = parseSessionDagState(value);
        graphRequestRef.current += 1;
        setLoading(false);
        adoptGraphState(authoritative);
        setFeedback({ kind: "success", message: "Dependency graph updated." });
        resolveResult(true);
      } catch {
        setFeedback({ kind: "error", message: "Dependency graph could not be updated. Review and retry." });
        resolveResult(false);
      }
    }).catch(() => {
      resolveResult(false);
    }).finally(() => {
      setPendingMutations((count) => Math.max(0, count - 1));
    });
    return result;
  }, [adoptGraphState]);

  const copySessionId = useCallback(async (sessionId: string) => {
    try {
      await copyText(sessionId);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopiedSessionId(sessionId);
      setFeedback({ kind: "success", message: "Session ID copied." });
      copiedTimerRef.current = setTimeout(() => setCopiedSessionId(null), 1_400);
    } catch {
      setCopiedSessionId(null);
      setFeedback({ kind: "error", message: "Session ID could not be copied." });
    }
  }, []);

  const compilation = useMemo<{
    compiled: CompiledSessionDag | null;
    error: unknown;
  }>(() => {
    if (!graphState) return { compiled: null, error: null };
    try {
      return { compiled: compileSessionDag(graphState, sessions), error: null };
    } catch (error) {
      return { compiled: null, error };
    }
  }, [graphState, sessions]);
  const sessionsById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const projectPrefixes = useMemo(() => deriveShortestUniqueProjectPrefixes(sessions), [sessions]);
  const activeSessionIds = useMemo(() => graphState ? getActiveSessionIds(graphState) : [], [graphState]);
  const eligibleSessionIds = useMemo(() => graphState ? getEligibleSessionIds(graphState) : new Set<string>(), [graphState]);
  const nodeAssignments = useMemo(
    () => graphState ? deriveSessionDagNodeFormAssignments(graphState) : new Map<string, string>(),
    [graphState],
  );
  const referencedFormIds = useMemo(() => {
    const ids = new Set(graphState?.activeEdges.map((edge) => edge.formId) ?? []);
    for (const formId of nodeAssignments.values()) ids.add(formId);
    return ids;
  }, [graphState, nodeAssignments]);
  const busy = pendingMutations > 0;

  const completeSession = useCallback((sessionId: string): Promise<boolean> => runMutation((state) => ({
    type: "complete",
    batchId: createClientEntityId("batch"),
    sessionId,
    expectedOutgoingEdgeIds: state.activeEdges
      .filter((edge) => edge.fromSessionId === sessionId)
      .sort((left, right) => left.order - right.order)
      .map((edge) => edge.id),
  })), [runMutation]);

  const submitTrailingDraft = (formId: string) => {
    const draft = formDrafts.get(formId) ?? EMPTY_PAIR;
    if (!draft.fromSessionId || !draft.toSessionId) {
      setFeedback({ kind: "error", message: "Enter both From session ID and To session ID." });
      return;
    }
    const submitted = { ...draft };
    void runMutation(() => ({
      type: "add_edge",
      edgeId: createClientEntityId("edge"),
      formId,
      ...submitted,
    })).then((accepted) => {
      if (!accepted) return;
      setFormDrafts((current) => {
        const next = new Map(current);
        next.delete(formId);
        return next;
      });
    });
  };

  const replaceEdge = useCallback((
    edge: SessionDagEdge,
    nextPair: PairDraft,
  ): Promise<boolean> => {
    const expected = createEdgeExpectation(edge);
    return runMutation((state) => {
      const currentEdge = state.activeEdges.find((candidate) => candidate.id === edge.id);
      if (!currentEdge || currentEdge.formId !== expected.formId
        || currentEdge.fromSessionId !== expected.fromSessionId
        || currentEdge.toSessionId !== expected.toSessionId) {
        setFeedback({ kind: "error", message: "Graph changed elsewhere; review and retry" });
        return null;
      }
      return {
        type: "replace_edge",
        edgeId: edge.id,
        expected,
        next: nextPair,
      };
    });
  }, [runMutation]);

  const clearEdgeDraft = (edgeId: string) => {
    setEdgeDrafts((current) => {
      const next = new Map(current);
      next.delete(edgeId);
      return next;
    });
  };

  const submitEdgeDraft = (edge: SessionDagEdge) => {
    const draft = edgeDraftValue(edgeDrafts, edge);
    if (!draft.fromSessionId || !draft.toSessionId) {
      setFeedback({ kind: "error", message: "Enter both From session ID and To session ID." });
      return;
    }
    void replaceEdge(edge, { ...draft }).then((accepted) => {
      if (accepted) clearEdgeDraft(edge.id);
    });
  };

  const submitEdgeSwap = (edge: SessionDagEdge) => {
    const displayed = edgeDraftValue(edgeDrafts, edge);
    if (!displayed.fromSessionId || !displayed.toSessionId) {
      setFeedback({ kind: "error", message: "Enter both From session ID and To session ID." });
      return;
    }
    if (displayed.fromSessionId === displayed.toSessionId) return;
    void replaceEdge(edge, {
      fromSessionId: displayed.toSessionId,
      toSessionId: displayed.fromSessionId,
    }).then((accepted) => {
      if (accepted) clearEdgeDraft(edge.id);
    });
  };

  const swapEdge = useCallback((edge: SessionDagEdge): Promise<boolean> => {
    if (edge.fromSessionId === edge.toSessionId) return Promise.resolve(false);
    return replaceEdge(edge, {
      fromSessionId: edge.toSessionId,
      toSessionId: edge.fromSessionId,
    });
  }, [replaceEdge]);

  const pairKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    onEnter: () => void,
    onEscape?: () => void,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onEnter();
    } else if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
    }
  };

  return (
    <section className="session-dag-panel" aria-label="Session dependency graph">
      <div className="session-dag-toolbar" aria-label="Dependency graph controls">
        <div className="session-dag-toolbar-group" aria-label="View mode">
          {(["preview", "raw"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => setMode(candidate)}
              aria-pressed={mode === candidate}
              style={operationButtonStyle(mode === candidate)}
            >
              {candidate === "preview" ? "Preview" : "Raw"}
            </button>
          ))}
        </div>
        <div className="session-dag-toolbar-group" aria-label="Graph direction">
          {(["TD", "LR"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              disabled={!graphState || busy}
              onClick={() => {
                void runMutation((state) => ({
                  type: "set_direction",
                  expectedDirection: state.direction,
                  direction,
                }));
              }}
              aria-pressed={graphState?.direction === direction}
              title={direction === "TD" ? "Top to bottom" : "Left to right"}
              style={operationButtonStyle(graphState?.direction === direction)}
            >
              {direction}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => refresh(true)}
          style={operationButtonStyle()}
        >
          Refresh
        </button>
        <button
          type="button"
          disabled={!graphState?.applied.length || busy}
          onClick={() => {
            void runMutation((state) => {
              const tip = state.applied.at(-1);
              return tip ? { type: "undo", expectedBatchId: tip.id } : null;
            });
          }}
          style={operationButtonStyle()}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!graphState?.redo.length || busy}
          onClick={() => {
            void runMutation((state) => {
              const tip = state.redo.at(-1);
              return tip ? { type: "redo", expectedBatchId: tip.id } : null;
            });
          }}
          style={operationButtonStyle()}
        >
          Redo
        </button>
        {mode === "raw" && (
          <button
            type="button"
            disabled={!graphState || busy}
            onClick={() => {
              void runMutation(() => ({ type: "create_form", formId: createClientEntityId("form") }));
            }}
            style={{ ...operationButtonStyle(), marginLeft: "auto" }}
          >
            Add form
          </button>
        )}
      </div>

      <div className="session-dag-feedback" aria-live="polite" aria-atomic="true" data-kind={feedback?.kind}>
        {feedback?.message ?? ""}
      </div>

      {!graphState ? (
        <div className="session-dag-empty-state" role="status">
          {loading ? "Loading dependency graph…" : "Dependency graph is unavailable."}
        </div>
      ) : (
        <>
          <div
            className="session-dag-mode-panel"
            hidden={mode !== "preview"}
            aria-hidden={mode !== "preview"}
          >
            <SessionDagPreview
              active={active && mode === "preview"}
              selectedSessionId={selectedSessionId}
              compiled={compilation.compiled}
              compileError={compilation.error}
              revision={graphState.revision}
              nodeCount={activeSessionIds.length}
              edgeCount={graphState.activeEdges.length}
              onComplete={completeSession}
              onSwap={swapEdge}
            />
          </div>
          <div
            className="session-dag-mode-panel session-dag-raw"
            hidden={mode !== "raw"}
            aria-hidden={mode !== "raw"}
          >
            {graphState.forms.length === 0 ? (
              <div className="session-dag-empty-state">No forms. Add a form to author a dependency.</div>
            ) : graphState.forms.map((form, formIndex) => {
              const edges = graphState.activeEdges.filter((edge) => edge.formId === form.id);
              const nodeIds = activeSessionIds.filter((sessionId) => nodeAssignments.get(sessionId) === form.id);
              const trailingDraft = formDrafts.get(form.id) ?? EMPTY_PAIR;
              const trailingFromPresentation = getSessionDagRawEndpointPresentation(
                trailingDraft.fromSessionId,
                null,
                sessionsById,
                projectPrefixes,
              );
              const trailingToPresentation = getSessionDagRawEndpointPresentation(
                trailingDraft.toSessionId,
                null,
                sessionsById,
                projectPrefixes,
              );
              const hasUnfinishedDraft = Boolean(trailingDraft.fromSessionId || trailingDraft.toSessionId);
              const canDelete = !referencedFormIds.has(form.id) && !hasUnfinishedDraft;
              return (
                <section key={form.id} className="session-dag-form" aria-labelledby={`session-dag-form-${formIndex}`}>
                  <div className="session-dag-form-heading">
                    <h3 id={`session-dag-form-${formIndex}`}>Form {formIndex + 1}</h3>
                    {canDelete && (
                      <button
                        type="button"
                        disabled={busy}
                        className="session-dag-form-delete"
                        title={`Delete Form ${formIndex + 1}`}
                        aria-label={`Delete Form ${formIndex + 1}`}
                        onClick={() => {
                          void runMutation(() => ({ type: "delete_form", formId: form.id }));
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div className="session-dag-edge-list" aria-label={`Form ${formIndex + 1} dependencies`}>
                    {edges.map((edge) => {
                      const draft = edgeDraftValue(edgeDrafts, edge);
                      const fromPresentation = getSessionDagRawEndpointPresentation(
                        draft.fromSessionId,
                        edge.fromSessionId,
                        sessionsById,
                        projectPrefixes,
                      );
                      const toPresentation = getSessionDagRawEndpointPresentation(
                        draft.toSessionId,
                        edge.toSessionId,
                        sessionsById,
                        projectPrefixes,
                      );
                      const swapLabel = `Swap dependency from ${fromPresentation.label} to ${toPresentation.label}`;
                      return (
                        <div key={edge.id} className="session-dag-edge-row">
                          <label>
                            <span>From session ID</span>
                            <input
                              value={draft.fromSessionId}
                              disabled={busy}
                              onChange={(event) => setEdgeDrafts((current) => {
                                const next = new Map(current);
                                next.set(edge.id, { ...draft, fromSessionId: event.target.value });
                                return next;
                              })}
                              onKeyDown={(event) => pairKeyDown(
                                event,
                                () => submitEdgeDraft(edge),
                                () => clearEdgeDraft(edge.id),
                              )}
                            />
                            <span
                              className="session-dag-edge-session-label"
                              data-state={fromPresentation.status}
                              title={fromPresentation.label}
                            >
                              {fromPresentation.label}
                            </span>
                          </label>
                          <span className="session-dag-edge-arrow" aria-hidden="true">→</span>
                          <label>
                            <span>To session ID</span>
                            <input
                              value={draft.toSessionId}
                              disabled={busy}
                              onChange={(event) => setEdgeDrafts((current) => {
                                const next = new Map(current);
                                next.set(edge.id, { ...draft, toSessionId: event.target.value });
                                return next;
                              })}
                              onKeyDown={(event) => pairKeyDown(
                                event,
                                () => submitEdgeDraft(edge),
                                () => clearEdgeDraft(edge.id),
                              )}
                            />
                            <span
                              className="session-dag-edge-session-label"
                              data-state={toPresentation.status}
                              title={toPresentation.label}
                            >
                              {toPresentation.label}
                            </span>
                          </label>
                          <div className="session-dag-edge-actions">
                            <button
                              type="button"
                              disabled={busy || draft.fromSessionId === draft.toSessionId}
                              className="session-dag-edge-swap"
                              title={swapLabel}
                              aria-label={swapLabel}
                              onClick={() => submitEdgeSwap(edge)}
                            >
                              Swap
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="session-dag-edge-delete"
                              title="Delete dependency"
                              aria-label="Delete dependency"
                              onClick={() => {
                                void runMutation(() => ({
                                  type: "delete_edge",
                                  edgeId: edge.id,
                                  expected: createEdgeExpectation(edge),
                                }));
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    <div className="session-dag-edge-row session-dag-edge-draft">
                      <label>
                        <span>From session ID</span>
                        <input
                          value={trailingDraft.fromSessionId}
                          disabled={busy}
                          placeholder="From session ID"
                          onChange={(event) => setFormDrafts((current) => {
                            const next = new Map(current);
                            next.set(form.id, { ...trailingDraft, fromSessionId: event.target.value });
                            return next;
                          })}
                          onKeyDown={(event) => pairKeyDown(event, () => submitTrailingDraft(form.id))}
                        />
                        <span
                          className="session-dag-edge-session-label"
                          data-state={trailingFromPresentation.status}
                          title={trailingFromPresentation.label}
                        >
                          {trailingFromPresentation.label}
                        </span>
                      </label>
                      <span className="session-dag-edge-arrow" aria-hidden="true">→</span>
                      <label>
                        <span>To session ID</span>
                        <input
                          value={trailingDraft.toSessionId}
                          disabled={busy}
                          placeholder="To session ID"
                          onChange={(event) => setFormDrafts((current) => {
                            const next = new Map(current);
                            next.set(form.id, { ...trailingDraft, toSessionId: event.target.value });
                            return next;
                          })}
                          onKeyDown={(event) => pairKeyDown(event, () => submitTrailingDraft(form.id))}
                        />
                        <span
                          className="session-dag-edge-session-label"
                          data-state={trailingToPresentation.status}
                          title={trailingToPresentation.label}
                        >
                          {trailingToPresentation.label}
                        </span>
                      </label>
                      <div className="session-dag-edge-actions">
                        <button
                          type="button"
                          disabled={busy || trailingDraft.fromSessionId === trailingDraft.toSessionId}
                          className="session-dag-edge-swap"
                          title="Swap new dependency From and To values"
                          aria-label="Swap new dependency From and To values"
                          onClick={() => setFormDrafts((current) => {
                            const next = new Map(current);
                            next.set(form.id, {
                              fromSessionId: trailingDraft.toSessionId,
                              toSessionId: trailingDraft.fromSessionId,
                            });
                            return next;
                          })}
                        >
                          Swap
                        </button>
                        <span className="session-dag-edge-draft-hint">Enter to add</span>
                      </div>
                    </div>
                  </div>

                  {nodeIds.length > 0 && (
                    <div className="session-dag-node-list" aria-label={`Form ${formIndex + 1} active sessions`}>
                      {nodeIds.map((sessionId) => {
                        const session = sessionsById.get(sessionId);
                        const label = buildSessionDagLabel(sessionId, session, projectPrefixes);
                        const eligible = eligibleSessionIds.has(sessionId);
                        const copied = copiedSessionId === sessionId;
                        return (
                          <div key={sessionId} className="session-dag-node-control">
                            <div className="session-dag-node-text">
                              <div className="session-dag-node-label">{session ? label : "Session unavailable"}</div>
                              <code title={sessionId}>{sessionId}</code>
                            </div>
                            <button
                              type="button"
                              onClick={() => { void copySessionId(sessionId); }}
                              className="session-dag-node-copy"
                              title={copied ? "Copied" : "Copy session ID"}
                              aria-label={copied
                                ? `Session ID copied: ${sessionId}`
                                : `Copy session ID: ${sessionId}`}
                            >
                              {copied ? "Copied" : "Copy ID"}
                            </button>
                            <button
                              type="button"
                              disabled={!eligible || busy}
                              onClick={() => { void completeSession(sessionId); }}
                              className="session-dag-node-complete"
                              title={eligible ? `Complete ${label}` : "Waiting for active prerequisites"}
                              aria-label={eligible
                                ? `Complete ${label}`
                                : `Waiting for active prerequisites for ${label}`}
                            >
                              {eligible ? "Complete" : "Waiting"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
