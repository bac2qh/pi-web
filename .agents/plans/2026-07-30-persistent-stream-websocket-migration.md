# Orchestration Master: Pi Web Persistent-Stream WebSocket Migration

Status: approved

<!-- orchestrator-skill-body:start -->
## Orchestrator Mission Workflow

### Authority and source-writing boundary

This section is the frozen operating contract for this approved master. Read the complete exact master before acting. Derive only the next contained milestone from its Objective, Design / Implementation Strategy, fixed constraints, Test Strategy, Telemetry / Debuggability, and Validation Contract. If those sections do not supply enough authority for one unambiguous contained milestone, stop and ask the user rather than inventing scope or intent.

The orchestration root remains the decision-making parent. It owns interpretation, just-in-time milestone planning and approval, delegation, verification, checkpoint recording, commits, progression, final validation against the full master, and ordinary guarded closeout. The root may write plans, checkpoints, and other orchestration evidence, but it must never edit implementation source. Master approval delegates only contained milestone planning; it does not delegate scope expansion, weaker validation, waivers, privacy changes, external side effects, or a new interpretation of the master.

Do not add or operate a scheduler, workflow engine, mutable orchestration state file, work graph, lease, receipt protocol, copied reference bundle, custom compactor, custom closeout, retry daemon, automatic cleanup, or archival mechanism.

### Continuity and advisory reference evidence

Before selecting or accepting work, reconcile the exact master with the current repository state, accepted milestone summaries, milestone plans and checkpoints, commits, recoverable child results, and selected material reference evidence. The current milestone plan, its matching checkpoint, Git history, and recoverable child result are the ordinary continuation record after resume or compaction.

The optional `<master-plan-stem>-reference-pointers.json` companion is advisory evidence under the approved nonrecursive pointer policy. Read only selected pointed files that materially clarify the current milestone, directly or through fresh read-only support. Do not recursively discover references, copy or mutate referenced files, treat the companion as launcher preflight, or let a reference expand scope or override the master. Record a mismatch, and treat it as material divergence only when it makes the approved direction infeasible or materially ambiguous.

### Just-in-time milestone planning

Keep exactly one milestone active. Before launching any implementation or fix writer:

1. Select only the next outcome contained by the master.
2. Create one milestone plan and one matching checkpoint in the ordinary repository locations.
3. Keep the milestone plan `Status: draft` until its objective, Design / Implementation Strategy, scope estimate, Test Strategy, Telemetry / Debuggability, and numbered Validation Contract are complete and contained by the master.
4. Approve the milestone plan under the authority delegated by this master and commit the plan and checkpoint before implementation begins.
5. Treat the milestone plan as immutable when its first implementation or fix writer starts. Checkpoint evidence may record outcomes and departures but can never expand or waive its scope.

Do not prepare a later milestone while the current milestone is unresolved. Do not use a milestone to reinterpret, weaken, or amend the master.

### One-writer implementation and fix loop

Only when this workflow is embedded in an explicitly finalized orchestration master, launch one fresh `milestone-implementer` at depth one as the sole implementation-source writer. Its packet must identify the exact master, immutable milestone plan, matching checkpoint, selected references actually used, file or responsibility boundaries, applicable Validation Contract IDs, required checks, special handoff contract, preservation rules, and stop or escalation conditions.

Only that depth-one milestone implementer may launch fresh read-only support at depth two. Depth-two support must be explicitly prohibited from editing, creating, deleting, moving, or rewriting project files; approving plans; committing; closing out; or delegating further. The implementer must not launch another writer. The root must not overlap implementers, fix writers, milestones, or its own source edits. The globally tracked runtime ceiling is two and mechanically blocks depth three; the ordinary-root one-level rule remains prompt policy rather than runtime role isolation.

A bounded defect that can be corrected without changing the immutable milestone remains in a sequential fix loop under that same milestone. Issue one focused fix attempt at a time, then repeat root verification and fresh independent review. Do not create a replacement milestone merely to make a defect disappear, and do not continue indefinitely when a new decision or material divergence is required.

### Special implementation or fix handoff

Require every implementation or fix attempt to return one evidence-rich handoff to the orchestration root. It must include:

- `Recorder` or intended root recipient, exact `Source` run/session identity, `Kind`, governing master and milestone, and `Mode` (`implementation` or `fix`);
- every issued milestone obligation and Validation Contract ID;
- actual changes, files, behavior surfaces, and responsibilities touched;
- references used and how they affected the work;
- commands and tests with outcomes;
- validation coverage and missing evidence;
- departures from obligations, blockers, uncertainty, and residual risk;
- remaining work and the recommended next action.

