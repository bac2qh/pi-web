# S4B: Hook Migration and Retained Hidden Session Streams

Status: approved

## Objective

Complete only the S4B browser-session migration authorized by the approved [persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md), starting from accepted S4A implementation commit `11036f6b2f829b7e27bad9e2fee4148d5925915d` and final checkpoint commit `598f804777132f049a88751becddef3e7d6b33f3`.

Move the current selected-session hook from raw per-session EventSource events to the accepted S4A page registry, projected canonical snapshots, and sequence-addressed effects. Put session-view transport ownership above keyed `ChatWindow` lifetime so a locally initiated active view remains subscribed when selection moves away, while idle or canonically settled hidden views release their browser socket without aborting or owning the server run. Acquire and attach the exact session view before every ordinary prompt, promote newly materialized IDs without transport churn, compose HTTP transcript/runtime repair against observed WebSocket cursor generations, preserve every current command, optimistic, polling, branch, queue, compaction, tool, extension, draft, unread, and completion behavior, then remove the per-session SSE caller and route.

S4B does not change the accepted V1 wire/server hub, invent a read barrier or acknowledgement, retain every visited/sidebar/global-running session, migrate file watch, change semantic idle/heartbeat/shutdown, or perform final scale/user acceptance. Success means:

- the page-level owner has one stable view binding per locally needed exact session ID, backed by the accepted one-client-per-ID registry;
- selecting B acquires B visibly before A is relabelled/released; a locally pending or canonically active A remains `retained_hidden`, while an idle A releases;
- browser selection, unmount, disconnect, and page identity never own, abort, stop, or define the server run;
- a new session ID is acquired with its first effect consumer and reaches the existing V1 attached-ready boundary before its prompt POST; promotion reuses that exact binding;
- visible projected snapshots/effects are the only persistent live-event writer for draft, activity, tools, queue, retry, compaction, extensions, completed messages, notices, and editor insertion;
- hidden retained entries continue ordered reduction, discard unrecoverable transient UI effects rather than journaling them, and converge on reveal through canonical snapshot plus HTTP transcript/runtime repair;
- HTTP transcript/runtime results apply only to the same view/request/run/leaf and unchanged observed cursor generation, while later deltas or recovery markers force coalesced retry and final quiescent equality;
- polling, visibility/online reconciliation, settlement polling, HTTP commands/state/transcript/tree/context, and optimistic fallbacks remain until their exact retained duties are demonstrated;
- `hooks/useAgentSession.ts` owns no `EventSource`, `/api/agent/[id]/events` is deleted, and file-watch plus short-lived OAuth EventSources remain intentionally unchanged;
- Chromium and Firefox prove prompt attachment, visible/hidden/reveal, reconnect/recovery, no per-session SSE, no run abort on release, and ordinary HTTP responsiveness.

## Design / Implementation Strategy

### 0. Apply the contained existing-V1 interpretation

The master and accepted S4A jointly resolve two implementation questions without new authority:

- **Attach before prompt:** synchronous registry acquisition alone starts bootstrap but is not the full gate. A prompt may POST only after the current binding observes `connectionState:"recovering"` or `"connected"` for its exact generation. Both states follow strict S3 `ready`, so the server has consumed resume and attached the projected hub; catch-up/recovery still precedes later live units. Reuse the current five-second connection deadline. Terminal protocol state fails immediately; reconnecting/connecting may continue until the deadline. Re-read the current binding after a wake-up so a stale transient state cannot authorize the POST. This adds no wire acknowledgement.
- **Cursor-bound HTTP:** existing V1 has no cursor-stamped HTTP body, read barrier, or marker acknowledgement. S4B therefore implements client-side cursor-observed composition: capture the exact view generation and committed snapshot identity/epoch/cursor/revision before a request, reject a result after any relevant advance, and retry/coalesce at the newest observed cursor. A delayed unobserved server event may arrive after a provisionally accepted HTTP response, but its later cursor/revision/sticky marker forces another repair. Claim eventual convergence and final quiescent equality, never linearizable generation of the HTTP body.

These are the only interpretations compatible with the master’s existing-V1 boundary, mandatory recovery retention, and prohibition on new commands/acks. If implementation requires server cursor parameters, marker clearing, or a stronger read barrier, stop for material-divergence review.

### 1. Add one page-local session-view transport owner above keyed chat

