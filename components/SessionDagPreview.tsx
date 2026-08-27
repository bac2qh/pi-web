"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDisplayPreferences } from "@/hooks/useDisplayPreferences";
import { useTheme } from "@/hooks/useTheme";
import {
  buildMermaidRenderKey,
  enqueueMermaidOperation,
  mermaidDisplayConfig,
} from "@/lib/mermaid-display";
import {
  SESSION_DAG_MAX_SESSION_ID_LENGTH,
  type CompiledSessionDag,
  type SessionDagEdge,
} from "@/lib/session-dag";
import {
  SESSION_DAG_SHADOW_STYLES,
  SessionDagSvgError,
  createSessionDagCompleteControl,
  createSessionDagControlLayer,
  createSessionDagEdgeActionControl,
  getSessionDagControlPosition,
  getSessionDagEdgeMidpoint,
  getSessionDagOverlayPosition,
  prepareSessionDagSvg,
  updateSessionDagCurrentNode,
  updateSessionDagEdgeActionControl,
  type PreparedSessionDagSvg,
  type SessionDagEdgeActionControl,
  type SessionDagEdgeActionMode,
  type SessionDagSvgFailureStage,
} from "@/lib/session-dag-svg";

interface Props {
  active: boolean;
  selectedSessionId: string | null;
  compiled: CompiledSessionDag | null;
  compileError: unknown;
  revision: number;
  nodeCount: number;
  edgeCount: number;
  onComplete: (sessionId: string) => Promise<boolean>;
  onSwap: (edge: SessionDagEdge) => Promise<boolean>;
  onInsert: (edge: SessionDagEdge, insertedSessionId: string) => Promise<boolean>;
}

type PreviewFailureStage = "compile" | "load" | "parse" | "render" | SessionDagSvgFailureStage;
type EdgeFocusTarget = "dot" | "swap" | "insert" | "input" | null;

interface EdgeInteraction {
  edgeId: string;
  formId: string;
  fromSessionId: string;
  toSessionId: string;
  mode: Exclude<SessionDagEdgeActionMode, "collapsed">;
  value: string;
  pending: boolean;
  focusTarget: EdgeFocusTarget;
}

interface EdgeControlRecord {
  edge: SessionDagEdge;
  control: SessionDagEdgeActionControl;
  form: HTMLFormElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
  apply: () => void;
}

function boundedErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/u.test(name) ? name : "Error";
}

function logPreviewFailure(
  stage: PreviewFailureStage,
  revision: number,
  nodeCount: number,
  edgeCount: number,
  error: unknown,
): void {
  console.error("[pi-web] session_dag_preview_failed", {
    operation: "render",
    stage,
    revision,
    nodeCount,
    edgeCount,
    status: "failed",
    errorClass: boundedErrorClass(error),
  });
}

function interactionMatchesRecord(
  interaction: EdgeInteraction | null,
  record: EdgeControlRecord,
): interaction is EdgeInteraction {
  return interaction?.edgeId === record.edge.id
    && interaction.formId === record.edge.formId
    && interaction.fromSessionId === record.edge.fromSessionId
    && interaction.toSessionId === record.edge.toSessionId;
}

function focusElement(element: Element | null): void {
  if (!element?.isConnected || !("focus" in element)) return;
  (element as Element & { focus(options?: FocusOptions): void }).focus({ preventScroll: true });
}

