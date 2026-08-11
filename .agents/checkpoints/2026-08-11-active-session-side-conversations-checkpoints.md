# Active-Session Side Conversations — Checkpoints

Plan: `.agents/plans/2026-08-11-active-session-side-conversations.md`

## Handoff

**Source:** Async workflow `c37ea250-a9ca-4be5-a4cf-afa3e7155feb`; read-only scouts `dab06a45` (native/server), `e4c82401` (projection/client), and `75bf5caf` (marker/algorithm/tests). Recoverable reports are under `.pi-subagents/artifacts/outputs/<run-id>/context.md` and the workflow status artifact under `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/c37ea250-a9ca-4be5-a4cf-afa3e7155feb/status.json`.

**Purpose:** Map the approved plan onto the native extraction boundary, wrapper/service construction, strict marker/cutoff logic, canonical root/context projection, browser command/selection flow, and focused validation seams without modifying project files.

**Outcome:** The reports agree on five decisive seams: (1) add a separate transactional side extraction operation instead of changing `/clone`; (2) classify side identity before `createAgentSessionServices()` and preserve it immutably on the wrapper; (3) use loader-level whole-extension filtering plus SDK `excludeTools`; (4) apply raw marker-subtree projection before tree contraction and context presentation, with generic side compaction notices; and (5) route exact `/side` through a distinct active-safe client callback that selects through the existing page transport. Direct RPC and extension-context navigation require the same marker-descendant guard. Existing transport already retains a deselected active source.

**Evidence:** `lib/session-clone.ts` owns disposable `createBranchedSession()` and candidate cleanup; native declarations expose `appendCustomMessageEntry`, `appendSessionInfo`, `getBranch`, `getTree`, `extensionsOverride`, `appendSystemPromptOverride`, and `excludeTools`. `lib/rpc-manager.ts` currently has separate direct and extension navigation paths and a tools-off prompt override. `lib/session-reader.ts` currently renders raw compaction summaries. `app/api/sessions/[id]/route.ts` contracts trees after reading raw native roots. `hooks/useAgentSession.ts` has separate clone and Fork contracts; `components/ChatInput.tsx` blocks ordinary streaming submission before host command delivery; `components/AppShell.tsx` owns two-phase selection and stale-generation guards.

**Uncertainty / gaps:** The reports did not replace parent verification of exact native runtime behavior. The installed dependency declarations are from the pinned retained-main `node_modules`; this task worktree uses an ignored symlink to that exact install for focused validation. Realistic browser smoke still requires a running configured model and will be attempted after automated checks. Unrestricted `bash` remains outside the supported hard capability boundary by approved design.

**Recommended use:** Implement in the approved five surfaces, beginning with the pure side module and transactional extraction, then wrapper/services, canonical projection/routes, client selection/UI, and finally broad tests/review. Keep one parent writer and use fresh-context reviewers only after a coherent diff exists.

## Handoff

**Source:** Read-only reviewers `0567330f` (server/native), `3211f402` (browser/client), and `b227b896` (runtime capability/policy). Recoverable outputs are `.pi-subagents/artifacts/<run-id>_reviewer_0_output.md` with matching transcripts.

**Purpose:** Independently review the coherent implementation against the approved plan, emphasizing native extraction and cutoff safety, source isolation, marker/navigation enforcement, runtime capability removal, client lifecycle races, Return behavior, transcript filtering, and validation gaps.

**Outcome:** The server reviewer found two blocking defects: native extraction regenerates retained label IDs, and an unresolved tool batch followed by later conversation was refused instead of cutting at the unresolved assistant's parent. The capability reviewer found a direct marker-boundary context escape and the absence of a real `startRpcSession()` loader/reload/reopen test. The client reviewer found stale root metadata publication after hook unmount, an insufficiently visible/disabled Return failure state, incomplete side clone result/palette handling, and several high-value mounted integration gaps. The parent corrected the extraction verification with stable non-label identity plus the candidate leaf, changed unresolved batches to cut before the assistant while retaining strict malformed-ID refusal, rejected direct boundary/ancestor context requests, added real side startup/reload/tools-off/reopen coverage, guarded metadata by mounted session identity, made Return failures visible and disabled, mapped side derivation failures explicitly, filtered duplicate side/clone palette commands, hydrated complete child metadata, and expanded mounted/browser-facing regressions.