Add runtime-neutral `lib/session-view-transport.ts` around the accepted `SessionRegistryController`, and have `SessionRegistryProvider` own one instance for the browser page. The provider remains above `AppShell` and disposes view bindings before the base registry during its existing StrictMode-safe final cleanup. Keep raw registry APIs testable, but production `AppShell`/hook code consumes the view controller rather than acquiring raw entries independently.

Each exact-ID view entry owns one generation-bound registry handle, the latest stable client snapshot, one atomic raw `onEffect` relay installed before client start, visible/hidden selection state, zero or more bounded local prompt claims, and snapshot/effect subscribers for the currently mounted hook. It stores no transcript, transient-effect journal, prompt content, browser ownership, or server-run lease.

Freeze these behavioral primitives; literal exported names may vary only if the same narrow contract is clearer:

```ts
interface SessionViewBinding {
  getSnapshot(): SessionViewSnapshot;
  subscribe(listener: (snapshot: SessionViewSnapshot) => void): () => void;
  subscribeEffects(listener: (delivery: SessionEffectDelivery) => void): () => void;
  waitUntilAttached(timeoutMs?: number): Promise<void>;
  beginPromptClaim(): SessionViewPromptClaim;
}

interface SessionViewSnapshot {
  generation: number;
  transport: SessionClientSnapshot;
  localPromptPending: boolean;
}

interface SessionViewPromptClaim {
  accepted(): void;
  failed(): void;
  settled(): void;
}

interface SessionViewTransportController {
  select(sessionId: string | null): SessionViewBinding | null;
  ensureVisible(sessionId: string): SessionViewBinding;
  dispose(): void;
}
```

`SessionViewSnapshot` must be deeply frozen and identity-stable between observable transport/claim changes. Subscription and effect fanout inherits S4A’s synchronous-current/future-effect, queued-order, listener-set snapshot, throw isolation, and stale-generation rules.

`AppShell` owns visible selection transitions through this controller. Every path that changes the selected real ID—ordinary selection/restore, same-project close, new screen, new-ID promotion, fork, deletion—must transition the view controller consistently. Select/acquire B first; only then relabel or release A. Hydration of the same selected ID, branch-leaf navigation, clone, file tabs, and URL refresh must not churn transport. Pass the stable selected binding into keyed chat state, or otherwise prove the keyed hook cannot release the provider-owned entry.

Give every new-session screen one stable AppShell view-generation token. `ensureNewSession()` and its later promotion carry that token. Adopt the real ID into selected state and rewrite the URL only while the initiating new-screen token is still current. If the user selected B or opened another new screen while A’s attach/prompt POST was pending, A’s stale completion may refresh ordinary discovery but must not reselect A, rewrite B’s URL, churn either binding, or discard A’s local claim/canonical hidden retention.

### 2. Retain only locally pending or canonically active hidden views

A view is retained when selected, when it has a local prompt claim that has not failed/settled or been covered by canonical activity, or while its last fully committed projected state has `active:true`. `ProjectedSessionState.active` already covers native prompt/compaction activity; do not broaden retention from global running IDs, sidebar pin/hide metadata, browser page origin, queue contents alone, or every visited idle session.

A local prompt claim is a browser-connection continuity claim only and has claim-relative activity state:

1. create it before waiting for attachment so A cannot lose its socket if selection changes in the HTTP-to-first-frame gap;
2. call `failed()` when attachment or prompt POST fails, with the same optimistic-message/run rollback as today, unless canonical activity has already covered the claim;
3. call `accepted()` only after the HTTP command accepts the prompt; acceptance alone does not retire or recreate the claim;
4. when a later ordered snapshot for this binding first commits `active:true`, mark the claim activity-observed and retire the claim because canonical active state now retains the entry; a later inactive settlement then uses the ordinary deferred-release rule;
5. never retire an uncovered claim merely because an idle `active:false` initial/recovery snapshot commits after prompt dispatch—the snapshot may be the baseline selected before the prompt; only `failed()` or explicit prompt-run-matched HTTP `settled()` may close a claim that never observed active;
6. preserve fast settlement: ordered `active:true` then inactive may cover/settle before the prompt POST response, while a recovery snapshot that skips the activity edge requires the run-token-matched HTTP settlement path;
7. never let a claim send abort/Stop, create a server wrapper by itself, or survive an established claim-relative settlement.

