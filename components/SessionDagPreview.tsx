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
  type SessionDagDirection,
  type SessionDagEdge,
} from "@/lib/session-dag";
import {
  SESSION_DAG_SHADOW_STYLES,
  SessionDagSvgError,
  createSessionDagCompleteControl,
  createSessionDagControlLayer,
  createSessionDagEdgeActionControl,
  createSessionDagGoToControl,
  createSessionDagNodeAddControl,
  getSessionDagControlPosition,
  getSessionDagEdgeMidpoint,
  getSessionDagGoToControlLocalPosition,
  getSessionDagOverlayPosition,
  prepareSessionDagSvg,
  shouldDeferSessionDagNodeFocusRestore,
  updateSessionDagCurrentNode,
  updateSessionDagEdgeActionControl,
  validateSessionDagNodeControlGeometry,
  type PreparedSessionDagSvg,
  type SessionDagEdgeActionControl,
  type SessionDagEdgeActionMode,
  type SessionDagSvgFailureStage,
} from "@/lib/session-dag-svg";

interface Props {
  active: boolean;
  selectedSessionId: string | null;
  availableSessionIds: ReadonlySet<string>;
  compiled: CompiledSessionDag | null;
  compileError: unknown;
  revision: number;
  nodeCount: number;
  edgeCount: number;
  nodeFormAssignments: ReadonlyMap<string, string>;
  direction: SessionDagDirection;
  onComplete: (sessionId: string) => Promise<boolean>;
  onSwap: (edge: SessionDagEdge) => Promise<boolean>;
  onInsert: (edge: SessionDagEdge, insertedSessionId: string) => Promise<boolean>;
  onAddNodeEdge: (
    anchorSessionId: string,
    enteredSessionId: string,
    direction: NodeEdgeDirection,
  ) => Promise<NodeEdgeMutationResult>;
  onGoToSession: (sessionId: string) => void;
}

type PreviewFailureStage = "compile" | "load" | "parse" | "render" | SessionDagSvgFailureStage;
type EdgeFocusTarget = "dot" | "swap" | "insert" | "input" | null;
type NodeFocusTarget = "add" | "input" | "incoming" | "outgoing" | null;
type NodeEdgeDirection = "incoming" | "outgoing";

interface NodeEdgeMutationResult {
  accepted: boolean;
  authorityAdopted: boolean;
}

interface EdgeInteraction {
  kind: "edge";
  edgeId: string;
  formId: string;
  fromSessionId: string;
  toSessionId: string;
  mode: Exclude<SessionDagEdgeActionMode, "collapsed">;
  value: string;
  pending: boolean;
  focusTarget: EdgeFocusTarget;
}

interface NodeInteraction {
  kind: "node";
  anchorSessionId: string;
  formId: string;
  value: string;
  pending: boolean;
  direction: NodeEdgeDirection | null;
  focusTarget: NodeFocusTarget;
}

type PreviewInteraction = EdgeInteraction | NodeInteraction;

interface EdgeControlRecord {
  edge: SessionDagEdge;
  control: SessionDagEdgeActionControl;
  form: HTMLFormElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
  apply: () => void;
}

