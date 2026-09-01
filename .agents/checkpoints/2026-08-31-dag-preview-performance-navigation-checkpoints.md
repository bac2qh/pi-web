# DAG Preview Performance and Session Navigation Checkpoints

Plan: `.agents/plans/2026-08-31-dag-preview-performance-navigation.md`

## Handoff

**Source:** Fresh read-only scout workflow `413ca8d3-604b-40b8-8735-9f80c4eeda94`; server child `62abcc8d`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/413ca8d3-604b-40b8-8735-9f80c4eeda94/status.json`; raw output: `.pi-subagents/artifacts/62abcc8d_scout_0_output.md`.

**Purpose:** Trace the metadata-rich mutation-authorization bottleneck, exact pinned-SDK session-directory/header-discovery behavior, generation and graph-lock authority, and focused reader/route test seams before implementation.

**Outcome:** The scout confirmed that only `add_edge`, `replace_edge`, and `insert_edge` need a new uncached exact-ID listing. The standard discovery shape is `join(getAgentDir(), "sessions")`, immediate directory or symlink children, then immediate `*.jsonl` files. The route should pass the resulting `ReadonlySet<string>` and captured generation directly into the unchanged store; the store already checks that generation twice under the graph lock. Parent inspection confirmed these seams against the installed pinned package.

**Evidence:** The handoff cites `lib/session-reader.ts`, `lib/session-dag-route.ts`, `lib/session-dag-store.ts`, their focused tests, and the pinned `734502cb8` tarball's `session-manager.js` and `config.js`. It found that the current route constructs a set only after full transcript/project enrichment and that no store/schema/cache change is needed.

**Uncertainty / gaps:** Pi Web's existing header reader caps the first physical line at 64 KiB, while the pinned SDK's bounded discovery skips blank/malformed physical lines and scans up to 1 MiB. Reusing the narrower helper would not be complete relative to native discovery. Best-effort unreadable-root handling remains the SDK's existing empty-list behavior. The configured custom session-directory environment is not used by current Pi Web `SessionManager.listAll()` and must not be introduced here.

**Recommended use:** Align the existing bounded header reader with the pinned SDK's discovery semantics, add a fresh generation-current ID scan with an injectable fixture root, switch only the DAG route dependency, and add ordinary/symlink/malformed/duplicate/large-body/race coverage.

## Handoff

**Source:** Fresh read-only scout workflow `413ca8d3-604b-40b8-8735-9f80c4eeda94`; UI child `1f7e644a`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/413ca8d3-604b-40b8-8735-9f80c4eeda94/status.json`; raw output: `.pi-subagents/artifacts/1f7e644a_scout_0_output.md`.

**Purpose:** Trace the existing session-selection owner, retained DAG panel, exact metadata maps, trusted ShadowRoot control architecture, geometry, focus, and event-isolation seams for per-node navigation.

**Outcome:** The scout confirmed the minimal owner path: `AppShell.handleSelectSession(SessionInfo)` → `SessionDagPanel` exact lookup in its unfiltered `sessionsById` → a ref-held Preview callback → a trusted per-node listener closure. This path changes chat/session/URL state but no right-panel state. Unavailable durable nodes have no metadata and therefore no control. Parent inspection confirmed the callback and retained-panel behavior.

**Evidence:** The handoff cites `components/AppShell.tsx`, `SessionDagPanel.tsx`, `SessionDagPreview.tsx`, `lib/session-dag-svg.ts`, `lib/session-dag.ts`, focused tests, and responsive CSS. It identifies existing ID/alias/node maps, the trusted sibling SVG and HTML overlay, and the marker-only selection layout effect.

**Uncertainty / gaps:** The document capture-phase outside-click listener must explicitly recognize go-to controls or a non-pending authoring interaction would be dismissed before the target listener runs. Current 22-unit minimum node height does not prove separate top-right and bottom-right circles, so actual TD/LR geometry requires browser validation. Component coverage is mostly structural and cannot replace the required pointer/keyboard/focus/layout pass.

**Recommended use:** Add a dedicated 9-unit-radius go-to factory with the approved arrow/frame glyph and accessible name, place it from validated bottom-right geometry only for metadata-backed nodes, keep its callback in a ref outside render dependencies, include its records in outside-click isolation, and validate exact selection plus unchanged panel state in the isolated browser harness.

