# Published AgentSession Shutdown Checkpoints

Plan: `.agents/plans/2026-08-08-published-agent-session-shutdown.md`

## Handoff

**Source:** Scout run `ad8f0221`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-08-published-agent-session-shutdown--/2026-08-09T03-10-02-593Z_019fe47f-b561-750e-989a-1d0dfbe067a8/ad8f0221/run-0/session.jsonl`.

**Purpose:** Map the exact wrapper shutdown sequence, published versus unpublished release boundaries, admission and extension-binding guards, public Pi abort/compaction/runner APIs, contextual Fork flow, and focused test seams without editing.

**Outcome:** Confirmed that one memoized wrapper operation can close admission, await only already-started binding, abort compaction and agent work, strictly emit `session_shutdown`, and reuse final native disposal. Identified idle expiry, contextual Fork, failed published ensure, generation retirement, and server shutdown as published release paths; pre-publication startup and identity failures remain bare disposal. The implementation followed those boundaries and used only package-root-exported structural types and public methods.

**Evidence:** The scout traced `lib/rpc-manager.ts`, `lib/new-agent-route.ts`, `lib/pi-types.ts`, the existing RPC tests, and the pinned Pi `agent-session`, `agent-session-runtime`, and extension runner sources. Parent inspection rechecked the decisive public API and caller claims before editing; focused tests now cover ordering, reentrancy, strict waiting, binding failure, Fork, idle, ensure failure, and publication boundaries.

**Uncertainty / gaps:** The scout warned that closing must be distinct from native lifetime, `abort()` does not cancel compaction, and generation cleanup must start wrappers concurrently. Its structured acceptance metadata was rejected only because no machine-readable acceptance report was emitted; the read-only output and session remain recoverable.

**Recommended use:** Preserve the exact publication boundary and keep `destroy()` as bare terminal cleanup only for prepared-but-unpublished rollback or the final step inside shared shutdown.

## Handoff

**Source:** Scout run `948ad9c1`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-08-published-agent-session-shutdown--/2026-08-09T03-10-02-593Z_019fe47f-b561-750e-989a-1d0dfbe067a8/948ad9c1/run-0/session.jsonl`.

**Purpose:** Identify the narrow runtime-owner promise bridge that lets server close observe semantic cleanup without delaying or resetting S6's absolute ten-second network force point.

**Outcome:** Recommended a memoized RPC-generation cleanup promise, a `void | Promise<void>` runtime-owner callback, gateway-side observation of every active or retired owner cleanup, and server-side joining only after the existing natural-drain/force phase. The implementation follows that shape without changing channel ownership, tickets, frames, socket admission, HMR generation rules, or the network resource predicate.

**Evidence:** The scout traced `lib/websocket-gateway.ts`, `bin/pi-web-transport-gateway.js`, `bin/pi-web-server.js`, `lib/rpc-manager.ts`, and S6's fake-clock harness. Parent inspection verified that the deadline is captured before owner cleanup, force remains at the original 10,000 ms point, and semantic waiting occurs afterward. Focused tests cover deferred active cleanup, pending retired plus active generations, and exact 9,999/10,000 ms behavior.

**Uncertainty / gaps:** Strict waiting intentionally permits a nonsettling extension handler to keep semantic close pending after network resources settle. The scout's structured acceptance metadata was rejected only because no machine-readable acceptance report was emitted; the read-only output and session remain recoverable.

**Recommended use:** Never add semantic completion to the network `ownedAreSettled()` predicate or await it before the absolute force phase.

## Implementation Summary

**Plan section:** Section 1 — Add one surgical wrapper-owned shutdown operation.

**Work and outcome:** Added synchronous closing admission and one memoized `shutdown()` operation to `AgentSessionWrapper`. It joins already-started extension binding while reporting binding failure through the bounded existing class path, cancels an undispatched hosted kickoff, aborts compaction and agent work through public methods, strictly awaits exactly one `session_shutdown { reason: "quit" }`, and guarantees the existing exact-once native/UI/registry destruction path in `finally`. Direct `destroy()` remains the bare unpublished/final-native boundary; no `AgentSessionRuntime`, private API, timeout race, or generalized operation registry was added.

**Validation / evidence:** Ordered deferred fakes prove binding → abort compaction → abort → shutdown dispatch → disposal; concurrent and reentrant callers receive the exact same promise; late commands and hosted kickoff are rejected immediately; real `ExtensionRunner` coverage proves handler rejection isolation and strict waiting; binding failure continues to shutdown with one sanitized diagnostic; dispatch-level rejection still disposes once.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Section 2 — Change only the existing release callers.

**Work and outcome:** Idle expiry now starts and observes shared shutdown; contextual Fork creates and caches its child before awaiting source shutdown; failed published ensure awaits shutdown before replacement-safe path-cache invalidation; RPC generation retirement concurrently starts every published wrapper shutdown and exposes one shared result; and the gateway/server owner bridge observes active and retired generation cleanup. Server close begins semantic cleanup at shutdown start but waits for it only after S6's unchanged absolute network drain/force phase.

**Validation / evidence:** Focused tests distinguish unpublished bare rollback from published shutdown, assert idle/Fork/ensure/server dispatch, preserve exact cache ownership, join pending replacement and active generations, aggregate runtime-owner failure while still uninstalling the gateway and closing Next, and prove zero force at 9,999 ms plus one force at 10,000 ms while semantic cleanup remains pending.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Section 3 — Preserve non-release behavior, focused regression coverage, and maintained lifecycle documentation.

