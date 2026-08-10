# Highlight Current Session in the DAG

Status: approved

## Objective

Make exactly one product behavior change: while the graphical Preview of the DAG tab is visible, visually highlight one existing rendered node if and only if its exact session ID equals Pi Web's currently selected chat session ID.

If the selected session is not a rendered node in the current Preview, show no current-session highlight. Nothing else about the DAG, session selection, or application behavior changes.

## Design / Implementation Strategy

- Treat `AppShell`'s `selectedSession?.id` as the sole authority for the current in-focus session. This is the same exact ID already used by sidebar selection and URL restoration; running status, browser DOM focus, native ancestry, and DAG eligibility do not redefine it.
- Pass only that selected session ID through `SessionDagPanel` to `SessionDagPreview`. Reuse the existing visibility gate: the right panel must be open, the DAG tab selected, and Preview visible before a marker is applied.
- Keep selection marking separate from Mermaid compilation/rendering. A session click must not parse or render Mermaid again, fetch session/DAG state, replace the ShadowRoot, move keyboard focus, or scroll the graph.
- Reuse the two maps already produced by the DAG path: `CompiledSessionDag.aliasesBySessionId` resolves exact session ID to generated alias, and `PreparedSessionDagSvg.nodeGroupsByAlias` resolves that alias to the validated SVG node. This gives direct lookup without a new `Set`, table, or linear DOM scan.
- Retain the prepared render lookup in a ref and manage one trusted current-node marker. Remove the previous marker before applying the next one; also clear it when selection becomes null, the selected ID is absent/completed, Preview becomes inactive, rendering fails or is replaced, or the component unmounts. Reapply the latest selection after a successful fresh render.
- Style the marked node from the trusted ShadowRoot stylesheet, not from generated Mermaid source or application-global CSS. Use a stable accent outline/stroke plus a restrained selected background treatment that remains distinguishable without animation in light and dark themes and does not obscure labels, edges, tooltips, or completion controls. The marker is presentation state, not an additional graph control and not keyboard focus.
- Preserve every other behavior and graph boundary: no Raw marker, path highlighting, automatic opening, scrolling, focus movement, interaction change, API/store/schema change, persisted current-session field, graph revision change, session discovery coupling, new telemetry, or change to labels, tooltips, edges, completion eligibility, or controls.

**Rough scope estimate**

- **Surfaces:** `AppShell`, `SessionDagPanel`, `SessionDagPreview`, the trusted SVG marker/style seam, and focused DAG/tab tests. No server, persistence, route, or native-session surface.
- **Testability:** strong for prop flow, direct lookup, lifecycle cleanup, and non-rerender contracts through focused Node/source tests; the visual and ShadowRoot behavior needs a bounded browser pass because the repository has no committed browser interaction harness.
- **Implementation difficulty:** low. The main care is avoiding an unnecessary Mermaid rerender and clearing stale DOM markers across retained-tab/render lifecycles.

## Reference Files

- [../../AGENTS.md](../../AGENTS.md)
- [../../components/AppShell.tsx](../../components/AppShell.tsx)
- [../../components/SessionDagPanel.tsx](../../components/SessionDagPanel.tsx)
- [../../components/SessionDagPreview.tsx](../../components/SessionDagPreview.tsx)
- [../../components/SessionDag.test.mjs](../../components/SessionDag.test.mjs)
- [../../lib/session-dag.ts](../../lib/session-dag.ts)
- [../../lib/session-dag-svg.ts](../../lib/session-dag-svg.ts)
- [../../lib/session-dag-svg.test.mjs](../../lib/session-dag-svg.test.mjs)
- [../../lib/right-panel-tabs.test.mjs](../../lib/right-panel-tabs.test.mjs)
- [../memory/session-dependency-graph.md](../memory/session-dependency-graph.md)
- [./2026-08-08-session-dag-view.md](./2026-08-08-session-dag-view.md)

## Constraints, Decisions, and Current Evidence

