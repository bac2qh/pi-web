# Pinned, Recent, and Hidden Sessions Sidebar

Status: approved
Date: 2026-07-21

## Objective

Redesign the existing left sidebar so important and recently active sessions are easy to reach across repositories, while unwanted session subtrees can be hidden from pi-web without changing Pi session files.

### Success Criteria

- The open sidebar is ordered: fixed global header, Pinned, Recent, Project, Explorer.
- Pinned and Recent are instance-wide across the configured Pi agent directory; Project remains the complete selected-project fork tree.
- Pins are shared across clients, newest-pinned-first, stable across message activity, absent from Recent, and still present in Project.
- Recent contains every visible, unpinned session whose latest user/assistant activity is within the exact rolling ten-day window; it has no item cap and scrolls independently.
- Hiding any session suppresses that session and all fork descendants, but not its ancestors or unrelated siblings. Pi JSONL files, chat selection, running agents, and pin state remain unchanged.
- A temporary global Show hidden control reveals and restores hidden subtrees.
- Project preserves fork nesting and promotes a family according to its newest visible descendant activity.
- Existing project/worktree selection, mobile navigation, running/unread status, rename/delete/fork behavior, and Explorer behavior remain coherent.

## Design / Implementation Strategy

### 1. Derive all sidebar presentations from shared pure helpers

Add a client-safe helper module such as `lib/sidebar-session-state.ts` for:

- Versioned sidebar-state and operation types.
- Pin ordering and optimistic operation reduction.
- Cycle-safe parent/child indexing and effective hidden-descendant closure.
- Explicit hidden-marker canonicalization.
- Recent membership and next-expiry calculation.
- Shortest-unique project-prefix derivation.
- Fork-tree construction and visible-descendant activity sorting.

Build the descendant graph from raw `allSessions` before project or hidden filtering. With Show hidden off, remove effective hidden sessions before deriving Pinned, Recent, project groups, trees, or ordering. With Show hidden on, use all sessions and attach explicit-versus-inherited hidden state to each row.

Resolve Pinned by stored ID order. Derive Recent from unpinned sessions satisfying `modified >= now - 10 * 24 hours`, and schedule recomputation at the next exact expiry rather than polling. Sort each Project sibling subtree by its maximum visible descendant `modified`, then the node's own timestamp and session ID.

### 2. Persist shared state through one operation API

Add `lib/sidebar-state-store.ts` and `GET/PATCH /api/sidebar-state`. Store `getAgentDir()/pi-web-sidebar.json` as:

```json
{
  "version": 1,
  "revision": 0,
  "pinnedSessionIds": [],
  "explicitlyHiddenSessionIds": []
}
```

PATCH accepts one idempotent `pin`, `unpin`, `hide`, or `restore` operation plus a session ID; clients never replace complete arrays. Validate and bound all fields. Missing state uses defaults; malformed or unsupported state is not silently overwritten.

Serialize updates under a bounded exclusive lock, reread current state, write a same-directory temporary file, and atomically rename it. Reconcile stale IDs only after a successful complete session listing. Return authoritative state and revision after mutation.

### 3. Recompose the existing sidebar without changing session runtime behavior

Refactor the common session-row surface so flat Pinned/Recent rows and recursive Project rows share selection, running, unread, rename, delete, pin, hide, relative-time, message-count, and worktree behavior.

- Keep the fixed title/New/Refresh row and add the temporary Show hidden eye control.
- Render Pinned, Recent, Project, then Explorer.
- Prefix global row titles with compact project and optional worktree context. Expand colliding project basenames to the shortest unique path suffix; retain full paths in tooltip/accessibility text.
- Keep Pinned and Recent headers visible. Both default expanded, collapse independently, grow to roughly five existing 54 px rows, then scroll; compact empty states consume minimal height.
- Allow global sections to shrink on short/mobile viewports before Project loses a usable minimum.
- Keep Project selection stable if all its sessions are filtered.
- Start Explorer collapsed while preserving its current controls and cwd behavior.
- Keep pin always visible. Put Hide beside Rename with keyboard/touch access and no confirmation dialog.
- In Show hidden mode, explicitly marked rows offer Restore; inherited descendants are marked hidden but do not offer an independent Restore.
- Selecting a revealed hidden session opens it without restoring it.

Maintain confirmed server state plus ordered pending operations so Pin, Unpin, Hide, and Restore update immediately without spinners. Send operations in order and reconcile authoritative revisions without allowing older responses to reverse newer intent. On failure, show one compact non-blocking error while ordinary session browsing remains available. Existing Refresh/session-refresh paths provide cross-client convergence; add no polling or SSE channel.

