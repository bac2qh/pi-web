# S4A: Browser Session Registry and Recovery Reducer

Status: approved

## Objective

Implement only the S4A browser session transport seam authorized by the approved [persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md), starting from accepted S3 implementation commit `2f3eb50cb8b7ef0c8eef92097b9c5a6ce0a8b614` and final checkpoint commit `43b9e0cc857f8ccd98082481a08f3ac2e72469af`.

First repair one bounded attach-seam defect discovered during S4A draft review: reentrant units buffered after replay selection must remain ordered post-target live units and must not rewrite the selected ready cursor/outcome. Then add one page-level application registry above keyed chat views, one independent browser session-WebSocket client per acquired session ID, and one pure ready/cursor/recovery state machine built around the accepted immutable S2 `SessionReceiver`. Freeze the browser-facing S3 contract before the coupled hook migration: strict same-origin bootstrap, exact resume and ready semantics, ordered projected-frame reduction, atomic snapshot recovery, sequence-addressed effects, bounded reconnect/stale-resource handling, reference-safe registry ownership, and an inert provider mount must all be independently testable without making WebSocket state a second writer of the current chat UI.

S4A runs beside the existing per-session EventSource and HTTP reconciliation path. It does not acquire a production session entry from `AppShell`, `ChatWindow`, or `useAgentSession`; does not change prompt, transcript, queue, branch, compaction, tool, extension, selection, hidden-session, unread, or reconciliation behavior; and does not remove or weaken any SSE or HTTP path. S4B alone connects registry entries to view lifetimes, acquires before prompts, retains qualifying hidden views, composes cursor-bound HTTP results, adapts hook state, and removes per-session SSE after parity.

Success means:

- exactly one `SessionRegistryProvider` is mounted at the page root above `AppShell` and its keyed `ChatWindow`, but it opens no socket until a valid session entry is acquired;
- a registry entry is keyed by exact session ID, owns one client and at most one bootstrap/socket/reconnect timer, and is shared by every active ownership handle for that ID;
- distinct acquired IDs own distinct independent sockets, while ownership labels express only `visible` versus `retained_hidden` client need and never browser/server run ownership;
- releasing the last current handle stops only that browser client and deletes the entry; stale/double releases and handles from disposed/recreated entries cannot stop a replacement;
- the client issues only exact same-origin `{ channel: "session", sessionId }` ticket POSTs, derives only page-host `ws://`/`wss://`, puts only the opaque ticket in the upgrade URL, and sends exactly one strict resume frame after open;
- `ProjectedSessionEventHub.attach()` preserves the cursor/outcome selected before reentrant diagnostic/listener publication; buffered later units follow in order but never rewrite an `empty`, exact-replay, or snapshot target;
- ready target metadata never advances application state: `empty` confirms only an exact held cursor before ordered post-target units; exact replay becomes live only after the committed receiver reaches the selected target; promised recovery snapshots remain invisible until a valid `snapshot_end` atomically commits that selected target;
- disconnect or any recoverable protocol/order/snapshot fault resumes only from the last fully committed epoch/cursor, never from ready metadata or a partial snapshot;
- projected durable state and one-shot effects are ordered, immutable, duplicate-safe, and independent of React subscription timing; snapshots recreate no effects and overflow never claims transient-effect recreation;
- unsupported protocol versions fail closed into a terminal entry state until explicit stop/start or page recreation, while retryable transport, owner, slow-consumer, malformed/order, and snapshot faults use one bounded reconnect loop without stale callback mutation;
- the current hook/EventSource and HTTP polling/reconciliation remain the sole product-state authority until S4B.

## Design / Implementation Strategy

### 0. Restore the selected ready target across reentrant attach publication

The first S4A draft review reproduced an accepted-seam defect: `ProjectedSessionEventHub.attach()` selects `empty`, exact replay, or a snapshot at cursor N, buffers a reentrant publication at N+1, and currently overwrites the returned cursor with the later hub cursor. The channel then advertises that overwritten cursor in ready. This can turn a valid `empty` into a false target and make a promised snapshot end before its advertised target.

Make one narrow nonsemantic correction under the already approved S2/S3 contract: preserve the selected `ReplayResult.cursor`, `streamEpoch`, and `outcome` when appending reentrant buffered units. The selected units still precede buffered units; the latter are ordered post-target live units. Do not drop, reorder, resequence, or reclassify any frame, change replay retention, alter the channel wire shape, or add a boundary marker.

