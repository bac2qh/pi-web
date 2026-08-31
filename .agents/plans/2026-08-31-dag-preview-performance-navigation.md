# DAG Preview Performance and Session Navigation

Status: approved

## Objective

Make DAG Preview additions complete without the current multi-second delay, and add an explicit per-node **Go to session** control that opens that exact session in the main session UI.

Success means:

- adding an incoming or outgoing dependency from Preview gives immediate, trustworthy feedback and reaches the committed rendered state without avoidable multi-second work;
- activating an available rendered node's trusted **Go to session** control selects that exact session through the application's existing session-selection path without changing the right panel's open or expanded state; and
- existing DAG mutation authority, validation, accessibility, active-session highlighting, and session/sidebar behavior remain intact.

## Design / Implementation Strategy

Replace only the identified server bottleneck. `add_edge`, `replace_edge`, and `insert_edge` currently authorize endpoints by running the full metadata-rich session listing, even though storage consumes only a set of exact IDs. Add a dedicated complete session-ID discovery path that scans the configured standard session directories and reads only each file's already-bounded header. Do not add a second metadata cache: the inexpensive scan should produce a fresh complete ID set for each authority attempt. Keep the existing generation-before/after checks, route retry, under-lock generation checks, endpoint set validation, compare-and-set mutation, receipt, atomic write, and authoritative response. Do not change the ordinary metadata-rich `/api/sessions` listing, graph schema, or client mutation queue.

Keep the existing successful client path: one PATCH response is the new authority, followed by one Mermaid rerender. Do not add an optimistic graph commit, a follow-up graph GET, or speculative Mermaid/queue changes. Validation will time the request and render phases separately; if header-only discovery removes the request delay but the end-to-end gate still fails, stop with the measured remaining bottleneck rather than silently expanding this plan.

For reverse navigation, add a third trusted per-node control rather than making the Mermaid node itself clickable. Use a compact circular control matching the existing add/completion controls, with a rightward arrow entering a vertical frame and an explicit accessible **Go to session …** name; it appears at the node's bottom-right corner on every rendered node backed by current session metadata. Keep the existing top-left add and eligible top-right completion controls unchanged. Position the go-to control from validated node geometry, with adjustment limited to avoiding labels, edges, and other controls across TD/LR and responsive layouts while retaining its bottom-right association.

Pass `AppShell`'s existing `handleSelectSession(SessionInfo)` callback into the retained DAG panel. Resolve the control's exact node ID against the panel's already-loaded unfiltered session metadata and call that owner through a trusted listener closure. Reuse the existing compiled exact-ID/alias and prepared alias/node maps; add no ID-bearing DOM attribute, fetch, URL owner, transport owner, or sidebar state. The selected session, chat binding, URL, cwd/sidebar selection, and Preview marker then converge through the existing application path.

Go-to changes only the selected session and never opens, closes, expands, or restores the right panel. In split presentation the visible chat changes immediately; when an expanded/mobile DAG covers the chat, the DAG stays visible and the selected destination appears only after the user manually restores or hides the panel. A hidden-but-available session opens without changing Hide/Restore metadata. An unavailable durable graph node gets no go-to control. The inert Mermaid node, trusted add/completion/edge controls, and HTML forms retain their independent behavior and must never trigger navigation.

**Rough scope estimate:**

- **Surfaces:** bounded session-header identity discovery and DAG route dependency; `AppShell` → DAG panel → Preview selection wiring; trusted go-to geometry/styling/semantics; focused reader/route/SVG/component tests; isolated browser timing/navigation validation; and maintained DAG architecture/memory text. The graph reducer/store schema, right-panel state machine, and ordinary session/sidebar stores remain unchanged.
- **Testability:** high for generation-current ID discovery, route authority, exact callback mapping, and event isolation; user-perceived latency and focus/layout behavior require a warmed isolated browser pass with phase timings.
- **Implementation difficulty:** medium. Both changes have narrow seams, but the header scan must exactly preserve discovery/generation safety and the third node control must coexist with retained trusted controls.

## Reference Files

