# Factory-Based Extension Widgets

Status: approved

## Objective

Restore Pi Web rendering for extension widgets whose `setWidget()` content is a component factory, so the existing pi-subagents `subagent-async` and `subagent-fleet-status` widgets appear and refresh in the browser without changing pi-subagents or the projected widget wire shape.

Success means:

- existing `string[]` widgets continue to work;
- synchronous factory widgets render server-side through the plain-text theme and a small fixed-dimension headless TUI façade, then travel as the existing `{ key, lines, placement }` state;
- replacement, refresh, clear, reload, failure, and wrapper destruction have deterministic ownership and exactly-once component disposal;
- stale or cleanup-time callbacks cannot republish a widget;
- `aboveEditor` and `belowEditor` widgets appear immediately above and below the chat editor in both empty and established chats; and
- `/subagents-fleet` remains the interactive runtime inspector, while persistent widget keyboard input remains explicitly unsupported.

## Design / Implementation Strategy

### Scope estimate

- **Surfaces:** focused changes to the server-side extension UI adapter and its structural types, one small reusable headless-render façade, widget presentation/composer placement, targeted tests, and a short maintained developer-note update. The projected session protocol remains unchanged.
- **Testability:** high for factory rendering, projection, generations, cleanup, and static widget rendering; browser placement also needs a focused render-order seam or equivalent DOM test plus a manual responsive smoke pass.
- **Implementation difficulty:** medium. Rendering is small; the main risk is preserving the current wrapper's generation, reload, projected-state, and destruction authority under synchronous reentrancy.

### 1. Add the minimum render-only factory contract

Keep extension binding in RPC mode. Do not advertise Pi Web as a full terminal UI.

Refine the local structural types so `setWidget()` accepts either the existing `string[]`, a synchronous `(tui, theme) => component` factory, or `undefined`. The supported component has `render(width): string[]` and optional `dispose(): void`.

Adapt only the relevant behavior from upstream commits:

- `9e4ca655493e29a98922faed978b585596472a3b` for editor-adjacent placement and the browser truncation component;
- `a6ba057466d5bb8123a6e717eb567a04d4974833` for factory ownership, rendering, refresh, disposal, and reentrancy tests; and
- prerequisite/helper commit `17945f9` for a frozen headless TUI with 92 columns, 40 rows, `kittyProtocolActive: false`, and `requestRender(force?)`.

These commits are evidence, not merge targets. They predate or diverge from the current wrapper and projected-session lifecycle, and `17945f9` includes unrelated changes that are not part of this plan.

The headless object is a fixed-dimension render façade, not an execution or resource sandbox. Factory invocation and `render()` remain trusted synchronous extension code. Do not add focus, terminal input, overlays, editor ownership, or other TUI methods. Reuse the existing plain-text theme. Reusing the façade for existing custom panels is allowed only if their current width, input, completion, and disposal behavior remains unchanged under tests; otherwise use it only for factory widgets.

### 2. Make per-key component ownership authoritative

Add one wrapper-owned active-component registry and a monotonic generation per widget key. Route array set, factory set, and clear through the same per-key authority operation so array-to-factory, factory-to-array, and factory-to-clear transitions all dispose the old component correctly. Centralize publication so successful array updates and successful factory renders update the legacy event, `get_state.extensionWidgets`, and `projectedHub` through the existing `string[]` widget event together.

For each operation:

1. Make the new per-key operation authoritative before disposing the previous component.
2. Dispose the replaced or cleared component exactly once; a throwing disposer counts as disposed, is reported safely, and never cancels the newer operation.
3. If disposal reentrantly calls `setWidget()` for the same key during an ordinary set, replacement, or clear, that nested call becomes the newest generation and wins; the interrupted outer operation must stop without publishing stale state.
4. For a factory, invoke it with the fixed headless façade and plain-text theme, validate the returned render-capable component, render it at 92 columns, validate a string-array result, then publish it only if the generation and wrapper runtime are still current.
5. A retained `requestRender()` rerenders and republishes only its own still-current component. Callbacks retained from replaced, cleared, failed, reloaded, or destroyed generations are no-ops. Never enter `render()` recursively: a `requestRender()` made by the component during its own render is ignored because that render already produces the current output.
6. A failure in factory creation, component validation, initial rendering, refresh rendering, error formatting, or cleanup must not escape into extension binding or session control. Clear only the failing current generation, dispose any produced component once, and emit a bounded sanitized `extension_error` for the failure phase.

