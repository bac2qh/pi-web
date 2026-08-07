# File Viewer Font Size Checkpoints

Plan: `.agents/plans/2026-08-06-file-viewer-font-size.md`

## Handoff

**Source:** Pi subagent workflow `call_We1OCA8iFvXCJlwqBhTsFABQ|fc_072a6aa7f7145237016a75242381a48190a733113ff11d78eb`, children `0a26f404` (correctness/accessibility) and `24cdf77c` (validation/scope). Recoverable result: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-results/call_We1OCA8iFvXCJlwqBhTsFABQ|fc_072a6aa7f7145237016a75242381a48190a733113ff11d78eb.json`.

**Purpose:** Independently review the initial implementation for correctness, ownership boundaries, responsive accessibility, scope, test quality, and validation-contract completeness without editing project files.

**Outcome:** Reviewers confirmed the preference/provider wiring, one-time proportional scaling, Markdown isolation, Menu/Transcript ownership, persistence architecture, opaque-renderer boundary, and changed-surface lifecycle coverage. They found one product blocker: the fourth inline group could clip near the former `1000px` center-pane presentation handoff at maximum Menu size. They also found validation blockers: the report stated but had not directly measured source line numbers at Viewer 28, diff computed typography lacked default/minimum/maximum evidence, and the first full-suite run had not ended green. Low findings identified one no-op browser assertion and brittle source-regex coverage.

**Evidence:** The correctness child measured the four-group inline controls at approximately `617.6px` under Menu 24 and showed the fixed top-bar content could exceed a `1001px` center pane. The validation child cited the initial browser script/report locations where source line-number evidence was constant rather than measured and diff had only one size. The parent removed the no-op, measured real connected elements, expanded diff evidence across default/minimum/maximum, moved the panel/inline handoff to `1400/1401px`, added a focused handoff invariant, and reran the full suite successfully.

**Uncertainty / gaps:** The initial reviewers observed an ambient `NODE_ENV=production` test-mode failure and a transient clean-cache real-development test race. Neither was a changed-surface defect; later clean test-mode and independent environment-unset runs passed all 718 tests. Browser-computed geometry remains Chromium/platform evidence rather than a committed browser harness.

**Recommended use:** Treat the initial findings as resolved only with the follow-up browser report, green full-suite log, and independent follow-up review recorded below. Preserve the `1400px` handoff unless future top-bar composition is remeasured at maximum Menu size.

## Handoff

**Source:** Pi subagent run `fcba2bad-b955-4552-b009-949d7d81fee9` (`reviewer`, follow-up verification). Recoverable output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/fcba2bad-b955-4552-b009-949d7d81fee9/output-0.log`.

**Purpose:** Verify that every initial review blocker was actually resolved, independently rerun validation, and inspect the final diff for regressions or scope drift.

**Outcome:** Clean review with no blockers or residual risks. The reviewer confirmed panel controls through `1400px`, an unclipped complete inline top bar at `1401px` with maximum Menu and populated synthetic session statistics, real source line-number measurements, diff default/minimum/maximum ratios and families, a green full suite, and unchanged server/dependency/renderer boundaries.

**Evidence:** Browser report measurements were `1001/1001` for the old-threshold panel top bar, panel presentation at `1400px`, `1401/1401` at the first inline width, and `1446/1446` in the wider maximum-Menu scenario. Source line numbers measured `13px` by default and `26px` at Viewer 28. Diff body/prefix/line-number/collapsed rows measured `13/13/11/11` by default, `9.28571/9.28571/7.85714/7.85714` at Viewer 10, and `29.7143/29.7143/25.1429/25.1429` at Viewer 32. The reviewer independently reproduced 718 passing Node tests with no failures and confirmed TypeScript, lint, and diff checks.

**Uncertainty / gaps:** Browser evidence uses an isolated synthetic Chromium workflow retained as JSON/screenshots rather than a committed executable end-to-end harness. No observed behavior or changed-surface gap remains.

**Recommended use:** Proceed to the implementation commit and guarded closeout after final status/privacy review; retain only the sanitized report/screenshots, not raw runtime logs or session state.

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy items 1-7; Validation Contract VC-001 through VC-006.

**Work and outcome:** Added an independent browser-local File Viewer base-size preference (`14px`, `10–32px`, 1px steps), guarded persistence, root base/scale variables, and a proportional fixed-baseline helper. Added the fourth editable Display group in inline and panel presentations. Routed source/raw, source line numbers, diff hierarchy, Markdown prose/headings/inline code/fenced code/tables through one Viewer scale while preserving existing default sizes, ratios, and font families. Kept tabs/status/controls/loading/errors on Menu; kept Transcript separate; left HTML Preview, PDF/DOCX, image, and audio sizing renderer/media-owned. Moved the Display presentation handoff to panel through `1400px` so the four-group row and populated session statistics cannot clip at maximum Menu size. Added focused tests, durable preference memory, and privacy-safe browser/automated reports.

**Validation / evidence:** `NODE_ENV=test node --test components/*.test.mjs lib/*.test.mjs` passed 718/718; an independent reviewer reproduced 718/718 with `NODE_ENV` unset. `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed. `.agents/reports/2026-08-06-file-viewer-font-size/browser-validation.json` and four synthetic screenshots cover defaults, input/bounds/revert/persistence, computed source/raw/diff/Markdown ratios and families, cross-domain isolation, opaque/media boundaries, both Display presentations, populated-stat top-bar geometry at `1001/1400/1401px`, focus, normal/narrow/mobile/expanded modes, both themes, live diff, wrapping, inner overflow, and no document overflow. Two fresh-context review rounds ended clean after resolving the initial responsive and evidence findings.

**Departures from approved obligations:** None. The Display presentation handoff moved from the prior `1000px` threshold to `1400px` as the bounded correction required by the plan’s explicit four-group crowding risk and VC-004 unclipped-control obligation; the separate chat-width and automatic-expansion thresholds remain unchanged. The browser workflow is retained as synthetic evidence rather than a committed executable harness, consistent with the repository’s existing validation practice.

**Implementation commit:** pending.
