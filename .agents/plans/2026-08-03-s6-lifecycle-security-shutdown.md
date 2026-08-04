# S6: Lifecycle, Security, and Owned Shutdown

Status: approved

## Objective

Complete only the S6 lifecycle/security/shutdown outcome authorized by the approved [Pi Web persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md), starting from accepted S5 implementation commit `e82e9bdc6c020d0663eec12515bf41c3aa5d6ad8` and final checkpoint commit `c7f4a4c3bf488c6ef6ad5da2caebc96cdc1c8174`.

Harden the already migrated `running`, `session`, and `file-watch` transports without changing their product protocols or browser ownership. Change wrapper semantic idle from ten to 30 minutes, define exactly which commands and events touch that deadline, protect every already modeled active run/compaction/causal-settlement state, and ensure transport heartbeat never extends wrapper lifetime. Add one server-level WebSocket ping/pong owner for every Pi Web channel. Join every channel subscriber, file watcher, wrapper, ticket, timer, accepted Pi WebSocket, and tracked HTTP connection to the custom server's explicit lifecycle; remove `rpc-manager`'s competing process signal cleanup; permit a ten-second natural drain only for proven Pi-Web-owned resources; then force only residual Pi-owned sockets/connections and continue through public Next cleanup.

Preserve the accepted same-port direct-HTTP/LAN model, direct-peer 64/256 admission, one-use ticket metadata binding, S2/S3 sequence/replay/output bounds, exact-once native disposal, browser-independent server ownership, HMR coexistence, terminal-only signal/exit policy, process-scoped Next development, and reusable same-process production. S6 does not redesign a browser client, migrate OAuth, change event/application frames, change file observation semantics, run the S7 combined 30-socket scale/capability matrix, update maintained product documentation, obtain user acceptance, or inspect private Next state.

Success means:

- a wrapper expires only after 30 uninterrupted minutes without an accepted semantic command or domain event and only when no modeled active work/fanout/finality state remains;
- every recognized HTTP command attempt and every native or wrapper-originated legacy or projected domain event touches semantic idle, while unsupported commands, ticket/socket/resume/replay traffic, subscriptions, file changes, diagnostics, shutdown work, ping, and pong do not;
- active prompt, compaction, native causal, reserved-terminal, projected-active, and fanout settlement states cannot expire; settlement starts a fresh complete idle window;
- one custom-server heartbeat covers all accepted Pi Web WebSockets, gives each ping one complete 30-second response window, terminates a missed peer retryably, releases admission exactly once, and owns/cancels its sole timer;
- existing 4 MiB-or-8,192-unit session replay and 4 MiB per-session-subscriber output bounds remain exact; each global-status subscriber gains the same 4 MiB encoded queued/in-flight output bound; slow consumers remain isolated; fixed/coalesced file-watch output remains separately bounded rather than being redefined as session replay;
- every global/session/file channel registration has an explicit idempotent owner close, and wrapper registry cleanup is explicitly joined to the serving custom-server generation rather than process signals;
- shutdown stops new requests/upgrades/tickets/publications, starts actual-owner cleanup, allows at most 10,000 ms for owned sockets and HTTP connections to drain naturally, then terminates/destroys only residual resources proven to belong to that Pi Web server;
- wrapper/native disposal, watcher closure, subscriber release, admission release, ticket/timer removal, owner cleanup, and global uninstallation occur exactly once across close, failure, HMR replacement, heartbeat termination, and repeated close;
- imported server/runtime modules install no signal handler and never exit; the executed launcher remains the sole first-signal owner; production can start/close/restart on one port in one process, while real development exits only at the terminal boundary after awaited Pi-owned/public cleanup.

## Design / Implementation Strategy

### 0. Freeze accepted lineage and S6 scope

S1-S5 are accepted and immutable. Reuse the existing V1 gateway, static channels, ticket contexts, wrapper projector/hub, registry/client ownership, file watcher, and custom-server/launcher. Do not alter application frame schemas, ticket request bodies, browser providers/hooks, HTTP command authority, sidebar/chat/file behavior, admission limits, ticket TTL, inbound payload limit, or fixed S2/S3 replay/output constants except to correct a proven bounded defect that blocks this exact milestone.

The current runtime has six S6 gaps:

1. `RPC_SESSION_IDLE_TIMEOUT_MS` is ten minutes; `send()` touches before rejecting an unsupported command; wrapper-originated direct projected inputs bypass a common semantic touch seam; and `isRunning()` omits already tracked native causal/reserved/fanout state.
2. binding-dependent commands and extension-binding completion can continue after wrapper destruction unless liveness/generation is rechecked after their awaits.
3. `rpc-manager` installs independent `exit`, `SIGINT`, and `SIGTERM` cleanup handlers instead of being owned by the custom server; cached-module restart and shared-start locks are not server-generation-scoped.
4. channel registration removal does not uniformly close all live global/session/file resources, including the accepted-before-deferred-handler race; the current server relies on immediate socket termination and does not explicitly join wrappers.
5. global running/discovery sends have no bounded encoder, queue/in-flight byte budget, or slow-subscriber isolation.
6. `startPiWebServer().close()` immediately terminates/destroys sockets/connections and has neither heartbeat nor a ten-second owned-resource grace.