Add exact hub and channel regressions for reentrant `empty`, `initial_snapshot`, each recovery-snapshot outcome, and retained exact replay. They must prove ready advertises the selected target, the selected transaction reaches that target, and every buffered N+1 unit follows and remains applicable as live. This bounded correction is required by the frozen S3 target-only ready semantics and is not authority to redesign accepted S2/S3.

### 1. Keep S4A parallel and inert at the product boundary

Use the literal page nesting `Suspense → GlobalStatusProvider → SessionRegistryProvider → DisplayPreferencesProvider → AppShell`. The client-only `SessionRegistryProvider` owns one long-lived registry instance per browser page and disposes it on provider unmount. Unlike global status, it does not eagerly start a transport: mounting alone creates zero session tickets and zero session sockets.

Do not modify `AppShell`, `ChatWindow`, `useAgentSession`, `SessionSidebar`, draft storage, per-session SSE, HTTP commands, session reads, transcript/context/tree APIs, polling, visibility/online reconciliation, or any optimistic state path. Add only the provider/context/controller API that S4B can consume later. Static tests must prove there is exactly one provider above `AppShell` and that no current product component acquires or consumes a registry entry.

The provider and registry are page-local. They do not multiplex across browser page instances, coordinate through storage, infer server ownership, subscribe from global running IDs, or decide which hidden sessions deserve retention. Those are not S4A product policies.

### 2. Wrap the accepted immutable receiver instead of duplicating it

Add a runtime-neutral pure session stream/recovery module around `createSessionReceiver()` and `applyProjectedSessionUnit()` from `lib/session-reducer.ts`. Keep the receiver internal so partial snapshot assembly is never exposed as product state. Publish an immutable projection containing only:

- the last fully committed `streamEpoch`, `cursor`, and `ProjectedSessionState`;
- whether the connection attempt is awaiting ready, catching up/recovering, live, idle/reconnecting, or terminal;
- the current serving `serverInstanceId` only after a strict ready frame;
- the finite ready/recovery outcome and bounded error class needed for control/debugging;
- a monotonic local snapshot revision that is not a protocol cursor.

Ready is target declaration only. The pure state machine must enforce:

- **`empty`:** accepted only when held epoch/cursor exactly equal ready epoch/cursor; it reaches live immediately without changing receiver state. Reentrant units buffered after the selected empty result are then applied as ordinary post-target live units.
- **`exact`:** accepted only for the held non-null epoch and a target cursor at or after the held cursor. Target equality may reach live immediately, although the current S3 server normally emits `empty`. Otherwise apply contiguous units until the receiver reaches the exact selected target; do not publish live authority early.
- **`initial_snapshot`:** require a snapshot whose start reason is exactly `initial`, epoch/cursor equal the selected ready target, and complete transaction atomically applies that target.
- **`overflow_snapshot`, `wrong_epoch`, `invalid_cursor`:** require a snapshot whose start reason is exactly `recovery`, epoch/cursor equal the selected ready target, and complete transaction atomically applies that target.
- A promised initial/recovery snapshot cannot be satisfied by a duplicate snapshot start, ordinary frame, `reason:"final"`, interleaving, wrong transfer, wrong epoch, malformed unit, or a snapshot ending at another cursor. Reentrant units after the selected snapshot are accepted only after that target commits and only as contiguous live units.
- Exact replay may legitimately contain a retained snapshot transaction, but its start reason must be exactly `final`, use the held stream epoch, and use the next contiguous logical sequence at the point it begins. Use receiver outcomes rather than forbidding valid retained final snapshots. Mark selected-target completion at the first exact target equality, then apply later ordered units as live.
- After live, an unpromised snapshot is accepted only when its reason is exactly `final`, its epoch equals the committed epoch, and its logical sequence is exactly `cursor + 1`; initial/recovery/new-epoch/skipped snapshots cannot replace live state merely because the lower-level receiver can parse them.
- Duplicates produce no state/effect delivery. Gap, wrong epoch, invalid input, malformed/interrupted snapshot, target skip, snapshot reason/phase mismatch, or impossible ready discards the candidate assembly/receiver and causes recoverable protocol reset from the last fully committed cursor.

A disconnect/reset must discard partial `SnapshotAssembly` while retaining the previous committed epoch/cursor/state. Add the narrowest pure helper needed to do that; do not change reducer wire/state semantics or clear transcript/runtime refresh markers.

### 3. Separate durable snapshots from sequence-addressed effects

For every receiver result:

- publish durable state/cursor only after `applied` or `snapshot_applied` (or a connection-state change);
- deliver an effect only for a newly `applied` logical frame that returns `message_completed`, `notice`, or `editor_inserted`;
- freeze each effect delivery and include its committed `streamEpoch` and sequence so S4B can deduplicate/order its own view state;
- never emit effects for duplicates, snapshot units, snapshots, ready, or rejected input;
- set the entry snapshot before effect fanout so an effect listener synchronously reading the entry sees the committed cursor/state;
- snapshot listener and effect listener fanout must snapshot listener sets, isolate throws, and remain deterministic under subscribe/unsubscribe reentrancy.

Freeze the client-facing controller contract before implementation:

```ts
type SessionClientSnapshot = Readonly<{
  connectionState: "idle" | "connecting" | "awaiting_ready" | "recovering" | "connected" | "reconnecting" | "terminal";
  serverInstanceId: string | null;
  streamEpoch: string | null;
  cursor: number;
  state: ProjectedSessionState;
  readyOutcome: SessionTransportReadyOutcome | null;
  errorClass: SessionClientErrorClass | null;
  revision: number;
}>;

type SessionEffectDelivery = Readonly<{
  streamEpoch: string;
  sequence: number;
  effect: ProjectedSessionEffect;
}>;

interface SessionClientController {
  start(): void;
  stop(): void;
  getSnapshot(): SessionClientSnapshot;
  subscribe(listener: (snapshot: SessionClientSnapshot) => void): () => void;
  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void;
}
```

`getSnapshot()` must return the same deeply frozen object identity until an observable committed state/connection/error change. `revision` increments exactly once per newly published snapshot, not per read, duplicate frame, listener, or partial snapshot chunk with no public change. `subscribe()` synchronously delivers the current snapshot once, then only new identities. `subscribeEffects()` has no historical/initial delivery. `start()` and `stop()` are idempotent. Snapshot publication precedes associated effect fanout, and all listener sets use snapshot/isolation semantics. Do not copy S1's clone-on-read `getSnapshot()` behavior because this interface is deliberately compatible with `useSyncExternalStore`.

S4A does not invent an acknowledgement, persistent effect journal, transcript store, or transient-effect reconstruction. Future S4B retained views must install their first effect consumer atomically during registry acquisition and continue using cursor-bound HTTP reconciliation/refresh markers for durable transcript/runtime recovery. Losing an oversized transient effect remains the accepted S2/S3 boundary.

### 4. Implement one strict browser session transport client

Add an injectable `SessionTransportClient` analogous in lifecycle discipline—not permissive frame handling—to `GlobalStatusClient`.

Bootstrap must:

1. validate the configured session ID with the server's exact 1–256 character, trimmed, no-C0/DEL rule;
2. POST `/api/transport/ticket` with method `POST`, exact JSON body `{ "channel": "session", "sessionId": ... }`, `Content-Type: application/json`, `X-Pi-Web-Transport: 1`, `cache: "no-store"`, `credentials: "same-origin"`, and an owned abort signal;
3. strictly accept only exact `{ ticket, expiresAt }`, with the existing opaque ticket pattern and `expiresAt` a nonnegative safe integer exactly as S1; do not compare it with browser wall-clock time because direct-LAN client/server clocks may differ and the server remains the authoritative 30-second expiry gate; reject negative, fractional, unsafe, missing, excess, or malformed values as `ticket_invalid`, and never expose or log the ticket;
4. derive only `ws://<page-host>/_pi/websocket?ticket=...` or `wss://...` from an exact `http:`/`https:` page location; never place session ID, epoch, cursor, or state in the URL;
5. own one bootstrap or one socket at a time.

On socket open, send exactly one strict V1 resume frame using `(null, null)` only when the committed receiver has no stream epoch, otherwise the exact committed epoch/cursor pair. Add/reuse a strict resume encoder if needed; do not add commands, acknowledgements, metadata, or negotiation.

Before ready, accept exactly one strict text `ready` frame and no projected frame. After ready, accept only strict projected V1 frames and no second ready. Binary/Blob/ArrayBuffer data, malformed JSON, wrong protocol, excess fields, impossible ready, unknown type, or receiver/order/snapshot failure must fail closed without state mutation or payload logging.

### 5. Freeze retry, terminal, and stale-resource behavior

Copy S1's monotonically increasing client epoch and exact resource identity discipline. A stopped/restarted/replaced entry must not be mutated by stale fetch resolution, socket open/message/error/close, or reconnect timer callbacks. `stop()` aborts the ticket request, clears the timer, closes only its browser socket, discards partial recovery, retains no ticket, and publishes `idle`; it never calls an agent command or server Stop.

