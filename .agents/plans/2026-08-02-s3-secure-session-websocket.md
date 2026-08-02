# S3: Secure Server Session WebSocket

Status: approved

## Objective

Implement only the S3 secure server session-WebSocket boundary authorized by the approved [persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md), starting from accepted S2 implementation commit `39f22f0eafa418a3bac5e664b35764ff43213f27` and final checkpoint commit `26ec788052fbd7297ffd787f4b71a1c993b72589`.

Expose every current wrapper-owned projected hub through one static, same-port `session` WebSocket channel. A same-origin bootstrap for exact `{ channel: "session", sessionId }` must resolve or start the wrapper under the existing per-session lock, validate its already-installed S2 hub, and bind that exact authorized target only inside the one-use server-side ticket record. After upgrade, one bounded versioned resume frame selects initial snapshot, exact replay, or canonical recovery. Each accepted socket then drains the S2 projected protocol in order through an independent bounded output pump.

The browser does not consume this channel yet. Existing HTTP command/state/transcript/tree/context APIs and the raw per-session SSE route/caller remain the authoritative product path until S4A/S4B. S3 freezes and proves the browser-facing server contract with Node clients without introducing browser ownership, deleting reconciliation, or making transport disconnect own a run.

Success means:

- ticket bootstrap accepts exact `{ channel: "session", sessionId }`, preserves current same-host/header/body bounds, resolves or starts exactly one wrapper under existing locks, and issues no ticket unless that exact live wrapper has its compatible nonclosed S2 hub;
- one static HMR-safe `session` registration is used for every session; no session ID, cursor, or epoch enters a channel name or WebSocket query;
- the process gateway carries one opaque channel-owned ticket context by identity, deletes it on consume/expiry/unregister/close, and never inspects, serializes, copies, returns to the browser, or diagnoses it;
- a ticket remains bound to the authorized wrapper/hub even if another wrapper later appears for the same ID, and a missing/incompatible/closed pre-S2 hub fails closed without retrofit, abort, destruction, or fallback;
- each socket accepts exactly one strict text resume frame, emits one strict ready control frame, and then emits only encoded S2 projected frames;
- null resume selects a canonical initial snapshot, a retained cursor receives exact contiguous replay, stale/future/wrong-epoch/overflow resumes receive canonical recovery, and a current cursor receives an observable empty-ready result;
- ready and all selected catch-up units precede every live unit, with no gap or duplicate caused by composing replay and listener registration;
- multiple subscribers to one wrapper are independent and ordered; a slow, failed, or disconnected subscriber cannot block projection, alter hub sequence/state, abort a run, destroy a wrapper, or affect a healthy subscriber;
- each subscriber has a 4 MiB encoded application-output bound, drains through a single-send callback pump, and closes retryably on overflow or an individually unsendable frame without truncating protocol data;
- wrapper destruction closes every bound subscriber exactly once, while ordinary socket disconnect only releases that subscriber; existing ten-minute semantic idle, native disposal, process signals, and server ownership remain unchanged;
- real Node WebSocket clients prove same-port ticket issue/consume, initial/replay/recovery, independent subscribers, reconnect, wrapper teardown, hostile input, shared admission, server restart, and ordinary HTTP schedulability;
- no browser registry/client/hook, per-session SSE removal, heartbeat, 30-minute idle, file watch, shutdown grace, Pi-monorepo change, dependency, second port, TLS requirement, or release build enters the diff.

## Design / Implementation Strategy

### 1. Freeze the S3 transport-control contract

Add a small runtime-neutral V1 session transport protocol alongside, not inside, the accepted projected-session protocol.

The only accepted client data frame is exact JSON text:

```json
{
  "protocol": "pi-web-session-transport",
  "version": 1,
  "type": "resume",
  "streamEpoch": null,
  "cursor": null
}
```

A reconnect uses the same exact keys with a nonempty opaque `streamEpoch` of at most 128 characters and a nonnegative safe-integer `cursor`. Epoch and cursor must either both be null or both be non-null. Reject unknown versions/types, excess or missing keys, unsafe values, malformed JSON, binary input, and every second application data frame. Do not accept commands, acknowledgements, session IDs, provider data, or arbitrary client state over this channel. The custom server's existing 16 KiB maximum inbound WebSocket payload and disabled compression remain authoritative.

After successful atomic hub attachment, send one exact ready control frame before projected catch-up:

```json
{
  "protocol": "pi-web-session-transport",
  "version": 1,
  "type": "ready",
  "serverInstanceId": "opaque-bounded-instance",
  "streamEpoch": "opaque-bounded-epoch",
  "cursor": 42,
  "outcome": "exact"
}
```

`serverInstanceId` and `streamEpoch` are each nonempty strings of at most 128 characters. `outcome` is exactly one nonclosed S2 replay outcome: `exact`, `empty`, `initial_snapshot`, `overflow_snapshot`, `wrong_epoch`, or `invalid_cursor`. The ready epoch/cursor describe the target state of the catch-up units that follow; receiving ready never advances application state by itself. An `exact` client advances only by applying every projected frame through the target cursor, and a snapshot client advances atomically only at valid `snapshot_end`. Only `empty` confirms that the client's already-held epoch/cursor is current. A disconnect after ready but before catch-up completion therefore resumes from the last fully applied cursor, not the ready target.

