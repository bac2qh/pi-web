# Resizable Application Panels — Checkpoints

Plan: `.agents/plans/2026-08-09-resizable-panels.md`

## Handoff

**Source:** Async workflow `call_NwgygGdcIncrZKgAe4H40I2h|fc_0a5ba1ec8fcb12aa016a7812202a788195b177c0e33568c7db`, child `1402a69c` (`scout`, current-layout investigation). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-09-resizable-panels--/2026-08-09T05-37-04-992Z_019fe506-53e0-7e47-96ca-0c095dc90785/1402a69c/run-0/session.jsonl`.

**Purpose:** Map current width ownership, responsive and expanded-viewer transitions, mounted-tree constraints, test conventions, and the safest insertion seams before implementation.

**Outcome:** `AppShell` is the correct owner for both reusable resize-hook instances and joint reconciliation. The separators must remain direct siblings between the existing sidebar, center, and always-mounted right panel; wrapping or replacing those trees would risk chat/viewer identity. Desktop width ownership exists at four CSS sites (both outer panels and both direct-child rules), while the center remains a flexible inline-size container. Resize eligibility must use the maintained `1000px` boundary rather than the broader `641px` CSS desktop block. Expanded mode needs both conditional separator omission and defensive CSS suppression because it currently hides only named direct shell children.

**Evidence:** Current-source ranges reported and rechecked in the parent: `components/AppShell.tsx` panel/expansion ownership and render seams; `app/globals.css` sidebar, right-panel, expanded, and mobile width rules; `lib/file-viewer-layout.ts`; `hooks/useIsMobile.ts`; and the source-invariant pattern in `lib/file-viewer-layout.test.mjs`. The corrected baseline command `NODE_ENV=test node --test lib/file-viewer-layout.test.mjs lib/display-preferences.test.mjs components/DisplayControls.test.mjs components/FileViewer.test.mjs components/MarkdownFilePreview.test.mjs` passed 34/34. An initial run under ambient `NODE_ENV=production` failed only the 12 React-DOM tests because production React intentionally has no `React.act`; the non-DOM tests passed, and rerunning with the repository’s test environment resolved all failures.

**Uncertainty / gaps:** Source inspection cannot prove pointer-capture cleanup, focus behavior, mounted DOM identity, per-move render behavior, or document geometry. The shell’s `overflow:hidden` can conceal bad totals, so browser validation must measure the center and document widths directly. Current source supplies no deterministic rule for reconciling two simultaneously infeasible preferred widths.

**Recommended use:** Keep the pane trees in place, add sibling handles only in eligible split state, implement deterministic pure joint reconciliation with a `320px` center reservation, and validate real computed geometry rather than visible scrollbars alone.

## Handoff

**Source:** Async workflow `call_NwgygGdcIncrZKgAe4H40I2h|fc_0a5ba1ec8fcb12aa016a7812202a788195b177c0e33568c7db`, child `1339add6` (`scout`, historical-design comparison). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-09-resizable-panels--/2026-08-09T05-37-04-992Z_019fe506-53e0-7e47-96ca-0c095dc90785/1339add6/run-0/session.jsonl`.

**Purpose:** Compare non-ancestor commit `9d1721f` with current HEAD and separate reusable interaction mechanics from behavior that conflicts with the approved plan.

**Outcome:** Reuse Pointer Events with pointer capture, direct live CSS-variable and ARIA mutation, keyboard mappings, net-zero handle geometry, transition suppression, and stable controlled-pane IDs. Replace the historical persistence and constraint model: it used the obsolete `960px` boundary, overwrote stored preferences during temporary clamps, persisted reset pixels instead of removing preferences, reserved `420px` on wide desktop, parsed malformed numeric prefixes, and sequentially reclamped two mutable widths without a deterministic joint result. Add an `isPrimary` admission guard and one idempotent cleanup path that also handles conditional separator removal and expansion.

**Evidence:** Historical `9d1721f:hooks/useResizablePanel.ts`, `9d1721f:lib/panel-layout.ts`, `9d1721f:lib/panel-layout.test.mjs`, `9d1721f:components/AppShell.tsx`, and `9d1721f:app/globals.css` were inspected directly and compared with current `AppShell`/CSS expansion ownership. The parent independently re-read the historical files from Git and confirmed every cited mismatch.

**Uncertainty / gaps:** The historical implementation provides no answer for fair joint clamping when both preferences exceed the available side-panel budget. Browser validation is still required for embedded-content pointer movement, cancellation, focus loss, and responsive/expanded composition.

**Recommended use:** Adapt only the interaction skeleton. Keep preferred values separate from effective widths, remove storage on reset, derive the unset right default from current `42%` semantics, use the exact current `1000px` eligibility signal, and make joint reconciliation pure and independently tested.