- The selected session already lives in `AppShell` and is updated by sidebar selection, initial URL restoration, new-session creation, and fork transitions.
- `dagPanelActive` is already exactly `rightPanelOpen && activeRightPanelTabId === RIGHT_PANEL_DAG_TAB_ID`; Preview further gates work on `mode === "preview"`.
- The compiled and prepared graph already retain the two maps needed for direct exact-ID lookup. Adding another hash structure would duplicate state; scanning rendered nodes would ignore the safer alias-validation seam.
- The DAG is lazily mounted and then retained across tab switches and hide/reopen. Marker cleanup must therefore follow active visibility rather than relying on component unmount.
- The validated Mermaid graph lives in an open ShadowRoot. Its trusted stylesheet is the correct styling owner; `app/globals.css` cannot style the graph's internal node directly.
- Focused baseline validation passed 21/21 DAG SVG, panel, tab, and panel-layout tests on 2026-08-10.
- **User decision (2026-08-10):** The only product change is highlighting the matching node in graphical Preview when `selectedSession?.id` identifies a rendered DAG node. Raw and every other behavior remain unchanged.

## Test Strategy

- Extend focused source/unit coverage to prove the selected ID flows from `AppShell` to Preview, uses the existing alias/node maps, and does not become a Mermaid render-key dependency.
- Cover marker replacement and clearing for matching, nonmatching, null, inactive, failed/replaced render, and unmount cases at the closest practical pure/helper seam.
- In a bounded browser pass, select two graph sessions in succession and then a nonmember while Preview is visible; verify exactly one, then the next, then no node is marked.
- Verify DAG hide/reopen, DAG/file tab switches, Preview/Raw switches, graph refresh/revision replacement, initial URL restore, and a completed/removed active node do not leave a stale marker.
- Check light/dark themes and representative desktop/mobile panel sizes; confirm labels, edges, exact-ID tooltip, completion controls, pointer behavior, keyboard focus, and graph scrolling remain intact.
- Record graph revision, relevant request count, Mermaid SVG/ShadowRoot identity, and console output around session switches to prove the marker is local presentation state rather than a reload or mutation.

Required implementation gates:

```bash
NODE_ENV=test node --test components/SessionDag.test.mjs lib/session-dag-svg.test.mjs lib/right-panel-tabs.test.mjs lib/panel-layout.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`.

## Telemetry / Debuggability

Not applicable. A selected session not being an active DAG node is an ordinary state, not an error. Keep existing bounded Mermaid failure diagnostics unchanged and do not log session IDs, aliases, labels, graph source, or marker transitions. Browser inspection can use a stable non-sensitive current-node marker on the trusted SVG node.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | While graphical Preview is actually visible, the exact selected session is visibly marked if and only if it has a rendered DAG node; changing, clearing, completing, or selecting a nonmember session updates to at most one correct marker. | Focused lifecycle tests plus browser selection, completion, null-selection, and nonmember flows in light and dark themes. | Stop implementation and fix the selected-ID authority, lookup, or cleanup lifecycle; do not accept stale or multiple markers. |
| VC-002 | Session selection changes only local presentation: they do not rerender Mermaid, replace the retained ShadowRoot/SVG, fetch or mutate DAG/session state, advance graph revision, scroll the graph, or move keyboard focus. | Browser DOM-identity, request-count, revision, scroll-position, and active-element checks around repeated selection changes; focused source tests keep selection out of the render key/effect. | Move marker work back to a separate DOM effect/ref path and remove any render, network, mutation, focus, or scroll coupling. |
| VC-003 | The marker is readable and stable across themes, responsive panel sizes, tab/mode hide/reopen, refresh/render replacement, and existing explicit completion controls without weakening the validated SVG/ShadowRoot trust boundary. | Focused SVG/style tests, browser visual and pointer/keyboard checks, then typecheck, lint, diff check, and review for privacy-sensitive output. | Fail closed to the unmarked graph, correct trusted styling/lifecycle code, and rerun the affected and full required gates. |

## Assumptions, Risks, and Blockers

- **Assumption:** “currently in focus” means Pi Web's selected chat session, not the browser's focused element and not a running background session.
- **Assumption:** The marker identifies only the current node. It does not highlight prerequisite paths, auto-open the DAG, change Preview/Raw mode, pan/scroll to the node, or revive completed nodes.
- **Risk:** Adding the selected ID to the existing Mermaid render effect would make every sidebar click expensive and could disrupt completion-control focus. The separate marker effect/ref is mandatory.
- **Risk:** Because the DAG stays mounted while hidden, marker removal and reapplication must be explicit across visibility and render generations.
- **Blocker:** None.

## Implementation Handoff

After approval, start implementation with:

```text
/start-implementation .agents/plans/2026-08-10-highlight-current-dag-session.md
```
