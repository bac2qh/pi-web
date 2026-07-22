"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CHAT_WIDTH_SPEC,
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCE_STORAGE_KEYS,
  MENU_FONT_SPEC,
  TRANSCRIPT_FONT_SPEC,
  displayPreferenceCssVariables,
  normalizeNumericPreference,
  parseStoredPreference,
  type DisplayPreferences,
} from "@/lib/display-preferences";

interface DisplayPreferencesContextValue extends DisplayPreferences {
  setChatWidthPercent: (value: number) => void;
  resetChatWidthPercent: () => void;
  setTranscriptFontSize: (value: number) => void;
  setMenuFontSize: (value: number) => void;
}

const DEFAULT_CONTEXT: DisplayPreferencesContextValue = {
  ...DEFAULT_DISPLAY_PREFERENCES,
  setChatWidthPercent: () => {},
  resetChatWidthPercent: () => {},
  setTranscriptFontSize: () => {},
  setMenuFontSize: () => {},
};

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue>(DEFAULT_CONTEXT);

function applyCssVariables(preferences: DisplayPreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(displayPreferenceCssVariables(preferences))) {
    root.style.setProperty(name, value);
  }
}

function writeStoredPreference(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Presentation preferences remain usable for this page when storage is unavailable.
  }
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<DisplayPreferences>(DEFAULT_DISPLAY_PREFERENCES);

  useEffect(() => {
    let loaded = DEFAULT_DISPLAY_PREFERENCES;
    try {
      loaded = {
        chatWidthPercent: parseStoredPreference(
          window.localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.chatWidthPercent),
          CHAT_WIDTH_SPEC,
        ),
        transcriptFontSize: parseStoredPreference(
          window.localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.transcriptFontSize),
          TRANSCRIPT_FONT_SPEC,
        ),
        menuFontSize: parseStoredPreference(
          window.localStorage.getItem(DISPLAY_PREFERENCE_STORAGE_KEYS.menuFontSize),
          MENU_FONT_SPEC,
        ),
      };
    } catch {
      // Defaults are already safe when storage cannot be read.
    }
    setPreferences(loaded);
    applyCssVariables(loaded);
  }, []);

  const updatePreference = useCallback((
    key: keyof DisplayPreferences,
    value: number,
    storageKey: string,
  ) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      applyCssVariables(next);
      return next;
    });
    writeStoredPreference(storageKey, value);
  }, []);

  const setChatWidthPercent = useCallback((value: number) => {
    const normalized = normalizeNumericPreference(value, CHAT_WIDTH_SPEC);
    updatePreference("chatWidthPercent", normalized, DISPLAY_PREFERENCE_STORAGE_KEYS.chatWidthPercent);
  }, [updatePreference]);

  const resetChatWidthPercent = useCallback(() => {
    setChatWidthPercent(CHAT_WIDTH_SPEC.defaultValue);
  }, [setChatWidthPercent]);

  const setTranscriptFontSize = useCallback((value: number) => {
    const normalized = normalizeNumericPreference(value, TRANSCRIPT_FONT_SPEC);
    updatePreference("transcriptFontSize", normalized, DISPLAY_PREFERENCE_STORAGE_KEYS.transcriptFontSize);
  }, [updatePreference]);

  const setMenuFontSize = useCallback((value: number) => {
    const normalized = normalizeNumericPreference(value, MENU_FONT_SPEC);
    updatePreference("menuFontSize", normalized, DISPLAY_PREFERENCE_STORAGE_KEYS.menuFontSize);
  }, [updatePreference]);

  const value = useMemo<DisplayPreferencesContextValue>(() => ({
    ...preferences,
    setChatWidthPercent,
    resetChatWidthPercent,
    setTranscriptFontSize,
    setMenuFontSize,
  }), [
    preferences,
    resetChatWidthPercent,
    setChatWidthPercent,
    setMenuFontSize,
    setTranscriptFontSize,
  ]);

  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences(): DisplayPreferencesContextValue {
  return useContext(DisplayPreferencesContext);
}
