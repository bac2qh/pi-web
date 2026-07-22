import { TRANSCRIPT_FONT_SPEC, normalizeNumericPreference } from "./display-preferences";

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
