# Pi Web-Hosted Implementation Sessions

Status: approved

## Objective

Let Start Implementation and Orchestrate Implementation launch a fresh native Pi `AgentSession` inside the existing Pi Web server process instead of an unreachable detached `--print` owner when the command originates in Pi Web.

Success means:

- the source session returns after target ownership registration and kickoff scheduling, without awaiting extension binding, prompt preflight, target settlement, or process exit;
- the source session owns no target promise, abort signal, process, or control channel after launch acknowledgement;
- Pi Web registers exactly one live target owner before the target kickoff begins;
- the target appears through ordinary session discovery and can be selected, observed, steered, followed up, and stopped through existing Pi Web controls while it runs;
- source Stop or later source messages do not steer, abort, or otherwise control the target;
- a full Pi Web process exit ends live ownership, while the native JSONL remains ordinarily resumable;
- standalone TUI launches retain the current detached-print behavior and are never cross-controlled by Pi Web.

## Design / Implementation Strategy

### 1. Use a narrow same-process host capability

Pi Web will publish one versioned, process-local capability. Its request is exactly the already materialized target session ID, absolute JSONL path, exact target cwd, kickoff text, a `start`/`orchestrate` diagnostic discriminator, and the source `AbortSignal`. It must not accept the launch profile's `targetEnvironment` or any arbitrary environment override. Start detects this capability rather than assuming that every `ctx.mode === "rpc"` host is Pi Web.

Keep the capability structural and narrow. It must not expose Pi Web internals, parse plans, create worktrees, interpret milestones, monitor workflow completion, or become a network API. A stable `Symbol.for(...)` registry key with an explicit version and owner identity matches the existing process-global hot-reload pattern and avoids a new daemon, socket, child-RPC client, or upstream Pi SDK change.

Capability absence permits detached-print fallback. A present but incompatible, foreign-owned, invalidated, or failed capability is a bounded rejection with no fallback. Re-registration may replace only a compatible record owned by the same Pi Web runtime; shutdown invalidates that record before cleanup so stale callbacks cannot accept a launch. Hot reload must not overwrite a foreign record or create a second target owner.

### 2. Preserve Start's preparation and fallback boundaries

Start and Orchestrate continue to own plan validation, Git/worktree selection, fresh `SessionManager` identity, native session name and lineage, JSONL materialization, kickoff wording, bounded failure reporting, and the existing process-wide launch-preparation guard. That guard serializes only the bounded preparation/registration window across Start and Orchestrate; it is released immediately after hosted registration or detached spawn and never lasts for the target turn. Update its notification so it does not falsely claim the collision is necessarily in the same source session.

After materialization, the launcher chooses exactly one path:

1. **Pi Web host capability present and compatible:** ask Pi Web to register and start the target.
2. **Capability absent:** preserve the current detached `pi --print --session ...` launch, including TUI behavior and its launched-only semantics.
3. **Capability present but rejects/fails:** preserve the target and report a bounded launch failure; never fall back automatically to print because that could duplicate an ambiguously accepted kickoff.

Do not restore the deleted source-owned `TargetRpcRunner`, `pi --mode rpc`, `RpcClient`, retained stdio, `agent_settled` wait, child-exit wait, or source-to-target cancellation coupling.

### 3. Register the native target before dispatch

The Pi Web capability reuses the existing per-session startup lock and registry in `lib/rpc-manager.ts` to open the exact materialized JSONL and create a native Pi `AgentSession` with the exact target cwd. Registration, event subscription, extension binding initiation, session-path caching, and ownership publication happen before kickoff dispatch.

After registration, the capability invokes the wrapper's existing fire-and-forget prompt path, retains background rejection handling in the host, and returns without awaiting that promise. In particular, it does not wait for extension binding, prompt preflight, model/tool completion, `agent_settled`, or session exit. Registration failure blocks the source launch; any error after ownership registration and kickoff scheduling belongs to the target session and bounded host diagnostics and never triggers print fallback or retroactive source failure.

The host receives the source `AbortSignal` and remains responsible for the entire registration attempt; the caller must not race and abandon the host promise. The host checks cancellation immediately before synchronous registry publication, cleans up an unpublished native session when cancelled, and never schedules the kickoff. Registry publication is the transfer boundary: because no asynchronous gap follows the final check, publication is atomic with respect to cancellation; after publication the host detaches from the source signal, and only commands addressed to the target may steer, follow up, or abort it.

### 4. Reuse existing Pi Web control surfaces

After registration, existing routes and hooks remain authoritative:

- the per-session API routes reuse the registered wrapper instead of cold-opening the JSONL;
- existing SSE carries target events and running state;
- existing prompt, steer, follow-up, and Stop commands address the selected target wrapper;
- the ordinary session-list cache is invalidated and the browser is prompted to refresh discovery so the newly materialized target row appears without selecting it or changing the source URL.

Do not add a Start-specific browser panel, workflow dashboard, storage schema, target API, polling protocol, PID record, or synthetic session type.

### 5. Make live ownership safe for long runs

The registry must never evict or forget a wrapper while its native session is running, compacting, or still owns an accepted prompt. Idle cleanup may resume only after the target becomes idle. Startup and lookup must continue to share one promise so selecting the target during launch cannot create a second `AgentSession` against the same JSONL.

Bounded server diagnostics should identify only target session ID, launch path, lifecycle stage, and sanitized error class/message. They must not log plan contents, kickoff text, conversation text, environment contents, credentials, provider payloads, or tool payloads.

### 6. Use a global runtime ceiling of two with a stricter prompt policy

Set the tracked Pi Subagents maximum depth to two for every host, including Pi Web and TUI. Do not add session-specific settings or modify Pi Subagents package source.

The tracked global `AGENTS.md` supplies the stricter ordinary-session policy:

- an ordinary root session, including Start, may launch only fresh read-only investigation, research, or review support at depth one;
- those depth-one support sessions must not launch another subagent;
- ordinary sessions must not delegate implementation-source writing;
- the sole depth-two exception is an Orchestrate session governed by the orchestrator workflow embedded in an explicitly finalized orchestration master;
- that root launches its designated implementation subagent at depth one, the implementation subagent may launch fresh read-only support at depth two, and depth-two support must not delegate further.

Keep the Orchestrate profile's explicit depth-two target environment for detached-print compatibility, even though the tracked global ceiling also becomes two. A Pi Web-hosted Orchestrate target relies on the global ceiling plus the embedded orchestrator workflow; a Pi Web-hosted Start target relies on the global ceiling plus `AGENTS.md`'s ordinary one-level rule.

This is intentionally prompt/policy enforcement rather than capability isolation. The runtime technically permits any root session to reach depth two, and the plan must not claim otherwise.

### 7. Deliver the two-repository change without coupling deployment order

The Pi Web capability and the Start/Orchestrate capability client must be independently safe to land. If Pi Web lands first, no extension calls the dormant capability yet. If `dot_files` lands first, capability absence preserves detached print. Therefore no intermediate revision may require both repositories to change atomically.

Implementation starts in the Pi Web task worktree created from this plan. Before any `dot_files` write, capture its main commit/status and create one registered non-main companion worktree from that commit; the same implementation session remains the sole writer across both checkouts. Produce separate scoped commits and repository-specific validation evidence, while the Pi Web checkpoint records both commits and both integration dispositions.

Before either local-main write, capture that repository's task branch/commit and main state, verify no overlapping main dirt or Git operation, and use its main-branch mutex when present. Pi Web currently lacks the helper: close out there only after proving and recording a no-race exception; if a race cannot be excluded, stop rather than adding an unplanned lock implementation. Integrate each repository independently; if either closeout is unsafe or blocked, preserve both task branches/worktrees and record exact partial state and safe retry points rather than forcing the other integration.

### Scope estimate

- **Surfaces:** Pi Web runtime registry/launch bridge/session refresh and tests; `dot_files` Start/Orchestrate launch abstraction, tracked Pi Subagents configuration, global `AGENTS.md`, orchestrator/milestone prompt contracts, maintained documentation, and tests. Pi Subagents package source is excluded.
- **Testability:** high for launch selection, source non-blocking behavior, single registration, event/control routing, failure ambiguity, TUI fallback, global depth configuration, and exact prompt topology through deterministic tests; browser interaction remains a focused manual runtime pass. Model compliance with prompt-only restrictions is reviewable but not mechanically provable.
- **Implementation complexity:** small-to-medium across the Pi Web and `dot_files` repositories. The global ceiling plus prompt policy avoids a third repository and session-scoped runtime mechanism.

## Reference Files

