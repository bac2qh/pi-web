# Pi Agent Web - Development Notes

## Quick Start

```bash
npm run build:local-pi-fork    # retained main only; requires clean sibling ../pi at 734502cb8
npm run install:local-pi-fork  # verifies on-disk identity/integrity, then npm ci --ignore-scripts
npm run dev   # port 30141
```

The local fork helper requires Node `24.19.0`/npm `11.17.0` and the retained `pi-web`/`pi` sibling layout. Nested `.agents/worktrees/` checkouts must validate through a disposable sibling-layout copy; do not change the committed `file:../pi/...` dependency to fit a nested worktree.

Typecheck: `node_modules/.bin/tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## Architecture

```
Browser                 Pi Web Node/Next Server          AgentSession (in-process)
  │                            │                                │
  ├─ GET /api/sessions ────────▶ reads ~/.pi/agent/sessions/    │
  ├─ GET /api/sessions/[id] ───▶ reads .jsonl directly          │
  ├─ HTTP agent commands ──────▶ startRpcSession()/send() ─────▶│
  │                            │                                │
  ├─ POST /api/transport/ticket (running/session/file-watch)    │
  ├─ WS /_pi/websocket ────────▶ one-use authorized upgrade     │
  │◀─ running + sessions_changed frames                         │
  │◀─ projected session deltas/replay/snapshots ◀───────────────│
  │◀─ file connected/change metadata                            │
```

**Session browsing** (read-only): reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created.  
**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/export/route.ts   GET exported HTML for a session
  session-dag/route.ts            GET/PATCH machine-wide session dependency graph
  sidebar-state/route.ts          GET/PATCH shared pin and hidden-sidebar state
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/search/route.ts          GET/POST skills.sh search
  transport/ticket/route.ts       POST one-use ticket for a registered WebSocket channel
  worktrees/route.ts              GET/POST/DELETE git worktrees

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  draft-store.ts       local draft persistence helpers
  file-access.ts       allowed file roots for /api/files and worktrees
  file-links.ts        authored-link resolution + strict assistant path recognition
  file-paths.ts        client/server path encoding helpers
  file-types.ts        shared preview limits, languages, and automatic text eligibility
  file-viewer-layout.ts pure responsive expansion/confirmation policy transitions
  panel-layout.ts      pure preferred/effective side-panel width constraints
  text-preview-file.ts bounded server-side text file reader
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  hosted-implementation-session.ts  process-local Start/Orchestrate host capability
  session-clone.ts    disposable native active-branch extraction for /clone and /side
  side-session.ts     strict side cutoff/marker/projection/capability policy
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  session-dag.ts      strict dependency-graph model, reducer, history, and Mermaid compiler
  session-dag-store.ts locked atomic pi-web-session-dag.json persistence
  session-dag-route.ts injectable GET/PATCH route behavior and listing-race retries
  session-dag-svg.ts validated inert SVG preparation + explicit completion controls
  session-list-refresh.ts HMR-stable session discovery invalidation/pub-sub seam
  right-panel-tabs.ts pure permanent-DAG/file tab focus and close transitions
  sidebar-session-state.ts  client-safe pin/hide/recent/tree derivation
  sidebar-state-store.ts    locked atomic pi-web-sidebar.json persistence
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  global-status-{protocol,channel,client}.ts  page-global running/discovery WebSocket
  session-{protocol,event-hub,channel,transport-client,registry,view-transport}.ts  projected session transport
  file-watch-{protocol,channel,client}.ts     mounted live-file WebSocket transport
  transport-ticket-route.ts                  bounded metadata-bound ticket issuer
  websocket-gateway.ts typed accessor for the process-local WebSocket gateway
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tabs + side-panel resize ownership
  AutomaticFileOpenConfirmation.tsx  narrow-width agent-path confirmation
  SessionSidebar.tsx  Pinned/Recent/Project presentations + FileExplorer
  SessionDagPanel.tsx structured dependency authoring, refresh, and mutation queue
  SessionDagPreview.tsx serialized Mermaid render + explicit completion interaction
  GlobalStatusProvider.tsx one running/discovery socket per loaded page
  SessionRegistryProvider.tsx page-owned session view registry and transport
  ChatWindow.tsx      chat composition + completion sound wrapper
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  ChatMinimap.tsx     scroll minimap alongside the message list
  MarkdownBody.tsx    chat markdown renderer
  MarkdownFilePreview.tsx  Explorer Markdown renderer with hybrid-width blocks
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          permanent DAG + closable file right-panel tabs

hooks/
  useAgentSession.ts  messages + projected WebSocket effects + HTTP reconciliation + fork/clone/side/navigate logic
  useAudio.ts         completion sound + browser AudioContext unlock
  useDragDrop.ts      shared drag/drop state
  useIsMobile.ts      responsive breakpoint hook
  useResizablePanel.ts shared pointer/keyboard/persistence owner for side-panel widths
  useTheme.ts         theme state
```