When a hidden entry becomes inactive with no claim, defer release until the current snapshot/effect batch finishes (a microtask or equivalent bounded drain). This preserves a same-sequence final `message_completed` relay before the raw handle is removed. If the view becomes selected/active again before deferred release, cancel release and reuse the generation. Hidden views with no mounted hook may discard notice/editor/completed-message effect payloads after advancing their effect sequence; canonical transcript revision/refresh markers and HTTP repair recover durable UI on reveal. Do not add an effect journal or replay transient notice/editor actions.

### 3. Add pure projected-view adaptation

Add `lib/session-view-projection.ts` with table-tested pure conversion from `SessionViewSnapshot` and `SessionEffectDelivery` into the existing hook surfaces. Do not pass raw SDK events or projected wire frames into React.

The adapter must:

- convert canonical assistant draft metadata and ordered text/thinking/completed-tool blocks into the existing streaming-message representation without fabricating unavailable tool identity or terminal provider fields;
- derive effective running from canonical activity plus the local prompt claim, so a pre-prompt idle snapshot cannot cancel an optimistic run;
- preserve `running_command` for a local slash-command claim until canonical prompt activity/draft/tool state or HTTP settlement supersedes it;
- map `activeTools`, queue, retry, active/completed compaction, dialogs, custom UIs, statuses, widgets, and title deterministically;
- retain HTTP prompt/compaction classification where aggregate projected `active` cannot distinguish a standalone compaction from prompt activity, and call `onAgentEnd` only once for an eligible visible prompt lineage—not for hidden settlement, standalone compaction, duplicate snapshot, remount, or global running transition;
- map `message_completed` through `normalizeToolCalls()` and the current adjacent optimistic-user dedupe; append later delivered queued user messages normally;
- map notice level to the current notice reducer and editor insertion to the live `chatInputRef` only while visible;
- apply snapshot state before associated effects, ignore stale view/run generations, and never recreate effects from snapshots or HTTP.

Canonical projected state is authoritative for live draft/tools/queue/retry/compaction/extensions/activity after the first committed epoch. HTTP may seed those fields before a canonical snapshot or repair HTTP-only context/system/thinking/model data, but an unchanged-current projected overlay must win when an HTTP response is applied. This prevents a second live writer.

### 4. Add cursor-observed HTTP reconciliation

Add `lib/session-http-reconciliation.ts` as a pure coordinator/token seam and use it from `useAgentSession`. For each transcript, selected-leaf context, and runtime request capture:

- exact session ID and view binding generation;
- current stable transport snapshot identity, stream epoch, cursor, local revision, and transcript revision;
- a monotonically increasing request token for that resource;
- current selected leaf/context generation;
- current prompt/UI message generation for every transcript or selected-context request that can replace messages, entry IDs, leaf, or tree state; runtime requests also capture the prompt run when settlement-sensitive.

A response may apply only if it is still the newest request, session/view/leaf generation still matches, every transcript/context prompt/UI message generation is unchanged, any settlement-sensitive runtime run generation still matches, and the current committed transport snapshot remains the captured identity/epoch/cursor for fields the response could overwrite. This unconditional transcript/context generation gate rejects an initial load that returns after a new optimistic prompt begins even when no projected cursor has advanced yet. Re-read immediately after scheduling application; if the cursor or prompt/UI generation changed, mark the latest token dirty and coalesce another request. Never clear `transcriptRefreshRequired` or `runtimeRefreshRequired` locally or on the server.

Use bounded/coalesced triggers rather than fetching on every delta:

- transcript/context HTTP runs on initial selected mount, selected-leaf change, recovery/new epoch, transcript revision increase (coalesced while active), and canonical settlement; effects keep visible completion immediate while final transcript HTTP is authoritative;
- runtime HTTP runs on initial/recovery, explicit reload/current command paths, canonical settlement, prompt settlement polling, 15-second running reconciliation, visibility return, and online return;
- sticky markers plus the last reconciled `(epoch,cursor,transcriptRevision)` keep repair pending until one unchanged-current response applies; they do not create an infinite per-frame loop;
- an unmounted hidden entry records dirty generation/revision only; reveal performs current canonical transcript/runtime repair.