The ready frame is the minimum transport control needed to make a valid current-cursor resume observable and to bind S4A's future client to the serving process and hub epoch. It contains no session identity or product state. Add strict parsers for both control directions so S4A can reuse the frozen contract rather than invent another handshake.

Use standard retry/policy close codes as wire constants:

- `1003` for binary application data handled by the session channel;
- `1008` for malformed, unsupported, duplicate, or timed-out resume policy;
- `1011` for malformed internal authorization, handler, or serialization failure;
- `1012` when a valid authorized wrapper owner disappears;
- `1013` for retryable slow-consumer/output overflow.

Installed `ws` itself owns protocol-layer close `1007` for invalid UTF-8 text and `1009` for a frame beyond the existing 16 KiB maximum; channel cleanup must accept those close/error paths without trying to remap them. Close reasons, if present, are fixed bounded tokens. They never contain input, identifiers, paths, tickets, epochs, or errors.

### 2. Extend the process-local ticket record without teaching it session semantics

Preserve gateway protocol version `1`, its existing global slot, 30-second one-use ticket expiry, same-host checks, consume-before-admission order, 64-per-direct-peer/256-total accounting, and exact release behavior.

Extend the V1 gateway structurally so `issueTicket(channel, ticketContext?)` stores an optional opaque context reference in the ticket record and `consumeTicket()` returns it only to the custom-server dispatcher. The exact optional capability marker is `ticketContextVersion: 1`. The exact typed dispatcher addition is optional `ticketContext?: unknown` on `PiWebTransportChannelContext`. A hot-reloaded route facing a version-one gateway without `ticketContextVersion === 1` may continue issuing context-free `running` tickets, but it must reject `session` bootstrap as `503 transport_unavailable` before registration, wrapper start, or ticket issue. Old JavaScript silently ignoring an extra argument is never treated as support.

The gateway and custom server must:

- preserve the opaque context reference by identity only;
- remove it with the ticket on atomic consumption, expiry, registration revocation, or gateway close;
- pass it to the selected static handler as `ticketContext: unknown`;
- never enumerate, clone, freeze deeply, stringify, compare by content, diagnose, or expose it in ticket responses;
- continue consuming a valid ticket before admission reservation, including when the peer/total cap then rejects it; never restore a spent ticket;
- retain all existing malformed-handshake and admission release paths.

Only the typed session-channel module validates its own exact shallow-frozen authorization record. Its five own enumerable fields are `{ protocol: "pi-web-session-ticket-context", version: 1, owner: "pi-web", wrapper, hub }`. String protocol/version/owner fields—not class, module, or symbol identity—are the HMR-stable ownership marker, so a new route module can issue context accepted by an existing compatible handler. The handler requires exactly those keys, `Object.isFrozen(record)`, structurally valid wrapper/hub references, and `wrapper.getProjectedEventHub() === hub`. Context-free channels remain compatible.

### 3. Authorize one exact wrapper/hub before ticket issuance

Extend the bounded ticket route parser with one special exact body shape `{ channel: "session", sessionId }`; all other existing channels retain exact `{ channel }`. `sessionId` must contain 1–256 characters, equal its own trim, and contain no C0 or DEL control character. Reject dynamic forms such as `session.<id>`, excess fields, and a one-field `session` request.

Before any startup, resolve the requested ID through `resolveSessionPath()` and read the existing bounded header. Require `header.id === sessionId`; an absolute resolved session file and absolute header cwd; no NUL; and at most 4,096 UTF-8 bytes for each normalized file/cwd. Pass those normalized values to startup. Strengthen the existing-file branch of `startRpcSession()` itself so every initiator—including an HTTP command already holding the shared start lock—verifies the prepared inner/wrapper session ID, normalized session file, and actual session-manager cwd before returning preparation for publication. New-session creation with an empty file remains unchanged.

For a valid same-host session bootstrap:

1. Require `ticketContextVersion === 1` and one compatible HMR-safe static `session` registration before starting work.
2. Validate any already registered live wrapper against the requested ID, normalized file/cwd, liveness, and exact compatible nonclosed hub before reuse.
3. Otherwise call `startRpcSession()` with the prevalidated ID/file/cwd. This uses `getOrCreateRpcSession()`'s existing registry and shared start Promise. Supply its `validatePrepared` hook to repeat the real ID, wrapper ID, normalized session file, actual manager cwd, and hub-capability checks before `session.start()`/registry publication; the strengthened baseline preparation invariant covers a start lock initiated by another caller.
4. After the shared Promise resolves, revalidate liveness, every identity/path/cwd invariant, and `wrapper.getProjectedEventHub() === hub` before ticket issue.
5. Create the exact shallow-frozen five-field authorization record from §2, with no copied request body or diagnostic/session label.
6. Issue the ticket with that authorization context and return only `{ ticket, expiresAt }` under `Cache-Control: no-store`.