**Evidence:** Reviewer reproductions and file references are preserved in the three output files. Corrective tests cover regenerated labels (`lib/session-clone.test.mjs`), abort-then-continue cutoff selection (`lib/side-session.test.mjs`), boundary route refusal (`lib/session-route.test.mjs`), real capability persistence (`lib/rpc-manager.test.mjs`), and stale client responses plus active-safe side routing (`components/SessionAgentTransport.test.mjs`, `components/ChatInput.test.mjs`).

**Uncertainty / gaps:** Reviewers did not perform the realistic browser flow. Their reviews occurred while the parent was still adding documentation and tests, so line numbers and suite totals in raw reports describe intermediate revisions. The approved unrestricted-`bash` non-sandbox boundary remains intentional.

**Recommended use:** Treat every named defect as resolved only with the later follow-up review and final parent validation below; retain the raw reports as the provenance for why the added regressions exist.

## Handoff

**Source:** Follow-up read-only workflow `7330e144-c53a-4a60-b639-d82e44dc0f04`; server reviewer `0598cc5f` and client reviewer `5f6408dd`. Recoverable outputs are `.pi-subagents/artifacts/0598cc5f_reviewer_0_output.md` and `.pi-subagents/artifacts/5f6408dd_reviewer_0_output.md`.

**Purpose:** Re-review the corrected server/runtime and client surfaces, with special attention to the earlier label, unresolved-batch, marker-boundary, capability-persistence, stale-selection, Return, hydration, and source-retention findings.

**Outcome:** The server reviewer reported no blocker or fix-worthy issue and verified label-aware extraction, unresolved-batch cutoff behavior, strict entry graphs, boundary refusal, whole-extension filtering across reload/reopen, defensive tool exclusion, and exact naming. The client reviewer confirmed the corrected root metadata, Return, hydration, routing, palette, transcript, source-retention, and Full-history behavior, but found one remaining medium race: a slow successful `/side` response could still select its child after a newer branch or prompt intent in the same mounted session. The parent captured the invocation leaf generation, required it to remain current before child selection, and added a mounted delayed-response/newer-branch regression; the focused client file and final suites pass with that correction.

**Evidence:** Raw follow-up outputs above; corrective code in `hooks/useAgentSession.ts`; mounted regression in `components/SessionAgentTransport.test.mjs`; final focused side suite 250/250 and full Node suite 856/856.

**Uncertainty / gaps:** The follow-up reviewers did not rerun the parent's browser smoke. The final same-session selection-race fix was parent-verified by the mounted regression and broad validation rather than a third reviewer turn. No production build was run because the approved test strategy and repository instructions explicitly prohibit `next build` during development.

**Recommended use:** Accept the follow-up as independent evidence that the substantive server/runtime and client contracts are clean, supplemented by the final mounted race regression and parent validation.

## Implementation Summary

**Plan section:** Surface 1 — pure side-session marker, cutoff, ancestry, projection, and policy module.

**Work and outcome:** Added `lib/side-session.ts` with strict reserved-marker parsing, complete entry-graph validation, immutable branch cutoff selection, exact tool-call/result normalization, marker-descendant navigation, post-boundary transcript/tree projection, generic side compaction presentation, fixed policy/tool/extension identifiers, and UTC side naming. Malformed graphs or tool batches fail closed; unresolved batches cut before their assistant and exclude all partial results.

**Validation / evidence:** `lib/side-session.test.mjs`; focused side suite 250/250; full Node suite 856/856; independent server follow-up review `0598cc5f`.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Surface 2 — distinct transactional native side extraction.

**Work and outcome:** Extended `lib/session-clone.ts` with a separate side operation that reopens the source on a disposable manager, extracts only the captured cutoff, tolerates native label-ID regeneration while verifying stable retained entries, appends one targeted hidden marker and native name, reopens and verifies identity/ancestry/leaf state, and removes every unadvertised candidate on finalization failure. Existing clone statuses and non-replacing behavior remain separate.

**Validation / evidence:** Native temporary-session tests in `lib/session-clone.test.mjs`, including injected failures, unmaterialized prefixes, generated labels, ancestry, exact naming/marker verification, and source non-interference; focused and full suites above; reviewer reproduction/follow-up `0567330f` and `0598cc5f`.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Surface 3 — wrapper command, side runtime policy, capability removal, and navigation/derivation enforcement.

