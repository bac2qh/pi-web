"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  CHAT_WIDTH_SPEC,
  MENU_FONT_SPEC,
  TRANSCRIPT_FONT_SPEC,
  normalizeNumericPreference,
  stepNumericPreference,
  type NumericPreferenceSpec,
} from "@/lib/display-preferences";
import { useDisplayPreferences } from "@/hooks/useDisplayPreferences";

interface NumericStepperProps {
  label: string;
  shortLabel: string;
  value: number;
  spec: NumericPreferenceSpec;
  onChange: (value: number) => void;
  variant: "inline" | "panel";
}

function NumericStepper({ label, shortLabel, value, spec, onChange, variant }: NumericStepperProps) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const normalized = normalizeNumericPreference(parsed, spec);
    onChange(normalized);
    setDraft(String(normalized));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelCommitRef.current = true;
      setDraft(String(value));
      event.currentTarget.blur();
    }
  };

  return (
    <div className={`display-control-group display-control-group-${variant}`} role="group" aria-label={`${label} font size`}>
      <span className="display-control-label" title={`${label} font size`}>
        {variant === "inline" ? shortLabel : label}
      </span>
      <button
        type="button"
        className="display-control-step"
        aria-label={`Decrease ${label.toLowerCase()} font size`}
        disabled={value <= spec.min}
        onClick={() => onChange(stepNumericPreference(value, -1, spec))}
      >
        −
      </button>
      <label className="display-control-input-wrap">
        <span className="sr-only">{label} font size in pixels</span>
        <input
          className="display-control-input"
          type="number"
          inputMode="numeric"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={draft}
          onFocus={() => {
            focusedRef.current = true;
            cancelCommitRef.current = false;
          }}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            const parsed = Number(nextDraft);
            if (
              nextDraft.trim() !== ""
              && Number.isInteger(parsed)
              && parsed >= spec.min
              && parsed <= spec.max
            ) {
              onChange(parsed);
            }
          }}
          onBlur={() => {
            focusedRef.current = false;
            if (cancelCommitRef.current) {
              cancelCommitRef.current = false;
              setDraft(String(value));
              return;
            }
            commitDraft();
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="display-control-unit" aria-hidden="true">px</span>
      </label>
      <button
        type="button"
        className="display-control-step"
        aria-label={`Increase ${label.toLowerCase()} font size`}
        disabled={value >= spec.max}
        onClick={() => onChange(stepNumericPreference(value, 1, spec))}
      >
        +
      </button>
    </div>
  );
}

export function DisplayControls({ variant }: { variant: "inline" | "panel" }) {
  const {
    chatWidthPercent,
    transcriptFontSize,
    menuFontSize,
    setChatWidthPercent,
    resetChatWidthPercent,
    setTranscriptFontSize,
    setMenuFontSize,
  } = useDisplayPreferences();

  return (
    <div
      id={variant === "panel" ? "display-settings-panel" : undefined}
      className={`display-controls display-controls-${variant}`}
      role={variant === "panel" ? "region" : "group"}
      aria-label="Display settings"
    >
      <div className={`display-control-group display-control-group-${variant}`} role="group" aria-label="Chat width">
        <span className="display-control-label" title="Chat width">
          Width
        </span>
        <button
          type="button"
          className="display-control-step"
          aria-label="Decrease chat width"
          disabled={chatWidthPercent <= CHAT_WIDTH_SPEC.min}
          onClick={() => setChatWidthPercent(stepNumericPreference(chatWidthPercent, -1, CHAT_WIDTH_SPEC))}
        >
          −
        </button>
        <button
          type="button"
          className="display-control-value-button"
          aria-label={`Chat width ${chatWidthPercent} percent; reset to ${CHAT_WIDTH_SPEC.defaultValue} percent`}
          title={`Reset chat width to ${CHAT_WIDTH_SPEC.defaultValue}%`}
          onClick={resetChatWidthPercent}
        >
          {chatWidthPercent}%
        </button>
        <button
          type="button"
          className="display-control-step"
          aria-label="Increase chat width"
          disabled={chatWidthPercent >= CHAT_WIDTH_SPEC.max}
          onClick={() => setChatWidthPercent(stepNumericPreference(chatWidthPercent, 1, CHAT_WIDTH_SPEC))}
        >
          +
        </button>
      </div>

      <NumericStepper
        label="Transcript"
        shortLabel="T"
        value={transcriptFontSize}
        spec={TRANSCRIPT_FONT_SPEC}
        onChange={setTranscriptFontSize}
        variant={variant}
      />
      <NumericStepper
        label="Menu"
        shortLabel="UI"
        value={menuFontSize}
        spec={MENU_FONT_SPEC}
        onChange={setMenuFontSize}
        variant={variant}
      />
    </div>
  );
}