No advisory reference-pointer companion exists for the master. Historical M0 copied-production evidence remains lifecycle-only; it cannot prove fresh inclusion of current routes.

### 1. Define 30-minute semantic idle and exact active protection

Set the default wrapper idle duration to exactly `30 * 60 * 1000` ms. Preserve constructor injection for deterministic tests. Centralize idle touches behind one private operation that may emit only a finite touch category and resets one wrapper-owned timer.

A **semantic touch** is one of:

- wrapper startup/publication;
- a recognized `AgentSessionWrapper.send()` command type accepted for dispatch, before its asynchronous work begins, even if its state/precondition later rejects;
- every event delivered by the native `inner.subscribe()` stream, before projection/fanout;
- every wrapper-originated public domain input, whether it reaches legacy fanout through `emit()` or is accepted directly into the projected hub. Direct projected inputs are exactly `wrapper_activity_started`, `wrapper_settled`, `extension_dialog_closed`, `extension_status_cleared`, and `extension_widget_cleared`; they use the finite `wrapper_event` or `settlement` touch category;
- prompt, compaction, and hosted-kickoff claim, settlement, failure, or cancellation when not already represented by one of the event seams.

A recognized command touch and a later resulting domain-event touch are separate semantic events; deduplication is neither required nor permitted across those two causes. All wrapper-originated hub acceptance must pass one guarded helper so direct projection cannot bypass the touch rule.

The recognized command set is exactly the existing `send()` switch: `prompt`, `abort`, `get_state`, `set_model`, `clone`, `fork`, `navigate_tree`, `set_thinking_level`, `compact`, `set_session_name`, `get_session_stats`, `get_last_assistant_text`, `set_auto_compaction`, `clear_queue`, `steer`, `follow_up`, `get_tools`, `get_commands`, `set_tools`, `reload`, `abort_compaction`, `extension_ui_response`, `extension_ui_input`, and `set_auto_retry`. An unsupported command type is rejected without touching idle. Malformed fields under a recognized type remain a recognized dispatch attempt and touch before the existing command-specific validation; S6 does not add a second command schema.

The following are explicitly passive and never touch a wrapper:

- session ticket issue/consume, socket open/close/error, resume/ready, replay/snapshot, subscriber attach/detach, reconnect, and `bufferedAmount` work;
- global running/discovery subscriptions and file-watch ticket/socket/watcher/change traffic;
- ping, pong, heartbeat failure/termination, admission release, idle recheck, diagnostics, and shutdown cleanup;
- registry lookup alone, transcript/context/file HTTP reads, and other operations that never dispatch a wrapper command.

At an idle deadline, defer disposal and rearm a complete 30-minute window whenever any accepted active state is present: prompt or wrapper compaction claims; native agent-turn or standalone-compaction causal claims; reserved native/compaction terminals; native `isStreaming`/`isCompacting`; projected active state awaiting exact settlement; nonzero event-fanout depth or deferred settlement. Hosted kickoff is already represented by a prompt claim and must remain so. Passive subscribers, retained browser views, queued transport output, and extension UI display state do not own the wrapper.

Every final claim release/native settlement resets the timer so an operation that crossed one or more idle boundaries still receives a full 30 minutes after settlement. Wrapper destruction remains synchronous and idempotent, closes the projected hub before native disposal, calls native `dispose()` exactly once, notifies every destruction observer in isolation, clears the idle timer, and permits a later HTTP/ticket request to recreate the wrapper under existing shared startup locks.

### 2. Give gateway/channel/runtime resources explicit server-generation ownership

Extend the process gateway with one explicit structurally marked lifecycle capability while preserving gateway protocol version 1. Old V1 instances without the new marker are incompatible with S6 owner registration and fail closed until the custom server restarts; extra JavaScript arguments silently ignored by an old gateway are not accepted evidence.

The mandatory gateway contract has structural marker `ownerLifecycleVersion: 1`; an internal server helper is allowed only behind this gateway capability, not as an alternative process-global owner. The capability must:

- distinguish **begin shutdown** from final gateway close;
- atomically reject new channel registration, ticket issue/consume, admission reservation, owner activation, and runtime publication after shutdown begins;
- revoke pending tickets and cancel their timers;
- let each channel registration provide one idempotent semantic owner-close callback receiving exact finite reason `owner_replaced` or `server_shutdown`, and maintain a registration-owned set of every accepted socket;
- return from ticket consumption one server-only synchronous enlist operation. The upgrade callback must invoke enlist before any Promise/microtask handler dispatch; enlist fails if its registration/gateway generation is no longer current, installs exact socket release, and returns a generation token exposed to the handler only as a current-owner check;
- on unregister/HMR replacement, close every enlisted socket plus invoke the semantic owner exactly once with `owner_replaced`, retaining existing bounded channel fallback behavior;
- on begin shutdown, invoke the semantic owner exactly once with `server_shutdown`, release application resources immediately, cancel every channel-local close/terminate fallback, and request only a WebSocket close handshake for every enlisted socket. A socket already closing is left for the server coordinator; no channel or gateway `terminate()`/raw `destroy()` may run before the 10,000 ms coordinator boundary. This includes a socket accepted after ticket consumption but before deferred handler setup;
- register one separate finite `rpc` runtime owner bound to this gateway generation, with identity-checked replacement/removal;
- isolate callback failures, continue every remaining cleanup, and expose only bounded owner/count/outcome evidence;
- retain admission reservations until their accepted sockets close or final gateway close marks them released, so ordinary runtime and graceful-shutdown accounting remain exact;
- make final `close()` idempotently clear registrations, enlisted socket sets, owner callbacks, tickets/timers, reservations/peer counts, and the exact global slot.