Reject every existing wrapper whose identity, file, cwd, projected capability, hub identity, or liveness is wrong. Do not distinguish active from inactive, attach a second projector, backfill missed events, abort/destroy the wrapper, or silently fall back to raw SSE. A wrapper destroyed between issue and consume leaves a spent ticket whose handler closes `1012`; it never re-resolves by session ID.

Use this closed response map for the session branch: malformed body/ID is `400 invalid_request`; absent path or absent/unparseable header is `404 session_not_found`; syntactically valid header, prepared target, capability, or liveness conflict is `409 session_transport_unavailable`; startup or bounded internal failure is `503 session_unavailable`; and missing context-capable transport/registration remains `503 transport_unavailable`. Responses never use `String(error)`, paths, IDs, provider details, or startup payloads. Unknown sessions issue no ticket and create no wrapper. Concurrent successful bootstrap requests share one wrapper/hub but receive independent one-use tickets.

### 4. Register one HMR-safe static session channel and owner registry

Follow the accepted global-status registration discipline with a distinct `Symbol.for("pi-web.session-channel.v1")` record containing exact protocol/version/owner, gateway identity, server instance, active/unregister state, the handler, and its owner registry.

Reuse only an active compatible registration on the same gateway. On a compatible stale gateway, unregister it, revoke its pending tickets, and register against the current gateway. Preserve the channel-owned owner registry across that replacement so same-process server restart or module reload does not accumulate wrapper-destruction observers.

The owner registry uses wrapper object identity, never session ID. It keeps one record per wrapper with `dead` state and a set of current subscriber cleanup callbacks and installs at most one wrapper `onDestroy` observer. Immediately after strict ticket-context validation—and before waiting for resume—the handler synchronously gets/creates the owner record, registers this pre-resume socket, and rechecks wrapper liveness, hub openness, and exact hub identity without an `await` between those steps. It repeats the owner/hub check immediately before `hub.attach()`.

On wrapper destruction, atomically mark the owner dead, delete its wrapper-keyed registry entry, snapshot and clear current callbacks, and invoke each cleanup exactly once with `1012`. Ordinary subscriber cleanup removes only its callback. The established wrapper path still owns hub close/native disposal; the channel never calls Stop, abort, `destroy()`, or `inner.dispose()`.

The ticket context must still match the wrapper's current hub object at consume time. Malformed internal context closes `1011`; a structurally valid context whose wrapper is dead or hub disappeared closes `1012`. Attach nothing in either case. Every application-initiated close uses a 1,000 ms default terminate fallback, injectable in tests, owned/unrefed by that subscriber and cleared on its final cleanup.

### 5. Attach once and order ready, catch-up, and live output exactly

After validating the one resume frame, build a subscriber pump in a paused state and call `hub.attach(streamEpoch, cursor, listener)` exactly once. Never compose `replayAfter()` with a later listener registration.

The supplied listener is synchronous and may only perform bounded projected-frame admission and append to that subscriber's live FIFO. While the pump is paused, it cannot send. S2 buffers any reentrant publication during attachment internally and appends those units to the `attach()` result; the supplied listener becomes active only after return. The exact wire prefix is therefore:

1. reject the closed outcome;
2. strict ready frame;
3. every unit returned by `attach()` in returned order, including S2-buffered reentrant units;
4. only then, post-return listener FIFO.

Treat the returned units as a transport-owned copied/reference source; do not assume every replay result array is frozen. The callback-driven pump sends one text frame at a time and no raw SDK/wrapper object or alternate snapshot encoding may reach `socket.send()`. Guard the pump against synchronous callback reentrancy so an immediately completed send cannot recurse once per snapshot part or reorder work; the maximum 8,192-part source must drain without stack growth.

Initial/recovery snapshot sources are synchronously materialized by S2 and bounded by its canonical byte/part limits, including base64 expansion into individually bounded transfer units; they may be substantially larger than 4 MiB. Retained replay sources are bounded by S2's 4 MiB/8,192-unit limits. Copy/reference the returned list, drop the result wrapper, clear each source reference after its send callback, and release every remaining reference on cleanup. Encode only the next source unit. This source is distinct from buffered network output and permits a canonical snapshot larger than 4 MiB to drain incrementally without truncation. A live final snapshot that accumulates behind a stalled send is ordinary queued output and may correctly close that subscriber, which then obtains a newly generated incremental recovery snapshot.

A ready result at current cursor may have zero projected catch-up units and confirms only the already-held cursor. Snapshot start/chunk/end ordering and logical sequence are never rewritten. Live frames can begin only after all returned units have been submitted in order.

### 6. Bound subscriber output and fail slow consumers independently

