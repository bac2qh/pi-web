# Session DAG View

Status: approved

## Objective

Add one machine-wide, non-enforcing session dependency graph. Users author exact `From session ID` / `To session ID` relationships, preview them in Mermaid, mark unblocked sessions complete, and reverse completion through linear Undo/Redo.

`A → B` means “A must finish before B starts,” but the graph never starts, stops, schedules, hides, reparents, or edits a Pi session. Exact session IDs are identity; names, repository labels, form positions, and native ancestry are presentation only.

## Design / Implementation Strategy

### Right-panel UI and structured authoring

- Add a permanent, non-closable **DAG** tab before all file tabs. Replace the file-only tab type with a DAG/file union and use semantic `tablist`/`tab`/`tabpanel`, roving focus, and Arrow/Home/End navigation.
- Keep the right panel closed initially. Its first DAG activation lazily loads the graph in **Preview**. Opening a file still selects that file; closing the final file keeps the panel open and falls back to DAG.
- Keep DAG mounted after first activation so mode, drafts, focus, and feedback survive file-tab switches. Preserve the existing panel expansion record across DAG/file selection, file closure, and hide/reopen; final-file closure no longer performs the old final-viewer reset.
- Preview renders generated Mermaid. Raw is the canonical structured form—never editable Mermaid source. A compact shared toolbar owns Preview/Raw, TD/LR, Refresh, Undo, and Redo; **Add form** appears in Raw.
- Forms are automatically numbered bookkeeping sections with no graph semantics. Each has committed rows and one local trailing From/To draft. Enter adds a complete draft; Enter on a committed row atomically replaces its validated pair; Escape restores it; failed validation keeps the committed edge and draft. A small button deletes an edge directly.
- Do not add drag/drop or edge-move UI. Moving between forms is delete then add. Do not add isolated-node authoring or custom form names.
- Never delete a form automatically. Show its top-right cross only when it has no active rows or unfinished node controls. If later Undo needs a deleted form, use the first remaining form or atomically create a default form.

### Graph and completion semantics

- One graph spans all repositories/worktrees. Form boundaries never affect connectivity, rendering, eligibility, or completion.
- Support only TD and LR. Allow disconnected components, self-edges, reverse pairs, and larger cycles. Reject an exact duplicate directed pair globally.
- Add/replace requires both exact IDs to exist in the current complete session listing and not be completed. Previously accepted IDs remain durable if their session disappears; show the full ID with `Session unavailable` and continue to support completion, Undo/Redo, deletion, form, and direction operations.
- Sidebar Hidden is unrelated and does not affect resolution or completion.
- Active nodes are endpoints referenced by active edges or applied archived edges, minus nodes completed by applied history. Completed nodes cannot be reused until Undo reactivates them.
- A node is eligible only when active and without an active incoming edge. Completion archives all its active outgoing edges in one batch and marks the node complete.
- A sink has an invisible derived terminal relationship. Completing it records a valid zero-visible-edge batch, so `A → B` becomes B alone after A completes and disappears only when B completes. Never render or persist a sentinel/terminal edge.
- A completion batch stores its stable ID, completed session ID, archived edges, node-form hints, server timestamp, and server-assigned sequence. Sequence—not time—is authoritative order. No active/completed/history list is shown; Undo/Redo are the only history UI.
- Complete appends to applied history. Undo moves the expected applied tip to redo and restores its edges. Redo moves the expected redo tip back and rearchives those exact edges without changing timestamp/sequence.
- Any successful direct graph mutation or new completion after Undo clears redo. Idempotent no-ops, refresh, mode/tab changes, copy actions, and local drafts do not.
- Form controls are derived from active/applied historical references and synchronized globally. Completion batches retain form hints for zero-edge terminal Undo; any active node without a surviving assignment uses the deterministic first/default-form fallback.

### Labels, Mermaid, and explicit node controls

- Resolve current metadata lazily from `GET /api/sessions`. Reuse the shortest unique project-prefix helpers and current display-title fallback. Labels are `repo · name` or `repo · branch · name`, with no added “Session” word.
- Bound and escape every label segment. Never persist copied names or paths. Rename changes presentation without advancing DAG revision or clearing redo.
- Close the current rename-notification gap: route rename through the existing session-list refresh notifier, extracting its lightweight HMR-stable pub/sub seam from `rpc-manager.ts` if needed, so active DAG/sidebar views receive `sessions_changed` without starting an `AgentSession`.
- Compile one global active graph. Sort IDs deterministically, assign generated aliases (`n0`, `n1`, …), declare every active node including edge-less terminals, then emit active edges in stable order. Generated Mermaid is one-way output.
- Reuse the existing serialized, theme-aware Mermaid path with `securityLevel: "strict"`, bounded errors, responsive finalization, and constant non-sensitive `accTitle`/`accDescr`.
- Require exactly one accessible SVG root before mounting/post-processing. Match node groups only through the current alias map. Create tooltips and controls with SVG namespace APIs, `textContent`, and `setAttribute`—never interpolated HTML or Mermaid callbacks.
- The whole Preview node is inert. Add a small contained, focusable `Complete <label>` control only for eligible nodes; Enter/Space activates exactly once and server-side eligibility is revalidated.
- Preview exposes the exact ID only in a safe tooltip. Sidebar rows and Raw node controls provide direct copy buttons. Keep `/session` and its existing Session Info copy action unchanged.
- If compile/render/post-processing fails, preserve Raw and replace only Preview with a bounded stage/error-class message.

