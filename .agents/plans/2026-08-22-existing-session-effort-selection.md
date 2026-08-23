# Existing-Session Effort Selection

Status: approved

## Objective

Allow Pi Web to open an existing, message-free Pi session using the valid reasoning-effort level already declared on that session’s active path. This supplies the Pi Web prerequisite for the approved `dot_files` implementation policy: a Start Implementation or Orchestrate Implementation target declared as `xhigh` must be `xhigh` before Pi Web publishes the wrapper or dispatches kickoff.

Success means the saved selection is passed through Pi’s supported SDK initialization option, both hosted kickoff and an ordinary browser open of the same target converge on the same owner and requested effort, and the sibling plan’s supported `xhigh` model is effectively `xhigh` before kickoff. Global/default thinking, new-session behavior, populated-session restoration, model choice, tools, and the hosted capability request remain unchanged.

## Design / Implementation Strategy

Correct the shared existing-file startup path in `startRpcSession()` rather than add an implementation-specific branch or extend the hosted request. After opening the target with `SessionManager`, inspect its active branch before SDK construction. Only when an existing session’s native context has no messages and its active branch contains a `thinking_level_change`, validate the context’s final value against `off | minimal | low | medium | high | xhigh | max` and pass it as `thinkingLevel` to `createAgentSessionFromServices()`.

Use `SessionManager.getBranch()` to distinguish an absent declaration from explicit `off`, and `buildSessionContext()` to retain Pi’s last-declaration-wins active-path semantics. If the final declaration is malformed, omit the override rather than revive an older declaration or pass untyped data into the SDK. Keep populated existing sessions on Pi’s current native restoration path and newly created Pi Web sessions on their current selection/default flow.

Keep the target session state authoritative. Do not infer effort from the caller, process environment, global settings, model defaults, session name, or implementation metadata. Do not call `setThinkingLevel()`, which would rewrite the global default in the pinned fork, and do not add a Pi-Web-owned session entry. The SDK currently appends its own initial model/thinking entries when constructing any message-free session; preserve that existing behavior rather than adding a duplicate or attempting a Pi-core workaround.

Because every initiator uses `startRpcSession()` and same-ID startup is already serialized by `getOrCreateRpcSession()`, the correction covers both orderings of the hosted/browser race without duplicating policy in `startHostedImplementationTarget()`. Leave model-specific support and clamping to the SDK.

Rough scope estimate:

- **Surfaces:** `lib/rpc-manager.ts`, focused RPC/hosted tests, and the maintained hosted-startup note in `AGENTS.md`; no Pi core, protocol, API route, or UI edit is expected.
- **Testability:** High. Native target fixtures and the pinned fork’s faux-provider machinery can prove pre-publication state without a real provider request.
- **Implementation difficulty:** Small-to-medium. The production correction is narrow; the meaningful work is deterministic active-branch, invalid-value, and ownership-race coverage.

## Reference Files

- [`../../lib/rpc-manager.ts`](../../lib/rpc-manager.ts)
- [`../../lib/rpc-manager.test.mjs`](../../lib/rpc-manager.test.mjs)
- [`../../lib/pi-types.ts`](../../lib/pi-types.ts)
- [`../../lib/hosted-implementation-session.ts`](../../lib/hosted-implementation-session.ts)
- [`../../AGENTS.md`](../../AGENTS.md)
- [`../../package.json`](../../package.json)
- [`../../package-lock.json`](../../package-lock.json)
- [`../../../dot_files/.agents/plans/2026-08-21-pi-implementation-xhigh.md`](../../../dot_files/.agents/plans/2026-08-21-pi-implementation-xhigh.md)

## Constraints / Current Evidence

