# Factory-Based Extension Widgets Checkpoints

Plan: `.agents/plans/2026-08-11-extension-factory-widgets.md`

## Handoff

**Source:** Fresh read-only investigation workflow `cc5b55f8-20e2-4ec7-a3d4-c5a154a66aff`; child `a3942a05` (`server-widget-lifecycle`). Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/cc5b55f8-20e2-4ec7-a3d4-c5a154a66aff/status.json`.

**Purpose:** Map the current wrapper, reload, destruction, projection, theme, and structural-type seams against upstream factory-widget and headless-TUI evidence before implementation.

**Outcome:** The existing `emit()` path remains the only correct joint legacy/projected widget publication seam, while `get_state` separately reads the wrapper map. Both reload paths currently clear projected extension state before native reload, and destruction closes the hub only after custom UI cleanup. The implementation therefore needs one per-key authority operation, fixed headless façade, cleanup guard, non-recursive render guard, and map/component state established before emitted publication. Upstream generation/registry shapes and the 27-line façade are reusable; its raw error formatting, disposer access, recursive refresh behavior, and older reload/destruction blocks are not.

**Evidence:** The child cited current `lib/rpc-manager.ts`, `lib/pi-types.ts`, `lib/rpc-manager.test.mjs`, and upstream commits `a6ba057466d5bb8123a6e717eb567a04d4974833` and `17945f9`. The parent independently read the decisive current and historical ranges, including `emit()`, `clearProjectedExtensionState()`, both reloads, `destroy()`, the array-only adapter, and the projected hub receipt path.

**Uncertainty / gaps:** Source inspection does not prove real pi-subagents integration, browser reconnect behavior, or all hostile proxy/reentrancy cases. Those remain automated lifecycle/projection and manual integration obligations. The projected hub can reject unrepresentable payloads under existing limits; this plan does not redesign that established trusted-extension boundary.

**Recommended use:** Implement the façade separately, keep custom-panel behavior unchanged, centralize array/factory/clear ownership and publication, invalidate before disposal, suppress cleanup-time registration, bound phase-specific errors, and assert legacy, wrapper, live hub, replay, and snapshot agreement.

## Handoff

**Source:** Fresh read-only investigation workflow `cc5b55f8-20e2-4ec7-a3d4-c5a154a66aff`; child `1b3f54b8` (`browser-widget-presentation`). Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/cc5b55f8-20e2-4ec7-a3d4-c5a154a66aff/status.json`.

**Purpose:** Map current empty/established chat composition, responsive styling, test conventions, and the upstream editor-adjacent presentation change.

**Outcome:** The empty/new branch renders no widgets. The established branch incorrectly keeps above widgets in the transcript and renders below widgets before the editor. A standalone presentation component can preserve current scaled typography and responsive wrapping while applying the ten-logical-line Pi Web policy. A tiny shared `above → editor → below` composition component can be rendered in both branches without mounting the hook-heavy chat window or importing obsolete upstream fixed-width layout.

**Evidence:** The child cited `components/ChatWindow.tsx`, `.chat-column` rules in `app/globals.css`, `components/ChatInput.test.mjs`, and upstream commit `9e4ca655493e29a98922faed978b585596472a3b`. The parent independently verified the current branch order, inline widget renderer, and upstream extracted component/tests.

**Uncertainty / gaps:** SSR/source tests cannot prove narrow wrapping, composer scrolling/overlap, minimap alignment, or real extension behavior. Those remain manual browser/integration smoke obligations.

**Recommended use:** Preserve current `.chat-column`, padding, scaled fonts, status-chip placement, and editor identity; extract only widget presentation/composition, test exact 10/11 boundaries and both branch orders, then inspect desktop/mobile behavior manually.

## Implementation Summary

**Plan section:** Design / Implementation Strategy sections 1 through 5; Test Strategy; Validation Contract VC-001 through VC-009.

