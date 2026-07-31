# S1: Global Running and Discovery WebSocket

Status: approved

## Objective

Implement the first contained production boundary of the approved [persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md): migrate only global running-session and session-discovery delivery from the permanent browser EventSource to one same-port WebSocket per loaded browser page instance.

Before registering that first production channel, enforce gateway-instance-wide admission of at most 64 concurrent Pi Web WebSockets per direct socket peer address and 256 total, with exact-once release on every failure, close, and server-shutdown path. The global channel must preserve current initial/reconnect `running` and `sessions_changed` behavior without creating, opening, enumerating, or otherwise touching an `AgentSessionWrapper` or native `AgentSession` when a browser connects.

Success means:

- one static `running` channel is registered exactly once per live gateway across App Router hot reload and same-process production restart;
- every loaded browser page instance owns exactly one global socket above `SessionSidebar` and keyed `ChatWindow` lifetimes;
- the socket bootstraps through the existing same-origin, one-use ticket boundary and derives `ws://` or `wss://` only from the current page;
- initial, changed, and reconnected running IDs and discovery generations remain exact, including equal-generation replay after a failed discovery load and generation namespace reset after a server-instance change;
- stale fetches, sockets, callbacks, and reconnect timers cannot publish state or create a duplicate socket;
- disconnect retains the last authoritative running set and never creates a false running-to-idle edge;
- sidebar stale-list suppression, running authority, unread markers, background-completion refresh, selection behavior, and hosted Start/Orchestrate discovery remain compatible;
- the 65th same-address and 257th total connection are rejected before handler dispatch, and released capacity is reusable;
- the global EventSource caller and route are removed only after parity is proven;
- per-session agent SSE, persistent file watching, and short-lived OAuth login SSE remain unchanged;
- required focused, full, package, privacy, browser inventory, and request-schedulability evidence passes before the milestone boundary commit.

## Design / Implementation Strategy

### 1. Extend the existing gateway with direct-peer admission

Keep the accepted V1 gateway, ticket, one-port server, reserved upgrade path, origin validation, and lifecycle architecture. Add gateway-instance-owned admission state and a narrow server-facing reservation API with these invariants:

- export fixed limits of 64 active Pi Web sockets per direct peer address and 256 active Pi Web sockets total;
- derive the key only from the accepted Node socket's direct `remoteAddress`; never read `Forwarded`, `X-Forwarded-For`, or another request header;
- fail closed with a bounded reason when a usable direct peer address is unavailable;
- consume/validate the one-use ticket first, then reserve admission before `WebSocketServer.handleUpgrade` and before channel-handler dispatch;
- a cap rejection consumes the ticket and dispatches no handler;
- return one idempotent release capability; all handshake exceptions, callback/setup failures, accepted-socket close paths, handler failure closure, server termination, and gateway close converge on it without underflow or double release;
- delete peer-count entries when they reach zero and clear residual accounting on gateway close;
- expose only aggregate active-connection and active-peer-key counts plus bounded rejection reasons in development diagnostics—never peer addresses, headers, URLs, tickets, session IDs, or content.

The accounting must be shared by every channel using the one gateway, including later session and file-watch channels. Do not use `WebSocketServer.clients.size` as the admission authority.

### 2. Publish an HMR-safe running-status projection

Make running status a process-global projection updated by wrapper-owned state transitions rather than a value recomputed when a browser attaches:

- wrapper start/event/prompt-claim/prompt-release/compaction/destroy paths publish their own real session ID and current running Boolean into one HMR-safe set;
- `getRunningRpcSessionIds()` and the `/api/sessions` fallback read a stable snapshot of that set instead of enumerating the wrapper registry;
- broadcaster de-duplication and listener state are process-global, deterministic, and survive App Router module replacement;
- wrapper destruction removes the ID; unchanged publication emits nothing;
- opening, reconnecting, receiving from, or closing the global WebSocket never calls `startRpcSession`, `getOrCreateRpcSession`, `getRpcSession`, the wrapper registry, `isRunning()`, or another wrapper/native-session method.

