# Show Write Code by Default Checkpoints

Plan: `.agents/plans/2026-08-24-show-write-code-by-default.md`

## Handoff

**Source:** Fresh read-only scout workflow `25f87386-ba05-45cf-9972-2d64fddc7411`; child `fd75519b`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/25f87386-ba05-45cf-9972-2d64fddc7411/status.json`; raw child output: `.pi-subagents/artifacts/fd75519b_scout_0_output.md`.

**Purpose:** Trace the exact write-card, result-pairing, settled Process-details, syntax, CSS, and focused-test seams before implementation.

**Outcome:** Confirmed the approved plan matches the current architecture with no blocker. `ToolCallBlock` owns mounted card disclosure state and already rerenders on matching result identity changes; `ChatWindow` owns the result map and settled grouping; `ProcessDetailsGroup` preserves mounted manual state after initialization. Recommended a separate exact, case-sensitive write predicate; explicit user-touched and result-ever-observed refs; grouped block-to-result-ID matching; a dedicated bounded whole-file renderer; and the existing Jiti/minimal-DOM harness.

**Evidence:** The scout cited `lib/message-display.ts`, `components/MessageView.tsx`, `components/ChatWindow.tsx`, `app/globals.css`, `lib/file-types.ts`, `lib/types.ts`, and their focused tests. Parent inspection confirmed that edit recognition currently excludes `write`, write input is otherwise shown only as raw JSON, the matching result is available by tool-call ID, expensive disclosure children already unmount on collapse, existing generic input/result CSS has nested height/overflow limits, and Prism theme/language infrastructure can be reused without a dependency change.

**Uncertainty / gaps:** Synthetic DOM coverage cannot prove theme contrast, responsive wrapping, selected-text behavior, or computed overflow. Final-newline and empty-file presentation need explicit fidelity checks, and the plan-required light/dark wide/narrow browser smoke remains necessary.

**Recommended use:** Keep edit and write rendering paths distinct, consume only validated call-time `{ path, content }`, never reopen a touched card or a card that has already observed a result, and classify completed writes only when the exact grouped block ID has a matching result.

## Implementation Summary

**Plan section:** Design / Implementation Strategy; Test Strategy; Validation Contract VC-001 through VC-005.

**Work and outcome:** Added separate exact-write recognition and grouped completed-result matching; implemented the pending-to-first-result disclosure state machine with mounted user-choice authority; added a complete call-time whole-file renderer with success/failure labels, path/language metadata, decorative line numbers, bounded theme-aware syntax, exact plaintext fallback, natural soft wrapping, and empty-file treatment; preserved edit patches and ordinary tools; and updated maintained architecture and browser-local display memory.

**Validation / evidence:** `NODE_ENV=test node --test components/MessageView.test.mjs components/MarkdownBody.test.mjs lib/patch.test.mjs lib/message-display.test.mjs` passed 52/52. `../../../node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed. `.agents/reports/2026-08-24-show-write-code-by-default/browser-validation.json` records 54/54 Chrome assertions across light/dark `1440x1000` and `390x844` views: completed success/failure/long writes open, pending and near-name tools remain collapsed, Process details starts open, collapse/reopen releases and remounts code, focus is visible, long lines soft-wrap without horizontal or nested vertical scrolling, line numbers are decorative/non-selectable, and no runtime issue was observed. No Next build was run.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Handoff

**Source:** Fresh read-only review workflow `2e7b4d1e-b57e-4fed-adf3-af4cf5eba306`; correctness child `68df0246`; UX/validation child `66bc5ff3`. Recoverable workflow status and full outputs: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/2e7b4d1e-b57e-4fed-adf3-af4cf5eba306/status.json`.

**Purpose:** Independently review the complete implementation against exact-name/result scoping, disclosure lifecycle, call-time fidelity, malformed and over-budget fallback, edit/non-write regressions, accessibility, CSS, focused tests, and recorded browser evidence for VC-001 through VC-005.

**Outcome:** Both reviewers found no blocker and concluded that every Validation Contract obligation is met. Correctness confirmed that the result-ever-observed ref prevents replacement or disappearance/reappearance from reopening a card, grouped writes require the exact completed ID, malformed inputs keep the ordinary fallback, and bounded exactness-checked syntax preserves complete content. UX/validation accepted the independent disclosures, labels/status, inert code, decorative line numbers, natural wrapping, light/dark wide/narrow screenshots, and 54/54 browser report.

**Evidence:** Reviewers cited `lib/message-display.ts`, `components/MessageView.tsx`, `components/ChatWindow.tsx`, `app/globals.css`, focused component/display tests, and `.agents/reports/2026-08-24-show-write-code-by-default/browser-validation.json`. They independently confirmed 52/52 focused tests, TypeScript, lint, whitespace validation, no staged files, and no Next build.

**Uncertainty / gaps:** Correctness noted low-priority missing explicit coverage for result disappearance followed by reappearance, while confirming the persistent ref implements it correctly. It also noted that complete plaintext rendering necessarily creates one row per source line for exceptionally large writes, consistent with the approved complete-content requirement. UX noted that DOM/CSS assertions and computed browser evidence do not include a real clipboard-selection or accessibility-tree capture. Neither note represents an unmet obligation or a fix worth starting in this implementation run.

**Recommended use:** Treat the implementation as ready, retain the notes as bounded residual validation gaps, and proceed through final parent validation, commit, and guarded closeout without an iterative fix/review cycle.

## Implementation Summary

**Plan section:** Final implementation outcome; Validation Contract VC-001 through VC-005.

**Work and outcome:** The approved exact-write transcript behavior is complete. Pending `write` cards remain collapsed without mounted arguments, untouched cards open once on their first matching success or failure result, mounted user choices and later result changes remain authoritative, and only matching completed writes open their exact settled Process details group. Valid call-time content renders completely as neutral, line-numbered **Written content** or **Attempted content** with retained status, bounded syntax, truthful complete fallback, soft wrapping, natural height, and no filesystem comparison. Malformed writes use the ordinary fallback, while edit cards and unrelated or near-name tools preserve their prior behavior. Maintained architecture, memory, tests, and browser evidence are current.

**Validation / evidence:** Final `NODE_ENV=test node --test components/MessageView.test.mjs components/MarkdownBody.test.mjs lib/patch.test.mjs lib/message-display.test.mjs` passed 52/52; `../../../node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed. Chrome report `.agents/reports/2026-08-24-show-write-code-by-default/browser-validation.json` passed 54/54 assertions with zero runtime issues across light/dark desktop and mobile views, including pending/success/failure/long/near-name cases, exact defaults, focus, collapse/reopen, decorative line numbers, and overflow. Fresh reviewers `68df0246` and `66bc5ff3` found no blocker and concluded VC-001 through VC-005 are met.

**Departures from approved obligations:** None. Every approved obligation is complete. No Pi fork or dependency changed, no current-file comparison or diff was introduced, and no Next build was run. The transient `.next` development artifacts and isolated browser-smoke runtime created by `npm run dev` were removed after evidence capture.

**Implementation commit:** `c1828ff33a76c2875b70ac77df42547a1108762f` (`feat: show completed write content by default`).