Use one exponential reconnect timer: 250 ms initially, doubling to a 10,000 ms cap. Reset the delay only after a valid ready target has been fully reached (`empty` exact match, exact catch-up completion, or atomic recovery snapshot), not merely on TCP open or receipt of target metadata.

Use finite classifications only:

- ticket request/status failure: `ticket_unavailable`;
- malformed ticket response: `ticket_invalid`;
- URL/socket construction or network error: `socket_unavailable`;
- unexpected close/network loss: `transport_closed`;
- close `1012`: `owner_unavailable`;
- close `1013`: `slow_consumer`;
- malformed/wrong-protocol data: `protocol_malformed`;
- unknown frame type: `protocol_unknown_type`;
- cursor gap/target skip: `cursor_gap`;
- wrong stream epoch: `epoch_mismatch`;
- invalid/interrupted snapshot: `snapshot_invalid`;
- unsupported transport or projected version: `unsupported_protocol`.

Every class except `unsupported_protocol` is recoverable through the bounded reconnect loop from the last committed cursor. `unsupported_protocol` is terminal for that started client because blind V1 retries cannot negotiate; only explicit `stop()` then `start()`, registry entry recreation, or page reload retries it. Do not add user UI or a version-negotiation product flow.

A new `serverInstanceId` on a later valid ready does not by itself discard a cursor: S3 permits same-process restart with a retained hub/epoch. Stream epoch and strict replay/snapshot outcomes remain the state namespace. Within one socket, second ready or mixed server instance is a protocol fault.

### 6. Add a generation-safe page registry

Add `SessionRegistry` with an injectable client factory and a `Map` keyed by validated session ID. Each entry owns exactly one client, its latest immutable snapshot, registry listeners, effect listeners, and a set of opaque ownership handles.

The public primitive must use these literal shapes (type aliases may be exported from their owning module):

```ts
type SessionOwnership = "visible" | "retained_hidden";
type SessionAcquireOptions = Readonly<{
  ownership: SessionOwnership;
  onEffect?: (delivery: SessionEffectDelivery) => void;
}>;

interface SessionRegistryHandle {
  getSnapshot(): SessionClientSnapshot;
  subscribe(listener: (snapshot: SessionClientSnapshot) => void): () => void;
  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void;
  updateOwnership(ownership: SessionOwnership): void;
  release(): void;
}

interface SessionRegistryController {
  acquire(sessionId: string, options: SessionAcquireOptions): SessionRegistryHandle;
  dispose(): void;
}
```

The registry must enforce:

- ownership exactly `visible` or `retained_hidden`, used only for page-local connection need and bounded aggregate diagnostics;
- `acquire()` creates the opaque generation-bound handle, installs `options.onEffect` in that handle's effect listeners, attaches registry relays, and only then performs the 0→1 client `start()` transition;
- handle `getSnapshot()` preserves the client's stable identity; `subscribe()` synchronously delivers current once; later `subscribeEffects()` calls receive future effects only; `updateOwnership()` and `release()` are idempotent after invalidation;
- a fake client that synchronously emits an effect from `start()` must deliver it to the first handle's `onEffect`, proving no ownership-setup race without adding a journal;
- additional handles for the same ID share the same client/socket;
- distinct IDs own independent clients/sockets;
- releasing or relabeling one handle cannot affect another;
- 1→0 unsubscribes relays, stops the client, deletes the entry, and invalidates that entry generation;
- stale/double release or update after release/dispose is a no-op and cannot close a newly recreated entry for the same ID;
- registry `dispose()` invalidates every handle and stops every current client once.

Acquiring a new visible handle before releasing/relabeling an old one must be supported, but S4A does not wire selection and does not choose hidden-retention qualification or duration. Running IDs, sidebar state, browser page identity, prompt origin, and server ownership never create entries.

### 7. Mount an inert React provider for S4B

Add `SessionRegistryProvider` with one `useRef`-owned registry, dependency injection for tests, context access to the registry controller, and unmount disposal. It must not mirror all entry snapshots into provider React state, eagerly acquire anything, or add a global rerender source. Future consumers subscribe to individual handles/entries, compatible with `useSyncExternalStore` semantics.

