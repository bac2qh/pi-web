# DAG Preview Quick Add and Larger Edge Controls

Status: approved

## Objective

Make graphical DAG authoring easier in two related ways:

- enlarge the existing Preview edge-action dot and its revealed **Swap** and **Insert** controls so they are easier to activate; and
- from an existing rendered node `X`, add a dependency to one exact entered session ID in either direction: `entered session → X` or `X → entered session`, without switching to Raw.

Success means both directions create exactly one ordinary active edge through the existing graph authority, the entered session ID remains the graph identity, failures are recoverable, and existing Preview/Raw, completion, Swap, and edge Insert behavior remains intact.

## Design / Implementation Strategy

- Resize the existing trusted SVG edge action as one coherent control: increase the nominal visible-dot diameter from 8 to about 10 SVG units, its hit target from 22 to about 28, and each revealed button from 40×18 to about 48×22 with a 9-unit label. Permit only small geometry adjustments during browser validation to prevent clipping or overlap; both the visible dot and buttons must remain materially larger. Preserve midpoint ownership, one-expanded-edge behavior, keyboard semantics, self-edge handling, and trusted-sibling separation from generated Mermaid.
- Add one persistent focusable **+** control at the top-left of each rendered active node, opposite the existing top-right completion check when that check is present. Keep the Mermaid node itself inert. Activating **+** opens a trusted HTML mini-form anchored to that node with one bounded exact session-ID input and two explicit submit buttons: **Incoming: ID → this node** and **Outgoing: this node → ID**. Do not assume a default direction or submit from the input's Enter key; the chosen direction button submits immediately.
- Reuse `SessionDagPanel`'s existing serialized `runMutation` path and strict `add_edge` operation. When the queued operation is built, prove the anchor is still active, rederive its deterministic current form assignment, build one fresh edge ID, and send the chosen endpoint order. Do not add a new route operation, persisted node type, schema version, dependency, session picker, isolated-node state, or native-session mutation.
- Allow the entered session ID either to be absent from the active graph or to identify another active node. Reject an ID equal to the selected anchor node before mutation because both direction actions would produce the same self-edge and would not connect another node. In the absent-ID case, the accepted edge makes a newly connected rendered node; in the existing-ID case, it links existing graph nodes. Let current authority validate session availability, completion state, duplicate directed pairs, edge limits, revision conflicts, and Redo clearing. Adopt authoritative success/conflict state exactly as Raw edge addition does. Keep the submitted direction and session ID available after rejection for correction and retry.
- Keep all authored controls in Pi-Web-owned trusted sibling layers. Generated Mermaid nodes and CSS remain inert/untrusted; exact session IDs must not be added to Mermaid structural identifiers, DOM attributes, logs, or telemetry.
- Preserve at most one open Preview authoring interaction at a time across edge and node controls, with predictable pointer/keyboard activation, Escape/outside dismissal, pending suppression, and focus restoration. On rejection, retain the exact-ID draft and restore focus to the chosen direction action; on success, let authoritative rerendering close the form and restore focus to the unchanged anchor's **+** when available. Preserve an applicable rejected draft across an unchanged authoritative rerender.
- Extend focused SVG/control and component tests, then perform a bounded browser check for both directions, rejection/retry, keyboard/focus behavior, themes, graph directions, responsive widths, and coexistence with current-session and completion markers. Update maintained DAG architecture/memory text only where the new behavior changes the documented Preview contract.

**Rough scope estimate:** Surfaces: trusted Preview SVG/HTML controls, panel callback/wiring, focused DAG tests, and maintained DAG documentation. The existing graph reducer/store/route require regression execution but no source change is expected. Testability: high for mutation construction and control state; moderate for geometry, focus, and responsive presentation. Implementation difficulty: moderate because edge creation is already supported, while safe node-attached authoring and a unified interaction/focus lifecycle require care.

## Reference Files

