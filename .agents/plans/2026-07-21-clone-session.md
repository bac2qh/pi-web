# Add Clone Session to Pi Web

Status: approved
Date: 2026-07-21

## Objective

Expose Pi's existing clone-session capability through pi-web's `/clone` input so the user does not need to open the Pi TUI. Pi remains authoritative for active-branch extraction and ordinary JSONL ancestry; pi-web adds only the host dispatch and existing-sidebar refresh needed because it does not run Pi's TUI command dispatcher.

## Success Criteria

- A user can clone an eligible persisted session from pi-web.
- The new session contains the complete active branch through the current position, has a distinct session ID/file, and records the source session as display ancestry.
- Pi-web invokes Pi's native branch-extraction primitive on a disposable manager without corrupting or mutating the live source manager/wrapper, and remains visibly on the source session after success.
- The resulting ordinary Pi session file is surfaced through the existing session list/sidebar path, with no clone-specific discovery or storage layer.
- Existing contextual **New session** (fork) and **Edit from here** (in-session branch) behavior remains unchanged.
- Eligibility, running-state behavior, errors, sidebar refresh, and regression coverage are explicit rather than accidental.

## Evidence and Current State

### Established facts

- Pi defines three distinct operations: `/tree` branches within one session file, `/fork` creates a new session before a selected user message, and `/clone` duplicates the complete current active branch into a new session file. Evidence: installed Pi `README.md` and `docs/sessions.md`.
- Pi-web intentionally renders fork contextually on eligible historical user messages as **New session**, and renders in-session branching as **Edit from here**. Evidence: `components/MessageView.tsx` and `components/ChatWindow.tsx`.
- Pi-web disables contextual fork while an agent is running, for a not-yet-established new session, and on the root user message. Evidence: `components/ChatWindow.tsx`.
- Pi-web's slash-command palette hard-codes only `/compact`, `/reload`, `/name`, `/session`, and `/copy` as web built-ins; `/fork` and `/clone` are not palette entries. Evidence: `components/ChatInput.tsx`.
- The client hook implements `handleFork`, sends `{ type: "fork", entryId }`, and routes the returned `newSessionId` through `onSessionForked`. Evidence: `hooks/useAgentSession.ts`.
- The in-process server wrapper implements a `fork` command and destroys its wrapper after creating the new session so the source ID cannot retain mutated/replaced session state. There is currently no corresponding `clone` command in pi-web. Evidence: `lib/rpc-manager.ts` and repository search.
- The repository baseline advanced during this grill through separately completed main work: dependency security (`caaa1bd`, archived by `2861c76`), the Pi SDK refresh (`fe450d7`), Mermaid-plan documentation (`3e20189`), task-worktree ignore rules (`47fd4f7`), and a multi-tab orchestration plan (`db7ba32`, current inspected `HEAD`). `package.json`, `package-lock.json`, and installed project dependencies now resolve `@earendil-works/pi-coding-agent` 0.82.1. The fully re-read 0.82.1 SDK/RPC/session/extension documentation and declarations still define clone as `AgentSessionRuntime.fork(entryId, { position: "at" })`; Pi's RPC and interactive implementations pass the current `SessionManager.getLeafId()` and reject an empty/null leaf.
- The SDK runtime's canonical replacement flow emits cancellable `session_before_fork` with `position: "at"`, emits `session_shutdown`, disposes the old session, creates the root-to-leaf file, rebuilds cwd-bound services, and requires subscriptions/extensions to be rebound. Evidence: installed `docs/sdk.md`, `docs/rpc.md`, `docs/extensions.md`, `dist/core/agent-session-runtime.js`, and interactive/RPC mode implementations.
- `session_before_fork` is an extension preflight, not the cloning mechanism. Pi passes the selected `entryId` and `position` (`"at"` means clone). Loaded handlers run sequentially; they may perform arbitrary extension work and may return `{ cancel: true }`, which stops later handlers and prevents clone creation. Handler errors are surfaced through extension-error handling and do not themselves cancel.
- Typical documented uses are dirty-repository checks, confirmation gates, and Git checkpoints before the conversation diverges. In this configured environment, `pi-subagents` also registers a handler that resets its watchdog's session-scoped review-input signature and LSP ledger on a fork/clone event. Because D-007 keeps the source runtime active, emitting only this pre-event would reset state on the still-open source; D-008 therefore deliberately skips the replacement-lifecycle hook.
- Pi-web does not currently own an `AgentSessionRuntime`; it creates and caches individual `AgentSession` instances and implements fork directly with `SessionManager`. This direct fork path does not use the SDK runtime's replacement lifecycle. Evidence: `lib/rpc-manager.ts` and `lib/pi-types.ts`.
- `SessionManager.createBranchedSession(leafId)` is the underlying extraction primitive: it writes a new ID/header with `parentSession` pointing at the source, copies only the selected root-to-leaf path, re-chains entries after removing label entries, and recreates labels targeting copied entries. It does not copy abandoned sibling branches. Evidence: installed 0.82.1 `session-manager.js`/declarations.
- The native primitive mutates the manager it is called on, so pi-web must call it on a separately reopened manager rather than the live cached manager. It writes directly into that manager's configured ordinary session directory and returns the intended clone path.
- Native 0.82.1 intentionally does not materialize a cloned file when the selected root-to-leaf path contains no assistant message: `createBranchedSession()` returns an intended path but leaves it absent so a replacement runtime can persist later when an assistant arrives. A synthetic user-only-path experiment confirmed this. The simplified web adapter will not recreate that runtime or manually serialize Pi internals; it treats a non-materialized returned path as **Nothing to clone yet** so success always means the session is discoverable.
- The currently displayed active leaf can differ from the last entry obtained by freshly reopening the JSONL after in-session navigation, because `navigateTree()` changes the live manager's leaf in memory and only a later append persists a new path. The client therefore supplies its displayed `activeLeafId`; the server compares it with the live manager's native `getLeafId()` and clones only when they agree, preventing both append-order inference and a stale post-run/navigation snapshot.
- Pi's `get_commands` protocol intentionally excludes built-in TUI commands. Pi-web manually supplies its web-supported built-ins, which explains why adding backend clone alone would not add `/clone` to the palette. Evidence: installed `docs/rpc.md`, `components/ChatInput.tsx`, and `hooks/useAgentSession.ts`.
- `AppShell.handleSessionForked()` performs the existing fork transition: refresh session listings, remount chat, retain source metadata until server hydration, select the new ID, and update the URL. D-007 explicitly rejects that transition for clone; clone may reuse only the existing list cache invalidation/refresh plumbing while leaving chat selection and URL unchanged.
- Current automated tests use Node's test runner and Jiti. There is no browser/DOM interaction harness and no fork/clone behavior test; `lib/rpc-manager.test.mjs` currently contains only a source-level startup regression assertion.
- The sidebar has no session-file watcher or session-list polling. It reloads on initial mount or `refreshKey`; the server list has a 30-second cache. A clone initiated through pi-web can use the existing cache invalidation and refresh-key path for immediate discovery, while an externally created TUI clone appears on a later uncached/manual refresh.
- Project memory was absent at grill start, then arrived through the independent dependency-security closeout. `.agents/memory/MEMORY.md` currently indexes only dependency-security/runtime constraints; it contains no clone-specific decision. No maintained `wiki/` pages or clone-specific checkpoint were found. Other inspected plans do not cover clone.

