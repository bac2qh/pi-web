# Session Dependency Graph

## 2026-08-09

- Pi Web owns one machine-wide dependency graph in `getAgentDir()/pi-web-session-dag.json`, separate from native session JSONL and shared sidebar metadata. The store is strict, private, bounded, lock-serialized, atomically replaced, and revisioned with idempotency receipts.
- Exact Pi session IDs are graph identity. Titles, repository/worktree labels, native ancestry, and numbered authoring forms are presentation only and are never persisted in graph state. Accepted IDs remain durable when the native session later disappears.
- `A → B` means only that A must be marked complete before B becomes eligible. The feature is intentionally non-enforcing: it never starts, stops, schedules, hides, reparents, renames, or otherwise mutates a Pi session. Despite the UI name **DAG**, cycles, self-edges, reverse pairs, and disconnected components are valid; only an exact duplicate directed pair is rejected.
- Completion is reversible history, not session execution. Completing an eligible node archives its active outgoing edges in one server-sequenced batch; a sink uses a valid zero-edge batch rather than a sentinel. Undo/Redo move only the expected stack tip and preserve batch sequence/time, while a direct semantic mutation or new completion after Undo clears redo.
- Add/replace alone validates both IDs against a generation-current complete session listing under the graph lock. Every mutation carries a client mutation ID, base revision, and stable entity/CAS targets; conflicts return authoritative state and clients never silently replay.
- The right panel permanently owns a non-closable first DAG tab but starts closed. First activation lazily mounts Preview; the mounted panel then retains Raw drafts, mode, feedback, expansion state, and the shared browser-local right-panel width across file tabs and hide/reopen. Resizing belongs to the container, never to DAG or file content.
- Structured Raw forms are canonical and Mermaid is one-way output. Mermaid output is XML/CSS/SVG validated inside a ShadowRoot; the validated graph SVG and trusted sibling completion-control SVG remain separate so Mermaid styling cannot select the controls. Only explicit eligible controls are interactive.

References: `.agents/plans/2026-08-08-session-dag-view.md`, `AGENTS.md`, `lib/session-dag.ts`, `lib/session-dag-store.ts`, `lib/session-dag-route.ts`, `lib/session-dag-svg.ts`, and `components/SessionDagPanel.tsx`.
