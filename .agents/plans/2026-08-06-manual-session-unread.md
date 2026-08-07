# Manual Session Unread Marker

Status: approved
Date: 2026-08-06
Approved by user: 2026-08-06

## Objective

Let a user deliberately restore the existing blue unread dot on a sidebar session so unfinished sessions remain visibly noticeable while the user works across many conversations.

Success means an accessible row action brings back that same dot consistently in Pinned, Recent, and Project presentations, preserves its current guarded browser-local persistence and ordinary open-to-clear behavior, and does not interfere with running, pinning, hiding, renaming, session selection, or automatic background-completion unread behavior.

## Design / Implementation Strategy

1. Extend the existing unread-state path in `SessionSidebar` rather than creating a second reminder concept. Keep one unread set so automatic background completions and manual actions render the same existing blue dot across every duplicate presentation of a session.
2. Add an accessible row action that reflects current state (`Mark unread` / `Mark read`), stops row navigation, works with mouse, keyboard, focus, and touch, and updates every presentation of the same session immediately. Fit it into the existing focus/touch-visible action group without obscuring the title, metadata, fork collapse, pin, rename, or Hide/Restore controls.
3. Preserve the existing blue-dot lifecycle: background completion marks an unselected session unread, a newly running session clears unread, and explicitly opening a session clears unread. Marking the currently selected session may restore its dot; a subsequent explicit row open—including clicking that selected row again—or leaving and reopening clears it.
4. Reuse the current guarded `pi-web:unread-session-ids` browser storage, malformed-state tolerance, and stale-ID pruning. Do not expand the strict shared pinned/hidden sidebar-state schema or add an API for this deliberately small extension of the existing dot.
5. Extract small pure unread-set transition/storage helpers from the component where that materially improves tests, then cover automatic and manual transitions, duplicate rows, selection, running, reload, and stale-session edges without relying only on source-text assertions.

**Rough scope estimate:**

- **Surfaces:** `components/SessionSidebar.tsx`, focused sidebar tests, and possibly one small client-safe unread helper/test file if extraction produces clearer behavioral coverage. No server route or shared-state schema changes.
- **Testability:** high for pure unread-set transitions and accessible action wiring; moderate for focus/touch layout and duplicate-row synchronization, which need browser checks because the repository has no DOM mounting test dependency.
- **Implementation difficulty:** low to moderate; state reuse is small, while selected-row clearing and fitting another accessible compact action need deliberate handling.

## Reference Files

- [`components/SessionSidebar.tsx`](../../components/SessionSidebar.tsx) — owns current unread detection, guarded `localStorage` persistence, selection clearing, indicators, duplicate sidebar presentations, and row actions.
- [`components/SessionSidebar.test.mjs`](../../components/SessionSidebar.test.mjs) — focused sidebar behavior, source/component regression coverage, and evidence that row actions must remain keyboard/focus/touch accessible.
- [`app/globals.css`](../../app/globals.css) — owns focus, hover, and coarse-pointer visibility for the existing session-row action group.
- [`lib/sidebar-session-state.ts`](../../lib/sidebar-session-state.ts) — documents the strict shared pinned/hidden schema that this browser-local unread change must not expand.
- [`../memory/session-removal.md`](../memory/session-removal.md) — maintained boundary that sidebar presentation metadata must not mutate or dispose native sessions.

## Constraints, Decisions, and Current State

- Current unread state is already browser-local under `pi-web:unread-session-ids`, guarded against unavailable/malformed storage, and pruned after a complete session listing no longer contains an ID.
- Current automatic behavior marks a background session unread when it transitions from running to idle, clears unread when a session starts running, and clears unread whenever that session becomes selected.
- **User clarification, 2026-08-06:** this feature is “basically just bring back the blue dot.” It reuses ordinary unread state rather than introducing a durable task/reminder status or a distinct visual treatment. Opening clears it; the user can bring it back again.
- One unread set feeds Pinned, Recent, and Project rows, so a state change remains session-scoped rather than row-scoped.
- Running status visually takes precedence over the unread dot. Pin, Hide/Restore, rename, fork collapse, and session navigation are independent controls and must remain so.
- Existing shared sidebar metadata is a strict versioned schema containing pinned and explicitly hidden IDs only. The minimum interpretation of “bring back the blue dot” keeps the existing unread mechanism browser-local and leaves that schema/API unchanged.
- The project memory index contains no prior manual-unread decision. Existing session-removal policy does not block this feature because an unread marker is presentation metadata and does not remove or dispose a session.

