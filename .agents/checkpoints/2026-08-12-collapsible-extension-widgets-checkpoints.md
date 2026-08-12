# Collapsible Extension Widgets Checkpoints

Plan: `.agents/plans/2026-08-12-collapsible-extension-widgets.md`

## Handoff

**Source:** Fresh read-only review workflow `6036f385-3831-4919-b5d8-cab5396de249`; correctness child `2510a118`. Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/6036f385-3831-4919-b5d8-cab5396de249/status.json`.

**Purpose:** Adversarially review disclosure state reconciliation, responsive defaults, native accessibility, hidden-body updates, and both placement slots against the approved plan.

**Outcome:** Found no implementation defect, but reproduced a high-severity validation-harness failure: the literal focused command inherited `NODE_ENV=production`, where `React.act` was unavailable. The parent replaced `act` with production-compatible `flushSync` plus scheduled-effect settling; the literal command and the test-mode variant now both pass 11/11. The review also identified the then-missing actual-browser evidence, which the parent subsequently completed.

**Evidence:** The child cited `components/ExtensionWidgets.test.mjs` at the dynamic harness calls and confirmed the same tests passed under a non-production React build. Parent reruns after the fix: `node --test components/ExtensionWidgets.test.mjs` and `NODE_ENV=test node --test components/ExtensionWidgets.test.mjs`, both 11/11. Browser evidence is recorded at `.agents/reports/2026-08-12-collapsible-extension-widgets/browser-validation.json`.

**Uncertainty / gaps:** The child did not observe the later browser run or the production-compatible harness fix. Those were independently validated by the parent and are subject to follow-up fresh review.

**Recommended use:** Keep the focused test self-contained under the inherited repository environment; do not rely on an undocumented `NODE_ENV` prefix for this feature's required command.

## Handoff

**Source:** Fresh read-only review workflow `6036f385-3831-4919-b5d8-cab5396de249`; validation child `f9d0d71c`. Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/6036f385-3831-4919-b5d8-cab5396de249/status.json`.

**Purpose:** Independently assess validation coverage, browser semantics, maintainability, scope discipline, documentation, and preservation of server/custom-panel boundaries.

**Outcome:** Found the implementation, focused coverage, and documentation correct, with no source-code fix. The only blocker was missing browser evidence; it also noted the inherited production-React test constraint and nested-worktree dependency/artifact limitations. The parent closed the browser gap with a real Chrome desktop/mobile run and fixed the focused command rather than accepting the environment caveat.

**Evidence:** The child independently passed the focused suite under test React, 39 widget-authority/custom-UI tests, ESLint, and whitespace checks, and found no projection, RPC, custom-panel, or `/subagents-fleet` changes. The final parent browser report records trusted mouse, touch, Enter, and Space activation; visible keyboard focus; responsive defaults and explicit overrides; live collapsed updates; placement/removal lifetime; 44px mobile targets; editor geometry; and zero browser runtime errors.

**Uncertainty / gaps:** The child's broad full-suite attempt had three known nested-checkout real-Next artifact failures and used the retained main dependency installation for TypeScript. These are environment limitations outside the changed feature, not accepted failures in the Validation Contract; the plan-required scoped commands pass from the task checkout using the documented retained dependency path.

**Recommended use:** Treat the scoped automated commands plus the durable browser report as the decisive validation evidence; do not broaden this feature into Next production-artifact setup or custom-panel redesign.

## Handoff

**Source:** Final fresh read-only review workflow `532cf78a-4815-4f2b-9d9d-d5e14b2c9a90`; child `b75d6398`. Recoverable workflow status is available through the retained async run and parent session artifacts.

**Purpose:** Re-review the complete diff after the production-compatible harness fix and real-browser validation, including source, tests, checkpoint dispositions, and the durable browser report.

**Outcome:** Clean. The reviewer found no blocker or fix worth doing now and confirmed the per-key mounted-chat state, responsive defaults, native disclosure semantics, hidden mounted bodies, and removal/remount lifetime match the approved plan.

**Evidence:** The reviewer independently ran the literal production-inherited focused command (11/11) and confirmed TypeScript, lint, and whitespace validation. It found the browser report consistent with pointer, touch, Enter/Space, focus, live-update/cap, removal/reappearance, responsive-override, and mobile-geometry obligations.

**Uncertainty / gaps:** None identified within the approved scope. The review is source/report based and relies on the parent's recoverable owned-browser run for observed UI evidence.

**Recommended use:** Accept the implementation after the parent reruns the final scoped commands, inspects status/diff, records the implementation commit, and completes guarded local-main integration.

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy; Proposed browser-only behavior; Test Strategy; Validation Contract VC-001 through VC-006.

**Work and outcome:** Every array- and factory-origin widget card in either editor-adjacent slot now renders as an independent native disclosure with a generated body ID, state-specific accessible label, `aria-expanded`, `aria-controls`, a visible focus treatment, and a 44px mobile/coarse-pointer target. `ChatWindow` owns explicit per-key mounted-chat choices before partitioning: untouched widgets follow the `≤640px` responsive default, explicit choices survive line replacement, reordering, and placement movement, and removal or chat remount resets them. Collapsed bodies remain mounted with `hidden`, continue receiving current capped presentation lines, and do not alter extension/projected authority. Existing slot bounds, editor composition, factory rendering, custom panels, and `/subagents-fleet` remain unchanged. Maintained architecture and display-preference documentation plus durable browser evidence were updated.

**Validation / evidence:** Final validation passed: `node --test components/ExtensionWidgets.test.mjs lib/rpc-manager-widgets.test.mjs lib/custom-ui-terminal.test.mjs` (50/50 under the inherited `NODE_ENV=production`); `../../../node_modules/.bin/tsc --noEmit`; `npm run lint`; JSON parsing of `.agents/reports/2026-08-12-collapsible-extension-widgets/browser-validation.json`; and `git diff --check`. The owned Google Chrome 151 run at 1280×800 and 390×780 verified independent mouse and touch controls, native Enter/Space, `:focus-visible` with a 2px outline, generated ID associations, mobile defaults, explicit override stability, live replacement while hidden with 11 authoritative lines and the existing browser cap, placement/removal lifetime, 44px targets, non-overlapping editor geometry, no horizontal overflow, and zero browser runtime errors. The owned dev server shut down gracefully and all owned disposable browser, extension, session, and `.next` artifacts were removed. Fresh review workflow `6036f385-3831-4919-b5d8-cab5396de249` produced the production-test fix and browser-evidence requirement; final fresh workflow `532cf78a-4815-4f2b-9d9d-d5e14b2c9a90` returned clean.

**Departures from approved obligations:** None. The typecheck used the documented retained-main dependency installation because nested task worktrees intentionally have no local `node_modules`; no Next build was run.

**Implementation commit:** `81deffde79ed33ff935c8cf20478778c04c902f2`.