## Implementation Summary

**Plan section:** Design / Implementation Strategy — bounded exact-ID mutation authorization.

**Work and outcome:** Added a fresh non-recursive standard-session-directory scan that reads only the pinned SDK-equivalent bounded header prefix, deduplicates exact IDs, and returns them with a generation that remained current for the complete scan. `add_edge`, `replace_edge`, and `insert_edge` now pass that exact set and generation into the unchanged store authority; metadata-rich ordinary session listing, graph storage, receipts, compare-and-set behavior, lock checks, and all other operations are unchanged.

**Validation / evidence:** Reader coverage includes ordinary and symlinked roots/directories/files, duplicate IDs, malformed and unavailable files, large transcript bodies, 1 MiB header bounds, and an in-flight generation change. Route tests prove all three endpoint-authorized operations receive the same set/generation while non-endpoint operations do no discovery. The focused DAG/reader suite passed 85 tests. In an isolated 400-session browser fixture, five fresh identity scans took 4.2–5.8 ms; five successful additions used one PATCH, zero DAG GETs, and one committed render each, with authoritative PATCH median 25.1 ms / maximum 151.6 ms and click-to-paint median 73.6 ms / maximum 189.6 ms.

**Departures from approved obligations:** None.

**Implementation commit:** Pending final validation and commit.

## Implementation Summary

**Plan section:** Design / Implementation Strategy — trusted per-node Go to session control.

**Work and outcome:** Wired `AppShell.handleSelectSession(SessionInfo)` through the retained DAG panel's current unfiltered metadata map into ref-held trusted Preview listeners. Available active nodes receive one 9-unit circular arrow/frame control associated with the bottom-right boundary; unavailable nodes receive none. Pointer and non-repeating Enter/Space activation stop propagation, remain isolated from authored interactions, preserve focus, and perform no DAG request, Mermaid rerender, sidebar metadata mutation, or right-panel transition.

**Validation / evidence:** Focused SVG/component coverage verifies exact metadata ownership, trust boundaries, glyph/accessibility semantics, callback/render dependencies, event isolation, and bounded TD/LR positions. The isolated browser pass verified pointer, Enter, and Space navigation for normal, same, and hidden sessions; URL/chat/sidebar/current-marker convergence; unavailable omission; retained pending authoring; unchanged split/expanded/mobile panel state; later manual reveal; and light/dark TD/LR geometry with 10 controls, 11 nodes, zero label/control collisions, zero near-edge controls, 10 bottom-right associations, and 10 owned hit targets.

**Departures from approved obligations:** None.

**Implementation commit:** Pending final validation and commit.

## Handoff

