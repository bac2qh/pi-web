# S2: Projected Session Protocol and Wrapper-Owned Hub

Status: approved

## Objective

Implement only the S2 server-protocol boundary authorized by the approved [persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md), starting from accepted S1 implementation commit `f0fc1ac7296065dfca0aeb0038e2b6e2ed04837a` and final checkpoint commit `dbe3a52f925dac808d87750e188d1b7095e9afb1`.

Replace no browser transport in this milestone. Instead, introduce the transport-neutral V1 projected session protocol, exhaustive raw-event projector, pure canonical reducer, and one wrapper-owned event hub that sequences and reduces every live wrapper independently of subscribers. The hub must retain bounded replay, produce canonical initial/recovery/final snapshots, and expose only projected protocol frames for S3. Existing HTTP transcript/runtime reconciliation and the per-session SSE route/caller remain authoritative compatibility paths until S4B.

Success means:

- one strict, versioned, discriminated projected-session protocol represents every native or Pi-Web wrapper event currently consumed by the browser, while every other known installed-SDK event is explicitly classified and omitted or reduced without raw pass-through;
- routine assistant streaming uses only provider-supplied text, thinking, and tool-call argument deltas, not the outer growing `message_update.message`, `assistantMessageEvent.partial`, or another repeated snapshot;
- `agent_end.messages`, raw tool execution arguments/results/partial results, extension paths, provider-only payloads, and unused SDK fields cannot enter the projected encoder or hub replay;
- one normalized completed message may cross at `message_end`; complete synthetic delta streams must materialize the same delta-comparable content subset, a real pre-final mismatch is classified without raw fallback, and the post-completion reducer effect must always equal the full normalized final message exactly;
- every wrapper owns exactly one monotonic stream epoch, sequencer, canonical reduced live state, and dual-bounded replay hub from construction through destruction, regardless of zero, one, or many subscribers;
- replay is contiguous when retained, overflow or invalid cursors recover through a canonical snapshot transfer made of bounded frames, and initial/recovery snapshots plus explicit transcript/runtime refresh requirements preserve the existing HTTP authority without retaining an unbounded transcript in memory;
- S2 dispositions only the projected-protocol portion of ORCH-VC-003; the preserved legacy raw per-session SSE serializer remains an explicit deferred incompatibility until S4B and cannot be reported as a full master-row pass;
- finality follows wrapper-owned settlement after native retry/follow-up work and wrapper prompt/compaction claims are released, not an intermediate retrying `agent_end`;
- pending extension dialogs/custom UI, statuses, widgets, title state, transient notices/editor actions, queue, retry, compaction, streaming draft, active tools, and lifecycle state have explicit durable-versus-ephemeral recovery semantics;
- wrapper destruction closes the hub and observers exactly once without changing native disposal, semantic idle duration, running projection, hosted ownership, or M0/S1 process lifecycle;
- focused projector/parser/reducer/hub/wrapper fixtures, final-equality checks, and long Unicode stream measurements prove correctness, bounded replay, raw-field exclusion, and approximately linear projected encoded-byte growth;
- no S3 ticket/channel/WebSocket, S4 browser registry/hook migration, S5 file watch, or S6 heartbeat/output/idle/shutdown work enters the diff.

## Design / Implementation Strategy

### 1. Freeze the S2 boundary and protocol authority

Introduce one V1 protocol named for Pi Web projected session events. Keep protocol and reducer code runtime-neutral so S3 can serialize it and S4A can consume the same parser/recovery semantics without redesign.

Use an opaque per-hub stream epoch that is generated independently of the native session ID and is never logged. Every protocol envelope must carry:

- an exact protocol constant and version `1`;
- the opaque stream epoch;
- a discriminant;
- a nonnegative safe-integer sequence/cursor;
- only the exact fields authorized for that discriminant.

Unknown protocol versions, unknown discriminants, malformed nested content, unsafe sequence values, excess envelope/frame fields, and non-JSON-safe projected values fail closed without mutating reduced state. Parsing returns a finite reason class such as malformed, unsupported version, or unknown type; it never returns or logs the rejected payload.

The retained per-session SSE route still serializes legacy raw wrapper events for the current browser. That compatibility serializer is intentionally removed only in S4B after the S3/S4 transport is operational. S2's hard serializer boundary is that the new projected protocol encoder and hub API accept/expose projected frames only; no S3 caller can retrieve a raw SDK event from the new capability.

This is an explicit staged incompatibility, not a claim that the repository has already satisfied the master's global raw-serializer prohibition. S2 may pass S2-VC-002 for the new projection seam, but ORCH-VC-003 remains partially dispositioned until S4B deletes the legacy serializer/caller. Every S2 checkpoint summary and review must preserve that distinction.

### 2. Define the exact projected frame and snapshot union

Use minimal frames in these semantic classes; exact implementation names may differ only if the same exhaustive semantics and strict shapes remain obvious:

