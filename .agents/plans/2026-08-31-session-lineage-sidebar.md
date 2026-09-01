# Session Lineage Sidebar

Status: approved

## Objective

Make a selected Pi session's native family easy to navigate from the left sidebar without finding it in a long Project tree.

Success means:

- The sidebar order is Pinned, Recent, Lineage, Project, Explorer; Lineage starts expanded and Project starts collapsed, with independent reload-local open states and scroll positions.
- Selecting a visible session keeps Recent's current navigation behavior, expands and reveals that row only in Lineage without moving keyboard focus, and never auto-expands or scrolls Project.
- Lineage shows the complete available family from the oldest reachable ancestor through every descendant, including sibling and cousin branches, while preserving the existing Hide/Show hidden policy.
- Both Lineage and Project use clear continuous ancestor lines and child elbows. Sibling subtrees are newest-first by the latest `modified` activity anywhere in each subtree and render depth-first.
- Existing project/worktree selection, row actions, pin/hide/unread/running behavior, Explorer ownership, accessibility, and narrow-screen behavior remain coherent.

## Design / Implementation Strategy

1. Reuse the complete `allSessions` listing and its resolved native `parentSessionId` links. Do not introduce another graph, persistence file, or server endpoint.
2. Derive a selected-session lineage tree from the global listing, independent of the selected project/worktree. Its confirmed boundary is the selected session's oldest available ancestor plus every available descendant from that root, including sibling and cousin branches; unrelated roots are excluded.
3. Generalize the existing recursive Project row/tree rendering so Project and Lineage share row actions and use clearer tree connectors: a vertical continuation for ancestors that have later siblings and an elbow into each child. Traverse depth-first, completing one child's subtree before the next sibling. Rank sibling subtrees by the most recent session activity anywhere in each subtree, using the same `SessionInfo.modified` activity authority as Recent; retain deterministic own-activity/ID tie-breaks. In Lineage, preserve full project/worktree context in every tooltip and accessible name, but add a visible compact prefix only when a row's project/worktree context differs from the selected session. The confirmed shape is:

   ```text
   Root
   ├── Newer child B
   │   ├── Newer grandchild B2
   │   │   └── Selected session
   │   └── Older grandchild B1
   └── Older child A
       ├── Newer grandchild A2
       └── Older grandchild A1
   ```
4. Add a Lineage section that reacts directly to `selectedSessionId`; the existing Recent click path already changes that authority, so no duplicate navigation state is required. Keep reload-local collapsed-node IDs keyed by session ID. Every selection change removes the selected session's available ancestor path from that set and scrolls its row into the open Lineage viewport without moving keyboard focus; unrelated branches retain their manual state. If Lineage itself is closed, preserve that explicit section state and perform the pending reveal when it is next opened. Project updates selected-row highlighting only and preserves its branch expansion and manual scroll position.
5. Apply the existing global hidden projection before rendering Lineage: normal mode omits hidden subtrees; Show hidden reveals and labels explicit/inherited hidden rows. If the selected session is hidden while normal mode is active, show a bounded explanation instead of silently restoring or exposing it. If no persisted session is selected or the selected ID is not yet in the latest successful listing, show a compact non-error unavailable state and let the next ordinary refresh derive the tree; never guess ancestry.
6. Compose the sidebar as Pinned, Recent, Lineage, Project, then Explorer. Place expanded-by-default Lineage and collapsed-by-default Project in separate section containers. Their reload-local open states are fully independent: opening or closing either section never reads or changes the other's state. When both are open, each tree receives a usable share of the available height and owns its own vertical scrolling. Preserve the ordinary selection path, pin/unread state, worktree handling, and Explorer ownership.
7. Update maintained English/Chinese feature and architecture descriptions to include Lineage, the new section defaults/order, and collapsible Project without changing the documented native ancestry or Hide semantics.

**Rough scope estimate:** Primarily `SessionSidebar`, existing pure sidebar tree derivation, sidebar CSS, focused Node/Jiti tests, and small maintained-documentation updates. No API, schema, dependency, or persisted-state change is expected. Testability is high for lineage membership/traversal/order, moderate for source-level interaction contracts, and manual for connector clarity because the repository has no DOM interaction harness. Implementation difficulty is moderate: the data already exists, but global lineage, hidden descendants, duplicated row presentations, section height ownership, selection reveal, and deep-tree connectors must remain coherent.

