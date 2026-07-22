# Wider Chat Column — Checkpoints

Status: active
Date: 2026-07-21
Plan: `.agents/plans/2026-07-21-wider-chat-column.md`
Worktree: `/Users/xin/Documents/repos/pi-web/.agents/worktrees/wider-chat-column`
Branch: `task/wider-chat-column`
Base: `c23c2e50797c30026239929e99d590a0affc66e0` (`main` at implementation open)

## Objective

Implement the approved live display controls: browser-local Width (70% default, 50–100%), Transcript (16px default, 10–32px), and Menu (14px default, 10–24px), while keeping full safe chat width at center panes of 1000 CSS pixels or less, preserving typography families and chrome hierarchy, excluding opened file/document content from Menu scaling, and re-rendering Mermaid at the selected Transcript size.

## Validation Contract Tracking

| ID | State | Evidence / blocker |
|---|---|---|
| VC-001 wide desktop geometry | passed | Playwright Chromium measured exact 90% widths at center panes of 1180, 1440, 1660, 1920, and 1113.61px; the user confirmed on 2026-07-21 that the layout works on their normal display. |
| VC-002 narrow threshold | passed | At 1001px the measured columns were 900.89px; at 1000px they filled the 932px safe parent. A desktop center pane narrowed to 853.61px by both panels filled its 785.61px safe parent. |
| VC-003 aligned surfaces | passed | Existing-session geometry reported four aligned 1296px wrappers at a 1440px center pane; new-session header and composer also matched. Source search confirms one shared class covers notices, extension wrappers, queue/retry/attachments, and composer. |
| VC-004 panel interaction | passed | Automated sidebar/file-panel open/close scenarios crossed wide/full modes with no clipping, browser errors, or horizontal overflow. |
| VC-005 mobile | scrutiny passed; user-testing pending | At 390×844, both new-session columns measured 358px inside symmetric 16px padding, minimap remained hidden, and document overflow was false. User confirmation remains required. |
| VC-006 static/code quality | passed | 77 Node tests passed; `tsc --noEmit`, lint, and `git diff --check` passed; in-scope 820px search count is zero and unrelated Models modal width remains. |
| VC-007 no docs/config/telemetry expansion | passed | Diff contains only CSS/component layout plus plan/checkpoint state; no setting, persistence, docs, or telemetry behavior was introduced. |
| VC-008 checkpoint completeness | active | Implementation and scrutiny evidence are recorded; amended implementation, user-testing, and closeout evidence remain. |

### Amendment Validation Tracking

| ID | State | Evidence / blocker |
|---|---|---|
| A-VC-001 defaults/live persistence | scrutiny passed; user-testing pending | Four preference-helper tests and the final Playwright pass verify 70/16/14 defaults, immediate independent changes, clamping/reversion, bounded numeric localStorage values, and reload persistence with no hydration errors. |
| A-VC-002 adjustable responsive width | scrutiny passed; user-testing pending | Final Playwright evidence verifies 70% default, 75% live change, reset to 70%, persisted 75%, full safe width at 1000px despite saved 50%, and saved 55% applying at 1001px. |
| A-VC-003 transcript typography | scrutiny passed; user-testing pending | Existing-session browser evidence verifies message, composer, and rendered code moving from 16px to 22px with font-family preservation. Source routing covers tables, thinking/tool/process output, custom messages, and compaction content. |
| A-VC-004 Mermaid scaling | scrutiny passed; user-testing pending | Three helper tests verify bounded configuration, size-sensitive keys, and serialized operations. A real safe Mermaid preview re-rendered from 16px to 22px: natural SVG geometry grew from 982×1128.78 to 2037×2354, and horizontal scroll width grew to 2061px without forced fill. |
| A-VC-005 menu proportional scaling | scrutiny passed; user-testing pending | Browser evidence verifies 14px default and proportional Explorer 11→18.86, sidebar control 12→20.57, tab 12→20.57, and modal heading 15→25.71 at Menu 24. Open source stayed 13px and Markdown preview stayed 14px. No document/top-bar overflow occurred. |
| A-VC-006 accessible responsive controls | scrutiny passed; user-testing pending | Browser checks verify disabled min/max actions, keyboard stepping, visible 2px focus outline, names/groups, expanded/controlled popover region, wide inline controls, narrow/mobile panel access, hidden stale panel after crossing to 1001px, and no mobile overflow. |
| A-VC-007 static/regression | passed | Final source passes 84 Node tests, `tsc --noEmit`, lint, and `git diff --check`. Source audit finds only four intentional fixed opened-file source/diff content sizes; no server API, shared config, or font-family setting was added. |
| A-VC-008 amended checkpoint completeness | active | Scope reversal, decisions, backtracks, implementation commits, privacy-safe final evidence, and remaining user/closeout gates are recorded; milestone commit hash, user result, and closeout remain. |