Normal set, replacement, and clear are last-call-wins. Reload and destruction are different: enter a cleanup guard, invalidate component generations, publish the required widget clears while the projected hub is still authoritative, dispose owned components, clear local registries, and suppress any cleanup-time attempt to register or rerender a widget. Preserve the current shutdown ordering and never reopen admission. Apply the same behavior to both the RPC `reload` command and command-context `ctx.reload()`.

At every externally observable boundary, active component ownership, `get_state.extensionWidgets`, and `projectedHub` widget state must agree. Keep the existing projected protocol and reducer shape; do not add a factory or component to browser state.

### 3. Keep failure signals useful and bounded

Use existing `extension_error` projection for user-visible failure notices. Add a small safe formatter with fixed failure phases and a strict UTF-8 limit (maximum 4 KiB, including any bounded/sanitized widget key and error class). Never include rendered widget lines, raw component objects, stack traces, prompts, session content, provider payloads, or unchecked raw thrown values. Disposal/error-reporting failures are isolated and cannot trigger repeated publication loops.

No general widget payload/protocol redesign is included. Rendered output remains subject to the projected hub's existing frame/snapshot limits; factory widgets are trusted in-process extensions, so this work does not claim CPU or memory isolation.

### 4. Put widgets next to the editor

Extract the widget presentation from `ChatWindow.tsx` into a focused component and use it in both chat branches. Preserve the current widget key header, plain-text rendering, responsive width, and string-array input.

The required visual order is:

```text
aboveEditor widgets
chat editor
belowEditor widgets
```

Do not leave `aboveEditor` in the scrollable transcript, do not put `belowEditor` above the editor, and render both placements in the empty/new-session layout. Keep extension status chips and unrelated transcript/composer behavior outside this placement change. Use the smallest pure composition seam needed to test both branch orders without restructuring the rest of `ChatWindow`.

Apply the user-selected Pi Web display policy to both array and factory widgets: show at most ten logical content lines and append `... (widget truncated)` when more content exists. Keep the complete authoritative `lines` value in server and projected state; truncate only in the browser presentation component. Narrow-screen wrapping may produce more than ten visible rows.

### 5. Preserve pi-subagents boundaries

Validate the two real update patterns rather than describing them as one mechanism:

- `subagent-async` refreshes primarily by replacing its factory through repeated `setWidget()` calls; completed rows remain for the extension's default approximately ten-second retention window and then clear.
- `subagent-fleet-status` keeps one component and requests in-place rerenders through its captured `tui.requestRender()` while work is active.

Do not modify `/Users/xin/Documents/repos/pi-subagents`, redesign `/subagents`, or change `/subagents-fleet`. The persistent fleet widget's terminal navigation hint may render but is not interactive in Pi Web because `onTerminalInput()` remains unsupported; record this as a known limitation rather than claiming FleetView interaction parity. `/subagents-fleet` custom-panel input must continue to work. Add a concise current-state note to `AGENTS.md` documenting server-side factory rendering, the unchanged `string[]` projection, the fixed render-only façade, and the persistent-input limitation.

## Reference Files

- [Repository architecture and development constraints](../../AGENTS.md)
- [Current extension adapter, projected wrapper lifecycle, reload, and destruction](../../lib/rpc-manager.ts)
- [Local SDK-facing extension UI structural types](../../lib/pi-types.ts)
- [Projected widget event conversion](../../lib/session-projector.ts)
- [Projected widget protocol and bounded state transfer](../../lib/session-protocol.ts)
- [Projected session hub authority](../../lib/session-event-hub.ts)
- [Current widget presentation and chat placement](../../components/ChatWindow.tsx)
- [Current wrapper and projected-lifecycle tests](../../lib/rpc-manager.test.mjs)
- [Browser projected-session transport tests](../../components/SessionAgentTransport.test.mjs)