Channel owners remain specific rather than becoming one application multiplexer:

- the `running` registration tracks every current socket cleanup and closes it while unsubscribing both global projections;
- the `session` registration closes and releases every subscriber, timer, catch-up/live/in-flight reference, and wrapper observer-owned registry entry without treating a browser disconnect as wrapper destruction;
- the `file-watch` registration retains its existing one-subscription/one-watcher cleanup and closes every watcher/timer/socket;
- `owner_replaced`, ordinary policy/error, and slow-consumer paths may retain their current bounded terminate fallback; `server_shutdown` must cancel/suppress those local fallbacks and leave all force to the server coordinator;
- owner-close paths are idempotent with ordinary socket close/error, HMR replacement, server shutdown, and the eventual coordinator force.

Replace `rpc-manager`'s process handlers with the mandatory gateway-generation `rpc` owner. Activation must (re)register the hosted implementation capability even when the module is cached from an earlier production server. It invalidates that capability on shutdown, prevents publication into a closing generation, destroys every current wrapper exactly once, and disposes a wrapper that finishes preparation after shutdown won. Shared start locks are generation-scoped records with identity-checked removal: a fresh generation never joins an old unresolved promise, and an old promise's finalizer cannot delete a replacement lock. Unit uses without a custom gateway remain explicit caller-owned tests and install no process handler.

Wrapper destruction also wins every not-yet-dispatched continuation. Extension binding captures the wrapper/server generation; after its awaited native bind it may set `extensionsBound`, apply prompt state, emit/log, or run callbacks only if the wrapper and generation remain current. Resolution/rejection after destruction is observed without unhandled rejection or stale mutation. Every binding-dependent `prompt`, `steer`, `follow_up`, `get_commands`, and `reload` path rechecks liveness/generation after the wait and before initiating native work or projection; `reload` also suppresses post-await mutation if shutdown wins while native reload is already dispatched. Pending command claims settle/reject exactly once. Arbitrary detached jobs spawned internally by third-party extensions and full `AgentSessionRuntime`/`session_shutdown` parity remain excluded.

### 3. Add one server-level ping/pong heartbeat

The custom server—not a channel, wrapper, browser registry, or App Router route—owns one heartbeat controller for `webSocketServer.clients`.

Freeze the default policy:

- one unrefed sweep interval every `30_000` ms;
- a new accepted Pi WebSocket starts alive;
- every public `pong` event marks only that transport alive;
- on each sweep, terminate a socket that remained not-alive for the complete preceding response window; otherwise mark it not-alive and send one WebSocket protocol ping;
- a ping throw/error or invalid socket state fails that socket closed without affecting peers;
- browser and `ws` protocol-level automatic pongs require no application frame or client change;
- socket close removes its state and releases gateway admission through the existing idempotent close owner;
- shutdown cancels the sole interval before channel/socket cleanup; repeated close cannot retain/recreate it.

A socket accepted just after a sweep may live for nearly 60 seconds before a first missed-pong termination; every sent ping still receives one full 30-second response window. This is the standard server-sweep behavior and is not an application timeout promise.

Heartbeat code must never call wrapper lookup, `send()`, idle touch, hub projection, running/discovery publication, or file observation. Heartbeat diagnostics use only a finite outcome/reason, finite `running`/`session`/`file_watch` channel class, and count class; never peer address, dynamic channel value, ticket, session ID, path, frame, or raw error.

### 4. Revalidate admission, replay, and output bounds across all channels

Keep direct accepted-socket `remoteAddress` as the sole admission authority and preserve exactly 64 concurrent Pi WebSockets per direct address and 256 total. A ticket remains consumed before admission; cap rejection never restores it. Reprove exact release and immediate re-admission after normal close, handler failure, malformed callback-less handshake, heartbeat termination, channel-owner close, graceful shutdown, and forced shutdown. Forwarded headers remain irrelevant.

Do not redesign accepted S2/S3 bounds:

- session replay retains at most 4 MiB encoded data or 8,192 retained units under the existing atomic group/snapshot rules;
- each session subscriber retains the existing 4 MiB encoded application-output limit across queued/in-flight accounting plus independent `bufferedAmount` rejection and retryable `1013` detachment;
- one stalled session subscriber never blocks the hub, wrapper, or a healthy subscriber;
- each running/discovery subscriber uses a single callback-driven text pump with an exact 4 MiB encoded queued-plus-in-flight bound, independent `bufferedAmount` rejection, bounded encoding that stops at one-over, ordered delivery without coalescing transition edges, retryable `1013` slow close, bounded terminate fallback, and exact reference release; one slow global peer never affects another;
- file-watch output remains bounded by its strict fixed frames, one in-flight send, one latest pending/coalesced change, and existing finite pressure threshold; it is not session replay and does not acquire an unrelated 4 MiB queue.

