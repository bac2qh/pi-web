# Preserve Live Session Tip During Transcript Reconciliation

Status: approved

## Objective

Fix the Pi Web regression where a newly sent user message and/or the assistant’s in-progress or completed response can disappear from the selected chat until a page refresh, even though the native session persisted the exchange.

Success means normal prompt execution follows the session’s advancing live tip, completed messages survive the projected-draft-to-HTTP-transcript handoff and recovery paths, and explicit historical branch navigation remains pinned to the selected leaf. A stale root transcript, stale selected-leaf context, reconnect snapshot, or settlement repair must not overwrite the current exchange with an older branch. Refresh must no longer be required to reveal persisted work.

## Design / Implementation Strategy

Keep the correction at the browser hook and HTTP-reconciliation seam. The user explicitly chose this bounded client fix: server, WebSocket, route, and persistence changes are excluded unless a failing implementation regression proves the existing interfaces cannot express correct live-tip behavior, in which case implementation must stop for separate review rather than expand this plan.

1. Keep `activeLeafId` as the leaf currently displayed/highlighted by the branch UI. Add a separate synchronous pinned-leaf intent (a dedicated ref or equivalently explicit local mode): `null` means follow the live tip; a concrete entry ID means the user deliberately selected historical context. Do not solve the race by setting React state to `null` and hoping it commits before an HTTP request.
2. Make `SessionHttpObservation.selectedLeafId` represent only that pinned intent, not every non-null displayed live tip. Root transcript repair in live mode may adopt the server’s newer leaf and atomically refresh transcript, entry IDs, tree, and the displayed `activeLeafId`. Pinned mode continues to require the exact selected leaf and uses the selected-context route.
3. Explicit navigation synchronously installs the pin and increments the leaf generation before requesting context. Starting a local prompt synchronously clears the pin and increments the generation before optimistic UI mutation or repair scheduling, so sending from a historical branch follows the newly created descendant. Capture that transition and prior pin: a definitive pre-execution prompt failure restores the prior pin only if no later navigation or prompt has changed the generation. Accepted or canonically covered execution remains live unless the user explicitly navigated afterward.
4. Re-evaluate live-versus-pinned intent when a coalesced repair actually runs. A context repair scheduled before a prompt must not later load an ancestor, and a root repair scheduled before explicit navigation must not overwrite the pinned branch. Preserve one bounded in-flight request/timer per transcript authority and reject every superseded token.
5. Preserve immediate projected `message_completed` delivery. When a reconnect, hidden/reveal transition, or recovery snapshot cannot replay that transient effect, the refresh marker must converge through the current live-tip transcript rather than an older leaf context. Do not add an effect journal or duplicate transcript store.
6. Preserve new-session promotion, settlement polling, visibility/online repair, fork/clone/navigation semantics, manual compaction, metadata/resource commands, and the accepted WebSocket/HTTP authority split. These other commands do not enter a new live-tip mode in this plan. Do not change the V1 WebSocket protocol, event hub, session routes, persistence format, or server ownership.

### Scope estimate

- **Expected production surfaces:** primarily `hooks/useAgentSession.ts`. Change `lib/session-http-reconciliation.ts` only if a narrow typed field or decision is needed to keep pinned intent explicit; changing `components/AppShell.tsx` is a stop-and-justify exception rather than expected work.
- **Expected tests:** `lib/session-http-reconciliation.test.mjs` and `components/SessionAgentTransport.test.mjs`, with only narrowly necessary related hook/branch assertions.
- **Normally unchanged:** projected protocol/reducer/event hub, session WebSocket channel/client/registry/view transport, HTTP route semantics, session persistence/reader, sidebar, deletion/Hide policy, package manifests, and Pi SDK.
- **Testability:** high with deferred HTTP responses and mounted React snapshots/effects; one bounded browser smoke can verify the visible symptom.
- **Implementation difficulty:** medium. The edit should be small, but ordering across optimistic state, leaf generation, transient completion effects, recovery snapshots, and explicit branch navigation is race-sensitive.