- lifecycle: run/activity started, native attempt ended with only `willRetry`, wrapper-owned run settled, and final canonical snapshot;
- assistant streaming: message started with only normalized display metadata, content block started, text/thinking/tool-argument delta, content block finished, and normalized message completed;
- active tool execution: add `{toolCallId, toolName}` and remove by `toolCallId` only;
- replacement state: queue, retry start/finish, compaction start/finish, and transcript revision/change marker;
- extension durable state: dialog open/close, custom UI replace/close, keyed status set/clear, keyed widget set/clear, and latest title;
- extension/transient effects: notification, public prompt/extension error notice, and editor insertion;
- canonical snapshot: initial, recovery, or final reason plus the complete projected live state and explicit HTTP transcript/runtime refresh requirements.

Normalize completed messages into exact Pi-Web display schemas rather than copying SDK objects:

- preserve only the user, assistant, tool-result, and custom message fields currently needed for rendering and reconciliation;
- explicitly classify installed `bashExecution`, `branchSummary`, and `compactionSummary` roles as transcript/runtime-refresh-only inputs: emit no completed-message payload for them and never project their command, output, summary, source entry ID, token metadata, or full-output path;
- normalize tool calls to `{toolCallId, toolName, input}` and omit provider-only tool metadata;
- retain display content, model/provider labels, usage, stop/error state, timestamps, and JSON-safe tool/custom details only where current Pi Web rendering uses them;
- reject or omit unknown/non-JSON-safe fields rather than widening the protocol;
- never serialize the outer growing update message, provider `partial`, full `agent_end.messages`, tool execution args/result/partialResult, compaction summary/details, extension filesystem path, or unrelated SDK state.

A content-block end frame must not resend the accumulated text/thinking value. Tool-call end may carry one normalized final tool-call block so fragmented arguments can reconcile to parsed input. The single normalized `message_completed` frame is the only routine final message copy.

Treat one canonical snapshot as a logical protocol frame but encode its state as an exact snapshot-transfer transaction: start metadata, ordered bounded data chunks, and an end marker. Canonically serialize the already validated projected state to UTF-8 JSON, split it into base64url transfer chunks whose individually encoded protocol frames are no larger than 64 KiB by default (with injectable limits), and validate transaction identity, reason, sequence, part order/count, declared UTF-8 byte length, and the reassembled exact state shape before atomic reduction. Transfer metadata and chunks may carry no raw event or unvalidated state. This fragmentation is part of V1 so S3 can stream a snapshot while respecting its output buffer; it does not add a second transport or subscriber-dependent sequence.

### 3. Keep canonical state bounded to live event-delivery semantics

The pure projected state must contain current live semantics, not a duplicate transcript:

- active/settled lifecycle and current phase inputs;
- current in-progress assistant message/block assembly;
- active tool executions;
- steering and follow-up queues;
- retry state;
- compaction active/result/error state using only displayed reason, abort/error, and token-count fields;
- pending extension dialogs and custom UI;
- keyed extension statuses/widgets and latest title;
- an opaque monotonic transcript revision/change marker;
- transcript/runtime refresh-required markers used by initial, overflow-recovery, and final snapshots.

Completed historical messages and entry IDs remain authoritative in the existing HTTP session/context APIs. Model selection, active-tool configuration, context usage, system prompt, and other currently HTTP-only runtime configuration also remain authoritative in `get_state`/ordinary commands in S2. A snapshot therefore atomically recovers the entire projected live state and emits exact transcript/runtime refresh requirements where needed. This is the bounded server-side recovery marker; it must not retain an ever-growing transcript or pretend that runtime-only state can repair message entry IDs.

S2 does not claim that a marker alone composes race-free HTTP responses with later sequenced frames. Current HTTP responses have no hub epoch/cursor handshake. S4A/S4B must bind request generations to registry cursors, reject stale HTTP completions, and prove end-to-end message/entry-ID/runtime convergence. S2 proves only that every initial/recovery/final snapshot carries the exact refresh requirement and cursor needed by that later composition while preserving today's HTTP reconciliation unchanged.

Durable extension state appears in snapshots. Notification/error notices and editor insertion are sequenced effects but not snapshot state; replay may deliver an unseen retained effect, while overflow recovery must not recreate stale one-shot effects. Tests must make this distinction explicit.

### 4. Project installed native and wrapper events exhaustively

Create a typed projection-input union around the installed `AgentSessionEvent` plus Pi-Web wrapper-only events and the currently accepted legacy compaction aliases. Use a compiler-exhaustive switch for known events and a fail-closed runtime fallback for a future unknown event.

Required mappings are:

- `agent_start`: establish active run state only if not already established by a wrapper claim;
- `agent_end`: emit only an attempt boundary with `willRetry`; never serialize `messages` and never emit final state solely from this event;
- `agent_settled`: record the native boundary but wait for wrapper-owned settlement if prompt/compaction claims or public wrapper events remain;
- assistant `message_start`/`message_update`: derive the draft only from normalized outer start metadata and exhaustively classify every nested `assistantMessageEvent` discriminant; text/thinking/tool-call start/delta/end variants may emit the corresponding minimal frame, while provider `start.partial` is ignored;
- nested `done` and `error`: emit only a minimal assistant-terminal marker carrying the bounded terminal-reason enum, await outer `message_end` for authoritative completion, and forbid the complete `message`/`error` object from projection, replay, diagnostics, or mismatch repair;
- `message_end`: emit one normalized completed message, clear/reconcile the draft, and mark transcript reconciliation for user/assistant/tool-result/custom roles; classify installed bash-execution/branch-summary/compaction-summary roles as refresh-only and omit every nested sensitive field;
- `tool_execution_start`/`end`: update the minimal active-tool set; `tool_execution_update` is an explicit no-op and its raw payload is forbidden;
- `queue_update`: exact replacement of steering/follow-up strings;
- auto retry: minimal attempt/maximum/public-error replacement and clear/end state; retrying `agent_end` remains non-final;
- current and legacy compaction start/end: normalize to one reduced shape, omitting summaries/details and retaining only currently displayed reason, abort/error, and token counts;
- `entry_appended`: advance an opaque transcript-change marker without serializing the entry;
- `turn_start`, `turn_end`, `session_info_changed`, `thinking_level_changed`, summarization retry events, and `bash_execution_update`: explicitly classify as omitted or runtime-refresh-only unless a currently consumed state requires a minimal frame; no raw fallback is allowed;
- `prompt_error` and `extension_error`: public transient notices only, omitting extension path/event/provider payload fields;
- `prompt_done`: legacy compatibility input only; authoritative projected finality comes from an explicit wrapper-owned settled input after all public error/done delivery and claim release;
- `extension_ui_request`: exact method-specific projection for dialog, notification, status, widget, title, editor text, and custom UI behavior.

The projector may emit zero or several frame drafts for one input. The hub assigns consecutive sequences after projection and folds each draft through the same reducer used by tests/future clients.

### 5. Make final equality and settlement explicit

For assistant streams, independently materialize text, thinking, and tool-call blocks from true deltas. At `message_end`:

1. normalize the final Pi-Web assistant message;
2. derive the exact delta-comparable subset from it: ordered text, thinking, and tool-call blocks plus their content indices and normalized final tool inputs;
3. compare only that subset with the pre-final materialized draft and emit an equality/mismatch diagnostic class; exclude non-delta image blocks, model/provider labels, usage, stop/error metadata, timestamps, and every other field unavailable from content deltas;
4. require complete synthetic success, tool, retry, error, abort, and empty/interleaved-block fixtures to compare equal for the delta-comparable subset before finalization;
5. permit a real provider's missing terminal delta to compare unequal, but never repair it with nested `done.message`, `error.error`, the outer growing snapshot, or another raw provider object;
6. apply the single outer-`message_end` normalized final message as authoritative and require the post-`message_completed` reducer effect to deep-equal that full normalized message exactly;
7. clear live draft state and require HTTP transcript reconciliation at final recovery so persisted messages and entry IDs become authoritative.

Thus “final equality” means exact full-message equality after `message_completed`. Pre-final equality is deliberately limited to delta-addressable content, is a stronger fixture invariant for complete streams, and is only a bounded runtime diagnostic when a provider omits a terminal delta.

Final protocol settlement occurs only from a wrapper-owned settled input after:

- the claimed activity has reached its terminal wrapper path: a native prompt promise, if one was created, resolved or failed after `agent_settled`; otherwise extension binding, synchronous prompt invocation, hosted pre-dispatch binding, or hosted pre-dispatch cancellation terminated before native dispatch;
- the wrapper has released the corresponding prompt claim exactly once;
- any public `prompt_error`/legacy `prompt_done` events that path emits have already been projected/fanned out;
- no overlapping prompt or compaction claim remains.

Every last-claim release path must issue the authoritative projection-only settled input. This includes ordinary extension-binding rejection, synchronous `inner.prompt` invocation failure, hosted binding failure, hosted pre-dispatch cancellation, normally dispatched success/failure, and streaming-behavior prompts that omit legacy `prompt_done`. Wrapper destruction is different: it closes the hub/observers without inventing a final snapshot. Tests must exercise each path and prove no active projected lifecycle remains.

A standalone manual compaction has the same authoritative wrapper settlement rule even though it emits no `prompt_done`: after its native compact promise succeeds, errors, or aborts and the wrapper releases the final compaction claim, emit exactly one settled boundary and final snapshot if no prompt claim remains. Auto-compaction inside a prompt remains covered by the enclosing prompt settlement. Tests must cover standalone success, error, abort, and prompt/compaction overlap.