### Fixed constraints

- Investigation and planning only under the explicitly invoked `grill-to-plan` workflow; implementation requires a later approved-plan handoff.
- Preserve the existing contextual fork design. Authority: user, 2026-07-21.
- Do not run `next build`; repository validation uses typecheck, lint, and focused tests. Evidence: `AGENTS.md`.
- Preserve the one-wrapper-per-session registry invariant: no wrapper may remain registered under a source ID while owning replacement-session state. Evidence: `AGENTS.md` and `lib/rpc-manager.ts`.
- Match Pi's established meaning of clone: copy the selected active path through its current leaf, not the full append-only file/tree and not an empty session. Evidence: Pi session and RPC contracts.
- `/clone` must not become model input or a queued steering/follow-up message while a run is active. Authority: user, 2026-07-21.
- The extracted branch contents, new native session ID/file, and `parentSession` ancestry must match Pi's canonical `/clone`. TUI runtime replacement and extension lifecycle events are explicitly excluded by D-007/D-008. Authority: user plus clarified host boundary, 2026-07-21.

### Independent plan review

A fresh read-only reviewer (`f022d60f-555c-4843-b09b-e0ac67a5ce91`; Pi session `019faa3d-c103-7228-95c0-3a8795d8e814`) confirmed that direct extraction on a separately reopened manager and explicit leaf transfer are sound. Adopted findings: avoid `ensureNewSession()` for clone, compare displayed and live leaves, claim prompt-running state before extension-binding awaits, use bounded result codes/messages, refresh through a clone-specific callback that does not navigate, require documentation, and cover the native no-assistant-file behavior. Not adopted: a staging publication layer and a general SessionSidebar request-order refactor; the user explicitly chose the thinnest native writer path, and those broader hardening changes exceed this feature's intended adapter scope. Native partial-write behavior and the sidebar's pre-existing late-response race remain disclosed residual risks.

