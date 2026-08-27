# DAG Edge Action and Insert Control Checkpoints

Plan: `.agents/plans/2026-08-26-dag-edge-insert-control.md`

## Handoff

**Source:** Fresh read-only scout workflow `38a626f8-c578-4544-ab3a-c1c4bcc1f078`; graph-operation child `83f2da94`; trusted-preview child `27cba995`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/38a626f8-c578-4544-ab3a-c1c4bcc1f078/status.json`; raw child outputs: `.pi-subagents/artifacts/83f2da94_scout_0_output.md` and `.pi-subagents/artifacts/27cba995_scout_0_output.md`.

**Purpose:** Trace the exact atomic operation, lock/discovery/receipt path, trusted SVG/HTML control boundary, mutation queue, focus lifecycle, rejection recovery, and focused-test seams before implementation.

**Outcome:** Both scouts confirmed the approved plan fits the current architecture with no blocker. The graph scout recommended one strict `insert_edge` operation with exact CAS, three-session discovery, two fresh IDs, final-state duplicate/capacity validation, old-order preservation for the first edge, one new monotonic order for the second, Redo clearing, and the unchanged store transaction. The Preview scout recommended one render-owned controller, a trusted sibling SVG dot/action group, and a trusted sibling HTML mini-form positioned from the validated midpoint and shared viewBox.

**Evidence:** The graph scout cited `lib/session-dag.ts`, `lib/session-dag-store.ts`, `lib/session-dag-route.ts`, and focused reducer/store/route tests. The Preview scout cited `components/SessionDagPreview.tsx`, `components/SessionDagPanel.tsx`, `lib/session-dag-svg.ts`, `app/globals.css`, and focused SVG/component tests. Parent inspection confirmed that current add/replace operations alone use generation-current discovery, the store already holds one lock across generation/CAS/reducer/receipt/publication, Mermaid and controls are trusted siblings, and current `409` adoption rerenders Preview.

**Uncertainty / gaps:** Final capacity must be calculated after selected-edge removal and Redo clearing. Fresh IDs must be checked against the original full active/history state. The inserted endpoint needs a truthful dedicated conflict reason. A rejected `409` can replace Preview DOM, so insertion draft/mode must survive a same-edge authoritative rerender. Pending dismissal is not explicitly specified; preserving the form requires suppressing Escape/outside/Cancel until the request settles. Source tests cannot prove composed outside events, focus restoration, theme contrast, or responsive placement, so isolated browser validation remains required.

**Recommended use:** Stabilize and test the atomic graph operation first; then wire the panel callback; implement one-active-edge trusted controls with render-resilient interaction memory and bounded input; validate focus/rejection/self-edge behavior; finally update maintained architecture and memory text.

## Implementation Summary

**Plan section:** Design / Implementation Strategy — strict transient edge-insertion operation; Test Strategy — graph/reducer/route/store coverage; Validation Contract VC-003 and the server/state portions of VC-004.

**Work and outcome:** Added one exact `insert_edge` operation with a dedicated endpoint-reuse conflict, strict parser fields, exact selected-edge CAS, current availability and completion checks for all three sessions, two globally fresh edge IDs, final-pair uniqueness, final Redo-cleared logical capacity, counter bounds, original form/order ownership for `A → C`, one new monotonic order for `C → B`, and complete-result relationship validation. Added Insert to both generation-current discovery gates without changing the persisted schema/version or store transaction.

**Validation / evidence:** `NODE_ENV=test node --test lib/session-dag.test.mjs lib/session-dag-store.test.mjs` passed 37/37. `NODE_ENV=test node --test lib/session-dag-route.test.mjs` passed 7/7. Focused tests cover exact parsing, success, self-edge insertion, stale targets, endpoint reuse, unknown/completed sessions, duplicate final pairs, fresh-ID collisions including history/removed edge, final capacity, counter overflow, one revision/receipt, exact retries, concurrency, generation races, sanitized conflicts, and byte-for-byte unchanged storage after rejection. `../../../node_modules/.bin/tsc --noEmit --pretty false` passed after the backend changes.

**Departures from approved obligations:** None. Preview controls, component wiring, browser validation, documentation, final gates, review, commit, and closeout remain pending.

**Implementation commit:** Pending.

## Handoff

**Source:** Fresh read-only adversarial review workflow `53ed8847-5d3d-4349-8527-5f5fc2391bb9`; graph-correctness child `006d34b1`; Preview/accessibility child `3ebfde07`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/53ed8847-5d3d-4349-8527-5f5fc2391bb9/status.json`; raw outputs: `.pi-subagents/artifacts/006d34b1_reviewer_0_output.md` and `.pi-subagents/artifacts/3ebfde07_reviewer_0_output.md`.

**Purpose:** Independently review the completed implementation against the approved plan and Validation Contract, with separate graph-authority and trusted-Preview/accessibility angles.

**Outcome:** Both reviewers found the atomic backend, strict parser, listing generation, receipt/revision, persistence, privacy, trusted Mermaid boundary, insertion semantics, and focused coverage coherent. They reported three required Preview lifecycle findings: inactive Preview currently clears the expanded Insert form and draft despite the mounted-panel retention contract; an accepted response ignored as older authority can leave the same-edge persistent interaction pending; and pending Insert disables the focused input and all form controls without a meaningful focused/busy state. The graph reviewer also reported browser validation as unattested because this checkpoint had not yet been updated; contrary parent evidence is the completed 58-assertion rerun in the main-root ignored runtime directory, with exactly two expected `409` responses and no unexpected browser errors. Durable reporting remains pending.

