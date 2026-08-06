# Correct Native Agent Settlement Accounting

Status: approved
Date: 2026-08-06

## Objective

Prevent Pi Web sessions from remaining falsely active at “Waiting for model...” after Pi has completed automatic compaction, retry, or another multi-attempt logical prompt.

Success means:

- one session-level native `agent_settled` retires every native `agent_start` claim that existed for the completed logical run;
- Pi Web emits projected `run_settled` and removes the session from global running status once wrapper prompt/compaction work and the native session are otherwise idle;
- starts created reentrantly after terminal capture remain active;
- manual standalone compaction retains its one-start/one-end accounting;
- deterministic regressions cover multi-start settlement, delayed/rejected projection receipts, and terminal reentrancy without weakening same-session publisher authority.

## Design / Implementation Strategy

Treat native `agent_settled` as a session-level idle watermark rather than the terminal for only one low-level agent turn. At native terminal capture, snapshot and reserve all currently unreserved native-agent causal claims before raw listener fanout. Resolve that exact batch from the terminal projection receipt: committed settlement removes the batch once each claim’s start and terminal conditions are committed, while rejection restores the batch to an unreserved state. Any start created during terminal fanout is outside the captured batch and must continue to hold activity.

Keep standalone manual-compaction accounting one-to-one. Preserve the existing fanout barrier, delayed receipt handling, projected-final-before-global-idle ordering, and same-ID running publisher authority rules. Do not change Pi, session persistence, the WebSocket protocol, reducer semantics, or user-facing controls for the root correction.

**Rough scope estimate**

- **Surfaces:** primarily [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) and [`lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs).
- **Testability:** high through the existing deterministic wrapper/event-hub harness; no live model call should be required.
- **Implementation difficulty:** small-to-medium. The data change is localized, but delayed commit receipts, nested fanout, and publisher authority make a one-line counter reset unsafe.

## Reference Files

- [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) — native lifecycle claims, receipt resolution, activity settlement, and running publication.
- [`lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs) — deterministic lifecycle, reentrancy, delayed receipt, and publisher-authority regressions.
- [`lib/session-reducer.ts`](../../lib/session-reducer.ts) — projected `active` state clears only on `run_settled`.
- [`lib/session-view-projection.ts`](../../lib/session-view-projection.ts) — maps stale projected activity to `waiting_model`.
- [`hooks/useAgentSession.ts`](../../hooks/useAgentSession.ts) — canonical projected-state precedence over idle HTTP reconciliation.
- [`running-session-status.md`](../memory/running-session-status.md) — maintained finality and same-ID authority constraints.
- [`2026-08-05-stale-running-session-status.md`](2026-08-05-stale-running-session-status.md) — prior lifecycle-accounting design and validation obligations.

## Constraints and Evidence

- Live bounded inspection found native `isStreaming`, `isPromptRunning`, and `isCompacting` all false while the projected hub remained `active: true`; one committed native causal claim remained after `compaction_finished` and `native_settled`, and no `run_settled` followed.
- Pi coding-agent 0.82.1 treats `agent_settled` as the final session-level event after internal continuation loops. Its installed `_runAgentPrompt` performs `agent.prompt(...)`, then `agent.continue()` while post-run retry, compaction, or queued-message work remains, and calls `_emitAgentSettled()` only once in `finally`. Both initial and continued core loops emit `agent_start`.
- Current Pi Web code reserves only the first unreserved native claim for `agent_settled`. This is compatible with one start per logical prompt but leaks activity when Pi continues after automatic compaction or retry.
- Existing Pi Web retry/compaction lifecycle coverage emits only one `agent_start` before the final `agent_settled`; it therefore verifies nonterminal compaction events but not Pi’s multi-start/single-settlement contract.
- **User decision (2026-08-06):** keep this correction server-only. Browser self-healing, queued-message semantics, and general interrupt/steer UX are excluded because they could mask lifecycle defects or clear genuinely active work during a reconciliation race; any such work requires a separate approved plan.
- Existing unrelated working-tree changes must remain untouched.

## Test Strategy

First add a current-code-failing regression for Pi’s multi-start/single-settlement contract, then extend the existing deterministic `AgentSessionWrapper` lifecycle coverage with these event sequences:

1. Reproduce Pi’s continuation contract with `agent_start`, `agent_end`, automatic compaction or retry events, a second `agent_start`/`agent_end`, and one `agent_settled`; assert all pre-terminal native claims retire, projected state becomes inactive exactly once, and global status publishes idle only after projected finality.
2. During raw `agent_settled` fanout, synchronously emit a new `agent_start`; assert only the claims captured before fanout retire and the reentrant claim keeps projected/global activity live.
3. Delay and reject the shared terminal projection receipt; assert no premature idle publication and that every reserved claim is restored consistently on rejection.
4. Exercise nested or same-kind terminal reentrancy so one batch cannot consume claims captured by a later terminal.
5. Retain standalone manual-compaction one-to-one behavior and rerun existing overlapping prompt, abort/failure, hosted prompt, and same-ID authority regressions.

Prefer assertions on public/projected outcomes and existing deterministic counters over timing sleeps. Model the documented Pi event contract directly; a real provider call is not required for this accounting fix.

## Telemetry / Debuggability

No new production logging is planned. Multiple low-level starts followed by one session-level settlement are valid Pi behavior, so logging that path would add routine noise rather than identify an anomaly. The existing bounded observables—native `get_state` busy flags, projected `run_settled`/snapshot state, and global running membership—must converge in the regression tests. Test failure output should identify remaining native claim counts and projected activity without exposing prompts or provider payloads.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | One `agent_settled` clears every native-agent claim captured before its fanout and produces inactive projected state when no other work remains. | Deterministic multi-start/single-settlement regression in `lib/rpc-manager.test.mjs`; assert claim counts, one projected settlement, and final snapshot. | Stop; do not ship a partial decrement or force-reset workaround. Revisit batch capture and receipt resolution. |
| VC-002 | A start created during settlement fanout is not consumed by the earlier terminal and retains running publisher authority. | Reentrant terminal/start regression asserting projected active state and global running membership after the outer terminal resolves. | Stop; preserve the pre-fanout snapshot boundary before proceeding. |
| VC-003 | Delayed or rejected terminal receipts cannot publish idle early, strand reserved claims, or let stale activity reclaim another wrapper’s same-ID authority. | New delayed/rejected batch tests plus the existing receipt and same-ID authority suite. | Stop; repair transactional outcome handling rather than bypassing receipts. |
| VC-004 | Standalone manual compaction remains one-to-one and prompt/compaction overlap, abort, failure, destruction, and hosted-session paths retain their established finality. | Run the complete `lib/rpc-manager.test.mjs` suite with focused assertions unchanged or strengthened. | Stop and narrow the native batch behavior so it does not alter other lifecycle kinds. |
| VC-005 | The focused RPC suite, broader repository suite, TypeScript, lint, and whitespace gates pass. | Run `NODE_ENV=test node --test lib/rpc-manager.test.mjs`; `NODE_ENV=test node --test lib/*.test.mjs components/*.test.mjs`; `node_modules/.bin/tsc --noEmit`; `npm run lint`; and `git diff --check`. | Fix in scope; do not waive failures introduced by this change. Report unrelated pre-existing failures separately with evidence. |
| VC-006 | No unrelated source, plan, runtime, or user work is modified or staged. | Review `git status --short` and the scoped diff before commit/closeout. | Revert only task-owned unintended changes; preserve all pre-existing dirt. |

## Assumptions, Risks, and Blockers

- **Assumption:** Pi’s `agent_settled` remains a session-level idle watermark. This is supported by the installed 0.82.1 implementation and upstream regression semantics.
- **Risk:** Mutating all claims after listener fanout would erase reentrant work. The batch must therefore be captured before raw fanout and resolved from the exact terminal receipt.
- **Risk:** Treating manual compaction like native agent settlement would broaden behavior incorrectly; lifecycle kinds must remain distinct.
- **Risk:** Existing tests heavily exercise event rejection and authority replacement. The fix must extend that model rather than directly zeroing counters.
- **Residual recovery:** Wrappers already stranded in a running server process may require server restart after deployment; projected state is process-local and session transcript data is unaffected.
- **Blockers:** None currently known. Explicit plan approval remains required before implementation.

## Implementation Handoff

After this plan is explicitly approved, start implementation with:

```text
/start-implementation .agents/plans/2026-08-06-native-agent-settlement-accounting.md
```