interface NodeControlRecord {
  anchorSessionId: string;
  formId: string;
  control: SVGGElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  incoming: HTMLButtonElement;
  outgoing: HTMLButtonElement;
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

function interactionMatchesEdgeRecord(
  interaction: PreviewInteraction | null,
  record: EdgeControlRecord,
): interaction is EdgeInteraction {
  return interaction?.kind === "edge"
    && interaction.edgeId === record.edge.id
    && interaction.formId === record.edge.formId
    && interaction.fromSessionId === record.edge.fromSessionId
    && interaction.toSessionId === record.edge.toSessionId;
}

function interactionMatchesNodeRecord(
  interaction: PreviewInteraction | null,
  record: NodeControlRecord,
): interaction is NodeInteraction {
  return interaction?.kind === "node"
    && interaction.anchorSessionId === record.anchorSessionId
    && interaction.formId === record.formId;
}

function focusElement(element: Element | null): void {
  if (!element?.isConnected || !("focus" in element)) return;
  (element as Element & { focus(options?: FocusOptions): void }).focus({ preventScroll: true });
}

export function SessionDagPreview({
  active,
  selectedSessionId,
  availableSessionIds,
  compiled,
  compileError,
  revision,
  nodeCount,
  edgeCount,
  nodeFormAssignments,
  direction,
  onComplete,
  onSwap,
  onInsert,
  onAddNodeEdge,
  onGoToSession,
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
  const interactionRef = useRef<PreviewInteraction | null>(null);
  const edgeControlRecordsRef = useRef<Map<string, EdgeControlRecord>>(new Map());
  const nodeControlRecordsRef = useRef<Map<string, NodeControlRecord>>(new Map());
  const goToControlsRef = useRef<Map<string, SVGGElement>>(new Map());
  const nodeFocusRestoreRef = useRef<{ anchorSessionId: string; formId: string } | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;
  const onAddNodeEdgeRef = useRef(onAddNodeEdge);
  onAddNodeEdgeRef.current = onAddNodeEdge;
  const onGoToSessionRef = useRef(onGoToSession);
  onGoToSessionRef.current = onGoToSession;
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
      nodeControlRecordsRef.current = new Map();
      goToControlsRef.current = new Map();
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
      interactionRef.current = null;
      nodeFocusRestoreRef.current = null;
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

        const edgeRecords = new Map<string, EdgeControlRecord>();
        const nodeRecords = new Map<string, NodeControlRecord>();
        const goToControls = new Map<string, SVGGElement>();
        const edgeRecordForInteraction = () => {
          const interaction = interactionRef.current;
          if (interaction?.kind !== "edge") return null;
          const record = edgeControlRecordsRef.current.get(interaction.edgeId);
          return record && interactionMatchesEdgeRecord(interaction, record) ? record : null;
        };
        const nodeRecordForInteraction = () => {
          const interaction = interactionRef.current;
          if (interaction?.kind !== "node") return null;
          const record = nodeControlRecordsRef.current.get(interaction.anchorSessionId);
          return record && interactionMatchesNodeRecord(interaction, record) ? record : null;
        };
        const applyAllRecords = () => {
          for (const record of edgeControlRecordsRef.current.values()) record.apply();
          for (const record of nodeControlRecordsRef.current.values()) record.apply();
        };
        const focusInteractionTarget = () => {
          const interaction = interactionRef.current;
          if (interaction?.kind === "edge") {
            const record = edgeRecordForInteraction();
            if (!record) return;
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
            return;
          }
          if (interaction?.kind === "node") {
            const record = nodeRecordForInteraction();
            if (!record) return;
            const target = interaction.focusTarget === "add"
              ? record.control
              : interaction.focusTarget === "input"
                ? record.input
                : interaction.focusTarget === "incoming"
                  ? record.incoming
                  : interaction.focusTarget === "outgoing"
                    ? record.outgoing
                    : null;
            focusElement(target);
          }
        };
        const closeInteraction = (restoreControlFocus: boolean) => {
          const interaction = interactionRef.current;
          const edgeRecord = edgeRecordForInteraction();
          const nodeRecord = nodeRecordForInteraction();
          if (!interaction || interaction.pending) return;
          interactionRef.current = null;
          applyAllRecords();
          if (restoreControlFocus) {
            focusElement(edgeRecord?.control.dot ?? nodeRecord?.control ?? null);
          }
        };
        const openEdgeActions = (record: EdgeControlRecord) => {
          const current = interactionRef.current;
          if (current?.pending) return;
          if (interactionMatchesEdgeRecord(current, record)) {
            closeInteraction(true);
            return;
          }
          interactionRef.current = {
            kind: "edge",
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
        const openNodeForm = (record: NodeControlRecord) => {
          const current = interactionRef.current;
          if (current?.pending) return;
          if (interactionMatchesNodeRecord(current, record)) {
            closeInteraction(true);
            return;
          }
          interactionRef.current = {
            kind: "node",
            anchorSessionId: record.anchorSessionId,
            formId: record.formId,
            value: "",
            pending: false,
            direction: null,
            focusTarget: "input",
          };
          applyAllRecords();
          queueMicrotask(focusInteractionTarget);
        };
        const settleAcceptedEdgeMutation = (record: EdgeControlRecord) => {
          const interaction = interactionRef.current;
          if (!interactionMatchesEdgeRecord(interaction, record)) return;
          const currentRecord = edgeRecordForInteraction();
          interactionRef.current = null;
          applyAllRecords();
          focusElement(currentRecord?.control.dot ?? null);
        };
        const settleRejectedEdgeMutation = (
          edgeId: string,
          focusTarget: Exclude<EdgeFocusTarget, null>,
        ) => {
          const interaction = interactionRef.current;
          if (interaction?.kind !== "edge" || interaction.edgeId !== edgeId) return;
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
          const interaction = interactionRef.current;
          if (!interactionMatchesEdgeRecord(interaction, record) || interaction.pending) return;
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
        const settleAcceptedNodeMutation = (
          record: NodeControlRecord,
          authorityAdopted: boolean,
        ) => {
          const interaction = interactionRef.current;
          if (!interactionMatchesNodeRecord(interaction, record)) return;
          const currentRecord = nodeRecordForInteraction();
          const deferFocusRestore = shouldDeferSessionDagNodeFocusRestore(
            currentSelectionRef.current.active,
            authorityAdopted,
            currentRecord !== null,
            currentRecord === record,
          );
          nodeFocusRestoreRef.current = deferFocusRestore ? {
            anchorSessionId: record.anchorSessionId,
            formId: record.formId,
          } : null;
          interactionRef.current = null;
          applyAllRecords();
          focusElement(currentRecord?.control ?? null);
        };
        const settleRejectedNodeMutation = (
          anchorSessionId: string,
          formId: string,
          direction: NodeEdgeDirection,
        ) => {
          const interaction = interactionRef.current;
          if (interaction?.kind !== "node"
            || interaction.anchorSessionId !== anchorSessionId
            || interaction.formId !== formId) return;
          interaction.pending = false;
          interaction.direction = direction;
          interaction.focusTarget = direction;
          applyAllRecords();
          focusInteractionTarget();
        };
        const runNodeMutation = (record: NodeControlRecord, direction: NodeEdgeDirection) => {
          const interaction = interactionRef.current;
          if (!interactionMatchesNodeRecord(interaction, record) || interaction.pending) return;
          interaction.value = record.input.value;
          interaction.pending = true;
          interaction.direction = direction;
          interaction.focusTarget = direction;
          applyAllRecords();
          try {
            void onAddNodeEdgeRef.current(
              record.anchorSessionId,
              interaction.value,
              direction,
            ).then((result) => {
              if (result.accepted) {
                settleAcceptedNodeMutation(record, result.authorityAdopted);
              } else {
                settleRejectedNodeMutation(record.anchorSessionId, record.formId, direction);
              }
            }, () => settleRejectedNodeMutation(record.anchorSessionId, record.formId, direction));
          } catch {
            settleRejectedNodeMutation(record.anchorSessionId, record.formId, direction);
          }
        };
        const bindGoToActivation = (control: SVGGElement, activateControl: () => void) => {
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
        const bindAuthoringActivation = (control: SVGGElement, activateControl: () => void) => {
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
            direction,
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
              const interaction = interactionRef.current;
              const ownsInteraction = interactionMatchesEdgeRecord(interaction, record);
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
          edgeRecords.set(edge.id, record);
          controlLayer.appendChild(control.root);

          bindAuthoringActivation(control.dot, () => openEdgeActions(record));
          if (!selfEdge) {
            bindAuthoringActivation(control.swap, () => runEdgeMutation(
              record,
              "swap",
              () => onSwapRef.current(edge),
            ));
          }
          bindAuthoringActivation(control.insert, () => {
            const interaction = interactionRef.current;
            if (!interactionMatchesEdgeRecord(interaction, record) || interaction.pending) return;
            interaction.mode = "insert";
            interaction.focusTarget = "input";
            applyAllRecords();
            queueMicrotask(focusInteractionTarget);
          });
          input.addEventListener("input", () => {
            const interaction = interactionRef.current;
            if (!interactionMatchesEdgeRecord(interaction, record) || interaction.pending) return;
            interaction.value = input.value;
          });
          input.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesEdgeRecord(interaction, record)) interaction.focusTarget = "input";
          });
          control.dot.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesEdgeRecord(interaction, record)) interaction.focusTarget = "dot";
          });
          control.swap.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesEdgeRecord(interaction, record)) interaction.focusTarget = "swap";
          });
          control.insert.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesEdgeRecord(interaction, record)) interaction.focusTarget = "insert";
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
            const interaction = interactionRef.current;
            if (!interactionMatchesEdgeRecord(interaction, record) || interaction.pending) return;
            interaction.value = input.value;
            runEdgeMutation(
              record,
              "input",
              () => onInsertRef.current(edge, interaction.value),
            );
          });
          record.apply();
        }
        for (const anchorSessionId of compiled.activeSessionIds) {
          const alias = compiled.aliasesBySessionId.get(anchorSessionId);
          const label = compiled.labelsBySessionId.get(anchorSessionId);
          const nodeGroup = alias ? prepared.nodeGroupsByAlias.get(alias) : undefined;
          const formId = nodeFormAssignments.get(anchorSessionId);
          const eligible = compiled.eligibleSessionIds.has(anchorSessionId);
          const available = availableSessionIds.has(anchorSessionId);
          if (!alias || !label || !nodeGroup || !formId) {
            throw new SessionDagSvgError("controls", "An active node is missing from the rendered graph");
          }
          const bounds = nodeGroup.getBBox();
          const minimumWidth = eligible ? 44 : 22;
          if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
            || bounds.width < minimumWidth || bounds.height < 22) {
            throw new SessionDagSvgError("controls", "An active node has invalid geometry");
          }
          validateSessionDagNodeControlGeometry(bounds, direction, eligible, available);
          const controlPosition = getSessionDagControlPosition(
            nodeGroup,
            prepared.svg,
            bounds.x + 11,
            bounds.y + 11,
          );
          const overlayPosition = getSessionDagOverlayPosition(
            prepared.svg,
            controlPosition.x,
            controlPosition.y,
          );
          const control = createSessionDagNodeAddControl(container.ownerDocument, label);
          control.setAttribute(
            "transform",
            `translate(${String(controlPosition.x)} ${String(controlPosition.y)})`,
          );

          const form = container.ownerDocument.createElement("form");
          form.setAttribute("class", "session-dag-node-add-form");
          form.setAttribute("aria-label", `Add dependency connected to ${label}`);
          form.style.setProperty("--session-dag-node-add-left", `${String(overlayPosition.leftPercent)}%`);
          form.style.setProperty("--session-dag-node-add-top", `${String(overlayPosition.topPercent)}%`);
          form.hidden = true;
          const inputLabel = container.ownerDocument.createElement("label");
          const inputLabelText = container.ownerDocument.createElement("span");
          inputLabelText.textContent = "Session ID";
          const input = container.ownerDocument.createElement("input");
          input.type = "text";
          input.maxLength = SESSION_DAG_MAX_SESSION_ID_LENGTH;
          input.autocomplete = "off";
          input.autocapitalize = "off";
          input.spellcheck = false;
          input.autofocus = true;
          input.setAttribute("aria-label", `Session ID to connect with ${label}`);
          inputLabel.append(inputLabelText, input);
          const formActions = container.ownerDocument.createElement("div");
          formActions.setAttribute("class", "session-dag-node-add-actions");
          const incoming = container.ownerDocument.createElement("button");
          incoming.type = "submit";
          incoming.textContent = "Incoming: ID → this node";
          incoming.setAttribute("aria-label", `Incoming dependency from entered session ID to ${label}`);
          const outgoing = container.ownerDocument.createElement("button");
          outgoing.type = "submit";
          outgoing.textContent = "Outgoing: this node → ID";
          outgoing.setAttribute("aria-label", `Outgoing dependency from ${label} to entered session ID`);
          formActions.append(incoming, outgoing);
          const cancel = container.ownerDocument.createElement("button");
          cancel.type = "button";
          cancel.setAttribute("class", "session-dag-node-add-cancel");
          cancel.textContent = "Cancel";
          form.append(inputLabel, formActions, cancel);
          insertOverlayLayer.appendChild(form);

          const record: NodeControlRecord = {
            anchorSessionId,
            formId,
            control,
            form,
            input,
            incoming,
            outgoing,
            cancel,
            apply: () => {
              const interaction = interactionRef.current;
              const ownsInteraction = interactionMatchesNodeRecord(interaction, record);
              const pending = ownsInteraction && interaction.pending;
              control.setAttribute("aria-expanded", String(ownsInteraction));
              control.setAttribute(
                "aria-label",
                `${ownsInteraction ? "Close" : "Add"} dependency connected to ${label}`,
              );
              if (pending) {
                control.setAttribute("aria-disabled", "true");
                control.setAttribute("data-session-dag-pending", "true");
                control.setAttribute("tabindex", "-1");
              } else {
                control.removeAttribute("aria-disabled");
                control.removeAttribute("data-session-dag-pending");
                control.setAttribute("tabindex", "0");
              }
              form.hidden = !ownsInteraction;
              if (ownsInteraction && input.value !== interaction.value) {
                input.value = interaction.value;
              }
              form.setAttribute("aria-busy", String(pending));
              input.readOnly = pending;
              for (const button of [incoming, outgoing, cancel]) {
                if (pending) button.setAttribute("aria-disabled", "true");
                else button.removeAttribute("aria-disabled");
              }
            },
          };
          nodeRecords.set(anchorSessionId, record);
          controlLayer.appendChild(control);

          bindAuthoringActivation(control, () => openNodeForm(record));
          input.addEventListener("input", () => {
            const interaction = interactionRef.current;
            if (!interactionMatchesNodeRecord(interaction, record) || interaction.pending) return;
            interaction.value = input.value;
          });
          input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
          });
          input.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesNodeRecord(interaction, record)) interaction.focusTarget = "input";
          });
          control.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesNodeRecord(interaction, record)) interaction.focusTarget = "add";
          });
          incoming.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesNodeRecord(interaction, record)) interaction.focusTarget = "incoming";
          });
          outgoing.addEventListener("focus", () => {
            const interaction = interactionRef.current;
            if (interactionMatchesNodeRecord(interaction, record)) interaction.focusTarget = "outgoing";
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
            const submitter = (event as SubmitEvent).submitter;
            const direction = submitter === incoming
              ? "incoming"
              : submitter === outgoing
                ? "outgoing"
                : null;
            if (direction) runNodeMutation(record, direction);
          });
          record.apply();

          if (available) {
            const goToControl = createSessionDagGoToControl(container.ownerDocument, label);
            const goToLocalPosition = getSessionDagGoToControlLocalPosition(bounds, direction);
            const goToPosition = getSessionDagControlPosition(
              nodeGroup,
              prepared.svg,
              goToLocalPosition.x,
              goToLocalPosition.y,
            );
            goToControl.setAttribute(
              "transform",
              `translate(${String(goToPosition.x)} ${String(goToPosition.y)})`,
            );
            bindGoToActivation(goToControl, () => onGoToSessionRef.current(anchorSessionId));
            goToControls.set(anchorSessionId, goToControl);
            controlLayer.appendChild(goToControl);
          }

          if (eligible) {
            const completeControl = createSessionDagCompleteControl(container.ownerDocument, label);
            const completePosition = getSessionDagControlPosition(
              nodeGroup,
              prepared.svg,
              bounds.x + bounds.width - 11,
              bounds.y + 11,
            );
            completeControl.setAttribute(
              "transform",
              `translate(${String(completePosition.x)} ${String(completePosition.y)})`,
            );
            bindMutationActivation(completeControl, () => onCompleteRef.current(anchorSessionId));
            controlLayer.appendChild(completeControl);
          }
        }

        edgeControlRecordsRef.current = edgeRecords;
        nodeControlRecordsRef.current = nodeRecords;
        goToControlsRef.current = goToControls;

        const savedInteraction = interactionRef.current;
        if (savedInteraction?.kind === "edge") {
          const savedRecord = edgeRecords.get(savedInteraction.edgeId);
          if (!savedRecord || !interactionMatchesEdgeRecord(savedInteraction, savedRecord)) {
            interactionRef.current = null;
          }
        } else if (savedInteraction?.kind === "node") {
          const savedRecord = nodeRecords.get(savedInteraction.anchorSessionId);
          if (!savedRecord || !interactionMatchesNodeRecord(savedInteraction, savedRecord)) {
            interactionRef.current = null;
          }
        }
        applyAllRecords();
        if (interactionRef.current?.focusTarget) queueMicrotask(focusInteractionTarget);

        const focusRestore = nodeFocusRestoreRef.current;
        if (focusRestore && !interactionRef.current) {
          nodeFocusRestoreRef.current = null;
          const record = nodeRecords.get(focusRestore.anchorSessionId);
          if (record?.formId === focusRestore.formId) {
            queueMicrotask(() => focusElement(record.control));
          }
        }

        const onDocumentClick = (event: Event) => {
          const interaction = interactionRef.current;
          const activeEdgeRecord = edgeRecordForInteraction();
          const activeNodeRecord = nodeRecordForInteraction();
          const activeForm = activeEdgeRecord?.form ?? activeNodeRecord?.form;
          if (!interaction || !activeForm || interaction.pending) return;
          const path = event.composedPath();
          if (path.includes(activeForm)
            || [...edgeControlRecordsRef.current.values()].some((record) => path.includes(record.control.root))
            || [...nodeControlRecordsRef.current.values()].some((record) => path.includes(record.control))
            || [...goToControlsRef.current.values()].some((control) => path.includes(control))) {
            return;
          }
          closeInteraction(true);
        };
        const onDocumentFocusIn = (event: FocusEvent) => {
          const interaction = interactionRef.current;
          const activeEdgeRecord = edgeRecordForInteraction();
          const activeNodeRecord = nodeRecordForInteraction();
          const activeForm = activeEdgeRecord?.form ?? activeNodeRecord?.form;
          const activeControl = activeEdgeRecord?.control.root ?? activeNodeRecord?.control;
          if (!interaction || !activeForm || !activeControl) return;
          const path = event.composedPath();
          if (!path.includes(activeForm) && !path.includes(activeControl)) {
            interaction.focusTarget = null;
          }
        };
        container.ownerDocument.addEventListener("click", onDocumentClick, true);
        container.ownerDocument.addEventListener("focusin", onDocumentFocusIn, true);
        removeDocumentListeners = () => {
          container.ownerDocument.removeEventListener("click", onDocumentClick, true);
          container.ownerDocument.removeEventListener("focusin", onDocumentFocusIn, true);
        };
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
    availableSessionIds,
    compiled,
    compileError,
    currentKey,
    edgeCount,
    isDark,
    nodeCount,
    nodeFormAssignments,
    direction,
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
