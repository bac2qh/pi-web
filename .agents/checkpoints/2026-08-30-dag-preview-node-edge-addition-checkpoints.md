# DAG Preview Quick Add and Larger Edge Controls Checkpoints

Plan: `.agents/plans/2026-08-30-dag-preview-node-edge-addition.md`

## Handoff

**Source:** Fresh read-only scout workflow `0bf3a659-f570-455d-b783-cd3ae0e0e979`; child `9e93d699`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/0bf3a659-f570-455d-b783-cd3ae0e0e979/status.json`; raw output: `.pi-subagents/artifacts/9e93d699_scout_0_output.md`.

**Purpose:** Trace the existing edge-authoring interaction lifecycle, trusted SVG/HTML seams, serialized panel mutation authority, node/form assignment path, focus and draft recovery, and focused test surfaces before implementation.

**Outcome:** The scout found no blocker and confirmed that node quick-add should extend the one retained Preview interaction owner rather than add parallel state. The existing `runMutation` queue is the correct authority seam: reject the anchor's own exact ID before entering it, then revalidate active-anchor membership and deterministic form assignment inside the queued builder, allocate one fresh edge ID there, and submit the unchanged `add_edge` operation in the chosen endpoint order. Every active compiled node must receive a trusted top-left control; the existing eligible-node loop alone is insufficient.

**Evidence:** The handoff cites `components/SessionDagPreview.tsx` for retained interaction identity, pending/rejection settlement, outside dismissal, rerender recovery, and current completion placement; `components/SessionDagPanel.tsx` for serialized state-current operation building and authoritative success/conflict adoption; `lib/session-dag-svg.ts` for trusted sibling geometry; and `lib/session-dag.ts` for active-node/form derivation and unchanged `add_edge` validation. Parent inspection confirmed these seams and the existing component/SVG test conventions.

**Uncertainty / gaps:** Cross-rerender success focus needs an explicit anchor-control restoration path; a two-direction form must prevent the input's Enter key from choosing a browser-default submitter; exact plus/form offsets and larger edge geometry require browser validation for collision and clipping. Existing component tests are primarily source-contract assertions, so realistic focus, dismissal, and rejection/retry confidence still depends on the required browser pass.

**Recommended use:** Implement one discriminated edge/node interaction owner, keep all controls in the existing trusted sibling layers, rederive form authority inside the queue, add executable SVG geometry tests plus focused component contracts, and validate the final geometry and lifecycle in the isolated browser harness.

## Implementation Summary

**Plan section:** Design / Implementation Strategy — larger edge actions, persistent node quick-add, serialized `add_edge` reuse, one interaction owner, recovery/focus, and trusted sibling isolation; Test Strategy and Validation Contract VC-001 through VC-005.

**Work and outcome:** Enlarged the Preview edge dot/hit target and Swap/Insert buttons to the approved nominal geometry. Added one trusted top-left **+** for every active rendered node, a bounded exact-ID form with explicit Incoming and Outgoing submitters and no input-Enter default, and one discriminated node/edge interaction lifecycle with pending suppression, Escape/outside/Cancel dismissal, rejection draft/direction retention, and cross-rerender anchor focus restoration. Added the panel callback that rejects the anchor's own ID before queuing, then revalidates current active membership and deterministic form assignment inside `runMutation`, creates one fresh edge ID, and submits the unchanged `add_edge` operation in the chosen endpoint order. No route, reducer, schema, dependency, native-session, picker, or isolated-node machinery changed.

**Validation / evidence:** Focused component/SVG tests pass 20/20; TypeScript, lint, and `git diff --check` pass. The isolated Chrome driver passed with final revision 5, thirteen active edges, fifteen node controls/nodes, one intentional duplicate-pair `409`, and zero unexpected browser errors. It covered both direction successes, an absent valid session becoming connected, an already-active target, same-anchor no-request rejection, no implicit Enter, authoritative duplicate rejection/retry, pending suppression, focus restoration, one-open interaction, self-edge and existing Insert behavior, selected/completion coexistence, TD/LR, light/dark, and desktop/narrow/mobile layouts. Durable report: `.agents/reports/2026-08-30-dag-preview-node-edge-addition-browser-validation.md`; ignored raw driver/result/logs/screenshots: `/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-30-dag-preview-node-edge-addition/`.

**Departures from approved obligations:** None. Full required gates, independent review, final commit, final checkpoint summary, and guarded closeout remain pending.

**Implementation commit:** Pending.

## Handoff

**Source:** Independent correctness review workflow `1f3b2a4e-5960-43d3-a213-2c4ef36003bb`; child `6ff3f5c6`. Recoverable raw output: `.pi-subagents/artifacts/6ff3f5c6_reviewer_0_output.md`.

**Purpose:** Review Preview mutation construction, interaction/focus lifecycle, geometry, trust/privacy boundaries, and approved validation obligations without editing the checkout.

**Outcome:** The reviewer confirmed correct reuse of queued `add_edge` authority, endpoint ordering, unified edge/node interaction ownership, rejection recovery, trusted sibling isolation, bounded diagnostics, and approved control dimensions. It identified one required medium issue: when a successful PATCH returned authority older than an already-adopted state, Preview still left a success-restoration token after immediately focusing the current anchor; a later unrelated rerender could then steal focus. It also noted that the Mermaid accessible description had not yet mentioned node-add controls.

**Evidence:** The review traced older-state rejection in `adoptGraphState`, boolean success resolution in `runMutation`, and unconditional token creation in `settleAcceptedNodeMutation`. Parent inspection confirmed that combination. The isolated browser report's original single-client success case was contrary but did not exercise newer-authority-before-success settlement.

**Uncertainty / gaps:** The review did not run the browser driver. Its requested two-window case was subsequently represented deterministically with one held successful response, a newer direct isolated authority, and a later rerender.

**Recommended use:** Propagate whether successful authority was actually adopted, defer restoration only while an active render is missing or replacing the settled control, add a pure lifecycle regression, and validate the exact older-success ordering in the browser.

## Handoff

**Source:** Independent validation-coverage review workflow `1f3b2a4e-5960-43d3-a213-2c4ef36003bb`; child `530bd0fb`. Recoverable raw output: `.pi-subagents/artifacts/530bd0fb_reviewer_0_output.md`.

**Purpose:** Audit the focused tests, browser artifacts/report, visual geometry, regression coverage, and reproducibility against VC-001 through VC-005 without editing the checkout.

**Outcome:** The reviewer confirmed the underlying browser run and maintained architecture text were credible but found the LR Swap/Insert controls overlapping adjacent rendered nodes/node controls in the retained crop; parent visual inspection confirmed it. It also found missing direct-add capacity and add-after-Undo Redo regressions, missing browser execution of non-self Swap, completion, Undo/Redo, Refresh, and Preview retention, an unsupported keyboard-browser claim, and incomplete driver reset/start/screenshot instructions.

**Evidence:** The retained `edge-actions-dark-crop.png` showed the side-by-side LR buttons crossing the adjacent node boundaries. Source inspection confirmed node controls render later in the trusted layer and could intercept overlapping areas. Existing reducer tests covered insert capacity and other direct mutations but not direct `add_edge` capacity or add-after-Undo. The original ignored driver used pointer clicks for authored controls, did not execute the named coexistence flows, assumed revision-zero retained state, and did not generate every reported screenshot.

**Uncertainty / gaps:** On 2026-08-31 the user explicitly declined keyboard-shortcut browser validation and stated that authored controls will be used with the mouse. Existing Enter/Space semantics remain implemented and source/control-tested; only the browser activation obligation was waived. No platform screen reader was run.

**Recommended use:** Arrange edge buttons orthogonally to graph flow, add executable collision/hit ownership assertions in TD/LR, add the missing authority regressions, expand pointer-based coexistence validation, make the isolated driver reset and verify its fixture, and correct the durable report.

## Implementation Summary

**Plan section:** Validation Contract VC-001, VC-003, VC-004, and VC-005; independent-review remediation; user-authorized keyboard-browser adjustment dated 2026-08-31.

**Work and outcome:** Changed the enlarged edge-action layout to place 48×22 buttons horizontally around the midpoint in TD and vertically in LR, eliminating the confirmed adjacent-node/control collision while preserving the enlarged dot, hit target, labels, midpoint, and self-edge behavior. Propagated successful-authority adoption only for node quick-add, added a pure focus-defer decision, and prevented an ignored older success from retaining a future focus token. Updated the accessible graph description. Added direct `add_edge` capacity and add-after-Undo Redo-clearing regressions. Rebuilt the ignored browser driver so it resets and verifies the isolated fixture, generates every listed screenshot, asserts button/node/control/hit geometry in TD/LR, exercises reversible non-self Swap, completion, Undo/Redo, focus refresh, panel retention, and the held-older-success ordering, and uses pointer activation for authored controls.

**Validation / evidence:** Focused component/reducer/SVG/route/store suite passes 66/66. TypeScript, lint, and `git diff --check` pass. The rerun isolated Chrome driver passed at final revision 13 with thirteen active edges, fifteen rendered nodes/node-add controls, thirteen edge controls, one intentional duplicate `409`, and zero unexpected browser errors. It found zero action-button overlaps with nodes, node controls, the dot hit target, or each other in TD and LR, and center hit-testing resolved to each action. Parent inspection confirmed the regenerated collision crop and node-form screenshots. Durable report: `.agents/reports/2026-08-30-dag-preview-node-edge-addition-browser-validation.md`; raw ignored evidence: `/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-30-dag-preview-node-edge-addition/`.

**Departures from approved obligations:** User-authorized override: the keyboard-shortcut browser pass is waived in favor of pointer validation. Existing Enter/Space semantics were not removed, and input Enter was still validated as direction-neutral. No other obligation is waived. Final gates, implementation commit, mandatory final summary, and guarded closeout remain pending.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Final implementation and Validation Contract VC-001 through VC-005.

**Work and outcome:** Completed graphical node quick-add in both endpoint directions through the unchanged `add_edge` authority, persistent trusted node controls/forms, one recoverable node/edge interaction lifecycle, enlarged direction-aware edge controls, stale-success focus protection, focused regressions, reproducible isolated browser validation, and maintained DAG architecture/memory updates. VC-001 passed with enlarged non-overlapping TD/LR edge geometry and retained midpoint/self-edge behavior. VC-002 passed for every rendered active node and both absent-node and active-node endpoint flows. VC-003 passed for no-request self-anchor rejection, authority rejection/retry, direct-add capacity, Redo clearing, and authoritative revision behavior. VC-004 passed for truthful controls, direction-neutral input Enter, one-open interaction, pending suppression, predictable focus, trusted-layer isolation, and privacy; the user-authorized browser activation adjustment below applies. VC-005 passed for Raw, Swap/Insert, completion, selected marking, Undo/Redo, Refresh, Preview retention, responsive layouts, and maintained documentation.

**Validation / evidence:** Required focused command passed 66/66: `NODE_ENV=test node --test components/SessionDag.test.mjs lib/session-dag.test.mjs lib/session-dag-svg.test.mjs lib/session-dag-route.test.mjs lib/session-dag-store.test.mjs`. TypeScript passed with `../../../node_modules/.bin/tsc --noEmit --pretty false` because this nested worktree intentionally has no local `node_modules`; `npm run lint` and `git diff --check` passed. The final isolated Chrome run passed at revision 13 with thirteen active edges, fifteen rendered nodes/node-add controls, thirteen edge controls, zero geometry collisions in exercised ordinary TD/LR and self-edge TD controls, one intentional duplicate `409`, and zero unexpected browser errors. It covered both quick-add directions, absent and active targets, self-anchor no-request rejection, duplicate retry, pending suppression, newer-authority-before-older-success focus safety, non-self Swap, self-edge Insert availability, completion, Undo/Redo, focus refresh, panel retention, themes, directions, and desktop/narrow/mobile layouts. Durable evidence: `.agents/reports/2026-08-30-dag-preview-node-edge-addition-browser-validation.md`; ignored raw evidence: `/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-30-dag-preview-node-edge-addition/`. An additional non-contract whole-repository `node --test` attempt reported 962 passes and four nested-checkout environment failures caused by absent worktree-local dependencies/production artifacts and host Node `24.20.0` rather than pinned `24.19.0`; no required feature gate failed. `next build` was not run, as required.

**Departures from approved obligations:** User-authorized override on 2026-08-31: the keyboard-shortcut browser pass was waived because the user will operate authored controls with the mouse. Pointer activation was validated throughout. Existing Enter/Space control semantics remain implemented and source/control-tested, and input Enter was still browser-validated as direction-neutral. No other obligation was incomplete, blocked, waived, superseded, or divergent.

**Implementation commit:** `183ce3f` (`Add node edge authoring to DAG preview`).