Use exact-boundary/one-over, stalled-versus-healthy, and reference-release tests against the final integrated owner/heartbeat paths. No raw SDK event, content, full snapshot fallback, unbounded `JSON.stringify`, or unbounded queue may be introduced.

### 5. Apply one ten-second grace only to proven Pi-Web-owned resources

Refactor `startPiWebServer().close()` into one idempotent coordinator with an injectable monotonic clock/timers and exactly one `10_000` ms owned-resource grace.

Shutdown order is:

1. atomically mark the server closing, null ordinary request dispatch, detach only the reserved Pi upgrade listener, and prevent new runtime publication;
2. cancel heartbeat;
3. begin gateway shutdown with reason `server_shutdown`, revoke tickets, and synchronously invoke the explicit running/session/file/RPC owners so subscribers, watchers, application timers, hubs, wrappers, and native sessions start exact cleanup while every channel-local terminate fallback is cancelled/suppressed;
4. request only a WebSocket close handshake on any accepted Pi WebSocket not yet reached by a channel owner; leave already-closing sockets untouched and reserve all `terminate()`/raw `destroy()` for step 7;
5. call public `webSocketServer.close()` and `httpServer.close()` without immediately terminating/destroying their clients/connections;
6. allow those proven Pi-owned WebSockets and tracked connections up to 10,000 ms total to close naturally;
7. if any remain at the deadline, `terminate()` only residual `webSocketServer.clients`, call public `closeAllConnections()` if available, and destroy only sockets in this server's tracked connection set; rerun only idempotent owner cleanup needed to converge;
8. finalize gateway close/uninstall and remove exact server listeners/state;
9. call and await only public `app.close()`; never apply the Pi-owned force policy to private Next/Watchpack state or the embedding process.

The grace is a drain window, not a ten-second delay: close returns immediately when owned resources settle. Through exactly `9_999` ms, neither gateway nor any channel may terminate/destroy a shutdown-owned socket; a natural close at that boundary is graceful. Residual ownership at `10_000` ms selects the coordinator's forced outcome and each residual owned network resource is forced at most once. With real Node APIs, terminate/destroy is expected to make the public WS/HTTP close callbacks converge. The coordinator races those callbacks against directly observed owned-resource settlement; after force proves zero residual enlisted/WSS/tracked-connection ownership, an injected callback that remains absent is recorded as a bounded stage failure and is no longer awaited. Callback/setup failures are collected while all later cleanup still runs. Public `app.close()` is separate, outside the Pi force/deadline set, and remains awaited under the accepted process-scoped development contract.

Return or diagnose only bounded `graceful`, `forced`, or `failed` outcome plus stage, duration class, and zero/one/many forced counts by proven resource class. Aggregate observable close failures after every cleanup stage. Programmatic close never exits. Repeated calls return the same promise/result.

### 6. Preserve terminal signals, production reuse, and process-scoped development

`bin/pi-web.js` remains the sole signal owner. It latches the first `SIGINT` or `SIGTERM`, ignores later signals while cleanup runs, awaits `server.close()`, and exits `130`/`143`; startup or cleanup failure exits `1`. Imported launcher/server/App Router/runtime/gateway modules install no signal handler and never call `process.exit()`.

Production must pass same-process start/close/restart/close on the same port with fresh gateway/channel/runtime ownership, zero stale wrappers/watchers/subscribers/tickets/timers/admission, and natural process drain. Current plain-JS behavior requires real-child/injected production tests. If the pre-existing pinned Next 16.2.11 production artifact remains available, copy/fingerprint it and run lifecycle-only evidence without mutation or route-freshness claims. If its release manifests are absent, only that named copied-artifact preflight may remain release-owned; current Pi-owned production-mode restart must still pass through injected/public seams and historical M0 real-production evidence remains lineage rather than fresh S6 execution.

Real Next development must preserve ordinary routes and HMR on nonreserved upgrades, release every Pi-owned resource through the new coordinator, invoke public `app.close()`, and then end only through the executed terminal process. Do not inspect arbitrary handles, Watchpack, or private Next methods.

### 7. Preserve later milestones and product boundaries

Do not change React/browser providers, registries, clients, hooks, routing, selected/hidden ownership, rendering, polling/reconciliation, command payloads, application WebSocket frames, session/file protocols, OAuth SSE, file authorization, symlink policy, port/TLS, dependencies, Pi monorepo source, or release artifacts.

S6 may run a small one-page Chromium and Firefox heartbeat/lifecycle smoke, but S7 retains the explicit 1/5/10-page and combined 10-page + 10-session + 10-file-viewer = 30-socket matrix, full capability/rich-visual checks, documentation/memory updates, responsiveness/user acceptance, full-master validation, and closeout. Do not run `next build`.

### Scope estimate

