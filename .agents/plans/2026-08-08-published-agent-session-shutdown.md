# Published AgentSession Shutdown Lifecycle

Status: approved
Date: 2026-08-08

## Objective

Make release of a published Pi Web `AgentSession` notify extensions before native disposal, without adopting `AgentSessionRuntime` or redesigning session management.

Success means:

- each published wrapper dispatches exactly one `session_shutdown { reason: "quit" }` and waits for it before `AgentSession.dispose()`;
- repeated or reentrant release calls share one result and cannot admit new wrapper work;
- never-published startup failures still use bare disposal without an invented lifecycle;
- idle expiry, contextual Fork, failed published ensure, generation retirement, and server shutdown use the same release operation; and
- the 30-minute idle policy, concurrent unrelated sessions, Clone, Hide/Restore, Stop, native reload, hosted ownership, running publication, and S6’s absolute ten-second network deadline keep their current behavior.

## Design / Implementation Strategy

### 1. Add one surgical wrapper-owned shutdown operation

Keep the existing `createAgentSessionServices()` → `createAgentSessionFromServices()` startup and the existing `AgentSessionWrapper.inner`. Do not construct or retain `AgentSessionRuntime`; its final `dispose()` is only the same shutdown-dispatch-then-dispose sequence, while its session-replacement machinery is not used by Pi Web.

Add a closing flag and memoized `shutdown()` promise to `AgentSessionWrapper`:

1. On the first call, synchronously close wrapper admission, cancel an undispatched hosted kickoff, and reuse the wrapper’s current guards so no new command, event publication, Fast refresh, or UI mutation starts.
2. Wait for extension binding if it has started. Binding failure is reported through the existing sanitized error path but does not skip shutdown.
3. Abort active agent work and compaction through the existing public `AgentSession` methods. Reuse current wrapper state; do not add a generalized operation registry or drain every unrelated continuation.
4. Await `inner.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })` exactly once.
5. In terminal cleanup, run the existing native/UI/registry destruction path exactly once so an unexpected dispatch-level rejection cannot skip `AgentSession.dispose()`.

Use strict waiting. A handler that never settles keeps semantic teardown pending; do not add `Promise.race`, private SDK imports, or a Pi-fork timeout API.

Keep direct `destroy()` only for a prepared owner that fails before publication/binding. Published callers must use `shutdown()`.

### 2. Change only the existing release callers

Wire the current release points to the shared operation:

- idle expiry starts `shutdown()` and observes any failure;
- contextual Fork awaits source shutdown after the child is created and cached;
- failed published `ensure_session` awaits shutdown before replacement-safe path-cache cleanup;
- RPC generation retirement starts shutdown for each published wrapper rather than disposing it directly; and
- server shutdown observes the generation’s shared cleanup promise through the narrow existing gateway owner boundary.

Make only the minimum gateway/server type and promise plumbing needed to observe that owner cleanup. Start semantic cleanup when shutdown begins, preserve the existing socket/HTTP close sequence, and await semantic cleanup only without moving or resetting the original network-force deadline. Do not change tickets, WebSocket frames, channel ownership, HMR generation design, or same-session startup locks.

### 3. Preserve all non-release behavior

Opening session B must not release session A. Idle release removes only the in-memory runtime; the JSONL remains and later access reopens it normally. Stop remains abort-only. Clone, Hide/Restore, navigation, browser disconnect, and native reload remain non-release operations with their existing lifecycle behavior.

**Scope:** approximately 4–6 small production/type edits centered on `rpc-manager`, the existing gateway/server owner-cleanup bridge, and the failed-ensure caller, plus 2–3 focused test files and concise correction of the now-stale lifecycle notes in `AGENTS.md`/memory. The shutdown sequence is directly testable with deferred fakes. Difficulty is moderate because server cleanup must remain independent of S6’s network clock, but this is not a general lifecycle redesign.

## Reference Files