## Handoff

**Source:** Async review workflow `call_CGehoRR6A00oopilNVPQhuMR|fc_0a5ba1ec8fcb12aa016a78181bb26881959ebddd6dc230ab13`, child `5075a7c0` (`reviewer`, layout correctness). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-09-resizable-panels--/2026-08-09T05-37-04-992Z_019fe506-53e0-7e47-96ca-0c095dc90785/5075a7c0/run-0/session.jsonl`.

**Purpose:** Independently review geometry, preferred/effective ownership, pointer races, React-hook behavior, and responsive reconciliation against the fixed plan.

**Outcome:** The reviewer found one high-severity race in the then-current hook: finishing an active drag after a viewport/panel constraint tightened could mistake an automatic effective clamp for user intent and persist it. The parent accepted the finding and changed drag completion to require actual pointer movement plus equality with the last pointer-produced width; viewport-driven cancellation is explicitly non-persisting, including layout-effect ordering. A trusted-browser regression now starts an unmoved captured drag, contracts the viewport, verifies both stored preferences remain unchanged, and proves the wider geometry restores.

**Evidence:** Finding cited the then-current `hooks/useResizablePanel.ts` completion path and `AppShell` reconciliation. Fix evidence is in the current hook’s `pointerMoved`/`lastPointerWidth` checks, `cancelResize(false)` viewport paths, focused source invariants, and `.agents/reports/2026-08-09-resizable-panels/browser-validation.json` under `activeDragContraction` and VC-002.

**Uncertainty / gaps:** None remains for the identified race. The reviewer otherwise found no blocker, medium, low, or scope departure.

**Recommended use:** Retain the explicit distinction between pointer-produced preference changes and reconciliation-only effective changes; do not simplify completion back to comparing final effective width with drag-start width.

## Handoff

**Source:** Async review workflow `call_CGehoRR6A00oopilNVPQhuMR|fc_0a5ba1ec8fcb12aa016a78181bb26881959ebddd6dc230ab13`, child `c3d27e0c` (`reviewer`, accessibility and responsive behavior). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-09-resizable-panels--/2026-08-09T05-37-04-992Z_019fe506-53e0-7e47-96ca-0c095dc90785/c3d27e0c/run-0/session.jsonl`.

**Purpose:** Review separator semantics, focus and pointer cleanup, breakpoint/expansion composition, mounted identity, CSS ownership, browser-evidence completeness, and report privacy.

**Outcome:** No source-code defect was found. The reviewer correctly identified the first browser report as insufficiently explicit for every VC-001–VC-004 claim. The parent reran and expanded the privacy-safe CDP workflow: it now records trusted over-bound pointer exit, capture release, conditional-unmount cleanup, active-drag contraction, absent-storage reload, live ARIA after pointer/keyboard changes, accessibility-tree role/name/orientation/focusability, a visible focus line/reset hint, narrow restore suppression and next-open reset, hidden-focus clearing, mounted identity, final-tab closure, and light/dark geometry. Every VC has a bounded evidence index and the report retains no path, session ID, transcript, or content.

**Evidence:** `.agents/reports/2026-08-09-resizable-panels/browser-validation.json` version 2; source ranges for conditional handles and CSS defensive suppression; the reviewer’s privacy check; focused source/component invariants.

**Uncertainty / gaps:** The executable CDP script remains an untracked temporary harness, consistent with the approved no-new-browser-framework strategy. Visibility-loss cleanup is source-inspected rather than separately forcing a browser tab lifecycle, while blur, pointer cancel, lost capture, and conditional unmount are exercised with trusted/synthetic browser events as appropriate.

**Recommended use:** Treat the sanitized version-2 report as the VC-001–VC-004 browser receipt and retain the source-level visibility/unmount cleanup checks.

## Handoff

