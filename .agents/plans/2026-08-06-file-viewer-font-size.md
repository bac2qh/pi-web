# File Viewer Font Size Control

Status: approved
Date: 2026-08-06
Approved by user: 2026-08-06

## Objective

Add an accessible base-font-size control for file content, using the existing browser-local display-preference system without changing font families, relative typography hierarchy, file loading/live-watch behavior, or normal/expanded viewer layout.

Success means the control displays a base file-content size and each `−`/`+` action moves the complete content hierarchy up or down proportionally—including Markdown headings, body text, and code at their existing relative sizes—while the independently selected value survives reload without changing Transcript or Menu, preserves today’s appearance at its default, and appears as a fourth group in the existing Display settings. File tabs, status, and controls continue to follow Menu.

## Design / Implementation Strategy

1. Extend the existing display-preference model rather than adding per-tab state, session/project settings, a server API, or a second persistence mechanism. Add `fileViewerFontSize`, `FILE_VIEWER_FONT_SPEC`, `setFileViewerFontSize`, and the guarded `pi-file-viewer-font-size` storage key through the same defaults, parsing, provider, and update paths as Transcript/Menu.
2. Publish `--pi-file-viewer-font-size` and `--pi-file-viewer-font-scale` from the root, with a `14px` default and scale `fileViewerFontSize / 14`; add a `scaledFileViewerFontSize(basePixels)` helper for fixed local baselines. At the default, preserve the existing hierarchy—approximately `13px` for source/diff content and fenced Markdown code, `14px` for rendered Markdown prose, `11px` for subordinate diff/line-number text, and relative `em` sizes for Markdown headings—rather than flattening every viewer string to one value.
3. Apply the exact base variable at the Explorer Markdown root so relative headings and inline content inherit naturally. Route fixed Markdown table/fenced-code baselines, syntax-highlighter source/raw content and line numbers, and diff body/prefix/line-number/collapsed-region styles through the scale helper. Keep file tabs, status bars, Preview/Raw/Diff/wrap/download controls, loading, and errors on Menu only so the two scales never multiply.
4. Treat non-text media as having no font size to alter. Per user decision, leave HTML Preview and PDF/DOCX iframe internals at their renderer-owned sizing; do not inject styles or add whole-document zoom. Raw HTML source remains ordinary source content and follows File Viewer.
5. Add File Viewer as the fourth group in the established global Display controls, in both the wide inline controls and the narrow/mobile Display panel. Match the established font-control interaction: show an editable numeric base size bounded to `10–32px` plus 1px `−` and `+` actions, immediate valid updates, and guarded commit/revert behavior. Do not duplicate the control in viewer-local tab or status chrome. Desktop expansion deliberately hides the center pane containing Display settings, so the selected value continues to apply while expanded but changing it requires restoring the split layout first.
6. Preserve file switching, Preview/Raw/Diff state, word wrapping, live synchronization, download behavior, expanded-state lifecycle, Markdown reading-width rules, and horizontal overflow access at minimum and maximum sizes.
7. Extend focused preference/component coverage and validate real computed typography and overflow in normal, narrow/mobile, and expanded viewer layouts. Do not run `next build`.

**Rough scope estimate:**

- **Surfaces:** `lib/display-preferences.ts`, `hooks/useDisplayPreferences.tsx`, `components/DisplayControls.tsx`, `components/FileViewer.tsx`, Explorer Markdown rules in `app/globals.css`, focused preference/viewer tests, and browser validation. No server route, file protocol, or renderer dependency should change.
- **Testability:** high for scale normalization/CSS-variable generation and source/component invariants; moderate for computed proportional typography, embedded-renderer boundaries, control access, line wrapping, and overflow, which require browser checks.
- **Implementation difficulty:** moderate. The scaling itself is bounded, but preserving per-surface hierarchy and fitting a fourth responsive Display group at font-size extremes need deliberate treatment.

## Reference Files

- [`components/FileViewer.tsx`](../../components/FileViewer.tsx) — dispatches file types and owns source, diff, Markdown/HTML modes, status controls, and fixed content sizes.
- [`components/MarkdownFilePreview.tsx`](../../components/MarkdownFilePreview.tsx) — owns Explorer Markdown markup separately from chat Markdown.
- [`components/DisplayControls.tsx`](../../components/DisplayControls.tsx) — provides the existing responsive Display groups and bounded step-button conventions to adapt for relative Viewer scaling.
- [`hooks/useDisplayPreferences.tsx`](../../hooks/useDisplayPreferences.tsx) — owns browser-local preference loading, updates, storage, and CSS-variable publication.
- [`lib/display-preferences.ts`](../../lib/display-preferences.ts) — defines numeric preference specifications, defaults, storage keys, and scaling helpers.
- [`app/globals.css`](../../app/globals.css) — defines display-control responsiveness, Explorer Markdown typography, and expanded-viewer shell behavior.
- [`components/AppShell.tsx`](../../components/AppShell.tsx) — places global Display controls and hides the center pane during expanded viewer mode.
- [`lib/display-preferences.test.mjs`](../../lib/display-preferences.test.mjs) — focused pure tests for preference behavior and CSS output.
- [`components/FileViewer.test.mjs`](../../components/FileViewer.test.mjs) — mounted viewer regression coverage across source, diff, Markdown, HTML, documents, media, and live watches.
- [`components/MarkdownFilePreview.test.mjs`](../../components/MarkdownFilePreview.test.mjs) — Explorer Markdown isolation and markup coverage.
- [`archive/2026-07-21-wider-chat-column.md`](archive/2026-07-21-wider-chat-column.md) — approved origin of Width/Transcript/Menu controls and the prior explicit opened-file-content exclusion this follow-up revises.
- [`../checkpoints/2026-07-21-wider-chat-column-checkpoints.md`](../checkpoints/2026-07-21-wider-chat-column-checkpoints.md) — accepted computed-style evidence that Transcript and Menu values scale different typography baselines rather than flattening them.
- [`2026-07-29-expand-markdown-viewer.md`](2026-07-29-expand-markdown-viewer.md) — approved expanded-viewer and Explorer Markdown layout contract.

