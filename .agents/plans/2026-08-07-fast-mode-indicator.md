# Fast Mode Indicator

Status: approved

## Objective

Make the effective OpenAI fast-mode state visible while using Pi Web, so a user can tell before sending a prompt whether supported requests will use OpenAI's `service_tier=priority` path. Success means the indicator follows the extension's authoritative on/off state and the selected model's eligibility, updates after `/fast`, model changes, reloads, and reconnects, and never claims priority when the outgoing request will not receive it.

## Design / Implementation Strategy

Keep the implementation entirely in Pi Web. The installed `@benvargas/pi-openai-fast@1.1.0` extension owns the mutable state and request mutation but exposes no structured state, status key, custom entry, or event that Pi Web can subscribe to. Its only runtime readout is the `/fast status` command, which returns state indirectly by calling `ctx.ui.notify(...)` with prose.

A Pi-Web-only implementation must therefore be an explicit, fail-closed compatibility adapter for this exact extension rather than generic inference:

1. Extend Pi Web's structural `ExtensionRunnerLike` surface only with shipped runner methods needed by the adapter: resolved-command lookup and fresh command-context creation. Find the registered base command named `fast`, then authenticate its provenance with package-origin `sourceInfo` plus the nearest package manifest's exact `@benvargas/pi-openai-fast` name and supported `1.1.0` version. Retain its resolved `invocationName` so duplicate command names such as `fast:2` are handled correctly. Package absent means no badge; identified package with an unsupported/ambiguous contract means `unknown`.
2. Add a wrapper-owned adapter state of `effective | unavailable | off | unknown`, together with the model key, runner/wrapper generation, and at most one in-flight refresh. `refresh()` re-resolves the authenticated command against the current runner, invokes only its `status` handler with a fresh `createCommandContext()`, and proxies that context's UI so exactly one bounded `notify` result is captured without an extra browser toast. Parse only the four known `1.1.0` status shapes, require any reported model to equal the fresh context model, ignore rather than transport the trailing supported-model list, and classify missing, multiple, oversized, mismatched, or stale output as `unknown`. Do not infer inactive state from the absence of an ambient startup notification and do not parse notifications from the shared extension UI channel, which has no provenance.
3. Use callback completion points, not a watcher or timer. Refresh after `ensureExtensionsBound()` completes bound `session_start`; after successful `send("set_model")`; after `send("reload")` finishes with the replacement runner rebound; and after `beginPrompt()` settles only when pre-dispatch resolution identified this package's actual invocation name. Mark the package state `unknown` while an accepted canonical Fast command or runner replacement can invalidate the old answer. The existing native-event callback schedules a refresh after settlement only when the current model key differs from the last-probed key; `get_state` awaits the same model-drift convergence before replying.
4. Coalesce triggers within one wrapper generation and discard completion from stale runners, replaced wrappers, destroyed sessions, or superseded model keys. Browser reconnect and ordinary HTTP reconciliation replay the wrapper-owned result; they do not trigger a probe unless `get_state` detects model drift. Ordinary non-Fast prompts never probe when model and runner identity are unchanged. Probe errors publish `unknown` once and are retried only at the next approved transition.
5. Reuse the existing bounded status transport with one documented Pi-Web-reserved host key whose value is only the strict state enum. Merge that host entry into `get_state`, project its set/clear through the existing status frames, and remove it before rendering ordinary extension statuses. This is explicitly Pi Web-owned transport metadata, not a claim that the extension called `setStatus`; no session JSONL entry is written. The hook derives the strict enum and passes it separately to `ChatInput`.
6. Render a flex-shrink-zero, non-interactive text badge inside the model-selector button after the truncating model name. Show `Fast`, `Fast unavailable`, `Fast off`, or `Fast unknown`; use text as well as styling so state does not depend on color. The button's accessible name/title explains whether the OpenAI priority service tier will be requested for the selected model. If model choices exist but none is selected, retain the model-selector anchor with a `Select model` label and show `Fast unavailable` when the extension reports on; if no model selector can exist, omit the unanchored badge rather than moving it elsewhere.
7. Preserve the extension's existing `service_tier=priority` mutation, config precedence, and startup/toggle behavior. Pi Web does not import or modify the installed package, read/write its config itself, inspect provider payloads, or own the Fast toggle. Calling the authenticated status handler retains only that handler's existing config-refresh effects.