## Execution Log

### 2026-07-21 — Implementation opened

- User explicitly approved the plan and instructed Pi to open implementation.
- Finalized the same plan at `.agents/plans/2026-07-21-wider-chat-column.md` with `Status: approved` and the exact implementation handoff command.
- Created local worktree `/Users/xin/Documents/repos/pi-web/.agents/worktrees/wider-chat-column` on branch `task/wider-chat-column` from local `main` at `c23c2e5`.
- Copied the approved plan into the task worktree and created this matching checkpoint before source mutation.
- Project memory index `.agents/memory/MEMORY.md` does not exist; no project memory was available to load.
- Main checkout contains unrelated untracked draft plans under `.agents/plans/`; they will be preserved. Only the matching wider-chat plan will be reconciled during closeout.
- The repository has no `.agents/scripts/main-branch-lock.sh`. Before closeout, re-check for concurrent local-main writers; if none are active, record the no-race exception before merging. Do not modify or clean the unrelated `tmp` worktree.

### 2026-07-21 — Responsive layout implemented

- Added named inline-size containment on the chat root and one shared `.chat-column` sizing rule in `app/globals.css`.
- Wide mode uses 90% of the actual center-pane container through `90cqi`; center panes at or below 1000px use the full existing safe padded parent. The base 90% rule and existing 640px mobile rule provide progressive fallback.
- Replaced every in-scope 820px cap in `ChatWindow.tsx` and `ChatInput.tsx`. The unrelated 820px Models modal remains unchanged.
- Reworked the empty/new-session wrapper so its header/notices and nested composer are sibling columns with identical outer padding. This avoids accidentally constraining the composer inside another 90%-wide wrapper.
- Preserved desktop minimap reservation and mobile 16px padding; no message-bubble, sidebar, or file-panel sizing changed.
- No wiki/docs, project memory, configuration, persistence, or telemetry update is applicable for this deterministic layout-only change.

### 2026-07-21 — Validation

- Initial validation could not resolve development tools because the environment sets `NODE_ENV=production`, causing plain `npm ci` to omit dev dependencies. Reinstalled from the committed lockfile with `npm ci --include=dev`; no tracked dependency files changed.
- `node --test components/*.test.mjs lib/*.test.mjs`: 77 passed, 0 failed. Existing module-type warnings were emitted but did not affect results.
- `node_modules/.bin/tsc --noEmit`: passed with no output.
- `npm run lint`: passed.
- `git diff --check`: passed.
- Source scrutiny: zero `820px` caps remain in `ChatWindow.tsx`/`ChatInput.tsx`; the unrelated Models modal remains at 820px.
- Launched the worktree dev server on port 30142 and ran a privacy-safe Playwright Chromium geometry suite across ten scenarios: 1920 with sidebar open/closed, file panel, both panels, threshold 1001/1000, 1440 with sidebar open/closed, mobile 390×844, and an existing loaded session. All assertions passed with zero browser error events and zero horizontal-overflow findings.
- Geometry report: `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/artifacts/layout-validation.json`.
- Screenshots (generic new-session UI only; no conversation contents):
  - `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/artifacts/wide-1920.png`
  - `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/artifacts/threshold-1000.png`
  - `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/artifacts/mobile-390.png`
- `npm ci --include=dev` reported nine dependency-audit findings from the existing lockfile (1 low, 4 moderate, 4 high). No dependency changes were attempted because they are unrelated to this layout task.

### 2026-07-21 — Implementation milestone committed

- Commit `eb80c3d` (`feat: widen the chat column responsively`) contains the approved plan, active checkpoint, shared CSS rule, and aligned component changes.
- The privacy-safe worktree dev server remains available at `http://localhost:30142` for user testing; PID/log state lives under `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/`.

### 2026-07-21 — Wide-layout user testing passed; scope reopened

