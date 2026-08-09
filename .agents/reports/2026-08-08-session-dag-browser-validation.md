# Session DAG Browser Validation

Date: 2026-08-09
Target: `.agents/plans/2026-08-08-session-dag-view.md`

## Environment

- Pi Web development server from the task worktree; no production build was run.
- Initial coverage used an isolated temporary Pi agent directory, four synthetic sessions, and a disposable file-explorer project. The final security/focus follow-up used three fresh synthetic sessions under the ignored main-root runtime directory.
- Headless Chromium was controlled through the Chrome DevTools Protocol at 500, 800, 1200, and 1280 CSS pixels.
- Every temporary server and browser was stopped after validation. Screenshots containing Raw fixture IDs were intentionally not retained in tracked reports.

## Outcomes

### Permanent tab, lazy activation, and layout

- The right panel began closed, `aria-hidden`, and `inert` with only the permanent **DAG** tab present.
- No DAG component or `/api/session-dag` request existed before first activation.
- First activation opened Preview and performed the lazy load.
- At 800 px, the panel used automatic expanded presentation. At 1200 px, normal sidebar/chat/right-panel layout returned. At 500 px, the ordinary mobile full-width panel was the sole mode and Raw authoring fit without horizontal panel overflow.
- Opening a file selected its closable tab. Home moved focus and selection back to DAG. Closing the final file kept the panel open, selected DAG, and preserved the expansion record.
- DAG component identity, Raw mode, and an unfinished draft survived file selection, final-file closure, mobile hide/reopen, and responsive crossings.

### Structured graph and history

- Exact From/To entry created one persisted directed edge.
- Clicking an inert node body did not mutate the graph.
- Enter on the eligible explicit SVG control completed one node exactly once; the dependent sink remained as a visible terminal node.
- Undo and Redo restored/rearchived the exact edge and preserved terminal behavior.
- A simulated second client advanced the revision. The stale local mutation adopted authoritative state, retained its applicable draft, displayed `Graph changed elsewhere; review and retry`, and did not replay automatically. A later explicit retry succeeded.
- Space completed a disconnected eligible node once with the expected next server sequence.

### Mermaid and accessibility boundary

- Each Mermaid result was required to parse as exactly one responsive, named graph SVG with valid title/description references before mounting. The validated graph root uses `role="group"`.
- Node aliases mapped to current compiled aliases; exact IDs appeared in node tooltips but not visible SVG text.
- Original Mermaid nodes were inert. Eligible nodes received focusable `Complete <label>` controls in a separately named trusted sibling SVG overlay inside the same ShadowRoot. This keeps Mermaid CSS unable to select the controls while preserving visual containment and pointer/keyboard alignment.
- Root-level `htmlLabels: false` produced SVG-only labels. Hostile and renamed label text remained text, with no script or `foreignObject` content.
- A CDP fault injection appended an SVG `script` during XML parsing. Validation rejected the output at the `safety` stage, mounted no SVG/script, kept Raw usable, and recovered on the next clean Preview activation without changing graph revision.
- A rename propagated through `sessions_changed`, refreshed Preview text, and did not advance DAG revision.

### Missing sessions and copy behavior

- Removing one synthetic session after its edge had been accepted changed only presentation to `Session unavailable`; DAG revision remained unchanged.
- Its full ID remained available in Raw and the safe Preview tooltip. Raw copy returned the exact ID.
- The unavailable terminal node completed in a valid zero-visible-edge batch, then Undo restored it.
- Sidebar copy succeeded without selecting or navigating the row. Raw Clipboard API rejection produced accessible failure feedback.
- Pure clipboard tests separately cover modern rejection, legacy `execCommand("copy") === false`, thrown fallback errors, and unconditional temporary-textarea cleanup.

### Non-enforcement and restoration

- DAG operations did not invoke an agent command or alter running state, sidebar metadata, worktrees, or native ancestry.
- Session JSONL bytes temporarily touched to force missing-session discovery were restored exactly; before/after hashes matched.
- The graph persisted independently in the isolated DAG state file and survived repeated GETs and browser reloads.

### Final SVG, refresh, and responsive follow-up

- Fresh light and dark renders mounted one validated Mermaid graph SVG plus one trusted sibling control-layer SVG in the ShadowRoot. Dark Mermaid emitted five legitimate current-render local-gradient `fill`/`stroke` rules; all five passed the narrow allowlist, no external CSS capability was admitted, and Preview reported no failure.
- The control layer remained outside the graph SVG, `pointer-events: all` applied only to the button, and the control visibly overlapped its intended node at 1280 and 500 CSS pixels. A real pointer click and Space activation each produced exactly one completion; Undo/Redo restored and rearchived the expected edge.
- A blocked graph Refresh produced the bounded load error. After network restoration, a successful Refresh cleared only that source-tagged error, leaving no obsolete feedback.
- Hide/reopen retained the mounted DAG, Preview mode, selected DAG tab, and the same ShadowRoot. Crossing to 500 CSS pixels moved focus from the now-hidden expansion button to the selected DAG tab after the transition and settled at a full 500-pixel panel width.
- The privacy-safe machine-readable result is retained outside Git at `.agents/runtime/session-dag-final-browser/browser-validation.json`; it records counts, roles, state revisions, and screenshot paths but no session IDs, pairs, Mermaid source, or mutation payloads.

## Residual limitations

- Browser validation inspected DOM accessibility, focus, keyboard behavior, and SVG structure; it did not run a platform screen reader.
- Multi-client conflict was exercised with an independent HTTP mutation against the same server rather than two visible browser windows.
