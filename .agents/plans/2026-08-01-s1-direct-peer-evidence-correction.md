# S1 Distributed Admission Evidence Waiver

Status: approved

## Objective

Authorize the existing persistent-WebSocket orchestration session to waive one S1 evidence requirement: the real test that opens 256 WebSockets across at least four direct client addresses and rejects connection 257. No privileged command, loopback alias, interface change, route change, or other host-network mutation may be used.

Success means the same orchestration root resumes with its preserved history and worktree, completes every other S1 gate, commits S1, and continues S2-S7. The production limits remain 64 active Pi Web WebSockets per direct client address and 256 total. The completed `dot_files` wrapper remains unchanged.

## Design / Implementation Strategy

1. Treat this follow-up as a narrow durable amendment, not a replacement orchestration plan. Do not edit the immutable master or S1 plan, start another implementation session, or create another worktree.
2. Waive only the real distributed 256/257 integration run and its four-address/loopback-source setup. Record it as explicitly waived, never passed or silently skipped.
3. Retain the existing pure automated 256/257 accounting tests; real single-address 64/65, close/reconnect, malformed-handshake, ordering, cleanup, and forwarded-header tests; full automated S1 gates; Chromium/Firefox page inventory; hosted discovery/reconnect; HTTP schedulability; and fresh independent review.
4. After approval and an exact-plan commit, return the plan path and commit to the existing paused persistent-WebSocket orchestration root. That root records the waiver in its existing checkpoint and resumes from the preserved S1 source diff.

**Rough scope estimate:** one validation-authority amendment with no intended production-source change. Test scope is one explicit omission while all existing automated and browser layers remain. Testability is high; implementation difficulty is low. The main risk is accidentally treating the waiver as broader than the one real distributed test.

## Reference Files

- [Persistent-stream WebSocket migration master](2026-07-30-persistent-stream-websocket-migration.md)
- [Paused S1 milestone plan](../worktrees/orchestration-2026-07-30-persistent-stream-websocket-migration/.agents/plans/2026-07-31-s1-global-running-websocket.md)
- [Paused S1 checkpoint](../worktrees/orchestration-2026-07-30-persistent-stream-websocket-migration/.agents/checkpoints/2026-07-31-s1-global-running-websocket-checkpoints.md)
- [Gateway admission tests](../worktrees/orchestration-2026-07-30-persistent-stream-websocket-migration/lib/websocket-gateway.test.mjs)
- [Server integration tests](../worktrees/orchestration-2026-07-30-persistent-stream-websocket-migration/lib/pi-web-server.test.mjs)

## Constraints and Current State

- **User decision:** waive the real four-address 256/257 test that caused the S1 pause; never perform privileged or host-network-mutating setup.
- **User decision:** retain the existing orchestration session and context; focus on completing the WebSocket migration; leave the `dot_files` wrapper unchanged for now.
- S1 source fixes already passed 85 focused tests, 228 full tests, four real-Next tests, TypeScript, lint, package inclusion, diff checks, and fresh independent review.
- Pure tests cover distributed 256/257 accounting. Real tests cover single-address 64/65 and release/re-admission. The host has only two usable nonprivileged loopback addresses, so the immutable four-address real test caused the mandatory pause.
- Browser and workload evidence remained unexecuted only because orchestration stopped at that divergence; it is not waived here.
- Production `next build` was not the S1 blocker and remains release-workflow evidence.

## Test Strategy

- Rerun the existing pure 256/257 accounting tests and real 64/65, release/re-admission, ordering, handler-dispatch, forwarded-header, malformed-handshake, and shutdown tests.
- Rerun the focused/full/real-Next/typecheck/lint/package/diff gates and obtain fresh independent review.
- Complete Chromium and Firefox 1/5/10-page inventory, hosted Start/Orchestrate discovery reconnect, and five-page/seven-run plus ten-page/ten-run bounded HTTP completion evidence.
- Record the omitted real distributed 256/257 run as `waived` with this plan as authority.

## Telemetry / Debuggability

No production telemetry change is authorized. Existing bounded, identifier-free connection-limit diagnostics remain required. Waiver evidence may identify the omitted test shape but must not contain peer addresses, interface inventories, routes, tickets, URLs, session identifiers, content, credentials, or payloads.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Only the real four-address 256/257 integration run is waived; production limits and every other S1 obligation remain unchanged. | Compare this follow-up with the master, S1 plan, checkpoint, final diff, and obligation disposition. | Stop on any broader waiver or behavior change. |
| VC-002 | No privileged command or host-network mutation is attempted. | Command and runtime-evidence review. | Stop before the operation. |
| VC-003 | All retained automated, browser, hosted-discovery, schedulability, lifecycle, package, privacy, and review gates pass before S1 acceptance. | Existing S1 commands, browser evidence, checkpoint mapping, and fresh review. | Keep S1 blocked and do not start S2. |
| VC-004 | The original orchestration root remains sole owner and records the omitted test honestly as user-authorized `waived`. | Session/worktree/Git inspection and checkpoint review before the S1 commit. | Stop overlapping work or correct false/ambiguous evidence. |

## Assumptions, Risks, and Blockers

- Pure 256/257 accounting plus real 64/65 integration is weaker than exercising 256 live sockets through the complete Node upgrade path. The user explicitly accepts that residual evidence gap.
- Later ordinary use will not retroactively turn the waived test into a pass.
- A separate failure in the remaining browser or runtime gates is not covered by this waiver and may require another decision.

## Implementation Handoff

After explicit approval and a separate request to commit this exact plan, send its path and commit to the existing paused persistent-WebSocket orchestration root with the instruction to resume under this narrow waiver. Do not invoke a new Start or Orchestrate implementation command for this amendment.