### Persistence and concurrency

- Store one strict versioned file such as `pi-web-session-dag.json` under `getAgentDir()`, separate from session JSONL and sidebar metadata. Persist revision, direction, stable form/edge order, active edges, applied/redo batches, next sequence, and bounded mutation receipts—never titles, paths, Mermaid, components, or derived terminals.
- Initial bounds: 8 MiB state, 256 forms, 10,000 total edge records, 10,000 applied-plus-redo batches, 512 receipts, 512 characters per session ID, and 128 per opaque entity/mutation ID. Enforce count and byte limits without automatic semantic-history pruning.
- Add a force-dynamic, no-store DAG `GET`/`PATCH` route. GET never reconciles/prunes against current sessions. PATCH supports direction, create/delete form, add/replace/delete edge, complete, Undo, and Redo.
- Reuse the sidebar store pattern: private directory/file permissions, bounded exclusive lock, reread and strict validation under lock, same-directory temporary write, atomic rename, and no guessed stale-lock removal.
- Mutations use `{ mutationId, baseRevision, operation }`. Create operations carry stable client-generated entity IDs; edit/history operations carry target IDs plus expected old values or stack tip. The server assigns completion timestamp/sequence.
- Under lock, hash the canonical envelope and retain a server-private receipt. Exact retry is idempotent; mutation-ID reuse with another digest or a stale base revision returns `409 { code, state }` without writing; one semantic change advances revision once; a no-op does not.
- For add/replace, obtain a complete session listing and prove its generation remains current after acquiring the DAG lock, retrying only the bounded discovery race.
- Serialize mutations per mounted client and ignore stale GETs. On conflict, adopt authoritative state, preserve applicable local drafts, show `Graph changed elsewhere; review and retry`, and never silently replay.
- Refresh graph state on DAG activation/reopen, explicit Refresh, browser focus, and `online`. Use existing `sessions_changed` only for session-label refresh. Do not add polling or a DAG-specific WebSocket.

### Copy behavior, privacy, and maintained docs

- Add a compact copy-ID action to the shared session row, covering Pinned, Recent, Project, and Show-hidden presentations without triggering row selection. Add the same action to resolved/unavailable Raw node controls with accessible success/failure feedback.
- Harden `lib/clipboard.ts`: legacy `execCommand("copy") === false` rejects, temporary textarea cleanup is unconditional, and modern Clipboard API rejection reaches the caller.
- Log only bounded operation/stage/revision/count/status/error-class fields. Never log IDs, pairs, titles, Mermaid source, paths, mutation payloads, stored JSON, or native provider/session payloads.
- Update `AGENTS.md` with the route/store/component map, persistence owner, completion semantics, non-enforcement boundary, and permanent-tab behavior.
- Add no graph/state dependency, visible archive panel, scheduling, cycle enforcement, sidebar coupling, or session migration.

## Reference Files

- [../../AGENTS.md](../../AGENTS.md)
- [../../components/AppShell.tsx](../../components/AppShell.tsx)
- [../../components/TabBar.tsx](../../components/TabBar.tsx)
- [../../components/SessionSidebar.tsx](../../components/SessionSidebar.tsx)
- [../../components/MarkdownBody.tsx](../../components/MarkdownBody.tsx)
- [../../components/GlobalStatusProvider.tsx](../../components/GlobalStatusProvider.tsx)
- [../../lib/file-viewer-layout.ts](../../lib/file-viewer-layout.ts)
- [../../lib/mermaid-display.ts](../../lib/mermaid-display.ts)
- [../../lib/sidebar-session-state.ts](../../lib/sidebar-session-state.ts)
- [../../lib/sidebar-state-store.ts](../../lib/sidebar-state-store.ts)
- [../../lib/session-reader.ts](../../lib/session-reader.ts)
- [../../lib/rpc-manager.ts](../../lib/rpc-manager.ts)
- [../../lib/clipboard.ts](../../lib/clipboard.ts)
- [../../app/api/sidebar-state/route.ts](../../app/api/sidebar-state/route.ts)
- [../../app/api/sessions/route.ts](../../app/api/sessions/route.ts)
- [../../app/api/sessions/%5Bid%5D/route.ts](../../app/api/sessions/%5Bid%5D/route.ts)
- [../../app/globals.css](../../app/globals.css)