Preserve active-leaf context. A background root-session refresh must not overwrite a newer selected branch. Fork changes view generation from source to child; clone and in-session navigation do not reconnect. Slow HTTP from a source/old run must not finish, duplicate, or resurrect its replacement.

### 5. Migrate `useAgentSession` coherently and remove per-session SSE

Replace `eventSourceRef`, raw `AgentEvent`, `connectEvents`, `ensureEventsConnected`, `handleAgentEvent`, EventSource timeout/result/error types, and SSE-specific comments with one view binding subscription and projected adapter. Do not run both event writers.

For existing sessions, the AppShell-selected binding exists before the keyed hook attaches; atomically attach snapshot/effect listeners, then perform transcript/runtime initial repair. For new sessions, `ensureNewSession()` returns the real ID under the current new-screen generation, `ensureVisible()` publishes/reuses its binding, the hook attaches its first effect consumer synchronously, creates a prompt claim, waits for strict attached-ready, sends model change if required, POSTs prompt, and marks the claim accepted. Promote the same binding without changing `sessionKey` or draft semantics only if the initiating new-screen generation remains selected; stale promotion refreshes discovery at most and cannot steal a newer selection/URL.

Preserve:

- optimistic user bubble, image prompt, adjacent delivered-user dedupe, generic command failure rollback, slash-command settlement, and completion scroll/sound gating;
- `promptRunIdRef` monotonic late-response protection and `finishPromptWithoutStream` as a settlement repair path;
- 15-second, visibility, online, and prompt-settlement HTTP reconciliation with transport-neutral comments;
- queue display/steer/follow-up/recall behavior and no optimistic queued bubble;
- automatic/current/legacy compaction presentation, manual compact/abort, tool phases, retry, extension dialog/custom/status/widget/title/editor behavior;
- models, thinking, tools, context/system prompt/session stats, branch/tree/context, fork, clone, navigate, drafts, URL/selection, file links, explorer refresh, and completion sound;
- global running/discovery as the sole sidebar unread/list-refresh authority. Hidden completion must not play sound or independently mark unread; selected completion invokes the existing visible callback once.

After focused and browser parity passes, delete `app/api/agent/[id]/events/route.ts` and all per-session route references. Do not alter OAuth login SSE or the four file-watch EventSources/routes assigned to S5.

### 6. Preserve server and later-milestone boundaries

Do not change `lib/session-protocol.ts`, `lib/session-reducer.ts`, `lib/session-event-hub.ts`, `lib/session-channel.ts`, `lib/session-transport-client.ts`, `lib/session-registry.ts`, ticket metadata, WebSocket channel semantics, replay/output bounds, commands, wrapper lifecycle, admission, or diagnostics except for a demonstrated bounded S4B integration defect that cannot be fixed above those accepted seams. Any new wire command/version, acknowledgement, transient-effect journal, raw event fallback, HTTP cursor parameter, server ownership rule, global-running acquisition, or weaker recovery gate is material divergence.

Do not add file watch, heartbeat, ping/pong, 30-minute idle, shutdown grace, dependencies, TLS/port changes, Pi-monorepo changes, private Next cleanup, build artifacts, or final S7 scale/user acceptance.

### Scope estimate

- **Expected production surfaces:** exact new modules `lib/session-view-transport.ts`, `lib/session-view-projection.ts`, and `lib/session-http-reconciliation.ts`; `components/SessionRegistryProvider.tsx`; `components/AppShell.tsx`; `components/ChatWindow.tsx`; `hooks/useAgentSession.ts`; deletion of `app/api/agent/[id]/events/route.ts`; and only narrowly required local types/helpers.
- **Expected tests:** exact new files `lib/session-view-transport.test.mjs`, `lib/session-view-projection.test.mjs`, `lib/session-http-reconciliation.test.mjs`, and `components/SessionAgentTransport.test.mjs`; focused updates to `components/SessionRegistryProvider.test.mjs`, `components/SessionSidebar.test.mjs`, `components/GlobalStatusProvider.test.mjs`, `lib/session-channel-integration.test.mjs`, and accepted S4A registry/client/recovery tests as necessary; sanitized browser evidence in `.agents/reports/2026-08-02-s4b-browser-session-migration.md` recorded by the root.
- **Normally unchanged:** S2/S3/S4A server protocol/hub/channel/client/base-registry production code, sidebar production authority, drafts, agent HTTP route/client, session reader/context APIs, package manifests, file viewer/watch, OAuth, server/gateway/bin.
- **Complexity:** large and coupled; one or two compactions maximum. Highest risks are keyed-view ownership, prompt-to-first-frame retention, effect ordering, projected/HTTP dual-writer races, and completion duplication.
- **Stop condition:** any need for a new server barrier/ack/version, browser run ownership, unbounded hidden/effect retention, simultaneous SSE and projected live writers, removal of polling without equivalent evidence, or product policy beyond locally pending/canonically active retention.