---

## Key Design Decisions & Traps

### Local bac2qh/pi coding-agent fork
- The compatibility dependency key remains `@earendil-works/pi-coding-agent`, but npm installs the untracked local tarball whose actual identity is `@bac2qh/pi-coding-agent@0.84.0-bac2qh.734502cb8` from exact commit `734502cb86eaf631e1ceeb403dbd717e3b78404f`.
- `scripts/build-local-pi-fork.mjs` requires the pinned Node/npm toolchain and clean sibling fork, validates two fresh exact-commit builds plus the fork suite/faux regression, applies only the declared package/shrinkwrap identity overlay, requires byte-identical archives, and publishes under sibling `pi/.artifacts/pi-web/734502cb8/` without global installation.
- The helper pins ignored generated model data to the integrity-checked official `@earendil-works/pi-ai@0.84.0` artifact so mutable live model catalogs cannot change exact-commit validation.
- `package-lock.json` records the local tarball integrity and exact official `0.84.0` AI/TUI/agent-core/client/protocol/telemetry graph. npm is authoritative; `bun.lock` remains unchanged and unvalidated.
- This manifest is local-only and non-publishable because npm publication does not embed an external `file:` dependency. `npm run release` is intentionally unchanged but blocked until a separately approved change restores a self-contained dependency.

### Custom server and persistent WebSocket transport
- `npm run dev`, `npm start`, and the published `pi-web` command all enter through `bin/pi-web.js` and the Pi-Web-owned Node server in `bin/pi-web-server.js`; production alone requires an existing `.next` build.
- One Node `http.Server` delegates ordinary requests to programmatic Next and reserves only `/_pi/websocket`. The Pi upgrade listener must leave every other path untouched so Next continues to own development HMR.
- `bin/pi-web-transport-gateway.js` installs one V1 gateway in `globalThis.__piWebTransportGatewayV1`; `lib/websocket-gateway.ts` gives App Router code typed access across hot reloads. HMR-safe production registrations are static `running`, `session`, and `file-watch` channels.
- `POST /api/transport/ticket` accepts exact bounded channel shapes, enforces same-host Origin plus `X-Pi-Web-Transport: 1`, and stores authoritative metadata only in a 30-second one-use server-side ticket. Session IDs and paths never become dynamic channel names or WebSocket query metadata.
- The gateway admits at most 64 Pi Web sockets per direct peer and 256 total. Session replay is bounded by bytes/units, subscriber output is bounded, file watchers are subscription-owned, and slow consumers close retryably instead of blocking agent work.
- The server owns one 30-second ping/pong heartbeat. Heartbeats do not touch semantic session idle. Programmatic close stops acceptance and starts channel/wrapper/watcher cleanup, while an independent absolute ten-second network deadline allows natural drain before force-releasing only remaining Pi-owned sockets/connections. It then strictly joins published-wrapper semantic shutdown before final gateway and public Next cleanup; a nonsettling extension handler can keep semantic close pending but cannot move the network force point.
- Next 16.2.11 development remains process-scoped because public `app.close()` leaves internal Watchpack watchers referenced. Only the executed terminal launcher exits after awaited cleanup (`130` for SIGINT, `143` for SIGTERM); do not reach into private Next/Watchpack state or enumerate arbitrary process handles.
- Do not add separate signal handlers in the server library, gateway, RPC manager, or App Router modules. Imported launcher/server APIs must never terminate their embedding process. Production must remain reusable across same-process start/close/restart.

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Semantic idle timeout: 30 minutes. Accepted commands and native/projected activity touch it; heartbeat traffic does not, and prompt/compaction/streaming/binding/hosted-kickoff work cannot expire. Concurrent `startRpcSession()` calls share one generation-safe start Promise (`globalThis.__piStartLocks`).
- Published-wrapper release is one memoized strict operation: it synchronously closes admission, cancels an undispatched hosted kickoff, joins started extension binding, aborts compaction and agent work, awaits exactly one `session_shutdown { reason: "quit" }`, and only then disposes the native session once. Idle expiry, contextual Fork, failed published ensure, generation retirement, and server shutdown share it. A prepared owner that fails before publication uses bare disposal and emits no invented lifecycle.