Mount exactly one provider in `app/page.tsx` above `AppShell`. Preserve the existing global-status and display-preference providers. Add static/component-source tests proving provider cardinality/order, disposal, no eager start, and absence of registry use in `AppShell`, `ChatWindow`, `useAgentSession`, and `SessionSidebar`.

### 8. Preserve S4B and later milestone authority

S4A must not:

- modify `useAgentSession`, `ChatWindow`, `AppShell`, `SessionSidebar`, drafts, URL/selection state, unread state, completion sound, or branch/fork/clone behavior;
- acquire a production session entry, connect before prompts, retain an actual hidden view, or adapt registry snapshots/effects into rendered messages;
- remove/change `app/api/agent/[id]/events/route.ts` or its `EventSource` caller;
- delete polling, `GET /api/agent/[id]`, 15-second/visibility/online reconciliation, or HTTP transcript/context/tree/state authority;
- add cursor parameters or acknowledgements to HTTP, clear refresh markers optimistically, or claim race-free HTTP composition;
- change S3 server channel/ticket/close/backpressure semantics beyond §0's exact selected-cursor preservation, add commands over WebSocket, or put metadata outside server ticket context;
- add file watch, heartbeat, 30-minute semantic idle, shutdown grace, dependencies, TLS/port changes, Pi-monorepo work, private Next cleanup, build output, or release deployment.

If browser integration requires a new server protocol, user-facing version/retry choice, durable transient-effect journal, hidden-retention product policy, or partial hook dual-writer, stop for root divergence review rather than weakening this boundary.

### Scope estimate

- **Expected production surfaces:** exact new modules `lib/session-stream-state.ts`, `lib/session-transport-client.ts`, `lib/session-registry.ts`, and `components/SessionRegistryProvider.tsx`; one inert provider mount in `app/page.tsx`; §0's narrow selected-cursor correction in `lib/session-event-hub.ts`; and only a narrowly necessary resume encoder or receiver-assembly reset helper in accepted protocol/reducer modules.
- **Expected tests:** exact new files `lib/session-stream-state.test.mjs`, `lib/session-transport-client.test.mjs`, `lib/session-registry.test.mjs`, and `components/SessionRegistryProvider.test.mjs`; focused updates to hub/channel tests for §0; plus accepted transport-protocol/reducer/global-client/provider regressions.
- **Explicitly excluded:** all current chat/hook/sidebar product integration, real hidden-view policy, SSE removal, HTTP race composition, file watch, heartbeat/idle/final shutdown, dependencies, Pi source, build/release artifacts.
- **Complexity:** large but independently testable. Highest risk is treating ready target as committed state or letting effect/registry ownership become a partial hook rewrite.
- **Context target:** zero compactions expected; one maximum.
- **Stop condition:** need for any new wire command/version, server change beyond §0 and a literal resume encoder, user-facing retry policy, unbounded effect retention, AppShell/hook state adaptation, or later-milestone lifecycle behavior.

## Reference Files

Selected governing and implementation evidence actually used for this milestone:

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Accepted S1 plan](./2026-07-31-s1-global-running-websocket.md) and [checkpoint](../checkpoints/2026-07-31-s1-global-running-websocket-checkpoints.md)
- Accepted S1 implementation/finality `f0fc1ac` and `dbe3a52`
- [Accepted S2 plan](./2026-08-01-s2-projected-session-protocol-hub.md) and [checkpoint](../checkpoints/2026-08-01-s2-projected-session-protocol-hub-checkpoints.md)
- Accepted S2 implementation/finality `39f22f0` and `26ec788`
- [Accepted S3 plan](./2026-08-02-s3-secure-session-websocket.md) and [checkpoint](../checkpoints/2026-08-02-s3-secure-session-websocket-checkpoints.md)
- Accepted S3 implementation/finality `2f3eb50` and `43b9e0c`
- [Project memory index](../memory/MEMORY.md), [custom-server lifecycle memory](../memory/custom-server-lifecycle.md), and [hosted implementation memory](../memory/hosted-implementation-sessions.md)
- [Repository instructions](../../AGENTS.md)
- `app/page.tsx`
- `components/GlobalStatusProvider.tsx` and its tests
- `lib/global-status-client.ts` and its tests
- `lib/session-transport-protocol.ts`
- `lib/session-protocol.ts`
- `lib/session-reducer.ts`
- `lib/session-event-hub.ts`
- `lib/session-channel.ts`
- `app/api/transport/ticket/route.ts`
- `components/AppShell.tsx`, `components/ChatWindow.tsx`, and `hooks/useAgentSession.ts` as unchanged boundary evidence
- `app/api/agent/[id]/events/route.ts` as unchanged compatibility evidence
- Recoverable read-only S4A context batch `b4ac57b6`, scout children 0 and 1, with outputs under `.pi-subagents/artifacts/outputs/b4ac57b6/`
- Recoverable initial S4A draft review `0fcce0fd-3744-474c-84cb-c9daea0296a9`, whose reentrant attach probes required §0 and the corrected recovery/API/test contract

