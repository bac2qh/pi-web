# Session DAG Edge Swapping and Raw Labels Checkpoints

Plan: `.agents/plans/2026-08-24-session-dag-edge-swap-labels.md`

## Handoff

**Source:** Fresh read-only parallel investigation workflow `e0a1f42c-d36f-493e-9013-d23798b33f60`; children `d26759af` (`mermaid-edge-alias-seam`) and `43ca3603` (`raw-preview-swap-seam`). Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/e0a1f42c-d36f-493e-9013-d23798b33f60/status.json`.

**Purpose:** Map the installed Mermaid 11.15 explicit-edge-ID/rendered-SVG contract, strict alias and midpoint seams, Raw endpoint-label and draft distinctions, authoritative swap mutation wiring, trusted Preview interaction lifecycle, responsive styling, tests, and browser validation before implementation.

**Outcome:** Both investigations converged on the approved minimal design. Mermaid accepts `n0 e0@--> n1` and renders a path whose `data-id="e0"` agrees with current-render DOM id `${renderId}-e0`; compiler aliases must follow existing sorted edge order and persisted IDs must remain map-only. SVG preparation should require exact expected alias coverage and retain validated paths, then use path length/point APIs plus existing CTM conversion rather than renderer metadata. Raw committed swaps must reverse displayed values through the existing exact `replace_edge` expectation and clear only the accepted row draft; trailing swaps are local only. Resolved values use `buildSessionDagLabel`, accepted missing endpoints are unavailable, and unknown local values are unresolved. Preview controls belong in the trusted sibling layer, use exact compiled edges/labels, remain disabled for self-edges, and reuse click/Enter/Space plus rejection restoration and in-flight suppression.

**Evidence:** Child `d26759af` traced Mermaid lexer/parser, edge normalization, layout, and path rendering in the installed `11.15.0` distribution, including explicit-ID syntax and `id`/`data-edge`/`data-et`/`data-id` output; it identified deterministic compiler, exact-alias, geometry, and pure-test seams. Child `43ca3603` traced `SessionDagPanel`, `SessionDagPreview`, CSS, focused tests, maintained DAG docs, and prior CDP reports; it identified the execution-time CAS check, success-only draft cleanup, committed-versus-draft label truthfulness, self-edge no-request guard, responsive control placement, and privacy-safe browser matrix. The parent independently confirmed the installed renderer path attributes and the 23/23 focused baseline.

**Uncertainty / gaps:** Neither child completed a standalone DOM render probe because this nested worktree has no local dependency directory and Mermaid needs a browser DOM; source identity is exact but final rendered structure and control placement still require the approved isolated browser pass. Short, self, parallel, curved, and crossing-edge collisions remain visual risks. There is no platform screen-reader harness.

**Recommended use:** Implement one parent-owned writer path: compiler maps and reducer tests first, strict SVG alias/geometry/control helpers second, Panel/Preview/CSS wiring third, then focused/static gates and an isolated TD/LR browser matrix. Fail Preview closed rather than accepting version-shaped aliases or geometry heuristics.

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy; focused portions of the Test Strategy and Validation Contract VC-001 through VC-003.

**Work and outcome:** Added deterministic generated `eN` compiler aliases and alias-to-edge maps while keeping persisted IDs out of Mermaid structure. Added truthful Raw endpoint presentation, immediate committed-row swaps through exact existing `replace_edge` CAS, local-only trailing-draft swaps, success-only draft cleanup, and visible self-edge disabling. SVG preparation now validates exact current-render edge paths and retains edge-control geometry; ordinary edges must preserve `eN`, while Mermaid 11.15's documented-on-disk behavior of expanding a self-edge into three node-alias-derived `cyclic-special` paths is accepted only as an exact three-segment set and maps the middle segment back to its compiled `eN` edge. Preview mounts safe SVG-only Swap controls at validated path midpoints in the trusted sibling layer with endpoint-label names, click/Enter/Space activation, repeat/in-flight suppression, rejection restoration, and self-edge no-request behavior. Raw responsive layout and focus/disabled presentation were extended without changing routes, stores, schemas, or native session state.

**Validation / evidence:** The pre-edit focused baseline passed 23/23. The expanded focused suite passes 29/29, TypeScript passes, literal `npm run lint` passes, and `git diff --check` passes. An isolated Chrome smoke render with nine logical edges confirmed eleven exact Mermaid paths (one three-path self-edge), nine trusted Swap controls, one disabled self-edge control, five coexisting completion controls, resolved/unavailable/unresolved Raw labels, and no browser errors. The first strict render deliberately failed closed on Mermaid's self-edge expansion; source inspection plus the observed DOM established the exact bounded compatibility rule, after which the same fixture rendered successfully. Full browser interaction, final documentation, independent review, full repository/static reruns, commit, and closeout remain pending.

**Departures from approved obligations:** None. The strict self-edge three-segment recognition is required to satisfy the approved always-visible disabled self-edge control with installed Mermaid 11.15; it retains generated-only aliases and fails closed on any missing, duplicate, foreign, or differently shaped segment set.

**Implementation commit:** Pending.

## Handoff

**Source:** Independent fresh reviewer run `41336a8c-bf16-4ce5-875a-7931605cfeb6` (`reviewer`).

**Purpose:** Review the uncommitted implementation against the approved plan and Validation Contract without editing project files.

**Outcome:** PASS. The reviewer found no material correctness, safety, privacy, accessibility, concurrency, or scope gap. It confirmed atomic `replace_edge` reuse, truthful Raw endpoint presentation, generated edge-alias isolation, exact self-edge expansion validation, trusted sibling controls, in-flight/rejection behavior, responsive styling, focused tests, and maintained DAG documentation.

**Evidence:** Recoverable raw review output is attached to the run above. The reviewer independently inspected the complete diff and repository context and ran the focused DAG suite successfully (29/29). Its source-oriented browser-contract checks passed; the separate runtime matrix is recorded in `.agents/reports/2026-08-24-session-dag-edge-swap-labels-browser-validation.md`.

**Uncertainty / gaps:** The reviewer did not perform a browser runtime pass. The parent subsequently covered pointer and keyboard interactions, two-client conflict adoption, themes, responsive widths, TD/LR geometry, labels, persistence privacy, and visual screenshots with isolated synthetic fixtures.

**Recommended use:** Proceed to final repository gates and closeout if the parent confirms the browser report and complete diff remain within the approved scope.