The child never writes the caller's checkpoint. The root verifies the returned claims and, when the result is material, records the corresponding `## Handoff` entry using the existing checkpoint fields. Put role-aware `Recorder`, `Source`, `Kind`, governing-plan, and `Mode` details inside those field values; do not invent a new checkpoint heading, receipt, or handoff-file protocol.

### Root verification, review, and acceptance

Never accept, summarize, commit, or progress from a child claim alone. Inspect the actual repository state and diff; map every claimed obligation to the immutable milestone; inspect command and test evidence; verify selected references; and obtain a fresh independent review with explicit no-edit and no-delegation constraints. Reject an incomplete or unsupported handoff.

Classify review findings against the immutable milestone. Send bounded implementation defects through the sequential fix loop. Stop for a planning or authority gap. Before accepting a milestone or planning the next one, reconcile the exact master with the accepted milestone summary, milestone plan and checkpoint, commits, current repository state, recoverable child evidence, and selected references. Record accepted evidence through the ordinary Handoff and Implementation Summary templates, then commit the coherent milestone boundary.

### Mandatory pause on material divergence

Distinguish these cases:

- A bounded in-scope implementation defect stays in the current milestone's sequential fix and review loop.
- An advisory reference mismatch is recorded but does not override the master unless it makes the approved direction infeasible or materially ambiguous.
- Material divergence exists when continued work would require revising scope, weakening validation, waiving an obligation, undoing an approved direction, or choosing between incompatible interpretations of the master.

On material divergence, stop. Do not create or approve another milestone, launch another writer, reinterpret or waive the master, or conceal the conflict as a fix. Preserve the current state and record the affected master sections, milestone plans, commits, implementation facts, reference evidence, and unresolved human decision in the current checkpoint. Ask the user for clarification. Resume only after explicit direction that remains within the existing master, or after a separately approved follow-up plan supplies new authority.

### Full-master validation and ordinary closeout

After all contained milestones are accepted, validate the complete repository result against the full master and its entire Validation Contract. Resolve any bounded defect through the same immutable-milestone fix discipline; pause on any material conflict. Complete the required Implementation Summary and implementation commit evidence, then use the ordinary guarded closeout defined by global policy. Retain the task branch and worktree. Do not archive, clean up, delete, or add orchestration-specific closeout behavior automatically.
<!-- orchestrator-skill-body:end -->

## Objective

“Multi-tab” is only the historical incident symptom and a required load-test shape. It is not a product concept, session-ownership rule, browser-behavior dependency, or architecture name. Pi Web is already a server and remains one: ordinary commands, session reads, files, and other request/response APIs continue over HTTP. This master migrates only persistent browser event delivery from long-lived HTTP/1.1 EventSource/SSE responses to same-port WebSockets.

Under direct HTTP/1.1, a browser shares an approximately six-connection same-origin request pool across its loaded Pi Web pages. Every permanent global-status, session-event, or file-watch EventSource occupies one of those connections, so a combination of streams—not necessarily six sessions—can exhaust the pool and leave ordinary HTTP requests queued for as long as the streams retain every slot. WebSockets leave that ordinary HTTP/1.1 request pool after upgrade, which removes the starvation mechanism. Browser-page counts remain in this master only to reproduce and validate the affected workload.

This user-designated orchestration master governs the remaining Pi Web persistent browser-transport correction after completed M0. It supersedes only the old manual roadmap's remaining execution authority; the approved [original master](./2026-07-24-multi-tab-performance.md), both M0 plans, checkpoints, and commits remain immutable history.

Starting from main commit `145405d9e4c8a09e28f196ecddcf2c4fd5b84ade`, migrate every persistent browser EventSource—the two agent-facing streams and file watching—to same-port WebSockets, replace repeated growing SDK snapshots with a bounded true-delta protocol, preserve hidden live sessions and all current capabilities, and finish lifecycle/security/system acceptance without changing the Pi monorepo or requiring LAN TLS. OAuth login SSE remains a deliberately short-lived interactive exception.

Success means:

- each loaded browser page instance owns one global running/discovery WebSocket and no global agent-status EventSource;
- every live server wrapper is projected and sequenced independently of browser subscriber count;
- each browser session subscription uses one independent session WebSocket and no per-session agent EventSource;
- each mounted live file viewer owns an independently authorized file-watch WebSocket, and no persistent file-watch EventSource remains;
- `running` and `sessions_changed` initial/reconnect semantics remain exact and global status never starts an `AgentSession`;
- visible and locally retained hidden session views receive ordered true deltas, while any newly attached or recovered view converges to the same canonical server state through replay or snapshot recovery;
- ordinary HTTP commands remain schedulable at five browser tabs/seven runs and ten browser tabs/ten runs;
- 30-minute semantic idle, backpressure, heartbeat, connection limits, exact-once disposal, and ownership-safe shutdown are correct without undoing M0's process-scoped Next development contract;
- current full-control Pi Web behavior remains regression-protected;
- Firefox, Chromium, and user responsiveness/visual acceptance gates pass;
- one orchestration root executes contained milestones through one task branch/worktree, milestone boundary commits, full-master validation, and one ordinary guarded closeout;
- the orchestration root progresses continuously through S1-S7; after ordinary milestone acceptance it immediately selects the next milestone, and it pauses only under the embedded material-divergence rule or at the final user acceptance gate.

## Design / Implementation Strategy

### Authority, lineage, and execution shape

- Prerequisite main: `145405d9e4c8a09e28f196ecddcf2c4fd5b84ade`.
- Retained M0 foundation implementation: `a4f1c4a2caac02f8de39134cd77b58afb2a58ee4`; synchronization `15a447057345534a6721eb3fbc3437f96d083038`; final checkpoint `145405d9e4c8a09e28f196ecddcf2c4fd5b84ade`.
- M0 already provides the custom server, reserved upgrade, V1 gateway, ticket route, package/launcher parity, basic owned cleanup, HMR coexistence, and process-scoped development boundary. Do not reimplement them.
- `/orchestrate-implementation` creates one `orchestration-<plan-stem>` worktree/session from committed main. The orchestration root writes plans/checkpoints/evidence and commits but never implementation source; one `milestone-implementer` writes source for the active milestone.
- Keep one milestone active. Commit each accepted boundary on the orchestration branch; do not merge, archive, or delete between milestones. Perform one full-master validation and guarded merge only after all authorized milestones finish.
- A hosted launch acknowledgement means ownership and kickoff scheduling, not prompt acceptance or mission completion. The target session is the control and observation surface after publication.

### Continuous progression and material-divergence gate

This master authorizes uninterrupted sequential progression through S1-S7 in the same orchestration target. Once a milestone is verified, independently reviewed, summarized, and committed, the root selects the next contained milestone without a routine human pause. S1 is the first contained production boundary, not a pilot stop.

The complete workflow embedded above is the controlling orchestration prompt contract. Its **Mandatory pause on material divergence** section requires the root to stop and raise the issue to the user only when observed implementation or reference facts make the approved direction infeasible or materially ambiguous, require scope revision or weaker validation, undo an approved direction, or force a choice between incompatible master interpretations. Bounded in-scope defects remain in the current milestone's sequential fix loop; hypothetical risk and resolvable reference mismatch do not trigger a human pause.

### Remaining architecture

- Preserve one same-port process gateway and page-derived `ws://`/`wss://`.
- Register HMR-safe production handlers for a static `running` channel and later metadata-bound `session` and `file-watch` channels; do not use dynamic session IDs or file paths as channel names.
- Extend bootstrap so `{channel:"session", sessionId}` resolves/starts the wrapper under existing locks and stores authorized session context only in the one-use server-side ticket record. File-watch bootstrap must validate the path and optional source session through the existing file-access boundary and store only the authorized resolved watch context in the ticket record.
- Project raw wrapper events into a versioned discriminated protocol before serialization. Send true text/thinking/tool-call deltas, minimal explicit lifecycle/extension frames, and canonical snapshots only at initial/recovery/final boundaries.
- Give each wrapper one monotonic sequence, reduced current state, and bounded replay. The server hub projects every live wrapper independently of WebSocket subscriber count; disconnect slow subscribers retryably rather than blocking the agent or growing memory without bound.
- Mount browser transport ownership above keyed `ChatWindow` instances. A client registry owns one global socket and one entry per session view it currently needs; selection changes do not discard a locally active hidden stream. Browser page identity and connection history never determine server run ownership, event capture, canonical state, or which sessions appear in the sidebar. A newly attached view always resumes by sequence or receives a canonical snapshot.
- Give each mounted live file viewer one independently authorized watch socket matching its current mount/path lifetime; close and recreate it on unmount or path change without changing file rendering or refresh behavior.
- Preserve HTTP command/state/transcript/tree/context and non-watch file APIs plus existing agent polling/reconciliation until equivalent WebSocket recovery is proven.
- Reconcile `rpc-manager`'s independent signal cleanup with custom-server ownership before final shutdown hardening; preserve exact-once native disposal, multiple destruction observers, and active-run idle protection already delivered outside the old roadmap.

### Contained milestone deck

