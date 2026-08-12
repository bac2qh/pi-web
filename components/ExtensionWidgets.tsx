"use client";

import type { ReactNode } from "react";
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

export function ExtensionWidgets({ widgets }: { widgets: readonly ExtensionWidgetPresentationItem[] }) {
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => (
        <div
          key={widget.key}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: scaledMenuFontSize(11), fontFamily: "var(--font-mono)" }}>
            {widget.key}
          </div>
          <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: "var(--pi-transcript-font-size, 16px)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {getExtensionWidgetDisplayLines(widget.lines).join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}