**Evidence:** The retention finding cites `components/SessionDagPreview.tsx` inactive cleanup and `AGENTS.md` mounted DAG state. The stale-success finding cites `components/SessionDagPanel.tsx` ignoring a lower-revision state while resolving success and `components/SessionDagPreview.tsx` clearing pending only on rejection. The pending-focus finding cites the form input/buttons becoming disabled and the dot/actions leaving the tab order in Insert mode. Parent inspection confirms these mechanisms. Both reviewers independently reran the 62 focused tests, TypeScript, lint, and diff checks successfully. Runtime browser evidence is under `/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-26-dag-edge-insert-control/`.

**Uncertainty / gaps:** The mounted-panel retention sentence predates edge-action drafts, but preserving the newly introduced editable Insert state is the safer consistent interpretation. The stale-success sequence requires an accepted response delayed behind adoption of newer authority that restores the same edge expectation, but the current code permits that sequence. Held-PATCH browser coverage currently exercises Swap rather than Insert, so the pending focus loss needs a realistic Insert-specific regression test. A `≤640px` viewport and boundary-positioned forms were suggested as optional evidence hardening.

**Recommended use:** Obtain explicit user direction before making validation-driven changes, as required by the Start Implementation review policy. Recommend fixing all three required lifecycle issues within the approved scope, adding focused stale-authority and pending-Insert coverage, extending the browser matrix to the mobile breakpoint, then rerunning final gates and one focused independent follow-up review.

## Implementation Summary

**Plan section:** Design / Implementation Strategy — trusted Preview edge actions, Insert form recovery, pending behavior, and authoritative adoption; Test Strategy — trusted-control/component and realistic browser coverage; Validation Contract VC-001, VC-002, VC-004, and VC-005.

**Work and outcome:** Implemented one-active-edge midpoint dots with endpoint-specific accessible names, separate Swap/Insert actions, a bounded trusted HTML Insert form, Escape/outside/Cancel focus restoration, self-edge Swap-only disabling, rejection draft recovery, and pending duplicate/dismissal suppression. Wired Preview Insert to one panel mutation that supplies two stable fresh IDs. After the user explicitly directed one reviewer-fix round on 2026-08-27, preserved interaction memory across non-interactive inactive renders, cleared same-edge pending state when an accepted response is older than already adopted authority, and kept pending Insert controls meaningful through read-only input, `aria-busy`, guarded focusable buttons, and rejection refocus. Explicit outside activation still closes the form as the approved interaction requires.

**Validation / evidence:** The required 62-test component/reducer/SVG/route/store suite, TypeScript, lint, and `git diff --check` passed after the review fixes. The final isolated Chrome pass completed 93 assertions with exactly two intentional `409` responses and no unexpected browser errors. It covered held pending Insert, repeated activation suppression, rejection refocus/value retention, delayed stale success behind newer restored authority, pointer/keyboard dismissal, atomic insertion, Swap, self-edge behavior, TD/LR, light/dark, 1440/780/600 px layouts, Raw, and schema stability. Durable evidence: `.agents/reports/2026-08-26-dag-edge-insert-control-browser-validation.md`; ignored raw evidence: `/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-26-dag-edge-insert-control/`.

**Departures from approved obligations:** None. Final follow-up review, final gates, implementation commit, final checkpoint summary, and guarded closeout remain pending.

**Implementation commit:** Pending.

## Handoff

**Source:** Fresh focused follow-up review workflow `76906db8-c044-4e71-bf23-be54a6018218`; reviewer child `3aa0f540`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/76906db8-c044-4e71-bf23-be54a6018218/status.json`; raw output: `.pi-subagents/artifacts/3aa0f540_reviewer_0_output.md`.

**Purpose:** Perform the single user-authorized follow-up review round, limited to the three earlier required lifecycle findings and their regression evidence.

**Outcome:** The reviewer confirmed that all three implementation defects are corrected: inactive rendering no longer erases interaction memory by itself while outside activation still dismisses; an accepted stale response clears matching persistent pending state after newer authority; and pending Insert uses a read-only focused input, busy semantics, guarded focusable buttons, duplicate/dismissal suppression, and rejection recovery. The reviewer found one remaining required validation gap rather than a logic defect: inactive-render retention is asserted only by source inspection and is not exercised through a behavioral transition that avoids the separately required outside-activation dismissal. The reviewer also noted that the browser report claims pending Cancel suppression while the driver verifies its disabled semantics but does not activate Cancel during the held request.

**Evidence:** Implementation references are `components/SessionDagPreview.tsx` interaction cleanup/restoration, accepted settlement, outside-click handling, and pending form application. The final browser driver directly exercises held pending Insert and stale-success/newer-authority recovery. The reviewer reran the 62 focused tests, TypeScript, lint, and `git diff --check` successfully. Parent full-suite validation after the fixes passed 963/963 with a temporary worktree dependency link removed immediately afterward.

**Uncertainty / gaps:** Ordinary user clicks that make Preview inactive are also approved outside activations and therefore intentionally dismiss the form, so a no-dismiss inactive transition requires a controlled programmatic/fault-injected behavioral setup rather than the normal Raw/hide click path. No second follow-up review was authorized. The remaining change would be validation-only plus correction of the pending-Cancel report claim or direct held-Cancel exercise.

**Recommended use:** Show the validation gap to the user and obtain explicit direction before changing the browser evidence. Recommend one bounded evidence-only update: exercise pending Cancel directly and simulate an inactive/reactive render without invoking outside dismissal, rerun the browser driver, update the report/checkpoint, and proceed without another independent review unless the user requests one.