export function SessionDagPreview({
  active,
  selectedSessionId,
  compiled,
  compileError,
  revision,
  nodeCount,
  edgeCount,
  onComplete,
  onSwap,
  onInsert,
}: Props) {
  const { isDark } = useTheme();
  const { transcriptFontSize } = useDisplayPreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const preparedRenderRef = useRef<{
    compiled: CompiledSessionDag;
    prepared: PreparedSessionDagSvg;
  } | null>(null);
  const markedNodeRef = useRef<SVGGElement | null>(null);
  const currentSelectionRef = useRef({ active, selectedSessionId });
  const edgeInteractionRef = useRef<EdgeInteraction | null>(null);
  const edgeControlRecordsRef = useRef<Map<string, EdgeControlRecord>>(new Map());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;
  const [renderStage, setRenderStage] = useState("idle");
  const [failure, setFailure] = useState<{ stage: PreviewFailureStage; errorClass: string } | null>(null);
  const currentKey = compiled
    ? buildMermaidRenderKey(isDark, transcriptFontSize, compiled.source)
    : "compile-failure";

  useEffect(() => {
    const clearPreparedRender = () => {
      markedNodeRef.current = updateSessionDagCurrentNode(
        markedNodeRef.current,
        false,
        null,
        null,
        null,
      );
      preparedRenderRef.current = null;
      edgeControlRecordsRef.current = new Map();
    };
    const container = containerRef.current;
    if (!container || !active) {
      clearPreparedRender();
      return;
    }
    clearPreparedRender();
    const renderRoot = container.shadowRoot ?? container.attachShadow({ mode: "open" });
    if (!compiled) {
      const error = compileError ?? new Error("Dependency graph compilation failed");
      edgeInteractionRef.current = null;
      renderRoot.replaceChildren();
      setFailure({ stage: "compile", errorClass: boundedErrorClass(error) });
      setRenderStage("failed");
      logPreviewFailure("compile", revision, nodeCount, edgeCount, error);
      return;
    }
    let cancelled = false;
    let failureStage: PreviewFailureStage = "load";
    let removeDocumentListeners = () => {};
    renderRoot.replaceChildren();
    setFailure(null);
    setRenderStage("loading-library");

    const render = async () => {
      const { default: mermaid } = await import("mermaid");
      if (cancelled) return;
      setRenderStage("queued");
      const rendered = await enqueueMermaidOperation(async () => {
        if (cancelled) return null;
        setRenderStage("configuring");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: isDark ? "dark" : "default",
          htmlLabels: false,
          ...mermaidDisplayConfig(transcriptFontSize),
        });
        failureStage = "parse";
        setRenderStage("parsing");
        const parsed = await mermaid.mermaidAPI.parse(compiled.source, { suppressErrors: true });
        if (!parsed) throw new Error("Invalid dependency graph");
        failureStage = "render";
        setRenderStage("rendering");
        const renderId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `session-dag-mermaid-${crypto.randomUUID()}`
          : `session-dag-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await mermaid.mermaidAPI.render(renderId, compiled.source);
        return { renderId, result };
      });
      if (!rendered || cancelled) return;

      const prepared = prepareSessionDagSvg(
        rendered.result.svg,
        compiled,
        container.ownerDocument,
        rendered.renderId,
      );
      if (cancelled) return;
      const trustedStyle = container.ownerDocument.createElement("style");
      trustedStyle.textContent = SESSION_DAG_SHADOW_STYLES;
      const stack = container.ownerDocument.createElement("div");
      stack.setAttribute("class", "session-dag-svg-stack");
      stack.style.setProperty("max-width", prepared.svg.style.maxWidth);
      const controlLayer = createSessionDagControlLayer(container.ownerDocument, prepared.svg);
      const insertOverlayLayer = container.ownerDocument.createElement("div");
      insertOverlayLayer.setAttribute("class", "session-dag-edge-insert-overlay-layer");
      stack.replaceChildren(prepared.svg, controlLayer, insertOverlayLayer);
      renderRoot.replaceChildren(trustedStyle, stack);

      try {
        const bindMutationActivation = (control: SVGGElement, operation: () => Promise<boolean>) => {
          let inFlight = false;
          const restoreAfterRejection = () => {
            if (!control.isConnected) return;
            inFlight = false;
            control.removeAttribute("aria-disabled");
            control.removeAttribute("data-session-dag-pending");
            control.setAttribute("tabindex", "0");
          };
          const activateControl = () => {
            if (inFlight) return;
            inFlight = true;
            control.setAttribute("aria-disabled", "true");
            control.setAttribute("data-session-dag-pending", "true");
            control.setAttribute("tabindex", "-1");
            try {
              void operation().then((accepted) => {
                if (!accepted) restoreAfterRejection();
              }, restoreAfterRejection);
            } catch {
              restoreAfterRejection();
            }
          };
          control.addEventListener("click", (event) => {
            event.stopPropagation();
            activateControl();
          });
          control.addEventListener("keydown", (event) => {
            if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
            event.preventDefault();
            event.stopPropagation();
            activateControl();
          });
        };

        const records = new Map<string, EdgeControlRecord>();
        const recordForInteraction = () => {
          const interaction = edgeInteractionRef.current;
          if (!interaction) return null;
          const record = edgeControlRecordsRef.current.get(interaction.edgeId);
          return record && interactionMatchesRecord(interaction, record) ? record : null;
        };
        const applyAllRecords = () => {
          for (const record of edgeControlRecordsRef.current.values()) record.apply();
        };
        const focusInteractionTarget = () => {
          const interaction = edgeInteractionRef.current;
          const record = recordForInteraction();
          if (!interaction || !record) return;
          const target = interaction.focusTarget === "dot"
            ? record.control.dot
            : interaction.focusTarget === "swap"
              ? record.control.swap
              : interaction.focusTarget === "insert"
                ? record.control.insert
                : interaction.focusTarget === "input"
                  ? record.input
                  : null;
          focusElement(target);
        };
        const closeInteraction = (restoreDotFocus: boolean) => {
          const interaction = edgeInteractionRef.current;
          const record = recordForInteraction();
          if (!interaction || interaction.pending) return;
          edgeInteractionRef.current = null;
          applyAllRecords();
          if (restoreDotFocus) focusElement(record?.control.dot ?? null);
        };
        const openActions = (record: EdgeControlRecord) => {
          const current = edgeInteractionRef.current;
          if (current?.pending) return;
          if (interactionMatchesRecord(current, record)) {
            closeInteraction(true);
            return;
          }
          edgeInteractionRef.current = {
            edgeId: record.edge.id,
            formId: record.edge.formId,
            fromSessionId: record.edge.fromSessionId,
            toSessionId: record.edge.toSessionId,
            mode: "actions",
            value: "",
            pending: false,
            focusTarget: "dot",
          };
          applyAllRecords();
          focusElement(record.control.dot);
        };
        const settleAcceptedEdgeMutation = (record: EdgeControlRecord) => {
          const interaction = edgeInteractionRef.current;
          if (!interactionMatchesRecord(interaction, record)) return;
          const currentRecord = recordForInteraction();
          edgeInteractionRef.current = null;
          applyAllRecords();
          focusElement(currentRecord?.control.dot ?? null);
        };
        const settleRejectedEdgeMutation = (edgeId: string, focusTarget: EdgeFocusTarget) => {
          const interaction = edgeInteractionRef.current;
          if (!interaction || interaction.edgeId !== edgeId) return;
          interaction.pending = false;
          interaction.focusTarget = focusTarget;
          applyAllRecords();
          focusInteractionTarget();
        };
        const runEdgeMutation = (
          record: EdgeControlRecord,
          focusTarget: Exclude<EdgeFocusTarget, null>,
          operation: () => Promise<boolean>,
        ) => {
          const interaction = edgeInteractionRef.current;
          if (!interactionMatchesRecord(interaction, record) || interaction.pending) return;
          interaction.pending = true;
          interaction.focusTarget = focusTarget;
          applyAllRecords();
          try {
            void operation().then((accepted) => {
              if (accepted) settleAcceptedEdgeMutation(record);
              else settleRejectedEdgeMutation(record.edge.id, focusTarget);
            }, () => settleRejectedEdgeMutation(record.edge.id, focusTarget));
          } catch {
            settleRejectedEdgeMutation(record.edge.id, focusTarget);
          }
        };
        const bindEdgeActivation = (control: SVGGElement, activateControl: () => void) => {
          control.addEventListener("click", (event) => {
            event.stopPropagation();
            if (control.getAttribute("aria-disabled") === "true") return;
            activateControl();
          });
          control.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeInteraction(true);
              return;
            }
            if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
            event.preventDefault();
            event.stopPropagation();
            if (control.getAttribute("aria-disabled") === "true") return;
            activateControl();
          });
        };

        for (const [alias, edge] of compiled.edgesByAlias) {
          const edgePath = prepared.edgePathsByAlias.get(alias);
          const fromLabel = compiled.labelsBySessionId.get(edge.fromSessionId);
          const toLabel = compiled.labelsBySessionId.get(edge.toSessionId);
          if (!edgePath || !fromLabel || !toLabel) {
            throw new SessionDagSvgError("controls", "An edge is missing from the rendered graph");
          }
          const selfEdge = edge.fromSessionId === edge.toSessionId;
          const control = createSessionDagEdgeActionControl(
            container.ownerDocument,
            fromLabel,
            toLabel,
            selfEdge,
          );
          const position = getSessionDagEdgeMidpoint(edgePath, prepared.svg);
          const overlayPosition = getSessionDagOverlayPosition(prepared.svg, position.x, position.y);
          control.root.setAttribute("transform", `translate(${String(position.x)} ${String(position.y)})`);

          const form = container.ownerDocument.createElement("form");
          form.setAttribute("class", "session-dag-edge-insert-form");
          form.setAttribute("aria-label", `Insert a session into dependency from ${fromLabel} to ${toLabel}`);
          form.style.setProperty("--session-dag-insert-left", `${String(overlayPosition.leftPercent)}%`);
          form.style.setProperty("--session-dag-insert-top", `${String(overlayPosition.topPercent)}%`);
          form.hidden = true;
          const label = container.ownerDocument.createElement("label");
          const labelText = container.ownerDocument.createElement("span");
          labelText.textContent = "Session ID";
          const input = container.ownerDocument.createElement("input");
          input.type = "text";
          input.maxLength = SESSION_DAG_MAX_SESSION_ID_LENGTH;
          input.autocomplete = "off";
          input.autocapitalize = "off";
          input.spellcheck = false;
          input.autofocus = true;
          input.setAttribute("aria-label", `Session ID to insert between ${fromLabel} and ${toLabel}`);
          label.append(labelText, input);
          const formActions = container.ownerDocument.createElement("div");
          formActions.setAttribute("class", "session-dag-edge-insert-actions");
          const cancel = container.ownerDocument.createElement("button");
          cancel.type = "button";
          cancel.textContent = "Cancel";
          const submit = container.ownerDocument.createElement("button");
          submit.type = "submit";
          submit.textContent = "Insert";
          formActions.append(cancel, submit);
          form.append(label, formActions);
          insertOverlayLayer.appendChild(form);

          const record: EdgeControlRecord = {
            edge,
            control,
            form,
            input,
            submit,
            cancel,
            apply: () => {
              const interaction = edgeInteractionRef.current;
              const ownsInteraction = interactionMatchesRecord(interaction, record);
              const mode: SessionDagEdgeActionMode = ownsInteraction ? interaction.mode : "collapsed";
              const pending = ownsInteraction && interaction.pending;
              updateSessionDagEdgeActionControl(control, mode, pending);
              control.dot.setAttribute(
                "aria-label",
                `${mode === "collapsed" ? "Show" : "Hide"} actions for dependency from ${fromLabel} to ${toLabel}`,
              );
              form.hidden = mode !== "insert";
              if (ownsInteraction && interaction.mode === "insert" && input.value !== interaction.value) {
                input.value = interaction.value;
              }
              form.setAttribute("aria-busy", String(pending));
              input.readOnly = pending;
              for (const button of [submit, cancel]) {
                if (pending) button.setAttribute("aria-disabled", "true");
                else button.removeAttribute("aria-disabled");
              }
            },
          };
          records.set(edge.id, record);
          controlLayer.appendChild(control.root);

          bindEdgeActivation(control.dot, () => openActions(record));
          if (!selfEdge) {
            bindEdgeActivation(control.swap, () => runEdgeMutation(
              record,
              "swap",
              () => onSwapRef.current(edge),
            ));
          }
          bindEdgeActivation(control.insert, () => {
            const interaction = edgeInteractionRef.current;
            if (!interactionMatchesRecord(interaction, record) || interaction.pending) return;
            interaction.mode = "insert";
            interaction.focusTarget = "input";
            applyAllRecords();
            queueMicrotask(focusInteractionTarget);
          });
          input.addEventListener("input", () => {
            const interaction = edgeInteractionRef.current;
            if (!interactionMatchesRecord(interaction, record) || interaction.pending) return;
            interaction.value = input.value;
          });
          input.addEventListener("focus", () => {
            const interaction = edgeInteractionRef.current;
            if (interactionMatchesRecord(interaction, record)) interaction.focusTarget = "input";
          });
          control.dot.addEventListener("focus", () => {
            const interaction = edgeInteractionRef.current;
            if (interactionMatchesRecord(interaction, record)) interaction.focusTarget = "dot";
          });
          control.swap.addEventListener("focus", () => {
            const interaction = edgeInteractionRef.current;
            if (interactionMatchesRecord(interaction, record)) interaction.focusTarget = "swap";
          });
          control.insert.addEventListener("focus", () => {
            const interaction = edgeInteractionRef.current;
            if (interactionMatchesRecord(interaction, record)) interaction.focusTarget = "insert";
          });
          cancel.addEventListener("click", (event) => {
            event.preventDefault();
            closeInteraction(true);
          });
          form.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeInteraction(true);
          });
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const interaction = edgeInteractionRef.current;
            if (!interactionMatchesRecord(interaction, record) || interaction.pending) return;
            interaction.value = input.value;
            runEdgeMutation(
              record,
              "input",
              () => onInsertRef.current(edge, interaction.value),
            );
          });
          record.apply();
        }
        edgeControlRecordsRef.current = records;

        const savedInteraction = edgeInteractionRef.current;
        if (savedInteraction) {
          const savedRecord = records.get(savedInteraction.edgeId);
          if (!savedRecord || !interactionMatchesRecord(savedInteraction, savedRecord)) {
            edgeInteractionRef.current = null;
          }
        }
        applyAllRecords();
        if (edgeInteractionRef.current?.focusTarget) queueMicrotask(focusInteractionTarget);

        const onDocumentClick = (event: Event) => {
          const interaction = edgeInteractionRef.current;
          const activeRecord = recordForInteraction();
          if (!interaction || !activeRecord || interaction.pending) return;
          const path = event.composedPath();
          if (path.includes(activeRecord.form)
            || [...edgeControlRecordsRef.current.values()].some((record) => path.includes(record.control.root))) {
            return;
          }
          closeInteraction(true);
        };
        const onDocumentFocusIn = (event: FocusEvent) => {
          const interaction = edgeInteractionRef.current;
          const activeRecord = recordForInteraction();
          if (!interaction || !activeRecord) return;
          const path = event.composedPath();
          if (!path.includes(activeRecord.form) && !path.includes(activeRecord.control.root)) {
            interaction.focusTarget = null;
          }
        };
        container.ownerDocument.addEventListener("click", onDocumentClick, true);
        container.ownerDocument.addEventListener("focusin", onDocumentFocusIn, true);
        removeDocumentListeners = () => {
          container.ownerDocument.removeEventListener("click", onDocumentClick, true);
          container.ownerDocument.removeEventListener("focusin", onDocumentFocusIn, true);
        };

        for (const sessionId of compiled.eligibleSessionIds) {
          const alias = compiled.aliasesBySessionId.get(sessionId);
          const label = compiled.labelsBySessionId.get(sessionId);
          const nodeGroup = alias ? prepared.nodeGroupsByAlias.get(alias) : undefined;
          if (!alias || !label || !nodeGroup) {
            throw new SessionDagSvgError("controls", "An eligible node is missing from the rendered graph");
          }
          const bounds = nodeGroup.getBBox();
          if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
            || bounds.width < 22 || bounds.height < 22) {
            throw new SessionDagSvgError("controls", "An eligible node has invalid geometry");
          }
          const control = createSessionDagCompleteControl(container.ownerDocument, label);
          const position = getSessionDagControlPosition(
            nodeGroup,
            prepared.svg,
            bounds.x + bounds.width - 11,
            bounds.y + 11,
          );
          control.setAttribute("transform", `translate(${String(position.x)} ${String(position.y)})`);
          bindMutationActivation(control, () => onCompleteRef.current(sessionId));
          controlLayer.appendChild(control);
        }
      } catch (error) {
        failureStage = error instanceof SessionDagSvgError ? error.stage : "controls";
        throw error;
      }
      preparedRenderRef.current = { compiled, prepared };
      const currentSelection = currentSelectionRef.current;
      markedNodeRef.current = updateSessionDagCurrentNode(
        markedNodeRef.current,
        currentSelection.active,
        currentSelection.selectedSessionId,
        compiled,
        prepared,
      );
      setRenderStage("complete");
    };

    render().catch((error: unknown) => {
      if (cancelled) return;
      removeDocumentListeners();
      const stage = error instanceof SessionDagSvgError ? error.stage : failureStage;
      clearPreparedRender();
      renderRoot.replaceChildren();
      setFailure({ stage, errorClass: boundedErrorClass(error) });
      setRenderStage("failed");
      logPreviewFailure(
        stage,
        revision,
        nodeCount,
        edgeCount,
        error,
      );
    });

    return () => {
      cancelled = true;
      removeDocumentListeners();
      clearPreparedRender();
    };
  }, [
    active,
    compiled,
    compileError,
    currentKey,
    edgeCount,
    isDark,
    nodeCount,
    revision,
    transcriptFontSize,
  ]);

  useLayoutEffect(() => {
    currentSelectionRef.current = { active, selectedSessionId };
    const rendered = preparedRenderRef.current;
    markedNodeRef.current = updateSessionDagCurrentNode(
      markedNodeRef.current,
      active,
      selectedSessionId,
      rendered?.compiled ?? null,
      rendered?.prepared ?? null,
    );
    return () => {
      markedNodeRef.current = updateSessionDagCurrentNode(
        markedNodeRef.current,
        false,
        null,
        null,
        null,
      );
    };
  }, [active, selectedSessionId]);

  return (
    <div className="session-dag-preview">
      <div
        ref={containerRef}
        className="session-dag-preview-svg"
        aria-hidden={failure ? "true" : undefined}
      />
      {failure ? (
        <div
          className="session-dag-preview-error"
          role="status"
          data-session-dag-error-stage={failure.stage}
          data-session-dag-error-class={failure.errorClass}
        >
          Dependency graph preview could not be rendered. Raw remains available.
        </div>
      ) : renderStage !== "complete" ? (
        <div
          className="session-dag-preview-loading"
          aria-label="Rendering dependency graph"
          data-session-dag-render-stage={renderStage}
        />
      ) : null}
    </div>
  );
}
