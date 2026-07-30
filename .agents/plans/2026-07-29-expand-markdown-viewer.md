# Expand File Viewer

Status: approved
Date: 2026-07-29
Approved by user: 2026-07-29

## Objective

Add an in-page expanded mode for the shared Explorer file viewer so any supported file can occupy the web application's content viewport without invoking browser full-screen mode. Markdown receives a responsive hybrid layout that keeps prose readable while giving wide content more room.

Success requires:

- A visible outward/inward-corner icon button in the viewer chrome enters and leaves expanded mode.
- The expanded viewer occupies the application's full `100dvh` layout; sidebar, chat, app top bar, and the separate fixed panel toggle do not remain visible, space-consuming, or pointer-interactive.
- File tabs, the active viewer, file status/actions, live watches, and hidden chat remain mounted and coherent through expansion and restoration.
- Expansion applies to every supported file type and remains active across tab switches and Markdown Preview/Raw/Diff changes.
- Markdown centers ordinary reading content in a `1000px` maximum column while allowing fenced code, tables, and standalone media to use the wider padded viewer surface safely.
- Restoration is button-only. This feature adds no Escape handling and does not change Pi Web's existing context-dependent Escape behaviors.
- Existing normal desktop and mobile viewer behavior remains intact.

## Design / Implementation Strategy

1. Add one ephemeral `fileViewerExpanded` Boolean at `AppShell`, the existing owner of file tabs, active-tab selection, panel visibility, and all shell regions. Do not put expanded state in `FileViewer`, a tab record, URL state, localStorage, settings, sessions, or a server API.
2. Add the expand/restore control beside the existing `TabBar`, outside file-type renderers, so it is present for Markdown, source/diff, image, audio, HTML, and PDF/DOCX viewers. Use a normal native `type="button"` click target, outward arrows when normal, inward arrows when expanded, a decorative `aria-hidden` SVG, and dynamic `title`/`aria-label` values of “Expand file viewer” and “Restore file viewer.” Do not add custom key handling or treat keyboard activation/focus restoration as a product requirement; any native Enter/Space behavior comes from the button element itself.
3. Reuse the existing right-panel subtree; do not clone, portal, or reparent `FileViewer`. Toggle explicit shell/panel classes that remove the sidebar and center pane from layout with CSS while leaving their React trees mounted, suppress the separate fixed top-right panel toggle, remove the viewer's left border, and make the existing panel fill the shell.
4. Override both current desktop width constraints: the open panel's `42%`/`300px` rule and each direct child's independent `42vw`/`300px` rule. Expanded mode sets both levels to the full available width with no residual minimum or split-panel width animation. Restoration returns to the unchanged normal rules.
5. Keep expansion active when selecting or opening any other tab and when changing Markdown Preview/Raw/Diff. Closing a non-final tab preserves expansion; closing the final tab closes the panel and clears expansion. The normal panel toggle is unavailable only while expanded and returns after restoration.
6. The ordinary mobile file panel already uses the full layout width at `640px` and below. Hide the no-op expand control in normal mobile layout and clear desktop expanded state when crossing into the mobile breakpoint, leaving current mobile open/close behavior as the sole full-width mode and preventing an unreachable restore state after viewport resizing.
7. Keep Markdown changes scoped to the Explorer preview in `FileViewer`; do not change chat `MarkdownBody`. Center ordinary top-level paragraphs, headings, lists, quotations, and similar reading blocks at `width: min(100%, 1000px)`. Let top-level fenced code, GFM table wrappers, and standalone media blocks use the full padded preview width. Nested or mixed inline media remains within its reading block.
8. Extend the file preview's `ReactMarkdown` component map only where explicit hooks are needed: wrap GFM tables in a file-preview overflow container and mark media for proportional `max-width: 100%`/`height: auto` behavior. Use file-scoped selectors or wrappers for standalone-media breakout; do not rely on changes to generic `.markdown-body` behavior. Keep inner horizontal scrolling for genuinely wide code and tables and prevent document-level horizontal overflow.
9. Factor the existing Markdown preview JSX into a small pure file-preview component if needed to cover link handling and new table/media markup with the repository's existing Node/Jiti server-rendering test pattern. Do not add a DOM test framework or dependency solely for this feature.
10. Provide restoration only through the visible restore button. Do not add an Escape listener, do not modify `useGlobalKeyboardShortcuts`, and do not claim Escape is globally unused: current source contains context-dependent Escape-to-stop and local cancel/menu behaviors, which remain outside this feature.

