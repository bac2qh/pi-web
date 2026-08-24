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

- The desktop sidebar and right panel each have an independent browser-local preferred width: `pi-sidebar-width` and `pi-right-panel-width`. The right-panel preference belongs to the shared display container, so DAG and file tabs use one stable width rather than changing geometry when the selected content changes. Preferences are global to the current browser profile, not session/project/server state, and storage failure leaves page-local resizing usable.
- Preferred and effective widths are intentionally distinct. The sidebar defaults to `260px` within `180–480px`; an unset right panel continues to default to the current responsive `42%` within `300–1200px`. The ordinary split layout reserves at least `320px` for conversation and temporarily clamps both visible side panels together without overwriting either preference. A wider feasible layout restores the preference.
- Focusable vertical separators exist only at `1000px` and wider for visible, non-expanded panels. Pointer movement updates only panel CSS variables and live ARIA during capture, then commits once; arrows, Shift+arrows, Home/End, Enter, and double-click provide keyboard adjustment and reset. Reset removes the storage key rather than persisting a default pixel value.
- Sidebar/right-panel collapse, manual expansion, automatic full-width viewing below `1000px`, and the `640px` mobile layout remain authoritative. Each panel and its fixed-width direct children consume the same variable so resizing and restoration do not remount conversation, DAG, or file-viewer trees.

## 2026-08-12 — Extension-widget disclosure choices are mounted-chat state

- Every array- or factory-origin widget card above or below the editor has its own browser-native disclosure. Untouched widgets follow the responsive default—collapsed at `≤640px`, expanded above it—while an explicit choice remains authoritative across later viewport changes.
- The explicit map is keyed only within the mounted chat. It survives line replacement, reordering, and placement movement while the key remains present, but key removal or a chat remount discards it. New-chat materialization keeps the existing mount; page reload and selected-chat changes do not persist or transfer choices.
- Collapsing applies `hidden` only to the still-mounted browser body. The extension projection, current lines, ten-line display cap, editor-adjacent slot bounds, and custom-panel input behavior remain separate and unchanged.

## 2026-08-22 — Edit disclosures are change-focused mounted transcript state

- Recognized edit cards and edit-containing settled **Process details** groups initialize expanded, while non-edit tools retain the collapsed default. Each disclosure remains independently user-controlled for its mounted lifetime; collapsing keeps the ARIA-controlled shell but releases expensive result children, and a remount restores the classification default rather than persisting a preference.
- Successful structured edit details remain immutable input. The transcript derives strict factual unified hunks with exactly three adjacent context lines, counted omissions, old/new gutters, bounded separate old/new syntax projections, and one-to-one-only intra-line emphasis. Unsupported or over-budget structure falls back intact to naturally sized, soft-wrapped plaintext.
- The review card is always full-width and top-to-bottom. Removed rows precede added rows, red/green meaning also has textual markers, long content wraps without horizontal or nested vertical scrolling, and light/dark treatment remains transcript presentation rather than editor/repository authority.

## 2026-08-24 — Exact write disclosures reveal completed call-time content

- Exact, case-sensitive `write` stays separate from broad edit recognition. A pending card initializes collapsed and mounts neither raw arguments nor code. The first matching result opens an untouched mounted card once for success or failure; any earlier user toggle, later manual collapse, result replacement, or result reappearance remains authoritative.
- Settled **Process details** starts open for a write only when the exact grouped call ID has a matching completed result. Outside writes, orphan results, pending writes, and near names do not broaden the default; outer and inner disclosures retain their established independent mounted lifetimes.
- Valid completed `{ path, content }` renders the complete call-time string without a filesystem comparison. Success uses **Written content** and failure uses **Attempted content** with result text retained. Neutral decorative line numbers, natural soft wrapping, and bounded theme-aware syntax preserve text; unsupported, oversized, or syntax-inexact content falls back completely to line-numbered plaintext, while malformed input uses the ordinary JSON/result surface.

## References

- Write-result disclosure plan: `.agents/plans/2026-08-24-show-write-code-by-default.md`
- Write-result disclosure checkpoint: `.agents/checkpoints/2026-08-24-show-write-code-by-default-checkpoints.md`
- Write-result browser evidence: `.agents/reports/2026-08-24-show-write-code-by-default/browser-validation.json`
- Edit-result disclosure plan: `.agents/plans/2026-08-21-expand-edit-results-by-default.md`
- Edit-result disclosure checkpoint: `.agents/checkpoints/2026-08-21-expand-edit-results-by-default-checkpoints.md`
- Edit-result browser evidence: `.agents/reports/2026-08-21-expand-edit-results-by-default/browser-validation.json`
- File Viewer typography plan: `.agents/plans/2026-08-06-file-viewer-font-size.md`
- File Viewer typography checkpoint: `.agents/checkpoints/2026-08-06-file-viewer-font-size-checkpoints.md`
- File Viewer typography browser evidence: `.agents/reports/2026-08-06-file-viewer-font-size/browser-validation.json`
- Resizable panels plan: `.agents/plans/2026-08-09-resizable-panels.md`
- Resizable panels checkpoint: `.agents/checkpoints/2026-08-09-resizable-panels-checkpoints.md`
- Resizable panels browser evidence: `.agents/reports/2026-08-09-resizable-panels/browser-validation.json`
- Collapsible extension widgets plan: `.agents/plans/2026-08-12-collapsible-extension-widgets.md`
- Collapsible extension widgets checkpoint: `.agents/checkpoints/2026-08-12-collapsible-extension-widgets-checkpoints.md`
- Shared DAG/file right-panel integration evidence: `.agents/reports/2026-08-08-session-dag-browser-validation.md`
