# Wider Chat Column

> **Closeout note — 2026-07-22**
> - **Final status:** implementation complete and accepted by the user; standard local closeout authorized.
> - **Related checkpoint:** `.agents/checkpoints/2026-07-21-wider-chat-column-checkpoints.md`.
> - **Implementation commits:** `eb80c3d` (responsive column), `96c4ebe` (preference core), `59f4698` (live controls/typography/Mermaid), and `51bc2fc` (`Width | T | UI` refinement). Supporting plan/checkpoint commits are recorded in the checkpoint.
> - **Merge:** local `main` fast-forwarded from `c23c2e5` to closeout-preparation commit `7e62c62`; no merge commit was created. Final cleanup evidence is recorded in the checkpoint.
> - **Verification:** 84 Node tests, TypeScript, lint, `git diff --check`, and seven privacy-safe Playwright scenarios passed with zero browser error events; the user accepted the resulting behavior.
> - **Cleanup:** completed under the standard short-lived policy (`pi-long-lived` unset): task worktree removed, local task branch deleted, task runtime artifacts removed, and unrelated local state preserved.
> - **Shipped summary:** responsive browser-local Width, Transcript, and Menu controls; full safe width on narrow panes; proportional chrome scaling with file-content exclusion; and natural-size Mermaid re-rendering with horizontal overflow access.

Status: approved
Date: 2026-07-21
Approved by user: 2026-07-21
Scope amended and approved by user: 2026-07-21

## Approved Scope Amendment — Live Display Controls

### Authority and Supersession

During user testing, the user approved the responsive geometry and then explicitly expanded the active implementation scope through one-at-a-time decisions. This amendment is approved and is the current source of truth wherever it conflicts with the original plan below.

It supersedes these original directions:

- The wide-pane default changes from 90% to 70%.
- The fixed-default/no-preference decision is reversed: Pi Web now exposes browser-local live display preferences.
- Configuration is no longer entirely not applicable; browser-local numeric presentation preferences are in scope.
- The original “no React preference state” implementation direction is replaced by the state/context design below.

All non-conflicting original requirements remain: width is measured from the actual center pane, panes at or below 1000 CSS pixels use full safe width, no fixed upper width cap exists, side-panel behavior is unchanged, and existing safe padding/minimap alignment remains.

### Amended Objective and Success Criteria

Add compact top-bar display controls that update layout and typography immediately without reloading or restarting a session:

- **Width:** defaults to 70%, persists browser-locally, changes in 5-point steps from 50% through 100%, and resets to 70% when its displayed percentage is clicked.
- The saved Width percentage applies only when the actual center pane is wider than 1000 CSS pixels. At 1000px or below, chat remains full safe width while the saved wide-pane value remains editable for later.
- **Transcript:** defaults to 16px, persists independently, changes in 1px steps, accepts direct numeric input from 10px through 32px, and applies to conversation content, composer text, code, tables, custom/compaction content, and Mermaid rendering without changing font family.
- Mermaid re-renders with the selected Transcript font size so labels, node geometry, and spacing grow naturally; it is not stretched merely to fill available width, and wide diagrams retain horizontal scrolling.
- **Menu:** defaults to 14px, persists independently, changes in 1px steps, and accepts direct numeric input from 10px through 24px.
- Menu size proportionally scales existing application-chrome typography so headings, ordinary labels, and metadata retain their hierarchy. It covers sidebar, Explorer, session rows, top bar, tabs, dropdowns, and modal controls, but not opened file/source/document contents.
- Valid typed font values apply immediately. Out-of-range values clamp on commit; empty/invalid drafts revert on blur or Enter.
- When the actual center pane is wider than 1000px, Width, Transcript, and Menu controls appear as compact inline top-bar groups. At 1000px or below, including mobile, they collapse into one Display button and popover.
- Controls are keyboard operable, accessibly named, visibly focused, and disable decrement/increment actions at their bounds.

### Amendment Decision Ledger