Use the master-selected 4 MiB maximum per-subscriber encoded application-output bound, with an injectable smaller limit for deterministic tests. Add one bounded projected-frame encoding helper that traverses an already validated canonical frame and stops as soon as byte-identical JSON UTF-8 output would exceed the supplied limit, without retaining or constructing the full oversized string. Only a frame proven to fit may be serialized, and its text must equal `encodeProjectedSessionFrame()` byte for byte across Unicode, escapes, split/lone surrogates, arrays, and records. A channel-owned weak identity cache may share the encoded text or over-limit sentinel for the same immutable frame/limit across subscribers; it must not retain dead frame graphs or attacker input.

Track exact UTF-8 bytes for:

- the one in-flight encoded text frame until its `send` callback settles;
- every encoded post-return live-queue frame not yet submitted;
- any other encoded application item already admitted to the pump.

Also fail closed if `socket.bufferedAmount` independently exceeds the same bound. Do not count the not-yet-encoded catch-up source as queued network output; it remains subject to the separate S2 snapshot/replay source bounds and admits only one encoded unit at a time. A single unit whose bounded preflight exceeds 4 MiB closes only that subscriber with `1013`; no oversized output string, truncation, or raw fallback is permitted.

On prospective overflow, immediately mark the subscriber terminal, make its listener a no-op for the remainder of any currently published logical group, unsubscribe from the hub, remove it from the owner registry, and discard/release every queued, source, and in-flight reference before initiating `1013`. Apply the same single idempotent cleanup owner to synchronous send throws, callback errors, socket error/close, invalid input, wrapper destruction, and handler setup failure. The exact default terminate fallback is 1,000 ms; clear/unref it on final closure.

A 10,000 ms injectable resume deadline prevents an admitted socket from holding capacity forever without its first frame. This is handshake resource control, not heartbeat. It and the close fallback are subscriber-owned and cleared on every cleanup. Do not add ping/pong, let heartbeat touch wrapper idle, change the ten-minute idle duration, or implement S6's ten-second whole-server shutdown grace.

The hub listener never waits for socket drainage or retries a frame in place. Bounded preflight stops at one-over rather than scanning the remainder of an oversized value, and a shared cache prevents repeated work across subscribers. Projection and healthy subscribers continue after a slow socket is detached. A retrying client uses its last fully applied epoch/cursor and receives exact replay or canonical recovery for durable projected state plus transcript/runtime refresh markers. Oversized transient notices/editor effects remain intentionally nonrecoverable one-shot effects under accepted S2 semantics and must not be claimed as recreated.

### 7. Prove the public server seam with real Node clients

Add deterministic pure/fake-socket coverage and real loopback Node `ws` integration against the actual custom server/gateway plus a controlled request handler. Put default session authorization/start behavior behind an injectable `createSessionTicketIssuer(dependencies)`-style seam while the route uses the production default. For the real loopback path, preseed the actual process registry with a synthetic `AgentSessionWrapper`/hub through the existing registry seam, so the real `POST` handler takes its production fast path with zero provider/model call. Adapt the controlled custom-server request handler to invoke that actual `POST` function, not a lookalike bootstrap. Exercise the same-port upgrade, static session registration, wrapper hub, and ordinary HTTP response path without React.

Required end-to-end cases include:

- exact same-host ticket POST and one-use upgrade with no session metadata in URL/response;
- concurrent ticket requests sharing one wrapper startup;
- initial snapshot and ready frame;
- current-cursor empty resume, retained exact replay, and stale/future/wrong-epoch/overflow snapshot recovery;
- zero-subscriber events recovered on later attach;
- two healthy subscribers receiving identical ordered frames;
- one stalled subscriber closing retryably while the hub and a healthy subscriber continue;
- disconnect/reconnect without abort/destroy and wrapper destruction closing all current subscribers once;
- malformed/binary/duplicate/oversized resume input and invalid/missing/reused/cross-host tickets;
- ticket-context identity and deletion across consume/expiry/unregister/gateway close/handshake/admission failure;
- shared gateway admission with mixed `running`/`session` authorizations: real one-address 64/65 rejection and re-admission, plus deterministic dispatcher/gateway 256/257 total rejection and restored capacity across at least four injected direct-peer keys without weakening the accepted direct-peer authority;
- same-process server close/restart replacing stale channel ownership while the retained wrapper/hub remains canonically resumable;
- ordinary bounded HTTP GET/POST completion while at least seven independent session subscribers remain open;
- unmatched upgrade/HMR paths untouched.

Tests must use synthetic content and may inject clocks, byte limits, send callbacks, and wrapper/hub dependencies. Separately exercise header/ID/file/cwd validation, the baseline prepublication startup invariant, the `validatePrepared` hook, and a shared start initiated through another caller. They must not contact a provider, log real session IDs, or create a browser ownership layer.

### 8. Preserve HTTP, SSE, package, and later-milestone boundaries

S3 may change only the gateway ticket-context plumbing, custom-server dispatch context, ticket bootstrap, new session transport protocol/channel, bounded projected-frame encoding helper, narrowly necessary wrapper/start identity validation, and focused tests. It must not:

- change or delete `app/api/agent/[id]/events/route.ts` or `hooks/useAgentSession.ts`;
- create a browser WebSocket client/provider/registry or alter `AppShell`, `ChatWindow`, sidebar, selection, hidden-session behavior, or reconciliation;
- send commands over WebSocket or weaken HTTP command/state/transcript/tree/context authority;
- alter projected V1 frame/state/reducer semantics except for a bounded defect proven to block this transport, which must return to the root fix/divergence discipline;
- implement file-watch transport;
- add ping/pong, 30-minute semantic idle, all-channel shutdown ownership, or a whole-server graceful deadline;
- change gateway connection limits, ticket TTL, inbound payload limit, compression policy, dependencies, port/TLS behavior, Pi source, Next private state, or release artifacts.

The package dry run must prove that modified plain-JS `bin` runtime files remain packaged, but it cannot prove fresh inclusion of App Router or TypeScript session-channel modules. `next build` remains forbidden. Real-Next terminal and development tests must run against current code. If local main lacks release-owned manifests, the production child/parent may fail only at the named missing-manifest preflight; current plain-JS gateway/server behavior must instead pass direct real-loopback and injected production start/close/restart tests. Retain accepted S1 production evidence only as lineage, not as fresh S3 inclusion or execution.

### Scope estimate

- **Expected production surfaces:** `bin/pi-web-transport-gateway.js`, the narrow ticket-context handoff in `bin/pi-web-server.js`, `app/api/transport/ticket/route.ts`, `lib/websocket-gateway.ts`, new `lib/session-transport-protocol.ts`, new `lib/session-channel.ts`, the bounded frame-encoding helper in `lib/session-protocol.ts`, and narrowly necessary `lib/session-reader.ts`/`lib/rpc-manager.ts` existing-file identity seams.
- **Expected test surfaces:** matching transport/channel tests plus focused changes to gateway, ticket-route, custom-server, runtime, and real-Next tests where needed for current development-route inclusion. Existing S2 hub/reducer tests remain authoritative and should not be rewritten.
- **Explicitly excluded:** React/browser files, per-session SSE route/caller, file watching, heartbeat, semantic idle, final shutdown ownership, new dependencies, Pi-monorepo work, `next build`, or production deployment.
- **Complexity:** large but cohesive. Highest risk is maintaining catch-up-before-live order while incrementally draining snapshots and bounding a synchronous hub listener without making the socket own the wrapper.
- **Context target:** zero compactions expected; one maximum.
- **Stop condition:** inability to bind opaque authorization solely in the one-use ticket; need for dynamic/query session metadata; inability to drain canonical snapshots under bounded output without truncation/blocking; required change to projected V1 semantics; or any need for S4/S5/S6 product/lifecycle behavior is material divergence and returns to the orchestration root.

## Reference Files

Selected governing and implementation evidence actually used for this milestone:

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Accepted S1 plan](./2026-07-31-s1-global-running-websocket.md), [checkpoint](../checkpoints/2026-07-31-s1-global-running-websocket-checkpoints.md), and approved direct-peer evidence correction `8f7ded851e1241ee81631d49f443091f1e02bb49`
- [Accepted S2 plan](./2026-08-01-s2-projected-session-protocol-hub.md)
- [Accepted S2 checkpoint](../checkpoints/2026-08-01-s2-projected-session-protocol-hub-checkpoints.md)
- Accepted S2 implementation `39f22f0eafa418a3bac5e664b35764ff43213f27` and final checkpoint `26ec788052fbd7297ffd787f4b71a1c993b72589`
- [Original transport architecture, M3 advisory evidence](./2026-07-24-multi-tab-performance.md)
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md)
- [Hosted implementation-session memory](../memory/hosted-implementation-sessions.md)
- [Project memory index](../memory/MEMORY.md)
- [Repository instructions](../../AGENTS.md)
- [Transport gateway](../../bin/pi-web-transport-gateway.js)
- [Custom server upgrade dispatcher](../../bin/pi-web-server.js)
- [Typed gateway accessor](../../lib/websocket-gateway.ts)
- [Ticket route](../../app/api/transport/ticket/route.ts)
- [Global channel HMR pattern](../../lib/global-status-channel.ts)
- [Runtime manager and wrapper/start locks](../../lib/rpc-manager.ts)
- [Session path/header reader](../../lib/session-reader.ts)
- [Projected protocol](../../lib/session-protocol.ts)
- [Projected hub](../../lib/session-event-hub.ts)
- [Per-session SSE compatibility route](../../app/api/agent/[id]/events/route.ts)
- Installed `ws` implementation for `bufferedAmount`, send-callback, close, and terminate semantics under `node_modules/ws/lib/websocket.js`
- Recoverable read-only S3 context run `fb86f885-46c1-424e-9731-c8a31aa7bf2e`, scout children 0 and 1

No advisory reference-pointer companion exists for the master. The sibling Pi monorepo is not required for S3 and remains untouched.

## Test Strategy

### Ticket, origin, and metadata-binding fixtures

Require exact coverage for:

- existing transport header, same-host Origin/Host, JSON media type, UTF-8, 1 KiB body, ticket entropy/expiry/reuse, and direct-peer admission behavior;
- exact generic `{ channel }` versus exact session `{ channel, sessionId }` shapes, bounded IDs, excess/missing/dynamic fields, and finite HTTP errors;
- context-capable versus older context-free V1 gateway behavior;
- opaque context identity through issue/consume/dispatch, exact marker/record/dispatch shapes, deletion on every ticket terminal path, no context in response/query/diagnostics, and no ticket restoration after cap rejection;
- exact 256-character session-ID and 4,096-byte normalized file/cwd boundaries, unknown session, malformed/absent/conflicting header, ID/file/cwd mismatch before publication, startup failure, existing live wrapper reuse, concurrent and externally initiated start-lock reuse, destroyed wrapper race, and missing/incompatible/closed hub rejection without retrofit or abort;
- HMR registration reuse, stale gateway replacement/ticket revocation, foreign/incompatible record rejection, pre-resume owner teardown, registry deletion at destruction, and one owner observer per wrapper across reconnect/restart.

### Resume, ordering, recovery, and output fixtures

Require exact coverage for:

- strict resume/ready control parsers, null-pair semantics, target-cursor-not-applied semantics, safe cursors, 128-character epoch/instance boundaries, finite outcomes, handler `1003`/`1008` and `ws`-owned `1007`/`1009`, duplicate/additional frames, and exact 10,000 ms resume timeout;
- ready first, every returned attach unit before post-return listener FIFO, no gap/duplicate under reentrant publication, no assumption that replay arrays are frozen, and exactly one `hub.attach()` call;
- initial/current/exact/stale/future/wrong-epoch/overflow outcomes and complete snapshot transactions;
- one-at-a-time incremental snapshot draining, sent-reference release, nonrecursive progress under immediately completed callbacks through the maximum part count, and no partial reorder when callbacks are delayed;
- bounded byte-identical frame preflight across Unicode/escapes/surrogates that stops before constructing oversized text, weak shared cache lifetime, exact UTF-8 application queue/in-flight accounting, independent `bufferedAmount` rejection, exact 4 MiB boundary and one-over, individually oversized ordinary unit, live final-snapshot backlog, terminal-listener no-op behavior, retryable `1013`, and exact 1,000 ms close-fallback cleanup;
- synchronous send throw, callback error, socket error/close, invalid input, wrapper destroy, and setup-failure races with one unsubscribe/owner removal/terminal close;
- a stalled subscriber never delaying hub acceptance/sequence or a healthy subscriber;
- disconnecting one or the last socket never invoking abort, Stop, wrapper destroy, native disposal, or idle touch.

### Real Node/custom-server integration

Use real `ws` clients and a real loopback custom server to prove:

- route-issued ticket consumption on `/_pi/websocket` at the same port;
- initial, replay, recovery, live, multi-subscriber, zero-subscriber, reconnect, and wrapper-destruction behavior;
- same-origin/ticket/frame/admission rejection, real mixed-channel 64/65 same-peer behavior, deterministic mixed-channel 256/257 total behavior across at least four injected peer keys, and exact capacity restoration; the latter is explicitly not a new real distributed-connection pass and preserves the accepted S1 evidence correction;
- at least seven independent open session subscriptions while ordinary HTTP remains bounded and schedulable;
- server close/restart terminates owned sockets, releases gateway admission/tickets/timers, preserves the S6 wrapper-ownership exclusion, and permits canonical reconnection to a retained wrapper;
- Next development HMR remains untouched on every nonreserved upgrade path.

No browser flow is an S3 acceptance requirement because no browser code changes. S4A/S4B own browser reducer, ownership, HTTP race composition, hidden streams, and SSE removal.