## Reference Files

- [Repository instructions](../../AGENTS.md)
- [Project memory index](../memory/MEMORY.md)
- [Accepted S4B hook migration plan](./2026-08-02-s4b-hook-migration-hidden-streams.md)
- [S4B browser evidence](../reports/2026-08-02-s4b-browser-session-migration.md)
- [Session hook](../../hooks/useAgentSession.ts)
- [HTTP reconciliation coordinator](../../lib/session-http-reconciliation.ts)
- [Projected view adapter](../../lib/session-view-projection.ts)
- [Projected reducer](../../lib/session-reducer.ts)
- [Session root route](../../app/api/sessions/%5Bid%5D/route.ts)
- [Selected-leaf context route](../../app/api/sessions/%5Bid%5D/context/route.ts)
- [Mounted session transport tests](../../components/SessionAgentTransport.test.mjs)
- [HTTP reconciliation tests](../../lib/session-http-reconciliation.test.mjs)

## Evidence and Constraints

- `handleSend()` advances the optimistic prompt/UI generation but does not advance or release the current `activeLeafId`.
- Root transcript repair rejects a response when its latest `leafId` differs from the token’s non-null selected leaf, then schedules selected-leaf context repair. That context route intentionally reconstructs history ending at the requested leaf and can therefore replace the current exchange with an ancestor branch.
- Before the WebSocket hook migration, root transcript refresh unconditionally adopted the session’s returned latest leaf. The migration added necessary stale-leaf protection but used `activeLeafId` for both an ordinary live tip and intentional historical selection. The fix should restore live advancement without reverting to the old behavior that could overwrite explicit branch navigation.
- Timing accounts for both observed variants: a pre-prompt pinned leaf removes the user and assistant descendants; a leaf captured at the new user entry retains the user while removing later assistant/tool descendants. Refresh reloads the native current leaf and restores persisted work.
- `message_completed` clears the canonical draft and delivers the finalized message as a sequence-addressed transient effect. Initial/overflow recovery does not journal such effects by design, so correct HTTP convergence is mandatory.
- The current focused reconciliation/mounted suites pass `39/39` under `NODE_ENV=test`, demonstrating a coverage gap rather than an already-failing regression. Their prompt fixture keeps the returned leaf unchanged or null and never exercises a normal prompt advancing a non-null tip.
- **User scope decision (2026-08-05):** implement the small targeted browser fix and leave the server and WebSocket protocol unchanged. If that boundary proves insufficient, stop and plan any broader work separately.
- Preserve unrelated working-tree changes and the retained worktrees. Do not run `next build` during implementation validation.

## Test Strategy

Add deterministic regressions that fail on the current code and cover:

- existing-session prompt from a non-null prior tip: a newer root leaf must replace the prior tip without losing either the optimistic/canonical user message or assistant/tool descendants;
- new-session/raced prompt where the known leaf is the user entry: later assistant/tool entries must remain after settlement repair;
- projected completion delivered live, and recovery/snapshot settlement where the completion effect is unavailable and HTTP must restore it;
- delayed pre-prompt root and context responses, delayed post-prompt responses, and cursor/prompt/leaf generation changes; none may overwrite a newer live exchange;
- explicit historical navigation remains pinned despite background root refresh, while sending from that branch follows the newly created descendant;
- a context repair queued before that send is cancelled or re-routed at execution and cannot restore the ancestor; conversely, a root repair queued before later navigation cannot overwrite the pin;
- definitive prompt failure restores the pre-prompt view/optimistic state only when its transition is still current; a later navigation wins, while canonically covered ambiguous failure does not undo the executed prompt;
- reconnect, visibility/online repair, hidden/reveal, and final quiescent equality remain bounded and do not loop;
- fork, clone, and in-session navigation retain their existing connection and leaf semantics through focused existing suites.

Use `NODE_ENV=test` for mounted React tests because the production React export intentionally omits `act`.