| ID | Decision | Authority / rationale | Consequences |
|---|---|---|---|
| A-001 | Width is live, browser-local, default 70%, range 50–100%, step 5. | User decisions during 2026-07-21 user testing. | Requires preference state, persistence, control UI, parsing, and changed CSS variable defaults. |
| A-002 | Clicking the displayed Width percentage resets it to 70%. | User decision. | The percentage is an accessible reset button rather than a numeric input. |
| A-003 | Center panes at or below 1000px always use full safe width. | User reaffirmed the original narrow behavior. | Saved Width remains visible/editable but does not reduce scarce narrow-pane space. |
| A-004 | Transcript is independent, browser-local, default 16px, range 10–32px, step/input 1px. | User decision; examples included 17px and 22px. | Conversation typography and composer must react immediately and persist without changing font family. |
| A-005 | Transcript includes code and Mermaid. | User explicitly distinguished size from font type and reported Mermaid diagrams as too small. | Markdown code uses the transcript size; Mermaid configuration includes the selected numeric font size and re-renders when it changes. |
| A-006 | Menu is independent, browser-local, default 14px, range 10–24px, step/input 1px. | User decision. | Chrome typography needs a proportional scale variable derived from the 14px baseline. |
| A-007 | Menu covers all application chrome but excludes opened file/document content. | User confirmation. | Sidebar/topbar/tabs/dropdowns/modals scale; source and document preview typography does not. |
| A-008 | Menu preserves hierarchy through proportional scaling. | User confirmation. | Existing relative differences among headings, labels, and metadata must remain rather than flattening all text to one size. |
| A-009 | Wide panes show inline controls; narrow/mobile panes show one Display popover. | User confirmation. | Top bar requires actual-center-pane containment and responsive control presentation. |

### Amendment Design / Implementation Strategy

1. Add pure preference definitions and validators in `lib/display-preferences.ts`: defaults, storage keys, bounds, step/clamp helpers, and safe parsing for missing/malformed browser values.
2. Add a client `DisplayPreferencesProvider`/hook that owns Width, Transcript, and Menu values, loads them after hydration, persists only bounded numeric values in `localStorage`, and exposes immediate update/reset actions. Preferences contain no session IDs, paths, message text, or server state.
3. Publish CSS custom properties from the provider on the document root: the width percentage, exact transcript size, transcript scale where compact transcript metadata needs proportional sizing, exact menu size, and menu scale relative to the 14px baseline.
4. Replace the hard-coded 90% wide rule with a variable calculation while retaining the existing named chat container and 1000px full-width container query.
5. Add a reusable `DisplayControls` component with accessible bounded steppers, a width reset button, and draft-aware numeric font inputs. Extend AppShell’s single-active-top-panel model with a Display panel.
6. Mark the AppShell center pane as a named inline-size container. CSS shows compact inline controls above 1000px and a single Display popover trigger at or below 1000px, without relying only on whole-viewport media queries.
7. Route transcript surfaces through transcript variables: Markdown body, user/assistant/custom/compaction content, composer textarea, code/table content, and in-conversation tool/process output. Keep font families unchanged. Compact metadata may scale proportionally instead of becoming the exact base size.
8. Include Transcript size in Mermaid’s render key and `mermaid.initialize({ fontSize })` configuration. Let Mermaid re-layout at the new size; do not apply width stretching or image-like transform scaling.
9. Route application-chrome font sizes through a shared proportional menu-size helper/variable across AppShell, sidebar/Explorer, tabs, branch/top panels, chat controls/dropdowns, configuration modals, and file-viewer chrome. Deliberately leave opened file/source/document renderer content unchanged.
10. Preserve all existing session, model, sidebar, file-panel, minimap, and message behavior. Do not add server APIs, shared settings files, font-family controls, or content telemetry.

### Amendment Test Strategy

