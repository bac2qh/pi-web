# Graceful Extension Shutdown for Pi Web Sessions

Status: superseded
Date: 2026-08-08
Disposition: No implementation. The user accepted the already-implemented removal of permanent session deletion as sufficient for the observed product issue and declined a broader proactive lifecycle change while no recurrence is visible.
Superseded by: `.agents/plans/2026-07-31-graceful-session-teardown.md` for the current product need only; the broader technical lifecycle gap is explicitly not claimed fixed.

## Supersession / No-Implementation Decision

On 2026-08-08, the user decided not to implement this broader graceful-extension-shutdown proposal. Permanent session deletion had already been removed from Pi Web, including its button and DELETE route, and the user reports no recurring issue after that removal. The completed deletion-removal plan and commits therefore resolve the observed product need sufficiently for now.

This disposition does **not** assert that every remaining native-disposal path emits `session_shutdown`. Current idle, contextual web Fork, and RPC generation/server cleanup still use bare native disposal. That residual is accepted without implementation unless a new observed failure or a separately requested lifecycle invariant justifies a new explicit planning cycle.

Do not launch implementation from this file. Preserve it only as the evidence and rationale for declining the broader change.

## Objective

Ensure Pi Web notifies extensions and gives their `session_shutdown` handlers a defined opportunity to finish before a published live session's extension API/context is invalidated by native `AgentSession.dispose()`.

Success means every production path that releases a published wrapper—semantic idle expiry, contextual web Fork, RPC generation/HMR/server shutdown, and published-owner setup failure—uses one idempotent joined teardown operation; extension cleanup and native disposal have explicit ordering and failure/latency behavior; existing S6 generation, running-publication, hosted-kickoff, transport, and server-close contracts remain correct; and tests prove the stale-context timer reproduction cannot result from skipped host shutdown.

This plan does not need the exact historical trigger to justify the lifecycle invariant. It also does not promise to suppress every stale-context error: native reload already emits shutdown, and an extension that continues after a correct shutdown remains an extension defect.

## Design / Implementation Strategy

Replace the current synchronous wrapper destruction boundary with one lifecycle state machine that becomes unavailable synchronously but exposes one shared asynchronous teardown result. The first caller records a finite host cause, closes admission to new wrapper work, cancels Pi-Web-owned continuations and scheduled hosted kickoff exactly as today, and starts teardown. Repeated or reentrant callers join the same result and cannot emit shutdown, dispose the native session, remove registry authority, or publish running state twice.

For a published wrapper whose extension runtime was started, emit and await one canonical `session_shutdown` event before invalidating the old extension API/context. Only after the selected completion/fallback policy is satisfied may Pi Web close final projected/UI ownership, call native `AgentSession.dispose()` once, notify destruction observers, remove registry/running authority through the existing identity-safe paths, and report a bounded outcome. A never-bound unpublished owner requires native cleanup but must not invent a lifecycle start/shutdown pair it never exposed.

Use only a supported public Pi SDK boundary. The pinned local fork exposes `AgentSessionRuntime`, whose `dispose()` performs shutdown then native disposal, but it has no cancellation or timeout. If strict waiting is selected, production runtime ownership is the leading supported integration. If bounded forced disposal is selected, the plan must first identify or add a safe one-shot public lifecycle primitive; it must not race `AgentSessionRuntime.dispose()` against a timer and then let its still-pending continuation dispose the same session again, and it must not import private package internals.

Make the process-global RPC runtime owner return or register an awaitable cleanup result so the custom server's existing idempotent close coordinator joins extension teardown rather than merely invoking synchronous wrapper destruction. Preserve the S6 absolute network-drain deadline and launcher-only signal ownership; do not silently reinterpret a network-owned deadline as an extension-handler timeout. Idle and Fork callers must observe or safely report teardown failure so no rejected promise escapes as an unhandled rejection.