## Constraints and Current Evidence

- Current `lib/pi-types.ts` already admits an opaque factory type, but `lib/rpc-manager.ts` silently returns for every non-array value; the runtime adapter is the root cause.
- The projected protocol already carries widget set/clear state as `string[]`; no protocol expansion is needed.
- Current established-chat placement puts `aboveEditor` at the top of the transcript and `belowEditor` before the editor; the empty/new-session branch renders neither.
- Both target pi-subagents status surfaces use factories. Persistent-widget terminal input is separate from `/subagents-fleet` custom-panel input.
- Preserve unrelated `.agents/plans/` changes and all other user work.
- Do not run `next build`; repository instructions prohibit it during development.

## User Decisions

- **Browser line cap:** cap both array and factory-rendered widgets at ten logical content lines plus `... (widget truncated)`. This follows upstream Pi Web and is an intentional browser display policy, not exact Pi factory parity. The server and projected state retain the complete lines.

## Test Strategy

Add focused tests rather than relying on the package's unrelated default test command:

1. **Headless façade:** frozen dimensions, kitty flag, optional `force` forwarding, and no unsupported TUI surface.
2. **Factory lifecycle:** initial render, fixed render width/plain theme, replacement, array/factory transitions, clear, `requestRender`, invalid components/results, factory/render/dispose errors, exactly-once disposal, stale callbacks, ordinary replacement reentrancy, cleanup-time suppression, both reload paths, and destruction.
3. **Projection authority:** after set, refresh, replacement, failure, clear, reload, and destruction, assert the expected legacy event, `get_state.extensionWidgets`, live projected-hub state, and replay/snapshot state rather than testing only one representation.
4. **Presentation:** short output and the selected cap boundary, including exactly ten and eleven logical lines, multiple widgets, both array- and factory-origin lines, and truncation-marker behavior.
5. **Placement:** prove `aboveEditor → editor → belowEditor` with both placements present in empty and established chat composition; include unspecified placement defaulting above.
6. **Regression:** existing string-array widget, protocol, reducer, reconnect/snapshot, custom-panel, extension binding, reload, and shutdown tests remain green.

Expected validation commands are:

```bash
node --test lib/custom-ui-terminal.test.mjs lib/rpc-manager-widgets.test.mjs components/ExtensionWidgets.test.mjs
node --test lib/rpc-manager.test.mjs lib/session-projector.test.mjs lib/session-protocol.test.mjs lib/session-reducer.test.mjs lib/session-event-hub.test.mjs components/SessionAgentTransport.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

If implementation places the focused cases in an existing test file, run that exact file instead and record the substitution. Do not substitute `npm test` unless its script is deliberately updated to include the new suites, and do not run `next build`.

Manual smoke with the real pi-subagents extension must verify active child names, replacement-driven async updates, the approximately ten-second terminal-row retention and eventual clear, fleet `requestRender()` updates, both placements, refresh/reconnect restoration while active, narrow/mobile wrapping and composer scrolling, and continued `/subagents-fleet` open/input/update/close behavior. Persistent-widget arrow/enter interaction is explicitly not an acceptance criterion.

## Telemetry / Debuggability

No new persistent telemetry or high-cardinality logging is needed. Use the existing `extension_error` path for one bounded, phase-specific user notice per failed current operation. If a server diagnostic is needed, log only a fixed widget stage and normalized error class; do not log widget lines, raw keys without sanitization, thrown messages, stacks, prompts, session text, or provider data. Tests must prove failure reporting cannot throw or recursively republish stale state.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Existing array widgets retain their set, replace, clear, placement, state, and projection behavior. | Focused wrapper tests plus current projector, protocol, reducer, hub, and transport suites. | Block; factory support may not regress the existing public path. |
| VC-002 | A valid factory renders with the 92×40 façade/plain theme and both pi-subagents update patterns produce current `string[]` widget state without a protocol change. | Factory fixtures for replacement and `requestRender()`, protocol/schema diff review, and real-extension smoke. | Block; do not add a browser-side factory or claim compatibility from static rendering alone. |
| VC-003 | Component ownership is exactly once and newest-operation-wins under replacement, clear, failure, stale callbacks, reentrancy, both reload paths, and destruction; cleanup cannot republish widgets. | Lifecycle tests instrument factory/render/dispose counts and invoke retained/reentrant callbacks at every transition. | Block on leaks, duplicate disposal, stale publication, or cleanup-time resurrection. |
| VC-004 | Wrapper registry, `get_state.extensionWidgets`, and projected-hub live/replay/snapshot state agree after every widget transition and are cleared authoritatively before reload/destruction closes or replaces ownership. | Direct state assertions and reconnect/snapshot transport tests around set, refresh, replacement, failure, clear, reload, and destroy. | Block; preserve current projected-session authority rather than porting legacy-only code. |
| VC-005 | Factory, validation, render, refresh, formatting, and disposal failures do not escape session control or expose unbounded/private values. | Throwing/proxy-like fixture cases, bounded UTF-8 notice assertions, diagnostic capture, and continued post-failure session operations. | Block on session failure, repeated error loops, raw content leakage, or oversized notices. |
| VC-006 | Empty and established chats render widgets in `aboveEditor → editor → belowEditor` order without changing unrelated transcript/status behavior. | Focused render-order tests and desktop/mobile manual inspection with both placements present. | Block on wrong order, missing empty-state widgets, transcript-scrolling widgets, or composer overlap. |
| VC-007 | Both array and factory widgets display at most ten logical content lines plus the truncation marker, without truncating authoritative server/projected state, and the behavior is described as an intentional Pi Web policy. | Boundary component tests at 10/11 lines, server/projected-state assertions, narrow wrapping smoke, and wording review. | Block if either origin differs, authoritative state is truncated, or the policy is described as exact Pi factory parity. |
| VC-008 | `/subagents-fleet` custom-panel input remains functional while persistent widget input remains unsupported and no pi-subagents files change. | Manual open/input/update/close smoke, custom UI regression tests, and scoped Git diff. | Block on custom-panel regression or cross-repository edits; do not broaden this plan to persistent widget input. |
| VC-009 | The complete touched surface passes focused tests, relevant regression suites, typecheck, lint, and whitespace validation without unrelated changes or a Next build. | Recorded commands, `git diff --check`, scoped status/diff review, and explicit accounting for any blocked manual environment. | Fix failures; any unavailable real-extension smoke must be marked blocked rather than silently waived. |

## Assumptions, Risks, and Blockers

- **Assumption:** the installed Pi factory contract remains synchronous and returns a component with synchronous `render(width)` plus optional `dispose()`.
- **Assumption:** the target pi-subagents factories continue to require only the plain theme, terminal dimensions, and `requestRender()`; no hidden full-TUI dependency is promised.
- **Risk:** trusted factory or render code can block the Node process or allocate excessive memory. Fixed dimensions, output validation, and error bounds are not a sandbox.
- **Risk:** disposal is synchronously reentrant. A simple map replacement without per-key authority checks can overwrite a newer nested registration or resurrect a stale widget.
- **Risk:** current reload and destruction sequencing is newer than the upstream factory commit. Mechanical cherry-picking can desynchronize local state and projected snapshots or reopen a closing wrapper.
- **Risk:** the fleet widget may show terminal navigation instructions that Pi Web cannot honor. This is accepted only as a documented rendering limitation; interactive inspection remains `/subagents-fleet`.
- **Risk:** ten logical lines can wrap into more browser rows on narrow screens, so responsive visual smoke remains necessary even with a line cap.
- **Blocker path:** if the real pi-subagents extension is unavailable in the implementation environment, automated contract fixtures still run, but VC-002/VC-008/VC-009 remain explicitly blocked until the manual integration smoke can be completed.

## Implementation Handoff

After this exact plan is approved, start implementation with:

```text
/start-implementation .agents/plans/2026-08-11-extension-factory-widgets.md
```

Approval alone does not start implementation or authorize a commit.