- Add isolated Node tests for preference parsing, defaulting, clamping, stepping, malformed storage values, and width reset semantics.
- Add isolated coverage for the Mermaid configuration/render-key helper so Transcript size is represented without changing font family or enabling width stretching.
- Keep the existing full Node suite, TypeScript check, lint, and `git diff --check` as static gates; do not run `next build`.
- Extend Playwright geometry validation to prove default 70%, live 5-point Width changes, reset, persistence after reload, and unchanged full-safe-width behavior at/below 1000px.
- Exercise Transcript minus/plus and typed values (including 17 and 22), persistence, invalid/empty/out-of-range commit behavior, code/message/composer computed sizes, and Mermaid re-render evidence on an available diagram or a focused render fixture.
- Exercise Menu minus/plus and typed values at default/min/max; compare representative heading/label/metadata ratios before and after scaling; prove opened file content computed font size is unchanged.
- Validate wide inline controls and narrow/mobile Display popover, keyboard/focus/ARIA behavior, disabled bounds, top-bar fit, modal/sidebar usability, and absence of horizontal overflow at extreme values.
- Repeat privacy-safe 1440, 1920-or-wider, threshold, both-panel, existing-session, and 390×844 scenarios. User confirmation is required on the normal 4K/MacBook setup, including one Mermaid-heavy conversation if available.

### Amendment Telemetry / Debuggability

Telemetry changes remain **not applicable**: all behavior is synchronous browser presentation state. Safe diagnostics are the three bounded numeric localStorage values, visible control values, computed CSS custom properties, and browser geometry. Do not log message text, Mermaid source, file contents, session identifiers, or raw storage payloads.

### Amendment Validation Contract

These assertions extend the original contract; where they conflict, these take precedence.

| ID | Priority | Type / surface | Required truth | Required evidence | Validator mode | Blocker / waiver path |
|---|---|---|---|---|---|---|
| A-VC-001 | P0 | UI/configuration | Fresh browser state uses Width 70%, Transcript 16px, and Menu 14px; each valid change applies immediately and survives reload independently. | Pure parser tests plus Playwright control/CSS/localStorage evidence using only bounded numeric values. | scrutiny + user-testing | No waiver; persistence or default failures block closeout. |
| A-VC-002 | P0 | UI/responsive width | Width changes by 5 within 50–100, displayed percentage resets to 70, wide geometry follows the selected percentage, and center panes ≤1000px remain full safe width. | Computed geometry at multiple values and pane states, boundary/control assertions, reset and reload checks. | scrutiny + user-testing | No waiver; blocked browser evidence requires user-run validation before closeout. |
| A-VC-003 | P0 | UI/transcript | Transcript changes by 1 within 10–32; typed valid values apply immediately; message, composer, table, and code typography follow it without font-family changes. | Helper tests plus computed styles at defaults, 17px, 22px, min, and max. | scrutiny + user-testing | Any unavailable specialized message surface may be blocked individually with source evidence; core message/composer/code cannot be waived. |
| A-VC-004 | P0 | UI/Mermaid | Mermaid re-renders with the selected Transcript font size, increasing labels/node layout naturally without forced width stretching and preserving overflow access. | Config/render-key unit evidence plus browser visual/computed SVG evidence on a focused fixture or real redacted diagram. | scrutiny + user-testing | If no safe diagram fixture can run, record the blocker and require user validation on a Mermaid session before closeout. |
| A-VC-005 | P0 | UI/menu | Menu changes by 1 within 10–24 and proportionally scales representative chrome hierarchy while opened file/source/document content remains unchanged. | Computed-style ratios across sidebar, Explorer, top bar, tabs, dropdown/modal controls, and a file preview at default/min/max. | scrutiny + user-testing | No waiver for core sidebar/topbar or file-content exclusion; optional modal evidence may be individually blocked with rationale. |
| A-VC-006 | P1 | UI/accessibility/responsive controls | Wide panes show keyboard-operable inline controls; ≤1000px/mobile shows one Display popover; inputs, reset, bounds, focus, and disabled states are accessible and do not overflow. | Playwright keyboard/pointer/mobile checks, ARIA inspection, screenshots, and horizontal-overflow assertions. | scrutiny + user-testing | No waiver for keyboard names/bounds or mobile access. |
| A-VC-007 | P1 | Static/regression | Preference helpers are covered; existing Node tests, TypeScript, lint, and diff checks pass; no server API, shared config, font-family, or unrelated file-content styling is added. | Test/check command output and diff/source scrutiny. | scrutiny | No waiver; failures block closeout. |
| A-VC-008 | P1 | Execution state | Checkpoint records the scope reversal, decisions, backtracks, implementation commits, privacy-safe artifacts, user results, and closeout evidence. | Completed checkpoint review. | scrutiny | No waiver. |