## Reference Files

- [`components/SessionSidebar.tsx`](../../components/SessionSidebar.tsx) — current Pinned/Recent/Project/Explorer composition, selection authority, recursive Project rows, local collapse state, and row actions.
- [`lib/sidebar-session-state.ts`](../../lib/sidebar-session-state.ts) — hidden-descendant closure, global section derivation, and cycle-safe Project tree construction/sorting.
- [`lib/session-reader.ts`](../../lib/session-reader.ts) — complete session listing and native parent-path-to-`parentSessionId` resolution.
- [`lib/types.ts`](../../lib/types.ts) — client `SessionInfo` ancestry/project/worktree contract.
- [`lib/sidebar-session-state.test.mjs`](../../lib/sidebar-session-state.test.mjs) — pure ancestry, cycle, hidden-state, Recent, and tree-order test surface.
- [`components/SessionSidebar.test.mjs`](../../components/SessionSidebar.test.mjs) — current Node/Jiti source and exported-component sidebar contract tests.
- [`README.md`](../../README.md) — maintained English feature notes and component map.
- [`README.zh-CN.md`](../../README.zh-CN.md) — maintained Chinese feature notes and component map.
- [`AGENTS.md`](../../AGENTS.md) — maintained sidebar, native ancestry, hidden-state, worktree, and validation constraints.

## Decisions and Current Evidence

### User-authorized decisions

- Lineage uses the complete available native family, not only the selected ancestor path and descendants. It ranks sibling subtrees by their latest descendant activity and shows visible project/worktree context only when it differs from the selected session.
- Lineage retains branch collapse controls and automatically reveals the selected path. Project becomes collapsible but never auto-expands or scrolls in response to selection.
- Section order/defaults are Pinned, Recent, expanded Lineage, collapsed Project, Explorer. Lineage and Project open, close, size, and scroll independently rather than acting as an accordion.
- Lineage follows the existing Hide/Show hidden policy, and the stronger connector treatment applies to both trees.

### Established current state and constraints

- The relevant graph is native `parentSession` ancestry created by Fork, Clone, Side conversation, and hosted implementation launches—not dependency-DAG edges or in-file message branches.
- `SessionSidebar` already loads all sessions. Every existing row presentation shares one selection path that clears unread state, changes cwd when needed, and calls `onSelectSession`.
- `session-reader.ts` resolves `parentSessionId` only when the parent file is discoverable in the same complete listing. A missing parent is therefore the oldest authoritative root; the client must not infer beyond it.
- Project already has cycle-safe depth-first tree derivation, latest-visible-descendant ordering, shared recursive rows, and per-node collapse. Its current single short guide does not show continuing ancestor branches or child elbows.
- Hidden closure is computed from the raw global ancestry graph before presentation filtering and remains authoritative for every sidebar section.
- A temporary/new selected session may not yet exist in `allSessions`; Lineage remains a non-error unavailable state until ordinary discovery supplies authoritative ancestry.
- No API, persistence schema, dependency, or new collapse-preference storage is needed. Recent's membership and selection behavior remain unchanged.
- Baseline focused evidence on 2026-08-31: `node --test lib/sidebar-session-state.test.mjs components/SessionSidebar.test.mjs` passed all 21 tests.

## Test Strategy

Extend the existing pure sidebar-state tests for selected-family membership, reachable roots, multi-level branching, cycles, deterministic activity order, missing ancestors, unavailable selections, cross-context labels, and the agreed hidden-session policy. Extend `SessionSidebar.test.mjs` with the closest source/exported-component contracts for section order/defaults, independent collapse ownership, selected-path reveal, preserved Project scroll behavior, shared row actions, keyboard controls, and connector semantics. Use desktop/mobile browser checks for connector clarity, independent scrolling, section and branch collapse, selected-row reveal without focus theft, deep nesting, and visible/hidden/cross-worktree families.

Run:

```bash
node --test lib/sidebar-session-state.test.mjs components/SessionSidebar.test.mjs
node --test lib/*.test.mjs components/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`. Automated DOM interaction coverage is not applicable because the repository has no such harness and adding one would materially exceed this UI change; pure/source contracts plus explicit browser validation are the substitute.