**Rough scope estimate:**

- **Surfaces:** `components/AppShell.tsx`, `components/FileViewer.tsx`, `app/globals.css`, and focused component/browser validation. `components/TabBar.tsx` supplies visual conventions but need not change; `components/MarkdownBody.tsx` and `hooks/useKeyboardShortcuts.ts` remain unchanged.
- **Testability:** moderate-to-high for pure Markdown preview markup and static invariants; moderate for shell state, viewport geometry, pointer interaction, and mounted-state preservation, which require the project's established privacy-safe browser validation plus user testing.
- **Implementation complexity:** moderate. Panel expansion is a small shared-state/CSS change; selective Markdown width and representative all-file lifecycle validation add bounded complexity. No scope creep is presently indicated.

## Reference Files

- [`components/AppShell.tsx`](../../components/AppShell.tsx) — owns the shell, file tabs, panel lifecycle, generic tab chrome, and fixed panel toggle.
- [`components/FileViewer.tsx`](../../components/FileViewer.tsx) — dispatches every file type and contains the Explorer Markdown preview.
- [`components/TabBar.tsx`](../../components/TabBar.tsx) — establishes nearby icon-button size, hover, label, and decorative-SVG conventions.
- [`app/globals.css`](../../app/globals.css) — defines file-panel desktop/mobile widths and file-preview Markdown styles.
- [`hooks/useIsMobile.ts`](../../hooks/useIsMobile.ts) — supplies the shared `640px` breakpoint state used to prevent redundant/trapped expansion on mobile.
- [`hooks/useKeyboardShortcuts.ts`](../../hooks/useKeyboardShortcuts.ts) — confirms the existing Escape behavior that this feature must leave unchanged.
- [`components/MarkdownBody.tsx`](../../components/MarkdownBody.tsx) — confirms chat Markdown is a separate renderer and supplies a proven table-wrapper pattern without becoming an implementation target.

## Constraints and Scope

### Fixed constraints

- “Full screen” means the web application's browser content viewport, not browser or operating-system full-screen mode. Do not use `requestFullscreen`, `exitFullscreen`, or related APIs.
- Expanded mode applies to all file types in the shared panel.
- The viewer's own tabs and file status/actions remain visible; surrounding application chrome does not.
- Expanded Markdown uses the approved hybrid layout with an exact `1000px` maximum for ordinary reading blocks and wider padded space for code, tables, and standalone media.
- Entry and restoration use the visible on-screen button only. No custom keyboard interaction or keyboard-specific acceptance requirement is added; ordinary native-button behavior is incidental. Existing Escape semantics are neither removed nor extended.
- Expanded state is temporary and browser-memory-local; it is not persisted.
- Preserve unrelated working-tree changes, add no dependency, and never run `next build` during development.

### In scope

- Shared expanded-state ownership and lifecycle.
- Accessible expand/restore viewer control.
- Full-page shell/panel geometry and mobile-breakpoint reconciliation.
- Explorer Markdown hybrid width, table overflow, and responsive media behavior.
- Focus, mounted-state, tab/file-type, responsive, and visual regression validation.

### Out of scope

- Draggable split resizing.
- Browser Fullscreen API or browser permission UI.
- Content zoom, font controls, or persisted display preferences.
- Consolidating Explorer Markdown with chat `MarkdownBody` or adding Mermaid/math behavior to the file preview.
- Changing or documenting global Escape behavior.
- Redesigning tabs, status bars, file renderers, sidebar, chat, or top bar.

### User-confirmed decisions

- **2026-07-29:** Expansion is panel-wide and available for all supported file types, not Markdown-only.
- **2026-07-29:** Markdown uses the hybrid policy: centered readable prose with code, tables, and media allowed to use more width. The recommended `1000px` prose maximum is accepted as part of that option.
- **2026-07-29:** Restoration is button-only. The feature will not integrate with Escape.
- **2026-07-29 clarification:** The requested interaction is an on-screen button that makes the viewer consume the web page. Custom keyboard operation, keyboard shortcuts, and focus-restoration behavior are not required; using a semantic native button remains the simplest UI implementation.

## Evidence / Current State

### Established facts

