# Manual Session Unread Marker Checkpoints

Plan: `.agents/plans/2026-08-06-manual-session-unread.md`

## Handoff

**Source:** Pi subagent run `f6e8656f-5692-42c9-bc17-86732e1f94a1` (`scout`, fresh-context read-only reconnaissance). Recoverable raw output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/f6e8656f-5692-42c9-bc17-86732e1f94a1/output-0.log`; child session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-06-manual-session-unread--/2026-08-07T04-50-10-656Z_019fda8e-aa60-74b1-868f-fea002f849ce/a1b5b65c/run-0/session.jsonl`.

**Purpose:** Independently map the existing unread lifecycle, duplicate row presentations, row-action accessibility/layout seams, strict shared-state boundary, and focused validation harness before implementation, without editing project files.

**Outcome:** The scout confirmed that one browser-local unread set already feeds Pinned, Recent, and recursive Project rows; running state clears unread and visually takes precedence; unselected running-to-idle completion adds unread; complete session listings prune stale IDs; and storage failures are tolerated. It identified the required same-selected-row correction: explicit row opening must clear unread in the click path because the existing selection effect does not rerun when the selected ID is unchanged. It recommended one shared callback, a real toggle button in the existing focus/touch-visible action group, pure transition/storage tests, and increased metadata reservation for the third absolute action.

**Evidence:** The scout cited `components/SessionSidebar.tsx` unread storage/state, running and selection effects, three presentation call sites, action handlers, and fixed 54px row layout; `app/globals.css` focus/coarse-pointer rules; and the strict `lib/sidebar-session-state.ts` schema. Its focused baseline passed 19/19 tests. The parent independently read the decisive code and ran the broader sidebar baseline (`components/SessionSidebar.test.mjs`, `lib/sidebar-session-state.test.mjs`, and `lib/sidebar-state-store.test.mjs`), which passed 30/30.

**Uncertainty / gaps:** The plan's “bounded” storage description corresponds to complete-list stale-ID pruning in current code; there is no pre-existing numeric payload/ID limit, so implementation should not invent one. The repository has no DOM mounting dependency, so actual narrow/focus/touch geometry still requires browser evidence in addition to pure and component-contract tests.

**Recommended use:** Extract only small unread-set/storage helpers, preserve current tolerance and transition ordering, clear unread synchronously on every explicit row open, route one callback through every presentation, keep the shared pinned/hidden API untouched, and browser-check the expanded action group before closeout.

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy items 1-5; Validation Contract VC-001 through VC-006.

**Work and outcome:** Extracted guarded browser-local unread storage and pure set/running/pruning transitions into `lib/sidebar-unread-state.ts`. Added one `Mark unread` / `Mark read` native button to the existing session-row action group and routed one session-scoped callback through Pinned, Recent, and recursive Project rows. Every explicit row open now clears unread before navigation, including a selected-row re-click. Running state still clears unread and visually takes precedence; only unselected completion adds it. The row retains its 54px height, reserves metadata space for the third action, and leaves a measured gap before fork-collapse and pin controls. The strict shared sidebar state, JSONL, selection, pin/hide/rename, sorting, and native lifecycle boundaries are unchanged. Current-state guidance and durable memory record the browser-local/shared-state separation.

**Validation / evidence:** Focused sidebar/state/storage tests pass 38/38. `NODE_ENV=test node --test components/*.test.mjs lib/*.test.mjs` passes 726/726 in `.agents/reports/2026-08-06-manual-session-unread/automated-validation.txt`; TypeScript, lint, and `git diff --check` pass. The privacy-safe synthetic Chromium report `.agents/reports/2026-08-06-manual-session-unread/browser-validation.json` passes with zero browser errors and covers mouse toggles, Pinned/Project and Recent/Project duplicates, selected marking, same-row re-click, leave/reopen, reload, stale/malformed storage, real page-global running/idle frames without a provider call, running precedence, native-button/focus evidence, touch activation, coarse-pointer visibility, and narrow parent-row geometry with all controls. Screenshots are retained beside the report. Independent final review is pending.

**Departures from approved obligations:** None. Browser running-state control used a temporary synthetic-only validation route that was removed before validation closeout and is absent from the project diff; no production API or schema was added. Final Chromium evidence includes actual Space-key activation of the focused native button and a touch-source tap gesture, in addition to visible focus and coarse-pointer checks.

**Implementation commit:** pending.

## Handoff