- [../../AGENTS.md](../../AGENTS.md)
- [../../components/SessionDagPreview.tsx](../../components/SessionDagPreview.tsx)
- [../../components/SessionDagPanel.tsx](../../components/SessionDagPanel.tsx)
- [../../components/SessionDag.test.mjs](../../components/SessionDag.test.mjs)
- [../../lib/session-dag-svg.ts](../../lib/session-dag-svg.ts)
- [../../lib/session-dag-svg.test.mjs](../../lib/session-dag-svg.test.mjs)
- [../../lib/session-dag.ts](../../lib/session-dag.ts)
- [../../lib/session-dag.test.mjs](../../lib/session-dag.test.mjs)
- [../../app/globals.css](../../app/globals.css)
- [../memory/session-dependency-graph.md](../memory/session-dependency-graph.md)
- [2026-08-08-session-dag-view.md](2026-08-08-session-dag-view.md)
- [2026-08-24-session-dag-edge-swap-labels.md](2026-08-24-session-dag-edge-swap-labels.md)
- [2026-08-26-dag-edge-insert-control.md](2026-08-26-dag-edge-insert-control.md)

## Constraints and Current Evidence

- Exact session IDs are graph identity. The persisted graph has edges and completion-derived terminal nodes, but no standalone node record; creating `C → X` or `X → C` through `add_edge` is therefore the existing way to make `C` appear.
- Forms are numbered authoring sections without graph semantics. `deriveSessionDagNodeFormAssignments()` already gives each active node a deterministic surviving form, including terminal fallback, so Preview can add the new edge without exposing form selection.
- Existing `add_edge` already performs generation-current session discovery and strict availability, completion, duplicate-pair, capacity, ordering, receipt, revision, persistence, and conflict validation.
- Current edge controls use nominal SVG geometry of radius 4 inside a radius-11 hit target; revealed buttons are 40×18 with 8-unit labels. The accepted target is approximately radius 5, radius 14, and 48×22 with 9-unit labels respectively, subject only to small overlap/clipping corrections during browser validation.
- Preview already owns validated alias-to-node and alias-to-edge maps, one trusted sibling SVG control layer, and one trusted sibling HTML overlay layer. Node completion controls currently use validated node geometry; these are the nearest reusable seams.
- Current authored edge interaction permits only one expanded edge, preserves an Insert draft after rejection, serializes mutation activation, and dismisses with Escape/outside activation. Node addition should extend rather than duplicate that lifecycle.
- The graph permits cycles, self-edges, reverse pairs, and disconnected components, while rejecting only an exact duplicate directed pair. Existing `add_edge` also permits an endpoint already active elsewhere in the graph. This change preserves those graph-wide rules; only the quick-add UI rejects its own anchor ID because that interaction is for connecting a different session. It does not add orphan-node authoring.
- Unrelated working-tree changes are present and must remain untouched. Do not run `next build`.

## User Decisions

- **User decision (2026-08-30):** every rendered active node gets a persistent focusable top-left **+**, opposite its eligible completion check. It opens a node-anchored mini-form while the Mermaid node remains inert.
- **User decision (2026-08-30):** the form accepts one exact session ID with no picker and two direct submit buttons—**Incoming: ID → this node** and **Outgoing: this node → ID**. Neither direction is a default, so Enter in the input must not guess.
- **User decision (2026-08-30):** the entered ID may be absent from the active graph or identify a different active node. Reject the anchor's own ID only in quick-add; preserve existing Raw/persisted self-edge semantics. The workflow creates a connected edge, never an orphan node.
- **User decision (2026-08-30):** enlarge both the visible edge-action dot and revealed Swap/Insert buttons to the recommended approximate 10-unit dot, 28-unit hit target, and 48×22 buttons with 9-unit labels; allow only minor overlap/clipping corrections during validation.

## Test Strategy