- [`../../AGENTS.md`](../../AGENTS.md)
- [`2026-08-30-dag-preview-node-edge-addition.md`](2026-08-30-dag-preview-node-edge-addition.md)
- [`../memory/session-dependency-graph.md`](../memory/session-dependency-graph.md)
- [`../../components/SessionDagPanel.tsx`](../../components/SessionDagPanel.tsx)
- [`../../components/SessionDagPreview.tsx`](../../components/SessionDagPreview.tsx)
- [`../../components/AppShell.tsx`](../../components/AppShell.tsx)
- [`../../lib/session-reader.ts`](../../lib/session-reader.ts)
- [`../../lib/session-dag-route.ts`](../../lib/session-dag-route.ts)
- [`../../lib/session-dag-store.ts`](../../lib/session-dag-store.ts)
- [`../../lib/session-dag-svg.ts`](../../lib/session-dag-svg.ts)
- [`../../lib/mermaid-display.ts`](../../lib/mermaid-display.ts)
- [`../../components/SessionDag.test.mjs`](../../components/SessionDag.test.mjs)
- [`../../lib/session-reader.test.mjs`](../../lib/session-reader.test.mjs)
- [`../../lib/session-dag-route.test.mjs`](../../lib/session-dag-route.test.mjs)
- [`../../lib/session-dag-svg.test.mjs`](../../lib/session-dag-svg.test.mjs)

## Current Evidence and Constraints

- The user observed roughly two to three seconds between adding a Preview dependency and resolution/rerender.
- A privacy-safe non-mutating live probe reproduced the server bottleneck: after the 30-second metadata cache expired, an intentionally stale `add_edge` PATCH took **5,869 ms** and returned the expected revision conflict; the immediate warm retry took **2 ms**, and graph revision/edge count remained unchanged.
- In a separate read-only process, the current SDK `SessionManager.listAll()` took **5,486 ms** and **5,471 ms** for 437 sessions across 178 distinct cwd values. It reads every transcript and `loadAllSessions()` then enriches every unique cwd with project/worktree metadata.
- A throwaway read-only prototype that enumerated the same 438 session files and read only their first header chunk found the same 437 valid sessions in **12–19 ms**. This demonstrates that complete ID discovery, not the current small graph's Mermaid work, is the evidenced multi-second root cause.
- Successful mutations already adopt the PATCH authority directly with no follow-up graph GET. Preview immediately marks the form pending, then performs one full Mermaid render after authority changes. Those paths remain unless post-fix phase timing disproves the current diagnosis.
- The current design marks the exact selected chat session in Preview through validated ID → alias → node maps. `AppShell.handleSelectSession()` already owns transport preparation, selected session/chat state, URL replacement, cwd/sidebar convergence, and mobile sidebar closing.
- The unfiltered session list contains hidden sessions, and existing URL restoration can open one without restoring it. A durable graph ID whose native session disappeared compiles as `Session unavailable` and cannot supply the `SessionInfo` required by the selection owner.
- Exact session IDs remain authoritative. DAG actions must not start, stop, schedule, rename, restore, hide, or otherwise mutate a session.
- Generation-current endpoint validation under the graph lock remains authoritative; performance work changes the cost of producing the complete ID set, not the correctness boundary.

## User Decisions

- **2026-08-31:** replace the full transcript/project metadata discovery on DAG endpoint authorization with complete exact-ID discovery; the route does not need transcript or project data.
- **2026-08-31:** navigation is an explicit third trusted node button with a go-to symbol; the Mermaid node itself does not become a click target.
- **2026-08-31:** keep the performance correction and go-to control in this one ordinary plan; they remain separate implementation sections within the same DAG Preview result.
- **2026-08-31:** go-to changes the selected session but never changes right-panel state. Split presentation shows the new chat immediately; an expanded/mobile DAG remains on screen until the user manually restores or hides it.
- **2026-08-31:** the go-to control matches the existing circular node controls, uses a rightward arrow entering a vertical frame, and sits at the node's bottom-right corner; add remains top-left and eligible completion remains top-right.

## Test Strategy

- Add reader tests for complete bounded-header ID discovery across ordinary and symlinked session directories, malformed/unreadable entries, duplicate IDs, and generation changes during a scan. Prove transcript bodies and project/worktree enrichment are not part of this authority path.
- Update route tests so add/replace/insert consume the complete generation-current ID listing, retry only the bounded listing race, and pass its exact set/generation into the unchanged store; other operations still perform no session discovery.
- Extend trusted SVG/component coverage for one go-to control per available rendered node, glyph/geometry and accessible naming, pointer and Enter/Space activation, exact-ID-to-`SessionInfo` resolution, absence on unavailable nodes, hidden-state preservation, already-selected re-open behavior, unchanged right-panel state, and isolation from inert nodes plus add/completion/edge/form controls and pending authored interactions.
- Run existing DAG reducer/store/route/panel/SVG regressions, TypeScript, lint, and whitespace checks; update maintained DAG architecture/memory text to describe ID-only mutation authorization and the go-to control without changing broader session/sidebar contracts.
- Use an isolated browser fixture with at least 400 synthetic session files and a small representative graph. After server/page compilation and initial Mermaid loading are warm, measure a deliberately cold identity-authorized add from click through authoritative response and completed paint, then verify exact chat, URL, sidebar/cwd, and Preview-marker convergence for normal and hidden sessions. Exercise go-to pointer and keyboard activation, unavailable-node control absence, same-node re-open, authoring controls, unchanged split/expanded/mobile panel state, later manual reveal of the already-selected destination, TD/LR geometry, themes, and focus retention.

