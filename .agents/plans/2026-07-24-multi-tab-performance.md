# Master Plan: Pi Web Multi-Tab Transport Correction

Status: approved

## Objective

Correct Pi Web's multi-tab stalls without reducing the existing product, requiring LAN TLS, changing the Pi SDK monorepo, or treating a browser/framework replacement as the remedy.

The correction replaces permanent browser-facing HTTP/1.1 EventSources with same-port WebSockets, projects generic Pi SDK snapshots into a bounded true-delta web protocol, preserves hidden live streams, and closes lifecycle/shutdown gaps.

Success means:

- five visible tabs supervising seven concurrent runs are an ordinary supported workload;
- 1/5/10 tabs and 1/7/10 runs are validated in Firefox and Chromium, with ten/ten treated as stress;
- ordinary HTTP commands remain schedulable while event streams are connected;
- visible and hidden active sessions receive every ordered true delta under normal operation;
- all existing Pi Web capabilities remain regression-protected;
- no runtime, subscriber, socket, timer, or owned server process leaks after its lifecycle ends;
- the user does not surface unacceptable responsiveness or behavior;
- implementation is delivered through context-bounded milestones rather than one oversized session.

## Master-Orchestration Contract

### Role of this file

This file is the stable source of truth for:

- objective and product boundaries;
- architecture and cross-milestone invariants;
- milestone dependency topology;
- the embedded milestone implementation deck;
- the master validation contract;
- integration and final closeout.

It is **not** an ordinary executable implementation plan. Do not pass this master to the existing one-plan/one-session `Open up implementation` transaction.

### Execution topology

- The user manually orchestrates one milestone at a time; no future orchestration extension or shared orchestration session is assumed.
- This master is a non-executable roadmap and stable source of cross-milestone invariants.
- Each milestone is drafted only after the preceding milestone has completed implementation and closeout.
- Each milestone receives its own ordinary approved plan, implementation session, worktree/branch lifecycle, checkpoint, validation, commit, guarded merge, archival, and cleanup.
- The next milestone is planned from updated local `main`, this master, the prior closed milestone plan/checkpoint, and the resulting code—not from the prior transcript.
- Milestone writers are therefore serial by construction. Read-only reviewers or validators may fan out within a milestone when independent.
- Current roadmap chain: `Master → M0 → M1 → M2 → M3 → M4 → M5 → M6`. Card granularity remains a roadmap estimate and can be refined before each milestone is drafted, without expanding the master outcome.

### Milestone plan and approval rules

- Do not create a milestone plan in the same `grill-to-plan` invocation that creates or revises this master; the skill permits one stable plan path per invocation.
- After this master is approved, the user explicitly invokes a fresh `grill-to-plan` session for M0.
- Each later milestone is likewise drafted in a fresh invocation only after the predecessor has closed out.
- A milestone plan records this master path, card ID, predecessor plan/checkpoint, prerequisite main commit, exact scope, exclusions, validation IDs, context envelope, and stop conditions.
- Every milestone plan remains `Status: draft` until separately confirmed; master approval does not silently approve implementation details written later.
- The master itself is never passed to `/start-implementation`.
- Scope expansion, card splitting, reordering, or changed cross-milestone invariants require a master amendment before the affected milestone is approved.

### Context and compaction contract

Each milestone is sized to:

- normally complete in one fresh GPT-5.6 272k context with no compaction;
- tolerate one compaction without risk because its checkpoint is current;
- tolerate at most two compactions before the agent must checkpoint and finish, stop blocked, or invoke the card's split rule;
- load only this master's invariants/architecture, the active card, the immediately preceding handoff, relevant source, and relevant tests—not prior implementation transcripts;
- end in a coherent, testable repository state rather than a broken midpoint;
- produce a compressed handoff containing commits, files, protocol/schema changes, validation evidence, residual risks, and the exact next entry condition.

Context size is governed by coupled state machines, debugging loops, and validation surfaces—not a rigid line or file count. A one-line change is not a useful milestone, while a card that combines multiple independently testable seams must be split.

### Milestone state and handoff

- The user's preferred milestone shape is a smaller coherent job with a clean test boundary, normally zero context compactions, and no more than two.
- The active milestone checkpoint is the compaction-safe execution ledger and records implementation evidence required by repository policy.
- A milestone cannot close merely because source edits exist; its plan exit gates, tests, telemetry evidence, commit, final summary, merge, archival, and cleanup must complete or be recorded blocked.
- After closeout, the user returns with the closed milestone. The next planning invocation reads the durable plan/checkpoint/commits and updates this master only when the roadmap or invariant state materially changes.
- A blocker prevents a dependent milestone from being drafted as executable unless the master is amended with a safe alternate path.

## Evidence and Current State

### Primary transport finding

- Every mounted `SessionSidebar` opens `/api/agent/running/events` (`components/SessionSidebar.tsx:408-427`).
- A selected/running session opens `/api/agent/[id]/events` (`hooks/useAgentSession.ts:588-643, 1405-1446`).
- `agent_end` changes UI state but does not close the per-session EventSource; its close sites are reconnection and `ChatWindow` unmount (`hooks/useAgentSession.ts:589, 1434`). A tab that has run a session normally retains two permanent SSE responses.
- The packaged launcher runs `next start`; installed Next 16.2.11 uses Node `http.createServer` (`bin/pi-web.js:43-49`; `node_modules/next/dist/server/lib/start-server.js:245-248`).
- The reproduced URL is direct `http://localhost:30141`, so the browser-facing incident path is HTTP/1.1 rather than an HTTP/2 proxy.
- MDN documents approximately six SSE connections per browser/domain over HTTP/1.1 across tabs and notes the Chrome/Firefox behavior is “Won't fix” ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
- Three previously active tabs can therefore retain six HTTP/1.1 connections and leave later ordinary requests queued before they reach an otherwise healthy server.
- The same progressive shape was observed in Firefox and Chromium, weighing against a Firefox-only defect.