- **Expected production surfaces:** `bin/pi-web-server.js`; `bin/pi-web-transport-gateway.js`; typed gateway lifecycle access; `lib/rpc-manager.ts`; `lib/global-status-channel.ts`; `lib/session-channel.ts`; `lib/file-watch-channel.ts`; only narrowly necessary launcher integration. One small lifecycle/heartbeat helper is allowed if it clarifies ownership and remains server-specific.
- **Expected tests:** gateway/server/launcher, runtime idle, all three channels, session integration/bounds, real-Next/real-child lifecycle, adversarial Node `ws`, and small sanitized Chromium/Firefox heartbeat smoke.
- **Normally unchanged:** ticket body/context schemas, projected protocol/hub/reducer, browser clients/providers/hooks, FileViewer behavior, API command semantics beyond idle-touch timing, package dependencies, docs/memory/wiki.
- **Complexity:** large but cohesive; one compaction maximum. Highest risks are in-flight wrapper publication during shutdown, HMR owner replacement, exact 10-second race ordering, HTTP/WS callback convergence, and accidental heartbeat idle touches.
- **Stop condition:** any need for private Next cleanup, process-handle enumeration, a second server/port, mandatory TLS, browser ownership redesign, application heartbeat frames, weaker admission/backpressure, non-idempotent force, Pi SDK source changes, production build, S7 scale/user waiver, or inability to prevent post-shutdown wrapper publication is material divergence.

## Reference Files

Selected governing and implementation evidence:

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Accepted S5 plan](./2026-08-03-s5-persistent-file-watch-websocket.md) and [checkpoint](../checkpoints/2026-08-03-s5-persistent-file-watch-websocket-checkpoints.md)
- Accepted S5 implementation/finality `e82e9bdc6c020d0663eec12515bf41c3aa5d6ad8` / `c7f4a4c3bf488c6ef6ad5da2caebc96cdc1c8174`
- [Accepted S3 server transport plan](./2026-08-02-s3-secure-session-websocket.md) and [checkpoint](../checkpoints/2026-08-02-s3-secure-session-websocket-checkpoints.md)
- [M0 recovery checkpoint](../checkpoints/2026-07-29-m00-development-lifecycle-recovery-checkpoints.md)
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md) and [memory index](../memory/MEMORY.md)
- [Repository instructions](../../AGENTS.md)
- `bin/pi-web-server.js`, `bin/pi-web-transport-gateway.js`, `bin/pi-web.js`
- `lib/websocket-gateway.ts`, `app/api/transport/ticket/route.ts`
- `lib/rpc-manager.ts`, `lib/session-event-hub.ts`, `lib/session-protocol.ts`, `lib/session-transport-protocol.ts`
- `lib/global-status-channel.ts`, `lib/session-channel.ts`, `lib/file-watch-channel.ts`
- `lib/rpc-manager.test.mjs`, channel tests/integration, `lib/websocket-gateway.test.mjs`, `lib/pi-web-server.test.mjs`, `lib/pi-web-real-next.test.mjs`
- Installed public `ws` ping/pong/terminate/client-set APIs under `node_modules/ws`
- Recoverable S6 planning run `c017ddf8`, scout children 0 and 1

No advisory reference-pointer companion exists. The sibling Pi monorepo remains read-only and is not required.

## Constraints, Decisions, and Current State

### Fixed constraints

- One server/gateway heartbeat covers Pi WebSockets only; it is transport liveness, never product/session activity.
- Browser page/socket lifetime never owns a wrapper/run. Connected subscribers do not prevent semantic idle expiry.
- Ten seconds is the natural-drain grace for proven Pi-owned resources, not a timeout/force authority over Next internals or the embedding process.
- Direct peer addresses remain admission inputs but never diagnostics. Forwarded headers remain untrusted.
- Existing session replay/output constants and file-watch bounded-coalescing design remain authoritative.
- Use only public Node, `ws`, Next, and Pi Web seams. Native Pi `AgentSession.dispose()` remains the exact-once wrapper teardown; do not invent `AgentSessionRuntime` or full `session_shutdown` parity.
- Preserve `.pi-subagents/`, unrelated main dirt, and every accepted plan/checkpoint/commit. Never run `next build`.

### Frozen S6 decisions

- **Heartbeat:** one server-wide unrefed 30-second sweep; ping alive peers, terminate peers that fail the preceding full sweep window; automatic protocol pongs; no application frame.
- **Command touches:** every recognized current `send()` type touches on dispatch; unsupported types do not; malformed fields under a recognized type retain one touch.
- **Event touches:** every native event and every wrapper-originated legacy or direct projected domain input touches; passive transport/file/global traffic never does.
- **Active protection:** include all existing wrapper/native causal/reserved/fanout/projected active state plus native streaming/compacting, not passive subscribers or UI display retention.
- **Output:** session and global subscribers each use a 4 MiB encoded output bound; file-watch retains its separate fixed-frame one-send/one-latest-coalesced pressure policy.
- **Owner join:** require gateway `ownerLifecycleVersion: 1`, synchronous pre-dispatch socket enlistment, channel semantic owner callbacks, and one generation-scoped `rpc` owner; remove runtime process signal/exit cleanup.
- **Shutdown:** owner cleanup begins immediately with finite `server_shutdown`, cancels channel-local terminate fallbacks, and requests close handshakes only; accepted Pi sockets/tracked connections receive through 9,999 ms to drain naturally; only the server coordinator forces residual owned network resources at 10,000 ms; public Next cleanup follows without private force.
- **Production evidence:** current injected/real-child production-mode reuse is mandatory. A copied stale artifact, when available, remains lifecycle-only; missing release manifests cannot become a false fresh-inclusion claim.

