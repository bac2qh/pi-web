# Remove Permanent Session Deletion from Pi Web

Status: approved
Date: 2026-07-31
Finalized: 2026-08-05

## Objective

Remove permanent session deletion from Pi Web and retain the existing reversible Hide/Restore workflow as the only web action for removing sessions from normal sidebar views.

Success means Pi Web exposes no session Delete control, confirmation state, client deletion callback, or `DELETE /api/sessions/[id]` Route Handler. DELETE requests cannot destroy a live wrapper, rewrite child ancestry, unlink JSONL, or mutate sidebar metadata. Existing session GET/PATCH behavior and Hide/Restore semantics remain unchanged.

## Design / Implementation Strategy

1. Remove the `DELETE` export and deletion-only imports from `app/api/sessions/[id]/route.ts`; retain only GET and PATCH. Let Next provide its ordinary method-not-allowed response. Do not keep a compatibility handler or reinterpret DELETE as Hide.
2. Remove the sidebar trash button, inline confirmation UI, deletion state, HTTP request, and `onDeleted`/`onSessionDeleted` plumbing through shared rows, project-tree recursion, `SessionSidebar`, and `AppShell`.
3. Recalculate row-action spacing so removing Delete leaves no empty slot or unnecessary title truncation.
4. Preserve Hide/Restore unchanged. Hide remains reversible sidebar metadata: it may hide a session and its descendants without changing JSONL, ancestry, selection, URL addressability, running state, pin state, or wrapper lifetime.
5. Update maintained documentation and add route/sidebar regressions. Do not change `rpc-manager`; this plan removes the observed trigger rather than redesigning session teardown.

**Scope estimate:** low-to-medium complexity. Expected surfaces are three production files, `AGENTS.md`, and one or two focused tests. Testability is high through direct route-export inspection, sidebar source/interaction assertions, existing Hide/Restore tests, and a short browser smoke. No SDK, WebSocket, session-registry, JSONL migration, or server-lifecycle change is required.

## Reference Files

- [`components/SessionSidebar.tsx`](../../components/SessionSidebar.tsx) — Delete and Hide/Restore controls, shared row state, and recursive callback plumbing.
- [`components/AppShell.tsx`](../../components/AppShell.tsx) — selected-session deletion callback and sidebar integration.
- [`app/api/sessions/[id]/route.ts`](../../app/api/sessions/%5Bid%5D/route.ts) — current GET/PATCH/DELETE handler and destructive JSONL behavior.
- [`app/api/sidebar-state/route.ts`](../../app/api/sidebar-state/route.ts) — persistent Hide/Restore operation boundary.
- [`lib/sidebar-session-state.ts`](../../lib/sidebar-session-state.ts) — hidden-session and descendant-closure semantics.
- [`components/SessionSidebar.test.mjs`](../../components/SessionSidebar.test.mjs) — shared-row and Hide/Restore regressions.
- [`lib/sidebar-session-state.test.mjs`](../../lib/sidebar-session-state.test.mjs) — hidden-state behavior coverage.
- [`AGENTS.md`](../../AGENTS.md) — maintained API and sidebar behavior documentation.

## Decisions and Scope

### User decision

The stale-extension-context failure has only been observed through deletion. The user explicitly chose to remove both Pi Web's permanent-delete control and Route Handler because reversible Hide already exists. DELETE must not become a hidden alias for Hide or another destructive path.

### Current evidence

- Pi Web currently permits deletion of a session with a live wrapper: it reparents direct child headers, calls `AgentSessionWrapper.destroy()`, and unlinks the selected JSONL.
- Native disposal invalidates extension contexts without first emitting `session_shutdown`, allowing surviving extension timers or subscriptions to use stale context.
- Native Pi can delete inactive sessions from its selector but refuses to delete the active session. Pi Web need not expose that feature.
- Pi Web Hide/Restore already uses separate sidebar metadata, is reversible through Show hidden, and does not mutate session files or runtime ownership.

### In scope

- Remove all Pi Web session-delete UI, state, callbacks, HTTP invocation, Route Handler code, and deletion-only imports.
- Preserve and regress Hide/Restore behavior and accessibility.
- Remove stale action spacing, styles, comments, and prop plumbing.
- Update maintained documentation.

