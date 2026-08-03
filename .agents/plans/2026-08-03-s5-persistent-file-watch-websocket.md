# S5: Persistent File-Watch WebSocket

Status: draft

## Objective

Complete only the S5 persistent file-watch migration authorized by the approved [Pi Web persistent-stream WebSocket orchestration master](./2026-07-30-persistent-stream-websocket-migration.md), starting from accepted S4B implementation commit `80eea2247860241f0632cd1fc272d25ddcbbbe5b` and final checkpoint commit `2d37c9888c34b112d069f4093d69136543986079`.

Replace the four long-lived file-watch EventSources in `components/FileViewer.tsx` with one independently authorized same-port WebSocket for the currently mounted file viewer. Add the static metadata-bound `file-watch` gateway channel, factor and reuse the file API's exact allowed-root-or-session-reference authorization decision for every ticket, bind only the normalized authorized target in the one-use server-side ticket context, and allocate exactly one `fs.FSWatcher` only after successful ticket consumption and upgrade. Preserve every non-watch file API and image/audio/PDF/DOCX/text/Markdown/HTML rendering behavior, recover across modification, deletion/recreation, socket/server interruption, path/source-session changes, and unmount, then remove the persistent `watch` HTTP response and all file EventSource callers.

S5 does not add heartbeat/ping, change semantic idle, redesign admission or shutdown grace, migrate OAuth login SSE, alter session/global protocols or browser ownership, run final combined scale, update maintained product documentation, or claim user/visual acceptance. Success means:

- each mounted active `FileViewer` owns one exact-path file-watch WebSocket and its consumed server subscription owns one watcher;
- inactive internal file tabs are unmounted and own no watcher, while a CSS-hidden but still mounted active viewer retains its one watcher until actual unmount or path/source-session change;
- every ticket reauthorizes the current path through the same server decision used by file GET, binds a path-safe opaque context, and never starts or retains an `AgentSession`;
- no watcher exists before ticket consumption and upgrade dispatch;
- connected/change delivery is versioned, strict, path-free, bounded, stale-instance-safe, and sufficient to preserve all current refresh metadata and rendering behavior;
- modify, atomic replace, delete, recreate, reconnect, path switch, viewer unmount, handler/watch failure, and server shutdown release or recover exactly as assigned without stale updates or duplicate watchers;
- every non-watch file list/read/download/meta/preview/upload behavior remains unchanged;
- no persistent file-watch EventSource or `?type=watch` route remains, leaving short-lived OAuth login as the only production EventSource;
- Chromium and Firefox prove live refresh, deletion/recreation, reconnect, topology, cleanup, and ordinary HTTP responsiveness with sanitized evidence.

## Design / Implementation Strategy

### 0. Preserve accepted lineage and the S5 boundary

S1-S4B are accepted and immutable at the lineage above. Reuse the V1 same-port gateway, one-use ticket route, direct-peer admission, static-channel HMR pattern, page-derived `ws://`/`wss://` clients, and custom-server socket teardown. Do not change their product or protocol semantics.

The only current production EventSources are four file-watch callers and one short-lived OAuth login caller. S5 removes the four file callers and the file route's persistent response only after focused, full, server, and browser parity pass. OAuth remains untouched. No advisory reference-pointer companion exists for the master.

### 1. Factor the exact file authorization decision and extend ticket bootstrap

Extract one server-only helper from `app/api/files/[...path]/route.ts` for the current decision:

1. obtain the current allowed roots through `getAllowedFileRoots()`;
2. authorize lexical normalized containment through `isFilePathAllowed()`; or
3. for non-list file operations only, authorize an exact reference through `isFilePathReferencedBySession(filePath, sessionId)`.

The existing GET route and file-watch ticket issuer must both call this helper. Do not copy the logic, replace it with a weaker prefix check, add an AgentSession dependency, or harden only watch access differently from current read access. Preserve Windows path/case behavior and the current explicit session-reference semantics. Record the existing allowed-root symlink policy as a retained system boundary rather than redesigning it in S5.

Extend ticket parsing with only these exact request objects:

```ts
{ channel: "file-watch", path: string }
{ channel: "file-watch", path: string, sessionId: string }
```