### Current facts

- Gateway admission already enforces 64/direct-peer and 256 total before handler dispatch and releases idempotently.
- Session replay is already bounded by 4 MiB or 8,192 units and session-subscriber output is already 4 MiB; global output is not yet bounded; file-watch output is coalesced and pressure-limited.
- Wrapper destruction already guards native disposal once and isolates multiple destruction observers.
- Session subscribers close on wrapper destruction; file watchers close on their registration owner; global/session registration-wide server teardown is not uniform.
- Custom-server close currently terminates Pi sockets and destroys all tracked connections immediately, then closes gateway and public Next.
- `rpc-manager` currently installs its own process exit/SIGINT/SIGTERM handlers.
- Next 16.2.11 development public close remains process-scoped; production is intended to be same-process reusable.

## Test Strategy

### Semantic idle and wrapper lifecycle

Use injected fake clocks and hostile/reentrant wrapper fixtures to prove:

- exact `30m-1`, `30m`, repeated touch, and post-settlement full-window boundaries;
- every recognized command type touches exactly through the common rule, unsupported commands do not, and recognized failures do not create extra timers;
- native events, legacy wrapper events, and every direct projected wrapper input (`wrapper_activity_started`, `wrapper_settled`, `extension_dialog_closed`, `extension_status_cleared`, `extension_widget_cleared`) touch; ticket/socket/resume/replay/subscriber/file/global/heartbeat/diagnostic operations do not;
- prompt, compaction, native causal/reserved terminal, projected active, native streaming/compacting, fanout/deferred settlement, hosted kickoff, and overlapping claims survive every deadline and dispose only 30 minutes after final settlement;
- transparent recreation under generation-scoped shared locks, old-finalizer versus replacement-lock races, in-flight start losing shutdown, hosted capability reactivation after same-process restart, repeated shutdown, exact registry/cache/running cleanup, multiple destruction observers, and native dispose exactly once;
- extension-binding resolve/reject/callback after destroy/restart plus binding-dependent `prompt`, `steer`, `follow_up`, `get_commands`, and `reload` losing shutdown before native dispatch, with no stale mutation or unhandled rejection;
- an injectable wrapper clock/timer dependency (`now`, schedule, cancel, and observable unref where used) drives all deadline tests; no real sleeps stand in for 30-minute evidence;
- no `process.on/once` registration from imported runtime modules.

### Heartbeat, channels, admission, and bounds

Use fake WebSockets/clocks and real Node `ws` clients (including public `autoPong: false`) for:

- alive-on-accept, first ping, timely pong, pong just before the next sweep, missed-pong terminate, ping throw/error/close races, one interval, unref/cancel, and no semantic idle touch;
- running/session/file sockets under one heartbeat with synchronous pre-dispatch enlistment, unregister/shutdown between upgrade callback and deferred handler, finite owner-close reasons, HMR replacement, setup failure, socket close/error, and exact subscriber/watcher/timer/reference cleanup;
- resistant sockets under `server_shutdown` incur zero channel/gateway terminate or raw-destroy calls through 9,999 ms; natural close at 9,999 ms is graceful; only residual sockets at 10,000 ms are coordinator-forced exactly once. HMR/slow/policy fallbacks remain separately tested;
- mixed real/injected upgrade admission at 64/65 per direct peer and 256/257 total, consumed cap-rejected tickets, forwarded-header irrelevance, and capacity restoration after normal, malformed, handler, heartbeat, graceful, and forced terminal paths;
- exact 4 MiB/8,192 replay occupancy and eviction/recovery, exact 4 MiB session and global-subscriber output and one-over, bounded global encoding, stalled-versus-healthy independence, catch-up/live/global reference release, and retained bounded file behavior.

### Ten-second shutdown and server ownership

Use dependency-injected server/WSS/HTTP/gateway/Next fixtures and fake monotonic time to prove:

- stop-admission-before-cleanup order, owner callbacks once, no post-close wrapper publication, and exact stage continuation after each injected throw;
- immediate zero-resource close, close-handshake-only owner cleanup, natural closes through `9_999` ms, zero channel-local force before the boundary, coordinator force selection at `10_000` ms, timer cancellation, bounded result classes, and no wait for the full grace after early drain;
- force reaches only residual Pi `WebSocketServer.clients` and this HTTP server's tracked sockets, never unrelated sockets, arbitrary process handles, or Next internals;
- real WS/HTTP force makes callbacks converge; an injected omitted callback after directly observed zero owned resources records failure and cannot strand the coordinator; repeated close shares one promise/result;
- wrapper/hub/subscriber/watcher/ticket/admission/global cleanup is exact under owner-close/socket-close/force reentrancy;
- public `app.close()` remains awaited after Pi-owned cleanup, errors aggregate, programmatic close never exits, and the port can rebind.

