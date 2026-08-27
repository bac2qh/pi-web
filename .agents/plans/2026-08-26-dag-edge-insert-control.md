# DAG Edge Action and Insert Control

Status: approved

## Objective

Replace each Preview edge's always-visible **Swap** button with a compact clickable dot that expands into **Swap** and **Insert** actions. Preserve Swap's current behavior. Insert must accept an exact session ID and replace an edge `A → B` with `A → C` and `C → B`, without changing unrelated graph state.

Success means the Preview interaction is keyboard-accessible, graph mutations retain the existing revision/conflict guarantees, rejected operations remain recoverable, and Raw authoring behavior is unchanged.

## Design / Implementation Strategy

- Keep Mermaid output inert and reuse its validated edge midpoint only as geometry. Dot, actions, and input remain Pi-Web-owned controls in the trusted sibling control surface; the text input may use a trusted HTML overlay sharing the graph stack but must never be inserted into generated Mermaid content.
- Replace the midpoint Swap control with an edge-action control whose collapsed state is a visually compact, focusable dot with an endpoint-specific accessible name and expanded state. Activating it reveals separate **Swap** and **Insert** buttons. Keep at most one edge expanded, let another dot transfer expansion, dismiss with Escape or outside activation, and restore focus predictably.
- Reuse the existing compare-and-set `replace_edge` path for Swap. A self-edge keeps Insert available while only its no-op Swap action is disabled.
- When Insert is chosen, replace the action pair with a mini-form anchored beside the same midpoint. Autofocus one bounded exact session-ID input and provide **Insert** and **Cancel**; Enter submits, while Escape, Cancel, or outside activation closes the form and returns focus to the dot. Keep the value and form open after rejection so existing feedback can be reviewed and retried.
- Add one strict transient edge-insertion operation; do not change the persisted state schema or version. It will compare-and-set and remove the selected edge, then create fresh `A → C` and `C → B` edge records in the original form. Preserve the first edge at the original presentation order, allocate one new monotonic order for the second, clear Redo, and publish one revision. Under the existing graph lock, validate current `A`, `B`, and `C` session availability, completion state, two distinct fresh edge IDs, final directed-pair uniqueness, final logical-edge capacity, counter bounds, and the complete resulting state before atomic persistence.
- Keep the inserted ID distinct from `A` and `B`; choosing an endpoint would not insert a third node. A valid already-active session elsewhere in the graph may be inserted, subject to the existing duplicate-pair and completion rules.
- Preserve authoritative conflict-state adoption and use the existing feedback region to give a bounded, privacy-safe rejection reason. Accepted authority rerenders the new two-edge graph; rejected Insert keeps the original edge and the editable mini-form.
- Extend focused trusted-control, reducer, route/store, and component tests; add a realistic browser-visible check for collapsed, expanded, success, rejection, keyboard, focus restoration, dismissal, themes, graph directions, and self-edge behavior. Update maintained DAG architecture and memory text that currently describes Swap-only midpoint controls and add/replace-only discovery.

**Rough scope estimate:** Surfaces: Preview trusted controls/overlay, panel mutation callback, graph operation/reducer/store/route validation, focused tests, and maintained DAG documentation; no Raw UI redesign or persisted schema change. Testability: high at pure operation/control layers and moderate for rendered positioning and focus. Implementation difficulty: moderate because Insert is visually small but requires an atomic one-edge-to-two-edge mutation across the strict persisted graph contract.

## Reference Files

- [../../AGENTS.md](../../AGENTS.md)
- [../../components/SessionDagPreview.tsx](../../components/SessionDagPreview.tsx)
- [../../components/SessionDagPanel.tsx](../../components/SessionDagPanel.tsx)
- [../../lib/session-dag-svg.ts](../../lib/session-dag-svg.ts)
- [../../lib/session-dag.ts](../../lib/session-dag.ts)
- [../../lib/session-dag-route.ts](../../lib/session-dag-route.ts)
- [../../lib/session-dag-store.ts](../../lib/session-dag-store.ts)
- [../../lib/session-dag-svg.test.mjs](../../lib/session-dag-svg.test.mjs)
- [../../lib/session-dag.test.mjs](../../lib/session-dag.test.mjs)
- [../../lib/session-dag-route.test.mjs](../../lib/session-dag-route.test.mjs)
- [../../lib/session-dag-store.test.mjs](../../lib/session-dag-store.test.mjs)
- [../../components/SessionDag.test.mjs](../../components/SessionDag.test.mjs)
- [../../app/globals.css](../../app/globals.css)
- [../memory/session-dependency-graph.md](../memory/session-dependency-graph.md)
- [2026-08-24-session-dag-edge-swap-labels.md](2026-08-24-session-dag-edge-swap-labels.md)

## Constraints and Current Evidence