- [`lib/rpc-manager.ts`](../../lib/rpc-manager.ts) — native `AgentSession` wrapper, prompt dispatch, running accounting, startup lock, and process-global registry.
- [`lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs) — focused runtime-manager regression surface.
- [`app/api/agent/[id]/route.ts`](../../app/api/agent/[id]/route.ts) — existing target command routing.
- [`app/api/agent/[id]/events/route.ts`](../../app/api/agent/[id]/events/route.ts) — existing per-target event stream.
- [`app/api/agent/running/events/route.ts`](../../app/api/agent/running/events/route.ts) — existing running-session publication.
- [`components/SessionSidebar.tsx`](../../components/SessionSidebar.tsx) — ordinary session refresh and running-state consumption.
- [`Start transaction`](../../../dot_files/ai/.pi/agent/extensions/start-implementation/transaction.ts) — target preparation and launch boundary.
- [`Detached print launcher`](../../../dot_files/ai/.pi/agent/extensions/start-implementation/print.ts) — current TUI-compatible fallback and lost-control boundary.
- [`Shared launcher extension`](../../../dot_files/ai/.pi/agent/extensions/start-implementation/launcher-extension.ts) — source command/input await boundary and result messaging.
- [`Orchestrate launch profile`](../../../dot_files/ai/.pi/agent/extensions/orchestrate-implementation/profile.ts) — explicit depth-two process environment retained for detached-print compatibility.
- [`Pi Subagents configuration`](../../../dot_files/ai/.pi/agent/extensions/subagent/config.json) — global runtime maximum depth.
- [`Global Pi policy`](../../../dot_files/ai/.pi/agent/AGENTS.md) — ordinary one-level delegation rule and the explicit Orchestrate exception.
- [`Orchestrator workflow`](../../../dot_files/ai/.pi/agent/skills/orchestrator/SKILL.md) — depth-one implementation-agent and depth-two read-only support topology embedded into finalized masters.
- [`Milestone implementer`](../../../dot_files/ai/.pi/agent/agents/milestone-implementer.md) — implementation writer's permitted read-only support boundary.
- [`Start extension contract`](../../../dot_files/ai/.pi/agent/extensions/start-implementation/README.md) — maintained launched-only and no-control behavior that changes only for compatible Pi Web hosting.

## Constraints and Scope

### Fixed constraints

- The source session must remain usable after bounded launch acknowledgement; it must not await the target turn.
- Pi Web and standalone TUI never cross-control one another's live sessions.
- Exactly one live `AgentSession` may mutate a target JSONL at a time.
- Use Pi's native SDK `AgentSession` and native JSONL; do not invent a Pi Web session model.
- Pi Web remains a generic visibility/control host and must not become a Start/Orchestrate workflow manager.
- Preserve current plan/worktree/session identity, lineage, naming, kickoff, failure-preservation, and no-automatic-retry contracts unless this plan explicitly changes them.
- Preserve unrelated dirty and untracked state in both repositories.
- Never run `next build`; use focused tests, typecheck, lint, and a development-runtime browser pass.
- Broad worker-prompt review, runtime launch-role policy, child capability ceilings, and mechanical writer-topology enforcement remain excluded for later user review. This plan updates only the governing `AGENTS.md`, orchestrator workflow, and designated milestone-implementer wording/tests needed to state the user-approved prompt topology.

### In scope

- A same-process, capability-detected Pi Web target host.
- Start/Orchestrate launcher abstraction and result messaging that distinguish hosted from detached launches.
- Atomic registry ownership, target kickoff dispatch, running-safe idle cleanup, session-list refresh, and existing control-path reuse.
- A tracked global runtime maximum depth of two plus a documented ordinary-session prompt-policy maximum of one level and the explicit Orchestrate depth-two exception.
- Focused automated and manual validation across Pi Web and the Start/Orchestrate extensions.

### Non-goals

- TUI-to-Pi-Web handoff or cross-process attachment.
- A reconnectable RPC daemon, child-process broker, socket, HTTP adoption endpoint, PID registry, lease database, or restart recovery.
- Surviving a full Pi Web process restart with an in-flight model/tool operation.
- Broad Pi Web extension-runtime parity, project-trust redesign, UI redesign, transport migration, or `AgentSessionRuntime` adoption.
- Clone, fork, edit-from-here, session deletion, or ancestry behavior changes.
- Pi Subagents package changes, session-scoped depth enforcement, broad worker-role prompt review, or runtime subagent authorization-policy changes.

## Decisions and Evidence

### User-authorized decisions

- Only Pi Web-originated Start/Orchestrate launches need live Pi Web control; standalone TUI sessions remain separate.
- “Detached” means detached from the source caller, not ownerless: the source fires and forgets while the Pi Web process owns an independent target `AgentSession`.
- The user must be able to select the newly created target in Pi Web and interact with it while implementation is active.
- Avoid a medium-to-large Pi Web control plane; reuse native Pi and existing Pi Web session plumbing.
- Do not blindly restore the former RPC implementation.
- Avoid modifying Pi Subagents package source for this ownership repair; use a global runtime ceiling of two and an explicit `AGENTS.md`/orchestrator prompt-policy distinction.

### Established facts

- Commit `506e546` replaced target RPC supervision with detached print mode because the former source path awaited `rpcRunner.run()`, and that runner explicitly awaited prompt acceptance, `agent_settled`, stdin closure, and process exit.
- Native Pi RPC itself starts `session.prompt()` without awaiting the turn and acknowledges prompt preflight separately; the historical blocking was an explicit source-owned lifecycle contract, not an unavoidable property of prompt dispatch.
- Current print mode satisfies caller independence by discarding all stdio and process ownership after OS spawn, which makes live steering, follow-up, abort, and authoritative running state unavailable.
- Pi Web already creates native Pi `AgentSession` objects in process, caches one wrapper per session ID, routes target commands, publishes events/running state, and invokes prompt fire-and-forget.
- A JSONL file persists session history but is not an attachable live-control endpoint.
- Current Orchestrate relies on a detached child-process `PI_SUBAGENT_MAX_DEPTH=2` override; Pi Subagents also supports a tracked global `maxSubagentDepth`, currently one, which can be raised to two without package-source changes.

## Test Strategy

### Start and Orchestrate extension tests

- Compatible host capability is selected only when present, valid, version-compatible, and running in the direct root Pi Web context.
- Absent capability preserves exact detached-print behavior for TUI and other hosts; present incompatible, foreign, or invalidated records reject without fallback.
- A host rejection before registration never falls back to print; an error after registration remains target-owned and never retries or retroactively fails the source launch.
- Target identity, cwd, session file, kickoff, discriminator, and source signal are passed exactly once; `targetEnvironment` and arbitrary environment values are not passed to or applied by the hosted path.
- The process-wide preparation guard blocks a second simultaneous launch only until registration/spawn, reports its actual scope, and is released while the first target remains active.
- Hosted result text permits active target selection and identifies Pi Web as owner; detached result text preserves the current no-active-control warning.
- Source cancellation works before ownership acceptance and cannot abort the target afterward.
- A delayed target proves the Start/Orchestrate command handler returns without awaiting settlement.

### Pi Web runtime tests

- Host launch and an overlapping target selection share one startup promise and construct one native session.
- Cancellation before publication leaves no registered wrapper and schedules no kickoff; cancellation immediately after publication cannot cancel or de-register the target.
- Registration precedes kickoff scheduling, and the host launch returns while extension binding and the target turn remain deliberately unresolved.
- Compatible hot reload replaces only the same owner's capability; incompatible/foreign records are preserved, invalidated callbacks reject, and reload never creates a second target owner.
- The source accepts and completes a second prompt while the target remains active.
- Target steer, follow-up, and abort reach the same target `AgentSession`; source Stop does not.
- Active wrappers survive idle deadlines; idle wrappers still clean up normally.
- Target completion/error updates running state and leaves the native session safely resumable.
- Newly materialized hosted targets trigger ordinary session discovery without source selection or URL changes.

### Repository checks and runtime pass

- Pi Web: focused Node tests, full relevant `node --test components/*.test.mjs lib/*.test.mjs`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`.
- Dotfiles: focused Start/Orchestrate contract tests, TypeScript/static checks used by that repository, and `git diff --check`.
- Pi Web development runtime: launch a delayed deterministic target from a source session, immediately send a second source message, select the target, send steering and follow-up information, stop the target, and verify source/target state and sidebar running transitions. Do not use `next build`.

## Telemetry / Debuggability

Add only bounded server-side diagnostics for host capability registration, target ownership acceptance, kickoff dispatch, target settlement/error, and owner cleanup. Each signal should correlate by target session ID and stage; expected user errors should remain bounded UI notifications. Tests must verify that diagnostics omit kickoff/plan/conversation contents, environments, credentials, provider data, and tool payloads.

No durable telemetry store, analytics event, network reporting, or high-cardinality payload logging is authorized.

## Validation Contract

| ID | Priority | Type / surface | Required truth | Required evidence | Validator mode | Blocker / waiver path |
|---|---|---|---|---|---|---|
| VC-001 | P0 | Source independence | Start/Orchestrate returns after ownership registration and kickoff scheduling, and the source accepts another prompt while target extension binding or execution remains active. | Deferred-binding/deferred-target automated tests plus development-runtime source interaction. | both | No waiver; block on any preflight/settlement/process-exit wait or source-owned target promise. |
| VC-002 | P0 | Single ownership / host lifecycle | Exactly one registered native `AgentSession` owns the target JSONL across launch, selection, SSE, commands, and compatible hot reload; foreign/incompatible records are not overwritten and invalidated callbacks cannot accept work. | Startup/selection race tests, capability replacement/invalidation tests, registry assertions, and runtime trace. | both | No waiver; block on any second open, stale acceptance, foreign overwrite, or ambiguous fallback. |
| VC-003 | P0 | Target control | Existing target selection, steer, follow-up, and Stop address the registered target owner while source controls remain isolated. | Command-routing tests and development-runtime interaction. | both | No waiver; block if source can abort target or target commands cold-open another owner. |
| VC-004 | P0 | Depth contract | All Pi hosts expose a runtime maximum of two; maintained policy limits ordinary roots to one read-only support level and reserves the second level for the implementation-agent support topology embedded in an explicitly finalized Orchestrate master, without claiming mechanical enforcement. | Global configuration test, exact `AGENTS.md`/orchestrator/milestone contract tests, ordinary Start behavior review, and hosted Orchestrate nested-depth runtime evidence. | both | No waiver for missing topology wording, depth-three reachability, or misleading enforcement claims. |
| VC-005 | P0 | Cancellation / failure ambiguity | Cancellation or failure before ownership publication leaves no registered owner or kickoff and never races away from an unfinished host attempt; failure after publication remains target-owned and never retries or retroactively fails the source launch. | Before/after-publication cancellation races plus failure injection at capability lookup, registration, and kickoff-scheduling boundaries. | scrutiny | No waiver; ambiguous duplicate execution or an orphaned unpublished session blocks. |
| VC-006 | P1 | Discovery/lifecycle | The hosted target appears through ordinary discovery, reports running state, survives active idle windows, settles visibly, and remains natively resumable. | Cache/refresh and idle tests plus runtime sidebar/session evidence. | both | Any omitted browser evidence must be explicitly blocked with reason and replaced by closest route/runtime evidence. |
| VC-007 | P1 | TUI compatibility | Capability absence retains current detached-print argv, environment, spawn, and launched-only warning. | Existing and extended Start launcher regression tests. | scrutiny | No waiver for unintentional TUI behavior change. |
| VC-008 | P1 | Privacy/debuggability | Diagnostics identify ownership stage and bounded error without private or secret-bearing payloads. | Static review and captured failure-path logs. | scrutiny | Block on sensitive, unbounded, or raw payload output. |
| VC-009 | P1 | Repository quality | Both repository diffs are scoped and all relevant focused/full tests, typecheck, lint, and diff checks pass without `next build`. | Recorded command output and independent review. | scrutiny | A skipped layer must be marked blocked, waived, or not applicable with rationale. |
| VC-010 | P0 | Two-repository delivery | Each repository has a captured base, registered task checkout, scoped commit, validation evidence, safe main-write preflight, and explicit integration or recovery disposition; unrelated dirt remains untouched. | Git/worktree/status evidence, Pi Web checkpoint final summary naming both commits, per-repository mutex/no-race proof, and closeout or recovery evidence. | scrutiny | Stop before an unsafe main write; preserve both task checkouts and record partial state/safe retry rather than forcing integration. |

## Assumptions, Risks, and Blockers

- **Assumption:** Pi Web process lifetime is an acceptable live-owner boundary; restart continuation is excluded.
- **Risk:** a versioned process-global capability is intentionally local coupling between two repositories. Strict version/owner checks, absent-only fallback, and tests must keep the coupling bounded.
- **Risk:** Next.js hot reload can leave stale global state; same-owner replacement, foreign-record preservation, invalidation, and cleanup need direct regression coverage.
- **Risk:** the existing ten-minute wrapper idle timer can forget a quiet but active long-running operation unless changed to respect running ownership.
- **Risk:** cross-repository implementation and closeout must preserve unrelated state and keep one writer; compatibility fallback allows the two commits to land independently without an all-or-nothing deployment. A blocked integration must retain both task checkouts with exact commit/status evidence.
- **Risk:** a global runtime ceiling of two does not enforce the ordinary-session policy ceiling of one. Correctness depends on maintained instructions and the orchestrator-master gate until a separately approved runtime policy exists.
- **Risk:** increasing the tracked global ceiling changes latent capability in TUI as well as Pi Web; tests and documentation must state that intentionally rather than describing it as Pi-Web-only.
- **Established exclusion:** no Pi Subagents package or session-scoped depth mechanism belongs to this plan.

## Implementation Handoff

Approved plan path:

```text
.agents/plans/2026-07-28-pi-web-hosted-implementation-sessions.md
```

Start implementation with:

```text
/start-implementation .agents/plans/2026-07-28-pi-web-hosted-implementation-sessions.md
```

Approval and this planning commit do not begin implementation.