For the user-visible gate, run one sanitized Chromium-family smoke against an isolated development server and disposable session: establish a completed baseline turn with a non-null tip, send a second prompt, and verify both the new user message and final assistant response remain visible through settlement and equal the persisted transcript. Exercise one forced session-socket recovery before settlement if the bounded harness supports it; otherwise the deterministic effect-less recovery test remains authoritative and the browser limitation must be reported. Record only finite counts/outcomes—no prompts, responses, IDs, paths, tickets, credentials, or provider payloads. Cross-browser and scale reruns are not required for this browser-local state correction.

## Telemetry / Debuggability

No new runtime logging or telemetry sink is planned. The pure reconciliation token/decision seam already exposes finite outcomes such as `accepted` and `stale_leaf`; extend its typed, test-visible state only as needed to distinguish live-tip advancement from pinned-leaf protection. Regression assertions over mode, resource, and decision classes provide bounded diagnosis without recording session IDs, raw leaves/cursors, prompts, messages, paths, provider/tool data, tickets, errors, or response bodies. No persistent telemetry product or user-facing debug UI is in scope.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | A normal prompt may advance the live leaf without an ancestor transcript/context replacing the current exchange. | Mounted hook tests with deferred root/context responses for prior-tip and user-tip timing variants. | Block; do not weaken stale-response guards globally. |
| VC-002 | Explicit historical navigation remains pinned, and a prompt sent from that branch follows only its newly created descendant. | Mounted navigation/send tests plus coordinator leaf-generation tests. | Block; preserve branch semantics before proceeding. |
| VC-003 | Live completion effects and effect-less recovery snapshots both converge to the same persisted final transcript without a visible durable disappearance. | Projected snapshot/effect tests, recovery HTTP tests, and a bounded real-browser smoke. | Block; determine whether the missing authority is hook-local before considering a broader interface. |
| VC-004 | Prompt failure, new-session promotion, hidden/reveal, polling, visibility/online, fork, clone, and navigation behavior remain compatible. | Existing focused component/reconciliation/view suites plus added race cases. | Block or explicitly isolate an unrelated pre-existing failure. |
| VC-005 | Repair remains bounded and privacy-safe; no effect journal, duplicate transcript store, new wire command, or sensitive diagnostic is introduced. | Source review, diagnostic sink/static scans, and retry/coalescing tests. | Stop for scope review rather than expanding silently. |
| VC-006 | TypeScript, lint, focused tests, full Node suite, and whitespace checks pass without a development build. | `node_modules/.bin/tsc --noEmit`; `npm run lint`; focused Node tests; `NODE_ENV=test node --test lib/*.test.mjs components/*.test.mjs`; `git diff --check`. | Block implementation completion; do not run `next build`. |

## Assumptions, Risks, and Blockers

- The persisted native session is authoritative and already contains the missing exchange; evidence currently points to browser state replacement rather than persistence loss.
- `activeLeafId` currently conflates live-tip knowledge with intentional historical selection. Fixing only one rejection condition without explicit mode/state risks corrupting branch navigation.
- React state setters are asynchronous, so invalidating old leaf/context observations must have a synchronous ref/generation representation; state-only ordering is insufficient.
- Recovery may legitimately omit transient completion effects. The fix must use existing transcript refresh authority, not attempt to replay every effect.
- Prompt attachment can overlap later navigation. Rollback must be generation-conditional so an attachment/POST failure cannot restore a pin that the user has since replaced.
- A real-browser reproduction can be timing-sensitive. Deterministic mounted tests are the primary proof; browser evidence validates the user-visible handoff without exposing private content.
- Any demonstrated need to change the WebSocket protocol, server event hub, HTTP route contract, or session persistence materially increases scope and requires returning this plan to explicit review before inclusion.

## Implementation Handoff

After this plan is approved, implementation starts only with:

```text
/start-implementation .agents/plans/2026-08-05-live-tip-transcript-reconciliation.md
```