### Pi Web-hosted implementation sessions
- `lib/hosted-implementation-session.ts` publishes a versioned `Symbol.for("pi-web.hosted-implementation-session")` capability only inside the Pi Web server process. Compatible same-runtime hot reload invalidates/replaces the record; foreign or incompatible records are preserved.
- Start/Orchestrate materialize the native JSONL first. Pi Web accepts exactly the six-field ID/file/cwd/kickoff/kind/signal request, opens that exact owner under the existing per-session startup lock, publishes one wrapper, initiates extension binding, and schedules the kickoff through a wrapper-owned background prompt without awaiting binding, preflight, or settlement. Target Stop or wrapper shutdown cancels a scheduled kickoff before native dispatch; after dispatch Stop uses native abort.
- The optional source signal is checked immediately before synchronous publication when Pi supplies one. Publication transfers ownership: later source cancellation/Stop cannot abort the target, and only target-addressed ordinary controls can steer, follow up, or stop it. A duplicate request for the same owner is rejected without a second ownership acceptance, kickoff, discovery refresh, or detached fallback.
- Hosted wrappers retain accepted-prompt/compaction running claims and are never idle-evicted while active. Once published, they use the shared strict wrapper shutdown above without adopting `AgentSessionRuntime`; native `AgentSession.dispose()` remains the final exact-once cleanup step.
- Hosted registration invalidates ordinary session discovery and advances a process-global `sessions_changed` generation over the page-global `running` WebSocket. Initial and reconnected sockets replay the generation; the sidebar consumes it only after the latest `/api/sessions` load succeeds, retries failed generations on replay, and ignores stale overlapping responses without changing selection or URL.
- Capability absence is the detached-print compatibility boundary in the launcher repository. A present invalid or failing capability never falls back because acceptance may be ambiguous.

### Fork, clone, and side wrapper lifecycles
- Contextual **Fork** reopens the source on a disposable `SessionManager`, extracts the path before the selected user prompt, caches the new child, and then awaits shared source shutdown because the UI immediately transitions to the child. It does not mutate the live manager with `createBranchedSession()`.
- `/clone` first requires the browser's displayed leaf to match the live manager leaf, then calls `createBranchedSession()` on a separately reopened disposable manager. It keeps the source wrapper alive and the UI on the source; only the ordinary session-list cache/refresh path changes.
- Exact `/side` captures one live-manager branch snapshot during either active or idle work, removes an unresolved assistant tool-call batch with all partial results, and extracts the latest prefix containing an assistant message. It transactionally appends one targeted hidden boundary and `side-conversation-<UTC timestamp>` name before publication, selects the child, and leaves the source wrapper/run unchanged.
- A valid targeted side boundary is model-visible but excluded with all inherited entries from ordinary root/context/tree presentation. Side compaction summaries render as a generic notice; **Full history** intentionally remains the complete native-file view. **Return to parent** performs ordinary selection and never hides or deletes the durable side child.
- Side wrappers are terminal Pi-Web derivation nodes: direct `/side`, `/clone`, and Fork are refused; same-file navigation is limited to marker descendants. Before service creation, whole extensions registering `subagent` or Start/Open/Orchestrate implementation commands are filtered, known delegation tools are excluded defensively, and the mandatory side policy is appended across reloads and tools-off mode. Ordinary workspace tools remain available.
- Web clone/side deliberately do not emit Pi TUI replacement events (`session_before_fork`, `session_shutdown`, or clone `session_start`). File contents and `parentSession` ancestry remain native Pi behavior.
- Each prompt claims its own running count before awaiting extension binding, so overlapping accepted prompts cannot be overtaken by clone. Compaction is claimed before its native async call for the same reason. Exact `/clone` and `/side` are intercepted before image or streaming steer/follow-up delivery.