### Quadratic event-boundary finding

- Pi Web forwards every raw SDK event through `JSON.stringify` (`app/api/agent/[id]/events/route.ts:38-41`; `lib/rpc-manager.ts:142-150`).
- For each provider delta, Pi core's `message_update` carries the real delta, a complete `assistantMessageEvent.partial`, and another complete `message` (`pi-agent-core/dist/agent-loop.js:207-225`; `pi-ai/dist/types.d.ts:347-390`).
- Shared references are convenient in-process, but JSON serialization traverses each representation.
- The browser ignores the available delta and replaces streaming state from `event.message` (`hooks/useAgentSession.ts:890-905`).
- For `n` equal chunks, sending prefixes costs `1 + 2 + … + n = n(n+1)/2` chunks instead of `n`; transfer, parsing, allocation, normalization, and repeated rendering therefore grow quadratically at fixed chunk size.
- Pi Web also forwards accumulated tool updates, full `agent_end.messages`, and unused SDK fields/events.
- Pi Web does not require this raw representation; a web-specific projector can transmit true deltas and one canonical snapshot at initial/recovery/final boundaries.

### Lifecycle findings

- `AgentSessionWrapper.destroy()` clears local registry/listener state but does not call the SDK's required `inner.dispose()` (`lib/rpc-manager.ts:535-546`; SDK `agent-session.js:556-572`).
- The current wrapper idle interval is ten minutes.
- Production Next can await `server.close()` indefinitely while upgraded/streaming connections remain; the current launcher lacks signal forwarding and a bounded ownership-aware forced cleanup (`bin/pi-web.js:43-74`; Next `start-server.js:336-342`).
- Read-only browsing does not start an `AgentSession`; that separation is correct and must remain.

### Secondary measured costs, explicitly deferred

- Selected-session loading parses and returns the complete JSONL/tree/context; `useAgentSession` retains it all.
- `ChatWindow` constructs the complete rendered element array before slicing its last 50 items; minimap/ref work scales with loaded history.
- `SessionManager.listAll()` scans and parses every session JSONL body; Pi Web caches the result for 30 seconds.
- The existing root-route artifact is approximately 1.81 MB uncompressed / 523 KB gzip before common framework/runtime chunks; Prism and closed configuration surfaces are statically imported.
- These are real secondary scaling costs, but they are outside this protocol-focused implementation unless post-correction validation returns the task to planning.

### Comparative evidence