An existing wrapper may publish its own state from within its transition path. Browser attachment must remain a pure read/subscription to the projection. Do not broaden this into S2's session event projector.

The required S1 runtime and hosted-discovery flows currently emit raw session identifiers from `lib/rpc-manager.ts` extension-binding diagnostics and `lib/hosted-implementation-session.ts` lifecycle diagnostics. Narrowly replace those identifier values with bounded identifier-free stage/outcome fields and strengthen their focused tests. This is a privacy compatibility correction required by the master's fixed evidence/diagnostic boundary, not a hosted-session behavior redesign; do not change ownership, kickoff, discovery, error, or cleanup semantics.

### 3. Register one static production channel safely

Add a server-only global-status service and a minimal shared protocol definition. Use the static channel name `running`; do not encode a session ID or other metadata in the channel name.

The service must:

- provide an explicit `ensure` registration seam invoked for the exact `running` bootstrap before ticket issue;
- hold a versioned process-global registration record keyed to the exact live gateway/server instance;
- reuse one compatible registration for repeated requests and hot reload;
- retire only its own stale compatible registration when the gateway identity changes, preserve incompatible/foreign records fail closed, and avoid windows where a new ticket binds an invalidated handler;
- unsubscribe both running and discovery listeners exactly once on socket close or handler setup/send failure; gateway/server shutdown closes the owned socket and therefore its subscriptions;
- subscribe synchronously before taking initial snapshots so no transition can slip between subscription and snapshot;
- send only minimal JSON frames in this S1 union:

```text
{ protocol: "pi-web-global-status", version: 1, serverInstanceId, type: "running", runningSessionIds }
{ protocol: "pi-web-global-status", version: 1, serverInstanceId, type: "sessions_changed", sessionListGeneration }
```

`runningSessionIds` is a deterministic string array. `sessionListGeneration` is a nonnegative safe integer in a namespace scoped by `serverInstanceId`. Initial connection and every reconnect send both current frames; later broadcasts send only changed running state or the newly published generation. S1 adds no session-event frames, historical replay buffer, heartbeat, semantic-idle rule, or output-backpressure policy reserved for later milestones.

Keep the ticket request body exactly `{channel:"running"}` under the existing one-field S1 schema. Test-only channels remain explicitly registered by tests; unknown production channels remain unavailable.

### 4. Add one page-lifetime browser owner

Create a framework-neutral global-status WebSocket controller with injected browser dependencies for deterministic tests, then expose it through a thin React provider/hook mounted once above `AppShell` (and therefore above `SessionSidebar` and every keyed `ChatWindow`).

The owner must:

- issue one same-origin `POST /api/transport/ticket` with exact transport header, JSON content type, and `{channel:"running"}` body;
- never persist or log a ticket or full WebSocket URL;
- derive the fixed `/_pi/websocket` URL from `window.location`, preserving host/port and selecting `wss:` only for an HTTPS page;
- own at most one bootstrap fetch, one socket, and one reconnect timer at a time;
- invalidate an epoch before aborting/replacing resources; every late ticket result, socket event, close callback, and timer verifies both epoch and exact resource identity;
- use bounded reconnect delay/backoff with injectable timers; successful open/valid frames reset the delay without allowing an old instance to reconnect;
- validate the protocol/version/discriminant/server-instance and payload shape before publication;
- retain the last valid running set through error/close and publish no synthetic idle state;
- expose every `sessions_changed` delivery as an event, not only a React scalar, so reconnect replay of an equal generation remains observable;
- expose whether a valid running frame has made the WebSocket authoritative.

Unknown/malformed frames must not mutate product state or leak payloads to diagnostics. A stale socket from an old epoch/server cannot publish after replacement.

### 5. Adapt the sidebar without moving product policy

Keep native session-list loading, latest-request suppression, generation application, unread persistence, running-to-idle effects, and selected-session behavior in `SessionSidebar` unless a testable extraction moves them intact.

