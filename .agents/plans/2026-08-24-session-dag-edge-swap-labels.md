# Session DAG Edge Swapping and Raw Labels

Status: approved

## Objective

Make DAG dependencies easier to recognize and correct:

- add a per-edge **Swap** control in graphical Preview and structured Raw so `A → B` can become `B → A` without manually re-entering both IDs; and
- keep exact session IDs visible/editable in Raw while showing the corresponding current session label beneath each endpoint.

Success means users can identify both endpoints before acting, swap a valid active edge from either view, and receive the same concurrency, validation, accessibility, and failure behavior as existing DAG edits.

## Design / Implementation Strategy

- Reuse the existing `replace_edge` operation for swaps. A swap sends the edge's exact current compare-and-set expectation and the reversed endpoint pair; do not add a swap operation, API shape, persisted field, schema version, dependency, or native-session mutation.
- Preserve existing graph semantics. An accepted swap advances graph revision, recomputes eligibility, and clears Redo as an ordinary direct semantic mutation already does. Reverse-pair duplicates, completed endpoints, unavailable sessions, stale targets, and concurrent graph changes remain server-validated and return existing authoritative feedback rather than being guessed by the client.
- Add an accessible Swap control to each committed Raw edge row. One activation immediately submits the currently displayed endpoint values in reversed order through `replace_edge`; on success, clear that row's local draft so the authoritative reversed edge remains visible. A trailing new-edge draft may exchange its two local values but must not create an edge until the existing Enter-to-add action succeeds.
- Beneath each Raw endpoint input, derive presentation from the already-loaded `SessionInfo` list. Keep the full exact ID in the input and show the same bounded, project/worktree-qualified display label used by Preview (`repo · name` or `repo · branch · name`) when the current value resolves. Show `Session unavailable` for a committed durable endpoint whose metadata is absent; do not persist labels or paths. Partial or unknown new draft values remain plainly unresolved rather than being mistaken for an accepted unavailable session.
- Extend Mermaid compilation with deterministic generated edge aliases (`e0`, `e1`, …) and bidirectional alias/edge lookup maps, parallel to the existing generated node aliases. Emit supported Mermaid explicit edge IDs, never persisted opaque edge IDs, session IDs, or labels as structural identifiers.
- Extend SVG preparation to accept only the exact current render's expected edge aliases and retain a validated edge-path map. Put one compact, always-visible Swap control near each edge's validated midpoint in the existing trusted sibling SVG control layer, separate from generated Mermaid SVG/CSS. Create controls only with SVG namespace APIs and safe text/attributes, and fail Preview closed to the existing bounded error state if aliases or geometry are inconsistent; Raw remains available.
- Give each Preview control a clear accessible name that identifies the current From and To labels. Support click and Enter/Space once per in-flight mutation, restore the control after rejection, and let an accepted authoritative state drive the normal rerender. Keep the always-visible control disabled for a self-edge in both views because reversing identical endpoints cannot change state; do not submit or report a successful update.
- Retain current responsive panel behavior, Preview serialization, current-session marking, node tooltips, completion controls, Raw editing, focus visibility, and privacy boundaries. Update the maintained DAG architecture notes in `AGENTS.md` and session-dependency-graph memory so they describe validated edge aliases and trusted swap controls rather than completion-only Preview interaction.

**Rough scope estimate**

- **Surfaces:** DAG panel/Raw rows, Preview interaction wiring, compiler edge aliases, validated SVG edge geometry and trusted controls, DAG CSS, focused DAG tests, and maintained DAG documentation. No route, store, persistence schema, session JSONL, sidebar, or worktree changes.
- **Testability:** strong for swap mutation construction, label derivation, alias mapping, strict SVG validation, keyboard/in-flight behavior, and regression contracts through existing Node/Jiti and source tests; button placement and readability require a bounded browser pass because the repository has no committed browser interaction harness.
- **Implementation difficulty:** medium. Raw labels and mutation reuse are direct; the main care is mapping untrusted Mermaid edge output to generated aliases and placing interactive controls without weakening the ShadowRoot trust boundary.

## Reference Files

- [../../AGENTS.md](../../AGENTS.md)
- [../../package.json](../../package.json)
- [../../components/SessionDagPanel.tsx](../../components/SessionDagPanel.tsx)
- [../../components/SessionDagPreview.tsx](../../components/SessionDagPreview.tsx)
- [../../components/SessionDag.test.mjs](../../components/SessionDag.test.mjs)
- [../../lib/session-dag.ts](../../lib/session-dag.ts)
- [../../lib/session-dag.test.mjs](../../lib/session-dag.test.mjs)
- [../../lib/session-dag-svg.ts](../../lib/session-dag-svg.ts)
- [../../lib/session-dag-svg.test.mjs](../../lib/session-dag-svg.test.mjs)
- [../../lib/sidebar-session-state.ts](../../lib/sidebar-session-state.ts)
- [../../app/globals.css](../../app/globals.css)
- [../memory/session-dependency-graph.md](../memory/session-dependency-graph.md)
- [./2026-08-08-session-dag-view.md](./2026-08-08-session-dag-view.md)
- [./2026-08-10-highlight-current-dag-session.md](./2026-08-10-highlight-current-dag-session.md)

## Constraints and Current Evidence

