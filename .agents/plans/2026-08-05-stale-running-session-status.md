# Clear Stale Running Status After Session Settlement

Status: approved

## Objective

Fix the permanent sidebar spinner that can remain after a Pi session has finished.

Pi Web keeps a server-side set of session IDs that are currently running. The sidebar renders a spinner for every ID in that set. Today, an otherwise idle session can be added to the set while Pi Web is briefly handling an ordinary session event, then never be removed.

Success means:

- completed hosted implementation sessions leave the running set without Stop, abort, refresh, restart, or timeout;
- an ordinary event received while a session is idle does not create a spinner;
- genuinely active prompts and compactions remain marked as running;
- an old or replaced session wrapper cannot change the status owned by its replacement.

## Design / Implementation Strategy

Each open Pi session has an `AgentSessionWrapper`, which is Pi Web's server-side object around the underlying Pi session. While this object delivers an event, it temporarily raises an internal “event handling” counter. That counter is useful because it prevents cleanup in the middle of event delivery.

The bug is an ordering mistake:

1. An idle session receives an ordinary event such as a session-name or metadata change.
2. Pi Web raises the temporary event-handling counter.
3. Pi Web publishes the running status while that counter is still raised, so the session is added to the global running set.
4. Event delivery ends and the counter returns to zero.
5. The ordinary completion path does not publish the corrected idle status, so the sidebar keeps the spinner permanently.

A separate-process probe reproduced this exact contradiction: after one idle `session_info_changed` event, `wrapper.isRunning()` was `false` while the global running set still contained the session.

Implement the smallest server-side correction in `lib/rpc-manager.ts`:

1. Keep the temporary event-handling counter; it is still needed for safe event delivery and idle cleanup.
2. Publish browser-visible running status at the stable end of outer event delivery, after the temporary counter has returned to zero. An idle event must not publish a false positive running transition.
3. Also publish the resulting status when a delayed projected-event result removes the last temporary lifecycle claim after event delivery has already returned.
4. Preserve the existing ordering for real starts and settlements: a real run becomes visible as running, projected finality completes once, and the final idle state is then published once.
5. Preserve the existing publisher-identity protection that prevents an obsolete wrapper from clearing or restoring a newer wrapper's status.
6. Do not change the sidebar, WebSocket protocol, HTTP API, persistence, timeout policy, Hide/Restore behavior, session deletion policy, or Pi SDK lifecycle.

### Scope estimate

- **Production code:** expected to be limited to `lib/rpc-manager.ts`.
- **Tests:** primarily `lib/rpc-manager.test.mjs`; existing hosted-session and global-status tests provide regression coverage.
- **Testability:** high. The defect is deterministic with a fake wrapper and a running-set subscriber.
- **Difficulty:** small implementation with concurrency-sensitive tests.

## Reference Files

- [Repository instructions](../../AGENTS.md)
- [Hosted implementation session memory](../memory/hosted-implementation-sessions.md)
- [Hosted implementation session plan](./2026-07-28-pi-web-hosted-implementation-sessions.md)
- [RPC wrapper and running projection](../../lib/rpc-manager.ts)
- [RPC lifecycle tests](../../lib/rpc-manager.test.mjs)
- [Hosted implementation capability](../../lib/hosted-implementation-session.ts)
- [Global status channel](../../lib/global-status-channel.ts)
- [Sidebar running-state consumer](../../components/SessionSidebar.tsx)

## Decisions and Evidence

- The correction is server-side. The sidebar currently displays the authoritative running set correctly; adding a browser timeout or self-healing workaround would only hide the incorrect server state.
- Two completed hosted implementation sessions were observed as globally running while prompt, streaming, tool, and compaction activity were all idle.
- A targeted idle abort removed those sessions because abort performs another final status publication. That confirmed the missing publication without making abort the product remedy.
- The deterministic standalone probe reproduced the defect without hosted-session machinery, proving that the shared wrapper lifecycle is the correct repair point.
- Existing focused lifecycle and global-status tests passed `118/118`, demonstrating a coverage gap: they verify wrapper and projected settlement but do not verify global membership after an idle event.
- Preserve unrelated working-tree changes. Do not run `next build` during implementation validation.

## Test Strategy

Add current-code-failing tests that prove:

- one accepted idle metadata event leaves the wrapper idle, leaves the global running set unchanged, and emits no positive running frame;
- a delayed event result that removes the final temporary claim publishes the resulting idle state;
- a real native start and settlement produce one balanced running-to-idle lifecycle;
- nested event delivery, retries, compaction overlap, prompt failure, abort, and destruction do not clear status early or leave it behind;
- hosted kickoff completion and hosted failure both leave no stale running ID;
- late updates from a replaced wrapper still cannot change the current wrapper's status;
- initial and reconnected global-status views expose the corrected authoritative set.

Run one sanitized browser smoke using a disposable idle session: verify no spinner, trigger the same session-metadata event class, and verify that no spinner appears and the transcript remains available.

## Telemetry / Debuggability

No new production logging is needed. Tests will subscribe to the existing running-set publication and record only finite state transitions. This directly distinguishes an idle false positive, a balanced real run, and a rejected stale publisher without exposing session IDs, names, paths, prompts, provider data, tickets, or credentials.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | An idle native metadata event cannot add a session to the running set. | Focused deterministic wrapper test and running-set subscriber assertions. | Block completion; retain the failing reproducer. |
| VC-002 | A completed hosted implementation session leaves the running set without a follow-up command or timeout. | Hosted lifecycle success and failure tests. | Block; trace the remaining unmatched transition. |
| VC-003 | Real prompt, compaction, retry, abort, and nested-event lifecycles remain balanced and are never cleared early. | Focused lifecycle and reentrancy tests. | Block; preserve the existing safety barriers. |
| VC-004 | Replaced wrappers remain authority-safe. | Existing and focused same-ID wrapper interleaving tests. | Block; do not weaken publisher identity checks. |
| VC-005 | The browser and global-status transports expose the corrected server set without UI or protocol workarounds. | Global-status integration tests, static boundary review, and sanitized browser smoke. | Block or request separate scope if the existing transport cannot represent the corrected state. |
| VC-006 | The bounded change passes repository validation. | Focused Node tests; `NODE_ENV=test node --test lib/*.test.mjs components/*.test.mjs`; `node_modules/.bin/tsc --noEmit`; `npm run lint`; `git diff --check`. | Block completion; do not use `next build` as ordinary validation. |

## Assumptions, Risks, and Blockers

- The ordinary event-delivery ordering bug is proven. Implementation should land that failing test before changing production code.
- A delayed projected-event result appears to have the same missing-final-publication risk; its focused test must prove whether the same small correction covers it.
- Publishing too early could hide a genuinely active nested event, retry, or compaction. The fix must publish after stable event delivery rather than remove the internal safety counter.
- Publisher identity is not implicated by the deterministic reproducer and should remain unchanged unless a separate failing test proves otherwise.
- If the fix requires changing projected-event semantics, WebSocket protocol, browser reconciliation, or the Pi SDK, stop for scope review rather than expanding this plan silently.

## Implementation Handoff

Finalization does not begin implementation. Start it only with:

```text
/start-implementation .agents/plans/2026-08-05-stale-running-session-status.md
```