| ID | Outcome | Main boundary | Depends on | Estimate |
|---|---|---|---|---|
| S1 | Global running/discovery WebSocket migration | Gateway admission caps, production channel, browser-page-global owner, sidebar migration, global SSE removal | M0 | Medium-large; 0-1 compaction |
| S2 | Projected session protocol and hub | Frame union, projector, reducer, sequence, replay, canonical snapshots | S1 | Large; 0-1 |
| S3 | Secure server session WebSocket | Metadata-bound ticket, wrapper hub, replay/recovery/backpressure, Node clients | S2 | Large; 0-1 |
| S4A | Browser session registry/reducer | Provider, client, registry entries, cursors, pure recovery tests | S3 | Large; 0-1 |
| S4B | Hook migration and hidden streams | `useAgentSession`, retained hidden ownership, per-session SSE removal | S4A | Large; 0-2 |
| S5 | Persistent file-watch WebSocket | Authorized watch channel, viewer migration, watcher cleanup, file-watch SSE removal | S4B | Medium-large; 0-1 |
| S6 | Remaining lifecycle/security/shutdown | 30-minute idle, heartbeat, all-channel ownership, graceful deadline | S5 | Large; 0-1 |
| S7 | System acceptance boundary | Combined cross-browser scale, capability regression, docs/memory, user acceptance | S6 | Large; 0-2 |

The root may split a card only at the stated S4A/S4B boundary or when a card contains two independently testable seams and both resulting outcomes remain fully contained. It must stop for any new product choice, weaker gate, architecture change, or scope expansion.

### S1 global-status outcome

- Before registering the first production channel, add gateway-wide admission accounting based on the direct socket peer address: admit at most 64 concurrent Pi Web WebSockets per address and 256 total, reject the 65th/257th before handler dispatch, release counts exactly once on every failure/close path, and never trust forwarded-address headers.
- Register one hot-reload-safe `running` production channel through the existing gateway.
- Deliver initial and changed `runningSessionIds` plus monotonic/replayable `sessions_changed` generation.
- Add one browser-page-global WebSocket owner above sidebar/chat, with same-origin ticket fetch, page-derived URL, reconnect, and stale-instance handling sufficient for this channel.
- Preserve authoritative global-status transition behavior, running-to-idle unread/refresh edges, stale list suppression, and retryable generation application.
- Prove the channel never starts or touches an `AgentSession`.
- Remove the global running SSE caller and route only after migration/tests pass; preserve per-session SSE unchanged.
- Do not repeat the accepted HTTP/1.1/SSE root-cause investigation; collect only the sanitized post-migration connection and request-schedulability evidence required to validate S1.

### S2-S3 server protocol outcomes

- S2 defines every currently consumed native and Pi-Web wrapper frame explicitly, with true deltas, final equality, bounded sequence/replay, overflow snapshot recovery, unknown-version handling, and byte-growth evidence. No raw SDK event reaches the serializer.
- S3 extends bootstrap with server-authorized session metadata, resolves wrappers under existing startup locks, supports independent subscribers, initial snapshot/cursor resume/replay/overflow recovery, bounded output, retryable slow-consumer close, and disconnect without aborting the run. Existing HTTP commands remain authoritative and schedulable.

### S4A-S4B browser outcomes

- S4A creates the application-level registry and pure reducer/recovery seam without an untestable partial hook rewrite.
- S4B connects before prompts, adapts selected-session state, retains locally active hidden views where needed for seamless UI, and never makes browser page identity the owner of a server run. It preserves queue/retry/compaction/tools/extensions/branch/reconciliation behavior, then removes the per-session EventSource caller and route.
- The server projector remains authoritative for every live wrapper even with zero browser subscribers. Polling/reconciliation remains until equivalent sequence/snapshot recovery is demonstrated; no optimistic fallback is deleted merely because a socket exists.

### S5-S7 completion outcomes