## Telemetry / Debuggability

New telemetry is not applicable: this is a deterministic client projection of the existing session list and selection, with no new server state or ambiguous background operation. Keep existing session-list errors and browser/React diagnostics as the recovery evidence. Add no lineage event logging, session IDs, paths, titles, or other high-cardinality/private payloads.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Selecting a visible session presents exactly the agreed native lineage family and visibly identifies the selected row; normal and Show hidden modes apply the confirmed hidden-subtree policy without mutation; cross-context rows are compactly disambiguated. | Pure derivation tests plus representative visible/hidden and cross-worktree branched-session browser checks. | Fix lineage boundary, selection, hidden projection, or context labeling before closeout. |
| VC-002 | Each sibling subtree is ordered by its newest descendant activity, each subtree remains contiguous in depth-first traversal, and both trees show correct continuing ancestor lines and final-child elbows. | Deterministic multi-branch/cycle fixture tests and visual inspection of both tree renderers. | Fix ordering, cycle handling, or connector rendering before closeout. |
| VC-003 | Recent retains its current selection behavior. Selecting any visible session expands and scrolls only its Lineage path into view without moving keyboard focus; Project neither auto-expands nor changes its manual scroll position. | Source/component contract coverage plus browser checks with collapsed ancestors, a long lineage, and an independently scrolled/collapsed Project tree. | Treat as a core workflow, independence, or accessibility regression and fix before closeout. |
| VC-004 | Section order/defaults are Pinned, Recent, expanded Lineage, collapsed Project, Explorer. Lineage and Project expand, collapse, size, and scroll independently without changing session/cwd or persisted sidebar metadata. | Source contract plus short/tall desktop and mobile browser checks with both trees open. | Fix order, default, flex/overflow, or state ownership before closeout. |
| VC-005 | Existing project grouping and row pin/hide/unread/rename/copy/running semantics remain shared and unchanged; absent/unlisted selections show bounded non-mutating Lineage states; no API, schema, or persistent preference is added. | Existing sidebar regression suite, targeted unavailable-selection fixtures, and diff review. | Fix the shared behavior regression or unauthorized state/API expansion before closeout. |
| VC-006 | Both trees remain legible and operable at the existing mobile breakpoint and with keyboard navigation/focus, including deep connectors and selected-row auto-reveal without focus theft. | Browser checks at desktop and `<=640px`, including keyboard activation, visible focus, and deep fixtures. | Fix responsive, connector, or accessibility regression before closeout. |
| VC-007 | Maintained English/Chinese feature and architecture descriptions match the implemented section order, defaults, Lineage scope, and collapsible Project behavior. | Review `README.md`, `README.zh-CN.md`, and `AGENTS.md` against the validated UI. | Correct stale or contradictory documentation before closeout. |
| VC-008 | Focused/full relevant Node tests, TypeScript, lint, and diff checks pass without running `next build`; the browser matrix supplies the intentionally unavailable DOM-interaction layer. | Record exact command output and browser evidence. | Fix failures; mark any environment-blocked layer explicitly rather than weakening another assertion. |

## Assumptions, Risks, and Blockers

- **Assumption:** “lineage” means native `parentSession` ancestry, not dependency-DAG edges or in-file message branches.
- **Assumption:** The required available family can be derived from the already loaded global session list; no ancestry recovery outside that authoritative listing is needed.
- **Risk:** An unavailable ancestor truncates the authoritative family. A hidden selected session intentionally suppresses the tree until Show hidden is enabled; the explanatory state must make that distinction clear.
- **Risk:** A deeply nested family may need stronger visual guides without consuming too much horizontal space on narrow screens.
- **Risk:** Browser auto-scroll can accidentally move an outer page or steal focus; keep reveal scoped to the Lineage scroll owner and validate pointer and keyboard selection.
- **Blockers:** None known.

## Implementation Handoff

Plan path: `.agents/plans/2026-08-31-session-lineage-sidebar.md`

After explicit approval, launch only this plan with:

```text
/start-implementation .agents/plans/2026-08-31-session-lineage-sidebar.md
```