The final transition emits a sequenced settled frame followed by one logically sequenced final snapshot of the already-reduced state. Its bounded transfer units share that logical sequence and apply atomically only at the end marker. The logical snapshot is produced even with zero subscribers and is replayable as one whole group subject to the same bounds. Intermediate `agent_end`, including `willRetry: true`, must never emit a final snapshot. Overlapping accepted prompts or compactions produce no false idle/final boundary when only one claim settles.

Initial and overflow-recovery snapshots carry the hub's current cursor but do not advance it because subscriber attachment cannot affect sequence. A final snapshot is event-driven, advances sequence once, and is replayable; this prevents a disconnect between settlement and snapshot from losing the final boundary.

### 6. Implement one gap-free, dual-bounded wrapper hub

Each hub must provide transport-neutral synchronous APIs for:

- current canonical initial/recovery snapshot as a bounded-frame transfer transaction;
- strict snapshot transfer assembly/validation for the future client seam;
- replay after a stream epoch and cursor;
- one atomic attach/resume operation that cannot miss a logical frame between replay/snapshot selection and listener registration;
- listener removal;
- current replay occupancy for bounded diagnostics/tests;
- exact-once close.

Sequence starts deterministically, advances once per event-driven logical projected frame, and is independent of subscriber count. Snapshot start/chunk/end units share the snapshot's one logical sequence. Initial/recovery snapshots use the current cursor without advancing it; event-driven final snapshots advance it once. Replay uses a deque of whole logical-frame groups bounded by both UTF-8 encoded wire bytes and encoded protocol-unit count; every snapshot start/chunk/end unit counts toward the frame bound even though the group is retained or evicted atomically. Use the already-approved eventual system values—4 MiB and 8,192 encoded protocol units—as S2 defaults with injectable smaller limits for deterministic tests; S6 still owns whole-system revalidation, per-subscriber buffered output, heartbeat, and slow-consumer policy.

Evict only complete logical frames or complete snapshot-transfer groups. If an ordinary logical frame exceeds replay capacity, notify already attached in-memory listeners without retaining it, advance the replay floor, and require snapshot recovery for any cursor that could have missed it. If an event-driven final snapshot exceeds replay capacity, do not retain a partial transaction: stream its individually bounded units to currently attached listeners, retain the canonical reduced state, advance the replay floor through that final snapshot's logical sequence, invalidate older suffixes that cannot cross the missing logical frame, and generate a fresh bounded-unit snapshot transaction for later recovery. A client that fully received the oversized final snapshot may resume from its sequence; a cursor immediately before it must receive a fresh recovery snapshot. Subscriber-generated initial/recovery transactions never enter replay, never advance global sequence or replay floor, and do not change another subscriber's replay eligibility even when their canonical state exceeds replay capacity. In both cases, bounded units make oversized queue, streaming, dialog, widget, or custom-UI state representable without truncation and let S3 send chunks incrementally under its output bound.

A valid retained cursor returns the exact contiguous logical suffix. Stale, future, wrong-epoch, or evicted cursors return a fresh canonical recovery transaction and finite outcome class. Snapshot generation must clone/freeze state so callers cannot mutate the hub. A receiver advances its cursor and replaces state only after exact ordered reassembly, declared-byte validation, strict projected-state parsing, and the end marker; an interrupted transaction leaves its prior state/cursor intact and reconnects from that cursor.

Listener exceptions are isolated and cannot interrupt native event projection or another listener. S2 does not perform network I/O or implement buffered-byte backpressure; S3 listeners must enqueue bounded transfer units incrementally, and S3/S6 own retryable slow-consumer closure.

### 7. Attach the capability before publication and preserve HMR/lifecycle

Construct and attach one versioned `Symbol.for(...)` capability to every new `AgentSessionWrapper` before `start()` subscribes to native Pi and before registry publication. Follow S1's compatible-record discipline:

- the capability identifies Pi Web ownership and exact protocol/version;
- compatible existing wrapper-owned hubs survive module hot reload as part of the wrapper object;
- missing, foreign, or incompatible capabilities fail closed for future S3 access and never cause a second projector to attach to the same wrapper;
- a pre-S2 wrapper cannot pretend to replay events it never captured; later S3 must recreate or reject it explicitly rather than backfilling a partial hub.

Feed every native event into the hub before the legacy `onEvent()` fanout. Feed every wrapper-generated event through the same projection seam. Add projection-only lifecycle/state inputs where legacy browser events would be incorrect, including wrapper activity claims/releases, authoritative settlement, and extension dialog close on response, timeout, abort, cancellation, or destruction. Projection-only inputs must not leak into the existing raw SSE behavior.

Initialize queue and live wrapper state synchronously when the hub is constructed; never sample or mutate canonical state because a browser subscribes. Pending UI must be reduced when emitted, not when `onEvent()` later replays it. Status/widget/custom removals and dialog cleanup must remove canonical state exactly once.

`destroy()` closes the hub and its observers exactly once and then preserves the established wrapper/native disposal and destruction-observer contract. Do not change the ten-minute idle constant, running projection semantics, process signal handlers, hosted ownership transfer, wrapper registry/start locks, or custom-server cleanup in S2.