- Replace the SSE consumer with the page-global provider seam.
- Generalize the stream-authority ref: before the first valid running frame, `/api/sessions` remains the fallback; afterward, a late HTTP response cannot overwrite running state.
- Apply each discovery event through the existing generation tracker and `loadSessions(false)` Boolean result.
- On `serverInstanceId` change, replace the tracker with a fresh tracker so a restarted server's lower/equal generation is a new namespace. Pending completions retain their captured old tracker and cannot advance the new one.
- Preserve retry of a failed equal generation on reconnect, rejection of stale/duplicate pending generations, and latest overlapping `/api/sessions` response authority.
- Preserve current running-to-idle unread and activity-list refresh behavior exactly once, and never derive an idle transition from transport loss.

Do not refactor `ChatWindow` or `useAgentSession` for reuse in S1.

### 6. Remove only the migrated persistent stream

After server, controller, provider, and sidebar parity tests pass:

- delete `app/api/agent/running/events/route.ts`;
- remove every browser reference to `/api/agent/running/events` and the global `EventSource` construction;
- update tests that imported or source-inspected the removed route;
- prove `app/api/agent/[id]/events/route.ts` and `hooks/useAgentSession.ts` retain per-session SSE behavior;
- leave the four `FileViewer` watch EventSources and `ModelsConfig` OAuth login EventSource in place for S5 and the explicit OAuth exception.

### 7. Preserve M0 server and package lifecycle

No second port, TLS requirement, custom signal handler, private Next/Watchpack cleanup, framework upgrade, or `next build` is authorized. Programmatic production remains same-process reusable; real Next development remains process-scoped; non-Pi upgrades including HMR remain untouched. Since plain runtime/package files change, run `npm pack --dry-run` and inspect inclusion.

### Scope estimate

- **Expected production surfaces:** `bin/pi-web-transport-gateway.js`, `bin/pi-web-server.js`, `lib/websocket-gateway.ts`, `lib/rpc-manager.ts`, the narrow identifier-removal diagnostics in `lib/hosted-implementation-session.ts`, `app/api/transport/ticket/route.ts`, one new global-status protocol/server service, one new browser controller/provider seam, `app/page.tsx`, `components/SessionSidebar.tsx`, deletion of the global running SSE route, and focused tests.
- **Expected test surfaces:** gateway/ticket/server/real-Next/rpc-manager/hosted-diagnostics/sidebar tests; exact new `lib/global-status-channel.test.mjs`, `lib/global-status-client.test.mjs`, and `components/GlobalStatusProvider.test.mjs` seams; plus sanitized browser/manual evidence.
- **Explicitly excluded:** per-session SSE or session frame projection; hidden session-view registry; file watching; OAuth; heartbeat; 30-minute idle; session replay/output bounds; slow-consumer policy; ten-second shutdown grace; S2-S7 implementation; Pi monorepo changes.
- **Complexity:** medium-large but one coherent production boundary. Most risk is exact admission release, wrapper-independent status projection, reconnect races, and equal-generation replay.
- **Context target:** zero compactions expected; one maximum.
- **Stop condition:** any need to weaken admission/no-wrapper-touch/replay/security/browser gates, alter M0's one-port lifecycle, touch later persistent streams, or choose a new product behavior is material divergence and returns to the orchestration root.

## Reference Files

Selected governing and implementation evidence actually used for this milestone:

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Approved M0 foundation plan](./2026-07-24-m00-baseline-transport-feasibility.md)
- [M0 stopped/foundation checkpoint](../checkpoints/2026-07-24-m00-baseline-transport-feasibility-checkpoints.md)
- [Approved M0 lifecycle recovery](./2026-07-29-m00-development-lifecycle-recovery.md)
- [M0 final recovery checkpoint](../checkpoints/2026-07-29-m00-development-lifecycle-recovery-checkpoints.md)
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md)
- [Repository instructions](../../AGENTS.md)
- [Transport gateway](../../bin/pi-web-transport-gateway.js)
- [Custom server](../../bin/pi-web-server.js)
- [Typed gateway accessor](../../lib/websocket-gateway.ts)
- [Ticket route](../../app/api/transport/ticket/route.ts)
- [Runtime manager and broadcasters](../../lib/rpc-manager.ts)
- [Current global SSE route](../../app/api/agent/running/events/route.ts)
- [Sidebar](../../components/SessionSidebar.tsx)
- [Page owner seam](../../app/page.tsx)
- [App shell](../../components/AppShell.tsx)
- Focused gateway, ticket, server, runtime, real-Next, and sidebar tests under `lib/*.test.mjs` and `components/*.test.mjs`
- Recoverable read-only context run `642ae71c-2ec9-4771-ab73-86e85fdf5ae6`, artifacts under `.pi-subagents/artifacts/outputs/642ae71c-2ec9-4771-ab73-86e85fdf5ae6/`