- `AppShell` stores `fileTabs`, `activeFileTabId`, and `rightPanelOpen`; opening files selects/creates tabs, and closing the final tab closes the panel.
- The shell is a horizontal `height: 100dvh` flex layout containing sidebar, center chat, and right file panel.
- Desktop CSS constrains an open panel to `42%` with a `300px` minimum and separately constrains direct panel children to `42vw` with the same minimum. Changing only the outer width cannot produce a full-width viewer.
- Mobile CSS already makes the open file panel `100%` wide. The mobile expansion control would therefore be redundant.
- The separate panel toggle is fixed at the top-right with `z-index: 300`; it would obscure or conflict with expanded viewer chrome unless suppressed.
- `FileViewer` dispatches images, audio, PDF/DOCX, and text; text mode includes source, diff, HTML preview, and Markdown Preview/Raw.
- Explorer Markdown uses a direct `ReactMarkdown` instance with `markdown-body markdown-file-preview`, fixed `24px 32px` padding, no prose maximum, and only a custom anchor renderer. It does not use chat `MarkdownBody` and therefore does not inherit its table wrapper, syntax highlighting, math, or Mermaid behavior.
- Current source implements Escape-to-stop only while an agent is running: `ChatWindow` registers an abort callback, the global hook invokes it outside inputs, and `ChatInput` closes slash/`@` menus first and otherwise aborts a streaming run. Other focused controls use Escape locally. Repository search found no discoverable shortcut hint, user-facing documentation, or focused test for Escape-to-stop.
- The user's observation that Escape appears inactive is plausible when no run is active or focus/context consumes it, but source evidence does not support treating Escape as globally unused. Button-only restoration leaves that behavior unchanged.
- Project memory contains no durable expanded-viewer decision. The repository has Node/Jiti tests but no committed browser/DOM harness; prior layout work successfully used privacy-safe Playwright validation from the development environment.

### Blocked facts

None. Runtime Escape usability was not exercised against a live agent because it is outside this feature and would cause a live abort; source evidence is sufficient to preserve the existing boundary.

## Test Strategy

### Focused automated/static coverage

- Add server-rendered Node/Jiti coverage for the pure Explorer Markdown preview surface: local-link markup remains in-app, external-link behavior remains unchanged, a GFM table receives the file-preview overflow wrapper, media receives responsive hooks, and ordinary/wide block classes do not leak into chat `MarkdownBody`.
- If no pure helper is introduced for expanded-state class composition, mark an isolated state-unit layer not applicable rather than extracting artificial helpers; validate the real public surface in-browser.
- Run focused tests and the full existing `components/*.test.mjs` and `lib/*.test.mjs` suites.
- Run `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`.
- Search final source to prove no Fullscreen API, persistence, `MarkdownBody`, or keyboard-shortcut changes.
- Do not run `next build`.

### Browser/public-surface coverage

Use privacy-safe synthetic files and an isolated development port:

- At desktop widths with sidebar open and closed, click expand and restore; compare shell/viewer bounds and screenshots, verify the viewer fills `100dvh`, and confirm hidden regions are not visible or pointer-interactive.
- Record bounded DOM identity/state—not file contents—to prove the existing `FileViewer` and chat remain mounted. Verify tabs, Markdown Preview/Raw/Diff, scroll where stable, and live-watch state do not reset merely because layout changes.
- While expanded, switch among synthetic Markdown, source/diff, image, audio, HTML, and PDF/DOCX fixtures where safe generation is available; expansion remains active. Close a non-final active tab, then the final tab, and verify the approved lifecycle.
- Validate Markdown paragraphs, headings, lists, task lists, quotations, links, long tokens, fenced code, wide GFM tables, and standalone/mixed images. On a sufficiently wide viewport, reading blocks are centered and at most `1000px`; wide blocks measurably gain space; images retain aspect ratio; code/tables use bounded inner overflow; the document has no horizontal overflow.
- Validate normal `42%` desktop geometry, `641px`, `640px`, representative mobile width, both themes, and desktop-to-mobile resizing. The normal mobile control is hidden, desktop expanded state clears at the mobile breakpoint, and resizing back does not restore stale expansion.
- Click the visible control in both directions and verify its icon, title, and accessible name change appropriately. Confirm the change adds no custom key handler or Escape listener and does not alter existing local/global keyboard source paths; keyboard activation and focus restoration are not acceptance gates.
- Confirm `document.fullscreenElement` remains null and no browser fullscreen permission UI appears.

## Telemetry / Debuggability