### Blocked facts

- External issue/PR search was partially unavailable because no configured web-search provider was present. Local `origin/main`, full repository history/search, and the public repository search results inspected expose no clone implementation, so this does not block planning.
- No implementation-relevant local evidence remains blocked. Project dependencies are installed at the recorded 0.82.1 baseline.

## Scope and Non-goals

### In scope

- Clone command support through the browser-to-server command path.
- A built-in `/clone` palette command, source-stable completion behavior, and ordinary sidebar discovery of the clone.
- Eligibility/error behavior and focused regression tests.
- Focused automated/manual regression evidence and maintained README/AGENTS/project-memory updates for the durable lifecycle distinction.

### Non-goals

- Redesigning contextual fork or in-session branch navigation.
- General parity with every Pi terminal command.
- Changing session JSONL format or sidebar ancestry semantics.

## Decision Ledger

| ID | Decision | Rationale / consequences | Authority | State |
|---|---|---|---|---|
| D-001 | Retain contextual fork as **New session** on historical user messages. | The user confirmed the current fork design makes sense; clone should be additive rather than forcing fork into the slash palette. | User, 2026-07-21 | decided |
| D-002 | Expose clone only as the built-in `/clone` slash command; do not add a visible Session Info, toolbar, message, or sidebar action. | This directly closes the requested command gap while avoiding duplicate controls and preserving the contextual distinction between message-level fork and session-level clone. Discoverability is limited to the existing slash palette by explicit user choice. | User, 2026-07-21 | decided |
| D-003 | Reject `/clone` while an agent run is active; do not queue it and do not abort the run. Preserve the typed command and show an explicit wait-for-completion error. | Queueing creates timing/leaf ambiguity, while abort-and-clone can capture partial or aborted output. Current streaming composer behavior would otherwise treat manually typed slash text as steering/follow-up input, so clone needs an explicit guard preventing it from reaching the model. | User, 2026-07-21 | decided |
| D-004 | `/clone` requires a current non-null leaf and a native clone path that materializes as an ordinary session file. Otherwise report **Nothing to clone yet**, create no web-owned state, and leave the command/draft intact. | Pi's primitive may return an unmaterialized path for a branch with no assistant response because TUI can retain the replacement manager. Pi-web deliberately will not reproduce that runtime or manually serialize JSONL; requiring a materialized native file guarantees sidebar discoverability while keeping the edge minimal. | User prioritized a simple native/discoverable session; agent applied SDK persistence constraint, 2026-07-21 | decided |
| D-005 | `/clone` is Pi file behavior exposed through pi-web, not a new pi-web-specific clone format or ancestry contract. Active-path extraction, copied metadata/labels, new ID, and parent linkage follow Pi; web-host lifecycle consequences are governed by D-007/D-008. | This keeps Pi authoritative where the native primitive applies without falsely claiming TUI runtime replacement or extension-hook parity. | User plus clarified host boundary, 2026-07-21 | decided |
| D-006 | Add no clone-specific web storage, schema, ancestry logic, or discovery mechanism. Once Pi creates the ordinary JSONL session, rely on the existing session reader/sidebar; use only existing cache invalidation/list refresh plumbing when immediate visibility is required. | This matches the user's TUI analogy: Pi Web already understands sessions created by Pi elsewhere, and the missing capability is invoking clone without leaving the browser. | User, 2026-07-21 | decided |
| D-007 | After clone creation, keep Pi Web on the source session. Do not replace the live web session, re-key its registry wrapper, remount the chat into the clone, or rewrite the URL. Surface the new ordinary session through the existing sidebar tree; the user can open it deliberately. | The user explicitly does not need TUI's automatic transition and prioritizes an invisible/minimal web integration. This removes the riskiest registry and SSE lifecycle work and keeps source state stable. | User, 2026-07-21 | decided |
| D-008 | Use direct non-replacing extraction without emitting `session_before_fork`, `session_shutdown`, or clone `session_start` lifecycle events. | Pi's hook belongs to a replacement sequence. Emitting only its pre-event would let extensions mutate the live source while D-007 keeps that source active; an isolated temporary runtime would add disproportionate startup/UI-bridging complexity. The clone file still uses Pi's native `SessionManager.createBranchedSession(activeLeafId)` semantics, but extension preflight/cancellation is explicitly outside this web-host operation. | User, 2026-07-21 | decided |
| D-009 | On successful clone creation, invalidate/refresh the ordinary session list immediately and show the existing success notice **“Cloned session — available in sidebar”**. Clear the submitted `/clone` input, but do not open the sidebar, select the clone, remount chat, or change the URL. | Immediate refresh makes the new ordinary session discoverable despite the server's 30-second cache; the notice acknowledges completion, including when the mobile sidebar is closed. Reusing existing notice and refresh plumbing avoids clone-specific UI. | User, 2026-07-21 | decided |
| D-010 | Capture the browser-displayed `activeLeafId`, send it with `/clone`, and require it to equal the live wrapper manager's `getLeafId()` before extraction. Use that agreed leaf on a separately reopened manager; never infer it from reopened append order or call the mutating primitive on the live manager. | Equality prevents cloning a stale client leaf immediately after a run/navigation while preserving Pi's native live-leaf authority. The disposable manager isolates `createBranchedSession()` mutation from the cached source wrapper. | Code/SDK evidence plus independent review, 2026-07-21 | decided |
| D-011 | Guard clone at both host layers: intercept exact trimmed `/clone` before streaming steer/follow-up routing; coalesce duplicate submissions from one mounted composer; server-check running state immediately before extraction; and mark a prompt as running before any extension-binding await, rolling back if binding fails. | Client state can be stale/bypassed, and a prompt previously waiting on extension binding could otherwise be overtaken. The server flag closes that acceptance race; synchronous extraction then has no await boundary for another wrapper command to interleave. Cross-tab/API repeat invocations are not idempotent and remain ordinary separate user actions. | Code/SDK evidence plus independent review, 2026-07-21 | decided |
| D-012 | For unexpected failures, preserve `/clone`, emit no success notice/list refresh, and show a safe existing error notice: **“Session is no longer available”** for a missing source, **“The selected branch changed; reload and try again”** for an invalid/stale leaf, or **“Could not clone session”** otherwise. Keep technical detail in bounded server diagnostics without session content or full paths. | Stable user messages are actionable without leaking local paths or raw SDK/filesystem detail. Preserving input supports retry and matches D-003/D-004. Suppressing success effects prevents a failed operation from appearing complete. | User, 2026-07-21 | decided |
| D-013 | **Superseded:** do not add staging/atomic-publication machinery around Pi's native writer. | Although staging could harden partial-write failure, the user explicitly prioritized a thin pass-through that simply creates another native session. Pi itself writes `createBranchedSession()` directly; matching that boundary is simpler and avoids a web-owned publication layer. | User simplification, 2026-07-21 | superseded |
| D-014 | Implement `/clone` as the thinnest SDK host adapter: after D-010's leaf agreement, call `SessionManager.open(sourceFile, sourceSessionDir).createBranchedSession(activeLeafId)` on a disposable manager, require the returned ordinary file to exist, cache its native ID/path, invalidate the normal list cache, and refresh the existing sidebar. Add no clone-specific route, storage, schema, virtual session, temporary runtime, or overlay. | Pi built-ins cannot be forwarded to `AgentSession.prompt()`, and full `AgentSessionRuntime.fork(..., { position: "at" })` would replace the live web session. The exported primitive is the exact file-creation step underneath `/clone`; its `parentSession` header already drives pi-web's ordinary parent-child sidebar. | User, 2026-07-21 | decided |