### Four branching operations — don't confuse them
- **Fork / New session** (button on a historical user message): creates a child `.jsonl` from before that prompt and selects it.
- **Clone** (`/clone`): creates a child `.jsonl` containing the complete displayed active branch through its current leaf, refreshes the sidebar, and leaves the source selected.
- **Side conversation** (`/side`): creates and selects a durable child from the latest structurally safe invocation-time prefix while the source continues; inherited context is hidden from ordinary side presentation.
- **In-session branch / Edit from here** (historical user message / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session parent metadata and removal
`parentSession` in the header is **display metadata only** — it has zero effect on chat content. Pi may rewrite an entire session file during migrations, but Pi Web exposes no permanent session-delete control or `DELETE /api/sessions/[id]` handler. Hide/Restore is the web removal workflow and updates only sidebar metadata.

### Machine-wide session dependency graph
- `GET/PATCH /api/session-dag` owns one strict graph in `getAgentDir()/pi-web-session-dag.json`, separate from native session JSONL and `pi-web-sidebar.json`. The store is private, size/count bounded, lock-serialized, and published by same-directory atomic rename; malformed or oversized state is refused without reconciliation or pruning.
- `A → B` means only that A must be marked complete before B becomes eligible. The DAG feature never starts, stops, schedules, hides, reparents, renames, or otherwise mutates a Pi session. Exact session IDs are identity; form numbers, titles, project labels, worktree branches, and native ancestry are presentation only. Cycles, self-edges, reverse pairs, and disconnected components are allowed, while an exact duplicate directed pair is not.
- Add/replace proves both IDs exist in one generation-current complete session listing under the graph lock. Accepted IDs remain durable if their session later disappears; unavailable nodes can still be completed, undone/redone, copied, or deleted. Sidebar Hidden has no graph meaning.
- Completing an eligible node archives all active outgoing edges in one sequenced batch. Sinks use a zero-visible-edge batch—there is no stored or rendered sentinel. Undo/Redo move only the expected history tip and preserve the batch timestamp/sequence; a direct semantic mutation or new completion after Undo clears redo.
- PATCH envelopes carry a stable mutation ID, base revision, and compare-and-set targets. Exact retries use bounded private receipts; mutation-ID reuse, stale revisions, changed targets, and capacity conflicts return authoritative `409` state without silent client replay. Only add/replace consult session discovery.
- The right panel always has a non-closable first **DAG** tab and starts closed. First activation lazily mounts the DAG in Preview; it remains mounted afterward so mode, drafts, focus, feedback, and expansion provenance survive file switches and hide/reopen. Closing the final file keeps the panel open and falls back to DAG without resetting expansion.
- Raw structured forms are canonical; Mermaid is generated one-way from the global active graph. Preview uses strict serialized Mermaid with SVG-only labels, then XML-parses and validates one current-render graph root, accessibility metadata, inert node aliases, active-content safety, and geometry. Eligible namespaced controls live in a trusted sibling SVG layer inside the same ShadowRoot so validated Mermaid CSS cannot select them. Preview failure never removes Raw.
- While graphical Preview is visible, the exact chat session selected by `AppShell` marks at most one rendered node through the compiled alias and validated node maps. The trusted attribute marker is local presentation state outside Mermaid rendering, DAG/session-list requests, revision state, focus, and scrolling; inactive, missing, completed, replaced, or failed renders clear it.
- `sessions_changed` refreshes only current labels/list metadata. Graph authority refreshes on activation/reopen, explicit Refresh, browser focus, and `online`; there is no DAG polling or DAG-specific WebSocket.

### ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called from `session-reader.ts` for file loads and `session-view-projection.ts` for projected live effects.

### New session tool preset
Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` passes an empty tool allow-list and forces `agent.state.systemPrompt = ""` after startup/reload/resource discovery.

### Model defaults for new sessions
`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### Session WebSocket recovery on refresh
`SessionRegistryProvider` owns the page-level registry above keyed chat windows. A view claims its session transport before prompt dispatch; projected deltas are primary, reconnect sends the last epoch/cursor for replay, and wrong-epoch/overflow recovery receives a canonical snapshot. Page refresh reconstructs the selected view, while `GET /api/agent/[id]` and transcript/context reads remain authoritative convergence nets.

### Projected compaction events
Newer Pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. The session projector accepts both sets and emits bounded compaction state/effects. Manual compact remains a blocking POST—the button stays disabled until the response returns.

### Running state WebSocket + reconciliation
- `GlobalStatusProvider` owns exactly one `running` socket per loaded page. The channel publishes bounded `running` snapshots and replayable `sessions_changed` generations without starting an `AgentSession`; no global agent EventSource route remains.
- Wrapper event-fanout depth is an internal cleanup barrier, not browser-visible activity. Global membership is sampled after outer fanout stabilizes; delayed releases wait for projected finality, and only ordering-current wrapper/native starts may replace same-ID publisher authority.
- Native `agent_settled` is a session-level idle watermark: it reserves and retires every native-agent start claim captured before its raw fanout. Starts created during that fanout remain active, rejected terminal receipts restore the exact batch, and standalone manual compaction remains one-start/one-end.
- `useAgentSession` treats projected per-session WebSocket snapshots/effects as primary for live chat state, but while a run is active it periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This repairs missed settlement or transient completion delivery from background tabs, reconnects, or half-open connections.
- Prompt runs use a monotonic run id; late projected updates or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.
- `activeLeafId` is the leaf displayed by the branch UI, not an HTTP pin. Only explicit historical navigation installs the synchronous selected-leaf intent; starting a normal model prompt clears that intent before optimistic mutation so transcript repair follows the advancing live tip, while extension slash commands preserve it. Coalesced root/context repair must re-read the current intent when it runs.

### Pinned, recent, hidden, and unread sidebar state
- `GET/PATCH /api/sidebar-state` stores versioned pi-web-only metadata in `getAgentDir()/pi-web-sidebar.json`. Clients send one idempotent `pin`, `unpin`, `hide`, or `restore` operation rather than replacing arrays.
- Unread remains a separate browser-local presentation set under `pi-web:unread-session-ids`. Automatic background completion and the row's **Mark unread** action restore the same blue dot in every presentation; a newly running session or any explicit row open (including re-clicking the selected row) clears it. Do not add unread to the strict shared sidebar-state schema or mutate session JSONL for it.
- `lib/sidebar-state-store.ts` serializes mutations with a bounded exclusive lock, rereads under the lock, rejects malformed/unsupported state without rewriting it, and publishes same-directory temporary writes by atomic rename. Stale IDs are pruned only when a complete `listAllSessions()` scan remains generation-current through metadata-lock acquisition.
- `lib/sidebar-session-state.ts` builds hidden-descendant closure from the raw global session graph before filtering. Pinned order comes from stored IDs; Recent is the uncapped, unpinned exact ten-day window; Project families sort by their newest visible descendant; duplicate project basenames expand to shortest unique suffixes.
- Hide/Restore never mutates Pi JSONL, settings, selection, running agents, navigation, or pin state. Show hidden is a reload-local UI mode. Cross-client convergence uses existing Refresh paths—there is no sidebar-state polling or SSE channel.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### File access allow-list and live watches
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/pi-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.
- Mounted file viewers obtain metadata-bound `file-watch` tickets through the same allowed-root-or-session-reference decision as file GET. One server-owned watcher publishes path-free connected/change metadata; path/view changes, reconnect, owner replacement, and server close release it. The old `type=watch` SSE mode is removed.

### Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

### Extension widgets and custom UI
- `setWidget()` accepts existing `string[]` content and synchronous component factories. Pi Web renders factories server-side with the plain-text theme and a frozen 92×40 façade exposing only terminal dimensions, `kittyProtocolActive: false`, and `requestRender(force?)`; browser transport remains the existing `{ key, lines, placement }` projection.
- Widget component ownership is wrapper-local and generation-guarded across replacement, refresh, clear, reload, and shutdown. Browser presentation caps both array- and factory-origin content at ten logical lines plus a truncation marker without truncating server/projected state.
- Persistent widgets are render-only in Pi Web: `onTerminalInput()` remains unsupported, so a fleet widget's arrow/enter hint is not interactive. `/subagents-fleet` remains the interactive inspector through the separate custom-panel input path.

### OpenAI Fast indicator compatibility adapter
- Pi Web recognizes only the package-origin `@benvargas/pi-openai-fast@1.1.0` command after bounded nearest-manifest authentication. It invokes that command's `status` handler with a fresh command context, captures the single known notification locally, and fails closed: package absence has no badge; unsupported, ambiguous, stale, or failed contracts show `Fast unknown`.
- The wrapper refreshes only after extension binding, the authenticated Fast command settles, model selection or settled model drift, and reload. Refreshes coalesce by wrapper/runner/model generation; ordinary prompts, reconnects, and unchanged `get_state` calls do not probe.
- `pi-web:openai-fast-mode` is Pi-Web-owned status transport metadata whose value is only `effective | unavailable | off | unknown`. Extension attempts to use that key are escaped as ordinary statuses, and the browser removes the exact host entry before generic status rendering.
- Model mutations are serialized in the wrapper, and the browser serializes overlapping local model intents. A successful `set_model` response includes the projected session epoch/cursor after Fast convergence; only that exact watermark can complete the local transition. If another caller or reconnect has already advanced the projection, an exact-watermarked `get_state` response applies the authoritative model and Fast state together while the badge remains `unknown`.

### Auth and model config
- `ModelsConfig` combines models from `~/.pi/agent/models.json` with provider auth status from pi's `AuthStorage`/`ModelRegistry`.
- OAuth/device-code/manual-code flows are streamed by `GET /api/auth/login/[provider]`; manual code responses POST back with a short-lived token stored in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `AuthStorage`. Status endpoints must never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` is not a real route.

### Resizable application panels
- At `1000px` and wider, the open sidebar and open, non-expanded right panel expose focusable pointer/keyboard separators. `useResizablePanel` mutates only `--sidebar-width` or `--right-panel-width` during pointer movement, then commits one React/browser-local preference update; resize cancellation must restore pointer capture, cursor, and selection state.
- `lib/panel-layout.ts` distinguishes browser-local preferred widths from current effective widths. The sidebar uses `260px` within `180–480px`; an unset right panel keeps responsive `42%` behavior within `300–1200px`; joint clamping reserves at least `320px` for conversation without overwriting either preference.
- The right-panel width belongs to the shared display container, not its selected content. DAG and file tabs therefore share `pi-right-panel-width`, switching tabs never changes geometry, and final-file fallback to DAG preserves the same width. Collapse, expansion, `<1000px` automatic full-width behavior, and `<=640px` mobile layout suppress the relevant handles without clearing preferences.

### Expanded right panel
- `AppShell` owns manual and automatic-narrow expansion provenance (the pure helper retains its historical file-viewer names). Expansion changes shell/panel classes only: sidebar and center/chat remain mounted but leave layout and hit testing, while the shared DAG/file right panel fills `100dvh` and the fixed panel toggle is suppressed.
- Desktop expansion must override both the panel's variable-width/`300px` rule and its direct children's separate variable-width/`300px` rule. At `640px` and below, the normal mobile panel remains the sole full-width mode; from `641px` through `999px`, an unsuppressed open right panel uses expanded presentation. Narrow restore suppression lasts until the next committed file open, and automatic expansion clears at `1000px` without clearing manual expansion.
- Explorer Markdown stays separate from chat `MarkdownBody`. `MarkdownFilePreview` centers direct reading blocks at `1000px` maximum while direct code, wrapped tables, and standalone images use the wider padded surface with inner overflow.

### Assistant-returned file paths
- Only settled assistant text opts into automatic path recognition. A local Markdown AST transform handles conservative prose tokens and whole inline-code spans, skips authored links and fenced code, and never performs recognition-time I/O.
- Automatic candidates must use the shared source/text filename policy and resolve lexically inside the exact session cwd, including linked-worktree identity. Authored Markdown links retain their broader existing resolver and authorization semantics.
- Generated path actions open directly at `1000px` and above. Below `1000px`, `AppShell` owns one accessible **Open file** confirmation bound to the captured session/cwd and revalidates that identity before opening.
- Text reads remain capped at 256 KiB and reject NUL-bearing or invalid UTF-8 bytes before returning content. Images, audio, PDF, DOCX, unknown extensions, and arbitrary extensionless names are not eligible for automatic path actions.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

### Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper, then patches recursive tree helpers in the generated HTML to iterative versions so very deep linear sessions do not overflow the browser call stack.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and `navigate_tree` calls. The displayed active leaf is also sent with `/clone` and must equal the live wrapper leaf before extraction.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
--sidebar-width --right-panel-width
```