- The user confirmed the implemented responsive width works on their normal display and prefers it to the former 820px cap, satisfying the wide-layout user-testing gate.
- Before closeout, the user requested a new top-bar percentage minus/plus control. This contradicts approved decision D-002 (one fixed default, no preference) and materially adds preference scope, persistence, top-bar/mobile behavior, and validation work.
- User clarification: minus/plus changes must resize the chat immediately on the fly, without reload or session restart.
- User decision: persist the selected percentage browser-locally across reloads.
- User decision: change the default wide-pane width from 90% to 70%.
- User decision: at 1000 CSS pixels of actual center-pane width or below, continue using full safe width regardless of the saved percentage.
- User decision: adjust in 5-percentage-point steps, clamped from 50% through 100% inclusive.
- User decision: clicking the displayed width percentage resets it to the 70% default.
- User requested font-size controls adjacent to the width control. Font family/type must not change.
- User split font sizing into two independent domains:
  - **Transcript font:** default 16px; controls conversation text and composer text, and code must use the same selected size while retaining its monospace family.
  - **Menu font:** default 14px; controls all application chrome outside the transcript—sidebar, Explorer, session rows, top bar, tabs, dropdowns, and modal controls—while opened file/source/document contents retain their existing sizing.
- Each font control uses minus/plus steps of exactly 1px and a directly editable numeric value so sizes such as 17px or 22px can be typed.
- User decision: persist transcript and menu font sizes independently in browser-local storage.
- User decision: transcript font accepts 10–32px; menu font accepts 10–24px. Typed valid values apply immediately, out-of-range values clamp, and empty/invalid drafts revert on blur or Enter.
- User decision: when the actual center pane is wider than 1000px, show compact inline Width, Transcript, and Menu controls in the top bar. At 1000px or below (including mobile), collapse them into one Display button/popover; the saved wide-pane percentage remains editable but does not override full-width narrow mode.
- User decision: Menu size scales existing UI typography proportionally from the 14px baseline so headings, normal labels, and metadata retain their current hierarchy; it does not flatten every UI string to one exact pixel size.
- User decision: Mermaid follows the Transcript size by re-rendering with the selected Mermaid font size, allowing labels, node geometry, and spacing to grow naturally. Diagrams are not stretched merely to fill column width; the existing horizontal scrolling remains available for wide graphs.
- All width/font-domain, default, persistence, validation, responsive-placement, menu-scaling, and Mermaid decisions are resolved; source implementation remains paused until the approved plan amendment is complete. No adjustable-width code will be added until the scope amendment is decision-complete and recorded in the approved plan/checkpoint.

### 2026-07-21 — Display-control scope amendment approved and recorded

- Updated the same approved plan with a decision-complete `Approved Scope Amendment — Live Display Controls` section.
- The amendment explicitly supersedes the fixed 90%/no-preference decisions while retaining actual-center-pane measurement, full safe width at/below 1000px, side-panel behavior, and no fixed upper cap.
- Recorded Width 70% default/50–100 range/5-point step/reset, Transcript 16px/10–32 range, Menu 14px/10–24 range, independent browser-local persistence, direct font inputs, responsive inline/popover controls, proportional menu hierarchy, file-content exclusion, and Mermaid re-render semantics.
- Expanded design, tests, privacy/debuggability, risks, and validation assertions before any amended source mutation.

### 2026-07-21 — Preference core implemented

- Added `lib/display-preferences.ts` with approved defaults, storage keys, ranges, step/clamp/parsing helpers, CSS-variable derivation, and proportional font-size helpers.
- Added four focused Node tests covering malformed/default values, clamping/snapping, bounded stepping, and CSS-variable output without font-family mutation.
- Added `DisplayPreferencesProvider`/hook with SSR-safe defaults, guarded browser-local reads/writes, immediate CSS-variable application, independent updates, and Width reset.
- Wrapped `AppShell` in the provider at `app/page.tsx`.
- Focused preference tests passed (4/4) and TypeScript passed before UI integration.
- Commit `96c4ebe` (`feat: add browser-local display preferences`) records this bounded milestone; preceding commit `7bf70a1` records the approved amendment.

### 2026-07-22 — Responsive controls and typography integration implemented (uncommitted)