- S5 adds a static metadata-bound `file-watch` channel with an exact bounded bootstrap body `{channel:"file-watch", path, sessionId?}`. Factor and reuse the file API's existing allowed-root-or-session-reference authorization decision rather than adding a parallel weaker check; reauthorize every new ticket; bind the accepted server-side watch context so the client cannot alter it after issue; and allocate one `fs.FSWatcher` only after successful ticket consumption and upgrade. The consumed subscription/server instance—not the browser page or optional source-session wrapper—owns that watcher. Report connected/change metadata without private-path diagnostics, reconnect safely, and close on handler failure, watcher error, deletion/recreation handling, socket close, path/viewer change, and server shutdown. Preserve image/audio/document/text refresh behavior and every non-watch file API, then remove all `FileViewer` EventSource callers and the route's persistent `watch` response.
- S6 changes semantic idle from ten to 30 minutes, defines command/event touch rules, excludes heartbeat touches, protects active work, adds ping/pong, revalidates S1's admission accounting across every channel, applies 4 MiB or 8,192-frame session replay bounds and 4 MiB subscriber output bounds, closes subscribers/watchers on their actual server-side owner teardown, joins wrapper/watcher cleanup to custom-server shutdown, and applies a ten-second grace only to proven Pi-Web-owned resources. Real Next development still ends at terminal process exit; production remains same-process reusable.
- S7 runs the required combined Firefox/Chromium matrix: 10 browser page instances, 10 aggregate active session-view subscriptions, and one mounted live file viewer per page yield 30 concurrent Pi Web WebSockets, all of which must be admitted and functional together; smaller 1/5-page and 1/7-session cases remain required. It completes capability/visual/reconnect/cleanup checks, obtains user acceptance, updates documentation/memory/reports, verifies that OAuth login SSE is the only remaining browser EventSource and remains short-lived, and commits the system-acceptance boundary. Only after S7 is accepted does the root perform the frozen workflow's separate full-master validation and ordinary guarded closeout.

### Scope estimate

- **Surfaces:** gateway/ticket extensions; global, session, and file-watch transport services; `rpc-manager` and file-access authorization; new protocol/projector/hub/reducer/client/registry modules; `AppShell`, `SessionSidebar`, `useAgentSession`, `ChatWindow`, `FileViewer`; two agent SSE routes and the file route's watch mode; focused Node/component/browser tests; maintained docs, memory, reports, plans/checkpoints, and final closeout.
- **Testability:** high for protocol/security/lifecycle/file authorization with synthetic clocks and Node clients; medium for coupled browser migration; manual/user evidence required for rich rendering, live file refresh, scale, and responsiveness.
- **Implementation complexity:** multi-milestone high. S4B is the dominant coupled-state risk; S5 is an independently testable medium-large extension of the same gateway.
- **Context target:** each milestone normally zero compactions, one maximum except S4B/S7 at two; checkpoint and commit before progression.
- **Scope stops:** OAuth transport migration, Pi-monorepo work, private Next cleanup, second port, mandatory TLS, secondary transcript/render/index optimization, production deployment, or validation waiver requires separate authority.

## Reference Files

- [Immutable original transport master](./2026-07-24-multi-tab-performance.md)
- [Approved M0 foundation plan](./2026-07-24-m00-baseline-transport-feasibility.md)
- [Approved M0 recovery plan](./2026-07-29-m00-development-lifecycle-recovery.md)
- [M0 foundation checkpoint](../checkpoints/2026-07-24-m00-baseline-transport-feasibility-checkpoints.md)
- [M0 final recovery checkpoint](../checkpoints/2026-07-29-m00-development-lifecycle-recovery-checkpoints.md)
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md)
- [Hosted implementation-session memory](../memory/hosted-implementation-sessions.md)
- [Repository development instructions](../../AGENTS.md)
- [Custom server](../../bin/pi-web-server.js)
- [Transport gateway](../../bin/pi-web-transport-gateway.js)
- [Ticket route](../../app/api/transport/ticket/route.ts)
- [Typed gateway accessor](../../lib/websocket-gateway.ts)
- [Runtime manager](../../lib/rpc-manager.ts)
- [Global running SSE route](../../app/api/agent/running/events/route.ts)
- [Per-session SSE route](../../app/api/agent/[id]/events/route.ts)
- [File API and persistent watch mode](../../app/api/files/[...path]/route.ts)
- [Sidebar](../../components/SessionSidebar.tsx)
- [Session hook](../../hooks/useAgentSession.ts)
- [Live file viewers](../../components/FileViewer.tsx)

## Constraints, Decisions, and Current State

### Fixed constraints

