import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  CHAT_WIDTH_SPEC,
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCE_STORAGE_KEYS,
  FILE_VIEWER_FONT_SPEC,
  MENU_FONT_SPEC,
  TRANSCRIPT_FONT_SPEC,
  displayPreferenceCssVariables,
  normalizeNumericPreference,
  parseStoredPreference,
  scaledFileViewerFontSize,
  scaledMenuFontSize,
  scaledTranscriptFontSize,
  stepNumericPreference,
} = await jiti.import("./display-preferences.ts");

test("uses defaults for absent or malformed display preferences", () => {
  assert.equal(parseStoredPreference(null, CHAT_WIDTH_SPEC), 70);
  assert.equal(parseStoredPreference("", TRANSCRIPT_FONT_SPEC), 16);
  assert.equal(parseStoredPreference("not-a-number", MENU_FONT_SPEC), 14);
  assert.equal(parseStoredPreference(null, FILE_VIEWER_FONT_SPEC), 14);
  assert.equal(parseStoredPreference("not-a-number", FILE_VIEWER_FONT_SPEC), 14);
  assert.deepEqual(DEFAULT_DISPLAY_PREFERENCES, {
    chatWidthPercent: 70,
    transcriptFontSize: 16,
    menuFontSize: 14,
    fileViewerFontSize: 14,
  });
  assert.equal(DISPLAY_PREFERENCE_STORAGE_KEYS.fileViewerFontSize, "pi-file-viewer-font-size");
});

test("clamps and snaps display preferences to their approved ranges", () => {
  assert.equal(normalizeNumericPreference(48, CHAT_WIDTH_SPEC), 50);
  assert.equal(normalizeNumericPreference(73, CHAT_WIDTH_SPEC), 75);
  assert.equal(normalizeNumericPreference(104, CHAT_WIDTH_SPEC), 100);
  assert.equal(normalizeNumericPreference(9, TRANSCRIPT_FONT_SPEC), 10);
  assert.equal(normalizeNumericPreference(22, TRANSCRIPT_FONT_SPEC), 22);
  assert.equal(normalizeNumericPreference(40, TRANSCRIPT_FONT_SPEC), 32);
  assert.equal(normalizeNumericPreference(30, MENU_FONT_SPEC), 24);
  assert.equal(normalizeNumericPreference(9, FILE_VIEWER_FONT_SPEC), 10);
  assert.equal(normalizeNumericPreference(21, FILE_VIEWER_FONT_SPEC), 21);
  assert.equal(normalizeNumericPreference(40, FILE_VIEWER_FONT_SPEC), 32);
});

test("steps preferences without crossing their bounds", () => {
  assert.equal(stepNumericPreference(70, 1, CHAT_WIDTH_SPEC), 75);
  assert.equal(stepNumericPreference(50, -1, CHAT_WIDTH_SPEC), 50);
  assert.equal(stepNumericPreference(100, 1, CHAT_WIDTH_SPEC), 100);
  assert.equal(stepNumericPreference(16, -1, TRANSCRIPT_FONT_SPEC), 15);
  assert.equal(stepNumericPreference(24, 1, MENU_FONT_SPEC), 24);
  assert.equal(stepNumericPreference(14, 1, FILE_VIEWER_FONT_SPEC), 15);
  assert.equal(stepNumericPreference(10, -1, FILE_VIEWER_FONT_SPEC), 10);
  assert.equal(stepNumericPreference(32, 1, FILE_VIEWER_FONT_SPEC), 32);
});

test("builds bounded CSS variables without changing font families", () => {
  assert.deepEqual(
    displayPreferenceCssVariables({
      chatWidthPercent: 75,
      transcriptFontSize: 22,
      menuFontSize: 16,
      fileViewerFontSize: 28,
    }),
    {
      "--pi-chat-width-percent": "75",
      "--pi-transcript-font-size": "22px",
      "--pi-transcript-font-scale": String(22 / 14),
      "--pi-menu-font-size": "16px",
      "--pi-menu-font-scale": String(16 / 14),
      "--pi-file-viewer-font-size": "28px",
      "--pi-file-viewer-font-scale": "2",
    },
  );
  assert.equal(scaledMenuFontSize(11), "calc(11px * var(--pi-menu-font-scale, 1))");
  assert.equal(scaledFileViewerFontSize(13), "calc(13px * var(--pi-file-viewer-font-scale, 1))");
  assert.equal(
    scaledTranscriptFontSize(12),
    `calc(12px * var(--pi-transcript-font-scale, ${16 / 14}))`,
  );
});