### 8. Preserve the migration boundary

S2 may add focused protocol/projector/reducer/hub modules and tests and narrowly integrate the capability into `lib/rpc-manager.ts` plus local structural types/normalization. It must not:

- register a `session` gateway channel;
- extend the transport ticket body;
- create a WebSocket handler/client/provider/registry;
- alter or delete `app/api/agent/[id]/events/route.ts` or its browser EventSource caller;
- change `useAgentSession`, `ChatWindow`, React components, file watching, OAuth, or global-status behavior;
- add heartbeat, network output buffering, slow-consumer close codes, 30-minute idle, shutdown grace, or final all-channel lifecycle policy;
- change Pi monorepo source, dependencies, ports, TLS, Next private state, or release artifacts.

The legacy raw SSE path is a temporary preserved compatibility boundary, not an approved projected serializer. Static tests must prove no new projected API returns raw events and that S3/S4/S5/S6 surfaces remain untouched.

### Scope estimate

- **Expected production surfaces:** new focused modules such as `lib/session-protocol.ts`, `lib/session-projector.ts`, `lib/session-reducer.ts`, and `lib/session-event-hub.ts`; narrow integration in `lib/rpc-manager.ts`; and only necessary local type/normalization changes in `lib/pi-types.ts`, `lib/types.ts`, or `lib/normalize.ts`.
- **Expected test surfaces:** matching protocol/projector/reducer/hub tests, long-stream byte-growth fixtures, and focused additions to `lib/rpc-manager.test.mjs` for wrapper claims, extension lifecycle, HMR capability, zero-subscriber capture, and destruction.
- **Explicitly excluded:** ticket/gateway/server channel changes; Node WebSocket clients; browser registry/hook/components; SSE removal; file watching; idle/heartbeat/backpressure/shutdown changes; Pi-monorepo mutation; `next build`.
- **Complexity:** large but cohesive. Highest risk is preserving exact message/extension semantics while separating durable canonical state from transient effects and legacy SSE.
- **Context target:** zero compactions expected; one maximum.
- **Stop condition:** missing actionable provider deltas, inability to recover canonically without retaining an unbounded transcript, need to define S3 authorization/backpressure or S4 browser ownership, or any pressure to weaken final equality/privacy/bounded replay is material divergence and returns to the orchestration root.

## Reference Files

Selected governing and implementation evidence actually used for this milestone:

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Accepted S1 plan](./2026-07-31-s1-global-running-websocket.md)
- [Accepted S1 checkpoint](../checkpoints/2026-07-31-s1-global-running-websocket-checkpoints.md)
- [Project memory index](../memory/MEMORY.md)
- [Repository instructions](../../AGENTS.md)
- [Runtime manager/wrapper](../../lib/rpc-manager.ts)
- [Per-session SSE compatibility route](../../app/api/agent/[id]/events/route.ts)
- [Current browser event state machine](../../hooks/useAgentSession.ts)
- [Pi-Web message and extension types](../../lib/types.ts)
- [Local Pi structural types](../../lib/pi-types.ts)
- [Tool-call normalization](../../lib/normalize.ts)
- [S1 strict protocol pattern](../../lib/global-status-protocol.ts)
- [S1 HMR-safe registration pattern](../../lib/global-status-channel.ts)
- Installed `@earendil-works/pi-coding-agent` `AgentSessionEvent`, nested `pi-agent-core` `AgentEvent`, and nested `pi-ai` `AssistantMessageEvent` declarations under `node_modules/`
- Read-only sibling Pi reference `packages/coding-agent/src/core/agent-session.ts` and `packages/coding-agent/test/suite/agent-session-retry-events.test.ts`, under the reference repository named by the master
- Recoverable read-only S2 context run `be036ee9-c3bc-4590-8e09-f4802fcfea36`, children 0 and 1

No advisory reference-pointer companion exists for the master. The Pi monorepo is reference-only and receives no changes.

## Test Strategy

### Protocol, parser, and reducer fixtures

Require exact focused coverage for:

- every V1 frame and snapshot discriminant, exact keys, nested normalized message/content shapes, stream epoch, and safe sequence;
- unsupported version, unknown type, excess fields, malformed JSON values, duplicate/stale frames, forward gaps, wrong epoch, stale snapshots, and atomic newer-epoch snapshot replacement without state mutation on failure;
- every nested assistant event—`start`, text/thinking/tool-call start/delta/end, `done`, and `error`—with empty blocks, Unicode, interleaved content indices, fragmented tool JSON, normalized final tool input, delta-comparable-subset equality, and proof that terminal complete message/error objects never cross;
- user, assistant, tool-result, custom, image, error, and aborted completed messages with only display-required fields, plus explicit omission/refresh-only fixtures for installed bash-execution, branch-summary, and compaction-summary roles and all of their sensitive nested fields;
- active tools with overlap and out-of-order completion;
- queue replacement and clear;
- retry start/end, multiple retrying `agent_end` events, one ultimate wrapper settlement, and no intermediate final snapshot;
- manual/threshold/overflow compaction, success/abort/error, legacy alias normalization, token-count reduction, and summary/detail omission;
- every extension method, replacement/removal, dialog response/timeout/abort/destruction close, custom close, status/widget/title snapshot recovery, and transient notice/editor overflow semantics;
- explicit no-op/refresh classification for every installed unconsumed SDK event and fail-closed unknown runtime event;
- final state deep equality between independent reduction and each final snapshot, plus no ghost streaming/retry/tool state after settlement.