## Decision Frontier

No unresolved product or architecture decisions remain. The user explicitly confirmed shared understanding and approved this plan.

## Glossary

| Term | Kind | Where | What it does | State/lifetime |
|---|---|---|---|---|
| Active branch | Session concept | Pi JSONL tree / selected leaf | The root-to-current-leaf path represented as the current conversation context. | Persists in the source session file. |
| Fork / **New session** | Cross-session operation / UI action | Historical user message | Creates a separate session from immediately before the selected prompt. | New persisted session file linked to its source. |
| Clone | Cross-session operation | Proposed pi-web action | Duplicates the complete active branch through the current position. | New persisted session file linked to its source. |
| In-session branch / **Edit from here** | Same-session operation / UI action | Historical user message and branch navigator | Moves within one JSONL tree and continues on another branch. | Remains in the same persisted session file. |
| Session wrapper | Server runtime object | `lib/rpc-manager.ts` | Owns the in-process `AgentSession` associated with a session ID. | Cached globally until destroyed or idle-expired. |
| Pass-through | Integration term | Slash command → pi-web host → Pi | Invoke Pi's authoritative branch-extraction primitive and let the resulting ordinary session flow through existing discovery; do not create a parallel pi-web clone model. Pi-web needs a thin host adapter because it does not run the TUI dispatcher. | One invocation through the decided D-014 SDK boundary. |

