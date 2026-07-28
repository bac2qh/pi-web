import { TRANSCRIPT_FONT_SPEC, normalizeNumericPreference } from "./display-preferences";

export type MermaidView = "preview" | "source";

export const DEFAULT_MERMAID_VIEW: MermaidView = "preview";

export function buildMermaidViewStateKey(
  textBlockIdentity: string | undefined,
  position: { offset?: number; line?: number; column?: number } | undefined,
): string | undefined {
  if (!textBlockIdentity || !position) return undefined;
  if (typeof position.offset === "number" && Number.isInteger(position.offset) && position.offset >= 0) {
    return `${textBlockIdentity}:mermaid-offset:${position.offset}`;
  }
  if (
    typeof position.line === "number"
    && Number.isInteger(position.line)
    && position.line > 0
    && typeof position.column === "number"
    && Number.isInteger(position.column)
    && position.column > 0
  ) {
    return `${textBlockIdentity}:mermaid-position:${position.line}:${position.column}`;
  }
  return undefined;
}

export function getMermaidModeState(
  selectedView: MermaidView = DEFAULT_MERMAID_VIEW,
  isStreaming = false,
): {
  effectiveView: MermaidView;
  action: {
    destination: MermaidView;
    label: "Preview" | "Source";
    title: string;
    disabled: boolean;
  };
} {
  const effectiveView: MermaidView = isStreaming ? "source" : selectedView;
  const destination: MermaidView = effectiveView === "preview" ? "source" : "preview";

  return {
    effectiveView,
    action: {
      destination,
      label: destination === "preview" ? "Preview" : "Source",
      title: isStreaming
        ? "Preview available after streaming"
        : destination === "preview"
          ? "Preview Mermaid diagram"
          : "Show Mermaid source",
      disabled: isStreaming,
    },
  };
}

let mermaidOperationQueue: Promise<void> = Promise.resolve();

export function enqueueMermaidOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mermaidOperationQueue.then(operation, operation);
  mermaidOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function normalizeMermaidFontSize(fontSize: number): number {
  return normalizeNumericPreference(fontSize, TRANSCRIPT_FONT_SPEC);
}

export function buildMermaidRenderKey(isDark: boolean, fontSize: number, code: string): string {
  return `${isDark ? "dark" : "light"}\n${normalizeMermaidFontSize(fontSize)}px\n${code}`;
}

export function mermaidDisplayConfig(fontSize: number): { fontSize: number } {
  return { fontSize: normalizeMermaidFontSize(fontSize) };
}
