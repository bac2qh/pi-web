# Extend Pi Web Session Idle Retention

**Status:** approved
**Date:** 2026-08-18
**Target repository:** `pi-web`

## Objective

Increase Pi Web's fixed semantic-idle timeout from 30 minutes to exactly 12 hours.

Success means an otherwise idle in-memory `AgentSessionWrapper` remains available for 12 hours after its latest recognized semantic activity. Existing active-work deferral, idle-touch rules, explicit/server shutdown, native disposal, browser running state, and caller-supplied Pi Subagents deadlines remain unchanged.

This is deliberately a simple fixed-window correction, not subagent-aware lifecycle tracking. It greatly reduces the chance that Pi Web's automatic cleanup interrupts a long async subagent run, but a run exceeding 12 hours can still be interrupted and every otherwise idle wrapper may remain allocated for up to 12 hours.

## Design / Implementation Strategy

1. Change `RPC_SESSION_IDLE_TIMEOUT_MS` in `lib/rpc-manager.ts` from `30 * 60 * 1000` to the self-explanatory fixed expression `12 * 60 * 60 * 1000`.
2. Keep the existing constructor injection and `armIdleWindow()` behavior unchanged. Recognized commands and native/projected activity continue to re-arm the window; passive heartbeat, socket, file-watch, and subscriber activity continue not to retain wrappers; modeled active work continues to defer expiry.
3. Do not add settings, environment variables, runtime controls, subagent event adapters, keepalive prompts, polling, browser protocol changes, or Pi Subagents package coupling.
4. Preserve authoritative shutdown. Stop, wrapper replacement, Fork teardown, server close, Ctrl+C/SIGTERM, process failure, and native disposal must not wait for the 12-hour timer.
5. Update the exact default assertion and test name in `lib/rpc-manager.test.mjs`. Continue using the existing injected short fake-clock interval for touch/expiry behavior rather than introducing real-time waits.
6. Update current maintained lifecycle documentation in `AGENTS.md`, `.agents/memory/custom-server-lifecycle.md`, and the append-only memory log from 30 minutes to 12 hours. Do not rewrite historical plans or checkpoints that accurately describe their earlier 30-minute contract.

### Scope estimate

- **Surfaces:** one server constant, one exact-default test assertion/name, and concise maintained lifecycle documentation.
- **Testability:** high; the existing injected clock proves behavior deterministically without waiting 12 hours.
- **Implementation difficulty:** low. No new runtime state, interface, dependency, browser behavior, or migration is required.

## Reference Files

- [`../../lib/rpc-manager.ts`](../../lib/rpc-manager.ts) — exported idle default, injected wrapper timeout, semantic touch rules, active-work deferral, and shutdown behavior.
- [`../../lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs) — exact-default assertion and deterministic idle/active/passive/shutdown coverage.
- [`../../AGENTS.md`](../../AGENTS.md) — maintained AgentSession lifecycle and repository validation constraints.
- [`../memory/custom-server-lifecycle.md`](../memory/custom-server-lifecycle.md) — durable current semantic-idle and authoritative-shutdown decisions.

## Decisions and Current Evidence

- The current exported default is exactly `30 * 60 * 1000`, and `startRpcSession()` supplies it to every normal Pi Web wrapper.
- The reproduced async workflow stopped at approximately the current 30-minute boundary after the parent appeared semantically idle.
- The user chose the simpler fixed 12-hour window instead of adding subagent-aware retention claims or launch-surface integrations.
- The 12-hour value is a fixed code default, not a user-configurable setting.
- Explicit subagent `timeoutMs`/`maxRuntimeMs` values remain independent and continue to apply.

## Test Strategy

- Update the exact-default RPC test to require `12 * 60 * 60 * 1000`.
- Run the focused RPC suite to retain coverage of semantic touches, active deadline deferral, post-settlement windows, passive transport exclusions, extension binding, exact shutdown, and disposal.
- Run the complete repository Node suite plus TypeScript, lint, and whitespace checks. Browser automation and `next build` are not applicable because there is no browser or production-build change; `next build` remains prohibited during development.

## Telemetry / Debuggability

No new telemetry is needed. The existing injected semantic-idle diagnostic categories continue to distinguish touches, active deferral, and disposal, while the exported constant and exact-default test make the configured window directly inspectable. Do not add production logs or expose timer state to the browser for this fixed-value change.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Every normal Pi Web wrapper uses an exact 12-hour semantic-idle default. | Source review and an exact assertion that `RPC_SESSION_IDLE_TIMEOUT_MS === 12 * 60 * 60 * 1000`. | Block completion. |
| VC-002 | Existing semantic touch, passive-activity exclusion, active-work deferral, and fresh post-settlement window behavior remain unchanged. | Existing deterministic fake-clock RPC tests, including recognized commands, native/projected activity, active predicates, and passive gateway/heartbeat/file-watch cases. | Fix the regression; do not weaken existing lifecycle behavior. |
| VC-003 | Explicit wrapper/server shutdown and native exact-once disposal remain authoritative and do not wait for the 12-hour window. | Existing focused shutdown, replacement, extension-binding, and disposal tests. | Block completion. |
| VC-004 | Current documentation and repository checks agree with the fixed 12-hour behavior. | Review `AGENTS.md`, lifecycle memory/log, and the final diff; run `NODE_ENV=test node --test lib/rpc-manager.test.mjs`, `NODE_ENV=test node --test lib/*.test.mjs components/*.test.mjs`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. | Fix in-scope failures; report unrelated pre-existing failures separately. Never run `next build`. |

## Assumptions, Risks, and Blockers

- **Accepted limitation:** this does not detect active subagents. An async run longer than 12 hours can still reach Pi Web's idle cleanup boundary.
- **Resource tradeoff:** any touched wrapper, including one without active background work, may retain its native session, extensions, timers, and related in-process state for up to 12 hours.
- **No persistence guarantee:** Stop, server restart, Ctrl+C/SIGTERM, process crash, machine failure, and operating-system termination can still interrupt in-process work.
- **No configuration surface:** changing the window again requires a code change; adding user configuration would be separate scope.
- **Repository dirt:** implementation must preserve all unrelated modified and untracked plan files in the checkout.
- **Blockers:** none currently known.

## Implementation Handoff

This draft is not approved and must not start implementation. After explicit finalization and approval, use:

```text
/start-implementation .agents/plans/2026-08-18-active-subagent-idle-retention.md
```