### Amendment Risks and Residual Validation

- Menu scaling touches broad chrome with many existing explicit pixel sizes; missing one can create visible inconsistency. Use a shared helper/variable and a source audit rather than isolated ad hoc values.
- A 24px Menu maximum can expose fixed-height clipping. Test key rows, top bar, dropdowns, and modals at the maximum and adjust only necessary minimum heights/overflow without scaling file content.
- A 32px Transcript maximum can increase wrapping, lazy-load heights, minimap positions, code overflow, and Mermaid dimensions. Validate scroll/reconciliation and horizontal access at extremes.
- Inline controls may compete with session stats near the 1000px threshold. Validate top-bar fit during sidebar/file-panel animation; the Display popover remains the narrow fallback.
- LocalStorage can be missing, unavailable, or malformed. Fail safely to defaults without throwing or writing content-bearing diagnostics.
- Mermaid is a global renderer; include size in the render key/config dependency so stale diagrams do not survive preference changes.

## Objective

Provide responsive, live, browser-local display controls for chat width, transcript typography, and application-chrome typography while preserving full safe width on narrow panes, aligned chat surfaces, font-family choices, file-content sizing, and existing panel behavior.

## Success Criteria

- On center panes wider than 1000px, conversation/composer width follows the saved 50–100% setting and defaults to 70%; at 1000px or below it remains full safe width.
- Width, Transcript, and Menu controls update immediately, persist independently, enforce their approved bounds, and remain accessible inline or through the responsive Display popover.
- Transcript defaults to 16px and consistently controls conversation/composer/code/table/Mermaid sizing without changing font family or stretching diagrams.
- Menu defaults to 14px and proportionally scales application chrome while preserving hierarchy and leaving opened file/source/document content unchanged.
- Conversation, notices, extension UI, and composer remain horizontally aligned, with no fixed upper pixel cap on wide displays and no horizontal overflow at supported extremes.

## Evidence and Current State

### Established facts

- `components/ChatWindow.tsx` currently applies an `820px` maximum width to four aligned containers: the empty/new-session surface, floating notices, the conversation column, and extension widgets below the conversation.
- `components/ChatInput.tsx` independently repeats the same `820px` maximum width for the composer and its queued/retry/attachment surfaces.
- `components/AppShell.tsx` allows the center pane itself to grow, so the narrow appearance is caused by the inner chat-column cap rather than the overall application shell.
- `app/globals.css` fixes the desktop sidebar at `260px`; an open file panel takes `42%` of the shell width. Those panels independently reduce space available to the chat.
- Repository-wide searches found no chat-width/layout preference, settings control, CLI option, or documented configuration. The only browser-local preferences/state found are theme, completion sound, and unread-session IDs; none affect layout width.
- Existing component/configuration modals cover models, skills, and plugins, not presentation or layout preferences.
- Current automated tests use Node's built-in test runner, generally with Jiti for TypeScript helpers. There is no existing browser/DOM layout test harness.
- `hooks/useIsMobile.ts` and `app/globals.css` share a `640px` viewport breakpoint. On mobile, `ChatWindow` already hides the `36px` minimap and `ChatInput` already uses symmetric `16px` outer padding.
- CSS size container queries can evaluate descendant layout against an ancestor's actual inline size, so they respond when side panels change the center pane without requiring JavaScript resize state. MDN marks `@container` widely available across browsers since February 2023; Safari supports size queries from version 16. A base percentage rule and the existing mobile media behavior can remain a safe fallback for older browsers.
- CSS breakpoints and browser geometry use CSS pixels, not a display's physical panel pixels. A scaled 4K display can therefore report fewer than 3840 CSS pixels, but the rule depends only on the actual center-pane CSS width.
- No `.agents/memory/MEMORY.md` index or maintained `wiki/` pages are present in this checkout.

### Fixed constraints

