import type { ExtensionStatusItem } from "./types";

/** Pi-Web-owned status transport metadata for the authenticated OpenAI Fast adapter. */
export const PI_WEB_OPENAI_FAST_MODE_STATUS_KEY = "pi-web:openai-fast-mode";

/** Keeps an extension collision visible as an ordinary status without granting host-key authority. */
export const PI_WEB_OPENAI_FAST_MODE_ESCAPED_EXTENSION_STATUS_KEY =
  `extension:${PI_WEB_OPENAI_FAST_MODE_STATUS_KEY}`;

export const OPENAI_FAST_MODE_STATES = ["effective", "unavailable", "off", "unknown"] as const;
export type OpenAiFastModeState = (typeof OPENAI_FAST_MODE_STATES)[number];

export function isOpenAiFastModeState(value: unknown): value is OpenAiFastModeState {
  return typeof value === "string" && (OPENAI_FAST_MODE_STATES as readonly string[]).includes(value);
}

/**
 * Remove Pi Web's reserved host entry before generic extension-status rendering.
 * A present malformed or duplicated host entry fails closed to `unknown`.
 */
export function splitOpenAiFastModeStatus(
  statuses: readonly ExtensionStatusItem[],
): { fastModeState: OpenAiFastModeState | null; extensionStatuses: ExtensionStatusItem[] } {
  let reservedCount = 0;
  let fastModeState: OpenAiFastModeState | null = null;
  const extensionStatuses: ExtensionStatusItem[] = [];

  for (const status of statuses) {
    if (status?.key !== PI_WEB_OPENAI_FAST_MODE_STATUS_KEY) {
      extensionStatuses.push(status);
      continue;
    }
    reservedCount += 1;
    if (reservedCount === 1 && isOpenAiFastModeState(status.text)) fastModeState = status.text;
    else fastModeState = "unknown";
  }

  if (reservedCount > 1) fastModeState = "unknown";
  return { fastModeState, extensionStatuses };
}