- Exact session IDs are graph identity; labels are presentation only.
- The graph allows cycles, self-edges, and reverse pairs, but rejects exact duplicate directed edges.
- Preview controls must remain trusted siblings of validated Mermaid output so generated SVG/CSS cannot own or select the dot, action buttons, or insert form.
- Current `replace_edge` is compare-and-set for one edge. Insert cannot safely be represented as independent client-side delete/add requests because an intermediate or partial graph would become authoritative.
- The persisted graph has no standalone node record: a valid inserted session becomes an active node through the two resulting edges. The existing operation parser is exact, and only add/replace currently trigger generation-current session discovery, so the new operation must be added to both strict parsing and lookup gates.
- Edge IDs are globally unique across active and completion-history records; active ordering and `nextEdgeOrder` are validated on every write. Removing the old edge and allocating two fresh IDs therefore needs explicit final-state ID, order, capacity, and duplicate-pair checks.
- Existing graph mutations clear Redo after direct semantic changes and return authoritative conflict state without silent replay; Insert must follow the same rules.
- The inserted session must differ from both selected endpoints. Existing graph nodes remain valid insertion targets; cycles, reverse pairs, and self-edges remain allowed when the final two directed pairs are not duplicates.
- Unrelated existing working-tree changes are present and must remain untouched.

## User Decisions

- The collapsed midpoint control is a simple clickable dot.
- Expanding the dot reveals **Swap** and **Insert**.
- Swap reverses only the selected edge.
- Insert replaces `A → B` with `A → C` and `C → B` and changes no unrelated edge.
- **User decision (2026-08-26):** choosing Insert opens a mini-form anchored beside the expanded midpoint control. It accepts one exact session ID rather than opening a modal or adding a searchable session picker.

## Test Strategy

- Pure graph-operation tests for successful atomic insertion, fresh IDs/order/form ownership, and rejection on stale expectations, endpoint reuse, unknown/completed sessions, duplicate final pairs, ID collisions, capacity/counter limits, and existing retry/mutation-ID rules.
- Route/store tests that prove Insert uses a generation-current complete session listing, persists both replacement edges together under one revision, and leaves the original state unchanged on every rejection.
- Trusted-control tests for safe namespacing, endpoint labels, collapsed/expanded state, pointer and Enter/Space activation, Escape/outside dismissal, focus behavior, pending/rejected state, and self-edge handling.
- Component wiring tests for the Preview callback, bounded input, feedback, and authoritative-state rerender path.
- Isolated browser validation in both graph directions, light/dark themes, and representative narrow/wide panels because midpoint expansion, form placement, hit targets, and focus are visual behavior.

Required implementation gates:

```bash
NODE_ENV=test node --test components/SessionDag.test.mjs lib/session-dag.test.mjs lib/session-dag-svg.test.mjs lib/session-dag-route.test.mjs lib/session-dag-store.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`.

## Telemetry / Debuggability

Reuse the existing bounded Preview failure event for render/control-construction failures, store diagnostics for operation failures, and user-visible mutation feedback. Do not add a new telemetry channel or log session IDs, edge IDs, endpoint pairs, input values, labels, paths, Mermaid source, mutation payloads, or graph state.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Every Preview edge shows a compact midpoint dot that expands accessibly into Swap and Insert actions, permits only one expanded edge, supports pointer and keyboard dismissal/focus restoration, and leaves Mermaid-generated content inert. | Focused trusted-control/component tests plus isolated browser inspection with pointer and keyboard. | Stop; correct trusted-control construction, interaction, focus, or positioning before closeout. |
| VC-002 | Swap still changes only `A → B` to `B → A`, with current conflict, duplicate, self-edge, pending, and rejection behavior preserved. | Existing and updated reducer/store/SVG/component tests. | Stop; restore the established Swap contract. |
| VC-003 | Inserting a distinct valid `C` changes `A → B` to exactly fresh `A → C` and `C → B` edges in the original form through one authoritative revision, preserving unrelated graph state and established Redo/ordering semantics. | Reducer and route/store tests plus a realistic Preview workflow and persisted-state inspection. | Stop; do not accept a partial, multi-request, or schema-changing implementation. |
| VC-004 | Invalid or conflicting Insert attempts leave `A → B` authoritative, retain the user's input for correction, and provide bounded actionable feedback without exposing private graph/session payloads. | Tests for endpoint reuse, unknown/completed IDs, stale expectations, duplicate pairs, capacity rejection, and failed UI submission. | Stop; preserve the original edge and repair validation, recovery, or feedback. |
| VC-005 | Raw authoring, completion controls, selected-node highlighting, Undo/Redo, graph refresh, TD/LR rendering, themes, responsive layout, strict SVG validation, and maintained DAG documentation remain coherent. | Required gates, isolated browser regression check, final diff/privacy review, and documentation inspection. | Stop; fix the regression within the touched behavior or report a blocker. |

## Assumptions, Risks, and Blockers

- Assumption: both split edges remain in the original edge's form because Preview has no form-selection context and the request changes only the selected edge.
- Risk: duplicate-edge and maximum-edge constraints must be evaluated against the final two-edge state, not an intermediate state.
- Risk: compact SVG controls need explicit focus management so expansion/collapse does not strand keyboard focus.
- Blocker: none currently known.

## Implementation Handoff

After this plan is explicitly finalized, confirmed, approved, and separately committed, launch only this ordinary plan with:

```text
/start-implementation .agents/plans/2026-08-26-dag-edge-insert-control.md
```