- Focused control tests for enlarged geometry, trusted namespacing, safe node mapping/placement, truthful incoming/outgoing submit labels, no implicit Enter direction, pointer and keyboard activation, one-open-interaction behavior, dismissal, pending suppression, rejection recovery, and focus restoration.
- Component tests proving both direction choices build one exact existing `add_edge` operation with a stable fresh edge ID, state-current anchor/form validation, and the entered session ID in the correct endpoint position.
- Regression tests for same-anchor rejection without a request and for duplicate, unknown, completed, stale, capacity, and Redo behavior through the unchanged `add_edge` authority, plus coexistence with existing graph self-edges, edge Swap/Insert, eligible completion controls, and selected-session marking.
- Isolated browser validation in TD/LR, light/dark themes, and representative narrow/wide panels because node-control placement, larger hit targets, overlap, and focus behavior are visual.

Expected implementation gates:

```bash
NODE_ENV=test node --test components/SessionDag.test.mjs lib/session-dag.test.mjs lib/session-dag-svg.test.mjs lib/session-dag-route.test.mjs lib/session-dag-store.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`.

## Telemetry / Debuggability

Reuse existing bounded Preview failure diagnostics and user-visible mutation feedback. No new telemetry channel is needed. Do not log session IDs, edge IDs, endpoint pairs, labels, input values, Mermaid source, paths, mutation payloads, or graph state.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | The existing edge-action dot and revealed Swap/Insert controls are visibly and operably larger without overlap, clipping, loss of midpoint association, or regression in pointer/keyboard behavior. | Focused SVG geometry tests and browser checks in TD/LR, themes, and representative panel widths. | Stop; adjust only trusted control geometry/styles and preserve established interaction semantics. |
| VC-002 | Every rendered active node `X` has a persistent focusable top-left **+** that leaves the node inert and opens a node-anchored mini-form capable of submitting exactly one ordinary edge in either chosen direction, `C → X` or `X → C`, using one bounded exact session ID and the node's deterministic form assignment. | Trusted-control/component tests plus realistic browser success flows for both directions and terminal/ordinary nodes. | Stop; correct control placement, endpoint order, node/form mapping, or availability without adding whole-node activation, standalone-node, or schema machinery. |
| VC-003 | A quick-add ID equal to anchor `X` submits no request and receives clear correctable feedback. Other server-valid additions advance one authoritative revision and preserve established ordering/Redo semantics; invalid, duplicate, completed, unavailable, stale, or over-limit additions leave graph authority unchanged and retain a correctable Preview draft with bounded feedback. | Component no-request coverage, the existing reducer/route/store regression suite, and browser rejection/retry coverage. | Stop; repair the quick-add guard or reuse the existing `add_edge` authority/recovery path rather than adding optimistic or multi-request behavior. |
| VC-004 | Node addition is accessible and remains isolated from generated Mermaid: controls have truthful direction-specific names, make no implicit Enter-key direction choice, support pointer and keyboard use, allow only one open authored interaction, suppress duplicate pending work, dismiss and restore focus predictably, and do not expose exact IDs structurally or diagnostically. | Trusted-control/component tests, keyboard browser pass, and final security/privacy inspection. | Fail Preview closed to Raw and correct interaction, trust-boundary, focus, or privacy behavior. |
| VC-005 | Raw authoring, edge Swap/Insert, completion, selected-node marking, Undo/Redo, Refresh, Preview retention, responsive layout, and maintained DAG documentation remain coherent. | Required gates, bounded browser regression pass, and final diff/documentation review. | Stop and fix regressions within the approved scope or report a blocker. |

## Assumptions, Risks, and Blockers

- Assumption: “new node” means a current Pi session identified by exact ID that becomes connected through the new edge; no separate node persistence is needed. Per the user decision, an ID already represented by a different active node is also valid and creates only the additional edge.
- Assumption: form choice is presentation bookkeeping, so the selected node's existing deterministic form assignment is the least surprising owner for the added edge.
- Risk: adding controls to every rendered node can collide with labels, completion controls, edges, or each other, especially in dense graphs and narrow panels.
- Risk: edge and node authoring need one coordinated interaction owner so focus and drafts do not become inconsistent across authoritative rerenders.
- Blocker: none currently known.

## Implementation Handoff

Launch only this approved ordinary plan with:

```text
/start-implementation .agents/plans/2026-08-30-dag-preview-node-edge-addition.md
```