Reject missing/excess keys, relative/empty/NUL/control-bearing paths, malformed optional session IDs, unsupported content types, invalid transport headers/origins, overlong UTF-8 paths, directories, and unauthorized or unavailable targets before ticket issue. Normalize the accepted absolute path with the same POSIX/Windows rules used by file access. Support an exact maximum 4,096-byte normalized path; raise the ticket route's still-bounded JSON body ceiling only as much as necessary to carry that request, with exact boundary tests and no relaxation of shape/origin/channel checks.

Reauthorize every ticket request, including reconnects. Ensure the static `file-watch` channel before issue and place only a frozen, versioned, owner-branded authorized target context in the gateway ticket record. The response remains only `{ticket, expiresAt}`; the WebSocket URL contains only the opaque ticket. The context must not expose the path or optional source session to the client, diagnostics, close reason, or errors.

Require a regular file at ticket issue to preserve current watch admission. If the connected target is later deleted, keep the accepted directory watcher alive for recreation; if the socket is lost while the file is absent, bounded client ticket retries may receive a finite unavailable response until recreation makes a new ticket possible.

### 2. Add a strict static protocol and subscription-owned watcher channel

Add a small V1 file-watch protocol with static channel name `file-watch`. Frames are strict, exact-key, JSON text frames and contain only finite metadata needed by viewers:

- one first `connected` frame after watcher allocation and initial target observation;
- zero or more `change` frames carrying a connection-local monotonic change count plus `exists` and bounded nonnegative `size` metadata;
- protocol/version/server-instance fields sufficient for stale-server rejection.

Do not serialize path, basename, session ID, ticket, mtime/timestamp, content, raw filesystem event, address, or raw error. The browser sends no file-watch application frame. Binary/client messages are policy failures rather than alternate control paths.

Register one HMR-safe production handler through a `Symbol.for` record matching the accepted running/session patterns. Validate the exact frozen ticket context before allocation. Only a successfully consumed and upgraded subscription may allocate one watcher. The subscription—not the browser page, path, optional source session, or AgentSession wrapper—owns the watcher, socket listeners, one bounded coalescing timer, send state, and cleanup.

Watch the containing directory and filter to the exact target basename with platform-appropriate comparison so atomic replacement and recreation remain observable. A missing callback filename may trigger one bounded target restat, never sibling data delivery. Coalesce duplicate/burst events into the latest target observation with at most one pending timer and one latest pending change; do not busy poll or grow an event queue. Register the directory watcher before the initial stat, then send `connected` from the resulting current target state so attach cannot miss a change silently.

One idempotent cleanup path closes the watcher and timer exactly once on setup failure, malformed context, send failure, watcher error, socket close/error, path/viewer replacement through client close, and existing custom-server WebSocket termination. A watcher/internal failure closes the socket retryably. Keep output bounded by coalescing to one latest pending change and fail/reconnect rather than accumulating when send/buffer state is invalid. Existing server shutdown already terminates accepted Pi Web sockets; S5 proves that socket teardown synchronously releases watchers. General all-channel ownership joining, heartbeat, grace, and forced-shutdown policy remain S6.

### 3. Add one stale-safe browser client and one mounted-viewer hook

Add a runtime-neutral `FileWatchClient` following the accepted global/session client resource pattern:

- exact same-origin ticket POST with transport header, `no-store`, credentials, current path, and optional source session;
- page-derived `ws:`/`wss:` URL with only the opaque ticket;
- strict ticket and frame parsing;
- one monotonically increasing resource epoch guarding ticket promises, sockets, callbacks, timers, and path/source-session changes;
- bounded exponential reconnect for ticket/socket/server/watcher interruption;
- backoff reset only after a valid `connected` frame, not TCP open;
- stop that aborts bootstrap, cancels timers, closes the current socket, and suppresses every stale callback;
- terminal handling for unsupported protocol until an explicit new client/path mount, while ordinary unavailable/malformed/close failures retry finitely.