**Work and outcome:** `lib/rpc-manager.ts` now classifies side identity before service construction, injects the mandatory side policy through the resource loader, removes whole extensions registering the exact delegation/implementation-launch capabilities, applies defensive excluded-tool names through SDK and tool surfaces, retains side identity on the wrapper, handles active or idle `/side` without altering source lifecycle, refuses side `/side`, `/clone`, and Fork, and enforces marker-subtree navigation for direct and extension actions. Tools-off mode retains the mandatory side policy.

**Validation / evidence:** Wrapper and real SDK/resource-loader coverage in `lib/rpc-manager.test.mjs` exercises active/idle source isolation, repeated siblings, direct/extension guards, startup, reload, tools-off, reopen, safe extension retention, command/tool exclusion, and policy persistence; focused and full suites; reviewer `b227b896` and follow-up `0598cc5f`.

**Departures from approved obligations:** None. The approved direct-shell non-sandbox limitation remains documented rather than treated as an enforcement promise.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Surface 4 — canonical side-aware session reads and browser transcript convergence.

**Work and outcome:** Root and context routes now classify reserved state, refuse malformed/off-boundary views, filter inherited messages and the marker from ordinary side presentation, project the branch tree from marker children, expose bounded side/parent metadata, and replace side compaction summary text with a generic notice. HTTP root/context repair remains authoritative; live effects wait for canonical root state and sanitize side compaction events. The explicit Full history route remains unchanged and complete.

**Validation / evidence:** `lib/session-route.test.mjs`, `lib/side-session.test.mjs`, and mounted transport tests cover suffix projection, boundary/ancestor refusal, graph corruption, compaction, canonical metadata publication, stale root suppression, and Full history's complete-native-file exception. Focused and full suites pass.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Surface 5 — exact command composition, immediate child focus, Return control, action hiding, permanence, documentation, and end-to-end behavior.

**Work and outcome:** Added exact active-safe `/side` composition and coalescing, immediate child selection through existing view transport, complete child hydration, same-session leaf-generation and unmount/session stale-response guards, side-only non-mutating Return-to-parent with complete-list resolution and visible disabled failure state, side palette/Fork action suppression, and maintained English/Chinese/project documentation. Side children remain ordinary durable tree nodes governed only by existing Hide/Restore. A temporary Chrome/CDP smoke created and selected a durable side child during a source turn, showed an empty inherited transcript, exercised Return, and verified listing ancestry/name; temporary server/browser/session artifacts were removed afterward.

**Validation / evidence:** `components/ChatInput.test.mjs` and `components/SessionAgentTransport.test.mjs` cover exact command/image routing, active submission, coalescing, selection, retained source transport, canonical side metadata, stale root/creation responses, and newer same-session branch intent. Parent browser smoke covered normal creation/selection/Return/durability. `README.md`, `README.zh-CN.md`, and `AGENTS.md` describe the resulting behavior.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Final validation and completed plan outcome.

**Work and outcome:** Completed all five approved surfaces in implementation commit `13dec7c689c3cc595414a39fa10f2694691b0ba9`: strict snapshot cutoff and marker projection, transactional native side extraction, side runtime/capability enforcement, canonical route/live convergence, and durable client selection/Return/documentation. Independent review defects were corrected, including native label regeneration, unresolved tool batches with later conversation, direct boundary context access, real loader persistence coverage, stale metadata and same-session selection races, Return failure presentation, and child hydration/palette outcomes. The source remains non-replacing, side children are durable terminal derivation nodes, and Full history remains intentionally complete.

**Validation / evidence:** Focused side/runtime/client command passed 250/250. Full repository Node command `NODE_ENV=development node --test $(find app components hooks lib -name '*.test.mjs' -print)` passed 856/856. `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed. Real `startRpcSession()` tests covered startup/reload/tools-off/reopen filtering. A temporary Chrome/CDP smoke verified side creation/selection, hidden inherited presentation, Return, durable listing, ancestry, and generated naming; its temporary artifacts were removed. Follow-up server review `0598cc5f` found no blocker or fix-worthy issue; the final client race from `5f6408dd` was corrected and covered by a mounted regression. Per the approved validation strategy and repository instruction, no `next build` was run.

**Departures from approved obligations:** None. The approved limitation that unrestricted `bash` is not a hostile-shell sandbox remains part of the delivered contract, not a departure.

**Implementation commit:** `13dec7c689c3cc595414a39fa10f2694691b0ba9`.