## Reference Files

Selected governing and implementation evidence for S4B:

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Accepted S4A plan](./2026-08-02-s4a-browser-session-registry-reducer.md) and [checkpoint](../checkpoints/2026-08-02-s4a-browser-session-registry-reducer-checkpoints.md)
- Accepted S4A implementation/finality `11036f6b2f829b7e27bad9e2fee4148d5925915d` / `598f804777132f049a88751becddef3e7d6b33f3`
- [Accepted S3 plan](./2026-08-02-s3-secure-session-websocket.md) and checkpoint; implementation/finality `2f3eb50` / `43b9e0c`
- [Accepted S2 plan](./2026-08-01-s2-projected-session-protocol-hub.md) and checkpoint; implementation/finality `39f22f0` / `26ec788`
- [Project memory index](../memory/MEMORY.md), custom-server lifecycle memory, and hosted implementation memory
- [Repository instructions](../../AGENTS.md)
- `components/SessionRegistryProvider.tsx`
- `lib/session-view-transport.ts` (new)
- `lib/session-view-projection.ts` (new)
- `lib/session-http-reconciliation.ts` (new)
- `lib/session-registry.ts`, `lib/session-transport-client.ts`, `lib/session-stream-state.ts`
- `lib/session-protocol.ts`, `lib/session-reducer.ts`, `lib/session-channel.ts`
- `components/AppShell.tsx`, `components/ChatWindow.tsx`, `components/SessionSidebar.tsx`
- `hooks/useAgentSession.ts`
- `app/api/agent/[id]/route.ts`, `app/api/sessions/[id]/route.ts`, context/state routes
- `app/api/agent/[id]/events/route.ts` as the migration/removal boundary
- `lib/draft-store.ts`, `lib/agent-client.ts`, and current focused tests
- Recoverable S4B planning context batch `3648e333`, scout outputs `.pi-subagents/artifacts/outputs/3648e333/s4b-browser-integration-context.md` and `s4b-recovery-context.md`

No advisory reference-pointer companion exists for the master. The sibling Pi monorepo is not required and remains untouched.

## Test Strategy

### Pure view ownership and attachment

Require deterministic fake-client/clock tests for:

- first selected ID creates one raw handle/socket; same ID reuses; N IDs remain independent;
- select A→B acquires B before relabelling A; idle A releases; active or local-claim A becomes retained hidden; global running/sidebar data never acquires;
- rapid A→B→A, deferred hidden settlement cancellation, same-sequence final effect before release, stale generations, same-ID recreation, listener throws/reentrancy, exact stop/dispose;
- local prompt claim before attachment, attached-ready states only after strict ready, timeout/terminal/release failures, POST failure, canonical active coverage, fast settlement before HTTP acceptance, and HTTP reconciliation settlement;
- the decisive baseline race: strict ready publishes `recovering`, prompt dispatches with an uncovered claim, an idle initial/recovery snapshot commits, selection moves away, the claim/socket remain, and the later ordered `active:true` frame arrives on the same binding;
- no claim/selection/release path sends command/abort/Stop or logs IDs/content.

### Pure projection and HTTP composition

Require exhaustive tables for:

- assistant text/thinking/tool-argument draft evolution and completed tool blocks; terminal/final equality;
- effective local-pending/canonical running, slash command, prompt versus standalone compaction eligibility, active tools, queue, retry, compaction result/error/abort;
- dialogs/custom/status/widgets/title, notices/editor insertion, optimistic user dedupe, queued user delivery, tool normalization, snapshot-before-effect, stale run/view/effect suppression, visible completion exactly once and hidden completion never;
- transcript/runtime initial, exact replay, overflow/wrong-epoch/invalid-cursor recovery, sticky markers, coalescing, unchanged-current accept, cursor/epoch/view/run/leaf/request advance reject, after-apply recheck/retry, active deferral, final quiescent equality, and no marker clearing;
- an initial transcript/context response that returns after the prompt/UI message generation advances but before any projected cursor advance; it must be rejected and retried/coalesced rather than erase the optimistic message.