## Touched-surface Classification

### Production code

- `components/ChatInput.tsx`: add `/clone` to the existing built-in palette and intercept exact trimmed `/clone` before streaming steer/follow-up delivery, while preserving the command on error.
- `hooks/useAgentSession.ts`: handle clone before any `ensureNewSession()` call, capture the displayed leaf, coalesce one composer's in-flight invocation, map bounded result codes to the decided notices, and emit a clone-success callback.
- `components/ChatWindow.tsx` and `components/AppShell.tsx`: thread a dedicated clone-success callback that increments only the session-list `refreshKey`; do not reuse fork navigation or `onAgentEnd` side effects.
- `lib/session-clone.ts` (new, small): isolate and test the disposable-manager call to Pi's native `createBranchedSession()` plus materialized-file/new-ID verification and best-effort removal of a uniquely owned failed candidate.
- `lib/rpc-manager.ts`: add the clone command/result codes, compare displayed and live leaves, keep the source wrapper alive, invalidate/cache only after success, and claim `promptRunning` before extension binding so accepted prompts cannot be overtaken.
- No API route, `agent-client`, session schema, discovery, or sidebar-tree implementation change is planned.

### Tests and maintained knowledge

- Add focused Node/Jiti tests for native extraction and command guards; extend the existing RPC-manager regression coverage.
- Update `README.md`, `README.zh-CN.md`, and `AGENTS.md` to distinguish Fork, **Edit from here**, and `/clone`, and to replace stale wrapper-mutation guidance with the current fork/clone lifecycle distinction.
- Record the durable non-replacing clone-host decision in project memory (`.agents/memory/` index/topic/log). Do not create a wiki page; this feature does not add a new subsystem or operator workflow.

## Design / Implementation Strategy

### 1. Exact browser command routing

Add `{ name: "clone", description: "Duplicate the current active branch", source: "builtin" }` to the existing palette. Treat only exact trimmed `/clone` as the built-in. Route it through `onBuiltinCommand` before both idle-send and streaming steer/follow-up paths, including Enter and the streaming delivery controls, so it can never reach `AgentSession.prompt()`, `steer()`, or `followUp()`.

In `handleBuiltinSlashCommand`, dispatch clone before the shared `ensureNewSession()` path. If there is no established session/leaf, return D-004. While `agentRunningRef` is true, return D-003. Coalesce repeated submissions from the same mounted hook through one in-flight promise; this is not cross-tab idempotency.

