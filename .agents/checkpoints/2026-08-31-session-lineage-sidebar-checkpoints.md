Plan: `.agents/plans/2026-08-31-session-lineage-sidebar.md`

## Handoff

**Source:** Fresh read-only scout workflow `3aa5defe-fd0b-44a0-9a1b-490f7afebfec`; tree-derivation child `60c82f87`; sidebar-UI child `15d8bed2`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/3aa5defe-fd0b-44a0-9a1b-490f7afebfec/status.json`; raw child sessions are listed there.

**Purpose:** Trace the complete-list ancestry authority, hidden closure, selected-family derivation, subtree ordering, Project/row rendering, section and scroll ownership, connector geometry, focused tests, and maintained documentation before implementation.

**Outcome:** Both scouts found no architecture blocker and confirmed that Lineage should derive directly from the existing global `allSessions` list before Project filtering, distinguish unavailable and hidden selections using the raw list plus existing hidden closure, and reuse the existing tree ordering. They recommended controlled, presentation-specific collapsed-ID sets; independently mounted or explicitly restored scroll owners; one shared connector-capable recursive renderer and `SessionItem`; and a Lineage-only bounded scroll adjustment with no focus call. Parent inspection confirmed these seams and the baseline focused suite passed 21/21.

**Evidence:** The data scout cited `lib/session-reader.ts` path-to-ID resolution, `lib/sidebar-session-state.ts` global hidden closure and latest-visible-descendant sorting, and the pure test surface. The UI scout cited `components/SessionSidebar.tsx` for the shared selection/actions path, current node-local collapse state, permanent Project body, and row-local guide; `app/globals.css` for focus/touch behavior; and the exact README/AGENTS locations. The current listing already supplies `parentSessionId`, `projectRoot`, `cwd`, and `worktreeBranch`; no API, schema, dependency, or persistence change is needed.

**Uncertainty / gaps:** A malformed parent cycle has no literal oldest ancestor. Preserve the existing deterministic forest fallback after selecting the whole connected family rather than inventing ancestry; add explicit cycle coverage. Existing recursive finalization/rendering can still be stressed by pathological depth, an inherited risk the approved browser matrix must bound. Source tests cannot prove focus retention, scoped scroll behavior, connector continuity, independent scroll positions, or responsive height allocation, so browser validation remains required.

**Recommended use:** Implement and test the pure selected-family result first, including hidden/unavailable/cycle/cross-context behavior; then convert both tree presentations to separate controlled collapse and scroll owners with shared connectors/rows; update source contracts and maintained English/Chinese architecture text; finish with the approved automated gates and desktop/mobile browser matrix.

## Implementation Summary

**Plan section:** Design / Implementation Strategy, Test Strategy, and Validation Contract VC-001 through VC-007.

**Work and outcome:** Added pure complete-family Lineage derivation from the authoritative global listing with explicit available/hidden/unavailable results, missing-parent truncation, malformed-cycle termination, selected ancestor IDs, hidden projection, cross-context prefixes, and reuse of latest-visible-descendant tree ordering. Added expanded-by-default Lineage and collapsed-by-default Project in the required order, separate controlled branch-collapse sets, independently mounted scroll owners, Lineage-only selected-path reveal without focus movement, pending reveal across explicit section closure, shared row actions, full Lineage context, and shared continuous ancestor lines/child elbows with compressed mobile indentation. Updated focused tests and maintained English/Chinese/architecture text without adding API, schema, persistence, dependency, or telemetry state.

**Validation / evidence:** Focused sidebar tests pass 28/28; TypeScript, lint, and `git diff --check` pass. The isolated Chrome matrix passed 35 assertions with zero failed HTTP responses and zero browser errors at `1440×1000` and `600×800`, covering family membership/order, cross-context labels, hidden states, independent section/branch/scroll ownership, Recent keyboard focus retention, Lineage-only reveal including closed-section pending behavior, unchanged Project scroll/collapse, continuous connectors, and mobile geometry/actions. Durable report: `.agents/reports/2026-08-31-session-lineage-sidebar-browser-validation.md`; ignored raw evidence: `/Users/xin/Documents/repos/pi-web/.agents/runtime/2026-08-31-session-lineage-sidebar/`.

**Departures from approved obligations:** None. Full relevant Node tests, independent review, final gates, implementation commit, mandatory final summary, and guarded closeout remain pending.

**Implementation commit:** Pending.

## Handoff

**Source:** Fresh independent review workflow `031d8bdf-fec1-486f-93c5-671f587f1763`; correctness child `068f125a`; UI/accessibility/validation child `14dc4a38`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/031d8bdf-fec1-486f-93c5-671f587f1763/status.json`; raw child sessions are listed there.