No advisory reference-pointer companion exists for the master. No external research or Pi-monorepo mutation is required.

## Test Strategy

### Baseline and focused automated tests

Before acceptance, exercise:

- gateway constants, exact 64/65 same-peer and 256/257 total reservation boundaries, missing peer failure, forwarded-header irrelevance, handler-not-dispatched rejection, idempotent release, zero-key deletion, gateway-close cleanup, bounded diagnostics, and re-admission after every release path;
- upgrade integration proving reservation occurs after ticket consumption but before `handleUpgrade`/handler, and release covers handshake throw, handler sync throw/rejection closure, normal close, server close, and repeated close callbacks;
- one-use same-origin ticket behavior, exact lazy `running` registration, repeated ensure/HMR reuse, stale compatible gateway replacement, incompatible-record refusal, and unknown-channel behavior;
- wrapper-owned running projection transitions, deterministic snapshot, no duplicate broadcast, destruction removal, HMR-global state, HTTP fallback, and a channel attach/reconnect sentinel that fails if wrapper/session start/get/registry methods are touched;
- running channel initial/change/reconnect frames, subscribe-before-snapshot race, generation replay, multiple independent subscribers, and exact unsubscribe;
- pure browser controller ticket request, `ws`/`wss` URL derivation including host/port/IPv6, single-owner behavior, cleanup, bounded reconnect, stale fetch/socket/timer suppression, server-instance change, malformed/unknown frame handling, ticket redaction, and last-known-state retention;
- sidebar fallback-before-authority, late HTTP suppression, equal-generation retry, server-instance namespace reset, newer-over-older loads, background completion exactly once, selected completion behavior, and no navigation/selection from discovery;
- real Node WebSocket admission/re-admission and real Next development channel/HMR coexistence while ordinary HTTP remains schedulable; the 256-total case must admit 256 sockets across at least four distinct direct peer keys with no peer above 64, then reject connection 257 and reuse capacity after close, using and recording the platform's direct loopback source-address mechanism;
- identifier-free `rpc-manager` extension-binding and hosted lifecycle diagnostics with unchanged stage/outcome behavior;
- source boundaries: removed global route/caller, unchanged per-session route/caller, expected remaining file-watch/OAuth EventSources, and no later-milestone source.

