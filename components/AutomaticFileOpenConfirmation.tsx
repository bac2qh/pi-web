"use client";

import { useEffect, useRef } from "react";

interface AutomaticFileOpenConfirmationProps {
  displayPath: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function AutomaticFileOpenConfirmation({
  displayPath,
  onConfirm,
  onDismiss,
}: AutomaticFileOpenConfirmationProps) {
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    openButtonRef.current?.focus();
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const openButton = openButtonRef.current;
      const cancelButton = cancelButtonRef.current;
      if (!openButton || !cancelButton) return;
      if (event.shiftKey && document.activeElement === openButton) {
        event.preventDefault();
        cancelButton.focus();
      } else if (!event.shiftKey && document.activeElement === cancelButton) {
        event.preventDefault();
        openButton.focus();
      } else if (document.activeElement !== openButton && document.activeElement !== cancelButton) {
        event.preventDefault();
        openButton.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="automatic-file-confirmation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div
        className="automatic-file-confirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automatic-file-confirmation-title"
        aria-describedby="automatic-file-confirmation-path"
      >
        <div id="automatic-file-confirmation-title" className="automatic-file-confirmation-title">
          Open this file?
        </div>
        <code id="automatic-file-confirmation-path" className="automatic-file-confirmation-path">
          {displayPath}
        </code>
        <div className="automatic-file-confirmation-actions">
          <button
            ref={openButtonRef}
            type="button"
            className="automatic-file-confirmation-open"
            onClick={onConfirm}
          >
            Open file
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            className="automatic-file-confirmation-cancel"
            onClick={() => onDismiss()}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
