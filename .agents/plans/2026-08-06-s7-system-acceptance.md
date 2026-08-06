# S7 System Acceptance Boundary

Status: approved

Master: `.agents/plans/2026-07-30-persistent-stream-websocket-migration.md`

## Objective

Close the remaining S7 system-acceptance milestone on the latest integrated local-main baseline without changing implementation source. Treat the user's real-world testing and explicit 2026-08-06 closeout direction as the human acceptance gate. Run the remaining reproducible automated and static checks, record every formal browser/load item that cannot be reconstructed as an accepted departure rather than a pass, commit the S7 evidence boundary, and then hand control to the master's separate full-master validation and ordinary guarded closeout.

## Design / Implementation Strategy

- Begin from local main `08f49cf714b6ada490bda3ded3b4c7a69d80d297`, which contains the orchestration tip `91c8c1df90ce4733431056679a78c0b7f8195f74`, accepted S1-S6, production-route validation, live-tip reconciliation, and stale-running-status correction.
- Make no implementation-source, test-source, configuration, dependency, release, or wiki edits. S7 may update only this immutable plan, its matching checkpoint, `AGENTS.md`, the existing custom-server transport memory and append-only memory log, and one bounded S7 acceptance report so maintained current-state documentation no longer describes the gateway as dormant or agent/file SSE as authoritative.
- Re-run the complete current automated suite, TypeScript, ESLint, package dry run, whitespace, Git containment, and source-boundary inventories. Never run `next build`.
- Verify statically that the only browser `EventSource` remaining is the deliberately transient OAuth login flow and that the persistent global/session/file-watch callers and routes are absent.
- Accept the user's real-world testing as the S7 human gate without inventing browser counts, exact socket counts, timing, rendering coverage, or provider workload details that were not recorded.
- Reconcile the accepted S1, S4B, S5, and S6 reports/checkpoints rather than discarding their real Firefox/Chromium, hidden-stream, reconnect, offline/online, restart, file-refresh, lifecycle, ordering, and cleanup evidence.
- Record these remaining unproven S7 classes explicitly as accepted departures: an exact S7 rerun of the Firefox and Chromium 1/5/10-page inventory; exact 1/7/10 aggregate session subscriptions; the combined 10-page + 10-session + 10-mounted-viewer 30-WebSocket topology; measured 5-page/7-run and 10-page/10-run HTTP schedulability/responsiveness; one combined run spanning visible/hidden retry, queue, compaction, navigation, background/foreground, offline/online, refresh, and restart; one combined all-media file-viewer change/deletion/recreation/reconnect/path/teardown run; one complete rich Markdown/code/math/Mermaid/tools/extensions/branch/fork/clone/models/auth/config/files/worktrees/export/sound/hosted-discovery visual matrix; and S7-specific projected-byte and owned-resource observations beyond the accepted milestone evidence.
- Update maintained documentation, memory, and the S7 report; documentation obligations are not waived.
- After the S7 evidence commit, perform full-master validation as a distinct phase. Any newly observed source/test blocker remains a bounded fix obligation; any need to reinterpret the user's accepted departures stops for clarification.

## Scope Estimate

- **Files:** this plan; `.agents/checkpoints/2026-08-06-s7-system-acceptance-checkpoints.md`; `.agents/reports/2026-08-06-persistent-stream-websocket-system-acceptance.md`; `AGENTS.md`; `.agents/memory/custom-server-lifecycle.md`; and append-only `.agents/memory/log.md`.
- **Implementation complexity:** low; evidence and maintained-documentation disposition only.
- **Testability:** high for automated/static/Git checks; deliberately unavailable for reconstructing historical browser/load details.
- **Context target:** zero compactions.

## Retained Evidence Inputs

The S7 report must map each master acceptance class to these exact committed sources before labeling it proven, partially proven, or an accepted departure:

- S1 implementation/report commit `f0fc1ac7296065dfca0aeb0038e2b6e2ed04837a`; final checkpoint commit `dbe3a52f925dac808d87750e188d1b7095e9afb1`; `.agents/checkpoints/2026-07-31-s1-global-running-websocket-checkpoints.md`; `.agents/reports/2026-08-01-s1-global-websocket-validation.md`.
- S2 implementation `39f22f0eafa418a3bac5e664b35764ff43213f27`; final checkpoint commit `26ec788052fbd7297ffd787f4b71a1c993b72589`; `.agents/checkpoints/2026-08-01-s2-projected-session-protocol-hub-checkpoints.md`.
- S3 implementation `2f3eb50cb8b7ef0c8eef92097b9c5a6ce0a8b614`; final checkpoint commit `43b9e0cc857f8ccd98082481a08f3ac2e72469af`; `.agents/checkpoints/2026-08-02-s3-secure-session-websocket-checkpoints.md`.
- S4A implementation `11036f6b2f829b7e27bad9e2fee4148d5925915d`; final checkpoint commit `598f804777132f049a88751becddef3e7d6b33f3`; `.agents/checkpoints/2026-08-02-s4a-browser-session-registry-reducer-checkpoints.md`.
- S4B implementation/report commit `80eea2247860241f0632cd1fc272d25ddcbbbe5b`; final checkpoint commit `2d37c9888c34b112d069f4093d69136543986079`; `.agents/checkpoints/2026-08-02-s4b-hook-migration-hidden-streams-checkpoints.md`; `.agents/reports/2026-08-02-s4b-browser-session-migration.md`.
- S5 implementation `e82e9bdc6c020d0663eec12515bf41c3aa5d6ad8`; final checkpoint commit `c7f4a4c3bf488c6ef6ad5da2caebc96cdc1c8174`; `.agents/checkpoints/2026-08-03-s5-persistent-file-watch-websocket-checkpoints.md`.
- S6 implementation `5565a2428fdaccb63b3a0c1e376060eea4919dc1`; implementation-finality commit `98cf3b76fe4e86ae14090cb90721c452e3ec4dad`; interim-integration checkpoint commit `91c8c1df90ce4733431056679a78c0b7f8195f74`; `.agents/checkpoints/2026-08-03-s6-lifecycle-security-shutdown-checkpoints.md`.
- Production-route correction `5dc645fe94000c328149cb6c7590a107959af0aa` and checkpoint commit `473236c2eaa2c65f845b18c61974ab859488ea9e` at `.agents/checkpoints/2026-08-03-production-route-handler-exports-checkpoints.md`.
- Live-tip correction `fd84e46f15d04ba3c0ed2bd58dcddc8c41ace71d` and checkpoint commit `16bc179aaf1443f2685a97f197c0a8f7f9252ac6` at `.agents/checkpoints/2026-08-05-live-tip-transcript-reconciliation-checkpoints.md`.
- Running-status correction `e5dc92f58d10952e0ed28df698fea990463df96b` and checkpoint commit `cc0b997e9206dca8a836ec18fd8f9de48a2b5461` at `.agents/checkpoints/2026-08-05-stale-running-session-status-checkpoints.md`.

## Test Strategy

Run these literal commands from the orchestration checkout; `MAIN=/Users/xin/Documents/repos/pi-web`:

```bash
MAIN=/Users/xin/Documents/repos/pi-web
node --test lib/*.test.mjs components/*.test.mjs
"$MAIN/node_modules/.bin/tsc" --noEmit
PATH="$MAIN/node_modules/.bin:$PATH" npm run lint
npm pack --dry-run --json
git status --short --branch
git diff --name-only
git diff --cached --name-only
git diff --check
git diff --cached --check
git rev-parse HEAD main
git rev-list --left-right --count main...HEAD
git log --oneline --decorate --max-count=40 HEAD

git merge-base --is-ancestor 91c8c1df90ce4733431056679a78c0b7f8195f74 HEAD
git merge-base --is-ancestor 5565a2428fdaccb63b3a0c1e376060eea4919dc1 HEAD
git merge-base --is-ancestor 5dc645fe94000c328149cb6c7590a107959af0aa HEAD
git merge-base --is-ancestor fd84e46f15d04ba3c0ed2bd58dcddc8c41ace71d HEAD
git merge-base --is-ancestor e5dc92f58d10952e0ed28df698fea990463df96b HEAD

test "$(rg -l 'new EventSource' components hooks --glob '*.{ts,tsx}' | sort)" = 'components/ModelsConfig.tsx'
test ! -e 'app/api/agent/running/events/route.ts'
test ! -e 'app/api/agent/[id]/events/route.ts'
! rg -n "EventSource|type[=:][[:space:]]*['\"]watch['\"]|[?&]type=watch" components/FileViewer.tsx
! rg -n 'Watchpack|watchpack|process\._getActiveHandles|_getActiveHandles|next/dist' bin lib app components hooks --glob '*.{js,mjs,ts,tsx}' --glob '!*.test.mjs'
rg -n 'gateway\.registerChannel\((GLOBAL_STATUS_CHANNEL|SESSION_TRANSPORT_CHANNEL|FILE_WATCH_CHANNEL)' lib/global-status-channel.ts lib/session-channel.ts lib/file-watch-channel.ts
```

