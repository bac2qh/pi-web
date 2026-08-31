# Mobile-Capable Panel Resizing

Status: approved
Date: 2026-08-30
Approved by user: 2026-08-30

## Objective

Enable touch/pointer resizing for Pi Web’s resizable side-panel boundaries on mobile-class devices when the viewport has enough room to behave like a compact desktop (including foldable phones), without making genuinely narrow phone layouts unusable.

Success means:

- a supported touch or pen drag can resize each in-scope visible panel boundary;
- available screen geometry, rather than a device label alone, determines whether a split layout and its resize boundary are usable;
- existing side-panel minimums and the conversation-width reservation policy remain unchanged;
- existing mouse and keyboard resizing, stored width preferences, expanded-panel behavior, and narrow-phone navigation remain correct.

The artificial `1000px` resize cutoff will be removed. Dragging will be available whenever the current presentation contains an adjustable split boundary; overlay and full-screen panels will retain their presentation and have no resize handle because they have no split boundary.

## Design / Implementation Strategy

Reuse the existing Pointer Events-based `useResizablePanel` owner, width preference storage, effective-width reconciliation, and sidebar/right-panel width constraints. The hook already supports primary touch and pen input through pointer capture; the feature is disabled below `1000px` by separate React eligibility and CSS suppression, not by a mouse-only implementation.

There are exactly two existing boundaries: sidebar/conversation and conversation/right panel. Remove the categorical `1000px` eligibility gate in both React and CSS. First derive actual split visibility from the current presentation: the viewport is outside the `<=640px` overlay/full-width mode, the right panel is not expanded, and the controlled panel is open. Use those visibility facts—not the other handle’s eligibility—when calculating both panels’ effective bounds. Then render each handle only when its controlled panel is split-visible and its current `maxWidth` exceeds `minWidth`. This avoids a circular error where omitting one fixed handle could make the layout calculation ignore its still-visible panel.

Preserve the existing minimums rather than manufacturing drag range by shrinking panel or conversation obligations. This permits one available boundary to resize even when another cannot, and lets eligibility update after a viewport, panel-visibility, expansion, or completed-width change. Retain the existing keyboard separator semantics. On coarse or any-coarse pointer devices, enlarge only the transparent handle to at least `24` CSS pixels while keeping the visual separator `2px`; input capability changes target size, never resize eligibility. Do not mount a separator over the existing overlay sidebar or full-screen right panel, and do not redesign those presentations.

**Rough scope estimate**

- **Surfaces:** responsive layout policy, `AppShell` resize eligibility/rendering, separator styling and touch behavior, panel-layout tests, and focused UI/browser validation.
- **Testability:** strong for pure width/breakpoint policy; pointer and responsive presentation need browser interaction at representative touch-capable viewport sizes.
- **Implementation difficulty:** moderate. The resize hook already uses unified Pointer Events, but mobile overlay/full-width rules and touch gesture conflicts must be reconciled deliberately.

## Reference Files

- [Panel layout policy](../../lib/panel-layout.ts)
- [Resizable panel hook](../../hooks/useResizablePanel.ts)
- [Application shell](../../components/AppShell.tsx)
- [Responsive viewport hooks](../../hooks/useIsMobile.ts)
- [File-viewer expansion policy](../../lib/file-viewer-layout.ts)
- [Global responsive styles](../../app/globals.css)
- [Existing panel layout tests](../../lib/panel-layout.test.mjs)
- [Existing file-viewer layout tests](../../lib/file-viewer-layout.test.mjs)
- [Original resizable-panels plan](2026-08-09-resizable-panels.md)
- [Original resizable-panels checkpoint](../checkpoints/2026-08-09-resizable-panels-checkpoints.md)
- [Original resizable-panels browser evidence](../reports/2026-08-09-resizable-panels/browser-validation.json)
- [Browser-local display preference memory](../memory/display-preferences.md)

References are advisory evidence and do not expand this plan’s scope.

## Current Evidence / Constraints

- `AppShell` omits both handles below `1000px`, and CSS independently hides any handle through `999px`. This was an explicit limit in the original resizable-panels plan.
- The shared hook already accepts touch and pen through Pointer Events, uses pointer capture, and scopes `touch-action: none` to the handle. No touch-specific hook is needed.
- From `641–999px`, an open sidebar can already have a real flex boundary. The right panel normally opens full-width, but its existing **Restore** action can reveal a real split boundary; both remain non-resizable only because of the two cutoff gates.
- The current bounds callbacks treat the other handle’s `enabled` flag as panel visibility. That is equivalent only while all split-visible handles share one fixed cutoff. Geometry-derived eligibility must separate actual panel visibility from whether that panel’s own handle has range, or one omitted handle could make the other panel’s maximum unsafe.
- At `640px` and below, there is no existing split boundary: the sidebar is a fixed `280px`/maximum `85vw` overlay and an open right panel occupies `100%` width. Resizing either would be a separate presentation change, not just enabling the current handle.
- Existing absolute minimums are `180px` sidebar, `300px` right panel, and a targeted `320px` conversation width. All three require `800px`; below that, the current layout model preserves side-panel minima and lets conversation become narrower.
- The current transparent handle is `12px` wide around a `2px` visible line. It works with touch but needs a larger acquisition area for deliberate mobile use.
- Existing panel widths are browser-local preferences and effective widths are temporarily clamped without overwriting them. This ownership model should remain intact.
- No new dependency or parallel mobile-specific resize state is currently justified.

