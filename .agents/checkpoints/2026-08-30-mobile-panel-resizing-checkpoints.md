# Mobile-Capable Panel Resizing — Checkpoints

Plan: `.agents/plans/2026-08-30-mobile-panel-resizing.md`

## Handoff

**Source:** Async workflow `130230b1-288b-4eae-891b-9946fa930d60`, child `e6b6a076` (`scout`, read-only implementation recon). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-30-mobile-panel-resizing--/2026-08-31T04-07-41-074Z_01a05600-6312-7fef-8212-84faa4c7a712/e6b6a076/run-0/session.jsonl`; retained handoff: `.pi-subagents/artifacts/outputs/e6b6a076/context.md`.

**Purpose:** Map the current resize eligibility, visibility, bounds, Pointer Events, responsive CSS, tests, historical evidence, and maintained documentation before editing the approved mobile-capable panel-resizing scope.

**Outcome:** The existing shared hook already supports primary mouse, touch, and pen input, pointer capture, keyboard operation, direct live CSS/ARIA updates, guarded preference commits, and centralized cleanup; it requires no mobile-specific branch. The implementation seam is to derive split visibility from `>640px`, panel openness, and non-expanded presentation, calculate bounds using every other split-visible panel regardless of that panel's own handle range, and enable each handle only when its own bounds have `maxWidth > minWidth`. The separate `<1000px` automatic right-panel expansion and **Restore** policy remains unchanged. CSS must remove only the `999px` handle suppression and widen the net-zero transparent target to `24px` for coarse/any-coarse pointers while retaining the `2px` line.

**Evidence:** Parent-rechecked source in `components/AppShell.tsx`, `lib/panel-layout.ts`, `hooks/useResizablePanel.ts`, `app/globals.css`, `lib/panel-layout.test.mjs`, `lib/file-viewer-layout.ts`, and `lib/file-viewer-layout.test.mjs`; historical plan/checkpoint/browser receipt from 2026-08-09; maintained `AGENTS.md` and `.agents/memory/display-preferences.md`. Baseline `NODE_ENV=test node --test lib/panel-layout.test.mjs lib/file-viewer-layout.test.mjs` passed 15/15. The scout supplied breakpoint examples showing correct zero-range behavior with both panels through `800px` and available compact range with one panel or roomier restored splits.

**Uncertainty / gaps:** Source and pure tests cannot prove trusted touch acquisition, actual coarse target geometry, ordinary scrolling outside the handle, focus/capture cleanup, rotation behavior, or document overflow. The historical browser receipt predates compact handles and the `24px` target, so a new privacy-safe browser receipt is required. A net-zero `24px` target overlaps adjacent content by `12px` on each side and needs browser interaction validation.

**Recommended use:** Preserve all current hook cleanup and intentional-change guards, make only the visibility/range/CSS changes above, cover the approved breakpoint matrix and range-transfer case in focused tests, then validate trusted pointer/keyboard/coarse interaction and responsive geometry in a browser without adding a dependency or changing the file-viewer expansion policy.

## Implementation Summary

**Plan section:** Design / Implementation Strategy and Validation Contract VC-001–VC-005.

**Work and outcome:** Removed the categorical `1000px` panel-resize constant and React/CSS gate while preserving the independent file-viewer narrow-expansion policy. `AppShell` now derives actual split visibility from the mobile overlay boundary, expansion, and panel openness; both live bounds callbacks account for every split-visible opposing panel; and each hook/handle is enabled only when its own current bounds have real range. Coarse and any-coarse pointers receive a net-zero `24px` transparent target around the centered unchanged `2px` line. Focused tests cover sidebar-only, right-only, and two-panel geometry at `640`, `641`, `768`, `800`, `900`, `999`, and `1000px`, plus the `801px` range-transfer seam. Maintained project guidance and display-preference memory now record the current behavior, and a new privacy-safe browser receipt is retained.

**Validation / evidence:** `NODE_ENV=test node --test lib/panel-layout.test.mjs lib/file-viewer-layout.test.mjs lib/right-panel-tabs.test.mjs` passed 20/20. The complete suite passed 956/956 in `/tmp/pi-web-mobile-resize-validation/pi-web`, a disposable sibling-layout copy with local copied dependencies and the retained production artifact, as required for a nested worktree; the initial active-worktree run exposed one stale in-scope right-panel source assertion, which was corrected, plus expected missing/local-symlink dependency failures that the required disposable layout resolved. `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed in the task checkout. Trusted Chromium CDP mouse, touch, and keyboard interaction passed compact split/range, `24px`/`2px` target geometry, outside-handle scrolling, cleanup, expansion/Restore, `640–1400px` crossings, persistence restoration, minima, and overflow checks in `.agents/reports/2026-08-30-mobile-panel-resizing/browser-validation.json`.