### 4. Update maintained documentation

Document Pinned, Recent, Hide/Show hidden, and `pi-web-sidebar.json` in `README.md`, `README.zh-CN.md`, and relevant repository architecture notes in `AGENTS.md`.

### Scope Estimate

- **Surfaces:** one substantial sidebar refactor; two new helper/store modules; one API route; focused tests; small style/type changes; three documentation updates.
- **Testability:** high for state, graph, ordering, and persistence through pure/temp-directory tests; moderate for responsive interactions because browser evidence is manual.
- **Implementation complexity:** medium-high due to shared ordered persistence, recursive hiding, and constrained multi-section layout. Resizing, Pi extensions, filesystem archive, and UI-test infrastructure are excluded.

## Reference Files

- [`components/SessionSidebar.tsx`](../../components/SessionSidebar.tsx) — current sidebar state, layout, tree, row actions, running/unread indicators, and Explorer ownership.
- [`lib/session-reader.ts`](../../lib/session-reader.ts) — global session listing and `parentSessionId`, activity, project, and worktree metadata.
- [`lib/types.ts`](../../lib/types.ts) — current `SessionInfo` contract.
- [`app/api/sessions/route.ts`](../../app/api/sessions/route.ts) — existing global session-list API and running-session snapshot.
- [`README.md`](../../README.md) — maintained user-facing behavior and data-directory documentation.
- [`AGENTS.md`](../../AGENTS.md) — maintained architecture map and repository validation constraints.

## Constraints, Decisions, and Current State

### Fixed Constraints

- This plan changes only the existing sidebar; hiding the sidebar hides every new section.
- The global header remains fixed above Pinned, Recent, Project, and Explorer.
- Project contains the project/folder picker, optional Git worktree picker, and selected-project fork tree.
- Draggable resizing is deferred.
- Do not run `next build`; static gates are TypeScript and lint.
- This planning phase may modify only this plan and does not authorize implementation.

### Confirmed Product Decisions

- Pins are stored per Pi agent directory, not in browser local storage.
- Recent uses latest user/assistant message activity, spans all listed projects, has an exact rolling ten-day window, and has no count cap.
- Pinned sessions are omitted from Recent but remain in Project.
- Hide is pi-web presentation metadata only; no Pi extension, slash command, file move, JSONL rewrite, cancellation, or navigation is involved.
- Hide applies to the selected session and all current/future descendants. Persist only explicitly hidden session IDs; adding an ancestor marker removes redundant descendant markers.
- Hidden sessions keep their pins. Hiding a selected or running session does not interrupt it.
- Show hidden is a global temporary view mode that resets off after reload.
- Delete has no special hidden-state cascade. Missing explicit markers may be pruned after successful reconciliation; surviving reparented children follow the current tree.
- Pinned and Recent default expanded and independently collapsible. Explorer starts collapsed.
- Pin/Hide/Restore interactions are immediate, with no spinner or confirmation modal.

### Established Facts

- `SessionSidebar` already loads all sessions before deriving the selected project.
- `SessionInfo.modified` already represents latest user/assistant activity and global listing is newest-first.
- `session-reader.ts` resolves `parentSessionId` when both parent and child are discoverable.
- Existing Project sorting uses each root/sibling's own timestamp, not newest descendant activity.
- Pi has no native pin/archive field; dedicated pi-web metadata avoids unsupported Pi settings and session-file mutation.
- No DOM interaction test harness exists; current tests use Node's test runner with Jiti.

### Scope

**In scope:** sidebar composition, shared row behavior, Pinned/Recent derivation, shared pin/hidden metadata, recursive hiding and recovery, Project family ordering, project prefixes, accessibility, responsive behavior, tests, diagnostics, and current-state docs.

**Out of scope:** Pi extensions, slash commands, JSONL archive/moves, floating panels, draggable dividers, persisted pane sizes/collapse state, drag-reordered pins, configurable Recent windows/counts, and a new DOM-test framework.

## Test Strategy

### Automated

Add focused Node/Jiti tests for:

- State validation/defaults, pin ordering, idempotent operations, optimistic replay, and stale responses.
- Selected-node descendant hiding, ancestor/sibling exclusion, future forks, redundant markers, cycles, and missing parents.
- Pin preservation and hidden-first filtering across all sections.
- Exact ten-day boundaries, uncapped Recent ordering, and next-expiry scheduling.
- Unique project prefixes and visible-descendant Project ordering.
- Temporary-directory storage: atomic writes, concurrent operations, malformed-state refusal, lock timeout, and successful-only stale cleanup.

Run:

```bash
node --test lib/*.test.mjs components/*.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

### Runtime and Visual

- Validate desktop 260 px and mobile 280 px/85vw sidebars at short and tall heights.
- Exercise empty and over-five-row global sections, independent scrolling, collapse controls, and Explorer's collapsed default.
- Exercise pointer, keyboard, and touch access for every new control.
- Exercise cross-project selection, duplicate project names, worktrees, an all-hidden project, hidden pinned/selected/running sessions, Restore, and overlapping operations from two browser clients.
- Capture desktop and mobile screenshots.
- **Waived:** automated DOM interaction coverage, because no harness exists and adding one would materially expand scope. Pure tests plus explicit browser validation are the substitute.

## Telemetry / Debuggability

- Add no analytics or success-event stream.
- Log bounded failure categories: `sidebar_state_invalid`, `sidebar_state_lock_timeout`, `sidebar_state_read_failed`, and `sidebar_state_write_failed`.
- Include operation kind, revision/counts, and sanitized error class only; never log session IDs, paths, messages, or file payloads.
- Return stable API error codes. The sidebar shows a compact error and Refresh is the recovery path.
- Verify diagnostics with temporary malformed/locked state fixtures.

## Validation Contract

| ID | Priority | Type / surface | Required truth | Required evidence | Validator mode | Blocker / waiver |
|---|---|---|---|---|---|---|
| VC-001 | P0 | Visual/layout | Sidebar order, bounded global sections, usable Project area, and collapsed Explorer match the confirmed desktop/mobile behavior. | Desktop/mobile screenshots and short/tall viewport passes with empty and over-five-row fixtures. | both | Release blocker; only DOM automation is waived. |
| VC-002 | P0 | Pin/domain | Pins are shared, stable, newest-pinned-first, absent from Recent, retained in Project, and preserved through hide/restore. | Pure/store tests and two-client refresh pass. | both | No waiver without user approval. |
| VC-003 | P0 | Recent/domain | Recent is instance-wide, uncapped, exactly ten-day message-active, excludes pinned/hidden sessions, and ages out live. | Boundary/expiry tests and runtime scroll pass. | scrutiny | No waiver. |
| VC-004 | P0 | Hide/runtime safety | Hide affects the selected node and descendants only and never changes JSONL, Pi settings, chat selection, runs, navigation, or pins. | Graph tests, fixture file checks, and selected/running manual passes. | both | No waiver. |
| VC-005 | P0 | Recovery/UI | Global temporary Show hidden distinguishes explicit/inherited state; Restore reveals the complete marked subtree; delete has no special cascade. | State tests and hide/show/restore/delete runtime flows. | both | No waiver. |
| VC-006 | P1 | Tree/context | Fork ancestry is preserved, visible descendant activity orders families deterministically, and global prefixes disambiguate projects/worktrees. | Ordering/prefix tests and collision screenshots. | both | Fixture blockage must be documented. |
| VC-007 | P0 | API/filesystem | Operations do not lose concurrent updates; writes are atomic; malformed state is preserved; stale responses cannot reverse intent; metadata errors do not block browsing. | Concurrency, lock, malformed-file, and reconciliation tests plus diagnostic evidence. | scrutiny | No waiver. |
| VC-008 | P0 | Regression/accessibility | Existing navigation/status/Explorer behavior remains; new controls are keyboard/touch accessible and visibly focusable. | Full tests and focused desktop/mobile regression matrix. | both | Regressions block release. |
| VC-009 | P0 | Static/docs/closeout | Tests, TypeScript, and lint pass without `next build`; docs match behavior; final checkpoint records evidence and departures. | Exact command output, doc review, screenshots, implementation commit, and final Implementation Summary. | scrutiny | Any skipped layer needs explicit disposition. |

## Assumptions, Risks, and Blockers

### Assumptions

- Sessions continue to be addressable by ID when surfaced outside their selected project; existing cross-cwd selection already follows this path.
- A missing/unresolved parent relationship makes that session a visible root unless another discoverable explicit marker covers it.

### Risks

- Narrow rows can crowd pin and existing actions, especially for deep forks and mobile widths.
- Concurrent state writes or late client responses can lose intent without serialization and revision handling.
- Moving project controls and adding scroll containers can accidentally disturb selection, running/unread state, or Explorer lifetime.
- Manual interaction testing is required because DOM automation is waived.

### Blockers

None known.

## Implementation Handoff

Approved plan: `.agents/plans/2026-07-21-pinned-sessions.md`

Start implementation with:

```text
/start-implementation .agents/plans/2026-07-21-pinned-sessions.md
```

Approval and this plan commit do not begin implementation.