- This is a new user-designated orchestration master. The old master remains immutable and this file becomes immutable when orchestration begins.
- Preserve full-control Pi Web, Next/React, the server-owned in-process `AgentSession` model, direct HTTP/LAN use, and existing trust configuration.
- Implementation stays in `/Users/xin/Documents/repos/pi-web`; `/Users/xin/Documents/repos/pi` is read-only reference.
- Never run `next build` during development. Fresh production route inclusion remains release-workflow evidence, not a claim the orchestrator may invent.
- Preserve unrelated main dirt, untracked plans, `.agents/runtime/`, and `.pi-subagents/`.
- **Browser page instance** means one top-level browser tab or window running Pi Web; it never means an internal Pi Web `TabBar` chat/file item. The 1/5/10-tab workloads count browser page instances.
- One global socket per browser page instance, one independent socket per active session-view subscription, and one independently authorized socket per mounted live file viewer; no cross-page or cross-tab multiplexing. These are transport topology facts, not user-facing ownership rules.
- Five browser tabs/seven runs are ordinary; ten browser tabs/ten runs is stress. Measurements are diagnostic; the user is the responsiveness authority.
- Every live wrapper's projected sequence continues independently of browser views. Locally hidden active views remain current where needed, newly opened views recover canonically, and navigation or browser connection loss never stops the server run.
- No raw SDK event or repeated growing snapshot is the routine session wire format.
- No prompt/message/tool/provider content, ticket, credential, raw session ID, or private path enters diagnostics or committed evidence.
- Orchestration creates no scheduler/state graph and performs no automatic archival, worktree deletion, or branch deletion.

### Established facts

- Main `145405d9e4c8a09e28f196ecddcf2c4fd5b84ade` contains the closed M0 foundation and final evidence; all M0 worktrees/branches were removed after containment was verified.
- The gateway is dormant: no production channel or browser consumer exists. Existing global and per-session SSE remain authoritative.
- Global SSE carries both `running` and `sessions_changed`; the latter is required by hosted implementation discovery and must replay on reconnect.
- Per-session SSE still forwards raw wrapper events and the browser still replaces streaming state with full `event.message` snapshots.
- Exact-once native disposal, multiple destruction observers, and active-work idle protection already exist; semantic idle remains ten minutes.
- The browser has no application-level transport owner above keyed chat windows.
- File watching is a persistent EventSource in four `FileViewer` variants and is now in scope. OAuth login SSE is short-lived, interactive, and explicitly remains out of scope.
- Original M0 browser-scale baseline artifacts were not captured; M0 deliberately retained the accepted diagnosis instead.
- The `/orchestrate-implementation` launcher validates one committed approved plan, creates one fresh worktree/session, schedules the exact kickoff, and does not itself monitor, interpret, close out, archive, or clean up the mission.

### Resolved decisions

- **Execution progression:** the root proceeds through S1-S7 without milestone-by-milestone permission and invokes the embedded material-divergence escalation only for an observed conflict it cannot resolve within this master.
- **Baseline scope:** the accepted HTTP/1.1/SSE diagnosis is governing evidence and must not be repeated or turned into a new evidence wiki. Milestones collect only migration and acceptance evidence.
- **Persistent-stream scope:** migrate the two agent streams and file watching; retain short-lived interactive OAuth login SSE and word acceptance as “no persistent EventSource remains.”
- **Session authority:** the server wrapper/projector owns event capture and canonical recovery independently of browsers. Browser page count, which page initiated a run, and page-local connection history do not define session ownership or product behavior; client registries keep only the connections needed to render current/local hidden views and recover any other session from server replay or snapshot.

## Test Strategy

### Every milestone

- `node_modules/.bin/tsc --noEmit`
- `npm run lint`
- `node --test lib/*.test.mjs components/*.test.mjs`
- focused tests for changed surfaces
- `git diff --check`
- `npm pack --dry-run` whenever runtime/package files change
- source-boundary, privacy, checkpoint, and independent review evidence before commit

`next build` is not a development validation command. No milestone may silently skip a required real-child, browser, security, or lifecycle layer.

### Protocol/server

- Exhaustive projector and reducer fixtures for text, thinking, tools, compaction variants, retry, queue, extension UI/status/widget, errors, final canonical equality, unknown versions, duplicate/out-of-order sequence, replay hit/overflow, and snapshot recovery.
- Node WebSocket integration for tickets/origins/versions/frames, exact admission/release at the 64-per-address and 256-total boundaries, multiple subscribers, slow consumers, disconnect/reconnect, wrapper destruction, file-path/source-session authorization, watcher teardown, ordinary HTTP schedulability, HMR coexistence, and server shutdown.
- Fake-clock tests for ticket expiry, heartbeat, 30-minute semantic idle, active-run protection, replay/output bounds, exact-once disposal, and shutdown grace.

### Browser/user

