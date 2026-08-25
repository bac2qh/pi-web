"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDisplayPreferences } from "@/hooks/useDisplayPreferences";
import { useTheme } from "@/hooks/useTheme";
import {
  buildMermaidRenderKey,
  enqueueMermaidOperation,
  mermaidDisplayConfig,
} from "@/lib/mermaid-display";
import type { CompiledSessionDag, SessionDagEdge } from "@/lib/session-dag";
import {
  SESSION_DAG_SHADOW_STYLES,
  SessionDagSvgError,
  createSessionDagCompleteControl,
  createSessionDagControlLayer,
  createSessionDagSwapControl,
  getSessionDagControlPosition,
  getSessionDagEdgeMidpoint,
  prepareSessionDagSvg,
  updateSessionDagCurrentNode,
  type PreparedSessionDagSvg,
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
}

type PreviewFailureStage = "compile" | "load" | "parse" | "render" | SessionDagSvgFailureStage;

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
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;
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
      renderRoot.replaceChildren();
      setFailure({ stage: "compile", errorClass: boundedErrorClass(error) });
      setRenderStage("failed");
      logPreviewFailure("compile", revision, nodeCount, edgeCount, error);
      return;
    }
    let cancelled = false;
    let failureStage: PreviewFailureStage = "load";
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
      stack.replaceChildren(prepared.svg, controlLayer);
      renderRoot.replaceChildren(trustedStyle, stack);

      try {
        const bindActivation = (control: SVGGElement, operation: () => Promise<boolean>) => {
          let inFlight = false;
          const restoreAfterRejection = () => {
            if (!control.isConnected) return;
            inFlight = false;
            control.removeAttribute("aria-disabled");
            control.removeAttribute("data-session-dag-pending");
            control.setAttribute("tabindex", "0");
          };
          const activate = () => {
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
            activate();
          });
          control.addEventListener("keydown", (event) => {
            if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
            event.preventDefault();
            event.stopPropagation();
            activate();
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
          const control = createSessionDagSwapControl(
            container.ownerDocument,
            fromLabel,
            toLabel,
            selfEdge,
          );
          const position = getSessionDagEdgeMidpoint(edgePath, prepared.svg);
          control.setAttribute("transform", `translate(${String(position.x)} ${String(position.y)})`);
          if (!selfEdge) bindActivation(control, () => onSwapRef.current(edge));
          controlLayer.appendChild(control);
        }

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
          bindActivation(control, () => onCompleteRef.current(sessionId));
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