Production telemetry and persistent logging are not applicable for a synchronous, reversible local layout state. Diagnosability comes from one explicit React Boolean, deterministic shell/panel classes or data attributes, the control's accessible state, and privacy-safe browser geometry. Do not log or retain file contents, Markdown source, paths, session identifiers, media bytes, or provider payloads.

## Validation Contract

1. **VC-001 — P0, full-page layout and control.** Clicking the generic viewer control expands the existing panel to the application's complete `100dvh` viewport and clicking restore returns the normal split layout without browser Fullscreen API use. Surrounding app regions and the separate panel toggle are neither visible nor pointer-interactive while expanded; viewer tabs/status/actions and the restore control remain usable. Evidence: source scrutiny, computed geometry, pointer interaction, `document.fullscreenElement`, and privacy-safe screenshots in both themes. Validator mode: scrutiny and user-testing. No waiver for incomplete coverage, an unusable restore button, or browser-fullscreen use.
2. **VC-002 — P0, panel-wide lifecycle and mounted state.** Expansion applies to every file renderer, persists across tab and Preview/Raw/Diff switches, does not remount the viewer or chat, survives non-final tab closure, and clears on final-tab closure or transition to mobile. Evidence: bounded DOM-identity/state observations and browser interactions across representative safe fixtures. Validator mode: scrutiny and user-testing. A specialized DOCX/audio fixture may be individually blocked with rationale, but panel-wide behavior, Markdown, source, image, tab closure, and mounted-state preservation cannot be waived.
3. **VC-003 — P0, hybrid Markdown responsiveness.** Explorer Markdown—not chat Markdown—centers ordinary reading blocks at no more than `1000px` while code, wrapped tables, and standalone media can use the wider padded preview; media stays proportional, wide content remains accessible through inner scrolling, and neither normal nor expanded layout creates document-level overflow. Evidence: focused markup tests plus representative browser geometry and visual checks at normal, expanded, threshold, and mobile widths. Validator mode: scrutiny and user-testing. Prose, code, table, image, and long-token evidence are required.
4. **VC-004 — P1, visible control, responsive behavior, and keyboard boundary.** The on-screen native button has the correct outward/inward icon, title, and accessible name for its current mode; current mobile full-width behavior remains coherent; no custom key handling, Escape handling, or keyboard-hook change is introduced. Evidence: markup/source review and desktop/mobile pointer checks. Validator mode: scrutiny and user-testing. No waiver for a missing/ambiguous restore button or mobile trapping; keyboard activation/focus restoration and Escape-to-restore are explicitly not required by user decision.
5. **VC-005 — P1, repository health and privacy.** Focused/full Node tests, TypeScript, lint, and diff checks pass; no new dependency, persistence, unrelated renderer consolidation, content-bearing telemetry, or browser Fullscreen API is added; `next build` is not run. Evidence: final command output, diff/status review, and targeted source search. Validator mode: scrutiny. Changed-surface failures block completion; unrelated pre-existing failures must be isolated and reported.

## Assumptions, Risks, and Blockers

### Assumptions

- The viewer's tabs and file-specific status/actions are part of the focused viewer and remain visible.
- CSS-hidden sidebar/chat trees continue their React effects while being removed from layout; browser evidence must confirm no remount or pointer leakage.
- `1000px` is a generous readable maximum that materially widens common desktop Markdown without creating ultrawide prose lines.

### Risks

- Failing to override direct-child `42vw` leaves content visually constrained despite a full-width panel.
- Selective wide-block hooks must handle nested and mixed Markdown without accidentally widening every image-containing paragraph or affecting chat Markdown.
- Hiding the center pane incorrectly could interrupt or remount live chat UI; preserve the mounted subtree and validate identity/state.
- Because restoration is button-only, pressing Escape during an active hidden agent run may still trigger Pi Web's existing abort path rather than restore the viewer. This is an accepted consequence of leaving Escape unchanged, not evidence that Escape is globally inert.
- Desktop-to-mobile resizing can strand expanded state unless it is cleared when the shared breakpoint changes.
- A separate responsive-Mermaid implementation may also touch `app/globals.css`; implementation must start from current integrated main or coordinate rather than overwrite concurrent CSS work.

### Blockers

None. All material in-scope product decisions are resolved.

## Implementation Handoff

Approved plan path: `.agents/plans/2026-07-29-expand-markdown-viewer.md`

Approval does not itself commit the plan or begin implementation. Start implementation only through the explicit handoff command:

```text
/start-implementation .agents/plans/2026-07-29-expand-markdown-viewer.md
```