- Pi Web already exposes ordinary reasoning-level selection, including `xhigh` and `max`. The missing case is an existing target that declares effort before it has any context messages.
- The pinned SDK restores a native thinking declaration only when `buildSessionContext().messages.length > 0`. A bounded local probe with global `max` and a message-free saved `xhigh` target produced effective `max` without the factory option and effective `xhigh` with it.
- Native context defaults to `off`, so declaration presence must be checked on the active branch to preserve explicit `off`. The session entry type permits an arbitrary string, so runtime validation is required.
- The hosted request is intentionally limited to target identity, cwd, kickoff, kind, and optional cancellation. Effort remains native target-session state, not new transport metadata.
- `getOrCreateRpcSession()` publishes only one same-ID wrapper and returns an existing live owner to later callers. The selected effort therefore must be applied during shared preparation, before publication.
- Existing-file identity validation, side-session classification, tool setup, extension binding, publication timing, and strict shutdown ownership must remain intact.
- **Confirmed scope:** implement only the predeclared-target startup adapter required by the sibling plan. Do not add or change a visible Pi Web selector; ordinary Pi Web sessions already expose reasoning selection.
- The sibling `dot_files` plan is approved but blocked until this repo-local prerequisite is separately approved, implemented, validated, and integrated.

## Test Strategy

- Add a focused resolver matrix for active-path last-value selection, an abandoned-branch value, explicit `off`, absence, and malformed final values.
- Use a deterministic `xhigh`-capable model fixture or equivalent pinned-fork seam to assert that the prepared and published owner is effectively `xhigh` before any prompt or provider request. Do not widen the production API solely for test injection.
- Exercise hosted-first and browser-existing-owner orderings, proving one owner, one kickoff, and the same saved selection in both cases.
- Compare global settings before/after and distinguish Pi Web mutations from the SDK’s existing message-free initialization entries.
- Preserve populated-session restoration and new-session startup through focused regressions. Visual UI validation is not applicable because no UI changes are in scope.
- Run the focused RPC/hosted tests, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`; do not run `next build`.

## Telemetry / Debuggability

No new production telemetry is planned. The selected level is already exposed through existing session/runtime state. Focused tests should inspect that state before kickoff and must not log prompts, provider payloads, credentials, or full session contents.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | A valid final active-path effort declaration on an existing message-free session is supplied as the SDK’s initial request; on an `xhigh`-capable model, runtime state is effectively `xhigh` before wrapper publication and prompt dispatch. | Start a seeded native target with a deterministic supported model and inspect prepared/published runtime state before prompting. | Block completion; correct native-state extraction, validation, or SDK option propagation. |
| VC-002 | Active-path semantics are exact: explicit `off` is preserved, an abandoned branch is ignored, and an absent or malformed final declaration supplies no override. | Run the resolver/fixture matrix and compare the selected initialization option with Pi’s native branch/context result. | Block completion; fix presence detection, ancestry handling, or validation. |
| VC-003 | Hosted-first and browser-first startup of the same exact target converge on one owner with the declared effort and schedule kickoff exactly once. | Run both existing-owner race orderings with identity, lifecycle, effort, and prompt-count assertions. | Block completion; restore shared-start and ownership guarantees. |
| VC-004 | Invalid/absent declarations, new sessions, and populated existing sessions retain current default/restoration behavior; Pi Web neither writes the global thinking default nor adds its own session entry. | Run focused negative/regression fixtures and compare settings plus expected SDK-owned entry transitions before/after startup. | Block completion; narrow the adapter or remove unintended persistence. |
| VC-005 | The change leaves the hosted request schema, target identity checks, tools, extensions, side-session policy, model choice, publication timing, and shutdown lifecycle unchanged. | Review the scoped diff and run existing RPC/hosted lifecycle regressions, typecheck, lint, and diff checks. | Stop and restore the affected invariant before closeout. |

## Assumptions, Risks, And Blockers

- The installed local fork exposes `thinkingLevel` as a supported `createAgentSessionFromServices()` initialization option and accepts the seven-level domain used by Pi Web.
- Active-path extraction must follow Pi’s own session-context semantics; scanning the whole JSONL for the last physical entry would be incorrect for branched sessions.
- Model-specific effort mapping/clamping remains Pi SDK responsibility. The sibling plan assumes its selected model supports `xhigh`; Pi Web must not recreate provider/model compatibility logic.
- The pinned SDK’s automatic model/thinking append during message-free construction is pre-existing and out of scope. Tests must not misattribute it to the adapter.
- A new or changed visible selector is explicitly out of scope and would require a separate follow-up plan.
- Implementation is blocked until explicit approval. The sibling `dot_files` implementation remains blocked until this companion is integrated into local `main`.

## Implementation Handoff

After approval, run:

```text
/start-implementation .agents/plans/2026-08-22-existing-session-effort-selection.md
```