## Test Strategy

- Cover manual mark-unread and mark-read transitions, automatic completion interaction, newly-running interaction, selected-session/re-click behavior, stale-ID cleanup, guarded browser-storage failure tolerance, and reload restoration/open-to-clear behavior.
- Verify one action updates the session in Pinned, Recent, and Project presentations without duplicate or row-local divergence.
- Verify accessible name/state, keyboard activation, event propagation, focus/touch discoverability, row title/indicator wording, and compact layout with pin, fork collapse, rename, and Hide/Restore present.
- Run focused sidebar tests, the complete affected Node test layers, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. Do not run `next build`.
- Perform a privacy-safe browser pass covering selected and unselected sessions, running-to-idle completion, reload persistence, Pinned/Recent/Project duplicates, narrow layout, keyboard focus, and touch-equivalent action visibility.

## Telemetry / Debuggability

No production event telemetry is needed for a synchronous browser-local presentation marker. Keep diagnosis bounded to visible action state, the existing unread indicator/title, and guarded persistence behavior. Do not add logs for session titles, messages, paths, stored IDs, or storage payloads.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | A user can explicitly mark an eligible session unread and mark it read through an accessible row action, with immediate consistent state in Pinned, Recent, and Project presentations. | Focused state/component tests plus mouse, keyboard, focus, and touch-equivalent browser checks. | Stop; action, accessibility, propagation, or duplicate-presentation failures block completion. |
| VC-002 | Manual unread restores the existing dot; it survives under the existing browser-local rules, while explicit row opening—including re-clicking a selected row—clears it, and running/automatic-completion transitions retain their current semantics. | Pure transition/storage tests and browser sequences for selected/unselected, re-click, running/idle, completion, reload, and stale-session cleanup. | Stop and correct the state model rather than adding timing exceptions. |
| VC-003 | Existing automatic background-completion unread behavior and running-indicator precedence remain correct. | Regression tests and a browser running-to-idle pass on selected and background sessions. | Stop for regressions in completion visibility or stale running/unread state. |
| VC-004 | Pin, unpin, Hide/Restore, rename, fork collapse, navigation, list derivation, and session/native lifecycles are unchanged. | Existing sidebar suites, targeted interaction checks, and final diff review. | Stop for changed-surface regressions; isolate unrelated pre-existing failures. |
| VC-005 | Existing browser-local persistence remains bounded, malformed/unavailable state fails safely, stale IDs are pruned, and no sensitive session data is logged. | Focused storage-helper tests plus source and browser failure-path inspection. | Fail closed; do not ship unbounded, corrupting, or privacy-leaking state. |
| VC-006 | Affected/full Node tests, TypeScript, lint, and diff checks pass without dependencies or `next build`. | Recorded command output and final status/diff review. | Fix changed-surface failures; report unrelated pre-existing failures separately. |

## Assumptions, Risks, and Blockers

### Assumptions

- “Bring back the blue dot” means reuse the current cyan-blue unread indicator, browser-local ID set, and open-to-clear lifecycle rather than add a separate task/reminder badge.
- Manual unread is presentation metadata only and must not edit JSONL transcripts, timestamps, active leaves, running work, or native session ownership.
- No dedicated unread-only sidebar section, sorting rule, bulk action, notification, server persistence, or cross-browser synchronization is required.

### Risks

- The selected-session effect runs on selection changes, so a manual action can restore the dot on the currently selected row; explicit same-row opening must also clear it instead of relying only on a changed `selectedSessionId` dependency.
- Adding a third focus/touch-visible action can crowd a 54px row, especially with fork collapse and pin controls; metadata padding and action positioning need browser validation.
- A single set means existing “newly running clears unread” behavior also clears a manual dot. That is consistent with reusing ordinary blue-dot semantics and must be regression-tested.

### Blockers

None.

## Implementation Handoff

When approved, use:

```text
/start-implementation .agents/plans/2026-08-06-manual-session-unread.md
```