**Purpose:** Independently review the completed diff against the approved native-family, hidden/order, selection/reveal, independent section/scroll, connector, responsive/accessibility, documentation, and validation obligations without editing the checkout.

**Outcome:** Reviewers confirmed the global-list authority, hidden projection, depth-first/latest-descendant ordering, shared connector geometry, separate presentation state, context labels, maintained documentation, and absence of API/schema/persistence/dependency expansion. They found three required source issues: malformed-cycle reveal ancestors follow raw cyclic parents rather than the rendered forest and can expand an unrelated cycle root; a same-ID explicit row reopen does not retrigger Lineage reveal because `selectedSessionId` does not change; and at `600×480` with both trees open the Project controls consume its body so the Project scroll owner has `0px` height. The UI reviewer independently reproduced the same-ID and short-mobile failures in Chrome.

**Evidence:** The cycle finding cites `collectSelectedAncestorSessionIds()` versus the cycle-detached forest from `buildVisibleProjectSessionTree()` and the current fixture expecting `["b", "a"]` although only `a → tail` is rendered. The same-ID finding cites the shared explicit-open handler and the reveal effect's selected-ID/status/path-only dependencies; the reviewer measured `sameIdReveal: 0`. The short-mobile finding cites both sections' `96px` minimum and Project's fixed controls before its scroll owner; measured Lineage owner `64px`, Project owner `0px`. Contrary/updated validation evidence: the parent subsequently ran the complete required suite successfully as 967/967 with `NODE_ENV=test` and a temporary worktree `node_modules` link to the retained dependency tree, removed immediately afterward. The reviewer-reported orphaned validation server was also confirmed and terminated; port `30155` is released.

**Uncertainty / gaps:** Pathological recursion depth remains an inherited residual risk beyond the validated depth-14 family. The exact short-viewport sizing fix should preserve equal usable tree ownership without redesigning Project controls or weakening mobile action/focus behavior. No source fix or additional independent review is authorized until the user directs the next step under the Start Implementation review policy.

**Recommended use:** Recommend one bounded correction round for all three required findings: derive reveal ancestors from the rendered visible forest; signal explicit same-ID row activation into the existing Lineage-only reveal path; give both actual tree scroll owners a usable short-viewport share (including Project controls in its sizing basis); add focused regressions and extend the browser matrix to same-ID pointer/keyboard and `600×480`; rerun affected/full gates. Do not start another independent review unless the user explicitly authorizes it.

## Implementation Summary

**Plan section:** User-authorized correction round for Validation Contract VC-002, VC-003, VC-004, VC-006, and VC-008 following independent review.

**Work and outcome:** After the user explicitly directed “fix all this,” changed selected ancestor IDs to come from the final rendered visible forest, so detached malformed-cycle roots retain their manual collapse state. Added one reload-local explicit row-activation version so pointer or keyboard reopening of the same selected session retriggers the existing Lineage-only ancestor expansion and scoped scroll without adding selection authority. Accounted for Project's fixed picker/worktree controls in its open-section height basis, preserving an actual independently scrollable Project tree at short mobile heights. Updated focused contracts and the cycle expectation.

**Validation / evidence:** Focused sidebar tests pass 28/28; TypeScript, lint, and `git diff --check` pass. The corrected isolated Chrome matrix passes 42 assertions with zero failed HTTP responses and zero browser errors. It now directly covers same-ID keyboard and pointer reveal, focus retention, and `600×480` actual scroll-owner geometry: Lineage `64px`, Project `63.15625px`, both independently scrollable, with a Project row successfully activated. Updated durable report: `.agents/reports/2026-08-31-session-lineage-sidebar-browser-validation.md`.

**Departures from approved obligations:** None. Final complete-suite rerun, memory update, final parent review/gates, implementation commit, mandatory final summary, and guarded closeout remain pending. Per user direction, no additional independent review was started.

**Implementation commit:** Pending.