## Constraints, Decisions, and Current State

- The previous display-control plan explicitly required: “Menu covers all application chrome but excludes opened file/document content.” This follow-up adds a dedicated content preference and must not make Menu resize file content.
- **User decisions, 2026-08-06 — preference and control:** File Viewer is independent and browser-local, exposed as a fourth group in both existing Display-settings presentations with no viewer-local duplicate. It has an editable numeric base, `−`/`+`, a `14px` default, `10–32px` inclusive range, and 1px steps.
- **User decisions, 2026-08-06 — scaling semantics:** the displayed value is a base, not a universal assignment. Markdown headings/body/code, source/diff text and metadata, and other Pi-rendered file-content typography retain their existing relative hierarchy and scale together.
- **User decisions, 2026-08-06 — ownership boundary:** File Viewer owns displayed file content only. Tabs, path/language/line/live status, Preview/Raw/Diff/wrap/download controls, loading, and errors remain governed by Menu. HTML Preview and PDF/DOCX retain renderer-owned sizing with no whole-preview zoom or content/style injection; raw HTML source still scales.
- Transcript is currently chat-specific (`16px`, range `10–32px`); Menu is chrome-specific (`14px`, range `10–24px`). Both are independent, bounded, browser-local numeric values with guarded `localStorage` access.
- Verified current behavior: the displayed Transcript and Menu numbers are bases, not universal assignments.
  - Transcript `16px` sets ordinary chat Markdown/composer/code/table content to the base. Markdown headings remain relative (`h1: 1.16em`, `h2: 1.08em`, `h3: 0.98em`), so at the default they compute to approximately `18.56px`, `17.28px`, and `15.68px`; KaTeX uses `1.05em`, while compact transcript details retain separate `12px`/`11px` baselines multiplied by the same Transcript scale.
  - Menu `14px` sets the root UI base, while `scaledMenuFontSize(base)` multiplies each local baseline by `menuFontSize / 14`. For example, at Menu `20`, existing `11px`, `12px`, and `18px` roles compute to approximately `15.71px`, `17.14px`, and `25.71px`, preserving hierarchy rather than turning them all into `20px`.
  - The accepted prior browser pass likewise measured Transcript message/composer/code moving `16→22` together and distinct Menu roles moving proportionally at `14→24` (for example Explorer `11→18.86` and a modal heading `15→25.71`).
- This follow-up therefore preserves and regression-checks the existing base-plus-scale architecture; it does not redesign Transcript or Menu unless validation finds a concrete contradiction to the verified model.
- Current file content has intentionally distinct defaults: syntax-highlighted source and diff text use `13px`, diff subordinate text and line numbers use `11px`, Explorer Markdown prose inherits `14px`, and its fenced code uses `13px`.
- Viewer chrome already follows Menu through `scaledMenuFontSize`; the new behavior should not double-scale it.
- Desktop expanded mode removes the sidebar and center pane—including the existing global Display controls—from layout and pointer interaction while keeping the right-panel viewer mounted.
- Explorer Markdown is separate from chat `MarkdownBody`; changes must remain file-preview-scoped.
- The project memory index has no applicable file-viewer font-size decision, and no maintained `wiki/` surface exists for this behavior.
- No dependency, font-family selector, server-synchronized setting, file-content telemetry, or file-renderer redesign is in scope.

## Test Strategy