Required commands:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs components/*.test.mjs
node --test lib/websocket-gateway.test.mjs lib/websocket-ticket-route.test.mjs lib/pi-web-server.test.mjs lib/global-status-channel.test.mjs lib/global-status-client.test.mjs lib/rpc-manager.test.mjs lib/hosted-implementation-session.test.mjs components/GlobalStatusProvider.test.mjs components/SessionSidebar.test.mjs
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Do not run `next build`. The existing copied production artifact may validate lifecycle only and cannot prove fresh route inclusion.

### Browser and request-schedulability evidence

Use sanitized evidence without raw session IDs, tickets, URLs with query strings, content, provider payloads, or private paths:

- Chromium and Firefox, separately: 1, 5, and 10 loaded top-level Pi Web page instances show exactly one global Pi Web WebSocket per page and no `/api/agent/running/events` EventSource/request;
- current running state, running-to-idle edge, hosted Start/Orchestrate `sessions_changed`, disconnect/reconnect, and server-instance restart converge without duplicate sockets or false unread transitions;
- ordinary HTTP requests remain schedulable with five pages/seven representative runs and ten pages/ten representative runs while the global sockets remain connected;
- distinguish Pi Web socket counts from unrelated browser/HMR resources and record only aggregate counts and bounded outcomes.

S1 does not claim S7's combined 30-socket session/file/global topology or subjective user responsiveness acceptance. Missing Firefox/Chromium connection inventory or bounded no-hang/request-completion evidence blocks S1 acceptance; latency measurements are diagnostic here, while the user's responsiveness and visual acceptance gate remains S7.

### Review and execution evidence

- inspect the actual diff and map every obligation below;
- record implementation handoff, commands, departures, and residual risk in the matching checkpoint;
- obtain fresh independent no-edit/no-delegation review after implementation and after any substantive fix;
- run privacy/source-boundary searches and `git diff --check` immediately before the boundary commit;
- commit only the coherent accepted S1 implementation and checkpoint state.

## Telemetry / Debuggability

Development-only bounded diagnostics may expose:

- gateway/server instance identity;
- production-channel registration/reuse/retirement outcome;
- aggregate admitted total, aggregate peer-key count, rejection reason class, and exact release outcome/count;
- running subscriber count and discovery generation value/class;
- browser connection state, reconnect reason class, attempt count class, and stale-callback suppression count;
- sidebar provider selected/consumer count only if needed.

Never log peer addresses, forwarded headers, tickets, full URLs/query strings, raw session identifiers, prompts/messages/tools/provider data, credentials, private paths, or frame payloads. Reason and event vocabularies must be finite and tested. No user-facing telemetry product is in scope.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|---|
| S1-VC-001 | P0 | Orchestration/scope | One immutable S1 plan, one source writer, verified handoff, fresh independent review, no overlapping milestone/writer, and one coherent boundary commit; only S1 surfaces change. | Plan/checkpoint, subagent identities, Git diff/status/history, source-boundary search. | scrutiny | Ownership ambiguity, plan mutation after writer start, later-milestone source, or unsupported handoff stops immediately. |
| S1-VC-002 | P0 | Admission | The gateway admits at most 64 active Pi Web sockets per direct peer and 256 total, rejects before handler dispatch, ignores forwarded headers, releases exactly once on every path, and restores capacity. | Pure boundary tests, reserved-upgrade tests, Node WebSocket integration at 64/65 and at 256/257 distributed across at least four direct peer keys with no peer over 64, release/re-admission counters, shutdown evidence, and recorded direct source-address mechanism. | scrutiny | Any over-admission, underflow, leaked capacity, header trust, single-peer substitute for the total gate, or rejected-handler dispatch blocks. |
| S1-VC-003 | P0 | Running projection | Current running IDs are maintained by wrapper-owned transition publication; browser attach/reconnect reads only the projection and never creates, opens, enumerates, or invokes a wrapper/native AgentSession. | Transition fixtures, no-touch sentinels, static call-boundary review, HTTP fallback test. | scrutiny | Wrapper/session access from global attach or stale running state blocks. |
| S1-VC-004 | P0 | Server channel | Exactly one HMR/restart-safe static `running` registration emits minimal versioned initial/change/reconnect running and discovery frames with subscribe-before-snapshot ordering and exact cleanup. | Registration identity tests, channel fixtures, multiple subscribers, reconnect/generation replay, real-Next HMR coexistence. | scrutiny | Duplicate/stale registration, missed transition, wrong generation namespace, subscriber leak, or raw event serialization blocks. |
| S1-VC-005 | P0 | Browser owner | Each page owns exactly one bootstrap/socket/reconnect owner; page-derived URL, epoch/resource identity, bounded reconnect, frame validation, last-known retention, and stale-instance suppression are correct. | Pure controller tests, provider/source review, Chromium/Firefox 1/5/10 page inventory. | both | Duplicate socket, ticket leak, stale publication/reconnect, false idle, or topology mismatch blocks. |
| S1-VC-006 | P0 | Sidebar/discovery | HTTP fallback/authority, stale-list suppression, equal-generation retry, server-instance reset, unread/background completion, and hosted discovery remain exact without navigation or selection changes. | Sidebar/provider tests plus hosted Start/Orchestrate disconnect/reconnect browser flow. | both | Lost discovery, unretryable generation, stale overwrite, false/missed unread edge, or selection/URL mutation blocks. |
| S1-VC-007 | P0 | Migration boundary | Global EventSource caller and route are absent; per-session agent SSE, file-watch SSE, and OAuth login SSE remain unchanged. | Static inventory, focused tests, final diff. | scrutiny | Remaining global caller/route or out-of-scope persistent-stream change blocks. |
| S1-VC-008 | P0 | Security/privacy | Existing same-host one-use ticket/origin/body/frame rules remain fail closed; admission, transport, extension-binding, and hosted lifecycle diagnostics exercised by S1 are bounded, identifier-free, and content-safe without changing hosted behavior. | Adversarial ticket/upgrade tests, focused runtime/hosted diagnostics tests, baseline-output/static privacy review. | scrutiny | Trust-boundary regression, raw identifier, or other sensitive diagnostic/evidence blocks. |
| S1-VC-009 | P0 | Lifecycle/package | One-port CLI/package/HMR behavior, Pi-owned cleanup, production reuse, and process-scoped development remain correct; changed runtime files are packaged. | Full/real-Next tests, package dry run, close/rebind evidence. | both | New signal/port/private cleanup, owned leak, production reuse failure, or missing package file blocks. |
| S1-VC-010 | P0 | Schedulability/compatibility | Ordinary HTTP completes without hang/starvation at five pages/seven runs and ten pages/ten runs; current product capabilities exercised by changed paths remain compatible. S1 records latency diagnostically and reserves subjective responsiveness/user acceptance for S7. | Chromium/Firefox aggregate inventory and bounded request-completion evidence, full test suite, representative hosted/session-list/sidebar flows. | both | HTTP hang/starvation, wrong connection topology, or capability regression blocks. |
| S1-VC-011 | P0 | Required gates | Typecheck, lint, full and focused tests, real-Next integration, package dry run, diff check, checkpoint evidence, and independent review pass with no hidden skips. | Exact command outcomes and review result. | scrutiny | Failed/skipped required layer or uncharacterized environmental failure blocks. |

This contract implements the S1 portion of ORCH-VC-001, ORCH-VC-002, ORCH-VC-008, ORCH-VC-009, ORCH-VC-010, and ORCH-VC-012. Later full-master validation remains authoritative for all master rows.

## Assumptions, Risks, and Blockers

- The literal no-wrapper-touch wording in ORCH-VC-002 is resolved here by requiring a cached process-global running projection; silently weakening it to “does not start a new session” is not allowed.
- Ticket-route lazy registration is selected because it keeps application runtime imports inside App Router and avoids loading TypeScript application modules from the plain CommonJS server. If implementation evidence proves this exact seam infeasible, stop rather than moving to a second server/port or weakening HMR identity.
- A discovery generation is scoped by server instance. Equal reconnect replay must remain observable; React scalar equality is not an event-delivery mechanism.
- The 16 KiB existing `ws` inbound payload limit is not admission or output-backpressure evidence.
- Browser automation dependencies are not installed. The root may use available browsers/tools for acceptance, but absent cross-engine evidence remains a blocker rather than authorizing a new product dependency or waiver.
- Fresh production inclusion remains release-owned because `next build` is prohibited. Stale copied artifacts prove lifecycle only.
- If required browser workloads reveal a secondary nontransport bottleneck, record it. It becomes material divergence only if S1 cannot meet its gates without secondary redesign.

## Implementation Handoff

No source implementation is authorized while this milestone is `Status: draft` or before its plan and checkpoint are committed. After root review under the approved orchestration master, change only the status to `approved`, commit the immutable plan/checkpoint boundary, and launch one fresh `milestone-implementer` as the sole implementation-source writer for this exact milestone.