**Source:** Fresh independent review workflow `bccc6cb0-3d78-45e7-8a59-4a525daebd4c`; server reviewer `a59c06a4`, UI reviewer `c656f70b`. Recoverable aggregate: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/bccc6cb0-3d78-45e7-8a59-4a525daebd4c/status.json`; child session artifacts are listed there.

**Purpose:** Independently review the uncommitted implementation against the approved plan and Validation Contract, with separate server-authority/performance and UI/trust/interaction angles.

**Outcome:** The server reviewer found no server-path code defect and confirmed the exact-ID discovery, unchanged under-lock generation authority, measured bottleneck removal, and documentation boundaries. The UI reviewer found two required issues: accepted minimum node geometry can place radius-9 Add/Complete/Go-to controls less than 18 units apart, and direct DAG use of `AppShell.handleSelectSession` does not execute `SessionSidebar.handleSelectSessionFromList`'s explicit re-open effects for clearing unread state and restoring a manually switched worktree when the already-selected session ID/cwd props do not change. Reviewers also reported missing executable runtime coverage because the ignored browser harness is outside the task checkout; parent evidence shows that harness did run and pass all required browser flows, but its passing representative geometry does not disprove the minimum-bound collision and it did not stage unread/manual-worktree state before same-session reopening.

**Evidence:** UI geometry evidence cites `components/SessionDagPreview.tsx` accepted bounds and `lib/session-dag-svg.ts` positions: a valid 22×22 TD available node places Add/Go-to centers 11.41 units apart, while a valid 44×22 TD eligible+available node places Complete/Go-to centers 10 units apart. Same-session evidence cites `SessionSidebar.tsx`: the row path directly clears unread and calls `setSelectedCwd`, while its prop effects intentionally skip unchanged selected ID/cwd values. Parent browser evidence remains the successful 400-session harness result (PATCH median 25.1 ms, click-to-paint median 73.6 ms, TD/LR sampled collision count zero), plus the 85-test focused suite, TypeScript, lint, and whitespace checks.

**Uncertainty / gaps:** The approved design names `AppShell.handleSelectSession` as the navigation owner, while the approved same-session assumption requires sidebar-only explicit-open effects; satisfying both needs a minimal ownership seam rather than duplicating sidebar state. Structural component tests and executable SVG tests remain supplemented by the ignored end-to-end browser harness rather than a tracked mounted-React test. The server review's suggested stronger retry fixture is optional because the implementation visibly performs a fresh scan each attempt.

**Recommended use:** Before acceptance, add fail-closed pairwise control-separation validation with boundary tests, and route DAG activation through the same explicit-open effects as a sidebar row without moving unread/cwd ownership or changing panel/DAG state. Extend focused assertions for those exact regressions, then rerun the browser harness and affected gates. Per implementation policy, wait for explicit user direction before applying these review-driven fixes.

## Implementation Summary

**Plan section:** Validation Contract VC-003 and VC-004 — review-driven geometry and same-session corrections explicitly authorized by the user.

**Work and outcome:** Added fail-closed pairwise separation validation for Add/Complete/Go-to centers and boundary regressions for the previously accepted 22×22 and 44×22 collisions. Added one generation-tagged AppShell-to-Sidebar explicit-open request: DAG activation still invokes the existing application selection owner, while `SessionSidebar` remains the sole owner of unread clearing and effective-worktree restoration and acknowledges only the matching request. No DAG, shared sidebar metadata, or right-panel ownership moved.

**Validation / evidence:** The expanded focused suite passed 98 tests, including unsafe/safe TD/LR geometry and shared explicit-open-effect assertions. TypeScript, lint, and `git diff --check` passed. A fresh isolated 400-session browser run explicitly marked the already-selected destination unread, manually switched to the main worktree, reopened it with keyboard Go-to, and verified unread clearing plus destination-worktree restoration while retaining the existing zero DAG GET/rerender and unchanged-panel assertions. All five additions passed with PATCH median 20.3 ms / maximum 25.4 ms and click-to-paint median 84.8 ms / maximum 96.7 ms; TD/LR again reported zero collisions and zero near-edge controls.

**Departures from approved obligations:** None. The correction implements the plan's existing same-session and non-overlap obligations without widening product behavior.

**Implementation commit:** Pending final validation and commit.

## Handoff

**Source:** Fresh focused follow-up reviewer workflow `ffed6eb4-9039-420c-ba8d-82812de5923f`; child `4edec44d`. Recoverable aggregate: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/ffed6eb4-9039-420c-ba8d-82812de5923f/status.json`; raw output: `.pi-subagents/artifacts/4edec44d_reviewer_0_output.md`.

**Purpose:** Independently verify both user-authorized corrections, their ownership/race boundaries, regression coverage, and the fresh browser evidence.

**Outcome:** No blockers or required fixes. The reviewer confirmed that geometry now rejects control centers closer than 20 units, the generation-tagged acknowledgement cannot clear a newer request, Sidebar retains unread/worktree ownership, exact DAG metadata and AppShell selection ownership remain unchanged, and no navigation path changes right-panel state.

**Evidence:** The handoff cites `components/SessionDagPreview.tsx`, `lib/session-dag-svg.ts` and its boundary tests, `components/AppShell.tsx`, `components/SessionSidebar.tsx`, the ignored browser harness lines that stage unread/manual-worktree state, and the passing browser report with zero TD/LR collisions and owned hit targets. The reviewer independently ran related focused tests, TypeScript, lint, and whitespace checks successfully.

**Uncertainty / gaps:** The mounted same-session regression remains exercised by the ignored isolated browser harness rather than a tracked component-mount test; tracked structural assertions cover the narrow ownership wiring. No functional gap was identified.

**Recommended use:** Accept the corrections and proceed to final parent validation, commit, and guarded closeout.
