import { TRANSCRIPT_FONT_SPEC, normalizeNumericPreference } from "./display-preferences";

export type MermaidView = "preview" | "source";

export const DEFAULT_MERMAID_VIEW: MermaidView = "preview";

export interface MermaidResponsiveSizing {
  width: "100%";
  maxWidth: string;
  height: "auto";
}

const SVG_NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const SVG_WHITESPACE_PATTERN = String.raw`[ \t\r\n]`;
const VIEW_BOX_SEPARATOR_PATTERN = String.raw`(?:${SVG_WHITESPACE_PATTERN}*,${SVG_WHITESPACE_PATTERN}*|${SVG_WHITESPACE_PATTERN}+)`;
const MERMAID_VIEW_BOX_PATTERN = new RegExp(
  String.raw`^${SVG_WHITESPACE_PATTERN}*(${SVG_NUMBER_PATTERN})${VIEW_BOX_SEPARATOR_PATTERN}(${SVG_NUMBER_PATTERN})${VIEW_BOX_SEPARATOR_PATTERN}(${SVG_NUMBER_PATTERN})${VIEW_BOX_SEPARATOR_PATTERN}(${SVG_NUMBER_PATTERN})${SVG_WHITESPACE_PATTERN}*$`,
  "u",
);

export function getMermaidResponsiveSizing(
  viewBox: string | null | undefined,
): MermaidResponsiveSizing | null {
  if (!viewBox) return null;

  const match = MERMAID_VIEW_BOX_PATTERN.exec(viewBox);
  if (!match) return null;

  const values = match.slice(1).map(Number);
  if (!values.every(Number.isFinite)) return null;

  const naturalWidth = values[2];
  const naturalHeight = values[3];
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;

  return {
    width: "100%",
    maxWidth: `${String(naturalWidth)}px`,
    height: "auto",
  };
}

export function finalizeMermaidSvg(
  svgMarkup: string,
  ownerDocument: Document | undefined = typeof document === "undefined" ? undefined : document,
): string {
  if (!ownerDocument) return svgMarkup;

  const template = ownerDocument.createElement("template");
  template.innerHTML = svgMarkup;
  if (template.content.childElementCount !== 1) return svgMarkup;

  const root = template.content.firstElementChild;
  if (root?.namespaceURI !== "http://www.w3.org/2000/svg" || root.localName !== "svg") {
    return svgMarkup;
  }

  const sizing = getMermaidResponsiveSizing(root.getAttribute("viewBox"));
  if (!sizing) return svgMarkup;

  const svgElement = root as SVGSVGElement;
  svgElement.setAttribute("width", sizing.width);
  svgElement.style.setProperty("width", sizing.width);
  svgElement.style.setProperty("max-width", sizing.maxWidth);
  svgElement.style.setProperty("height", sizing.height);
  return template.innerHTML;
}

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