**Source:** Pi subagent workflow `call_bnRbk52qY27BeKGiMI2Vbwzo|fc_0ba72fb31da1e6f2016a756e37ec3481968a2776362a40b3c6`, children `ad210575` (state correctness) and `c2b3f8fe` (UX/accessibility and validation). Recoverable result: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-results/call_bnRbk52qY27BeKGiMI2Vbwzo|fc_0ba72fb31da1e6f2016a756e37ec3481968a2776362a40b3c6.json`.

**Purpose:** Independently review the implementation and evidence for unread lifecycle correctness, storage/shared-state boundaries, duplicate ownership, React ordering, accessibility, narrow/touch layout, existing-control regressions, privacy, and Validation Contract coverage without editing project files.

**Outcome:** Both reviewers found the product implementation clean: one set feeds every presentation; explicit opening clears before selection; running transitions and visual precedence are preserved; storage stays guarded and browser-local; and no unread API, JSONL mutation, or native lifecycle change exists. They identified two closeout items rather than code defects: remove untracked `.pi-subagents/` runtime artifacts, and add direct post-change activation evidence for collapse/expand, pin/unpin, Hide/Restore, and rename. They also noted that dynamic `Mark unread` / `Mark read` naming plus `aria-pressed` merits a future real screen-reader pass, and that manually marking an already-running session is an approved-but-unspecified edge whose marker remains hidden behind running precedence.

**Evidence:** The parent removed `.pi-subagents/`. The refreshed privacy-safe Chromium report now records `existingControlRegressions` with collapse/expand, unpin/repin, Hide/Restore, rename, unread preservation, and selection preservation all passing while unread is set. It also retains actual keyboard and touch input, duplicate rows, same-row open, reload/storage failure, running/idle frames, measured narrow geometry, 54px height, and zero browser errors. The reviewers independently confirmed the focused/full tests, TypeScript, lint, diff checks, temporary-route absence, synthetic-only screenshots, and no detected secret pattern.

**Uncertainty / gaps:** The browser running/idle pass drives the real page-global status boundary through a temporary synthetic-only control rather than paying for a provider completion; lower-layer running publication is covered by the full Node suite. The temporary browser driver is not committed as a reusable harness, matching existing repository validation practice. No screen-reader application was available; native button semantics, accessible name/state, keyboard input, focus, and touch were validated directly.

**Recommended use:** Treat the product diff as review-clean, retain the expanded existing-control browser evidence, keep the already-running manual-mark edge unchanged absent a new product decision, remove any regenerated runtime artifacts, and run one focused evidence/cleanup verification before final validation and commit.

## Handoff

**Source:** Pi subagent run `465bcfcc-1ce7-4f0e-b689-2d55db2c0dc3` (`reviewer`, fresh-context focused follow-up). Recoverable output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/465bcfcc-1ce7-4f0e-b689-2d55db2c0dc3/output-0.log`.

**Purpose:** Verify that refreshed browser evidence resolved the existing-control interaction gap, runtime artifacts and the temporary route were absent, accessibility/input/layout evidence remained coherent, and no blocker remained.

**Outcome:** The reviewer confirmed VC-004 is now directly attested: collapse/expand, unpin/repin, Hide/Restore, rename, unread preservation, and selection preservation all pass. It independently reran 38 focused tests, TypeScript, lint, and diff checks; confirmed the 726-test full-suite report; and verified artifact/route cleanup. It found one bounded accessibility blocker: the dynamic command name (`Mark unread` / `Mark read`) was combined with `aria-pressed`, which can produce contradictory toggle-button announcements such as “Mark read, pressed.”

**Evidence:** The reviewer cited `components/SessionSidebar.tsx` action semantics, the focused component test, `app/globals.css`, and browser report fields through `existingControlRegressions`. The parent accepted the semantic finding, removed `aria-pressed` from the dynamic command button, updated focused tests to require its absence while preserving dynamic accessible names, and refreshed the full browser pass. The revised report passes with synchronized dynamic action labels, actual keyboard/touch activation, all lifecycle/storage/running/layout checks, all existing-control interactions, and zero browser errors.

**Uncertainty / gaps:** No screen-reader application was available, but the conflicting toggle semantic is now removed rather than deferred. Browser running state still uses synthetic real-status publication rather than a provider/model call; production lower layers remain covered by the full Node suite.

**Recommended use:** Run one final fresh review of the ARIA correction and updated report, then repeat final automated checks before the implementation commit.

## Handoff

**Source:** Pi subagent run `fec5a1c6-f7de-4eb2-96c5-a8c9898b858a` (`reviewer`, final fresh-context ARIA/evidence verification). Recoverable output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/fec5a1c6-f7de-4eb2-96c5-a8c9898b858a/output-0.log`.

**Purpose:** Independently verify the dynamic-command ARIA correction, focused tests, refreshed browser report, and final transient-artifact/API cleanup before commit.

**Outcome:** Clean review with no blockers or fixes worth doing now. The reviewer confirmed that dynamic target-specific `Mark unread` / `Mark read` names now operate as ordinary command buttons without contradictory toggle state, while the row indicator and changed command name keep unread perceivable. It also confirmed synchronized labels, propagation, lifecycle behavior, keyboard/focus/touch/layout evidence, existing-control interactions, and route/runtime cleanup.

**Evidence:** The reviewer passed 18/18 focused tests and `git diff --check`, inspected the corrected action and tests, and verified the refreshed browser report's zero failures/errors plus the retained 726/726 full-suite, TypeScript, and lint results. It found no `.pi-subagents`, temporary unread route, staged files, or changed production API route.

**Uncertainty / gaps:** No screen-reader application was exercised. Browser running state uses synthetic real-status publication rather than a provider/model call. The reviewer judged both non-blocking because native semantics are directly verified and production running lower layers are covered by the full suite.

**Recommended use:** Proceed to the implementation commit, final checkpoint summary naming that commit, and guarded local-main closeout.