Expose connection state plus current change metadata through a small controller/hook seam. Use one common hook for the one mounted `FileViewer`; do not add file watches to `SessionRegistryProvider`, the global socket, or a page-wide path registry, and do not multiplex paths. AppShell already renders only the active internal file tab. Preserve its actual semantics: switching/closing the active tab unmounts the old viewer, while closing the right panel by CSS does not unmount an active viewer and therefore does not release its still-mounted watch.

### 4. Preserve all four viewer refresh behaviors and close initial/recovery races

Replace the duplicated EventSource effects with the common hook while retaining variant-specific behavior:

- **Image:** update optional size, clear a deletion/load error on a later valid change, and cache-bust/remount the image so recreation recovers natural dimensions.
- **Audio:** update size, clear duration/error, and cache-bust/remount audio metadata.
- **PDF/DOCX:** preserve initial HTTP `meta`, PDF `read`, DOCX `preview`, sandbox/CSP, 10 MiB limit, size/error transitions, and iframe cache bust.
- **Text/Markdown/HTML:** preserve initial `read`, Markdown default preview, HTML/Markdown toggles, syntax/wrap state, previous-content diff, and real change count; clear a prior deletion/read error after successful recreation.

Start the watcher and ordinary initial HTTP load without allowing an attach gap or stale overwrite. A valid `connected` frame performs one current-path synchronization, but it must not fabricate a text diff/change count when content is unchanged. Guard every read/meta refresh by the current file path, source-session generation, and newest request token; stale initial or burst responses from an old path/socket may not update the new viewer. Coalesce refresh work so duplicate filesystem callbacks do not create an unbounded fetch queue. A later successful current response clears the corresponding transient deletion/read error.

Keep all content transport over the existing HTTP read/meta/preview/download APIs. WebSocket frames only trigger and annotate refresh; they never carry file bytes or rendered content.

### 5. Remove persistent file SSE only after parity passes

After channel/client/viewer integration and browser evidence pass:

- remove `watch` from `FILE_REQUEST_TYPES`;
- delete the file route's `ReadableStream`/`text/event-stream` watcher branch;
- remove all four `new EventSource` callers and EventSource refs/comments from `FileViewer`;
- update the exact inventory test to require zero agent/file EventSources and exactly one OAuth login EventSource.

Do not alter any non-watch GET/POST branch or OAuth flow.

### 6. Preserve later milestone boundaries

Do not add ping/pong or heartbeat, change ten-minute semantic idle, define command/event touch policy, change session replay/output bounds, redesign 64/256 admission, add a ten-second shutdown grace, build a generalized resource registry, modify wrapper cleanup, or use private Next state. S6 owns those lifecycle/security/shutdown outcomes. S5 may prove its existing admission participation and watcher release when the custom server terminates its sockets, because those are intrinsic to the new channel.

Do not run the combined ten-page/30-socket matrix, rich visual/capability matrix, maintained docs/memory updates, or user acceptance; S7 owns them. Do not migrate OAuth, change port/TLS, edit the Pi monorepo, add dependencies, or run `next build`.

### Scope estimate

- **Expected production surfaces:** shared file authorization helper; `app/api/files/[...path]/route.ts`; `app/api/transport/ticket/route.ts`; new `lib/file-watch-protocol.ts`, `lib/file-watch-channel.ts`, and `lib/file-watch-client.ts`; `components/FileViewer.tsx`; only narrowly required typed gateway/test helpers.
- **Expected tests:** authorization and ticket matrices; protocol/parser/client pure tests; channel/fs/custom-server integration; mounted FileViewer behavior tests; EventSource inventory; existing admission/HMR/real-development regressions; sanitized Chromium/Firefox report.
- **Normally unchanged:** session/global protocols, projector/hub/reducer/clients/registries/hooks; `rpc-manager`; AppShell ownership; non-watch file APIs; OAuth; bin gateway/server production behavior; package/dependencies; maintained docs/memory.
- **Complexity:** medium-large, one compaction maximum. Highest risks are authorization drift, platform `fs.watch` replacement behavior, stale path/read responses, duplicate watcher cleanup, and viewer error recovery.
- **Stop condition:** any need for a second port, new browser ownership rule, file bytes over WebSocket, weaker file authorization, session-wrapper ownership, unbounded polling/queueing, OAuth migration, generalized S6 lifecycle redesign, or validation waiver is material divergence.

