export interface NumericPreferenceSpec {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export interface DisplayPreferences {
  chatWidthPercent: number;
  transcriptFontSize: number;
  menuFontSize: number;
}

export const CHAT_WIDTH_SPEC: NumericPreferenceSpec = {
  defaultValue: 70,
  min: 50,
  max: 100,
  step: 5,
};

export const TRANSCRIPT_FONT_SPEC: NumericPreferenceSpec = {
  defaultValue: 16,
  min: 10,
  max: 32,
  step: 1,
};

export const MENU_FONT_SPEC: NumericPreferenceSpec = {
  defaultValue: 14,
  min: 10,
  max: 24,
  step: 1,
};

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  chatWidthPercent: CHAT_WIDTH_SPEC.defaultValue,
  transcriptFontSize: TRANSCRIPT_FONT_SPEC.defaultValue,
  menuFontSize: MENU_FONT_SPEC.defaultValue,
};

export const DISPLAY_PREFERENCE_STORAGE_KEYS = {
  chatWidthPercent: "pi-chat-width-percent",
  transcriptFontSize: "pi-transcript-font-size",
  menuFontSize: "pi-menu-font-size",
} as const;

export function normalizeNumericPreference(value: number, spec: NumericPreferenceSpec): number {
  if (!Number.isFinite(value)) return spec.defaultValue;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const stepIndex = Math.round((clamped - spec.min) / spec.step);
  const stepped = spec.min + stepIndex * spec.step;
  return Math.min(spec.max, Math.max(spec.min, stepped));
}

export function parseStoredPreference(raw: string | null, spec: NumericPreferenceSpec): number {
  if (raw === null || raw.trim() === "") return spec.defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) ? normalizeNumericPreference(value, spec) : spec.defaultValue;
}

export function stepNumericPreference(
  current: number,
  direction: -1 | 1,
  spec: NumericPreferenceSpec,
): number {
  return normalizeNumericPreference(current + direction * spec.step, spec);
}

export function displayPreferenceCssVariables(preferences: DisplayPreferences): Record<string, string> {
  return {
    "--pi-chat-width-percent": String(preferences.chatWidthPercent),
    "--pi-transcript-font-size": `${preferences.transcriptFontSize}px`,
    "--pi-transcript-font-scale": String(preferences.transcriptFontSize / 14),
    "--pi-menu-font-size": `${preferences.menuFontSize}px`,
    "--pi-menu-font-scale": String(preferences.menuFontSize / MENU_FONT_SPEC.defaultValue),
  };
}

export function scaledMenuFontSize(basePixels: number): string {
  return `calc(${basePixels}px * var(--pi-menu-font-scale, 1))`;
}

export function scaledTranscriptFontSize(basePixels: number): string {
  return `calc(${basePixels}px * var(--pi-transcript-font-scale, ${TRANSCRIPT_FONT_SPEC.defaultValue / 14}))`;
}