Do not run `next build`.

## Telemetry / Debuggability

Use isolated test-process and browser Performance/Network timing to record only coarse phase durations and counts: identity scan, PATCH authority, Mermaid render, and final paint. Retain existing bounded failure feedback. No production instrumentation, persistent log, new telemetry channel, session/path/label/graph payload, or high-cardinality identifier is needed.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | A cold Preview add no longer waits for metadata-rich transcript/project discovery: on the isolated 400-session fixture after compile/library warm-up, at least five successful additions have median authoritative-PATCH latency no greater than 250 ms (maximum 500 ms) and median click-to-completed-paint latency no greater than 750 ms (maximum one second), with immediate pending feedback. | Record identity scan, PATCH, Mermaid, and paint durations; confirm one PATCH, zero follow-up graph GETs, and one committed render per addition. | Stop and report the measured dominant phase; do not mask actual latency or add an unplanned optimization. |
| VC-002 | Add/replace/insert still authorize against one complete generation-current exact-ID set under the existing graph lock, while completion/history/form/direction operations still do no session discovery. | Reader/route/store race, unavailable endpoint, conflict, idempotency, and operation-routing tests using a bounded-header fixture with large transcript bodies. | Stop; restore the generation/lock authority before accepting any speed gain. |
| VC-003 | Every available rendered node has one trusted **Go to session** control whose activation invokes the existing exact `SessionInfo` selection path and converges chat binding, URL, cwd/sidebar selected state where presented, and the Preview current marker without a DAG fetch, mutation, Mermaid rerender, or right-panel transition. Covered destinations become visible when the user later restores or hides the DAG. | Executable component/integration assertions plus a browser pass on distinguishable sessions, an already-selected node, split desktop, expanded narrow, and mobile layouts. | Stop; control mapping, selection ownership, or panel-state isolation is incorrect. |
| VC-004 | The go-to glyph is distinct, non-overlapping, accessibly named, focus-visible, and operable by pointer and Enter/Space; hidden sessions remain hidden but open, unavailable nodes have no go-to control, and inert nodes plus add/completion/edge/form controls never navigate or lose established pending/dismissal behavior. | Trusted SVG geometry/event-isolation tests and browser keyboard/pointer/focus flows across TD/LR, themes, normal, hidden, unavailable, open-authoring, and pending-authoring states. | Stop; correct geometry, interaction, accessibility, or state-boundary behavior before acceptance. |
| VC-005 | Existing Raw/Preview authoring, completion, Swap/Insert, selected-node marking, conflict recovery, Undo/Redo, responsive layout, privacy/trust boundaries, and maintained DAG documentation remain intact and coherent. | Existing focused DAG suites, isolated browser regression, TypeScript, lint, `git diff --check`, documentation review, and final review. | Stop and fix the regression within scope or report a blocker. |

## Assumptions, Risks, and Blockers

- “Go to session” selects/opens through the same application path as an explicit sidebar session open while preserving the exact right-panel state. In a covering presentation, selection occurs behind the retained DAG until the user manually restores or hides it.
- Hidden sessions remain hidden while opening, matching existing URL/session selection semantics. Unavailable graph nodes omit the go-to control rather than fabricating session metadata or mutating the graph/sidebar.
- Reopening the already-selected node follows the existing explicit sidebar re-open path rather than inventing separate DAG semantics.
- The bounded-header scan must match the configured agent directory and current native session-directory discovery shape, tolerate races/malformed files, and never accept a stale generation.
- A globally queued full Mermaid render remains a possible independent cost for much larger graphs or competing diagrams, but current live evidence attributes the reported multi-second delay to cold metadata discovery. If VC-001 still fails after that correction, further Mermaid work requires a separately evidenced follow-up rather than automatic scope growth.
- The navigation callback should remain in a ref outside Mermaid render dependencies so changing the selected session cannot cause a graph rerender.
- Unrelated working-tree plan changes are present and must remain untouched.
- No implementation blocker is known.

## Implementation Handoff

After explicit finalization, approval, and a separate requested commit, launch only this ordinary plan with:

```text
/start-implementation .agents/plans/2026-08-31-dag-preview-performance-navigation.md
```