**Source:** Async review workflow `call_CGehoRR6A00oopilNVPQhuMR|fc_0a5ba1ec8fcb12aa016a78181bb26881959ebddd6dc230ab13`, child `c8d07964` (`reviewer`, tests and simplicity). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-09-resizable-panels--/2026-08-09T05-37-04-992Z_019fe506-53e0-7e47-96ca-0c095dc90785/c8d07964/run-0/session.jsonl`.

**Purpose:** Review pure-model edge cases, test strength, SSR/hydration behavior, listener/storage failure handling, maintainability, and render-performance risk.

**Outcome:** The pure model passed the reviewer’s generated invariant sweep. Two implementation findings were accepted: persisted widths were restored from a passive effect and could flash defaults for one paint, and same-breakpoint viewport resizing could rerender the full shell on every event. Restoration now uses a client layout effect, preserving matching initial markup while flushing preferred-width reconciliation before first paint. Resize events now perform direct CSS/ARIA reconciliation without React state and coalesce one trailing React commit; breakpoint or visibility state changes still reconcile synchronously. The reviewer’s note that source-regex interaction tests cannot replace browser behavior is accepted and covered by the expanded browser receipt rather than a new DOM dependency.

**Evidence:** Current `useResizablePanel` restoration uses `useLayoutEffect`; `AppShell` calls `reconcileEffectivePanelWidths(false)` during resize and schedules one bounded trailing commit; focused tests assert these seams; TypeScript and lint pass.

**Uncertainty / gaps:** No blocker or pure-model defect remains. The trailing viewport commit uses a short browser-local timer; browser geometry and live ARIA are updated immediately, and cleanup cancels the timer on unmount.

**Recommended use:** Preserve pre-paint restoration and direct live viewport reconciliation. Continue relying on pure tests plus real-browser receipts rather than adding a DOM framework solely for this hook.

## Handoff

**Source:** Final independent review run `be5235dd` (`reviewer`). Recoverable raw session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-09-resizable-panels--/2026-08-09T05-37-04-992Z_019fe506-53e0-7e47-96ca-0c095dc90785/be5235dd/run-0/session.jsonl`.

**Purpose:** Re-review the complete post-fix implementation, tests, and version-2 browser receipt against the fixed plan and VC-001–VC-005, with particular scrutiny of pointer commit gating, pre-paint restoration, direct viewport reconciliation, and exact live ARIA bounds.

**Outcome:** No blocker or major finding. The reviewer independently swept viewport widths from `1000–5000px`, visibility combinations, and extreme preferences; all eligible layouts remained finite and preserved the `320px` center. It confirmed that viewport cancellation cannot persist a clamp, storage and reset fail safely, every cleanup route centralizes correctly, CSS-variable ownership and responsive suppression are complete, and the jointly resolved bounds are passed into both direct reconciliation calls so ARIA min/max cannot be transiently stale because of sequential ref updates. It recommends acceptance of all five validation contracts.

**Evidence:** Run `be5235dd`; current `lib/panel-layout.ts`, `hooks/useResizablePanel.ts`, `components/AppShell.tsx`, and `app/globals.css`; reviewer-run 652-test lib suite, 44-test focused layout/viewer/display suite, TypeScript, lint, and diff check; `.agents/reports/2026-08-09-resizable-panels/browser-validation.json`.

**Uncertainty / gaps:** The temporary CDP harness is not retained, so browser evidence is an attested privacy-safe receipt rather than an in-repository replay command. Visibility loss and blocked storage are source-verified rather than separately browser-forced. The inactive separator’s changing maximum is not sampled while the other separator owns pointer capture; the active separator’s ARIA is live and both are exact at completion. Source interaction tests remain focused invariants rather than a new DOM framework.

**Recommended use:** Accept the implementation after the parent’s final full-suite rerun and guarded closeout; retain the residual evidence limitations in the final report rather than expanding scope or adding a test dependency.

## Implementation Summary

**Plan section:** Design / Implementation Strategy steps 1–8 and Validation Contract VC-001–VC-005.

**Work and outcome:** Added a pure joint panel-layout model, one reusable Pointer Events/keyboard resize hook, two conditionally mounted desktop separators, complete outer/direct-child CSS-variable width ownership, guarded independent browser-local preferences, reset-by-removal behavior, pre-paint restoration, and direct responsive reconciliation that protects a `320px` conversation width without remounting chat or viewer content. Current collapse, expansion, `<1000px` automatic full-width, and `<=640px` mobile behavior remain authoritative. Updated durable display-preference memory and retained a privacy-safe browser receipt.

**Validation / evidence:** Final parent run: `NODE_ENV=test node --test components/*.test.mjs lib/*.test.mjs` passed 776/776; focused panel/file-layout tests passed 16/16; `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` passed. Chromium CDP validation passed trusted mouse/touch/keyboard, accessibility-tree, storage, cleanup, viewport, expansion, mounted-identity, final-tab, theme, and overflow checks in `.agents/reports/2026-08-09-resizable-panels/browser-validation.json`. Final independent review `be5235dd` found no blocker or major issue and recommended VC-001–VC-005 acceptance.

**Departures from approved obligations:** None. The browser executable harness was intentionally temporary under the approved no-new-DOM/browser-framework strategy; the sanitized retained report is the browser receipt. Visibility-loss and blocked-storage fallbacks are source-verified, while adjacent cleanup/storage paths were browser-exercised.

**Implementation commit:** Pending.