`persistState: false` keeps valid live state only in the extension closure, and persisted writes can fail, so JSON config is not an authoritative substitute for the guarded runtime query.

**Rough scope estimate**

- **Surfaces:** `lib/pi-types.ts`, the RPC wrapper and its existing status projection, hook state derivation, `ChatWindow` filtering/prop wiring, `ChatInput` responsive rendering, and focused tests. No protocol-version, upstream, installed-package, config, or provider-request changes.
- **Testability:** medium-high with a fixture runner/command that reproduces the authenticated package metadata and pinned status outputs, including startup, toggle, model change, reload, mismatch, and failure cases; no live provider call is required.
- **Implementation difficulty:** medium because the adapter intentionally depends on a third-party command contract and must fail closed across reload, wrapper replacement, and concurrent prompts.

## Reference Files

- [Pi Web repository guidance](../../AGENTS.md)
- [Pi Web extension host and status projection](../../lib/rpc-manager.ts)
- [Pi SDK structural host types](../../lib/pi-types.ts)
- [Projected session status protocol](../../lib/session-protocol.ts)
- [Browser projection adapter](../../lib/session-view-projection.ts)
- [Session hook reconciliation](../../hooks/useAgentSession.ts)
- [Current extension status rendering](../../components/ChatWindow.tsx)
- [Composer controls](../../components/ChatInput.tsx)
- [Extension host regression tests](../../lib/rpc-manager.test.mjs)
- [Projected protocol tests](../../lib/session-protocol.test.mjs)
- [Chat input tests](../../components/ChatInput.test.mjs)

External advisory evidence:

- Installed package source: `~/.pi/agent/npm/node_modules/@benvargas/pi-openai-fast/extensions/index.ts`
- Installed package README: `~/.pi/agent/npm/node_modules/@benvargas/pi-openai-fast/README.md`
- Pi extension documentation: `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

## Constraints and Current Evidence

- The installed extension documents that fast mode "only adds `service_tier=priority` to provider requests when fast mode is active and the current model matches the configured supported-model list." Its current upstream `main` source and version (`1.1.0`) match the installed implementation and likewise publish no persistent status.
- OpenAI renamed Priority processing to Fast mode on 2026-07-30 and documents both `service_tier: "priority"` and `service_tier: "fast"` as accepted request values. The extension deliberately still sends the valid `priority` value. `Fast` is therefore the current user-facing name, not a separate mode layered above Priority processing.
- The extension has separate configured and effective states: it can be on while the selected model is unsupported, in which case it leaves requests unchanged.
- Startup state comes from project-over-global config, not session history. The extension keeps mutable state in its closure and may skip persistence, so reading JSON from Pi Web would not be authoritative.
- The extension currently reports state only through transient notifications on active startup, toggle, and `/fast status`; it does not call `ctx.ui.setStatus`, append session state, expose its closure state, or listen for `model_select`. Inactive startup deliberately emits no notification.
- Pi's `ExtensionRunner` publicly exposes `getCommand()` and `createCommandContext()` in its shipped type declarations, so Pi Web can technically invoke the identified command's `status` handler with a proxied UI context. This is not a documented cross-extension state API and remains a version-specific compatibility seam.
- Pi's supported extension API defines `ctx.ui.setStatus(key, text)` for persistent status indicators in both TUI and RPC modes.
- Pi Web already stores extension statuses in `AgentSessionWrapper`, includes them in `get_state`, projects set/clear frames over the session WebSocket, reconciles them over HTTP, and renders them generically in `ChatWindow`.
- Current Pi Web rendering places statuses before transcript messages, not beside the model/thinking/tool controls. That location can scroll out of view in a long session.
- Confine package-name/version checks and bounded status-output parsing to the server adapter. Do not parse ambient shared-UI notifications, inspect provider payloads, or expose package/config paths, notification tails, or config content in browser-visible state or diagnostics.
- Preserve unrelated modified and untracked work. Do not run `next build` during development.

## User Decisions

- **User constraint:** implementation must stay entirely in Pi Web; the upstream package and installed package may not be changed.
- **User decision:** the indicator represents effective Fast for the selected model—the next eligible request should receive `service_tier=priority`—not merely the extension's configured toggle. It must distinguish effective, on-but-unavailable, off, and unknown without claiming request success before one occurs.
- **User decision:** use transition-driven, coalesced wrapper callbacks only—after binding, canonical `/fast` settlement, model change, and reload, with model-drift convergence checks. Do not add interval polling, filesystem watching, reconnect-only probing, or ordinary per-prompt probing.
- **User decision:** render the compact, non-interactive Fast indicator inside the always-visible model-selector button, after the truncating model name. Do not relocate generic extension statuses or add a separate composer/header badge.
- **User decision:** whenever the Fast package identity is detected, keep a four-state badge visible: `Fast` (effective), `Fast unavailable` (enabled but unsupported/no selected model), `Fast off` (inactive), and `Fast unknown` (unsupported contract, probe failure/stale, or unrecognized state). Render no badge when the package is absent. Accessible explanatory text names the `OpenAI priority service tier` and the selected model without exposing the extension's supported-model list.

## Implementation Sections

### 1. Authenticated server adapter

In `lib/pi-types.ts` and `lib/rpc-manager.ts`, add only the structural runner/command types and bounded provenance/status helpers required above. Keep manifest discovery anchored to `sourceInfo.path`, bounded in ancestor depth and bytes, and return only package name/version classification—never paths or manifest content. Keep adapter state separate from the extension-status map even though it uses the reserved status transport key.

### 2. Lifecycle and transport convergence

Wire invalidation/refresh into extension binding, canonical command settlement, successful model selection, reload, native settlement model-drift detection, and `get_state`. Give each refresh an immutable wrapper/runner/model generation snapshot, merge same-generation work, and publish only ordering-current completion. Merge the host entry last for HTTP/projection authority; reserve the exact key in the extension UI adapter so an extension collision remains an ordinary escaped generic status rather than overwriting host state.

### 3. Browser derivation and model-selector badge

In `hooks/useAgentSession.ts` and `components/ChatWindow.tsx`, split the strict reserved enum from ordinary extension statuses for HTTP seeds, projected snapshots, reconnects, and session changes. Pass a typed nullable state to `ChatInput`; do not let unknown or malformed reserved values become `Fast`. In `ChatInput`, preserve model-name truncation and mobile control width, keep the badge visible while the model button is disabled during streaming, and provide state-specific accessible text without making the badge a nested control.

### 4. Regression coverage and durable documentation

Add the fixture and transition/transport/component coverage in the Test Strategy, then document the package-specific compatibility boundary, callback cadence, reserved host key, and fail-closed version behavior in `AGENTS.md` if the final code follows this design. Preserve unrelated work and complete the required commands without running a production build.

## Test Strategy

Add a Pi Web fixture runner/command seam that reproduces package `sourceInfo`, manifest name/version, resolved duplicate command names, and pinned status outputs without modifying or importing the installed package. Cover package absence, exact and unsupported versions, active/inactive startup, `/fast` toggle and explicit commands, supported/unsupported/no-model results, model drift, reload, wrapper replacement, stale context, missing/multiple/oversized/mismatched output, concurrent trigger coalescing, and probe failure. Assert ordinary prompts, reconnect, and unchanged `get_state` do not probe.

Extend wrapper/status-transport, hook, `ChatWindow`, and `ChatInput` coverage for initial HTTP state, projected set/change/clear, generic-status filtering, reconnect snapshot, session switching, and strict unknown fallback. Exercise desktop and mobile widths, long model names, streaming-disabled model controls, all four visible labels, package absence, and accessible names that include the selected model and priority-tier meaning. Prove the Pi Web adapter itself performs no config or provider access, displays no probe toast, writes no transcript/session entry, and does not alter prompt dispatch.

Required validation commands:

```bash
node --test lib/rpc-manager.test.mjs lib/session-protocol.test.mjs lib/session-view-projection.test.mjs components/SessionAgentTransport.test.mjs components/ChatInput.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build`.

## Telemetry / Debuggability

Use the visible Pi Web indicator plus bounded adapter outcome classification (`recognized`, `unknown_contract`, or `probe_failed`) as the diagnostic signals. The reserved transported value is only `effective | unavailable | off | unknown`; diagnostics may expose only package name/version and outcome class. Neither may include source/config paths, captured notification text or tails, request bodies, credentials, provider headers, session content, or model lists. Avoid routine success logs and reconnect noise; emit only outcome-class transitions if implementation evidence proves an additional server diagnostic necessary.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | The displayed state comes from the authenticated package command's live `status` result and fails closed when provenance or output is unknown. | Test package absence, manifest/source mismatch, duplicate invocation names, all recognized outputs, bounded capture, and stale-generation rejection. | Show `unknown` for an identified package or no badge for absence; never fall back to config/model guesses. |
| VC-002 | `Fast` is shown as effective only when the command reports active for the same freshly observed provider/model; on-but-unsupported and no-model results are `Fast unavailable`. | Exercise the exact pinned status shapes across on/off and supported/unsupported/no-model fixtures, including reported-model mismatch. | Block release on any false-positive priority claim. |
| VC-003 | Binding, the authenticated `/fast` invocation, model changes/drift, reload, and wrapper replacement converge without stale indicators or polling. | Callback/coalescing tests plus HTTP/projected/reconnect tests; assert ordinary prompts and reconnect do not invoke `status`. | Fix the missing transition; do not add a timer or broad per-prompt probe. |
| VC-004 | The reserved host entry never appears in the ordinary extension-status area, while unrelated statuses remain unchanged with zero, one, or multiple extensions. | Wrapper, hook, and component tests for reserved-key set/change/clear/filtering and generic statuses. | Fix separation/collision handling without relocating generic statuses. |
| VC-005 | Status display and diagnostics reveal no secrets or provider/session payload content. | Static review and fixture assertions over rendered/logged strings. | Remove sensitive or unbounded fields before release. |
| VC-006 | Existing request mutation, model selection, thinking, tools, prompts, and unrelated extension UI behavior do not change. | Adapter fixture tests, relevant Pi Web tests, typecheck, lint, and scoped diff review. | Revert coupling and narrow the implementation to observational probing/presentation. |
| VC-007 | User-visible wording accurately distinguishes the `Fast` toggle from OpenAI's underlying `priority` service tier. | Accessibility-name/tooltip assertions and manual review. | Change wording before release rather than presenting the two states as independent features. |

## Assumptions, Risks, and Blockers

- **Established naming:** `Fast` is the current user-facing name for the service formerly called Priority processing; `priority` is the request value this extension still sends. Installed/upstream source and current OpenAI documentation agree that the mapping is valid.
- **Risk:** showing only `on/off` hides the important unsupported-model state and can falsely imply a priority request if wording is not precise.
- **Risk:** parsing third-party notification prose and invoking its command handler are compatibility dependencies. Exact provenance/version guards and an `unknown` fallback are mandatory.
- **Risk:** automatically running a status handler executes trusted third-party command code outside a user-entered command. The probe must be bounded to the exact known package, avoid concurrent duplicate execution, capture UI locally, and never retry after ambiguity.
- **Risk:** wrapper-owned runtime state must replay/reconcile correctly after reconnect; a one-time browser-only observation is insufficient.
- **Residual limitation:** this adapter intentionally supports only the authenticated `1.1.0` contract. A later package version displays `Fast unknown` until Pi Web explicitly reviews and adds that version; it never silently accepts new prose or behavior.
- **Blockers:** None. Scope, truth semantics, callback cadence, placement, and four-state wording are user-resolved; implementation still requires explicit approval of this draft.

## Implementation Handoff

After this exact plan is approved, start implementation with:

```text
/start-implementation .agents/plans/2026-08-07-fast-mode-indicator.md
```