### 2. Thin native server adapter

Send `{ type: "clone", activeLeafId }` through the existing `/api/agent/[id]` command route. The wrapper returns a bounded structural result rather than raw filesystem errors: `created` plus one of `busy`, `nothing_to_clone`, `missing_source`, `stale_leaf`, or `clone_failed` when false.

Immediately before extraction, require the wrapper to be alive/idle, require a persisted source file, and require the client leaf to be non-null and equal to `this.inner.sessionManager.getLeafId()`. Mark prompt work as running before awaiting extension binding, with rollback on binding failure, so a concurrently accepted prompt cannot slip past this guard.

Call a small helper that opens the source on a disposable `SessionManager` targeting the source session directory and invokes `createBranchedSession(activeLeafId)` directly. Do not call it on `this.inner.sessionManager`. Success requires a materialized returned file that reopens with a new session ID; the native header supplies `parentSession`. A returned but absent path maps to `nothing_to_clone`. On a caught write/open failure, best-effort remove only the disposable manager's distinct candidate path; do not scan or delete unrelated session files.

After success, call the existing `cacheSessionPath()` and `invalidateSessionListCache()` and return the new ID. Do not destroy/re-key the source wrapper, bind extensions for the clone, or create an `AgentSessionRuntime`.

### 3. Existing UI discovery and feedback

The hook maps the result to D-003/D-004/D-012. Error results preserve the command and do not invoke refresh. Success emits the existing notice **“Cloned session — available in sidebar”**, clears the command, and calls `onSessionCloned`. `AppShell` only increments `refreshKey`; source selection, chat key, URL, sidebar open/closed state, and file explorer state remain unchanged. `SessionSidebar` then uses its existing `/api/sessions` reader and `parentSession` mapping.

### 4. Documentation and durable state

Document that `/clone` copies the current active branch into an ordinary child session while Pi Web remains on the source. Document the deliberate host boundary: file/ancestry semantics are native, while TUI replacement events and extension preflight are not emitted. Keep contextual Fork and **Edit from here** descriptions unchanged.

## Test Strategy

1. **Native extraction (`lib/session-clone.test.mjs`)**
   - Build a temporary branched JSONL source with an abandoned sibling and labels.
   - Clone a selected non-tail branch and assert: distinct native ID/file, exact root-to-leaf entries, no sibling entries, copied labels, normalized `parentSession` pointing to the source, and byte-for-byte unchanged source.
   - Assert invalid/missing leaves fail safely and a native user-only path with no materialized file maps to `nothing_to_clone` without web-owned persistence.
2. **Wrapper/lifecycle (`lib/rpc-manager.test.mjs`)**
   - Exercise clone with a minimal fake inner session: success keeps the wrapper alive and preserves live source ID/leaf; running prompt/stream/compaction returns `busy`; stale client/live leaf returns `stale_leaf` and writes nothing.
   - Use a deferred extension-binding fake to prove `isRunning()` is already true before prompt preflight finishes and clone cannot overtake the accepted prompt.
   - Retain the existing startup regression assertion.
3. **Command routing**
   - Factor/export the smallest pure exact-command predicate needed to test `/clone` versus `/clone ...` and whitespace normalization.
   - Source-level/structural assertions may cover callback wiring where the repository has no DOM harness; do not introduce a new frontend test framework for this feature.
4. **Repository checks**
   - Focused: `node --test lib/session-clone.test.mjs lib/rpc-manager.test.mjs <focused-command-test>`.
   - Full current Node suite: `node --test components/*.test.mjs lib/*.test.mjs`.
   - Typecheck: `node_modules/.bin/tsc --noEmit`.
   - Lint: `npm run lint`.
5. **Manual browser user flow**
   - From a persisted branched session, select a non-tail branch and run `/clone`; observe the existing success notice, unchanged source chat/URL, and the ordinary child under its source in the sidebar; open it deliberately and compare history.
   - While a run is active, submit `/clone` with Enter and streaming controls; observe the exact wait error, preserved input, and no queued/model message.
   - From an empty/unsaved composer, observe **“Nothing to clone yet”**, preserved input, and no session creation.
   - Repeat with the sidebar closed/mobile-sized to verify the existing notice is sufficient and no drawer opens.