- [`AGENTS.md`](../../AGENTS.md) and [`custom-server-lifecycle.md`](../memory/custom-server-lifecycle.md) — maintained lifecycle statements that must remain accurate.
- [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) — wrapper binding, release callers, generation ownership, and current bare disposal.
- [`lib/pi-types.ts`](../../lib/pi-types.ts) — structural public `AgentSession` and `ExtensionRunner` surface.
- [`lib/new-agent-route.ts`](../../lib/new-agent-route.ts) — failed published ensure cleanup.
- [`lib/websocket-gateway.ts`](../../lib/websocket-gateway.ts), [`bin/pi-web-transport-gateway.js`](../../bin/pi-web-transport-gateway.js), and [`bin/pi-web-server.js`](../../bin/pi-web-server.js) — existing runtime-owner callback and S6 close deadline.
- [`lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs) and [`lib/s6-lifecycle.test.mjs`](../../lib/s6-lifecycle.test.mjs) — focused wrapper and server lifecycle harnesses.
- [`agent-session.ts`](../../../pi/packages/coding-agent/src/core/agent-session.ts), [`agent-session-runtime.ts`](../../../pi/packages/coding-agent/src/core/agent-session-runtime.ts), and [`extensions/runner.ts`](../../../pi/packages/coding-agent/src/core/extensions/runner.ts) — pinned abort, shutdown dispatch, and disposal ordering.
- [Upstream fix `edf4c5d5`](https://github.com/agegr/pi-web/commit/edf4c5d5d1ade7c8c1ec995cb92fe572337378f7) — useful wrapper-level precedent; this fork needs only narrow adaptation for its existing server owner bridge.

## Constraints and Current State

- This is a surgical bug fix, not runtime replacement or general session-lifecycle hardening.
- Use only package-root-exported Pi types and public methods. Do not change the pinned Pi fork, package identity, lockfile, or local-fork build.
- Preserve unrelated working-tree changes. Only this plan may be edited during planning.
- Permanent Delete remains absent; Hide/Restore remains the removal workflow.
- Do not add a generic operation tracker, new transport protocol, new ticket metadata, new process signal handler, or new shutdown timeout.
- Do not run `next build`.
- Current `AgentSessionWrapper.destroy()` calls `AgentSession.dispose()` without `session_shutdown`. Bare disposal invalidates extension contexts and native resources but gives extensions no cleanup event.
- Upstream fixed the basic defect by memoizing wrapper shutdown, awaiting extension binding and `session_shutdown`, then disposing. It still uses a bare `AgentSession`, confirming that `AgentSessionRuntime` is unnecessary for this fix.

## Test Strategy

Add focused tests for:

- shutdown ordering: binding → abort/settle → `session_shutdown` → native disposal;
- two concurrent/reentrant calls sharing one dispatch and one disposal;
- rejecting handlers being isolated by the real runner, and a deferred handler proving strict waiting;
- immediate rejection of new wrapper work once shutdown starts;
- published release paths using shutdown while pre-publication failure uses bare disposal;
- contextual Fork retaining its child/result behavior; and
- pending semantic cleanup not delaying or resetting S6’s force point at 10,000 ms.

Retain existing negative coverage showing Stop, Clone, Hide/Restore, navigation, browser disconnect, and opening another session do not release a wrapper. No broad continuation-race matrix or new real-extension fixture is required.

## Telemetry / Debuggability

Add no new telemetry system. Reuse existing bounded lifecycle diagnostics and log at most one sanitized shutdown failure class for a background caller. Do not log session IDs, paths, prompts, extension payloads, or arbitrary error text.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Every published release dispatches one `session_shutdown` before one native disposal; unpublished cleanup dispatches none. | Ordered wrapper fakes and release-caller tests. | Block on missing, duplicate, or misordered lifecycle work. |
| VC-002 | Shutdown closes admission immediately and repeated/reentrant callers share one operation. | Deferred binding/handler tests with commands attempted after close starts. | Block on accepted late work, duplicate cleanup, or unhandled rejection. |
| VC-003 | Strict waiting is preserved without private APIs or timeout races. | Deferred nonsettling-handler test and source review. | Block on premature disposal/completion or unsafe force logic. |
| VC-004 | Existing idle, Fork, server deadline, concurrent-session, and non-release semantics remain unchanged. | Focused wrapper/Fork tests and S6 fake-clock checks at 9,999/10,000 ms. | Block on changed user-visible ownership or network timing. |
| VC-005 | The exact candidate and maintained lifecycle notes pass focused tests, typecheck, lint, and diff validation without `next build`. | Review the concise `AGENTS.md`/memory correction; run focused Node tests, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. | Block closeout on stale documentation or any required failure. |

## Assumptions, Risks, and Blockers

- There are no known planning blockers.
- Strict waiting means a defective never-settling handler can keep semantic server cleanup pending after network resources have already followed S6’s fixed deadline.
- The implementation must distinguish a published wrapper from a prepared-but-unpublished wrapper; emitting shutdown for the latter would invent a lifecycle.
- Gateway changes are limited to observing the existing runtime-owner promise. Any need to redesign HMR generation serialization, startup locks, or transport ownership is out of scope and requires a separate plan.
- Pi Web shutdown gives pi-subagents its cleanup opportunity but does not fix pi-subagents’ separate process-global live-session state collision.

## Implementation Handoff

This rewritten plan remains draft until fresh approval. Approval will not start implementation.

After approval, implementation starts only with:

`/start-implementation .agents/plans/2026-08-08-published-agent-session-shutdown.md`
