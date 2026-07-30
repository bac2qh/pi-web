# Pi Web-Hosted Implementation Session Runtime Validation

Date: 2026-07-29
Plan: `.agents/plans/2026-07-28-pi-web-hosted-implementation-sessions.md`

## Environment

- Ran the task checkout with Next development mode on isolated port `30143`; no production build was run.
- Used an isolated temporary `PI_CODING_AGENT_DIR`, temporary Git repository, committed approved synthetic plan, and local faux provider from installed Pi AI.
- The provider used no network, credential, private session, external model, or implementation tool. Its kickoff response remained pending until target Stop.
- Loaded the task version of the Start extension from the registered dot_files companion worktree.

## Browser and control flow

A headless Chromium browser opened the already-persisted source session before Start was submitted. The source launched `/start-implementation .agents/plans/2026-07-29-hosted-runtime-browser-realpath.md` through the ordinary Pi Web agent route.

Observed results:

```json
{
  "sourceId": "019fac50-2bee-72be-95c3-4eca5818dda3",
  "targetId": "019fac50-2e29-748b-94bd-9a2b67c29c2b",
  "sourceUrlPreservedDuringDiscovery": true,
  "targetAppearedWithoutBrowserRefresh": true,
  "sourceSecondPromptCompletedWhileTargetActive": true,
  "sourceStopIsolated": true,
  "targetSelectedThroughOrdinarySidebar": true,
  "targetSteerQueued": true,
  "targetFollowUpQueued": true,
  "targetStopCompleted": true,
  "targetSelectionPreservedAfterStop": true,
  "browserPageErrors": []
}
```

The target appeared through the sidebar's ordinary session list after the server's `sessions_changed` event. Discovery did not select it or change the source URL. Clicking the row deliberately selected the target. Target-addressed steer and follow-up messages appeared in the registered wrapper's native queues; source Stop left the target running; target Stop ended it.

## Ownership and diagnostics

For the accepted target ID, captured server logs contained exactly one of each:

- `ownership_accepted`
- `kickoff_scheduled`
- `kickoff_dispatched`
- native `session_start` dispatch
- `target_settled`
- `owner_cleanup` after server termination

The longest hosted lifecycle diagnostic was 115 characters. A scoped search found zero kickoff text, plan path, synthetic steer/follow-up text, test environment names, credential markers, provider payload markers, or tool payload markers in server logs.

## Process lifetime and native resume

After target settlement, the complete development server process tree was terminated and port `30143` was confirmed closed. `SessionManager.open()` then reopened the target JSONL directly:

```json
{
  "serverStopped": true,
  "reopenedSessionIdMatches": true,
  "persisted": true,
  "entryCount": 9,
  "messageRoles": ["user", "assistant", "user", "assistant", "user", "assistant"],
  "cwdIsTargetWorktree": true
}
```

This proves process exit ended live ownership while the native session remained resumable.

## Hosted Orchestrate nested-depth flow

A second isolated development run loaded the tracked Pi Subagents runtime, global `maxSubagentDepth: 2`, the changed global policy/agent contracts, the Orchestrate extension, and a deterministic local provider. The approved synthetic master embedded the finalized Orchestrator Mission Workflow. No external model, network, credential, private input, or source write was used.

The Pi Web-hosted Orchestrate target settled normally after one root → implementer → support chain:

```json
{
  "targetId": "019fac57-f63e-7595-9e28-fecf3851539c",
  "hostedOrchestrateSettled": true,
  "rootDepth": [[0, 2]],
  "rootHasSubagent": true,
  "implementerDepth": [[1, 2]],
  "implementerHasNestedTools": true,
  "supportDepth": [[2, 2]],
  "supportReadOnlyNoDelegation": true,
  "maxObservedDepth": 2,
  "recoverableChildIdentities": true,
  "evidenceEntries": 5
}
```

Every implementer provider call exposed `subagent` and `subagent_wait`; every support call omitted `subagent`, `edit`, and `write`. Child evidence carried real run and session IDs. Installed-depth tests separately prove that an attempted child from depth two is mechanically blocked. Server logs contained exactly one Orchestrate ownership acceptance, kickoff scheduling, native target `session_start`, and cleanup; the longest hosted diagnostic was 121 characters and a scoped payload-marker search returned zero matches.

## Notes and bounded gaps

- The installed extension API normally supplies no `ctx.signal` to an exact idle command. Automated tests therefore cover both an unavailable signal and injected abortable pre-publication races; runtime source Stop was verified only after publication, where it correctly had no target authority.
- An initial synthetic run supplied the source cwd through macOS's `/tmp` alias while Git returned the target through `/private/tmp`; ordinary discovery succeeded at the API but project grouping treated those lexical roots separately. The accepted browser run used the canonical realpath for both, matching normal `/Users/...` repository operation. Canonicalizing arbitrary symlinked project roots is outside this plan.

## Post-runtime deterministic closures

Fresh review after the browser runs found four bounded sibling defects that did not require another architecture or ownership path: destruction during unresolved extension binding could dispatch later, a failed list fetch consumed its discovery generation, duplicate rejection logged a false second ownership acceptance, and the host accepted extra request keys. The final implementation now cancels/releases a scheduled kickoff before disposal and checks liveness before dispatch, applies a generation only after the latest successful list load, emits acceptance only after an atomic kickoff claim, and rejects any own request key outside the exact six-field protocol.

The final focused Pi Web suite passes 32/32 for hosted capability, wrapper, routing, cleanup, SSE, and sidebar behavior. The full Node suite passes 135/135; TypeScript, lint, and diff checks pass. A fresh independent reviewer reproduced the prior causal surfaces, inspected the corrections, reran those gates, and found no blocker or fix-worth-doing-now. Actual browser deletion during indefinitely delayed real SDK binding remains unexercised; the deterministic regression resolves binding after destruction and proves zero prompt dispatch plus exactly-once native disposal.