### Hub, replay, HMR, and wrapper integration

Require deterministic tests that prove:

- sequence advances through a complete run with zero subscribers;
- one input yielding multiple frames receives contiguous sequences;
- two or more subscribers see the same order and cannot influence state/sequence;
- atomic attach has no snapshot/replay subscription gap;
- in-range cursor returns the exact contiguous suffix;
- frame-count eviction, UTF-8 byte eviction, oversized ordinary-frame behavior, oversized durable-state snapshot fragmentation, replay-floor advancement across a non-retained final snapshot, resumption from immediately before versus after its sequence, interrupted/out-of-order/duplicate chunk rejection, stale/future/wrong-epoch recovery, and capacity remaining within both configured bounds;
- every snapshot transfer unit respects the configured encoded-frame ceiling, replay retains or evicts a snapshot only as a whole logical group, and strict reassembly atomically reproduces the canonical state;
- initial/recovery snapshots do not advance sequence, while wrapper settlement emits exactly one logically sequenced final snapshot even with no subscribers;
- overlapping prompt claims and compaction claims cannot emit false finality;
- ordinary extension-binding rejection, synchronous native prompt invocation failure, hosted binding failure, hosted pre-dispatch cancellation, dispatched prompt success/failure, streaming-behavior settlement, and standalone compaction success/error/abort each settle on the last claim exactly once, while destruction only closes;
- listener throw/unsubscribe is isolated;
- compatible wrapper capability survives simulated module reload, incompatible/missing capability fails closed, and no second hub attaches;
- pending UI is captured at emission time rather than legacy listener attachment;
- wrapper destruction closes observers/hub once while existing native disposal and destruction observers remain exact;
- legacy `onEvent()` behavior and the per-session SSE route/caller remain unchanged.

### Final-message and encoded-byte evidence

For synthetic Unicode text, thinking, and streamed tool arguments:

1. encode the current legacy pattern of every growing outer `message_update.message` plus full `agent_end.messages`;
2. encode the projected start/delta/end frames plus one normalized final message/final snapshot;
3. measure actual UTF-8 JSON bytes rather than JavaScript string length;
4. prove projected total grows approximately linearly when content/chunk count doubles, while the modeled legacy total approaches quadratic growth;
5. assert delta frames contain no `message`, `messages`, `partial`, tool execution args/result/partialResult, provider payload, compaction summary/details, extension path, or unrelated fields;
6. prove one normalized final message reconciles exactly and is the only allowed final message copy before the final snapshot.