### Required commands and evidence

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/session-transport-protocol.test.mjs lib/session-channel.test.mjs lib/session-protocol.test.mjs lib/session-event-hub.test.mjs lib/websocket-gateway.test.mjs lib/websocket-ticket-route.test.mjs lib/pi-web-server.test.mjs lib/rpc-manager.test.mjs
node --test lib/*.test.mjs components/*.test.mjs
node --test $(find lib components -maxdepth 1 -name '*.test.mjs' ! -name 'pi-web-real-next.test.mjs' -print | sort)
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Use actual final focused filenames if narrow names differ. Do not run `next build`.

Both the literal full-suite command and exact non-real-Next partition are required. Run the real-Next file separately. With absent release manifests, the only permitted real-Next failures are the production subtest and its parent caused solely by the named missing `.next/BUILD_ID`/manifest preflight; terminal and real-development subtests must pass. Because S3 changes current plain-JS server/gateway behavior, acceptance additionally requires real-loopback session-channel integration and injected same-process production start/close/restart against those exact current files. Neither those tests nor accepted S1 evidence may be described as fresh production route inclusion.

`npm pack --dry-run` must include modified `bin/pi-web-server.js` and `bin/pi-web-transport-gateway.js`. It is package-shape evidence only and cannot prove fresh TypeScript/App Router inclusion.

Before acceptance, the root must inspect the complete actual diff and source boundary, reproduce decisive authorization/order/backpressure/ownership cases, inspect package and real-Next evidence honestly, run privacy/raw-field/diagnostic scans, obtain one fresh independent no-edit/no-delegation implementation review, and commit only the coherent accepted S3 boundary.

## Telemetry / Debuggability

Provide only bounded development/test diagnostics or an injectable sink with finite fields:

- ticket/bootstrap result class without ID or path;
- session registration reuse/replacement class;
- resume result class and replay/snapshot outcome;
- subscriber-count and queued/buffered-byte class;
- close reason class: client, policy, owner, send, slow, server, or internal;
- cleanup and close-fallback outcome.

Exact byte/count values may appear in synthetic tests; development diagnostics use bounded counts/classes. Never include ticket values, session IDs, stream epochs, cursors tied to IDs, paths, request bodies, frame bodies, message/prompt/queue/extension content, model/provider labels, tool names/arguments/results, credentials, socket addresses, or raw errors. Unknown input uses finite reason classes, not attacker-controlled strings.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|---|
| S3-VC-001 | P0 | Orchestration/scope | One immutable S3 plan, one source writer, verified special handoff, fresh independent review, no overlap, and one coherent boundary commit; no browser/SSE-removal/file-watch/S6 implementation enters the diff. | Plan/checkpoint, run identities, Git diff/status/history, source-boundary inventory. | scrutiny | Ownership ambiguity, plan mutation after writer start, later-milestone source, or unsupported handoff stops immediately. |
| S3-VC-002 | P0 | Bootstrap/authorization | Exact same-host `{channel:"session",sessionId}` bootstrap validates bounded header ID/file/cwd before startup and through the baseline plus hook prepublication invariants, resolves or starts one exact wrapper under shared locks, requires its identical compatible live S2 hub, and issues only the exact server-bound context; missing/conflicting/incompatible/closed targets fail without unauthorized publication, retrofit, abort, destruction, or fallback. | Route/header/resolver/start-lock/prepublication/capability tests and direct source review. | scrutiny | Ticket or publication before authorization, wrong-wrapper binding, duplicate projector/start, raw fallback, or active-run interference blocks. |
| S3-VC-003 | P0 | Gateway/security | Exact `ticketContextVersion:1`, five-field shallow-frozen authorization, and optional dispatch context preserve opaque identity only inside server memory, delete it on every terminal path, pass it only to the static handler, retain same-host/origin/admission/expiry/reuse rules, and never expose metadata in URL/response/logs. | Gateway/server adversarial tests, old-feature-marker case, identity/deletion probes, privacy scan. | scrutiny | Context leak/mutation, dynamic channel/query metadata, ticket replay/restoration, weakened origin/admission, or stale context blocks. |
| S3-VC-004 | P0 | Control/recovery | One exact resume frame and target-only ready frame select initial, empty, retained replay, or canonical recovery; application cursor advances only through frames/snapshot end except empty confirmation; one atomic attach orders ready, every returned unit, then post-return live FIFO without gap, duplicate, partial transaction, or raw event. | Parser, mid-catch-up reconnect, reentrant ordering, replay/snapshot, and real Node tests. | both | Premature cursor advance, unobservable empty resume, replay/listener gap, live overtaking catch-up, malformed acceptance, or noncanonical recovery blocks. |
| S3-VC-005 | P0 | Independent subscribers | One wrapper supports zero, one, or many independent subscribers; all healthy subscribers receive identical ordered projected frames, and socket lifecycle never controls hub capture, run ownership, or another subscriber. | Zero/multi-subscriber, reconnect, disconnect, and active-run tests. | both | Subscriber-dependent sequence/state, cross-subscriber interference, disconnect abort/destruction, or lost zero-subscriber events blocks. |
| S3-VC-006 | P0 | Backpressure/output | Each subscriber drains a separately S2-bounded catch-up source one unit at a time and admits live output through a byte-identical bounded encoder plus one callback pump under the exact 4 MiB encoded queue/in-flight bound; overflow or an unsendable frame detaches only that subscriber retryably without oversized string construction, truncation, unbounded retention, waiting, or healthy-subscriber blockage. Durable state/HTTP markers recover; overflow never claims recreation of transient one-shot effects. | Encoder exactness/early-stop tests, exact-boundary fake sockets, stalled/healthy pair, large snapshot, oversized ordinary durable/transient disposition, and source-release evidence. | scrutiny | Full oversized-string allocation, unbounded queue/source retention, projection wait, partial/drop-as-success, unrecoverable durable state, false transient-recovery claim, or shared backpressure blocks. |
| S3-VC-007 | P0 | Ownership/lifecycle/HMR | Static channel registration is HMR/gateway-safe; one wrapper destruction observer is installed before resume, destruction marks/deletes the owner and closes current subscribers once; every socket/error/send/1,000 ms fallback/10,000 ms resume race cleans once; server close releases owned sockets/admission/tickets while existing ten-minute idle, native disposal, and S6 wrapper-shutdown boundary remain unchanged. | Pre-resume destruction, registration, teardown-race, restart, wrapper-disposal, timer, server, and real-development tests. | scrutiny | Retained owner/subscriber/timer/context, duplicate close/disposal, wrapper abort on disconnect, stale registration, or S6 policy leakage blocks. |
| S3-VC-008 | P0 | HTTP/SSE compatibility | Ordinary HTTP commands/state/transcript/tree/context remain authoritative and schedulable with at least seven open session sockets; global status and raw per-session SSE route/caller remain behaviorally unchanged for S4. | Same-port Node HTTP/WebSocket integration, source inventory, full runtime/component tests. | both | HTTP starvation/regression, command-over-WebSocket scope creep, changed reconciliation, or SSE/browser mutation blocks. |
| S3-VC-009 | P0 | Privacy/diagnostics | Wire/control fields are exact; diagnostics and committed evidence are bounded and contain no ticket, session ID, epoch, path, content, provider/tool payload, socket address, context object, or rejected body. | Static scans and diagnostic-sink/adversarial tests. | scrutiny | Sensitive or attacker-controlled output blocks. |
| S3-VC-010 | P0 | Required gates/package | Typecheck, lint, focused/literal/exact-partition tests, real-loopback clients, honest real-Next disposition, current-bin injected production restart, package dry run, whitespace, checkpoint, root verification, and fresh review all pass without hidden skip or build. | Exact commands/counts, package inventory, Git inspection, review result. | scrutiny | Any non-preflight failure, missing current-bin lifecycle evidence, false fresh-inclusion claim, hidden skip, staged unrelated file, or `next build` blocks. |

This contract preserves accepted ORCH-VC-002 while changing shared gateway dispatch and implements the S3 server portions of ORCH-VC-003, ORCH-VC-004, ORCH-VC-005 (disconnect/page-independence server side only), ORCH-VC-007, ORCH-VC-008, ORCH-VC-009, ORCH-VC-010 (seven-socket Node schedulability only), ORCH-VC-011, and ORCH-VC-012. ORCH-VC-004/005 end-to-end browser convergence, registry ownership, and hidden views remain incomplete until S4A/S4B. ORCH-VC-003 remains repository-wide partial until S4B removes raw SSE. S6 retains heartbeat, 30-minute semantic idle, all-channel shutdown/ownership revalidation, and final lifecycle limits. S7 retains combined 30-socket cross-browser scale, provider/user responsiveness, and acceptance.

## Assumptions, Risks, and Blockers

- The exact post-upgrade resume frame is selected because the approved ticket body contains only channel/session authorization and the upgrade URL remains ticket-only. Adding cursor/epoch to either would weaken binding/privacy.
- The minimal ready frame is required because a valid current-cursor attach emits no projected unit. It is transport control, not a command/receipt product protocol.
- Every wrapper created after S2 has its hub before publication. Any surviving incompatible wrapper is rejected for session transport; the existing SSE/HTTP path remains untouched until normal lifecycle recreation.
- Ticket bootstrap may start a wrapper whose ticket is abandoned. That wrapper remains under the existing ten-minute idle lifecycle; S3 must not invent ticket-owned wrapper destruction, and S6 later changes semantic idle to 30 minutes.
- S2 snapshot generation synchronously constructs the complete bounded transfer source before S3 sees it; it may exceed 4 MiB after base64 expansion but contains individually bounded units. S3 must promptly copy/reference then release it one unit at a time while bounding additional encoded output; this milestone does not redesign snapshot generation without measured failure.
- A live subscriber can be closed by an unusually large ordinary frame or final snapshot backlog. Canonical durable state plus HTTP refresh markers is the required retry path; truncation is forbidden. Oversized transient notice/editor effects are intentionally not recreated after overflow under accepted S2 semantics.
- Standard close code `1013` is a best-effort retry signal. A stalled peer may not receive its close frame before the bounded terminate fallback, so S4 must also treat abnormal transport loss as reconnectable. S3 bounds observed output failure but makes no claim to detect a silent half-open connection; S6 owns ping/pong liveness.
- Existing raw per-session SSE necessarily remains until S4B; no S3 claim may report repository-wide raw-serializer removal.
- Fresh production route inclusion remains release-owned. Current plain-JS runtime and real development must pass; missing production manifests are disclosed, never built locally or represented as passing.
- If implementation reveals that the S2 attach/snapshot API cannot support bounded incremental network output without changing V1 semantics, or that safe metadata binding requires exposing session identity beyond the ticket record, stop for material divergence rather than weakening a gate.

## Implementation Handoff

No source implementation is authorized while this milestone is `Status: draft` or before its plan and matching checkpoint are committed. After root reconciliation and fresh independent draft review under the approved orchestration master, change only the status to `approved`, commit the immutable plan/checkpoint boundary, and launch one fresh `milestone-implementer` as the sole implementation-source writer for this exact milestone.