- During the planning grill, only this plan could be mutated; implementation requires the separate handoff authorization recorded below.
- User decision: expose live browser-local Width, Transcript, and Menu controls under the approved amendment above.
- User requirement: default wide panes to 70% and allow Width from 50% through 100%; the center pane automatically grows when the sidebar closes and shrinks when the sidebar or file panel opens.
- User requirement: use the full available content width on mobile and whenever the center pane is 1000 CSS pixels or narrower, regardless of the saved wide-pane percentage.
- User requirement: keep width percentage-based without a fixed maximum width, so wide displays continue to gain usable chat space.
- User requirement: change only font size, preserve font families, and keep opened file/source/document content outside Menu scaling.
- Existing `16px` safe content padding remains on phone/narrow layouts; “full width” does not mean rendering controls flush against or beyond the viewport edge.
- Existing sidebar and file-panel behavior must not be confused with the conversation column's own width policy.
- User-visible layout changes require realistic desktop visual evidence; static checks alone are insufficient.
- Repository instructions prohibit `next build` during development; static validation uses `node_modules/.bin/tsc --noEmit` and `npm run lint`.

### Blocked facts

- None currently.

## Scope and Non-goals

### In scope

- Replace the hard-coded chat-column sizing policy consistently across conversation, composer, notice shelf, and extension widget containers.
- Make the sizing respond to actual center-pane width as the sidebar and file panel open or close.
- Preserve current safe padding and minimap alignment while changing only the inner column width policy.
- Add narrowly useful automated/static coverage and realistic browser geometry/visual validation.

### Non-goals

- Server-synchronized or project/session-scoped display settings; preferences remain browser-local.
- Changing sidebar width or show/hide behavior.
- Changing the file viewer's `42%` split.
- Redesigning message bubbles, typography, controls, or the minimap.
- Adding a general browser/DOM test framework solely for this CSS-scale change.
- Supporting obsolete browsers that lack container queries beyond a safe 90%-width fallback and the existing mobile behavior.

## Decision Ledger

| ID | Decision | Status | Rationale / authority | Consequences |
|---|---|---|---|---|
| D-001 | Initially use 90% on wide panes. | superseded by A-001 | This was implemented and user-tested before the approved live-control amendment. | Historical baseline only; current default is 70% and user-adjustable. |
| D-002 | Initially ship no user-configurable preference. | superseded by A-001 through A-009 | User reversed this decision after testing the responsive layout. | Browser-local Width, Transcript, and Menu preferences are now required. |
| D-003 | Measure width from the available center pane after optional side panels take their space, not from the entire browser viewport. | retained | User selected “the rest of the screen” after explicitly walking back literal whole-screen sizing. | The chat automatically responds to sidebar/file-panel changes without overlap. |
| D-004 | Do not retain a fixed upper pixel cap on ultrawide displays. | retained | Percentage-based sizing continues to use wide displays. | The 50–100% setting remains percentage-based. |
| D-005 | At `1000px` or below, use full safe width while retaining edge padding. | retained and reaffirmed by A-003 | User repeatedly required full phone/narrow layout. | Saved wide-pane percentage does not reduce narrow content space. |

## Closed and Deferred Branches

- **Closed:** Literal `90vw`/whole-browser sizing; it would ignore space already occupied by optional side panels and can overflow the center pane.
- **Superseded/reopened:** The original rejection of a user-configurable width setting was reversed by approved amendment A-001.
- **Closed:** A fixed ultrawide pixel cap; percentage-based use of wide displays takes priority.

## Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Chat column | UI layout | `components/ChatWindow.tsx` | Constrains conversation content, notices, extension widgets, and composer alignment. | Present for the lifetime of a rendered chat. |
| Center pane | UI layout and sizing reference | `components/AppShell.tsx` | Holds the top bar and `ChatWindow`; its current width is what remains after the optional left sidebar and right file panel take space. | Resizes as either side panel opens or closes. |
| File panel | UI layout | `components/AppShell.tsx`, `app/globals.css` | Displays opened files to the right of the chat. | Optional; `42%` wide on desktop when open. |

## Touched-Surface Classification

- `ui/frontend`: responsive desktop chat layout and composer alignment.
- `configuration`: browser-local numeric presentation preferences and malformed-value fallback; no server/shared configuration.
- `docs/current-state`: **not applicable**; README documents features/setup rather than detailed UI controls, and this repository has no maintained wiki.
- `telemetry/debuggability`: telemetry remains **not applicable**; visible bounded controls, CSS variables, storage values, and privacy-safe browser geometry are the diagnostic surfaces.