- Raw is structured canonical authoring, not editable Mermaid source. Its committed rows currently edit by Enter and restore by Escape.
- `replace_edge` already atomically validates the expected form/from/to tuple, current session existence, completion state, and directed-pair uniqueness; it is the smallest sufficient mutation path for swapping.
- The DAG is machine-wide, so a bare session title can be ambiguous. Existing `buildSessionDagLabel()` already provides bounded project/worktree-qualified labels and current rename refresh behavior.
- Preview currently validates inert Mermaid SVG and mounts trusted completion controls in a separate sibling SVG. Generated Mermaid CSS is forbidden from selecting the reserved `session-dag-` control namespace.
- Installed Mermaid 11.15 supports explicit generated edge IDs. Persisted DAG edge IDs accept a wider opaque character set and therefore must not be interpolated into Mermaid syntax or trusted as rendered aliases.
- Focused baseline DAG tests passed 23/23 on 2026-08-24.
- **User decision (2026-08-24):** Swap is an immediate one-action save in both Preview and committed Raw rows. Swapping a trailing new-edge draft only exchanges its local fields; Enter remains required to add it.
- **User decision (2026-08-24):** Raw shows the full existing Preview label beneath each exact endpoint ID (`repo · name` or `repo · branch · name`), not a bare title, so machine-wide duplicate names remain distinguishable.
- **User decision (2026-08-24):** Preview shows a compact Swap button continuously near every active edge's midpoint. It does not require hover, selection, or another interaction to reveal.
- Preserve unrelated checkout changes. Do not run `next build` during development.

## Test Strategy

- Extend reducer/compiler coverage for the existing atomic replacement with reversed endpoints, including successful eligibility reversal, reverse-pair duplicate rejection, deterministic safe edge aliases, and absence of persisted edge/session IDs from Mermaid structure.
- Extend SVG helper coverage for exact edge-alias recognition, missing/duplicate/foreign aliases, safe midpoint conversion, trusted control construction, accessible names, reserved namespaces, and fail-closed behavior.
- Extend panel/Preview source coverage for Raw endpoint labels, unavailable versus unresolved states, immediate compare-and-set mutations, self-edge disabling without a request, conflict recovery, click and Enter/Space behavior, in-flight suppression, and coexistence with completion/current-session controls.
- In a bounded browser pass, swap representative TD and LR edges from both views; cover a chain, branch, reverse-pair conflict, self-edge, unavailable accepted endpoint, light/dark themes, keyboard focus, narrow/desktop layouts, scrolling, and graph refresh. Confirm arrow direction, eligibility, labels, revision, Redo clearing, and both views converge after success or conflict.

Required implementation gates:

```bash
NODE_ENV=test node --test components/SessionDag.test.mjs lib/session-dag.test.mjs lib/session-dag-svg.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`.

## Telemetry / Debuggability

Reuse existing user-visible mutation feedback and bounded Preview failure diagnostics. Edge-control preparation failures may use the existing `controls` stage with revision/node/edge counts and error class only. Do not log session IDs, edge IDs, endpoint pairs, labels, Mermaid source, paths, mutation payloads, or stored state. No new persistent telemetry is needed.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Every server-valid, distinct-endpoint active edge can be reversed immediately from Preview or Raw through one atomic, concurrency-safe replacement. Success updates both views and eligibility and clears Redo; stale, duplicate-reverse, completed, or unavailable displayed targets preserve authoritative state and explain failure. | Focused mutation/panel tests plus two-client browser swaps across chain, branch, conflict, and unavailable-session cases; inspect revision and Redo behavior. | Stop and correct mutation construction or authoritative-state adoption; do not add a client-only reversal or bypass existing validation. |
| VC-002 | Raw keeps exact IDs visible/editable and shows the correct current project/worktree-qualified session label beneath each resolved endpoint, with truthful unavailable/unresolved presentation and no persisted metadata copy. | Label/helper and panel tests plus browser rename, missing-session, partial-draft, duplicate-title, and narrow-layout checks; inspect DAG storage before/after. | Fix metadata resolution/presentation without changing exact-ID identity or storage schema. |
| VC-003 | Preview shows a compact Swap control continuously near every active edge midpoint; controls map only through generated validated edge aliases, work by pointer and keyboard, suppress duplicate activation, disable self-edge no-ops, coexist with completion/current-session behavior, and preserve the inert-Mermaid/trusted-sibling boundary. | Compiler/SVG safety tests plus browser TD/LR, self-edge, focus, theme, scroll, and render-replacement checks; malformed SVG remains covered at the pure validation seam. | Fail Preview closed to Raw, correct alias/geometry/control isolation, and rerun all affected security and interaction checks. |
| VC-004 | The focused suite, typecheck, lint, diff check, responsive visual review, privacy review, and maintained DAG documentation pass without changing route/store/schema or native session/sidebar/worktree behavior. | Run the required gates, inspect the final diff/status and storage shape, review `AGENTS.md` and DAG memory, and record bounded browser evidence at narrow and desktop widths. | Stop closeout and fix only failures within the approved scope; disclose any blocked layer rather than weakening this contract. |

## Assumptions, Risks, and Blockers

- **Assumption:** “Source” means the existing structured **Raw** mode, not generated Mermaid text.
- **Risk:** Mermaid edge-path output is untrusted and library-version-sensitive. Generated aliases, exact validation, and fail-closed preparation are required; persisted IDs must never become Mermaid identifiers.
- **Risk:** Mid-edge controls can collide with short, curved, self, parallel, or crossing edges. Browser validation must confirm a readable placement that does not hide arrow direction or node completion controls.
- **Risk:** Reversing an edge can immediately change completion eligibility and clear Redo. The UI must use the authoritative response rather than optimistic graph semantics.
- **Blocker:** None.

## Implementation Handoff

After approval, start implementation with:

```text
/start-implementation .agents/plans/2026-08-24-session-dag-edge-swap-labels.md
```