### Hook/component/server integration

Add an actual React DOM harness with injected page view controller, HTTP/fake clock/browser events, and a mounted `useAgentSession` consumer. Cover:

- existing idle/running mount and canonical initial snapshot;
- new ensure-ID → acquire/effect subscribe → attached ready → optional model → prompt POST → same-binding promotion order, plus A’s late promotion after selection B proving B and its URL remain selected while A retains only through claim/canonical activity;
- attach timeout/terminal/prompt failure rollback and draft preservation;
- selection during attachment/HTTP→activity gap, hidden stream/reveal, no socket stop until settlement, final transcript recovery, no hidden sound/unread mutation;
- reconnect/exact replay/snapshot recovery, missed completion plus polling/visibility/online, slow old HTTP/run/leaf suppression;
- text/thinking/tools/retry/queue/compaction/extensions and final canonical/HTTP equality;
- navigation no churn, fork source→child ordering, clone source stability, current HTTP commands/tools/models/thinking/abort behavior;
- provider StrictMode/final disposal and raw registry/client regressions;
- source gates proving no per-session EventSource/caller/route and that file-watch/OAuth exceptions remain.

Update `lib/session-channel-integration.test.mjs` as a test-only S3 seam to prove zero-subscriber prompt capture and later snapshot/replay, disconnect without abort, independent subscribers, and ordinary HTTP schedulability. Update `components/GlobalStatusProvider.test.mjs` so its EventSource inventory requires global and per-session agent SSE absence while retaining exactly the four S5 file-watch callers and the one short-lived OAuth caller. Do not weaken existing 64/256 admission, output, HMR, or real-child tests, and do not change S2/S3/S4A production seams for these tests.

### Browser evidence

Before acceptance, run sanitized real Chromium and Firefox cases against the custom development server:

1. one existing session, new session first prompt, refresh mid-stream, offline/online, and server reconnect;
2. within one page start A, select B before A’s first projected activity, verify A remains one retained-hidden session socket, completes without abort/sound, releases after final ordered work, and converges when reselected;
3. rapid A→B→A, branch navigation, fork, clone, queue/retry/compaction/tool/extension flows, visibility/background recovery;
4. inspect the network/runtime inventory: one socket per selected/retained view, no `/api/agent/[id]/events`, no per-session EventSource, commands remain HTTP, file-watch and short-lived OAuth exceptions remain;
5. ordinary session/file/model HTTP requests complete while the session sockets are active.

Use synthetic/sanitized sessions and evidence only counts, finite states, timing classes, and command outcomes—never prompts, messages, raw IDs, paths, provider payloads, or tokens. S7 retains the combined ten-page/30-socket and final user acceptance matrix.