## Constraints and Evidence

- Session listing already supplies exact IDs, current titles, `cwd`, `projectRoot`, and `worktreeBranch` without starting an `AgentSession`.
- Existing helpers already provide global project/worktree labels, Mermaid strict rendering, right-panel expansion transitions, clipboard fallback, and locked/atomic Pi-agent-directory persistence.
- Rename currently invalidates only the session-list cache; implementation must also publish the existing refresh generation.
- The repository has Node/Jiti tests but no committed browser interaction harness. Use focused pure/static tests plus privacy-safe browser validation.
- Preserve unrelated checkout state. Never run `next build` during development.

## Test Strategy

- **Pure graph/compiler:** strict parsing/bounds; add/replace/delete; duplicate/unknown/completed rejection; chains, branches, joins, sinks, cycles, disconnected graphs; terminal batches; form fallback; deterministic aliases/labels/escaping; linear Undo/Redo and redo branching.
- **Store/API:** permissions, atomic writes, lock timeout/cleanup, malformed/oversized refusal, revision/sequence overflow, exact retry/lost response, stale conflict, compare-and-set targets, concurrent add/edit/delete/complete/Undo/Redo, receipt pruning, session-generation race, restart, and unavailable-session retention.
- **UI/browser:** permanent keyboard-accessible tab; lazy Preview; file fallback/focus; mode/draft preservation; expansion at ≤640, 641–999, and ≥1000; form/row controls; sidebar fourth-action spacing; rename refresh; unavailable completion; strict accessible SVG, inert nodes, contained pointer/keyboard controls, hostile labels, render failure, two-client conflicts, and server restart.
- Verify representative session JSONL, ancestry, running state, sidebar state, and worktrees are unchanged by DAG operations. Inspect the stored file and diagnostics for privacy constraints.

Required commands:

```bash
node --test components/*.test.mjs lib/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`.

## Validation Contract

| ID | Required outcome | Evidence |
|---|---|---|
| VC-001 | Initially closed panel with permanent first DAG tab, lazy Preview, preserved DAG state, correct file fallback/focus, and unchanged responsive expansion. | Pure layout/tab tests plus browser keyboard, close, resize, focus, and DOM-identity checks. |
| VC-002 | Structured forms are canonical; exact-ID mutations are atomic; form boundaries are semantic-free; duplicates/unknown/completed IDs reject; cycles/disconnected/missing sessions behave as specified. | Reducer/compiler/API tests plus browser add/edit/delete/form/conflict/unavailable flows. |
| VC-003 | Strict deterministic TD/LR Mermaid uses current safe labels; only eligible explicit controls act; SVG accessibility/containment hold; Raw survives Preview failure. | Compiler/render tests plus browser theme, hostile-label, invalid-root, pointer, Enter/Space, focus, resize, and rename checks. |
| VC-004 | Completion batches, terminal nodes, and linear Undo/Redo are exact; direct mutations branch from redo; deleted-form terminal Undo has deterministic placement. | Chain/branch/join/terminal/history tests plus browser consecutive completion and Undo/Redo flows. |
| VC-005 | One bounded private store survives restart and concurrent clients without lost/duplicated accepted mutations or missing-session pruning. | Store/API fault/contention tests, lost-response replay, two-client conflict flow, restart, permissions, and state inspection. |
| VC-006 | Copy works from all sidebar/Raw surfaces; `/session` remains; DAG use changes no native session/execution/sidebar/worktree state; tests, typecheck, lint, diff checks, docs, and privacy review pass. | Browser clipboard/state checks, before/after evidence, required commands, final diff/status, and `AGENTS.md` review. |

## Risks and Blockers

- The UI name says DAG although cycles are allowed; implementation logic must use dependency-graph semantics, not topological enforcement.
- Archived edges and zero-edge batches are required for truthful terminal state and Undo; never prune or flatten them implicitly.
- Stable IDs and compare-and-set targets are mandatory because visible form numbers and array positions can change.
- SVG output remains untrusted despite strict Mermaid; post-processing must fail closed on unexpected structure.
- A permanent non-file tab changes final-file close, expansion, focus, and conditional renderer assumptions; browser regression evidence is required.
- **Blocker:** none.

## Implementation Handoff

```text
/start-implementation .agents/plans/2026-08-08-session-dag-view.md
```