### Real child, development, production, and browser smoke

Require:

- terminal signal matrix before/after readiness: first signal wins; one close; `130`/`143`; startup/close failure `1`; imported APIs install no signals or exits;
- real Next development ordinary routes and HMR remain functional on nonreserved upgrades, all three Pi channels coexist, heartbeat survives automatic pongs, terminal cleanup releases Pi resources, and a fresh child rebinds;
- injected/public real-child production mode starts, opens all three channels plus wrappers/watchers, closes gracefully and under forced-peer conditions, restarts on the same port with fresh ownership, closes again, and drains naturally;
- copied pinned real-production lifecycle only when preflight manifests exist, with source artifact fingerprint preserved; absence may fail only that named preflight and never weakens current-bin production-mode evidence;
- one sanitized Chromium and one Firefox page each hold the same originally accepted running, session, and mounted file-watch socket across at least two default heartbeat sweeps while ordinary HTTP remains responsive. Server diagnostics must observe protocol pongs for each finite channel class on both sweeps, with no intervening ticket, upgrade, termination, close, or reconnect and unchanged aggregate admission. A separate server close/restart phase then proves recovery without duplicate settled sockets. This is a three-socket smoke, not S7 scale or user acceptance.

### Required commands and evidence

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test <focused S6 runtime/gateway/channel/server tests>
node --test lib/*.test.mjs components/*.test.mjs
node --test $(find lib components -maxdepth 1 -name '*.test.mjs' ! -name 'pi-web-real-next.test.mjs' -print | sort)
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Run literal, exact non-real-Next, and real-Next separately. Do not run `next build`. With absent release manifests, only the named copied-production subtest and its parent may fail solely at manifest preflight; terminal and real-development cases must pass, and current-bin injected/real-child production reuse must pass independently.

Before acceptance, the root must inspect the complete diff, owner graph, timer/force ordering, process-listener inventory, bounds/admission evidence, browser smoke, package shape, privacy, immutable hashes, no-stage state, and recoverable child handoff. Obtain one fresh independent no-edit/no-delegation review after all fixes.

## Telemetry / Debuggability

Use only bounded development/test diagnostics:

- semantic idle: `startup`, `command`, `native_event`, `wrapper_event`, `settlement`; deadline `deferred_active` or `disposed`;
- heartbeat: `sweep`, `pong`, `missed`, `ping_failed`, `closed`, finite `running`/`session`/`file_watch` class, and zero/one/many count class;
- lifecycle owner: finite `running`, `session`, `file_watch`, `rpc` class with `registered`, `replaced`, `closing`, `closed`, `failed` outcome;
- admission/replay/output: finite cap/release/replay/snapshot/slow classes and bounded occupancy classes;
- shutdown: stage, `graceful`/`forced`/`failed`, duration class, and zero/one/many forced counts for Pi WebSocket and tracked HTTP connection resources;
- server instance/build identity only in already accepted opaque bounded form.

Never log direct peer address, ticket/query, session ID, file path/name, message/prompt/tool/provider content, application frame, queue data, credentials, arbitrary error text, private Next state, or aggregate process handles. Tests may assert exact synthetic milliseconds/bytes/counts; development diagnostics prefer classes.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|---|
| S6-VC-001 | P0 | Orchestration/scope | One immutable S6 plan, one sole source writer, verified special handoff/fix loop, fresh independent review, coherent commits; only lifecycle/security/shutdown work enters. | Plan/checkpoint, run identities, hashes, Git diff/status/history. | scrutiny | Overlap, plan mutation, browser/product/S7 drift, or unsupported handoff stops. |
| S6-VC-002 | P0 | Semantic idle | Default idle is exactly 30 minutes; every recognized command, native event, legacy wrapper event, and direct projected wrapper input touches through bounded categories; unsupported and passive transport/heartbeat/file/global traffic never touches. | Exhaustive command/event/direct-projection matrix and injected-clock boundaries. | scrutiny | Bypass, early expiry, hostile passive retention, heartbeat touch, or ambiguous category blocks. |
| S6-VC-003 | P0 | Active lifecycle | Every modeled prompt/compaction/native causal/reserved/fanout/projected active state survives deadlines; final settlement starts a full window; extension binding/commands and generation-scoped starts cannot continue or publish after shutdown; hosted capability reactivates; destruction/recreation and native disposal are exact once. | Reentrant injected-clock/activity, binding/command/start-lock restart races, repeated dispose/recreate tests. | scrutiny | Active expiry, stale continuation, ghost retention, post-close publication, stale lock, duplicate disposal, or failed hosted/recreation blocks. |
| S6-VC-004 | P0 | Heartbeat | One server-owned 30-second ping/pong sweep covers every channel, gives one full response window, terminates missed peers, releases admission, cancels exactly, and never emits application frames or semantic touches. | Fake-clock plus real `autoPong:false`, browser automatic-pong, error/race tests. | both | Silent half-open retention, duplicate timer, wrong peer termination, idle touch, or client protocol change blocks. |
| S6-VC-005 | P0 | Owner teardown/HMR | Gateway V1 owner lifecycle synchronously enlists every accepted channel socket before deferred dispatch; finite `owner_replaced` versus `server_shutdown` semantics let running/session/file owners and generation-scoped RPC owner release every application resource, suppress local shutdown force, and gate in-flight publication. | Pre-dispatch race, reason-specific owner registry, HMR/shutdown replacement, close-race, zero-leak counters. | scrutiny | Unenlisted socket, early local terminate, stale owner, leaked watcher/subscriber/wrapper, disconnect-owned run, or signal race blocks. |
| S6-VC-006 | P0 | Admission/backpressure | Direct-peer 64/256 limits and exact release hold across all channels and every terminal path; session replay remains 4 MiB or 8,192 units; session and global subscribers each have exact 4 MiB encoded output bounds; slow peers isolate without unbounded encoding/queue work. | Boundary/one-over mixed-channel, heartbeat/re-admission, session/global replay-output-reference tests. | scrutiny | Leaked capacity, forwarded-address trust, weakened bound, unbounded allocation/stringify, or blocked healthy peer/agent is P0. |
| S6-VC-007 | P0 | Graceful shutdown | Close stops admission, joins exact owners, requests handshakes without local force through 9,999 ms, and at 10,000 ms lets only the coordinator force each residual proven-owned socket/connection once; cleanup returns bounded graceful/forced/failed evidence. | Integrated all-channel 9,999/10,000 injected-clock, resistant/natural peers, failures, real child, exact owner/force counters. | scrutiny | Any force before deadline, duplicate/out-of-owner force, hung close, retained resource, or hidden failure blocks. |
| S6-VC-008 | P0 | Server/signals | One-port/HMR behavior remains; imported APIs own no signals/exits; launcher is sole first-signal owner; production reuses one process/port and development remains terminal process-scoped after public cleanup. | Source listener inventory, signal children, production repetition, real-development/HMR/package evidence. | both | Competing handler, private Next cleanup, imported exit, production leak, or dev lifecycle regression blocks. |
| S6-VC-009 | P0 | Privacy/diagnostics | Idle/heartbeat/owner/admission/shutdown evidence is bounded and content-safe; no peer, ID, path, ticket, content, provider payload, raw error, or private handle escapes. | Hostile diagnostics tests and static/report review. | scrutiny | Sensitive or attacker-controlled output blocks. |
| S6-VC-010 | P0 | Gates/finality | Focused/literal/exact/real-Next, typecheck, lint, package, browser smoke, whitespace/hash/source/no-stage gates and every review disposition are recoverable; production preflight is reported honestly. | Exact commands/counts, checkpoint, browser outputs, package/Git inspection. | scrutiny | Hidden skip, false fresh-production claim, missing browser/real-child layer, unsupported acceptance, or incomplete evidence blocks. |

S6 completes ORCH-VC-007, ORCH-VC-008, and ORCH-VC-009; revalidates ORCH-VC-002/004/006 and ORCH-VC-012 for lifecycle paths; and advances ORCH-VC-011 compatibility. S7 retains ORCH-VC-010 combined scale, rich capability/visual/user acceptance, maintained documentation, and final system acceptance. ORCH-VC-013 remains incomplete until all milestones, full-master validation, and guarded closeout finish.

## Assumptions, Risks, and Blockers

- Browser protocol pongs are automatic and not observable in application JavaScript; server-side finite channel-class pong diagnostics plus unchanged original socket/ticket/upgrade generations establish browser heartbeat behavior without exposing identifiers.
- The mandatory gateway `ownerLifecycleVersion: 1` capability must be generation-safe across Next hot reload and production restart. If safe pre-dispatch enlistment or post-shutdown publication/continuation gating cannot be achieved without a generalized product owner or private SDK change, stop.
- `httpServer.close()` and `WebSocketServer.close()` are callback-based. Real force should make callbacks converge; hostile injected omission after directly observed zero ownership becomes a bounded failure rather than an unbounded await. The deadline never applies to Next internals.
- Wrapper `destroy()`/native `dispose()` is the public teardown available to Pi Web. S6 suppresses binding/command continuations owned by Pi Web but does not claim cleanup of arbitrary detached third-party extension jobs or graceful `session_shutdown` parity supplied by `AgentSessionRuntime`.
- A stale copied production artifact may validate public lifecycle only. It cannot contain current route code or prove release freshness.
- Waiting two default heartbeat sweeps adds browser runtime but prevents acceptance based solely on injected intervals.
- If S6 uncovers a required browser/application heartbeat frame, new TLS/port/process architecture, weakened backpressure, or private Next cleanup, that is material divergence.

## Implementation Handoff

No implementation is authorized while this milestone is `Status: draft` or before its plan and matching checkpoint are committed. After root reconciliation and fresh independent draft review, change only `Status: draft` to `Status: approved`, commit the immutable plan/checkpoint boundary, record the plan blob, and launch one fresh `milestone-implementer` with S6-VC-001 through S6-VC-010, exact source/test/browser boundaries, special handoff contract, preservation rules, and stop conditions.