No advisory reference-pointer companion exists for the master. The sibling Pi monorepo is not required and remains untouched.

## Test Strategy

### Pure recovery and receiver composition

Require table-driven tests for:

- hub/channel reentrant `empty`, initial snapshot, every recovery-snapshot outcome, and exact replay, proving selected ready cursor/outcome preservation and ordered post-target buffered units;
- all six ready outcomes, exact held-cursor validation, ready target non-commit, and target reach before live;
- exact replay through ordinary frames and retained `reason:"final"` snapshot transactions;
- initial snapshots requiring `reason:"initial"`; overflow/wrong-epoch/invalid-cursor snapshots requiring `reason:"recovery"`; old state visible until exact valid end;
- post-target/live snapshots accepting only same-epoch, next-sequence `reason:"final"`, with unpromised initial/recovery/new-epoch/skipped snapshots rejected;
- disconnect after ready and at every snapshot phase, with resume from only the previous committed pair;
- duplicate logical/snapshot units, gaps, target skip, wrong epoch, unknown type/version, malformed JSON/shapes, excess fields, binary data, and impossible second ready;
- snapshot transfer ID/order/count/length/base64/epoch/end failures, no partial state leak, and successful atomic equality;
- live final snapshots, state immutability, transcript/runtime refresh markers, and no acknowledgement/marker clearing;
- effect delivery exactly once by sequence after state commit, none for duplicates/snapshots, and explicit transient overflow nonrecreation.

### Injectable client lifecycle

Require fake fetch/WebSocket/clock tests for:

- exact ticket request/body/headers/cache/credentials/signal and strict ticket response, including nonnegative safe-integer expiry acceptance without browser-clock comparison plus negative/fractional/unsafe/missing/excess/malformed rejection;
- page-derived HTTP/HTTPS/IPv6 socket URL containing only ticket metadata;
- one resume send after open using null or committed cursor pair;
- one bootstrap/socket/timer, bounded 250/500/.../10,000 backoff, reset only at completed ready target;
- retry mappings for fetch/network/abnormal close/1012/1013 and protocol/order/snapshot faults;
- terminal unsupported version until explicit stop/start;
- stale fetch/socket/message/error/close/timer suppression across stop/start and replacement;
- server-instance replacement with same epoch, epoch-changing snapshot recovery, and no page-owned run control;
- listener throw/reentrancy isolation, immutable snapshots/effects, and content-safe diagnostics.

### Registry and provider

Require deterministic tests for:

- same ID with multiple visible/hidden handles sharing one client; N IDs producing N independent clients;
- ownership relabel, acquire-before-release, hidden handle retaining a client after visible release, and last-release stop/delete;
- stale/double release/update after deletion/recreation and registry disposal;
- client snapshot/effect relay ordering, stable frozen `getSnapshot()` identity between revisions, synchronous initial snapshot subscription, future-only effect subscription, and registry cleanup;
- atomic first-handle `onEffect` registration before a fake client's synchronous `start()` effect;
- zero acquisitions after provider mount, one literal `GlobalStatusProvider → SessionRegistryProvider → DisplayPreferencesProvider → AppShell` nesting, provider above keyed chat lifetime, and exact unmount disposal;
- aggregate visible/hidden/entry count classes without IDs;
- static proof that AppShell/ChatWindow/hook/sidebar/SSE/polling/reconciliation callers are unchanged and no current product acquisition exists.

