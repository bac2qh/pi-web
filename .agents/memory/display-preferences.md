# Browser-Local Display Preferences

## 2026-08-06 — File content has an independent proportional base

- Width, Transcript, Menu, and File Viewer remain independent browser-local numeric preferences in the shared display-preference provider. File Viewer uses `pi-file-viewer-font-size`, defaults to `14px`, accepts `10–32px`, and publishes both an exact base and a scale relative to 14.
- File Viewer owns only Pi-Web-rendered file content. Source/raw text, source line numbers, diff body/prefix/subordinate rows, and Explorer Markdown follow its scale. File tabs, status, Preview/Raw/Diff/wrap/download controls, loading, and errors remain Menu-owned; Transcript remains chat-only.
- The selected value is a base, not a universal assignment. At the default, source and diff body remain `13px`; source line numbers remain `13px`; diff line numbers/collapsed rows remain `11px`; Markdown prose remains `14px`; the fenced-code container remains `13px` and its existing nested `0.9em` code computes to `11.7px`; headings and inline code retain their existing relative sizes and font families.
- Explorer Markdown receives the exact Viewer base at its file-only root. Fixed table and fenced-code baselines use the derived scale once; relative descendants inherit naturally. Do not apply the Viewer variable to generic/chat Markdown or to viewer chrome.
- HTML Preview and PDF/DOCX iframe internals remain renderer-owned. Images and audio have no Viewer font size. Raw HTML source is ordinary source content and follows Viewer; do not implement this preference through iframe injection or whole-document zoom.
- Display settings expose File Viewer as the fourth editable group in both presentations. The center-pane presentation handoff is `1400px`: panel controls through 1400px and the inline row from 1401px. This is intentionally wider than the separate `1000px` chat-width handoff so four groups plus session statistics remain unclipped at maximum Menu size.
- Expanded file viewing keeps the selected value applied but hides the global control with the center pane. Restore the split layout to adjust it; the next automatic narrow open still uses the persisted selection.

## 2026-08-09 — Side-panel widths are independent preferred values

- The desktop sidebar and file viewer each have an independent browser-local preferred width: `pi-sidebar-width` and `pi-right-panel-width`. Preferences are global to the current browser profile, not session/project/server state, and storage failure leaves page-local resizing usable.
- Preferred and effective widths are intentionally distinct. The sidebar defaults to `260px` within `180–480px`; an unset file viewer continues to default to the current responsive `42%` within `300–1200px`. The ordinary split layout reserves at least `320px` for conversation and temporarily clamps both visible side panels together without overwriting either preference. A wider feasible layout restores the preference.
- Focusable vertical separators exist only at `1000px` and wider for visible, non-expanded panels. Pointer movement updates only panel CSS variables and live ARIA during capture, then commits once; arrows, Shift+arrows, Home/End, Enter, and double-click provide keyboard adjustment and reset. Reset removes the storage key rather than persisting a default pixel value.
- Sidebar/file collapse, manual expansion, automatic full-width viewing below `1000px`, and the `640px` mobile layout remain authoritative. Each panel and its fixed-width direct children consume the same variable so resizing and restoration do not remount conversation or viewer trees.

## References

- File Viewer typography plan: `.agents/plans/2026-08-06-file-viewer-font-size.md`
- File Viewer typography checkpoint: `.agents/checkpoints/2026-08-06-file-viewer-font-size-checkpoints.md`
- File Viewer typography browser evidence: `.agents/reports/2026-08-06-file-viewer-font-size/browser-validation.json`
- Resizable panels plan: `.agents/plans/2026-08-09-resizable-panels.md`
- Resizable panels checkpoint: `.agents/checkpoints/2026-08-09-resizable-panels-checkpoints.md`
- Resizable panels browser evidence: `.agents/reports/2026-08-09-resizable-panels/browser-validation.json`
