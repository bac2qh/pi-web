"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { scaledMenuFontSize } from "@/lib/display-preferences";

export const MAX_EXTENSION_WIDGET_LINES = 10;
export const EXTENSION_WIDGET_TRUNCATION_MARKER = "... (widget truncated)";

export type ExtensionWidgetPresentationItem = Readonly<{
  key: string;
  lines: readonly string[];
  placement?: "aboveEditor" | "belowEditor";
}>;

export function getExtensionWidgetDisplayLines(lines: readonly string[]): string[] {
  if (lines.length <= MAX_EXTENSION_WIDGET_LINES) return [...lines];
  return [
    ...lines.slice(0, MAX_EXTENSION_WIDGET_LINES),
    EXTENSION_WIDGET_TRUNCATION_MARKER,
  ];
}

export function partitionExtensionWidgets(widgets: readonly ExtensionWidgetPresentationItem[]): Readonly<{
  aboveEditor: ExtensionWidgetPresentationItem[];
  belowEditor: ExtensionWidgetPresentationItem[];
}> {
  return {
    aboveEditor: widgets.filter((widget) => widget.placement !== "belowEditor"),
    belowEditor: widgets.filter((widget) => widget.placement === "belowEditor"),
  };
}

export function useExtensionWidgetDisclosureState(
  widgets: readonly ExtensionWidgetPresentationItem[],
  defaultExpanded: boolean,
): Readonly<{
  isExpanded: (widgetKey: string) => boolean;
  toggleWidget: (widgetKey: string) => void;
}> {
  const [expansionOverrides, setExpansionOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );

  useEffect(() => {
    const currentKeys = new Set(widgets.map((widget) => widget.key));
    setExpansionOverrides((current) => {
      if ([...current.keys()].every((key) => currentKeys.has(key))) return current;
      return new Map([...current].filter(([key]) => currentKeys.has(key)));
    });
  }, [widgets]);

  const isExpanded = useCallback(
    (widgetKey: string) => expansionOverrides.get(widgetKey) ?? defaultExpanded,
    [defaultExpanded, expansionOverrides],
  );

  const toggleWidget = useCallback((widgetKey: string) => {
    setExpansionOverrides((current) => {
      const expanded = current.get(widgetKey) ?? defaultExpanded;
      const next = new Map(current);
      next.set(widgetKey, !expanded);
      return next;
    });
  }, [defaultExpanded]);

  return { isExpanded, toggleWidget };
}

export function EditorAdjacentExtensionWidgets({
  aboveEditor,
  editor,
  belowEditor,
}: {
  aboveEditor: ReactNode;
  editor: ReactNode;
  belowEditor: ReactNode;
}) {
  return (
    <div
      className="relative"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        maxHeight: "min(100dvh, 720px)",
        overflow: "visible",
      }}
    >
      {aboveEditor}
      <div style={{ flex: "0 0 auto" }}>{editor}</div>
      {belowEditor}
    </div>
  );
}

function ExtensionWidgetCard({
  widget,
  expanded,
  onToggle,
}: {
  widget: ExtensionWidgetPresentationItem;
  expanded: boolean;
  onToggle: (widgetKey: string) => void;
}) {
  const generatedId = useId();
  const bodyId = `extension-widget-body-${generatedId}`;
  const actionLabel = `${expanded ? "Collapse" : "Expand"} widget "${widget.key}"`;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 7,
        background: "var(--bg-panel)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        className="extension-widget-disclosure"
        aria-label={actionLabel}
        aria-expanded={expanded}
        aria-controls={bodyId}
        title={actionLabel}
        onClick={() => onToggle(widget.key)}
        style={{
          borderBottom: expanded ? "1px solid var(--border)" : "none",
          color: "var(--text-dim)",
          fontSize: scaledMenuFontSize(11),
          fontFamily: "var(--font-mono)",
        }}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {widget.key}
        </span>
      </button>
      <pre
        id={bodyId}
        hidden={!expanded}
        style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: "var(--pi-transcript-font-size, 16px)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}
      >
        {getExtensionWidgetDisplayLines(widget.lines).join("\n")}
      </pre>
    </div>
  );
}

export function ExtensionWidgets({
  widgets,
  isExpanded,
  onToggle,
}: {
  widgets: readonly ExtensionWidgetPresentationItem[];
  isExpanded: (widgetKey: string) => boolean;
  onToggle: (widgetKey: string) => void;
}) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <ExtensionWidgetCard
          key={widget.key}
          widget={widget}
          expanded={isExpanded(widget.key)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