## Baseline Design / Implementation Strategy (completed before the amendment)

1. Establish one named inline-size containment context on the `ChatWindow` root (the center-pane chat surface), so descendant layout responds to the space remaining after sidebar/file-panel changes rather than only to the browser viewport.
2. Define one shared chat-column class in `app/globals.css`, with centered horizontal alignment and no fixed maximum pixel width:
   - default/fallback width: `90%`;
   - in container-query-capable browsers, wide mode targets `90cqi` (90% of the chat container's inline size) while respecting the descendant's available padded parent;
   - at a center-pane inline size of `1000px` or below, width becomes `100%` of the existing safe padded parent.
3. Apply that class to every in-scope aligned wrapper now capped at `820px`: empty/new-session content, floating notices, conversation/above-editor widgets, below-editor widgets, and the composer/queue/retry/attachment wrapper. Remove only those chat-related `820px` caps; unrelated `820px` modal sizing remains untouched.
4. Preserve existing outer padding: desktop content continues reserving space for the `36px` minimap, while mobile keeps symmetric `16px` safe padding and no minimap. Do not change message-bubble width rules.
5. Keep the layout deterministic and CSS-owned; do not add React resize state, persistence, settings, or telemetry solely for width calculation.
6. Use a safe progressive fallback: browsers without container-query support retain the base 90% rule, while the existing `640px` mobile behavior provides full-width phone layout.

## Baseline Test Strategy (amendment tests take precedence)

- **Isolated unit layer — waived:** the selected implementation is declarative CSS with no sizing helper or persisted state; a Node/Jiti unit test cannot evaluate container geometry, and adding a DOM/browser harness only for this change would not provide proportionate value.
- **Regression checks:** run the existing Node suite with `node --test components/*.test.mjs lib/*.test.mjs`.
- **Static checks:** run `node_modules/.bin/tsc --noEmit` and `npm run lint`. Do not run `next build`.
- **Source scrutiny:** search the two chat components to prove every in-scope `820px` cap was replaced by the shared class while unrelated modal/file-preview widths were not changed.
- **Wide public-surface browser check:** with an actual center pane above `1000px`, capture computed bounding boxes and a screenshot showing the conversation and composer at approximately 90% of center-pane width and aligned. Exercise sidebar open and closed on at least a 1440-CSS-pixel viewport and one 1920-or-wider CSS viewport representative of a scaled 4K display.
- **Threshold public-surface browser check:** exercise center-pane widths immediately above and at/below `1000px`; verify the former uses 90% and the latter fills the existing safe padded parent without page overflow. Opening both side panels on desktop should be included if it drives the pane below the threshold.
- **Mobile public-surface browser check:** at a representative phone viewport such as `390 × 844`, verify full safe content width, symmetric existing edge padding, hidden minimap, usable composer controls, and no horizontal overflow.
- **Alignment/regression check:** verify messages, notices, extension status/widgets, queued/retry/attachment surfaces, and composer share the same horizontal column in new, loaded, and actively streaming session states where those surfaces are available.
- **User-testing handoff:** the user should confirm the result on their normal 4K/MacBook browser setup because browser zoom/display scaling controls the real CSS-pixel viewport.

## Baseline Telemetry / Debuggability (superseded where persistence is discussed)

Telemetry changes are expected to be **not applicable**: the selected behavior is a deterministic client layout rule with no asynchronous operation, persisted preference, sensitive data, or ambiguous runtime failure to instrument. Browser geometry and screenshots provide the relevant diagnostic evidence.

## Baseline Validation Contract (extended and superseded by A-VC assertions above)

| ID | Priority | Type / surface | Required truth | Required evidence | Validator mode | Blocker / waiver path |
|---|---|---|---|---|---|---|
| VC-001 | P0 | UI / wide desktop | When the actual center pane is wider than `1000` CSS pixels, each in-scope chat wrapper is centered and its target width is 90% of that pane, with no fixed upper pixel cap. | Computed center-pane/chat bounding boxes (allowing normal subpixel rounding) and screenshots at 1440 and at least 1920 CSS-pixel viewports. | scrutiny + user-testing | If browser automation/runtime is unavailable, record the blocker and require user-run geometry/screenshots before closeout. |
| VC-002 | P0 | UI / narrow threshold | At a center-pane width of `1000px` or below, each in-scope wrapper fills its existing safe padded parent rather than retaining a 10% percentage gutter. | Computed geometry immediately above and at/below the threshold, including a desktop state narrowed by panels. | scrutiny | No waiver; blocked browser evidence must be supplied through user testing before closeout. |
| VC-003 | P0 | UI / alignment | Conversation content, notices, extension status/widgets, queue/retry/attachment surfaces, and composer use one coherent horizontal width rule in both new and existing sessions. | Screenshots/bounding-box comparison plus source scrutiny of all replaced wrappers. | scrutiny | A surface unavailable in the test environment may be marked blocked individually with rationale and source evidence; core conversation/composer alignment cannot be waived. |
| VC-004 | P0 | UI / panel interaction | Opening/closing the sidebar or file panel recomputes layout from actual remaining pane width without clipping, overlap, or horizontal page overflow. | Browser checks for sidebar open/closed and file panel open/closed, including animated transitions. | scrutiny | No waiver unless an affected panel state is explicitly removed from product scope by the user. |
| VC-005 | P1 | UI / mobile | At a representative phone viewport, chat and composer use full safe content width, retain existing edge padding, hide the minimap, and create no horizontal overflow. | Mobile screenshot and computed document/element widths at approximately `390 × 844`. | scrutiny + user-testing | If runtime evidence is blocked, user testing is required before closeout; it cannot be silently waived. |
| VC-006 | P1 | Static / code quality | Every in-scope hard-coded `820px` chat cap is removed in favor of the shared rule, while unrelated `820px` modal sizing remains unchanged; existing Node tests, TypeScript, and lint pass. | Targeted repository search, diff review, `node --test components/*.test.mjs lib/*.test.mjs`, `node_modules/.bin/tsc --noEmit`, and `npm run lint`. | scrutiny | No waiver; failures block closeout. |
| VC-007 | P1 | Docs/config/telemetry disposition | No setting, persistence, documentation, or telemetry surface is added; the checkpoint records why those layers are not applicable. | Diff scrutiny and checkpoint disposition review. | scrutiny | Any scope expansion reopens planning and this assertion before implementation proceeds. |
| VC-008 | P1 | Execution state | The matching implementation checkpoint records decisions, command outcomes, visual artifacts, validator results, and closeout evidence. | Completed checkpoint review. | scrutiny | No waiver for implementation work using saved execution state. |

## Assumptions, Risks, and Blockers

### Assumptions

- “Conversation” and the user's “communication area” mean the plan's canonical `Chat column`: message history, composer, notices, and aligned extension surfaces.
- The accepted `1000px` threshold is measured in browser CSS pixels against the actual center pane, not physical display pixels or the whole viewport.
- “Full width” on narrow layouts means full width within the existing safe content/padding boundary, not drawing controls beneath the minimap or flush beyond the viewport.
- Current mainstream Safari/Chromium/Firefox versions are the supported visual-validation targets; older browsers receive a safe but less exact fallback.

### Risks

- Inline-size containment can alter intrinsic sizing if attached to the wrong element; it must be placed on an already externally sized chat root and verified with both side panels.
- Crossing the `1000px` boundary changes from 90% to the full safe padded width and can cause a small reflow during panel animation; visual validation must rule out distracting clipping or oscillation.
- Container-query units and conditions are unsupported in old Safari releases; the base 90% rule plus existing phone media behavior is the deliberate fallback rather than new JavaScript resize state.
- Very long prose lines on ultrawide displays may become harder to read; the user has prioritized screen utilization over a fixed readability cap.
- Updating only message history would visually misalign notices, extension widgets, and composer controls.

### Blockers

- None currently.

## Decision Frontier

No unresolved product or design branches remain. The user confirmed shared understanding and approved this plan on 2026-07-21.

## Implementation Handoff

Approved plan path: `.agents/plans/2026-07-21-wider-chat-column.md`

```text
Open up implementation for .agents/plans/2026-07-21-wider-chat-column.md
```