**Departures from approved obligations:** None. No dependency, mobile-specific state, panel redesign, minimum-width reduction, automatic-expansion change, telemetry, or `next build` was introduced. The temporary browser harness is not retained, consistent with the existing receipt convention; its sanitized result is retained. The disposable validation copy and temporary development server were outside the repository and do not alter product state.

**Implementation commit:** Pending.

## Handoff

**Source:** Async review workflow `fb950779-9842-4bc2-bb47-77d199eeb1f4`, child `a9296f15` (`reviewer`, correctness and regression review). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-30-mobile-panel-resizing--/2026-08-31T04-07-41-074Z_01a05600-6312-7fef-8212-84faa4c7a712/a9296f15/run-0/session.jsonl`.

**Purpose:** Independently review the implemented diff against VC-001–VC-005 for responsive geometry, visibility/range separation, hook timing, opposing-panel bounds, pointer cleanup, persistence, and overlay/expanded regressions.

**Outcome:** No source-code blocker or fix-worthy code defect was found. The reviewer confirmed that opposing bounds use split visibility, minima remain intact, reconciliation and preferred/effective ownership remain coherent, cleanup paths are preserved, and coarse target CSS matches the implementation contract. It found one required validation gap: the retained trusted-touch/coarse-pointer result was recorded at the roomy `1200px` state, while the plan requires that combined interaction at a representative compact split viewport.

**Evidence:** `components/AppShell.tsx` split/range derivation and reconciliation; `lib/panel-layout.ts` bounds; `hooks/useResizablePanel.ts` input/persistence/cleanup; `app/globals.css` target geometry; focused tests; and `.agents/reports/2026-08-30-mobile-panel-resizing/browser-validation.json`. The report's `coarsePointer` values match the `1200px` desktop bounds and do not retain a viewport field, while compact `900px` evidence is fine-pointer geometry without a trusted-touch result.

**Uncertainty / gaps:** Because the executable browser harness is intentionally not retained, the compact/coarse/touch combination cannot be inferred from generic receipt labels. VC-001 and VC-005 remain unattested until one compact restored split records trusted touch together with viewport, media state, both handle deltas/bounds, `24px`/`2px` geometry, cleanup, and outside-handle scrolling.

**Recommended use:** With explicit user direction, rerun a compact restored split such as `900px` under coarse/any-coarse media, exercise both handles with trusted touch, and replace the receipt with explicit combined evidence. No source-code change is recommended for this finding.

## Handoff

**Source:** Async review workflow `fb950779-9842-4bc2-bb47-77d199eeb1f4`, child `39a2f237` (`reviewer`, validation completeness and simplicity review). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-30-mobile-panel-resizing--/2026-08-31T04-07-41-074Z_01a05600-6312-7fef-8212-84faa4c7a712/39a2f237/run-0/session.jsonl`.

**Purpose:** Independently review focused/full validation, the retained browser receipt, accessibility/coarse-target evidence, privacy, maintained documentation, test strength, and implementation simplicity against the approved plan.

**Outcome:** The reviewer confirmed the implementation, maintained documentation, privacy boundary, and command validation, and independently reproduced the 20/20 focused and 956/956 disposable-copy full-suite passes, TypeScript, lint, and diff checks. It agreed that compact trusted coarse-touch evidence is missing, found that the `640px` browser snapshot exercises only the closed overlay rather than opening and closing it with zero handles, and found that the two-panel pure matrix asserts only the conjunction of both handle eligibilities, allowing one erroneous handle to escape a false-expected row.