### Required commands and evidence

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/session-view-transport.test.mjs lib/session-view-projection.test.mjs lib/session-http-reconciliation.test.mjs components/SessionAgentTransport.test.mjs components/SessionRegistryProvider.test.mjs components/SessionSidebar.test.mjs components/GlobalStatusProvider.test.mjs lib/session-registry.test.mjs lib/session-stream-state.test.mjs lib/session-transport-client.test.mjs lib/session-channel.test.mjs lib/session-channel-integration.test.mjs
node --test lib/*.test.mjs components/*.test.mjs
node --test $(find lib components -maxdepth 1 -name '*.test.mjs' ! -name 'pi-web-real-next.test.mjs' -print | sort)
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Run literal and exact non-real-Next commands separately, and real-Next without overlap. Do not run `next build`. With absent release manifests, only the named production child/parent may fail at `.next/BUILD_ID`; terminal and real development must pass. Package dry run is shape-only and cannot prove fresh App Router inclusion.

Before acceptance, the root must inspect the complete diff and source boundary, reproduce attach-before-prompt, local-claim hidden retention, final-effect-before-release, same-binding promotion, stale HTTP/run/leaf suppression, final equality, and SSE-removal cases; verify protected server/base-registry/file-watch/OAuth boundaries; run privacy scans; collect the required Chromium/Firefox evidence; and obtain one fresh independent no-edit/no-delegation review.

## Telemetry / Debuggability

Add only optional bounded development/test diagnostics:

- view lifecycle stage: select, attach, visible, retained, release, dispose;
- entry/visible/retained/local-claim count classes (`zero`, `one`, `many`), never IDs;
- attachment result: already-attached, ready, timeout, terminal, released, stale;
- projection class: activity, draft, tools, queue, retry, compaction, extension, effect, settlement—never content;
- HTTP repair resource and result: initial, marker, revision, settlement, poll; accepted, stale-cursor, stale-view, stale-run, stale-leaf, superseded, retry-coalesced;
- completion result: visible-once, hidden-suppressed, duplicate-suppressed;
- SSE removal/source inventory class.

Never diagnose session IDs, server instances, epochs, cursors, revisions, request bodies, messages, prompt/queue/extension/editor content, model/provider/tool data, paths, addresses, credentials, tickets, raw close reasons, or `Error` strings. Product snapshots/tokens may carry opaque values required internally; diagnostic payloads may not. No persistent telemetry product or user UI is authorized.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|---|
| S4B-VC-001 | P0 | Orchestration/scope | One immutable S4B plan, one source writer, verified handoffs/fix loops/reviews, coherent boundary commits; only view ownership, hook/projected/HTTP adaptation, and per-session SSE removal enter scope. | Plan/checkpoint, run identities, Git inventory/history/status. | scrutiny | Overlapping writer, server-wire redesign, later-milestone work, or protected-source drift blocks. |
| S4B-VC-002 | P0 | View topology/ownership | Each locally needed exact ID has one independent page binding/raw client; B is acquired before A changes; locally pending/active A is retained hidden, idle/settled A releases after final effect; global/sidebar/page identity never creates or owns a run. | View-controller tables, socket/stop counters, selection/browser flows. | both | Duplicate socket, lost active hidden stream, stale release, global-running acquisition, abort/Stop, or page-dependent server behavior blocks. |
| S4B-VC-003 | P0 | Prompt attachment/promotion | Existing/new prompts install the effect consumer and uncovered local claim, reach current-generation S3 ready (`recovering`/`connected`) within the bounded gate, then POST; an idle pre-prompt baseline cannot settle the claim; timeout/terminal/failure rolls back; claim-relative activity/HTTP settlement is exact; current new-ID promotion reuses the binding while stale promotion cannot steal selection/URL. | Ordering/fake-clock/React/browser tests. | both | Prompt before attach, baseline claim loss, event gap, first-effect loss, optimistic ghost, stale selection takeover, duplicate acquisition, or unbounded wait blocks. |
| S4B-VC-004 | P0 | Projected state/effects | Projected snapshots are the sole persistent live writer; draft/tools/queue/retry/compaction/extensions and effects map exactly, state precedes effects, optimistic/queued messages dedupe correctly, visible completion fires once, and hidden/transient behavior makes no false replay claim. | Exhaustive adapter + mounted flows + final equality. | both | Raw/SSE dual writer, missing actionable state/effect, duplicate/lost visible completion, ghost draft/tool, or transient journal blocks. |
| S4B-VC-005 | P0 | HTTP convergence/recovery | Every transcript/context replacement and settlement-sensitive runtime response composes only with unchanged view/request/prompt-UI-run/leaf/cursor observations; later prompt generations, deltas, or recovery force bounded retry; sticky markers are not cleared; initial/reconnect/zero-subscriber/hidden reveal converge to canonical final state while polling remains. | Deferred-response coordinator, Node-client, hook, and browser recovery tests. | both | Optimistic-message overwrite before cursor advance, other stale overwrite, false linearizability, marker clearing, lost final transcript/runtime, removed recovery net, or infinite repair loop blocks. |
| S4B-VC-006 | P0 | Selection/hidden lifecycle | Rapid selection, background/foreground, disconnect, refresh, fork/clone/navigation, and page unload affect browser resources only; hidden completion releases safely and global status alone owns unread/list refresh. | Controller/component/sidebar/browser counters. | both | Selection aborts run, final effect drops, hidden sound/unread duplication, clone/nav churn, or retained idle leak blocks. |
| S4B-VC-007 | P0 | SSE removal/transport | No per-session EventSource or `/api/agent/[id]/events` caller/route remains; each active selected/retained view uses its one session WebSocket; HTTP commands and file-watch/OAuth exceptions remain. | Static inventory, route absence, browser network inventory. | both | Remaining caller/route, wrong socket topology, command over WS, or removal of explicit exceptions blocks. |
| S4B-VC-008 | P0 | Product compatibility | Prompt/images/slash/queue/retry/compaction/tools/extensions/models/thinking/branch/fork/clone/drafts/files/sound and HTTP state behavior remain compatible with no feature reduction. | Hook/component/full tests and Chromium/Firefox capability flows. | both | Capability loss, branch corruption, draft loss, or user-visible dual-state regression has no waiver. |
| S4B-VC-009 | P0 | Browser/reconnect | Chromium and Firefox prove attach, visible/hidden/reveal, refresh/offline/reconnect, zero-subscriber recovery, no abort, no SSE, and responsive ordinary HTTP. | Sanitized browser report plus server/client counters. | both | Browser-only ordering/recovery failure, starvation, wrong connection inventory, or missing real-browser evidence blocks. |
| S4B-VC-010 | P0 | Privacy/diagnostics | View/adapter/HTTP diagnostics are finite, bounded, and contain no identifiers, cursors, content, paths, provider/tool data, tickets, credentials, addresses, or raw errors. | Static scan and diagnostic sink tests. | scrutiny | Sensitive or attacker-controlled diagnostic output blocks. |
| S4B-VC-011 | P0 | Gates/finality | Typecheck, lint, focused/full/real-Next/package/whitespace/hash/source/no-stage gates and every review/fix/browser disposition are recoverable; checkpoint names implementation/finality commits and exact later boundaries. | Commands, report, checkpoint, Git inspection. | scrutiny | Unsupported acceptance, hidden skip, false production claim, missing final evidence, or automatic cleanup blocks. |

This milestone completes the browser migration portions of ORCH-VC-003/004/005/008/011/012 for agent session streams and removes the per-session half of ORCH-VC-006’s persistent-EventSource inventory. File-watch completion remains S5; lifecycle/security/shutdown remains S6; combined 30-socket cross-browser/user acceptance remains S7.

## Assumptions, Risks, and Blockers

- The S4A registry/client/reducer API is accepted and sufficient; modifying its wire/server substrate is not an ordinary S4B fix.
- `recovering` is safe for prompt dispatch because S3 ready follows atomic hub attachment and the channel orders catch-up before live output. Waiting for `connected` alone could unnecessarily block on a large valid snapshot; waiting for `awaiting_ready` would precede server ready and is insufficient.
- Client-side cursor-observed HTTP composition is eventual, not linearizable. Any requirement for server-stamped HTTP generations conflicts with the existing-V1/no-new-protocol boundary and requires human clarification.
- The contained hidden policy is the minimum required: selected, local prompt claim, or canonical `active`. Arbitrary idle-history caching, all global-running sessions, and sidebar-hidden semantics are not authorized.
- Aggregate projected `active` does not alone classify prompt versus standalone compaction. Preserve local claim and HTTP prompt/compaction classification for completion eligibility; do not infer completion sound from aggregate settlement alone.
- Sticky refresh markers have no acknowledgement. Coalesce by observed revision/cursor and final settlement; never fetch every frame indefinitely or pretend to clear them.
- A hidden hook may miss transient notices/editor insertion by design; durable transcript/runtime state converges on reveal. Persisting/replaying those effects would be a prohibited journal.
- Browser/provider-backed evidence must remain sanitized. If Chromium, Firefox, or an authenticated provider cannot be exercised, record the concrete blocker and do not accept S4B; do not weaken the gate.
- Fresh production route inclusion remains release-owned under the no-build rule.
- The initial broad S4A fix run had a mechanical subagent acceptance configuration failure, but accepted source/finality is independently established at `11036f6`/`598f804`; it imposes no S4B behavior.

## Implementation Handoff

No implementation is authorized while this milestone is `Status: draft` or before its plan and matching checkpoint are committed. After root reconciliation and fresh independent draft review, change only `Status: draft` to `Status: approved`, commit the immutable plan/checkpoint boundary, record its blob, and launch one fresh sole `milestone-implementer` with S4B-VC-001 through S4B-VC-011, exact source/test/report boundaries, browser obligations, special handoff contract, preservation rules, and stop conditions.