Keep contextual web Fork and native reload separate. Reload already owns canonical old-shutdown/new-start behavior. Web Fork creates a child through Pi Web's source-stable extraction path and then releases the source wrapper; this plan will choose an accurate shutdown reason without adopting `AgentSessionRuntime.fork()`, enabling extension session-replacement commands, or changing Clone's source-live behavior.

Emit at most one teardown-start and one teardown-outcome diagnostic per wrapper. Safe fields are finite host cause, finite lifecycle reason, fixed stage/outcome, capped elapsed class, forced/not-forced, and sanitized error class. Never include cwd, session path or raw ID, prompts/messages, extension payloads, provider/tool content, environment values, credentials, tickets, private paths, or arbitrary error text.

**Scope estimate:** medium-to-high complexity across roughly 4–8 production/test/documentation files. The core behavior is highly testable with deferred handlers, fake clocks, fixture extensions, and existing S6 generation/server seams. The main risks are joining async cleanup to synchronous gateway owner callbacks, preserving one absolute server-close boundary, and defining safe behavior for a never-settling extension handler. Full session-replacement parity or a sibling Pi-fork API change would materially raise scope and requires explicit treatment rather than silent expansion.

## Reference Files

- [`AGENTS.md`](../../AGENTS.md) — current S6/server, wrapper, hosted-session, and Hide/Restore contracts.
- [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) — wrapper lifecycle, binding, idle, Fork, generation owner, startup, and direct native disposal.
- [`lib/pi-types.ts`](../../lib/pi-types.ts) — local structural SDK boundary.
- [`lib/new-agent-route.ts`](../../lib/new-agent-route.ts) — published-owner setup failure cleanup.
- [`lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs) — existing exact-once disposal, generation, binding, idle, Fork, and hosted tests.
- [`lib/s6-lifecycle.test.mjs`](../../lib/s6-lifecycle.test.mjs) — accepted server-generation, close, idle, and continuation lifecycle coverage.
- [`bin/pi-web-server.js`](../../bin/pi-web-server.js) — awaited server close and absolute owned-network drain boundary.
- [`bin/pi-web-transport-gateway.js`](../../bin/pi-web-transport-gateway.js) — synchronous RPC owner invocation and generation ownership.
- [Completed S6 plan](./2026-08-03-s6-lifecycle-security-shutdown.md) and [checkpoint](../checkpoints/2026-08-03-s6-lifecycle-security-shutdown-checkpoints.md) — immutable exact-once bare-disposal baseline and explicit graceful-parity exclusion.
- [Completed session-removal plan](./2026-07-31-graceful-session-teardown.md) and [checkpoint](../checkpoints/2026-07-31-graceful-session-teardown-checkpoints.md) — removal of permanent Delete as one trigger, not lifecycle parity.
- [Session-removal memory](../memory/session-removal.md), [hosted-session memory](../memory/hosted-implementation-sessions.md), and [custom-server memory](../memory/custom-server-lifecycle.md) — maintained current-state lifecycle boundaries that implementation must update.

## Constraints and Scope

### Fixed constraints

- Preserve current main behavior and lineage from completed S6/S7, session deletion removal, hosted implementation sessions, and the pinned local Pi fork.
- Use supported public SDK behavior; do not import `dist/core` internals or reach into private runner state.
- Keep stale-context guards enabled. Exception suppression is not a lifecycle fix.
- Preserve one native disposal, one shutdown attempt, one observer notification, one registry transition, and one running-authority transition per wrapper.
- Preserve Clone source liveness, Hide/Restore metadata-only semantics, browser-disconnect independence, hosted kickoff ownership, 30-minute semantic idle, generation-scoped starts, launcher-only signals, same-process production restart, and process-scoped Next development.
- Preserve unrelated modified/untracked plans and runtime artifacts.
- Do not expose private or secret-bearing data in tests, diagnostics, or evidence.
- Do not run `next build` during development.

### In scope

- One idempotent asynchronous teardown operation for published wrappers.
- Canonical extension shutdown before native invalidation, with explicit hang/error/fallback semantics.
- Awaited integration with RPC generation and custom-server cleanup.
- Idle, contextual Fork, published ensure failure, HMR/replacement, server close, and relevant startup-race caller propagation.
- Bounded lifecycle-cause/outcome diagnostics.
- Focused fixture-extension, wrapper, generation, server, and restart tests.
- Updates to maintained lifecycle documentation and memory after implementation.

### Out of scope

- Restoring permanent session deletion or changing Hide/Restore.
- Changing the 30-minute idle policy.
- Replacing Pi Web's source-stable web Fork/Clone behavior with SDK runtime replacement.
- Enabling extension `ctx.newSession()`, `ctx.fork()`, or `ctx.switchSession()`.
- External RPC migration, project-trust work, WebSocket protocol changes, browser transport redesign, or third-party extension patches.
- Treating a correct native reload as a host teardown defect.
- A broad sibling Pi-fork API change unless the selected timeout/fallback policy cannot be implemented safely through an existing supported boundary and the user separately accepts the expanded surface.

## Decisions

- **User decision:** do not implement broader graceful extension shutdown while the observed issue remains absent after permanent session deletion was removed.
- **Product disposition:** the completed deletion-removal plan is sufficient for the current reported problem; proactive parity for idle, Fork, and server cleanup is declined.
- **Technical truth preserved:** completed S6 and session-removal work did not add `session_shutdown` to every native-disposal path, and this supersession must not be cited as evidence that they did.
- **Future boundary:** any recurrence outside the removed DELETE path, or a new requirement for complete extension lifecycle parity, requires a new explicit investigation/planning invocation based on then-current source and SDK behavior.
- The misleading occupied filename `.agents/plans/2026-07-31-graceful-session-teardown.md` remains the completed permanent-deletion-removal plan; this distinct file records the declined broader follow-up.

## Evidence and Current State

### Established facts

- Current main is `34e8f4e011ba15a1d3022637d01756fb3a4a8fd9` at draft creation.
- `AgentSessionWrapper.destroy(): void` still closes Pi-Web-owned state and directly calls synchronous `this.inner.dispose()` without emitting or awaiting `session_shutdown`.
- Current bare-disposal triggers include 30-minute semantic idle, contextual web Fork, RPC generation/HMR/server close, published new-owner ensure failure, and startup/identity failure cleanup. DELETE is absent.
- Current installed dependency is the compatibility-keyed local fork `@bac2qh/pi-coding-agent@0.84.0-bac2qh.734502cb8` from exact sibling commit `734502cb86eaf631e1ceeb403dbd717e3b78404f`.
- In that fork, bare `AgentSession.dispose()` aborts/invalidate/disconnects without shutdown; public `AgentSessionRuntime.dispose()` awaits `session_shutdown { reason: "quit" }` before native disposal.
- Native reload already emits shutdown with reason `reload` and creates the fresh extension runtime.
- Completed S6 implemented 30-minute idle, generation ownership, continuation cancellation, exact-once native disposal, heartbeat, and owned server drain while explicitly excluding `AgentSessionRuntime`/full `session_shutdown` parity.
- Permanent session deletion was later removed in commits `084bb00a5c2a9a292675194fcf3686f3cdacfbf0` and `68c9c3d6e754155f11f4ad611bfe495b52215f33`; that work explicitly left other native-disposal paths unchanged.
- Current focused lifecycle/session-route tests pass but assert exact-once bare disposal, not shutdown-before-invalidation.

### Blocked facts

- The original exception's initiating trigger remains unrecoverable from existing logs.
- Read-only evidence cannot predict whether an arbitrary installed extension shutdown handler will settle.
- The final supported integration cannot be frozen until the hang/fallback policy is chosen because timeout-safe forced disposal and strict runtime-owned disposal have different API requirements.

## Test Strategy

Use synthetic extensions and deterministic lifecycle seams rather than installed packages as the acceptance authority:

- A fixture extension starts a timer that reads session context and clears it only after an asynchronous `session_shutdown`; prove shutdown completes before native invalidation and no post-disposal stale-context exception occurs.
- Trace one shutdown attempt and one native disposal across repeated/reentrant calls, idle expiry, contextual Fork, published ensure failure, RPC generation replacement, server close, and same-process restart.
- Exercise destruction before binding, during deferred successful binding, during failed binding, and after binding. Prove no shutdown is followed by late `session_start`, resource discovery, prompt dispatch, status mutation, or hosted kickoff.
- Preserve existing S6 generation collision, running-publication identity, old-finalizer, projected-hub, subscriber, hosted ownership, and exact-once disposal tests.
- Test shutdown handler success, ordinary rejection, and never-settling behavior according to the selected policy. If force is authorized, prove no late continuation can dispose or mutate the session again.
- Test contextual Fork child creation/result semantics and lifecycle reason/metadata separately from Clone, which must keep its source alive.
- Prove server/HMR cleanup joins wrapper teardown, retains one absolute close policy, aggregates bounded failures, and preserves launcher-only signals plus same-process production start/close/restart.
- Verify telemetry has finite fields/cardinality and no private data.

Required implementation validation is expected to include focused lifecycle tests, relevant full Node tests, `node_modules/.bin/tsc --noEmit`, `npm run lint`, package validation when runtime/package files change, and `git diff --check`. `next build` is prohibited.

## Telemetry / Debuggability

Expose bounded teardown transitions sufficient to answer which host path initiated cleanup and whether extension shutdown completed, failed, or required an approved non-graceful fallback. Diagnostics must distinguish host cause from SDK lifecycle reason and correlate start/outcome without raw session identifiers or paths. Repeated callers must not emit duplicate transitions or replace the initiating cause.

A durable application log sink is not part of this focused behavior fix. Runtime validation may explicitly capture terminal diagnostics, and maintained logging expansion requires separate scope.

## Validation Contract

| ID | Priority | Type/surface | Required truth | Required evidence | Validator mode | Blocker/waiver path |
|---|---|---|---|---|---|---|
| VC-001 | P0 | extension lifecycle | Every in-scope published-wrapper release attempts exactly one canonical `session_shutdown` before old-context invalidation and native disposal. | Ordered fixture-extension traces for idle, Fork, ensure failure, generation/HMR, and server close. | scrutiny | Block on any published live owner reaching bare disposal without the selected shutdown policy. |
| VC-002 | P0 | exact-once/concurrency | Repeated and reentrant teardown callers share one result; native disposal, hub/UI cleanup, observers, registry removal, and running publication remain exact once and generation-safe. | Deferred/reentrant unit tests plus existing S6 collision regressions. | scrutiny | Block on double disposal, duplicate shutdown, wrong-generation publication, resurrection, or retained owner. |
| VC-003 | P0 | binding/continuations | Teardown cannot be followed by late extension startup, resource discovery, command dispatch, hosted kickoff, or wrapper mutation. | Deferred binding success/failure/nonsettlement and post-wait liveness tests. | scrutiny | Block on any continuation crossing the teardown boundary. |
| VC-004 | P0 | latency/failure policy | Handler rejection and nonsettlement follow the explicitly approved policy; any forced outcome is named non-graceful and cannot later double-dispose or mutate. | Injected reject/hang/deadline tests and bounded diagnostic assertions. | both | Block until the policy and safe API boundary are explicit; no silent timeout or swallowed failure. |
| VC-005 | P0 | server/runtime ownership | RPC generation, HMR, programmatic close, and terminal close join wrapper teardown without weakening S6 network ownership, absolute deadline, signal, or restart contracts. | Gateway/server/launcher lifecycle tests and same-process restart evidence. | scrutiny | Block on unjoined promise, serial hidden grace, process-handler duplication, hang outside approved policy, or restart leak. |
| VC-006 | P0 | user operations | Contextual web Fork retains child/result semantics and an accurate lifecycle reason; Clone, Hide/Restore, Stop, navigation, and browser disconnect retain current ownership behavior. | Focused Fork/Clone/Hide/Stop regressions. | both | Block on source destruction by Clone/Hide/disconnect, lost child, or misleading lifecycle event. |
| VC-007 | P1 | stale-context regression | A timer cleaned only by shutdown cannot produce the demonstrated host-caused repeated stale-context exception after wrapper release. | Isolated fixture reproduction with uncaught-error capture; installed-package reproduction may supplement only. | both | Block on any repeated stale exception caused by skipped host lifecycle notification. |
| VC-008 | P1 | privacy/debuggability | Teardown exposes one bounded cause/outcome sequence without session content, raw identifiers/paths, secrets, payloads, or attacker-controlled error text. | Diagnostic capture tests and static field review. | scrutiny | Sensitive, unbounded, or duplicate output blocks. |
| VC-009 | P1 | repository validation | Focused and relevant full tests, typecheck, lint, package checks when applicable, and `git diff --check` pass with unrelated dirt preserved. | Recorded commands, scoped diff, and independent review. | scrutiny | Any skipped layer must be explicitly blocked, waived, or not applicable with rationale. |

## Assumptions, Risks, and Blockers

- **Blocker:** timeout/force policy must be chosen before final architecture and acceptance can be frozen.
- **Risk:** strict SDK runtime disposal can wait forever on a defective shutdown handler.
- **Risk:** a naive timeout around `AgentSessionRuntime.dispose()` can permit late double disposal because the pending runtime method remains uncancelled.
- **Risk:** making wrapper teardown asynchronous without joining the gateway/server owner reproduces the race at process/HMR boundaries.
- **Risk:** contextual web Fork is not SDK runtime replacement; reporting `fork` without matching expected metadata/hooks may mislead extensions, while reporting `quit` loses useful cause fidelity.
- **Risk:** unpublished or never-bound owners may have no valid extension lifecycle to shut down; indiscriminate event emission can invent events extensions never started.
- **Risk:** current source has accumulated extensive S6 generation/running/continuation safeguards. A historical shutdown patch from another branch is reference evidence only and must not be applied blindly.
- **Risk:** changing the pinned sibling Pi fork would trigger reproducible-artifact, package identity, and dependency integration work well beyond a local wrapper edit.

## Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Published wrapper | Pi Web runtime owner | Process-global RPC registry | A live session made available to browser/API commands and server ownership. | From registry publication until joined teardown completes. |
| Extension context | Pi SDK session API | Extension handlers and commands | Gives extensions session/UI/model/cwd-bound operations. | Valid until its owning extension runtime is invalidated. |
| Graceful shutdown | Extension lifecycle | `session_shutdown` before disposal | Lets extensions stop timers/watchers and finish cleanup before stale guards activate. | One attempt per published extension runtime. |
| Native disposal | Pi SDK cleanup | `AgentSession.dispose()` | Aborts native work, invalidates extension APIs, disconnects, and releases session resources. | Final, exact-once wrapper cleanup. |
| Host cause | Pi Web diagnostic | Idle/Fork/generation/server/setup | Records why Pi Web initiated teardown. | Fixed by the first teardown caller. |
| Lifecycle reason | Pi SDK event | `session_shutdown.reason` | Tells extensions the semantic session transition such as `quit` or `fork`. | One finite value per shutdown event. |

## Implementation Handoff

No implementation is authorized or recommended from this superseded plan. Do not run `/start-implementation` for this file. If the problem recurs or broader lifecycle parity becomes a product requirement, begin a new explicit planning cycle against the then-current repository and SDK rather than reusing this stale draft.