**Work and outcome:** Added the frozen 92×40 render-only TUI façade and explicit local factory/component types. The wrapper now gives every widget key monotonic operation authority, owns synchronous factory components exactly once, renders and refreshes with the plain-text theme at 92 columns, blocks recursive and stale refreshes, sanitizes/bounds phase-specific failures, and clears/disposes under a cleanup guard for both reload paths, direct destruction, and strict shutdown. Array, factory, and clear transitions share the existing `setWidget` legacy/projection event; no protocol or reducer shape changed. Receipt-aware publication keeps wrapper state and the projected hub aligned, including rejection retirement, serialized reloads, self-reentry rejection, stale runner revocation, interim-state cleanup, and prompt settlement when destruction interrupts active or queued reloads. Extracted widget presentation, applied the ten-logical-line Pi Web cap without truncating authoritative state, and reused one `aboveEditor → editor → belowEditor` composer in empty and established chats. Added the maintained `AGENTS.md` boundary note; no pi-subagents source files changed.

**Validation / evidence:** Final automated validation passed: `NODE_ENV=test node --test lib/custom-ui-terminal.test.mjs lib/rpc-manager-widgets.test.mjs components/ExtensionWidgets.test.mjs` (46/46); `NODE_ENV=test node --test lib/rpc-manager.test.mjs lib/session-projector.test.mjs lib/session-protocol.test.mjs lib/session-reducer.test.mjs lib/session-event-hub.test.mjs components/SessionAgentTransport.test.mjs` (290/290); `../../../node_modules/.bin/tsc --noEmit`; `npm run lint`; and `git diff --check`. The explicit `NODE_ENV=test` prefix selects React's test build because the inherited shell uses production mode. Tests cover the façade, array compatibility, factory render/refresh, full server/live/replay/snapshot authority beyond ten lines, generation/disposal/reentrancy failure classes, cleanup rejection, both reload paths and overlap, stale binding replacement, destruction-settled reload callers, interim-state failure cleanup, custom UI/dialog regressions, browser truncation, and both chat branches. Fresh review workflow `564798d4-b0fc-4c11-8da3-41f5cc02957b` (child `1e650342`) returned clean after adversarial reload-race and late-rejection probes; earlier review findings and their fixes are recoverable in workflows `89accd69-192a-4145-a527-6b92a36155df`, `310d6949-9e50-4303-b73e-b65c784cbba7`, and `50f3c4e8-5c88-41f6-8099-c2037fcff309`.

Real pi-subagents browser validation used an owned dev server and Google Chrome at desktop and 390×400 mobile sizes. The final report observed replacement-driven `subagent-async` updates, in-place fleet `requestRender()` updates, completion/retention/clear behavior, reconnect restoration, both placements in editor-adjacent order, bounded scrollable mobile slots, no horizontal overflow, visible slash/file/thinking popovers, no browser errors, native reload clearing, and working `/subagents-fleet` open/ArrowDown/refresh/close input. Six concurrent real jobs produced exactly ten authoritative async-widget lines, so greater-than-ten browser integration was not naturally reached; the 10/11 display boundary and untruncated 11/12-line server/live/replay/snapshot authority are deterministic automated tests. The owned dev server was stopped and the owned ignored runtime/session artifacts were removed after validation.

**Departures from approved obligations:** The real extension did not naturally produce more than ten logical lines, so the truncation marker was not observed in that browser run. This is an evidence limitation, not an implementation divergence: exact 10/11 presentation behavior and untruncated array/factory authority are covered by focused tests. Persistent widget keyboard input remains intentionally unsupported as approved; `/subagents-fleet` custom-panel input passed. None otherwise.

**Implementation commit:** `PENDING_IMPLEMENTATION_COMMIT`.

## Handoff