**Work and outcome:** Stop remains abort-only; Clone, Hide/Restore, navigation, browser disconnect, native reload, and unrelated-session ownership remain non-release operations. Updated `AGENTS.md` and durable hosted-session, custom-server, and removal-policy memory to describe strict published shutdown, bare unpublished rollback, contextual Fork, and the independent network deadline. No transport protocol, ticket metadata, signal handler, dependency, Pi fork, or build artifact changed.

**Validation / evidence:** The post-review focused command `env -u NODE_ENV node --test lib/rpc-manager.test.mjs lib/session-channel-integration.test.mjs lib/s6-lifecycle.test.mjs lib/pi-web-server.test.mjs` passes 210 tests. The final repository-wide `env -u NODE_ENV node --test lib/*.test.mjs components/*.test.mjs` passes 766 tests; `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit -p tsconfig.json`, `npm run lint`, both changed-bin `node --check` commands, and `git diff --check` pass. Full-suite validation used a temporary worktree `node_modules` symlink to the retained main dependency tree, which was removed immediately. Final reviewer run `4cddd6ce` independently found no blocker or fix worth doing now after passing the focused suite and static gates.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Handoff

**Source:** Fresh reviewer run `c20b1f23` in workflow `call_hfL2Pyr97yqmoYMs9KnY69Mi|fc_01c3b20886c745d6016a77f414e18c81938664ee9cf0485a7f`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-08-published-agent-session-shutdown--/2026-08-09T03-10-02-593Z_019fe47f-b561-750e-989a-1d0dfbe067a8/c20b1f23/run-0/session.jsonl`.

**Purpose:** Adversarially review wrapper lifecycle correctness, publication boundaries, release callers, admission/reentrancy, and non-release regressions against the approved plan.

**Outcome:** Found no production-code blocker or fix-worthy defect. It identified stale maintained lifecycle documentation as a closeout blocker and noted that idle and real server release paths did not explicitly assert the shutdown event. The parent corrected `AGENTS.md` and durable memory, then added exact idle and server integration assertions plus binding-failure coverage.

**Evidence:** The reviewer cited the wrapper shutdown sequence, all published and unpublished callers, server ordering, and focused tests. Parent reran the four focused files after disposition: 210 passed, 0 failed.

**Uncertainty / gaps:** Strict nonsettling handlers remain the intentional residual. The reviewer did not rerun validation after the documentation and test-only fixes.

**Recommended use:** Obtain one fresh follow-up review of the final diff and retain the explicit release-path assertions.

## Handoff

**Source:** Fresh reviewer run `f3277af3` in workflow `call_hfL2Pyr97yqmoYMs9KnY69Mi|fc_01c3b20886c745d6016a77f414e18c81938664ee9cf0485a7f`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-08-published-agent-session-shutdown--/2026-08-09T03-10-02-593Z_019fe47f-b561-750e-989a-1d0dfbe067a8/f3277af3/run-0/session.jsonl`.

**Purpose:** Review gateway owner cleanup, server close ordering, the absolute S6 deadline, failure aggregation, HMR/restart behavior, and test adequacy.

**Outcome:** Verified that semantic cleanup begins without delaying network drain/force and found no production defect. It identified stale documentation, missing server-level cleanup-rejection aggregation coverage, and a low residual for a pending `owner_replaced` generation followed by active server shutdown. The parent corrected the documentation, extended the existing server aggregate-failure test, and added a gateway test that joins both retired and active generation promises.

**Evidence:** The reviewer cited the exact deadline capture, cleanup start, force block, post-network semantic await, and gateway tracking code. The post-disposition focused suite passes 210 tests with no failures.

**Uncertainty / gaps:** The reviewer did not rerun validation after the test-only fixes. Strict semantic cleanup remains intentionally unbounded.

**Recommended use:** Recheck the final test additions in a fresh review and preserve runtime-owner failure conversion to the bounded gateway class.

## Handoff

**Source:** Final fresh reviewer run `4cddd6ce` in workflow `call_QVFXboDQ5mCgVJurAJ3gb64A|fc_01c3b20886c745d6016a77f6acf18c81938d57dcdcda55bd20`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-08-published-agent-session-shutdown--/2026-08-09T03-10-02-593Z_019fe47f-b561-750e-989a-1d0dfbe067a8/4cddd6ce/run-0/session.jsonl`.

**Purpose:** Perform final read-only acceptance review of the complete production, test, documentation, memory, and checkpoint diff after every first-review disposition.

**Outcome:** Reported no blocker and no fix worth doing now. It accepted wrapper ordering/reentrancy, binding-failure continuation, published versus unpublished boundaries, every release caller, explicit idle/ensure/server dispatch assertions, active-plus-retired generation joining, bounded cleanup failure conversion, server error aggregation, the unchanged absolute deadline, non-release behavior, and maintained documentation.

**Evidence:** The reviewer independently passed the 210-test focused suite, TypeScript, lint, both changed-bin syntax checks, and `git diff --check`, and cited exact final source/test/doc ranges. Its fresh broad run lacked the temporary worktree dependency link and therefore reached 764 passing tests before only the real-production fixture and parent suite failed on absent worktree-local `node_modules/next/package.json`; the parent had already run the same broad command with the documented temporary link and obtained 766/766.

**Uncertainty / gaps:** Intentional residuals are strict nonsettling-handler wait, bare unpublished rollback, excluded `AgentSessionRuntime` adoption, pi-subagents' separate process-global collision, and the nested-worktree dependency-link requirement for the real-production fixture. No source risk requiring a fix remains.

**Recommended use:** Accept the implementation subject to the recorded final gates; do not weaken strict waiting or couple semantic completion to S6's network deadline.