## User Decisions

- **2026-08-30:** Remove the `1000px` resizing limit. Dragging should not be disabled merely because the CSS viewport is below that width; any remaining absence of a handle must follow from the actual panel presentation rather than this fixed cutoff.
- **2026-08-30:** Enable dragging only where a real split boundary exists. Preserve the mobile overlay sidebar and full-screen right-panel presentations without resize handles; do not redesign every open panel as a resizable surface.
- **2026-08-30:** Preserve the current `180px` sidebar, `300px` right-panel, and targeted `320px` conversation minimums. When the current geometry gives a boundary no actual resize range, omit its handle rather than lowering a minimum; other independently adjustable boundaries remain eligible.

## Test Strategy

Extend the pure panel policy and focused source-invariant tests to cover geometry-derived handle eligibility with each panel alone and both together at `640`, `641`, `768`, `800`, `900`, `999`, and `1000` CSS pixels, including transitions where one handle becomes adjustable only after the other panel shrinks. Assert that bounds continue accounting for every split-visible panel even when that panel has no handle. Keep the file-viewer expansion tests authoritative for full-screen/Restore behavior below `1000px`.

Use a privacy-safe browser interaction pass, following the existing retained-receipt convention, to exercise primary touch, mouse, and keyboard input. Verify coarse-pointer target geometry, bounds, active-drag cleanup, ordinary scrolling outside the handle, panel open/close, narrow full-screen expansion and Restore, rotation/viewport crossings, preference restoration, and absence of document overflow. Run the focused and full Node suites, TypeScript, lint, and diff checks; do not run `next build`.

## Telemetry / Debuggability

Not applicable. This is local presentation state with deterministic viewport and width inputs; additional production logging would add noise and potentially high-cardinality browser data. Accessible separator values and focused test assertions provide the appropriate diagnostics.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | There is no categorical `1000px` resize gate: at any viewport width, each visible split boundary with `maxWidth > minWidth` supports primary touch/pointer resizing and remains within bounds that account for every other split-visible panel, including one whose own handle has no range. | Exercise representative `641–999px` and `1000px+` split layouts with trusted touch/pointer input, and verify visibility/eligibility/bounds separation through focused pure and source-invariant tests. | Stop; correct the shared visibility, eligibility, or bounds path rather than adding device-specific exceptions. |
| VC-002 | Existing desktop mouse drag, keyboard resize/reset semantics, and browser-local preferred-width persistence continue to work. | Run focused existing/new tests and a desktop interaction regression pass. | Stop and correct the shared regression rather than adding a mobile-only workaround. |
| VC-003 | Overlay/full-screen presentations remain unchanged and expose no handle; a split boundary with no effective range also exposes no nonfunctional separator. Existing panel and conversation minimum policy is not weakened to force dragging. | Test visibility/range combinations around `640`, `800`, and `1000px`, and exercise mobile open/close, narrow right-panel expansion/Restore, and viewport crossings in the browser. | Stop; revise eligibility without redesigning the narrow presentations or lowering established minimums. |
| VC-004 | Viewport changes reconcile effective widths without overwriting stored user preferences, and returning to a roomier layout restores the preference subject to absolute bounds. | Extend the pure layout tests and verify a resize/rotation round trip in the browser. | Stop; fix preference/effective-width ownership before completion. |
| VC-005 | On coarse or any-coarse pointers, each eligible separator has a transparent target at least `24` CSS pixels wide around the unchanged `2px` visual line. It prevents page panning and text selection during its active drag, while ordinary scrolling outside the target remains available. | Inspect computed target/line geometry and perform trusted touch interaction at representative compact split viewports. | Stop; correct target geometry or scoped touch-action behavior without broadening resize eligibility. |

## Assumptions, Risks, and Blockers

- **Assumption:** Browser Pointer Events and CSS-pixel viewport geometry remain the correct cross-device inputs; no foldable-hardware detection is needed.
- **Risk:** foldable devices can report CSS viewport widths that change with posture, browser chrome, display scaling, or split-screen use. Eligibility and effective bounds must therefore reconcile on each existing viewport-change path.
- **Risk:** the three protected widths total `800px`. At or below that geometry, both visible side panels may legitimately have no adjustable range; a handle must not imply otherwise.
- **Risk:** widening a net-zero separator’s touch region can overlap interactive content on both sides. The `24px` coarse-pointer target is the minimum planned enlargement; retain the narrow visual line and keep gesture suppression scoped to the handle and active drag.
- **Blockers:** None.

## Implementation Handoff

After this plan is finalized, explicitly approved, and separately committed, launch only this ordinary plan with:

```text
/start-implementation .agents/plans/2026-08-30-mobile-panel-resizing.md
```