- Added accessible inline/popover Width, Transcript, and Menu controls with bounded steppers, direct draft-aware font inputs, Width reset, focus styling, and center-pane container-query presentation.
- Changed wide chat geometry to the stored percentage with a 70% default while preserving full safe width at/below 1000px.
- Routed conversation, composer, code/table/custom/compaction/process surfaces through Transcript variables without changing font families.
- Added Mermaid configuration/render-key helpers and tests so selected Transcript size causes a natural re-layout without width stretching.
- Routed application chrome through the proportional Menu helper across AppShell, sidebar/Explorer, tabs, dropdowns, chat controls, configuration modals, and file-viewer chrome. Four numeric `FileViewer` sizes remain intentionally fixed for source/diff/document content.
- Corrected Escape handling in direct numeric inputs so cancellation cannot race the following blur commit.
- Source changes remain only in the task worktree; local `main` has no task source changes and still contains unrelated untracked `.agents` drafts that remain untouched.

### 2026-07-22 — Current validation and correction pass

- The first privacy-safe Playwright display-preference pass verified wide defaults/live updates/persistence, width threshold behavior, representative Transcript/Menu scaling, and max-Menu overflow behavior.
- That pass exposed a hydration mismatch on reload: the preference provider could update while the nested Suspense boundary had not hydrated. Moved the provider inside the page Suspense boundary so AppShell hydrates before the provider effect applies stored values.
- The mobile popover failure was a validation timing issue: the script asserted immediately after the click. The script now waits for the panel's visible state.
- The first safe Mermaid candidate lookup used the button's title as its accessible name and therefore missed available diagrams. Corrected the selector without recording message text or session identifiers.
- Live Mermaid validation then exposed a real remount: inline ReactMarkdown component functions changed identity when the preference provider re-rendered, resetting Preview to Source. Memoized the component map so preview state survives Transcript changes.
- Mermaid operations now serialize initialize/parse/render against Mermaid's global configuration; render failures expose only bounded stage/error-name data attributes. Natural SVG width is restored from the generated viewBox so diagrams are not stretched to the column and wide diagrams remain horizontally scrollable.
- Responsive validation exposed that an open narrow Display panel could remain mounted after resizing above 1000px. CSS now shows panel controls only at/below the center-pane threshold (with a mobile fallback), while wide panes show only inline controls.
- Direct-input Escape/blur handling was corrected so cancellation cannot race a blur commit. The Display trigger now exposes expanded/controlled-region semantics and receives the shared visible focus treatment.

### 2026-07-22 — Final scrutiny evidence before user handoff

- Final regression: 84 Node tests passed, including four preference tests and three Mermaid tests; `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed.
- Final privacy-safe Playwright Chromium suite passed seven scenarios with zero failures and zero browser error events: defaults/live/reload persistence, 1000/1001 threshold handoff, 390×844 mobile popover, Menu hierarchy/file exclusion, keyboard/accessibility bounds, real existing-session message/composer/code sizing, and real Mermaid re-rendering.
- Width evidence: 70% default, 75% live/persisted, reset to 70%, full safe width at 1000px, and saved 55% applied at 1001px.
- Transcript evidence: message/composer/code computed sizes changed from 16px to 22px while font families remained unchanged.
- Menu evidence at 24px: representative base sizes scaled proportionally (Explorer 11→18.86, sidebar control and tab 12→20.57, modal heading 15→25.71); open source remained 13px and Markdown preview remained 14px.
- Mermaid evidence: label text changed 16→22px, natural geometry changed 982×1128.78→2037×2354, and the 1006px wrapper exposed 2061px scroll width rather than shrinking/stretching the SVG to fit.
- Accessibility evidence: native bound disabling, Enter stepping, a solid 2px focus outline, named control groups/region, and responsive trigger state all passed.
- Final report: `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/artifacts/display-preferences/validation.json`.
- Privacy-safe mobile artifact: `/Users/xin/Documents/repos/pi-web/.agents/runtime/wider-chat-column/artifacts/display-preferences/mobile-display-popover.png`.
- Worktree dev preview remains at `http://localhost:30142`. Local `main` still has no task source changes.

## Current Phase

Automated scrutiny is complete. The implementation/checkpoint milestone is ready to commit in the task worktree; user behavior confirmation remains required before merge or closeout.

## Immediate Next Step

Commit the coherent display-controls milestone, then hand the running preview to the user for normal-display testing of Width, Transcript, Menu, mobile/narrow handoff, and a Mermaid-heavy conversation. Do not merge to local `main` before that confirmation.