## Reference Files

- [Approved orchestration master](./2026-07-30-persistent-stream-websocket-migration.md)
- [Accepted S4B plan](./2026-08-02-s4b-hook-migration-hidden-streams.md) and [checkpoint](../checkpoints/2026-08-02-s4b-hook-migration-hidden-streams-checkpoints.md)
- Accepted S4B implementation/finality `80eea2247860241f0632cd1fc272d25ddcbbbe5b` / `2d37c9888c34b112d069f4093d69136543986079`
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md) and [memory index](../memory/MEMORY.md)
- [Repository instructions](../../AGENTS.md)
- `app/api/files/[...path]/route.ts`
- `lib/file-access.ts`
- `lib/session-file-references.ts` and `lib/session-file-references-core.ts`
- `app/api/transport/ticket/route.ts`
- `lib/websocket-gateway.ts` and `bin/pi-web-transport-gateway.js`
- `bin/pi-web-server.js`
- `lib/global-status-channel.ts`, `lib/session-channel.ts`
- `lib/global-status-client.ts`, `lib/session-transport-client.ts`
- `components/FileViewer.tsx`, `components/AppShell.tsx`, `components/TabBar.tsx`
- `components/GlobalStatusProvider.test.mjs`
- `lib/websocket-ticket-route.test.mjs`, `lib/websocket-gateway.test.mjs`, `lib/pi-web-server.test.mjs`, `lib/pi-web-real-next.test.mjs`
- Recoverable S5 planning investigation `80f6ecbd-4d6e-4ddc-ad96-d09284ab8cc7`, outputs under `.pi-subagents/artifacts/outputs/80f6ecbd-4d6e-4ddc-ad96-d09284ab8cc7/`

No advisory reference-pointer companion exists for the master. The sibling Pi monorepo is not required and remains untouched.

## Constraints, Decisions, and Current State

### Fixed constraints

- One browser page instance may own several independent Pi Web sockets, but one mounted file viewer owns exactly one file-watch socket. Do not share it across pages, paths, sessions, or inactive tabs.
- A browser page, optional source session, and file path do not own server work beyond the consumed watcher subscription. No file ticket may start an AgentSession.
- Ticket authorization is server-authoritative and repeated on every reconnect. Client path/query data after ticket issue cannot retarget the watcher.
- Existing file reads use lexical allowed-root containment plus exact session-reference fallback. Preserve that decision consistently; do not claim new symlink hardening.
- Use sanitized temporary fixtures. No path, basename, session ID, ticket, file content, timestamp, credential, address, or raw error enters diagnostics or committed evidence.
- Preserve direct HTTP/LAN use and same-port page-derived WebSockets without mandatory TLS.
- Never run `next build` during development. Fresh production route inclusion remains release-owned.
- Preserve `.pi-subagents/` runtime state and unrelated dirt.

### Established facts

- S4B is accepted: agent persistent EventSources/routes are gone; global/session WebSockets and HTTP commands are authoritative; current production EventSource inventory is exactly four file-watch callers plus one OAuth caller.
- `FileViewer` has four duplicated watch effects keyed by `filePath` and `sourceSessionId`. AppShell mounts only the active file tab; right-panel CSS visibility does not remove the active viewer from the tree.
- Current SSE authorization is the shared file GET decision followed by an existing regular-file stat.
- Current `fs.watch(filePath)` can emit a size-zero change on deletion but does not prove atomic replacement/recreation portability.
- Image and text viewers can remain stuck after a deletion error because later successful refresh paths do not always clear the prior error.
- The custom server terminates accepted Pi Web sockets before gateway/Next cleanup; a socket-close-owned watcher can therefore release during current shutdown without adding S6 grace policy.

### Resolved S5 decisions