### Required commands and evidence

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/session-protocol.test.mjs lib/session-projector.test.mjs lib/session-reducer.test.mjs lib/session-event-hub.test.mjs lib/rpc-manager.test.mjs
node --test lib/*.test.mjs components/*.test.mjs
node --test $(find lib components -maxdepth 1 -name '*.test.mjs' ! -name 'pi-web-real-next.test.mjs' -print | sort)
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Use actual final focused filenames if the narrow module names differ. Do not run `next build`.

The literal full-suite command and the exact non-real-Next partition above are both required. Run the real-Next file separately as shown. If local main lacks the release-owned production manifests, acceptance requires every non-real-Next test and the real-Next terminal/development subtests to pass; the only permitted real-Next failures are the production subtest and its parent caused solely by the named missing-manifest preflight. Record their exact counts and retain S1's already accepted 4/4 pinned-fixture lifecycle evidence only as unchanged-lineage evidence, not as a fresh S2 run or inclusion claim. Any other failure blocks. If S2 changes `bin/pi-web*.js`, package/server lifecycle files, or the real-Next harness, this narrow unchanged-boundary disposition is unavailable and S2 remains blocked until the full real-Next file passes against an authorized fixture.

`npm pack --dry-run` is a package-manifest/regression check only. `package.json` packages built `.next`, `bin`, public/config files, not the new `lib/session-*` TypeScript sources directly; therefore S2 must not claim that dry-run output proves fresh protocol-module inclusion. Fresh bundling remains release-owned under the build prohibition. No S2 browser or Node-WebSocket flow is required because S2 creates no browser/network transport; S3/S4 own those layers. Existing lifecycle/security tests remain part of the executed partitions.

Before acceptance, the root must inspect the actual diff and generated protocol surface, map every obligation below, verify the honest package boundary, run privacy/raw-field/source-boundary searches, obtain a fresh independent no-edit/no-delegation implementation review, and commit only the coherent accepted S2 boundary.

## Telemetry / Debuggability

Provide only bounded development/test diagnostic records or an injectable diagnostic sink with finite fields:

- projected frame discriminant and omission/mismatch class;
- sequence and replay frame-count/UTF-8-byte occupancy class;
- replay outcome: exact, empty, initial snapshot, overflow snapshot, wrong epoch, invalid cursor, or closed;
- snapshot reason and final-equality outcome class;
- listener/hub lifecycle outcome and exact-once close class.

Byte values may be exact in tests and bucketed in development diagnostics. Never include message/prompt/queue/extension content, normalized payloads, stream epochs, raw session identifiers, model/provider values, tool names/arguments/results, tickets, credentials, filesystem paths, SDK objects, or rejected frame bodies in logs or committed evidence. Unknown native/frame diagnostics use finite type/reason classes, not attacker-controlled strings.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|
| S2-VC-001 | P0 | Orchestration/scope | One immutable S2 plan, one source writer, verified special handoff, fresh independent review, no overlap, and one coherent boundary commit; no S3+ implementation or browser/SSE migration enters the diff. | Plan/checkpoint, subagent identities, Git diff/status/history, source-boundary inventory. | scrutiny | Ownership ambiguity, plan mutation after writer start, later-milestone source, or unsupported handoff stops immediately. |
| S2-VC-002 | P0 | Protocol/raw boundary | The V1 exact union/parser cover every emitted logical frame and bounded snapshot-transfer unit; every installed known native/wrapper input and nested message role is projected or explicitly classified; no raw event, growing update message, full `agent_end.messages`, bash/summary/path payload, tool execution payload, or unused field can enter the projected encoder/hub API. Legacy raw SSE remains explicitly deferred to S4B. | Exhaustive type/role/fixture tests, forbidden-field serializer assertions, static projected-API and legacy-boundary review. | scrutiny | Raw projected pass-through, permissive unknown shape, missing role/event, forbidden field, or false full-ORCH-VC-003 claim blocks S2. |
| S2-VC-003 | P0 | True deltas/efficiency | Text, thinking, and tool-call arguments use actionable provider deltas; every nested assistant discriminant is classified; terminal complete objects are forbidden; complete fixtures compare equal for the delta-addressable subset before finalization; the post-completion effect always equals the one full normalized final message; projected UTF-8 bytes grow approximately linearly rather than quadratically. | Exhaustive nested-event fixtures, long Unicode byte-growth tests, subset equality/mismatch classifications, terminal-object exclusion, and exact post-final equality for all three delta classes. | scrutiny | Missing event/delta, terminal-object fallback, repeated growing snapshot, full agent-end transcript, post-final inequality, or quadratic growth is material divergence. |
| S2-VC-004 | P0 | Canonical reducer/finality | Pure reduction reproduces current live event semantics, handles sequence/version/epoch errors without mutation, distinguishes durable state from transient effects, and emits no final state until every dispatched or pre-dispatch last-claim path—or standalone compaction—settles exactly once; destruction only closes. | Reducer/projector/wrapper fixtures for lifecycle, all prompt pre-dispatch/dispatched paths, messages, roles, tools, queue, retry, compaction success/error/abort, extensions, overlap, settlement, and destruction. | scrutiny | Gap/duplicate mutation, stranded activity, retrying/false finality, destruction snapshot, ghost state, stale one-shot recovery, or post-final equality failure blocks. |
| S2-VC-005 | P0 | Sequence/replay/snapshots | Each wrapper has one subscriber-independent monotonic logical sequence; replay is bounded by 4 MiB and 8,192 encoded protocol units while retaining/evicting logical groups atomically; every snapshot is a transaction of individually bounded units; only an unretained event-driven final snapshot advances the floor, while initial/recovery transactions never mutate replay eligibility; overflow/oversize/wrong cursor recovery is representable without truncating durable state. | Hub/assembler tests with injected byte/unit limits, encoded counters, interrupted transaction matrix, before/after-oversized-final-snapshot cursors, oversized initial/recovery non-mutation, epoch matrix, and final snapshot reduction equality. | scrutiny | Subscriber-dependent capture, sequence/floor gap, initial/recovery replay mutation, oversized transfer unit, unbounded replay, partial snapshot retention/application, truncation, or noncanonical recovery blocks. |
| S2-VC-006 | P0 | Wrapper/HMR/lifecycle | The hub capability exists before native subscription/publication, receives native and wrapper/projection-only events before legacy fanout, captures with zero subscribers, survives compatible HMR, rejects incompatible/missing capability, and closes exactly once with wrapper destruction. | Wrapper integration/HMR/zero-subscriber/destruction tests plus direct source inspection. | scrutiny | Late/duplicate projector, missed zero-subscriber event, false pre-S2 replay claim, listener interference, or disposal regression blocks. |
| S2-VC-007 | P0 | Recovery/compatibility | Canonical live snapshots carry exact cursor plus transcript/runtime refresh requirements without an unbounded transcript; S2 makes no unsupported race-free HTTP-composition claim; legacy reconciliation, per-session SSE/browser behavior, and S1 global status remain unchanged for S4A/S4B to compose and prove. | Snapshot marker/transfer fixtures, explicit S4 deferral review, raw-route/caller preservation inventory, full runtime/component tests. | scrutiny | Growing transcript state, missing refresh/cursor marker, false entry-ID convergence claim, weakened current reconciliation, or compatibility regression blocks. |
| S2-VC-008 | P0 | Extension semantics | Dialog/custom/status/widget/title durable state and notice/editor transient effects have exact add/replace/remove/close/replay/overflow behavior, including timeout/abort/destruction cleanup. | Exhaustive extension projector/reducer/wrapper cleanup fixtures. | scrutiny | Stale recovered dialog/custom UI, lost durable removal, repeated stale editor action, or raw extension payload blocks. |
| S2-VC-009 | P0 | Privacy/diagnostics | Projected wire fields are exact and display-required; diagnostics/evidence are bounded and contain no content, identifiers, epochs, paths, provider/tool payloads, credentials, or rejected bodies. | Static forbidden-field/log review and focused diagnostic-sink tests. | scrutiny | Sensitive or attacker-controlled diagnostic output, extension path leakage, or raw payload retention blocks. |
| S2-VC-010 | P0 | Required gates/package | Typecheck, lint, focused/literal-full/exact-partition tests, honest real-Next disposition, package-manifest dry run, diff check, checkpoint evidence, root verification, and fresh review pass complete with no hidden skip or forbidden build. | Exact command/subtest outcomes, unchanged lifecycle-source boundary when manifests are absent, dry-run manifest inventory without false source-inclusion claim, Git inspection, review result. | scrutiny | Any non-preflight test failure, changed lifecycle source without full real-Next pass, uncharacterized environment, false package inclusion claim, hidden skip, or `next build` blocks acceptance. |

This contract implements only the S2 projected-protocol portion of ORCH-VC-001, ORCH-VC-003, ORCH-VC-004, ORCH-VC-008, ORCH-VC-011, and ORCH-VC-012. ORCH-VC-003 cannot pass repository-wide while the explicitly preserved legacy SSE serializer remains; S4B owns that final disposition. ORCH-VC-004 end-to-end browser/HTTP convergence, ORCH-VC-005 browser ownership, ORCH-VC-007 final idle/heartbeat lifecycle, and the remaining system rows stay authoritative for later milestones/full-master validation.

## Assumptions, Risks, and Blockers

- Installed Pi exposes actionable `text_delta`, `thinking_delta`, and `toolcall_delta`; the root verified both declarations and read-only Pi tests. If a real supported provider lacks those actionable events, stop under ORCH-VC-003 rather than reintroduce growing snapshots.
- `agent_end` precedes `agent_settled`, and the native prompt promise settles after the latter. Wrapper prompt accounting is released later still. Wrapper-owned settlement is therefore selected as the only safe final snapshot boundary.
- Canonical S2 state is the bounded persistent-event projection, not a second transcript/runtime database. Initial/recovery/final snapshots explicitly trigger existing HTTP transcript/runtime reconciliation; removing that safety belongs only to S4B after equivalent evidence.
- A normalized final tool/custom message may contain display-required JSON-safe details. Arbitrary SDK/provider-only fields remain forbidden. If current rendering requires a field not safely normalizable, stop for root classification rather than copying the raw object.
- Individual completed messages, queue items, or extension panels can exceed replay capacity. V1 snapshot transactions therefore fragment canonical projected JSON into individually bounded transfer units, retain/evict the transaction only as a whole logical frame, and regenerate it for recovery without truncation. S3 streams those units incrementally; S3/S6 still own network buffered-output and slow-consumer close policy.
- Extension-origin model/tool changes can be silent. S2 deliberately preserves HTTP runtime authority rather than claiming event-only parity it cannot observe.
- Existing wrappers can survive development HMR. A wrapper created before the S2 capability cannot recover missed history and must be reported missing/incompatible to S3, never retrofitted with a second late hub.
- Legacy per-session SSE necessarily remains raw until S4B; this does not authorize raw access through the new projected capability.
- Fresh production inclusion remains release-owned because `next build` is prohibited. The existing transparent full-suite partition may prove lifecycle only and must not be described as fresh route/module inclusion.

## Implementation Handoff

No source implementation is authorized while this milestone is `Status: draft` or before its plan and checkpoint are committed. After root reconciliation and independent draft review under the approved orchestration master, change only the status to `approved`, commit the immutable plan/checkpoint boundary, and launch one fresh `milestone-implementer` as the sole implementation-source writer for this exact milestone.
