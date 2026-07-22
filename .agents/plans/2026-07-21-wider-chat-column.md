# Wider Chat Column

Status: approved
Date: 2026-07-21
Approved by user: 2026-07-21

## Objective

Make the Pi Web chat column a responsive default that uses about 90% of the available center pane on sufficiently wide desktop layouts, with only modest edge margins, and expands to the full available content width on mobile or otherwise narrow layouts.

## Success Criteria

- On sufficiently wide desktop layouts, the conversation and composer use about 90% of the available center pane rather than an `820px` cap.
- The conversation, notices, extension UI, and composer stay horizontally aligned.
- On mobile or an otherwise narrow available area, the chat column uses the full available content width rather than preserving a percentage gutter that wastes scarce pixels.
- The behavior is the default for everyone; no width preference or settings control is introduced.
- No fixed upper pixel cap defeats the percentage-based behavior on ultrawide displays.

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
- User decision: ship one responsive default rather than a user-configurable width preference.
- User requirement: target about 90% of the available center pane on sufficiently wide desktop layouts, with a modest balanced margin. The center pane automatically grows when the sidebar closes and shrinks when the sidebar or file panel opens.
- User requirement: use the full available content width on mobile and whenever the center pane is too narrow to justify percentage gutters.
- User requirement: keep the rule percentage-based without a fixed maximum width, so wide displays continue to gain usable chat space.
- User decision: at `1000` CSS pixels of available center-pane width or below, use the full safe content width; this includes phone layouts. Above `1000px`, use the 90% rule.
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

- A width setting, persistence, migration, or settings UI.
- Changing sidebar width or show/hide behavior.
- Changing the file viewer's `42%` split.
- Redesigning message bubbles, typography, controls, or the minimap.
- Adding a general browser/DOM test framework solely for this CSS-scale change.
- Supporting obsolete browsers that lack container queries beyond a safe 90%-width fallback and the existing mobile behavior.

## Decision Ledger

| ID | Decision | Status | Rationale / authority | Consequences |
|---|---|---|---|---|
| D-001 | Use about 90% on sufficiently wide desktop layouts and the full available content width on mobile/narrow layouts. | resolved | User clarified the target on 2026-07-21: leave only enough margin to avoid crowding and reclaim as much space as possible. | Requires a responsive percentage rule plus a narrow-layout fallback. |
| D-002 | Ship the behavior as the responsive default, not a user-configurable preference. | resolved | User decision on 2026-07-21; no relevant setting exists today. | No settings UI, persistence, migration, or reset behavior is needed. |
| D-003 | Measure 90% from the available center pane after optional side panels take their space, not from the entire browser viewport. | resolved | User selected “90% of the rest of the screen” on 2026-07-21 after explicitly walking back literal whole-screen sizing. | The chat automatically widens when the sidebar closes and shrinks safely when the sidebar or file panel opens, without overlap or horizontal overflow. |
| D-004 | Do not retain a fixed upper pixel cap on ultrawide displays. | resolved | User requested a percentage rule that continues to use as much screen as possible. | Very wide prose lines are accepted in favor of space for code, tables, and long output. |
| D-005 | Above `1000px` of center-pane width, use 90%; at `1000px` or below, use the full safe content width while retaining existing edge padding. | resolved | User accepted the recommended threshold on 2026-07-21 and reiterated that phones should use the full screen while 4K/MacBook layouts should gain substantially more width. | The threshold is measured in CSS pixels and against the center pane, so a desktop pane narrowed by open side panels can also enter full-width mode. |

## Closed and Deferred Branches

- **Closed:** Literal `90vw`/whole-browser sizing; it would ignore space already occupied by optional side panels and can overflow the center pane.
- **Closed:** A user-configurable width setting; the wider layout is one responsive default.
- **Closed:** A fixed ultrawide pixel cap; percentage-based use of wide displays takes priority.

## Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Chat column | UI layout | `components/ChatWindow.tsx` | Constrains conversation content, notices, extension widgets, and composer alignment. | Present for the lifetime of a rendered chat. |
| Center pane | UI layout and sizing reference | `components/AppShell.tsx` | Holds the top bar and `ChatWindow`; its current width is what remains after the optional left sidebar and right file panel take space. | Resizes as either side panel opens or closes. |
| File panel | UI layout | `components/AppShell.tsx`, `app/globals.css` | Displays opened files to the right of the chat. | Optional; `42%` wide on desktop when open. |

## Touched-Surface Classification

- `ui/frontend`: responsive desktop chat layout and composer alignment.
- `configuration`: **not applicable**; the user selected one responsive default and no stored preference.
- `docs/current-state`: **not applicable**; README documents features and setup rather than pixel-level layout defaults, and this repository has no maintained wiki to update.
- `telemetry/debuggability`: expected **not applicable** for a deterministic CSS/layout rule with no runtime operation or persisted state.

## Design / Implementation Strategy

1. Establish one named inline-size containment context on the `ChatWindow` root (the center-pane chat surface), so descendant layout responds to the space remaining after sidebar/file-panel changes rather than only to the browser viewport.
2. Define one shared chat-column class in `app/globals.css`, with centered horizontal alignment and no fixed maximum pixel width:
   - default/fallback width: `90%`;
   - in container-query-capable browsers, wide mode targets `90cqi` (90% of the chat container's inline size) while respecting the descendant's available padded parent;
   - at a center-pane inline size of `1000px` or below, width becomes `100%` of the existing safe padded parent.
3. Apply that class to every in-scope aligned wrapper now capped at `820px`: empty/new-session content, floating notices, conversation/above-editor widgets, below-editor widgets, and the composer/queue/retry/attachment wrapper. Remove only those chat-related `820px` caps; unrelated `820px` modal sizing remains untouched.
4. Preserve existing outer padding: desktop content continues reserving space for the `36px` minimap, while mobile keeps symmetric `16px` safe padding and no minimap. Do not change message-bubble width rules.
5. Keep the layout deterministic and CSS-owned; do not add React resize state, persistence, settings, or telemetry solely for width calculation.
6. Use a safe progressive fallback: browsers without container-query support retain the base 90% rule, while the existing `640px` mobile behavior provides full-width phone layout.

## Test Strategy

- **Isolated unit layer — waived:** the selected implementation is declarative CSS with no sizing helper or persisted state; a Node/Jiti unit test cannot evaluate container geometry, and adding a DOM/browser harness only for this change would not provide proportionate value.
- **Regression checks:** run the existing Node suite with `node --test components/*.test.mjs lib/*.test.mjs`.
- **Static checks:** run `node_modules/.bin/tsc --noEmit` and `npm run lint`. Do not run `next build`.
- **Source scrutiny:** search the two chat components to prove every in-scope `820px` cap was replaced by the shared class while unrelated modal/file-preview widths were not changed.
- **Wide public-surface browser check:** with an actual center pane above `1000px`, capture computed bounding boxes and a screenshot showing the conversation and composer at approximately 90% of center-pane width and aligned. Exercise sidebar open and closed on at least a 1440-CSS-pixel viewport and one 1920-or-wider CSS viewport representative of a scaled 4K display.
- **Threshold public-surface browser check:** exercise center-pane widths immediately above and at/below `1000px`; verify the former uses 90% and the latter fills the existing safe padded parent without page overflow. Opening both side panels on desktop should be included if it drives the pane below the threshold.
- **Mobile public-surface browser check:** at a representative phone viewport such as `390 × 844`, verify full safe content width, symmetric existing edge padding, hidden minimap, usable composer controls, and no horizontal overflow.
- **Alignment/regression check:** verify messages, notices, extension status/widgets, queued/retry/attachment surfaces, and composer share the same horizontal column in new, loaded, and actively streaming session states where those surfaces are available.
- **User-testing handoff:** the user should confirm the result on their normal 4K/MacBook browser setup because browser zoom/display scaling controls the real CSS-pixel viewport.

## Telemetry / Debuggability

Telemetry changes are expected to be **not applicable**: the selected behavior is a deterministic client layout rule with no asynchronous operation, persisted preference, sensitive data, or ambiguous runtime failure to instrument. Browser geometry and screenshots provide the relevant diagnostic evidence.

## Validation Contract

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