Automated browser/DOM coverage is **blocked** by the repository's lack of a browser interaction harness; manual user testing is required rather than waived. A release build is **waived** by the explicit no-`next build` constraint. External provider/LLM execution is **not applicable** because clone performs local session-file work only.

## Telemetry / Debuggability

- Return bounded clone result codes so the client never needs to display raw SDK/filesystem text.
- Log only unexpected server failures with a stable event name and bounded stage (`eligibility`, `extract`, `verify`, or `cleanup`), source session ID, and error class/name. Do not log session content, full file paths, leaf content, credentials, or provider payloads.
- Do not add success analytics or persistent telemetry; the existing success notice plus immediate sidebar refresh is the observable success signal.
- Verify diagnostics through focused failure tests and source scrutiny; cleanup failure may emit a bounded warning but must not mask the original `clone_failed` result.

## Validation Contract

### VC-001 — Native clone artifact

- **Priority / type:** P0, session persistence and public behavior.
- **Required truth:** An eligible invocation creates one ordinary Pi JSONL file with a distinct ID, the exact selected root-to-leaf branch, native copied labels/metadata, and source `parentSession`; abandoned siblings are absent.
- **Required evidence:** Synthetic native-extraction test plus manual opening of the created sidebar child.
- **Validator mode:** scrutiny and user-testing.
- **Blocker / waiver:** Any mismatch blocks completion; no waiver.

### VC-002 — Source isolation and source-stable UI

- **Priority / type:** P0, runtime lifecycle/UI state.
- **Required truth:** Clone never calls the mutating primitive on the live manager, never destroys/re-keys the source wrapper, and never changes source selection, chat key, URL, or active path.
- **Required evidence:** Wrapper test asserting source ID/leaf/aliveness, source-byte assertion, code review, and manual source URL/chat observation.
- **Validator mode:** scrutiny and user-testing.
- **Blocker / waiver:** Any source mutation or navigation blocks completion; no waiver.

### VC-003 — Running and command-routing safety

- **Priority / type:** P0, concurrency and input routing.
- **Required truth:** Exact `/clone` during prompt acceptance, streaming, tools, retry/continuation, or compaction is rejected with **“Wait for the current run to finish before cloning”**; input remains; no model, steer, follow-up, or abort action receives it.
- **Required evidence:** Deferred-binding/running wrapper tests, exact-command routing test/source inspection, and manual active-run submission through Enter and streaming controls.
- **Validator mode:** scrutiny and user-testing.
- **Blocker / waiver:** Any queued/model delivery or run overlap blocks completion; no waiver.

### VC-004 — Eligibility and bounded failures

- **Priority / type:** P0, error behavior.
- **Required truth:** Empty/unsaved or non-materialized native branches report **“Nothing to clone yet”** without creating web state; missing source, stale leaf, and unexpected failures use D-012 messages, preserve input, and emit neither success nor refresh.
- **Required evidence:** Focused helper/wrapper tests, command-result mapping inspection, and manual empty-session check.
- **Validator mode:** scrutiny and user-testing.
- **Blocker / waiver:** False success, raw-path leakage, or unintended session creation blocks completion; no waiver.

### VC-005 — Ordinary discovery and feedback

- **Priority / type:** P1, sidebar/public UI.
- **Required truth:** Success invalidates the normal cache, requests the existing session-list refresh, shows **“Cloned session — available in sidebar”**, clears `/clone`, and displays the clone through existing `parentSession` ancestry without clone-specific discovery or opening the sidebar.
- **Required evidence:** Cache/helper assertions where practical, callback code review, and desktop/mobile manual observation.
- **Validator mode:** scrutiny and user-testing.
- **Blocker / waiver:** Missing ordinary discovery or incorrect ancestry blocks completion. Automated visual coverage is blocked; manual evidence is mandatory.

### VC-006 — Existing branch operations remain unchanged