- Extend `lib/display-preferences.test.mjs` for the `14px` Viewer default, `10–32px` range, malformed and missing storage values, clamping, 1px stepping, CSS-variable output, and preservation of the existing Width/Transcript/Menu base-plus-scale contract.
- Add focused component/source assertions that source, diff, and the complete Explorer Markdown hierarchy consume one derived viewer-content scale without flattening their default size ratios, while tabs/status/controls continue to consume Menu only.
- Preserve the existing `FileViewer` lifecycle suite, especially Preview/Raw/Diff switching, word wrap, live updates, path/session replacement, documents/media, downloads, and mounted-state behavior.
- Run `node --test components/*.test.mjs lib/*.test.mjs`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`; do not run `next build`.
- In a privacy-safe development browser, verify default, intermediate, minimum, maximum, independent reload persistence, direct numeric input and keyboard/control bounds, normal split view, automatic narrow expansion, manual desktop expansion, both themes, source/raw, diff, and representative Markdown prose/code/table content.
- Compare computed font-size ratios and font families, confirm default-base geometry is unchanged, verify every step changes representative content monotonically while viewer chrome remains tied only to Menu, and recheck representative Transcript/Menu ratios to prove the new preference does not flatten or cross-couple existing domains. Ensure long lines/tables retain inner scrolling or wrapping as designed and prove no document-level horizontal overflow or clipped controls at the extremes.

## Telemetry / Debuggability

Production telemetry is not applicable for a synchronous browser-local presentation preference. Diagnosability should remain bounded to the visible base-size control/state, the bounded numeric `localStorage` representation, the derived root CSS scale, and computed styles. Do not log file paths, file contents, Markdown/HTML source, session identifiers, media bytes, or raw storage payloads.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | File Viewer is an independently persisted bounded base-font-size preference with a `14px` default, `10–32px` range, 1px step, and numeric-input commit/revert behavior; it derives one proportional content scale and does not alter existing Width/Transcript/Menu values. | Pure preference tests plus browser direct-input/control/CSS/storage checks. | Stop; input, persistence, migration, hierarchy-flattening, or cross-domain coupling failures block completion. |
| VC-002 | At the default base, every covered content surface matches current computed sizes and font families; each `−`/`+` step changes the whole content hierarchy proportionally while preserving Markdown heading/body/code and source/diff metadata ratios. | Computed-size and ratio comparisons at default, smaller, and larger values across source/raw, diff, and representative Markdown prose/headings/code/table fixtures. | Stop and correct missing, double-scaled, flattened, non-monotonic, or leaked typography before closeout. |
| VC-003 | All Pi-Web-rendered file-content typography follows one derived scale; tabs, status, controls, loading, and errors continue to follow Menu only; HTML Preview/PDF/DOCX sizing remains renderer-owned; non-text media remain undistorted. | Source scrutiny and representative browser checks across content/chrome plus text, Markdown, HTML Preview, PDF/DOCX, image, and audio modes. | Stop if Viewer and Menu multiply, an approved Pi-rendered content surface remains fixed, media is distorted, or authored/opaque content is rewritten or zoomed. |
| VC-004 | File Viewer appears as a fourth editable base-size group with `−`/`+` in both existing Display-settings presentations and is keyboard-operable, visibly focused, correctly named, safely bounded, and unclipped at responsive/size extremes. Its selected value remains applied in expanded mode; restoring the split layout makes the global control available again. | ARIA/keyboard/direct-input inspection, computed control state, normal/narrow geometry, restore-and-adjust interaction, expanded computed typography, and privacy-safe screenshots. | Stop for unsafe input behavior, an inaccessible or overflowing control, lost expanded-mode value, or failure to regain the control after restore. |
| VC-005 | File loading, live watch, switching, Preview/Raw/Diff, wrap, download, expansion, and horizontal-scroll behavior remain coherent at font-size extremes. | Existing component suite plus browser interaction/regression checks with safe synthetic files. | Stop for changed-surface regressions; isolate and report unrelated pre-existing failures. |
| VC-006 | Focused/full Node tests, TypeScript, lint, and diff checks pass with no new dependency, server API, shared setting, telemetry, or `next build`. | Command output, final diff/status review, and targeted source search. | Fail closed; do not waive changed-surface failures. |

## Assumptions, Risks, and Blockers

### Assumptions

- “File viewer font size” means a displayed base content size plus proportional scaling of the content hierarchy rather than one exact assignment to every element; viewer chrome remains under Menu.
- Preserving today’s default visual hierarchy is required rather than forcing prose, source, diff metadata, line numbers, and Markdown headings to one identical value.
- Browser-local independent persistence should use the existing Display preference architecture and storage-failure behavior.

### Risks

- The user-selected global-only placement means changing File Viewer size while expanded requires restoring first; the applied value must not reset during expansion/restoration.
- A fourth inline group can crowd the top bar near the current `1000px` presentation threshold, especially at the maximum Menu size; validation must catch clipping or overflow without silently dropping the new control.
- Viewer chrome must remain on Menu only; an overly broad inherited Viewer variable could accidentally double-scale or capture status/control text.
- `react-syntax-highlighter` uses inline styles; source text and line-number scaling must be routed explicitly rather than relying only on inherited CSS.
- Explorer Markdown inherits the generic `.markdown-body` base but overrides headings and fenced code; selector order must establish one File Viewer base without leaking into chat Markdown or double-scaling nested `em` rules.
- Large sizes can expose fixed-height status/control clipping, excessive line-number gutters, wrap regressions, or inaccessible horizontal overflow.
- Trying to style HTML/PDF/DOCX iframe internals would cross sandbox/origin/author-style boundaries and materially expand scope.

### Blockers

None.

## Implementation Handoff

When approved, use:

```text
/start-implementation .agents/plans/2026-08-06-file-viewer-font-size.md
```
