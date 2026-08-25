# Session Dependency Graph

## 2026-08-09

- Pi Web owns one machine-wide dependency graph in `getAgentDir()/pi-web-session-dag.json`, separate from native session JSONL and shared sidebar metadata. The store is strict, private, bounded, lock-serialized, atomically replaced, and revisioned with idempotency receipts.
- Exact Pi session IDs are graph identity. Titles, repository/worktree labels, native ancestry, and numbered authoring forms are presentation only and are never persisted in graph state. Accepted IDs remain durable when the native session later disappears.
- `A → B` means only that A must be marked complete before B becomes eligible. The feature is intentionally non-enforcing: it never starts, stops, schedules, hides, reparents, renames, or otherwise mutates a Pi session. Despite the UI name **DAG**, cycles, self-edges, reverse pairs, and disconnected components are valid; only an exact duplicate directed pair is rejected.
- Completion is reversible history, not session execution. Completing an eligible node archives its active outgoing edges in one server-sequenced batch; a sink uses a valid zero-edge batch rather than a sentinel. Undo/Redo move only the expected stack tip and preserve batch sequence/time, while a direct semantic mutation or new completion after Undo clears redo.
- Add/replace alone validates both IDs against a generation-current complete session listing under the graph lock. Every mutation carries a client mutation ID, base revision, and stable entity/CAS targets; conflicts return authoritative state and clients never silently replay.
- The right panel permanently owns a non-closable first DAG tab but starts closed. First activation lazily mounts Preview; the mounted panel then retains Raw drafts, mode, feedback, expansion state, and the shared browser-local right-panel width across file tabs and hide/reopen. Resizing belongs to the container, never to DAG or file content.
- Structured Raw forms are canonical and Mermaid is one-way output. Mermaid output is XML/CSS/SVG validated inside a ShadowRoot; the validated graph SVG and trusted sibling graph-control SVG remain separate so Mermaid styling cannot select completion or edge controls. Only explicit eligible completion controls and validated active-edge Swap controls are interactive.

## 2026-08-10

- Graphical Preview marks one existing rendered node only when its exact session ID equals `AppShell`'s selected chat session. A nonmember, completed node, null selection, hidden Preview, render replacement/failure, or unmount leaves no marker; Raw remains unchanged.
- Selection marking resolves through the compiler's session-to-alias map and the validated render's alias-to-node map. It is a separate commit-phase DOM update, so selecting a chat does not rerender Mermaid, replace the ShadowRoot/SVG, fetch or mutate graph state, move focus, or scroll.
- The marker is a trusted `data-session-dag-current` attribute styled inside the ShadowRoot. Generated SVG/CSS cannot pre-seed or select trusted marker/control namespaces, and nested generated CSS is refused before trusted sibling completion controls mount.

## 2026-08-25

- Raw keeps exact endpoint IDs editable while deriving bounded project/worktree-qualified labels from the current session listing. A committed Swap reverses the displayed pair through the existing exact-CAS `replace_edge`; a trailing draft exchanges local fields only, and accepted missing endpoints remain distinct from unresolved local values.
- Preview compiles deterministic generated `eN` aliases without exposing persisted edge IDs structurally, validates exact current-render edge paths, and maps each alias back to its active edge. Installed Mermaid 11.15 expands a self-edge into three deterministic node-alias path segments, so all three must validate exactly and only the middle segment supplies control geometry.
- Compact midpoint Swap controls share the trusted sibling SVG layer with completion controls. They are SVG-namespace-only, identify current From/To labels accessibly, serialize pointer or Enter/Space activation once per in-flight control, restore after rejection, and remain visible but disabled for self-edge no-ops. Authoritative graph responses continue to own rerendering, eligibility, Redo clearing, and conflicts.

References: `.agents/plans/2026-08-08-session-dag-view.md`, `.agents/plans/2026-08-10-highlight-current-dag-session.md`, `.agents/plans/2026-08-24-session-dag-edge-swap-labels.md`, `AGENTS.md`, `lib/session-dag.ts`, `lib/session-dag-store.ts`, `lib/session-dag-route.ts`, `lib/session-dag-svg.ts`, `components/SessionDagPanel.tsx`, and `components/SessionDagPreview.tsx`.