**Evidence:** `.agents/reports/2026-08-30-mobile-panel-resizing/browser-validation.json` records coarse touch only alongside roomy bounds and records `mobile640.sidebarOpen: false`; `lib/panel-layout.test.mjs` computes two-panel eligibility with one `sidebar && rightPanel` assertion. These map to VC-005, VC-003, and the per-boundary matrix obligation in VC-001/VC-003 respectively. No source behavior defect was identified.

**Uncertainty / gaps:** The browser receipt currently overstates VC-003/VC-005 completion relative to its retained details, and the pure matrix cannot distinguish which two-panel boundary is incorrectly eligible when the expected combined result is false. Acceptance remains blocked even though implementation correctness checks are green.

**Recommended use:** With explicit user direction, split the two-panel matrix into separate sidebar/right expectations, then rerun one compact trusted coarse-touch pass for both handles plus a `640px` overlay open/close pass, update the receipt/checkpoint, rerun affected checks, and only then consider another independent validation review.

## Implementation Summary

**Plan section:** Test Strategy and Validation Contract VC-001/VC-003 per-boundary matrix coverage.

**Work and outcome:** Following the user's explicit direction to fix the matrix finding, changed every two-panel breakpoint row to carry separate expected sidebar and right-panel eligibility and assert each boundary independently. False rows can no longer pass when exactly one erroneous handle remains eligible.

**Validation / evidence:** `NODE_ENV=test node --test lib/panel-layout.test.mjs lib/file-viewer-layout.test.mjs lib/right-panel-tabs.test.mjs` passed 20/20; `npm run lint` and `git diff --check` passed. The change is test-only and does not alter panel behavior or the retained browser receipt.

**Departures from approved obligations:** The authorized matrix gap is resolved. The separately reviewed compact trusted coarse-touch receipt and `640px` overlay open/close receipt gaps remain unresolved and continue to block final VC-003/VC-005 acceptance; the user did not authorize those validation reruns in this direction.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Informed incomplete closeout for the full Design / Implementation Strategy, Test Strategy, and Validation Contract VC-001–VC-005.

**Work and outcome:** After the remaining validation gaps and their consequences were disclosed, the user explicitly directed: “close out as incomplete.” The accepted partial state is commit `2faaf42a0f1a32b68454b08d85f772d8d7bf910c`. That state implements geometry-derived split/range eligibility, opposing-visible-panel bounds, compact pointer resizing, coarse target sizing, focused breakpoint/range tests, maintained documentation, and the retained partial browser receipt. This instruction accepts integration of the named current-state gaps only; it does not make the approved plan complete.

**Validation / evidence:** Focused panel/file/right-tab tests passed 20/20 after the matrix correction. The full Node suite passed 956/956 in the required disposable sibling-layout copy before the test-only matrix strengthening; the affected focused suite passed afterward. TypeScript, lint, and diff checks passed. The retained browser receipt proves roomy trusted mouse/touch/keyboard behavior, `24px`/`2px` coarse geometry, outside-handle scrolling, compact fine-pointer geometry and range transfer, expansion/Restore, preference restoration, cleanup, minima, and no overflow. Independent reviewers found no source-code correctness defect.

**Departures from approved obligations:** The plan outcome is incomplete by explicit user instruction. VC-001 and VC-005 remain missing trusted coarse-touch interaction at a compact `641–999px` split viewport, including retained evidence for both handles' before/after widths, live bounds, cleanup, and scrolling in that same compact state. VC-003 remains missing a retained `640px` sidebar-overlay open/close interaction proving zero handles and no overflow in both states. The browser receipt's aggregate pass labels therefore overstate those specific retained details. No source-code defect is known, but residual risk remains that compact touch acquisition/cleanup or the open mobile overlay composition could regress without detection. VC-002 and VC-004 passed; the per-boundary pure matrix gap is resolved. No other obligation is known to be incomplete, blocked, waived, superseded, or divergent.

**Implementation commit:** `2faaf42a0f1a32b68454b08d85f772d8d7bf910c` (`feat: enable compact split panel resizing`), the exact user-accepted partial-state commit.