Run the complete block after the approved S7 plan/checkpoint commit and after all four maintained-documentation/report edits are complete, but before staging the S7 acceptance commit. Expected results: the test command exits zero with no failed/cancelled tests and its exact pass count is recorded; TypeScript exits zero; lint exits zero with every warning recorded; package dry run exits zero and its JSON contains no `.next/dev`, `.next/cache`, or JavaScript source-map package entry; both whitespace commands exit zero; the unstaged path inventory is exactly the four post-plan documentation/report paths plus the checkpoint update and the cached inventory is empty. `HEAD` must descend from `08f49cf714b6ada490bda3ded3b4c7a69d80d297`; all five explicit ancestry commands must exit zero. `main...HEAD` and the log are recorded inventories: a main advance is not silently ignored and must be reconciled again at closeout.

Expected source outcomes are exactly one production `new EventSource` file (`components/ModelsConfig.tsx`), both removed agent SSE routes absent, no file-viewer SSE/watch query, no private Next/Watchpack/active-handle source match, and one registration match in each of the three production channel modules. Any deviation blocks S7 pending direct inspection. Immediately before the S7 acceptance commit, stage only the five post-plan S7 paths (checkpoint plus four documentation/report paths), repeat cached/unstaged path inventories plus both whitespace checks, and require no unstaged S7 path or unrelated staged path.

Do not run `next build`, fabricate browser automation, expose private payloads, or delete main-worktree runtime state.

## Telemetry / Debuggability

Use only bounded command outcomes, test counts, commit/path inventories, and content-safe source matches. Do not record prompts, messages, tool/provider payloads, tickets, credentials, raw session IDs, private filenames, or full process environments.

## Validation Contract

| ID | Required truth | Evidence | Blocker / departure path |
|---|---|---|---|
| S7-VC-001 | Latest local main contains the complete committed orchestration tip and accepted S1-S6 history. | Ancestor/divergence checks and commit inventory. | Missing committed work blocks S7. |
| S7-VC-002 | Current integrated source passes the complete automated suite, typecheck, lint, package dry run, and whitespace checks. | Exact command outcomes in the checkpoint. | A reproducible failure blocks acceptance unless explicitly dispositioned by the user. |
| S7-VC-003 | Persistent global, session, and file-watch EventSource transport is absent; transient OAuth login is the only browser EventSource. | Static source inventory and existing transport tests. | Any persistent EventSource blocks S7. |
| S7-VC-004 | Human acceptance is real but not overstated. | User's 2026-08-06 direction and explicit departure list. | Exact unrecorded browser/load claims are departures, never inferred passes. |
| S7-VC-005 | Maintained current-state documentation, durable transport memory, append-only log, and one bounded S7 report accurately describe the production WebSocket transport and accepted departures. | Exact documentation diff and source reconciliation. | Stale SSE/dormant-gateway guidance blocks S7. |
| S7-VC-006 | S7 changes only the six approved evidence/documentation paths and preserves unrelated main/task state. | Git path/status checks. | Any implementation-source mutation or unrelated-state loss blocks. |
| S7-VC-007 | S7 acceptance is committed before separate full-master validation and closeout. | S7 checkpoint summary and commit. | Closeout cannot begin before this boundary. |

## Assumptions and Risks

- User testing establishes practical acceptance but does not prove the exact formal browser/load matrix.
- Later main changes overlap live-session behavior and therefore require the current full automated suite rather than relying only on S1-S6 historical results.
- The retained orchestration checkout's previously local subagent/build/dependency state was permanently deleted under explicit user authorization before this plan was created.
- S7 and ordinary guarded closeout do not themselves remove the task worktree or branch. The user's separately authorized cleanup may run only afterward, with a fresh eligibility preflight and non-force removal.
- Another registered task checkout contains unrelated active work; final main integration must repeat preflight and avoid overlapping paths or races.