- Run separate smaller cases and one explicit combined stress case: 10 browser page instances + 10 aggregate active session-view subscriptions + one mounted live file viewer per page = 30 concurrent Pi Web WebSockets from one address. All 30 must be admitted and functional; separately prove the 65th same-address and 257th total connection are rejected and capacity is restored after close. Inactive internal file tabs are unmounted and own no watcher.
- Visible/hidden streaming during text, thinking, tool use, retry, queue, compaction, navigation, background/foreground, offline/online, refresh, and server restart.
- Live image/audio/document/text refresh across change, deletion/recreation, reconnect, path/viewer change, and teardown without stale watchers.
- Rich Markdown, code, math, Mermaid, tools, extension UI, branches/fork/clone, models/auth/config/files/worktrees/export, completion sound, and hosted Start/Orchestrate discovery.
- Firefox and Chromium command schedulability, connection inventory, projected bytes, ordering/recovery, owned-resource cleanup, and user responsiveness acceptance.
- Verify no persistent EventSource remains and that the only browser EventSource is short-lived OAuth login.

### Evidence boundaries

Use sanitized/synthetic fixtures. Distinguish Pi Web resources from aggregate browser resources. Automated socket/HMR evidence does not replace required visual/user evidence. Fresh production inclusion of new routes remains blocked until the release workflow builds them; stale copied artifacts may prove lifecycle only.

## Telemetry / Debuggability

Use bounded development-only diagnostics, not a user-facing telemetry product:

- ticket/channel registration and consume/reject reason;
- global running/discovery subscriber count and generation;
- projected frame/type/byte counts and omitted-field class;
- session sequence, reconnect reason, replay occupancy, replay/snapshot outcome;
- subscriber buffered-byte class and retryable close reason;
- selected/hidden registry counts without raw session IDs;
- file-watch authorization/result class, active watcher count, reconnect/close reason, and change count without paths;
- semantic-idle touch category, expiry, disposal, and active-run protection;
- ping failure, connection-cap rejection, server instance/build identity;
- shutdown stage, duration, graceful outcome, and forced count limited to owned resources.

Never log content, tickets, credentials, full paths, provider payloads, or raw identifiers. Verify diagnostics in focused tests and keep reason/cardinality sets bounded.

## Validation Contract

| ID | Priority | Surface | Required truth | Required evidence | Mode | Blocker path |
|---|---|---|---|---|---|---|
| ORCH-VC-001 | P0 | Orchestration | One root, one active milestone, one source writer, immutable plans, verified handoffs, independent reviews, coherent boundary commits, continuous S1-S7 progression, and escalation only on observed material divergence are honored. | Plans/checkpoints, subagent identities, diffs, commits, target-session evidence. | scrutiny | Ownership ambiguity, overlapping writer, an unjustified routine pause, or progression through unresolved material divergence stops immediately. |
| ORCH-VC-002 | P0 | Global status | Before the first production channel, gateway-wide 64-per-address/256-total admission and exact release are enforced; exactly one global socket per browser page instance preserves initial/reconnect `running` and `sessions_changed`, sidebar generation semantics, and never creates/touches wrappers; global agent SSE caller/route are gone. | Admission-boundary/server/client tests plus 1/5/10-browser-page inventory and hosted-session discovery flow. | both | Missing admission enforcement, leaked capacity, runtime creation, stale generation loss, duplicate socket, or remaining caller blocks S1. |
| ORCH-VC-003 | P0 | Event efficiency | Session wire work scales with actual deltas; no raw SDK event, routine growing snapshot, full `agent_end.messages`, or unused field reaches the serializer. | Long synthetic streams, encoded-byte comparison, serializer boundary review. | scrutiny | Missing actionable provider delta or quadratic fallback is material divergence. |
| ORCH-VC-004 | P0 | Session correctness | Every live wrapper is projected and sequenced with zero or more browser subscribers; visible/local hidden views receive ordered deltas and every attached/recovered view converges through replay/snapshot/final reconciliation without gaps, duplicates, or ghost state. | Projector/reducer/Node-client tests and browser flows across zero-subscriber periods, reconnect, navigation, compaction, and tools. | both | Lost server-side event capture or ordering/finality failure blocks migration. |
| ORCH-VC-005 | P0 | Browser transport | Each active session-view subscription has one independent socket; local selection changes preserve needed hidden views; disconnect never aborts the run; page identity never controls server ownership; current recovery semantics remain until replaced equivalently. | Registry tests and visible/hidden/multi-page Firefox/Chromium flows. | both | Page-dependent product behavior, lost hidden view, premature release, or removed recovery safety blocks. |
| ORCH-VC-006 | P0 | Persistent file watch | Every mounted live viewer uses one authorized WebSocket, preserves connected/change/reload behavior, closes every owned watcher, and leaves OAuth login as the only short-lived browser EventSource. | File authorization/watcher tests, viewer tests, browser network inventory, and change/delete/reconnect flows. | both | Unauthorized path, stale watcher, broken refresh, or remaining persistent EventSource blocks. |
| ORCH-VC-007 | P0 | Lifecycle | Thirty-minute semantic idle, command/event touches, heartbeat exclusion, active-run protection, subscriber closure, exact-once disposal, and transparent recreation are correct. | Fake-clock/integration counters and repeated lifecycle tests. | scrutiny | Any active expiry, retained owned resource, or duplicate disposal blocks. |
| ORCH-VC-008 | P0 | Security/backpressure | Same-host one-use tickets, metadata binding, 64-per-address/256-total admission with exact release, frame/replay/output bounds, heartbeat, and retryable slow-consumer behavior fail closed without content leakage or agent blocking. | Adversarial Node-client tests, cap-boundary/re-admission tests, and bounded diagnostics. | scrutiny | Trust-boundary leak, unbounded allocation, leaked capacity, or blocked agent is P0. |
| ORCH-VC-009 | P0 | Server/shutdown | One-port CLI/package/HMR behavior remains correct; wrapper/watcher cleanup joins server ownership; Pi-owned resources meet graceful/owned-force policy; production remains reusable and development remains process-scoped. | Package, HMR, signal, repeated production, real-dev child, and shutdown evidence. | both | Private Next cleanup, non-owned termination, or production leak blocks. |
| ORCH-VC-010 | P0 | Scale/schedulability | Five browser tabs/seven runs are responsive; the combined 10-page + 10-aggregate-session + 10-active-viewer topology has exactly 30 admitted Pi Web WebSockets and does not hang; ordinary HTTP commands remain schedulable without persistent EventSource connection starvation. | Firefox/Chromium connection inventory and interaction evidence plus user acceptance. | both | Wrong topology/count, cap conflict, hang/starvation, or unacceptable behavior blocks closeout. |
| ORCH-VC-011 | P1 | Product compatibility | Full-control capabilities and transcript/context/tree/branch/file-viewer behavior remain compatible; no secondary redesign or feature reduction enters scope. | Full tests, capability matrix, and visual/user flows. | both | Capability removal has no waiver. |
| ORCH-VC-012 | P0 | Privacy/diagnostics | Logs/evidence remain content-safe and bounded while exposing enough lifecycle/sequence/recovery/watch state to diagnose failures. | Static review and focused diagnostics tests. | scrutiny | Secret/private-content exposure blocks. |
| ORCH-VC-013 | P0 | Final state | Every milestone disposition, human gate, commit, checkpoint, residual risk, full-master validation, and guarded closeout is recoverable; no automatic cleanup/archive occurs. | Direct Git/checkpoint/main/worktree inspection. | scrutiny | Incomplete evidence or unsafe merge blocks completion. |