- **Watcher strategy:** one containing-directory watcher filtered to the authorized basename, with bounded event coalescing and target restat, is the required deletion/recreation seam.
- **Reconnect while absent:** connected subscriptions remain through target absence; a lost subscription retries bootstrap until the regular file is available again.
- **Panel semantics:** mounted lifetime is authoritative. An inactive file tab is unmounted; a panel hidden only by CSS remains mounted and watched.
- **Wire content:** versioned connected/change metadata only. File content and paths remain HTTP/server-side.
- **Initial convergence:** connected triggers a guarded current-path synchronization without a false diff; newest request/path generation wins.
- **Body/path bounds:** permit a 4,096-byte normalized path with a correspondingly bounded ticket JSON body and exact tests.

## Test Strategy

### Pure authorization, protocol, and client

Require table tests for:

- allowed-root and exact session-reference success; denied, missing, malformed, wrong, stale, sibling-prefix, list/reference, Windows, NUL/control, relative, directory, absent, 4,096-byte, and one-over cases;
- exact ticket body keys, content type/header/origin, one-use/expiry/revocation, opaque context, reconnect reauthorization, no AgentSession startup, and zero watcher before consume/upgrade;
- strict connected/change parsing, unknown version/type/excess keys, binary/client-message rejection, bounded count/size/server identity, and path/content absence;
- ticket/bootstrap/socket failures, synchronous throws, epoch/stale callbacks, duplicate events, unsupported protocol, bounded reconnect, valid-connected backoff reset, stop/unmount/path/source-session change, and listener throws.

### Channel, filesystem, and server integration

Use injected clocks/watchers plus real temporary filesystem/custom-server cases for:

- exactly one watcher allocated after successful ticket consumption and handler dispatch;
- connected-first ordering with no attach gap;
- modify, burst coalescing, atomic rename-save, delete, recreate, and modify-after-recreate; sibling changes ignored;
- filename string/Buffer/null variants and platform-aware exact basename filtering;
- setup/stat/send/buffer/watcher/socket errors, duplicate close, retryable close, HMR reuse/replacement, ticket revocation, and exact-once watcher/timer cleanup;
- mixed running/session/file-watch admission and release under existing 64/256 limits;
- ordinary HTTP schedulability while watches are active;
- custom-server close reducing active file watchers to zero without private Next cleanup or S6 grace behavior.

### Mounted viewer compatibility

Add an actual React DOM harness with fake client and deferred HTTP responses. Cover:

- one client for the one mounted viewer; image/audio/document/text variants never duplicate it;
- active-tab/path/source-session switches stop old resources before current delivery; inactive tabs own none; CSS-hidden mounted panel retains one;
- connected synchronization plus stale initial/read/meta responses cannot overwrite a newer path;
- duplicate/burst changes coalesce and newest response wins;
- image cache bust/size/natural dimensions and recreation error recovery;
- audio size/duration/error reset and remount;
- PDF/DOCX meta, limit, preview/read URL, iframe/sandbox behavior and recovery;
- text/Markdown/HTML initial/read/preview/wrap/diff/change-count behavior, unchanged connected sync without false diff, deletion error, and recreation success;
- download, linked-file opening, and every non-watch file API remain unchanged;
- StrictMode/unmount and late callbacks produce exact stop and no state update.

### Browser evidence

Run sanitized real Chromium and Firefox flows against the custom development server:

1. text/Markdown, image, audio, PDF, and DOCX mounted viewers connect and refresh after modification;
2. text and image at minimum pass delete, same-path recreate, and atomic replacement; document/media metadata remains correct;
3. forced socket loss, offline/online, server restart, and ticket retry recover without stale watcher or stale path update;
4. path and source-session changes during ticket/bootstrap/reconnect close the old subscription and authorize the new one;
5. multiple internal file tabs still expose exactly one mounted viewer socket; repeated switching/closing cleans prior watchers; CSS-hidden mounted panel retains one until actual unmount;
6. an exact session-referenced path outside ordinary roots succeeds only with its valid source session, while absent/wrong references fail;
7. ordinary file/session/model HTTP remains responsive;
8. network inventory shows one global socket, applicable session socket, one socket per mounted file viewer, zero agent/file EventSources, and OAuth as the sole source-level EventSource.

S7 retains combined 10-page/30-socket stress and user/rich visual acceptance.

### Required commands and evidence