### Out of scope

- Archive, retention, garbage collection, storage quotas, bulk cleanup, or replacement permanent deletion.
- Any change to Hide/Restore, descendant closure, pinning, selection, direct URL access, Show hidden, or active-session behavior.
- Graceful `session_shutdown` parity for other wrapper-release paths. A stale-context failure observed outside deletion requires a separately evidenced follow-up.
- Pi SDK/native Pi changes, recovery of already-deleted files, session migration, or unrelated DELETE endpoints.

## Test Strategy

- Extend `components/SessionSidebar.test.mjs` to prove rows still expose Rename, Pin, Hide, and Restore but contain no Delete control, confirmation state, deletion callback, or session DELETE fetch.
- Add or extend a focused route-module test asserting that `app/api/sessions/[id]/route.ts` exports exactly GET and PATCH and no longer imports wrapper destruction, unlink, or child-reparent helpers.
- Re-run `lib/sidebar-session-state.test.mjs` to preserve explicit/inherited hiding, descendant closure, restore, pin, and presentation behavior.
- Browser-smoke desktop and focus/touch-accessible row actions: Hide removes a visible session; Show hidden reveals it; Restore returns it; no Delete control or blank action slot remains; hiding the selected session does not close or navigate away from its chat.
- Run focused tests, the full Node test suite, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. Do not run `next build`.

## Telemetry / Debuggability

No new runtime telemetry is warranted for feature removal. Next supplies ordinary method-not-allowed behavior, while tests make the absence of the UI action, HTTP call, handler export, wrapper destruction, ancestry rewrite, and unlink explicit. Do not log attempted DELETE requests or session identifiers.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | No Pi Web session row offers or invokes permanent deletion. | Focused sidebar test and browser inspection show Rename/Pin/Hide/Restore but no Delete label, trash control, confirmation state, callback, or DELETE fetch. | Remove every remaining deletion path; cosmetic hiding is insufficient. |
| VC-002 | `app/api/sessions/[id]` supports exactly GET and PATCH and contains no destructive session logic. | Route export regression and source review show no `DELETE`, `getRpcSession`, unlink, or child-header rewrite; an HTTP smoke may additionally confirm method-not-allowed. | Remove the undocumented handler; never reinterpret DELETE as Hide. |
| VC-003 | Hide/Restore remains reversible and non-destructive, including descendant closure and selected-session behavior. | Existing sidebar-state tests and browser smoke verify Hide, Show hidden, Restore, selected-chat continuity, and unchanged session/runtime ownership. | Revert any Hide semantic change and keep work limited to deletion removal. |
| VC-004 | Removal leaves no stale UI plumbing or layout gap. | Typecheck, focused assertions, and desktop/focus/touch inspection cover props, state, comments, action spacing, and title truncation. | Remove stale code and correct layout before completion. |
| VC-005 | Documentation and unrelated APIs remain accurate and unchanged. | Diff review confirms `AGENTS.md` describes GET/PATCH and Hide/Restore while unrelated DELETE handlers and runtime ownership are untouched. | Narrow the diff or correct maintained documentation. |
| VC-006 | Repository validation passes. | Focused tests, full Node suite, typecheck, lint, and `git diff --check` pass; any omitted layer is marked waived, blocked, or not applicable with rationale. | Fix regressions before completion. |

## Assumptions, Risks, and Blockers

- Hidden sessions continue consuming disk space. Permanent cleanup remains available outside Pi Web through native Pi's inactive-session deletion UI or direct filesystem management.
- Removing this internal DELETE method intentionally breaks unofficial callers, which will receive ordinary method-not-allowed behavior.
- Other bare native-disposal paths remain unchanged. This plan removes the only observed trigger; it does not claim complete graceful-teardown parity.
- The principal implementation risk is stale state, props, spacing, comments, or accessibility labels in the large shared sidebar component.
- No blockers remain.

## Implementation Handoff

Approved plan:

`.agents/plans/2026-07-31-graceful-session-teardown.md`

Start implementation later with:

```text
/start-implementation .agents/plans/2026-07-31-graceful-session-teardown.md
```
