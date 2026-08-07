# Sidebar Unread State

## 2026-08-07

- Pi Web has one browser-local unread session-ID set under `pi-web:unread-session-ids`. Automatic background completion and the manual row action both restore the existing cyan-blue dot; there is no separate reminder/task state or visual treatment.
- Unread is session-scoped, not row-scoped. The same set feeds Pinned, Recent, and recursive Project presentations, so toggling any duplicate row updates every presentation immediately.
- The lifecycle intentionally remains open-to-clear: every explicit row open clears unread, including re-clicking the already selected row. A selected session may be manually marked unread until it is explicitly opened again; leaving it selected does not immediately undo the manual action.
- Running state takes visual and state precedence. Every current/new running ID is cleared from unread, an unselected running-to-idle edge adds unread, and a selected completion does not add it automatically.
- Persistence is guarded presentation metadata: unavailable or malformed browser storage fails safely, an empty set removes the key, and only a latest complete session listing prunes stale IDs. No title, message, path, payload, or ID telemetry is emitted.
- This state must remain outside the strict shared pinned/hidden `pi-web-sidebar.json` schema and `/api/sidebar-state` operations. It does not edit JSONL, affect selection/sorting, or change native session ownership.

References: `.agents/plans/2026-08-06-manual-session-unread.md`, `lib/sidebar-unread-state.ts`, and `components/SessionSidebar.tsx`.