- **Priority / type:** P1, regression.
- **Required truth:** Contextual **New session** fork still selects its new session and destroys/reloads according to its existing path; **Edit from here** and branch navigation remain unchanged.
- **Required evidence:** Focused regression inspection/tests, full Node suite, and one manual fork/branch smoke pass if browser validation is available.
- **Validator mode:** scrutiny and user-testing.
- **Blocker / waiver:** Any regression blocks completion; manual smoke may be marked blocked only if browser access itself is unavailable, with code/test evidence still required.

### VC-007 — Static and repository quality gates

- **Priority / type:** P1, TypeScript/lint/test suite.
- **Required truth:** Focused and full Node tests, `tsc --noEmit`, and lint pass with no unrelated source changes.
- **Required evidence:** Exact commands and exit codes in the implementation checkpoint/handoff.
- **Validator mode:** scrutiny.
- **Blocker / waiver:** Failures block completion unless proven pre-existing with baseline evidence. `next build` is explicitly waived and must not run.

### VC-008 — Diagnostics and maintained knowledge

- **Priority / type:** P1, privacy/debuggability/docs.
- **Required truth:** Unexpected failures expose bounded stage/code diagnostics without content/full paths, and README English/Chinese, AGENTS, and project memory consistently describe the native-file/non-replacing-host contract.
- **Required evidence:** Failure-path test/source inspection and documentation diff review.
- **Validator mode:** scrutiny.
- **Blocker / waiver:** Raw sensitive diagnostics or contradictory maintained docs block completion; no waiver.

## Approved Implementation Estimate

- **Implementation surfaces:** six narrow production files including one small extraction helper; two or three focused test files; maintained README/AGENTS/memory updates. No API schema route, session reader, or sidebar-tree rewrite.
- **Testability:** high for native artifact and server guards through temporary JSONL/fake-session tests; medium for composer/sidebar behavior because the project lacks a DOM harness, requiring a bounded manual browser pass.
- **Complexity:** small-to-medium. The core clone call is small; the material complexity is preventing streaming delivery, source mutation, and stale/running races without adopting Pi's replacement runtime.
- **Expected delivery shape:** one coherent implementation milestone, independent fresh-context review, focused fixes if needed, then final validation/closeout.

## Assumptions, Risks, and Blockers

- Wrong-leaf risk is controlled by requiring the browser-displayed leaf to equal the live wrapper manager's leaf immediately before extraction; mismatch fails instead of guessing.
- A selected path with no assistant message produces no native file unless a replacement runtime is retained. The thin adapter reports **Nothing to clone yet** rather than add custom persistence.
- Pi's native writer is not atomic. Best-effort cleanup handles caught failures, but a process crash or uncatchable interruption can still leave a partial native candidate; staging/atomic publication was explicitly declined as disproportionate to the requested pass-through.
- The existing sidebar can theoretically apply an older in-flight list response after the clone-triggered refresh. Server cache invalidation remains generation-safe, and a later refresh discovers the native file; a general sidebar request-order refactor is outside this plan.
- The one-composer promise prevents accidental local double submission, but separate tabs/API calls remain separate clone requests and can intentionally create multiple children.
- Pi-web's maintained `AGENTS.md` describes the pre-0.65 `AgentSession.fork()` mutation model. This plan requires correcting it to the current direct-fork and disposable-manager clone behavior without redesigning fork.
- The selected non-replacing adapter deliberately bypasses extension preflight/cancellation, so clone-specific dirty-tree guards or checkpoints do not run from pi-web. Documentation must present this as a host-lifecycle divergence, not full TUI parity.
- No implementation blocker remains. SDK 0.82.1 exposes the selected `createBranchedSession(leafId)` primitive, dependencies are installed, and the current Node/Jiti test harness can exercise the file and wrapper boundaries.

## Implementation Handoff

- **Approved plan:** `.agents/plans/2026-07-21-clone-session.md`
- **Canonical implementation opener:** `/start-implementation .agents/plans/2026-07-21-clone-session.md`
- **Kickoff contract:** Start Implementation must create a non-main task worktree from the committed approved plan and launch the fixed prompt `Implement the approved plan at .agents/plans/2026-07-21-clone-session.md.` Implementation does not begin merely because this plan is approved or committed.