- Nix Node V1 has an explicit default active-chat-stream admission limit of 500 and retained providerless evidence of 500 offered requests, 500 successes, and 500 completed SSE streams.
- Nix Bun V1 uses `Bun.serve`, `ReadableStream`, and true `response.delta`; its successful C500 harness was a Bun CLI HTTP client, not one browser's HTTP/1.1 EventSource pool.
- Bun V3 has no implemented runtime yet, but its specification budgets 1,000 attached Chat sockets and 3,101 application-owned file descriptors below a 4,096 FD limit.
- This confirms that ten or twenty accepted server sockets are not inherently excessive; the incident is the browser HTTP/1.1 scheduling boundary plus inefficient payload projection.
- Mozilla implemented a separate WebSocket quota partly so persistent sockets do not consume the ordinary HTTP pool, while still bounding abuse ([Mozilla bug 664305](https://bugzilla.mozilla.org/show_bug.cgi?id=664305); [Mozilla bug 1684694](https://bugzilla.mozilla.org/show_bug.cgi?id=1684694)). Exact browser limits vary, so this plan validates only the required 12 ordinary/20 stress topology.

### Provisional evidence requiring M0 reproduction

- Prior notes reported a healthy idle server, a 57 ms selected-session response, a 0.79 MiB response with 83 messages, about 222 MiB across 163 JSONL files, and 7.4 GiB for all Firefox tabs together.
- Those values are not final evidence; aggregate browser memory cannot be assigned wholly to Pi Web.
- Prior benchmark commands/artifacts have not been located.
- Three read-only subagent launches failed before startup because local `pi-subagents` could not resolve `typebox/compile`; no child evidence or mutation occurred.

## Fixed Decisions and Invariants

### Product and repository

- Preserve full-control Pi Web: session browsing/control, models/auth, tools/extensions/skills, files, worktrees, configuration, export, and remote-access compatibility.
- Preserve Next/React and the current server-owned in-process `AgentSession` model.
- Confine implementation, validation, documentation, and closeout to `/Users/xin/Documents/repos/pi-web`.
- Do not modify `/Users/xin/Documents/repos/pi`; any Pi SDK proposal is a separate follow-up.
- Preserve unrelated user changes, untracked plans, and `.pi-subagents/`.
- Do not run `next build` during development.

### Workload and acceptance

- Five tabs and seven concurrent runs are ordinary.
- Ten tabs and ten runs are stress.
- The user, not preset numeric latency/CPU/memory/network thresholds, is the responsiveness acceptance authority.
- Measurements remain mandatory diagnostic evidence.
- Required behavioral gates include no hangs, HTTP request starvation, lost/out-of-order events, monotonic resource leaks, or failed cleanup.

### Transport topology

- Browser event transport changes from HTTP/1.1 EventSource to same-port WebSocket.
- Direct HTTP uses `ws://`; an existing HTTPS front door uses page-derived `wss://`. LAN operation does not require new certificate management.
- Each loaded tab owns one lightweight global running-status WebSocket.
- Each live session subscription owns one independent session WebSocket; no tab-level or cross-tab multiplexing is introduced.
- Expected topology is approximately 12 sockets for five tabs/seven runs and 20 for ten tabs/ten runs.
- Hidden active sessions remain subscribed and receive every ordered true delta under normal operation.
- Navigating away never stops the server-side run.
- Global status subscriptions never create or touch `AgentSession` runtimes.

### Session lifetime

- A terminal event ends one agent turn, not the conversational session or socket.
- Session WebSockets and wrappers use a 30-minute semantic-idle timeout across turns.
- Prompts, commands, and agent events reset semantic idle; transport heartbeat does not.
- Active runs cannot expire.
- Tab/session release, disconnect, server shutdown, explicit destruction, or idle expiry closes the applicable connection immediately.
- A later command reconnects/recreates transparently after expiry.

### Event semantics

- Never serialize raw SDK events directly to the browser.
- Send every true text/thinking/tool-call delta under normal operation.
- Do not routinely drop or coalesce deltas.
- Send a complete canonical snapshot only at initial state, replay overflow/recovery, or final canonical boundaries.
- `agent_end` does not carry full message history.
- Events/fields unused by Pi Web are not transferred.
- A slow observer cannot create unbounded server memory or block the agent; it is disconnected retryably and reconciles.

### Trust boundary

- Preserve default loopback binding and existing optional hostname/Tailscale-compatible access without expanding public exposure.
- Browser bootstrap and upgrade require same-host `Origin` validation and a one-time same-origin ticket.
- Do not log tickets, raw prompts, message/tool content, secrets, credentials, full paths, or raw provider payloads.

## Scope and Non-Goals

### In scope

- HTTP/1.1/SSE baseline and WebSocket feasibility evidence.
- Same-port custom Next/Node server and published launcher changes.
- Secure transport ticket/gateway boundary.
- One global-status WebSocket per tab.
- Versioned projected event protocol, true deltas, sequence, replay, snapshot recovery, and slow-consumer behavior.
- One session WebSocket per live subscription and application-level hidden-session ownership.
- 30-minute semantic idle, SDK disposal, heartbeat, reconnect, signal handling, and shutdown.
- Existing capability compatibility and 1/5/10-tab plus 1/7/10-run validation.
- Master/milestone checkpoints, commits, documentation, memory, and final closeout.

### Non-goals

- Reduced viewer or capability trimming.
- Framework replacement.
- HTTP/2/TLS as a required product fix.
- Browser preference changes or origin sharding.
- Tab-level/cross-tab event multiplexing.
- Transcript pagination, session-index replacement, virtualization, dependency trimming, or other secondary optimization.
- Attaching to an already-running interactive Pi/TUI process.
- Pi-monorepo changes.
- Automatic scope expansion when validation fails; failures return to planning.

## Architecture Contract

### Same-port custom server

- Add `ws` as a direct runtime dependency and `@types/ws` as a development dependency.
- Update `package.json` and `package-lock.json`; do not opportunistically refresh the already-stale `bun.lock` unless implementation evidence establishes it as authoritative.
- Replace the spawned `next start` child with an official programmatic Next custom server in a plain Node module under `bin/`.
- One Node `http.Server` owns the Next request handler and `WebSocketServer({ noServer: true })` on the configured host/port.
- Use an unmatched reserved path such as `/_pi/websocket`; preserve Next development HMR on `/_next/webpack-hmr`.
- Use the same custom server for `npm run dev`, `npm start`, and the published `pi-web` bin.
- The owning process handles readiness, browser opening, signals, HTTP sockets, WebSockets, Next shutdown, and forced cleanup.

### Process-local gateway and ticket

- Install a versioned gateway on `globalThis` so the plain-Node server and Next-bundled route/runtime modules share one process-local boundary without the published bin importing TypeScript source.
- A same-origin bootstrap POST with `X-Pi-Web-Transport: 1` issues a single-use opaque ticket for `{ channel: "running" }` or `{ channel: "session", sessionId }`.
- Session bootstrap resolves/starts the existing wrapper before issuing its ticket.
- Ticket expiry is 30 seconds; the reserved-path upgrade consumes the query ticket once.
- Reject missing, expired, reused, wrong-origin, malformed, and over-limit attempts.
- Redact ticket and raw session identifiers from request/error logs.
- M0 must prove the custom server and Next route share the required `globalThis`; no second port or private Next monkeypatch is an implicit fallback.

### Safety constants

These are implementation safety/lifecycle bounds, not user-facing performance thresholds:

- 16 KiB maximum inbound WebSocket frame;
- 64 WebSockets per remote address;
- 256 WebSockets total;
- replay buffer: 4 MiB or 8,192 projected frames per wrapper, whichever comes first;
- 4 MiB maximum per-subscriber buffered output before retryable disconnect;
- 30-second ping interval and termination after a missed pong cycle;
- 10-second graceful shutdown deadline before ownership-checked socket termination;
- WebSocket per-message compression disabled unless later evidence justifies it.

### Versioned event protocol

- Define a discriminated protocol union in `lib/`; raw `AgentEvent` is never the wire type.
- Use a versioned envelope containing channel, type, monotonic sequence, session identity where applicable, and minimal payload.
- `message_start` sends the initial skeleton once.
- Text/thinking/tool-call update frames send `contentIndex` and only `delta`.
- Block-end frames send finalized block data only when required.
- `message_end` sends one final canonical message.
- `agent_end` omits `messages`.
- Retry, compaction, queue, tool lifecycle, extension UI/status/widget, error, and running-status events receive explicit minimal schemas.
- Ignored tool progress and unused SDK fields are not sent.

### Sequence, replay, and backpressure

- Each wrapper owns one monotonic event sequence, one current reduced streaming snapshot, and the bounded recent projected-event replay buffer.
- A session subscriber supplies its last sequence.
- Replay retained missing frames; otherwise send one current canonical snapshot with a new cursor and continue.
- Exercise replay overflow and reconnect races explicitly.
- Send every projected delta to draining subscribers in order.
- A subscriber over the output bound closes with a retryable reason and resumes/reconciles; it never blocks the agent or allocates without bound.

### Browser ownership

- Move transport ownership above keyed `ChatWindow` instances into an application-level registry/provider mounted by `AppShell`.
- The provider owns one global-status socket and a session-ID map of independent sockets/reduced states.
- `useAgentSession` subscribes to the selected registry entry.
- Changing the selected chat does not close or lose hidden active streams.
- Existing HTTP command, state, transcript, tree, and context APIs remain unchanged except for the new bootstrap endpoint.
- Remove both EventSource routes only after all browser callers and tests migrate.

### Lifecycle and shutdown

- Extend wrapper semantic idle from ten to 30 minutes.
- Support multiple wrapper destruction observers.
- Wrapper destruction closes subscribers and calls `inner.dispose()`.
- Ping/pong detects broken peers but never resets semantic idle.
- The custom server closes WebSockets, wrappers, Next, HTTP connections, timers, and global gateway state in ownership order.
- After the ten-second grace deadline, terminate only resources proven to belong to this server instance.
- Expose bounded server-instance/build identity so clients can detect stale/orphaned instances.

## Milestone Implementation Deck

### Deck summary

| ID | Milestone | Primary seam | Depends on | Context target | Expected compactions | Maximum |
|---|---|---|---|---|---:|---:|
| M0 | Baseline and transport feasibility | Evidence/custom-server boundary | Master approval | Medium | 0 | 1 |
| M1 | Custom server and global status | Launcher/gateway/status channel | M0 | Large | 0 | 1 |
| M2 | Versioned delta protocol core | Projector/sequence/replay | M1 | Medium | 0 | 1 |
| M3 | Server session WebSocket transport | Wrapper/session subscriptions | M2 | Medium-Large | 0 | 1 |
| M4 | Browser session migration | Provider/hooks/hidden streams | M3 | Large | 0-1 | 2 |
| M5 | Lifecycle, security, and shutdown | Idle/disposal/limits/signals | M4 | Medium-Large | 0 | 1 |
| M6 | System validation and closeout | Cross-browser/full product | M5 | Large | 0-1 | 2 |

### M0 — Baseline and Transport Feasibility

**Outcome**

Reproduce the current failure and prove or falsify the critical same-process, same-port custom-server seam before broad implementation.

**Entry requirements**

- Approved master and verified orchestration worktree.
- Clean milestone starting commit recorded in both checkpoints.
- No source writer active in the checkout.

**Scope**

- Create a sanitized/reproducible 1/5/10-tab and 1/7/10-run fixture or capture protocol.
- Capture direct HTTP/1.1 baseline: permanent SSE count, queued requests, event bytes, and user-visible stall shape in Firefox and Chromium where available.
- Build the smallest reusable or removable vertical proof of:
  - programmatic Next custom server;
  - same-port reserved WebSocket upgrade;
  - ordinary App Router API operation;
  - development HMR coexistence;
  - a ticket issued by a Next route and consumed by the custom-server listener through shared `globalThis`.
- Verify package/runtime assumptions without running `next build`.

**Exclusions**

- No global-status migration.
- No session protocol or client-provider migration.
- No second-port fallback or private Next monkeypatch.

**Validation and evidence**

- Baseline network trace and concise machine-readable summary.
- Loopback WebSocket vertical test.
- HMR remains operational.
- `node_modules/.bin/tsc --noEmit`, relevant Node tests, and `npm run lint` for retained code.
- Any temporary proof code is either promoted as the M1 foundation or removed before exit.

**Telemetry**

- Server instance, upgrade attempted/accepted/rejected, route/gateway process identity, and cleanup outcome; no content/tickets logged.

**Exit gate and handoff**

- Feasibility proven with retained foundation commit or a clean no-source feasibility commit/report.
- Master checkpoint records baseline artifacts and exact M1 entry commit.
- If route and upgrade do not share the required process or Next claims the path, stop blocked and return to master planning.

**Validation IDs:** VC-001, VC-005, VC-009, VC-010, VC-012.

### M1 — Custom Server and Global-Status Migration

**Outcome**

Pi Web runs through one production-intended custom server, and every loaded tab receives running badges over one secure global-status WebSocket instead of SSE.

**Scope**

- Add direct `ws`/types dependencies and npm lock changes.
- Implement the custom server, launcher parity, gateway/ticket bootstrap, same-host `Origin` checks, basic limits, and page-derived `ws://`/`wss://` URL.
- Use the custom server for dev/start/published bin.
- Add the application-level provider shell needed for one tab-global status connection.
- Migrate `SessionSidebar` from global EventSource to global-status WebSocket.
- Remove the global running SSE route after no callers remain.
- Preserve per-session SSE temporarily.

**Exclusions**

- No per-session WebSocket or true-delta migration.
- No wrapper idle/disposal change beyond cleanup needed by the new server foundation.

**Validation and evidence**

- One status WebSocket per 1/5/10 loaded tabs.
- Immediate badge updates, reconnect, and initial snapshot.
- Status connections do not create/touch wrappers.
- Ordinary APIs and development HMR remain functional.
- CLI host/port/browser-open behavior and `npm pack --dry-run` pass.
- Existing full-control UI remains available.

**Telemetry**

- Ticket issue/consume/reject, global socket connect/disconnect, subscriber count, running snapshot count, server identity.

**Exit gate and handoff**

- Global EventSource has no browser callers and its route is removed.
- Per-session SSE remains the only temporary permanent HTTP stream and is explicitly recorded for M3/M4.
- Coherent custom-server/global-status commit and checkpoint handoff.

**Validation IDs:** VC-004, VC-005, VC-008, VC-009, VC-010, VC-011, VC-012.

### M2 — Versioned Delta Protocol Core

**Outcome**

A tested server-side protocol projector and event hub can convert raw Pi SDK events into ordered, bounded web events without changing the browser session path yet.

**Scope**

- Define the versioned discriminated event union and exhaustive raw-event projector.
- Implement true text/thinking/tool-call deltas and minimal lifecycle/error/extension schemas.
- Omit ignored updates, repeated partial snapshots, full `agent_end.messages`, and unused fields.
- Implement monotonic sequence, current reduced snapshot, replay buffer, overflow-to-snapshot recovery, and protocol reducer fixtures.
- Integrate the hub with wrapper events behind a server interface usable by M3.

**Exclusions**

- No session WebSocket endpoint or browser hook migration.
- No renderer, transcript, index, or capability changes.

**Validation and evidence**

- Synthetic long text/thinking/tool-call streams prove encoded bytes scale with actual deltas rather than repeated prefixes.
- Exact ordering and final canonical equality.
- Exhaustive event mapping/type checks.
- Replay hit, replay overflow, snapshot recovery, duplicate sequence, and unknown-version tests.
- No raw SDK event reaches the protocol serializer.

**Telemetry**

- Projected event/frame/byte count, dropped-field class, replay-buffer occupancy class, replay versus snapshot outcome.

**Exit gate and handoff**

- Stable protocol version and server subscription interface documented in checkpoint.
- Projector/hub commit is usable by a Node session transport without browser assumptions.
- If a required provider event lacks an actionable delta, stop and amend the master rather than silently returning to growing snapshots.

**Validation IDs:** VC-006, VC-007, VC-013, VC-012.

### M3 — Server Session WebSocket Transport

**Outcome**

The server supports secure independent session WebSockets with snapshot/replay/reconnect/backpressure while the browser can still use the old per-session SSE path.

**Scope**

- Add session bootstrap/ticket handling and wrapper resolution/startup.
- Bind each accepted session WebSocket to the M2 hub.
- Implement initial snapshot, last-sequence resume, retained replay, overflow recovery, and retryable slow-consumer close.
- Apply inbound frame, connection, ticket, and queue limits.
- Support multiple independent subscribers to one wrapper.
- Ensure transport disconnect does not stop an active server run.
- Test with Node WebSocket clients independently of React.

**Exclusions**

- No browser session registry migration.
- Do not remove per-session SSE yet.
- No final 30-minute/shutdown hardening beyond correctness required for this server path.

**Validation and evidence**

- One and multiple subscribers receive identical ordered deltas.
- Reconnect from retained sequence and overflow snapshot both converge.
- Slow observer cannot block the agent or grow memory without bound.
- Invalid origin/ticket/version/frame/limit attempts fail safely.
- HTTP commands remain schedulable alongside session WebSockets.

**Telemetry**

- Session subscribe/resubscribe, replay/snapshot recovery, buffered-byte class, retryable close reason, wrapper/subscriber counts.

**Exit gate and handoff**

- Node-client public-surface integration passes with no raw event leakage.
- Browser-facing server contract and reducer input are frozen for M4.
- Coherent server session-transport commit and handoff.

**Validation IDs:** VC-004, VC-005, VC-006, VC-010, VC-013, VC-012.

### M4 — Browser Session Migration and Hidden Streams

**Outcome**

The browser uses one independent WebSocket per live session subscription, preserves hidden streams across navigation, applies true deltas, and no longer uses EventSource.

**Scope**

- Complete the application-level transport registry/provider above keyed `ChatWindow` instances.
- Own session socket/reduced-state entries by session ID.
- Adapt `useAgentSession`, `ChatWindow`, and related state/reconciliation paths to the registry.
- Connect before prompting, keep the socket across terminal turns, and reconnect transparently when required.
- Apply text/thinking/tool-call deltas and final canonical reconciliation.
- Keep hidden active subscriptions alive when selection changes.
- Preserve queued messages, retry, compaction, extension UI/status/widget, tools, completion sound, branch navigation, and current command semantics.
- Remove per-session EventSource callers and then remove its route.

**Exclusions**

- No transcript pagination, virtualization, minimap redesign, or feature trimming.
- No tab-level/cross-tab multiplexing.
- Final process shutdown/idle hardening remains M5.

**Validation and evidence**

- Visible and hidden sessions receive every ordered delta under normal operation.
- Navigate away/back during text, thinking, tool use, retry, and compaction without gaps or ghost bubbles.
- Final browser state equals canonical transcript after `agent_end`.
- Reconnect and snapshot recovery do not duplicate messages.
- No EventSource remains in browser code or network inventory.
- Existing rich rendering and full-control flows remain visibly correct.

**Context split rule**

If this card reaches a second independently testable seam before client migration is stable, amend the deck into:

- M4A: provider/registry, reducer, and reconnect integration while SSE remains fallback;
- M4B: hook migration, hidden-session ownership, EventSource removal, and visual regression.

Do not split into untestable partial hook rewrites, and do not exceed two compactions without the amendment.

**Telemetry**

- Active tab-global/session socket counts, selected/hidden subscriber state, reducer event counts, reconnect reason, render count, and canonical reconciliation outcome.

**Exit gate and handoff**

- Both EventSource routes and callers are gone.
- Five-tab/seven-run smoke flow works before M5 hardening.
- Coherent client migration commit(s), complete checkpoint, and explicit M5 lifecycle gaps.

**Validation IDs:** VC-001, VC-003, VC-004, VC-005, VC-006, VC-007, VC-011, VC-013, VC-012.

### M5 — Lifecycle, Security, and Shutdown Hardening

**Outcome**

The new transport has deterministic 30-minute semantic idle, SDK disposal, heartbeat, security bounds, and ownership-safe process shutdown.

**Scope**

- Extend wrapper idle from ten to 30 minutes using a named constant and fake-clock tests.
- Ensure commands/events reset semantic idle while ping/pong does not.
- Prevent active runs from expiring.
- Support multiple destruction observers and close all session subscribers on wrapper expiry/destruction.
- Call `inner.dispose()` exactly once.
- Complete ping/pong, ticket expiry/reuse rejection, connection/frame/replay/output bounds, and slow-client cleanup.
- Implement ordered SIGINT/SIGTERM shutdown across listener, WebSockets, wrappers, Next, HTTP sockets, timers, and gateway globals.
- Enforce the ten-second ownership-checked forced cleanup fallback and stale server identity behavior.
- Verify direct `ws://` and proxy-compatible `wss://` construction/origin behavior.

**Exclusions**

- No product redesign or secondary performance work.
- No public remote-access expansion.

**Validation and evidence**

- Below-30-minute multi-turn reuse; above-30-minute transparent reconnect.
- Heartbeat-only traffic does not extend idle.
- Active run survives past the idle interval.
- Tab close, network loss, idle expiry, wrapper destruction, and server stop reclaim owned resources.
- Repeated lifecycle cycles show no monotonic subscriber/timer/runtime leak.
- Rejected cross-origin, missing/reused ticket, oversized frame, excessive connection, and slow-consumer tests.
- Signal test proves no owned process/socket remains after the shutdown deadline.

**Telemetry**

- Runtime start/semantic-touch/idle-expire/dispose, ping failure, security rejection class, shutdown stage/outcome/duration, forced cleanup count.

**Exit gate and handoff**

- Lifecycle/security/shutdown validation is complete with no critical waiver.
- Full source/package checks pass.
- Coherent hardening commit and M6 acceptance packet.

**Validation IDs:** VC-003, VC-004, VC-009, VC-010, VC-012.

### M6 — System Validation, Regression, and Closeout

**Outcome**

The complete protocol correction is validated across required scale and capabilities, accepted by the user, documented, merged, archived, and cleaned up.

**Scope**

- Run full 1/5/10-tab and 1/7/10-run Firefox/Chromium matrix.
- Capture active/queued HTTP requests, WebSocket counts, projected versus raw bytes, ordering, reconnect, long tasks, memory ownership caveats, and cleanup.
- Exercise all existing Pi Web capabilities affected directly or indirectly by launcher/transport changes.
- Validate loopback and available existing Tailscale/proxy compatibility without changing trust configuration.
- Fix only bounded defects that remain within approved architecture and card scope.
- Update master/milestone checkpoints, relevant wiki/current-state docs, durable memory, reports, and closeout records when materially required.
- Complete commits, guarded local-main merge, archival, and standard orchestration worktree/branch cleanup.

**Exclusions**

- No transcript/index/render/framework/product optimization.
- No Pi-monorepo changes.
- No redesign to satisfy an issue outside the master contract.

**Validation and evidence**

- All validation-contract assertions resolved as pass, blocked, or explicitly inapplicable with rationale.
- User does not surface unacceptable behavior.
- No HTTP/1.1 EventSource remains.
- Five/seven and ten/ten do not hang or starve commands.
- All milestone commits and artifact paths recorded.
- No dirty plan/checkpoint/memory/wiki/report bookkeeping is left silently.

**Stop rule**

If acceptance fails because of a secondary non-protocol cost or architectural flaw, record the profile and stop blocked. Create a new planning cycle; do not expand M6 into unrelated optimization.

**Telemetry**

- Final diagnostic summary only; no new user-facing telemetry surface.

**Exit gate and handoff**

- User acceptance, complete master checkpoint, final implementation commit set, guarded merge evidence, archived plan/report state, and standard worktree cleanup.

**Validation IDs:** VC-001 through VC-013.

## Cross-Milestone Test Strategy

### Commands

- `node_modules/.bin/tsc --noEmit`
- `npm run lint`
- `node --test lib/*.test.mjs`
- `npm pack --dry-run`
- `npm run dev` for integrated browser validation on port 30141

`next build` is prohibited during development and is not a validation command. Production-bundle regeneration remains a release-workflow responsibility; M1/M5 must still validate custom-server source, development behavior, package contents, and production `.next` loading assumptions without polluting `.next`.

### Isolated coverage

- event projection and delta reducers;
- sequence/replay/overflow/snapshot recovery;
- ticket/origin/limit handling;
- global and session subscription lifecycle;
- fake-clock ticket, heartbeat, shutdown, and 30-minute idle boundaries;
- slow-consumer behavior;
- wrapper disposal and multiple destruction observers;
- launcher option and package-file behavior.

### Public-surface integration

- programmatic Next startup and reserved-path upgrade alongside HMR;
- route-issued ticket consumed by the custom server;
- running-status and session WebSockets;
- ordinary HTTP availability while all streams are connected;
- command-triggered runtime startup;
- reconnect, replay, canonical recovery, abort, retry, compaction, tools, extensions, branches, and session navigation;
- signal shutdown and orphan detection.

### Browser/user flows

- 1/5/10 loaded tabs, each with exactly one status WebSocket;
- 1/7/10 live session subscriptions;
- visible and hidden concurrent runs;
- navigation away/back during streaming;
- idle below/above 30 minutes using controlled clocks where possible;
- background/foreground, offline/online, refresh, tab close, and server restart;
- existing full-control capability matrix;
- current Firefox and one Chromium-based browser.

### Evidence rules

- Use sanitized/synthetic fixtures; never commit private session content.
- Distinguish browser-owned Pi Web memory from aggregate browser memory.
- Measurements are diagnostic rather than numeric acceptance thresholds.
- Visual evidence is required for streamed Markdown, syntax, math, Mermaid, thinking, tools, status, and reconnect behavior.
- Live remote validation uses only an existing approved endpoint; otherwise record it blocked and keep loopback mandatory.

## Telemetry / Debuggability

The implementation uses development-only counters and sanitized server logs; it adds no user-facing diagnostics surface.

Required bounded signals:

- `transport_ticket`: issue/consume/reject with bounded reason;
- `websocket_connection`: upgrade/connect/disconnect with channel/outcome;
- `websocket_subscription`: subscribe/resubscribe/hidden/selected state counts;
- `event_projection`: projected type/frame/byte counts and omitted-field class;
- `event_recovery`: replay hit/snapshot fallback/overflow/outcome;
- `slow_consumer`: buffered-byte class, retryability, and close outcome;
- `runtime_lifecycle`: start/semantic-touch/idle-expire/dispose/outcome;
- `server_shutdown`: stage/outcome/duration/forced-owned-resource count;
- random server-instance/build identity for stale-instance correlation.

Privacy/cardinality boundaries:

- no prompts, message bodies, tool payloads, media, secrets, credentials, auth material, full paths, full provider payloads, tickets, or raw session identifiers;
- use ephemeral or hashed correlation only;
- bound reason enums, counters, and retention;
- no per-token content logging.

## Validation Contract

Assertions use behavioral correctness and user acceptance rather than preset numeric performance thresholds.

| ID | Priority | Surface | Required truth | Required evidence | Mode | Primary milestone |
|---|---|---|---|---|---|---|
| VC-001 | P0 | UI performance | Five tabs/seven runs remain responsive; ten/ten does not hang; user surfaces no unacceptable interaction behavior. | Firefox/Chromium traces, interaction evidence, user acceptance. | both | M0, M4, M6 |
| VC-002 | P1 | Existing APIs | Transcript/context/tree/branch behavior remains compatible; no pagination/index redesign enters scope. | Existing and focused API regression tests. | scrutiny | M4, M6 |
| VC-003 | P0 | Browser resources | Repeated runs show no monotonic timer/transport/resource leak; owned client resources release after close/expiry. | Repeated-cycle and post-close browser evidence with ownership caveats. | both | M4, M5, M6 |
| VC-004 | P0 | Runtime lifecycle | Read-only browsing creates no runtime; explicit control creates only required runtime; 30-minute reuse/expiry, active-run protection, disposal, and reconnect are correct. | Integration counters/tests across run, abort, idle, disconnect, expiry, recreate. | scrutiny | M1, M3, M5 |
| VC-005 | P0 | Network/cross-browser | Ordinary HTTP remains schedulable; approximately 12 ordinary/20 stress WebSockets work in Firefox and Chromium without relying on HTTP/1.1 SSE slots. | Direct-H1 baseline and corrected WebSocket inventories at 1/5/10 tabs and 1/7/10 runs. | both | M0, M1, M3, M4, M6 |
| VC-006 | P0 | Session correctness | Delta assembly, final reconciliation, reconnect, appends, compaction, branches, fork metadata, and navigation preserve exact order without gaps/duplicates. | Frame/recovery fixtures and public UI/API flows. | both | M2, M3, M4, M6 |
| VC-007 | P1 | Rich UI | Markdown, syntax, math, Mermaid, thinking, tools, and extension UI remain correct when assembled from deltas. | Existing tests plus screenshots/recordings. | both | M2, M4, M6 |
| VC-008 | P1 | Session index | Existing session metadata remains correct and independent of WebSocket subscription count. | Existing tests and cold/warm multi-tab regression evidence. | scrutiny | M1, M6 |
| VC-009 | P0 | Server/package/shutdown | One-process server preserves CLI/package/HMR behavior and leaves no orphan after graceful or ownership-checked forced shutdown. | Custom-server/HMR/signal tests, `npm pack --dry-run`, lifecycle counters. | scrutiny | M0, M1, M5, M6 |
| VC-010 | P0 | Security/privacy | Binding and diagnostics preserve trust boundary; origin/ticket/frame/connection/rate bounds reject abuse without leaking content. | Static/config review and rejected cross-origin/ticket/frame/limit tests. | both | M0, M1, M3, M5 |
| VC-011 | P1 | Product surface | Every current Pi Web capability remains usable; nothing is reduced to a viewer. | Capability matrix and user flows. | both | M1, M4, M6 |
| VC-012 | P0 | Execution state | Master and every milestone checkpoint record inputs, findings, commands, artifacts, commits, validators, risks, and exact handoff/closeout state. | Direct checkpoint/deck review at every gate. | scrutiny | M0-M6 |
| VC-013 | P0 | Event efficiency | Visible/hidden runs receive ordered true deltas; wire/client work scales with actual deltas rather than repeated growing snapshots; unused fields are absent. | Synthetic long streams with encoded/decoded bytes, ordering, navigation, reconnect, and final equality. | scrutiny | M2, M3, M4, M6 |

Blocker rules:

- VC-001/003 may use isolated browser processes when per-tab attribution is unavailable; aggregate memory alone is not proof.
- VC-005 requires user testing if one browser's automation tooling is blocked.
- VC-009 waives `next build` only because repository instructions prohibit it during development; custom-server/package/dev validation has no waiver.
- VC-010 blocks remote control if the existing trust boundary cannot be preserved.
- VC-011 has no capability-removal waiver in this plan.
- VC-012 has no silent waiver; blocked closeout must be recorded as blocked.
- VC-013 permits a non-delta provider only after an explicit master amendment defining a bounded alternative; raw growing snapshots are not acceptable.

## Assumptions, Risks, and Stop Conditions

- The abrupt third/fourth-tab stall is led by the confirmed direct HTTP/1.1 topology and permanent SSE occupancy; M0 still captures the queued-request evidence.
- Repeated full accumulated payloads are the next strongest active-stream cost and are corrected by M2-M4.
- Same-process `globalThis` sharing between the custom server and Next route bundle is a feasibility assumption. M0 blocks before broad edits if false.
- Next custom-server upgrade handling must coexist with HMR and package layout; M0/M1 validate rather than relying only on source comments.
- Query tickets are ephemeral secrets; any logging surface must redact them.
- WebSockets are not inherently safer than SSE; origin/ticket/limit controls are mandatory.
- Browser WebSocket has no automatic EventSource reconnect or end-to-end backpressure; explicit sequence/recovery and slow-consumer handling are mandatory.
- Extending wrappers from ten to 30 idle minutes increases runtime retention; M5/M6 measure and verify cleanup without imposing a preset memory threshold.
- The M4 client migration is the highest context-risk card and has the only predeclared implementation split.
- Secondary transcript/index/render/bundle costs remain deferred. If they prevent acceptance after protocol correction, M6 stops and opens a new planning cycle.
- The stale `bun.lock` must not be opportunistically rewritten as collateral to npm dependency work.
- Read-only subagent corroboration is currently unavailable because of the local `typebox/compile` failure; this does not authorize unreviewed scope expansion.
- No milestone may modify the sibling Pi repository, create nested worktrees, or write local main outside guarded final closeout.

## Master Closeout Contract

Each executable milestone performs its own ordinary guarded closeout to local `main` before the next milestone is drafted. M6 may mark the roadmap complete only after:

1. every milestone plan/checkpoint is closed, explicitly blocked, or superseded by an approved master amendment;
2. every milestone implementation has already merged to local `main` through its own closeout;
3. VC-001 through VC-013 have recorded outcomes and evidence;
4. user acceptance is recorded;
5. required wiki/memory/report updates are complete;
6. the master and final milestone records list every milestone plan, checkpoint, commit, artifact, and residual risk;
7. M6's own guarded merge, archival, and cleanup succeed;
8. this master is updated on local `main` with final roadmap status and archived only through the applicable planning/closeout workflow.

A failed milestone merge, archival, cleanup, or source-plan reconciliation leaves that milestone blocked and prevents drafting its dependent successor as executable.

## Implementation Handoff

No implementation is authorized by this master, whether draft or approved. This file is a roadmap and must never be passed to `/start-implementation`.

This master is approved. The next action is a new explicit `grill-to-plan` invocation—permitted in the same conversation—that creates only the M0 executable plan. M0 receives its own approval and, only afterward, its own handoff:

```text
/start-implementation <approved-M0-plan-path>
```

After M0 closes out, the user returns to draft M1 from durable repository state. No M1 plan is created before then.