## Assumptions, Risks, and Blockers

- The accepted direct-H1/SSE diagnosis is governing evidence and will not be repeated; final claims must distinguish that historical diagnosis from newly collected migration and acceptance evidence.
- Persistent file watching is in scope because it can consume HTTP/1.1 connections during ordinary use; short-lived interactive OAuth login SSE is the sole explicit exception to zero-EventSource acceptance.
- Session bootstrap metadata and ticket records must remain server-authoritative; unsafe binding stops S3.
- The session hook is a coupled state machine; S4A/S4B is the only preauthorized browser split and must preserve reconciliation until replacement evidence exists.
- Wrapper retention rises from ten to 30 minutes; cleanup correctness is a hard gate even without numeric memory budgets.
- Query tickets may appear in infrastructure logs outside Pi Web's control; Pi Web itself must never log them.
- Fresh production route inclusion cannot be proven without the prohibited development build and remains release-owned.
- Hosted launch success means scheduled ownership only. Process restart loses live ownership, while native JSONL remains resumable.
- Required Firefox/Chromium, rich visual, provider-backed concurrency, or user acceptance may need user participation and can block progression.
- If protocol correction exposes secondary transcript/index/render costs that still prevent acceptance, S7 stops for a separate planning cycle.
- Main has unrelated dirt and no lock helper; final closeout must preserve dirt and use a no-race exception only when live preflight proves it safe.

## Implementation Handoff

No orchestration is authorized while this master is `Status: draft` or uncommitted.

After every material decision is resolved, explicit shared-understanding approval, and a separate master-only commit, launch from an idle root Pi Web session:

```text
/orchestrate-implementation .agents/plans/2026-07-30-persistent-stream-websocket-migration.md
```

The hosted target becomes the control surface after scheduling. A present failing hosted capability never falls back to detached print. The target proceeds from S1 through S7 without routine user permission between milestones; if it observes material drift that cannot be resolved under the embedded workflow, it must stop, preserve evidence, and raise the conflict to the user.