### Required commands and evidence

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/session-stream-state.test.mjs lib/session-transport-client.test.mjs lib/session-registry.test.mjs components/SessionRegistryProvider.test.mjs lib/session-transport-protocol.test.mjs lib/session-reducer.test.mjs lib/session-event-hub.test.mjs lib/session-channel.test.mjs lib/global-status-client.test.mjs components/GlobalStatusProvider.test.mjs
node --test lib/*.test.mjs components/*.test.mjs
node --test $(find lib components -maxdepth 1 -name '*.test.mjs' ! -name 'pi-web-real-next.test.mjs' -print | sort)
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Use the exact focused filenames above. Do not run `next build`. Literal and exact non-real-Next commands are both required; run real-Next separately without overlap. With absent release manifests, only the named production child and parent may fail at `.next/BUILD_ID`; terminal and real development must pass. Package dry run remains shape-only and cannot prove fresh TypeScript/App Router inclusion.

Before acceptance, the root must inspect the complete actual diff and source boundary, reproduce ready-target/snapshot/stale-resource/registry ownership cases, verify current hook/SSE/HTTP reconciliation sources are unchanged, run privacy/raw diagnostics scans, obtain one fresh independent no-edit/no-delegation implementation review, and commit only the coherent accepted S4A boundary.

## Telemetry / Debuggability

Provide only optional bounded development/test diagnostics with finite fields:

- client stage: bootstrap, socket, ready, catch-up, live, reconnect, terminal, stop;
- finite outcome/error class from the closed vocabulary above;
- ready/recovery class without server instance, epoch, cursor, or session identity;
- registry entry and ownership count class (`zero`, `one`, `many`) plus ownership kind, never IDs;
- stale-resource suppression and listener-error class without raw errors;
- effect type class and delivery count class, never effect content.

Never log or diagnose tickets, session IDs, server-instance IDs, epochs, cursors, paths, request/response bodies, message/prompt/queue/extension content, model/provider/tool data, socket addresses, credentials, raw close reasons, or `Error` strings. Product snapshots may carry the opaque server instance and committed epoch/cursor required for recovery; diagnostics may not. No user-facing telemetry or persistent log is authorized.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|
| S4A-VC-001 | P0 | Orchestration/scope | One immutable S4A plan, one source writer, verified handoff, fresh independent review, coherent boundary commit; only §0's selected-cursor correction plus pure browser client/registry/provider seams enter the diff and S4B/S5/S6 behavior remains absent. | Plan/checkpoint, run identities, Git diff/history/status, source inventory. | scrutiny | Wider S2/S3 redesign, hook/UI dual writer, SSE change, hidden-policy choice, overlapping writer, or later-scope source blocks immediately. |
| S4A-VC-002 | P0 | Ready/recovery correctness | Reentrant attach preserves the selected ready cursor/outcome and orders later units post-target; ready metadata never commits state; empty confirms exact held state; exact replay reaches target contiguously; initial/recovery/final snapshot reason/epoch/sequence matrices are enforced; disconnect resumes the previous committed pair; live cannot overtake recovery. | Hub/channel reentrant probes, pure ready/receiver tables, interrupted recovery, reason/phase rejection, final equality. | scrutiny | Rewritten target, premature commit, wrong snapshot reason/phase, partial visibility, skipped/gapped target, wrong resume cursor, or live overtaking blocks. |
| S4A-VC-003 | P0 | Browser protocol/security | One strict same-origin ticket request with exact nonnegative safe expiry parsing and page-derived ticket-only socket send one strict resume; exact ready/projected parsing rejects binary/malformed/excess/unknown/version faults without metadata leakage or commands. | Fake fetch/WebSocket adversarial tests and source review. | scrutiny | Browser-clock expiry policy, ID/cursor in URL, ticket exposure, permissive frame acceptance, second resume/ready, command channel, or trust-boundary leak blocks. |
| S4A-VC-004 | P0 | Registry topology/ownership | One acquired session entry owns exactly one client/socket; same-ID owners share, distinct IDs isolate, visible/retained-hidden labels only retain client need, last release stops/deletes, and stale handles/disposal cannot affect replacements or server runs. | Registry reference/generation tests, N-entry inventory, cleanup counters. | both | Duplicate socket, cross-entry mutation, stale release, inferred run ownership, or leaked client blocks. |
| S4A-VC-005 | P0 | State/effects | Public snapshots are deeply frozen and identity-stable between revisions; durable state is cursor-ordered; first ownership installs its effect callback before client start; effects deliver once by sequence only after snapshot commit, never for duplicate/snapshot/rejection, and no journal/false transient recovery is introduced. | Stable-identity/subscription tests, synchronous-start effect probe, reducer/effect/reentrancy/immutability tests. | scrutiny | Clone-on-read snapshot, ownership setup loss, duplicate/lost ordered delivery to an attached owner, effect-before-commit, unbounded retention, or recreated transient claim blocks. |
| S4A-VC-006 | P0 | Reconnect/stale resources | One bounded 250 ms–10 s reconnect loop resumes the committed cursor; target completion alone resets delay; stale fetch/socket/timer callbacks cannot publish; 1012/1013 and recoverable faults retry; unsupported versions terminate until explicit restart. | Fake clock/resource identity tests and finite state/error assertions. | scrutiny | Parallel resources/timers, ready-only reset, stale mutation, retry storm, or unsupported-version loop blocks. |
| S4A-VC-007 | P0 | Provider/S4B boundary | Exactly one inert provider uses the literal `GlobalStatusProvider → SessionRegistryProvider → DisplayPreferencesProvider → AppShell` nesting above keyed chat; mount opens no sockets; current hook/EventSource, HTTP commands/state/transcript/tree/context, polling/reconciliation, selection, drafts, and rendering remain unchanged and authoritative. | Provider/source-boundary tests and direct diff inspection. | both | Wrong/eager provider topology, production acquisition, current product behavior change, removed fallback, or partial hook adaptation blocks. |
| S4A-VC-008 | P0 | Privacy/diagnostics | Diagnostics use only finite stage/reason/type/count classes and contain no ticket, ID, instance, epoch, cursor, path, content, payload, address, credential, or raw error. | Diagnostic sink tests and static privacy scans. | scrutiny | Sensitive or attacker-controlled diagnostic output blocks. |
| S4A-VC-009 | P0 | Compatibility/gates | Typecheck, lint, focused recovery/client/registry/provider tests, exact non-real-Next and literal suites, isolated real-Next disposition, package dry run, whitespace, immutable-plan, and no-stage gates pass without build or hidden skip. | Exact commands/counts, package inventory, Git inspection. | scrutiny | Any non-preflight failure, real-development regression, false production claim, hidden skip, or build blocks. |
| S4A-VC-010 | P0 | Handoff/finality | Every S4A obligation, test result, residual S4B boundary, review disposition, commit, and departure is recoverable in the ordinary checkpoint; no automatic cleanup/archive occurs. | Handoff and Implementation Summary entries, commit IDs, branch/worktree status. | scrutiny | Unsupported acceptance, missing evidence, or incomplete disposition blocks progression. |

This milestone advances the browser portions of ORCH-VC-003/004/005/008/011/012 but leaves product rendering, hidden-view retention policy, per-session SSE removal, HTTP convergence, and browser acceptance explicitly incomplete until S4B. ORCH-VC-010 browser scale remains S7.

## Assumptions, Risks, and Blockers

- The selected S3 ready target is not an acknowledgement. §0 preserves it across reentrant buffered publication; a disconnect before target completion resumes from the receiver's older committed cursor.
- Reentrant buffered units may follow `empty` or a selected snapshot as post-target live output; they never redefine the ready target.
- Exact replay can contain a retained `reason:"final"` snapshot; forbidding all snapshots under `exact` would reject valid S2/S3 output, while accepting unpromised initial/recovery/live-epoch snapshots would be unsafe.
- `SessionReceiver` preserves old committed state/cursor during snapshot assembly, but S4A must discard an interrupted assembly before a new exact/live attempt.
- Browser WebSocket events may deliver non-string data despite server intent; fail closed rather than coercing it.
- Unsupported-version terminal behavior is a contained fail-closed transport rule, not a user-facing product decision or negotiation feature.
- New sessions have no stable ID until the existing HTTP creation path materializes one; S4B owns promotion and connect-before-prompt composition.
- The current UI has one keyed chat view. S4A exposes visible/retained-hidden ownership primitives but does not decide qualification, duration, or selection transitions.
- The first effect consumer is installed atomically by `acquire(..., { onEffect })` before 0→1 client start. S4A adds no persistent effect journal; HTTP refresh markers/reconciliation remain the durable recovery path.
- Ticket `expiresAt` is shape-checked as a nonnegative safe integer but not compared to browser time because direct-LAN clocks may differ; server consumption remains authoritative.
- Fresh production inclusion remains release-owned under the build prohibition.
- If the existing receiver cannot support interruption/reset without changing V1 semantics, or a race-free S4B handoff requires a new server acknowledgement/HTTP protocol, stop rather than weakening S4A.

## Implementation Handoff

No implementation is authorized while this milestone is `Status: draft` or before its plan and matching checkpoint are committed. After root reconciliation and fresh independent draft review, change only `Status: draft` to `Status: approved`, commit the immutable plan/checkpoint boundary, record its blob, and launch one fresh sole `milestone-implementer` with S4A-VC-001 through S4A-VC-010, the exact source boundary, required tests, special handoff contract, preservation rules, and stop conditions.