Run:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test <focused S5 protocol/client/channel/authorization/viewer/server tests>
node --test lib/*.test.mjs components/*.test.mjs
node --test $(find lib components -maxdepth 1 -name '*.test.mjs' ! -name 'pi-web-real-next.test.mjs' -print | sort)
node --test lib/pi-web-real-next.test.mjs
npm pack --dry-run
git diff --check
```

Run literal, exact non-real-Next, and real-Next separately. Do not run `next build`. With absent release manifests, only the named production child/parent may fail at `.next/BUILD_ID`; terminal and real development must pass. Package evidence is shape-only.

Before acceptance, the root must inspect the complete diff and authorization factoring, prove zero pre-consume watcher allocation and exact cleanup, verify non-watch APIs and protected S6/S7 boundaries, run privacy/source/EventSource/no-stage/hash gates, collect Chromium/Firefox evidence, and obtain one fresh independent no-edit/no-delegation review.

## Telemetry / Debuggability

Use only optional bounded development/test diagnostics:

- ticket authorization outcome: `allowed_root`, `allowed_session_reference`, `denied`, `invalid`, `unavailable`;
- channel lifecycle: `registered`, `reused`, `connected`, `changed`, `closed`;
- active watcher count class: `zero`, `one`, `many`;
- change state: `present`, `absent`, and coalesced count class;
- client stage: `bootstrap`, `socket`, `connected`, `change`, `reconnect`, `stop`, `terminal`;
- finite close/error class: `client`, `stale`, `ticket`, `protocol`, `watcher`, `send`, `server`.

Never log or emit path, basename, session ID, ticket, content, size values in diagnostics, timestamps, addresses, credentials, raw close reasons, or raw `Error` strings. Product frames may carry bounded `exists`, `size`, change count, and server identity; diagnostic sinks may expose only classes/counts. Verify diagnostics with hostile values and throwing sinks.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|---|
| S5-VC-001 | P0 | Orchestration/scope | One immutable S5 plan, one source writer, verified handoffs/fix loops/reviews, coherent boundary commits; only file-watch authorization/channel/client/viewer/SSE removal enters scope. | Plan/checkpoint, run identities, Git status/history/diff. | scrutiny | Overlapping writer, protected protocol/lifecycle drift, later-milestone work, or uncommitted ambiguity blocks. |
| S5-VC-002 | P0 | Authorization/ticket | Every ticket uses the exact shared allowed-root-or-session-reference decision, exact bounded body and same-host header/origin checks, regular-file admission, fresh reauthorization, and an opaque one-use bound context; no AgentSession starts. | Authorization/ticket matrices, wrapper-start counters, context inspection. | scrutiny | Weaker/duplicated authorization, retargetable context, path leak, wrapper creation, or stale authorization blocks. |
| S5-VC-003 | P0 | Watch ownership/cleanup | No watcher exists before consumed upgrade dispatch; each subscription owns exactly one watcher and bounded timer/send state, all released exactly once on every failure, close, HMR/server teardown, path change, and unmount. | Fake watcher counters, real fs/custom-server integration, repeated teardown. | scrutiny | Pre-consume allocation, duplicate/stale watcher, leaked timer/socket, or non-owned cleanup blocks. |
| S5-VC-004 | P0 | Protocol/client | Strict path-free connected/change frames, current-server/resource epoch, same-origin ticketing, page-derived WS URL, bounded reconnect/coalescing, and stale-callback suppression converge without carrying file content. | Protocol/client exhaustive tables and reconnect/path-switch flows. | scrutiny | Path/content leak, malformed acceptance, stale update, unbounded queue/retry, or wrong URL/ownership blocks. |
| S5-VC-005 | P0 | Deletion/recreation | Modify, atomic replace, deletion, recreation, and later modification converge on the same authorized target without sibling events, busy polling, duplicate watchers, or stuck error UI. | Real fs tests and Chromium/Firefox text/image flows. | both | Missed recreation, sibling leakage, watcher duplication, or unrecoverable viewer blocks. |
| S5-VC-006 | P0 | Viewer compatibility/topology | Image/audio/PDF/DOCX/text/Markdown/HTML refresh semantics and non-watch HTTP behavior remain; exactly one socket exists per mounted active viewer, inactive tabs own none, and mounted CSS-hidden viewer behavior is preserved. | Mounted React tests, browser network inventory, capability checks. | both | Broken rendering/metadata/diff/download, duplicate/missing socket, or tab/panel lifetime regression blocks. |
| S5-VC-007 | P0 | Persistent SSE removal | File `watch` HTTP mode and all four file EventSource callers are gone; no agent/file EventSource remains and OAuth login is the sole short-lived production EventSource. | Static inventory, route/source absence, browser network inventory. | both | Remaining persistent caller/route or OAuth removal blocks. |
| S5-VC-008 | P0 | Server/admission/shutdown | File-watch sockets participate in existing 64/256 admission, HMR registration, same-port CLI/package behavior, and current server socket teardown without changing S6 policy. | Mixed-channel cap/re-admission, HMR, package, real-development, server-close watcher counters. | scrutiny | Leaked capacity/watcher, second port, private Next cleanup, or premature S6 redesign blocks. |
| S5-VC-009 | P0 | Browser/recovery | Chromium and Firefox prove refresh, delete/recreate, reconnect/offline/restart, path/tab cleanup, valid reference authorization, no SSE, and responsive HTTP. | Sanitized browser report and server/client counters. | both | Browser-only stale/missed update, unauthorized access, wrong topology, starvation, or missing browser evidence blocks. |
| S5-VC-010 | P0 | Privacy/diagnostics | Frames, logs, diagnostics, errors, and evidence are bounded and expose no private path/name/session/ticket/content/address/raw error data. | Static scan, hostile diagnostics tests, report review. | scrutiny | Sensitive or attacker-controlled output blocks. |
| S5-VC-011 | P0 | Gates/finality | Typecheck, lint, focused/full/real-Next/package/whitespace/hash/source/no-stage gates and every review/browser disposition are recoverable; implementation/finality commits name all residual boundaries. | Commands, checkpoint, report, Git inspection. | scrutiny | Hidden skip, false production claim, unsupported acceptance, or incomplete evidence blocks. |

S5 completes the file-watch portion of ORCH-VC-006 and advances ORCH-VC-008/009/011/012 only for this channel. S6 retains semantic idle, heartbeat, generalized backpressure/ownership, and graceful deadline. S7 retains combined ORCH-VC-010 scale, full compatibility/visual/user acceptance, maintained documentation, and final persistent-EventSource inventory acceptance.

## Assumptions, Risks, and Blockers

- Parent-directory `fs.watch` is the chosen cross-recreation seam, but callback duplication/coalescing and filename availability vary by platform. Tests assert eventual target convergence and exact ownership, not one callback per write.
- Existing read authorization is lexical and may follow symlinks. S5 must preserve exact parity and not claim a new realpath security property; a broader policy change requires separate authority.
- Ticket issue requires a current regular file. Reconnect while absent is expected to retry until recreation; the already-connected directory watcher remains the primary delete/recreate owner.
- The gateway has no accepted-owner shutdown callback. Current server socket termination must demonstrably close watchers; generalized resource joining/grace remains S6.
- Connected synchronization can race initial HTTP. Request generations and current-path checks are mandatory so no stale response or false diff survives.
- Browser filesystem fixtures for audio/PDF/DOCX may validate reload/metadata rather than media fidelity. S7 retains rich visual/user judgment.
- Fresh production route inclusion remains release-owned under the no-build rule.
- If a safe deletion/recreation implementation requires polling, multiple simultaneous watchers per subscription, a weaker authorization model, or server lifecycle changes beyond socket-owned cleanup, stop for material-divergence review.

## Implementation Handoff

No implementation is authorized while this milestone is `Status: draft` or before its plan and matching checkpoint are committed. After root reconciliation and fresh independent draft review, change only `Status: draft` to `Status: approved`, commit the immutable plan/checkpoint boundary, record the plan blob, and launch one fresh sole `milestone-implementer` with S5-VC-001 through S5-VC-011, exact source/test/report boundaries, browser obligations, special handoff contract, preservation rules, and stop conditions.