**Source:** Fresh adversarial review workflow `89accd69-192a-4145-a527-6b92a36155df`; children `10ecc9b9` (reload/lifecycle correctness) and `ef1ae561` (validation contract). Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/89accd69-192a-4145-a527-6b92a36155df/status.json`.

**Purpose:** Challenge the first complete factory-widget lifecycle implementation, including the newest overlapping-reload and destruction-unwind fixes.

**Outcome:** Found that overlapping reloads could leave a superseded runner context authorized and that native reload failure could leave a live wrapper with no usable UI context. Confirmed destruction-unwind failure reporting. Recommended one serialized wrapper-owned reload path and failure retirement. Also identified a worthwhile greater-than-ten authoritative-state regression.

**Evidence:** Reproductions used retained contexts from out-of-order native reloads and a reload that rejected before `beforeSessionStart`; findings cited the shared UI-generation admission and both reload entry points. The parent implemented serialization, stale-context revocation, failure retirement, and 11/12-line authoritative array/factory assertions.

**Uncertainty / gaps:** Serialization introduced new reentrancy and destruction-settlement questions, so this handoff was not treated as final acceptance.

**Recommended use:** Preserve the one reload authority seam and keep adversarial review focused on self-reentry, queue settlement, and receipt-authoritative cleanup.

## Handoff

**Source:** Follow-up fresh review workflow `310d6949-9e50-4303-b73e-b65c784cbba7`; child `bcf175bd`. Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/310d6949-9e50-4303-b73e-b65c784cbba7/status.json`.

**Purpose:** Adversarially test serialized reloads and the new failure-retirement behavior.

**Outcome:** Found a self-reentrant command-context reload deadlock, rejected status cleanup that could split local/projected authority, and fallback UI-rebind failure that left a live half-reloaded wrapper. Confirmed the greater-than-ten authority gap was closed.

**Evidence:** Targeted probes exercised `inner.reload()` awaiting `ctx.reload()`, forced status projection rejection at sequence headroom, and omitted `beforeSessionStart` while `setUIContext()` threw. The parent added active-execution detection, receipt-aware status deletion, broader failure retirement, and regressions.

**Uncertainty / gaps:** The first reentry guard was per command-context closure and needed one more review against RPC-initiated outer reload and concurrent callers.

**Recommended use:** Detect active reload execution by async call context, not by one captured command context; keep independent callers serialized.

## Handoff

**Source:** Parallel fresh review workflow `50f3c4e8-5c88-41f6-8099-c2037fcff309`; children `0a4abfe8` (lifecycle) and `4a2c53f6` (full validation contract). Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/50f3c4e8-5c88-41f6-8099-c2037fcff309/status.json`.

**Purpose:** Review AsyncLocalStorage-based reentry detection, status cleanup, reload failure retirement, and the full implementation surface.

**Outcome:** The validation-contract reviewer found the feature surface clean. The lifecycle reviewer found active/queued reload callers could remain pending after external destruction and interim rebound status could survive failure retirement. The parent added a destruction notice raced by every reload caller, preserved reload-initiated failure semantics, and ran receipt-authoritative second-generation cleanup before retirement.

**Evidence:** Reproductions used one never-settling native reload plus a queued caller and a rebound context that set status before throwing. Added tests prove both callers reject promptly with only one native reload, and interim status/widget set then clear before hub closure with exactly-once component disposal.

**Uncertainty / gaps:** Required one final clean-room review to check late native rejection and intentional cleanup-rejection return behavior.

**Recommended use:** Treat external destruction and reload-initiated retirement distinctly; retain the queue tail only as serialized background work while public callers race the destruction notice.

## Handoff

**Source:** Final fresh clean-room review workflow `564798d4-b0fc-4c11-8da3-41f5cc02957b`; child `1e650342`. Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/564798d4-b0fc-4c11-8da3-41f5cc02957b/status.json`.

**Purpose:** Independently close the destruction-aware reload queue, interim cleanup, self-reentry, and late-rejection risk classes after all fixes.

**Outcome:** Clean—no blocker or fix worth doing now remained. The reviewer confirmed prompt settlement for active/queued callers, preservation of the defined cleanup-rejection RPC response, receipt-authoritative failure cleanup, both self-reentry origins, independent serialization, and no duplicate disposal or unhandled late rejection.

**Evidence:** Focused tests passed 46/46, broad relevant regressions passed 290/290, and an additional late-native-rejection probe observed one native reload, one disposal, settled callers, and zero unhandled rejections.

**Uncertainty / gaps:** The reviewer had not observed the real browser smoke. The parent separately completed that smoke; only a naturally greater-than-ten real-widget payload remained unavailable and is covered deterministically in automated presentation/authority tests.

**Recommended use:** Accept the lifecycle implementation subject to the final recorded command rerun, scoped diff inspection, implementation commit, and guarded closeout.
