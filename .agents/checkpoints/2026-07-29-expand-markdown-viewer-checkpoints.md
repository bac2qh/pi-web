# Expand File Viewer Checkpoints

Plan: `.agents/plans/2026-07-29-expand-markdown-viewer.md`

## Handoff

**Source:** Pi subagent run `27faf6ef-e0c3-4d75-acab-44d61f2a5d63`, child 0 (`scout`, shell/panel reconnaissance). Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-expand-markdown-viewer--/2026-07-30T05-04-41-297Z_019fb169-1351-75df-958f-38a3e2cbb7d0/e0cedf8e/run-1/session.jsonl`; raw output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/27faf6ef-e0c3-4d75-acab-44d61f2a5d63/output-0.log`.

**Purpose:** Map the existing AppShell/tab/panel/mobile ownership boundary and identify the narrowest mounted-tree expanded-mode implementation.

**Outcome:** `AppShell` already owns every relevant state and keeps the sidebar, center/chat, right panel, and `FileViewer` subtrees mounted. Add one sibling `fileViewerExpanded` Boolean; toggle it from a native 36px viewer-chrome button beside `TabBar`; clear it only when the final file tab closes or `useIsMobile()` becomes true. Apply root/panel classes so desktop CSS removes sidebar/backdrop/center from layout without conditional React rendering, suppresses the out-of-tree fixed panel toggle, and overrides both the panel's `42%`/`300px` constraint and each direct child's independent `42vw`/`300px` constraint. Keep `TabBar.tsx` and `useIsMobile.ts` unchanged.

**Evidence:** `components/AppShell.tsx:133-140,287-321,351-358,493-545,1063-1138`; `components/TabBar.tsx:19-94`; `hooks/useIsMobile.ts:5-31`; `app/globals.css:817-919`. Current final-tab closure is the only existing automatic panel close. The fixed toggle is outside the shell root at `z-index:300`, so it needs its own state/class suppression. `display:none` on shell-region ancestors removes layout and pointer hit-testing while preserving React identity/effects.

**Uncertainty / gaps:** Source can establish preservation by structure but not prove DOM identity, live-watch continuity, or geometry. CSS specificity/order must beat both desktop width rules, and the fixed sidebar backdrop has inline pointer-event state. These require browser checks.

**Recommended use:** Implement state/classes and both-level width overrides narrowly in `AppShell.tsx` and `app/globals.css`; use stable class/data hooks for privacy-safe geometry and identity validation; do not add Fullscreen, persistence, Escape, portal, or renderer coupling.

## Handoff

**Source:** Pi subagent run `27faf6ef-e0c3-4d75-acab-44d61f2a5d63`, child 1 (`context-builder`, Explorer Markdown/test reconnaissance). Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-expand-markdown-viewer--/2026-07-30T05-04-41-297Z_019fb169-1351-75df-958f-38a3e2cbb7d0/e0cedf8e/run-1/session.jsonl`; raw output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/27faf6ef-e0c3-4d75-acab-44d61f2a5d63/output-1.log`.

**Purpose:** Trace Explorer Markdown rendering, link semantics, component typing, safe table/media hooks, CSS breakout behavior, and the repository's Node/Jiti test pattern.

**Outcome:** Extract the current hook-free Markdown preview JSX into an exported pure component, preserving Explorer's existing file-relative link resolution and plain external-anchor behavior. Add a file-scoped GFM table overflow wrapper and responsive image hook. Apply the `min(100%, 1000px)` reading width only to direct preview children, then exempt direct fenced code, direct table wrappers, and exact standalone-image paragraphs so nested/mixed media remains in the reading column. Keep chat `MarkdownBody`, shared sanitizer/plugins, and image-source semantics unchanged.

**Evidence:** `components/FileViewer.tsx:684-804,920-993`; `components/MarkdownBody.tsx:62-130`; `components/MarkdownBody.test.mjs:1-73`; `lib/file-links.ts:77-118`; `lib/markdown.ts:8-29`; `app/globals.css:117-268,442-467`. ReactMarkdown 10 exposes a typed `Components` map. Explorer external links currently do not force `_blank`, unlike chat. The sanitizer supports images but not embedded audio/video, so widening sanitizer scope would be an unrelated security/product change. Existing `pre` already has inner horizontal overflow; tables need an Explorer wrapper.

**Uncertainty / gaps:** Static server rendering cannot exercise local-link click interception or computed geometry. Standalone classification must not widen paragraphs containing both prose and images. Root overflow clipping is safe only if browser evidence confirms code/table inner scrolling remains reachable. Importing all of `FileViewer.tsx` in Jiti may be heavier than a separate pure module, but should be tried before adding a new production file.

**Recommended use:** Prefer exact file-scoped markup/classes and direct-child selectors; add synthetic server-render tests for links, table wrapper, standalone versus mixed media, and chat-class isolation; validate click behavior, 1000px geometry, proportional images, and overflow in-browser. Do not add a DOM dependency or modify `MarkdownBody`.

## Handoff

**Source:** Pi subagent run `92384ffc-c068-43be-8cd0-51f87361a683`, child 0 (`reviewer`, shell/lifecycle review). Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-expand-markdown-viewer--/2026-07-30T05-04-41-297Z_019fb169-1351-75df-958f-38a3e2cbb7d0/9eaf36cd/run-0/session.jsonl`; raw output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/92384ffc-c068-43be-8cd0-51f87361a683/output-0.log`.

**Purpose:** Adversarially review expanded-state ownership, lifecycle, mounted-state preservation, responsive geometry, control usability, fixed-toggle interaction, tab closure, and validation evidence.

**Outcome:** No implementation defects or P0/P1 blockers were found. The reviewer confirmed the one-state AppShell boundary, CSS-only mounted subtree preservation, both-level desktop width overrides, final-tab/mobile clearing, accessible native control, representative renderer coverage, and repository-health results.

**Evidence:** `components/AppShell.tsx:136-145,321-332,506-509,1072-1156`; `app/globals.css:858-963`; `.agents/reports/2026-07-29-expand-markdown-viewer/browser-validation.json`. The browser report records a `1440×900` full-panel geometry, hidden shell regions, retained DOM probes, live watch, all representative renderers, non-final/final closure, and the `641px`/`640px` transition.

**Uncertainty / gaps:** The reviewer noted that normal split geometry at exactly `641px` and explicit scroll-position retention were not separately measured. Those are residual validation-depth gaps, not observed defects; normal desktop geometry, expanded `641px`, mobile `640px`, and mounted identity are covered. The reviewer also requested regression coverage for the later direct raw-image rule.

**Recommended use:** Keep the shell implementation; add direct raw-image markup coverage and ensure final browser/static validation reflects the final CSS. Treat exact-641 normal split and scroll-position measurement as non-blocking residual test-depth limitations.

## Handoff

**Source:** Pi subagent run `92384ffc-c068-43be-8cd0-51f87361a683`, child 1 (`reviewer`, Markdown/privacy review). Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-expand-markdown-viewer--/2026-07-30T05-04-41-297Z_019fb169-1351-75df-958f-38a3e2cbb7d0/9eaf36cd/run-1/session.jsonl`; raw output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/92384ffc-c068-43be-8cd0-51f87361a683/output-1.log`.

**Purpose:** Adversarially review Explorer Markdown semantics, link preservation, table/media classification, CSS specificity/overflow, chat isolation, test quality, scope, and retained validation privacy.

**Outcome:** Two medium findings were accepted and resolved: a direct sanitized raw-HTML `<img>` needed its own top-level wide-media CSS exception, and the retained full automated-test log exposed local paths and synthetic session identifiers. The final CSS now gives a direct `.markdown-file-media` child natural-width breakout bounded by `max-width: 100%`; a focused SSR regression test covers that direct shape. The automated report is now a sanitized aggregate summary. Untracked `.pi-subagents` runtime artifacts were removed.

**Evidence:** `app/globals.css` direct-media selector; `components/MarkdownFilePreview.tsx` image hook; `components/MarkdownFilePreview.test.mjs` raw-image test; `.agents/reports/2026-07-29-expand-markdown-viewer/automated-validation.txt`. Existing local-link click code remains source-equivalent, and the browser workflow explicitly clicked the local “Open source” link while expanded even though the JSON records that under renderer/tab continuity rather than a dedicated field.

**Uncertainty / gaps:** Static SSR cannot invoke click handlers. Browser geometry is quantitatively richest at expanded `1440px`; threshold/mobile evidence focuses shell geometry and screenshots rather than repeating every Markdown measurement. No high-severity or blocking defect remained.

**Recommended use:** Retain the fixes, rerun focused/full validation after the final CSS/test change, verify reports contain no private paths or identifiers, and proceed only if independent final review remains clean.

## Handoff

**Source:** Pi subagent run `2c8eb55a-5b64-4d1d-8a18-27e1609c82d0` (`reviewer`, final verification). Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-expand-markdown-viewer--/2026-07-30T05-04-41-297Z_019fb169-1351-75df-958f-38a3e2cbb7d0/37374a63/run-0/session.jsonl`; raw output: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/2c8eb55a-5b64-4d1d-8a18-27e1609c82d0/output-0.log`.

**Purpose:** Independently verify the final diff, accepted fixes, reports, tests, accessibility, lifecycle, scope, and privacy before commit.

**Outcome:** The reviewer confirmed the direct raw-HTML image breakout, focused regression coverage, lifecycle/control behavior, both-level panel geometry, sanitized retained reports, all representative renderer evidence, and final repository health. No blocking or non-blocking product, correctness, accessibility, scope, test, or retained-report privacy defect remained after removing the verifier's own transient `.pi-subagents` directory.

**Evidence:** `components/MarkdownFilePreview.tsx:70-79`; `components/MarkdownFilePreview.test.mjs` direct raw-image case; `app/globals.css` responsive direct-media and expanded-panel rules; `components/AppShell.tsx` state/control/final-tab paths; `.agents/reports/2026-07-29-expand-markdown-viewer/browser-validation.json`; `.agents/reports/2026-07-29-expand-markdown-viewer/automated-validation.txt`. Independent rerun: 169 Node tests, TypeScript, lint, and `git diff --check` all passed.

**Uncertainty / gaps:** The browser workflow is retained as privacy-safe JSON/screenshots rather than a committed executable browser test because the repository has no browser harness. This is an optional validation-depth gap, not an observed defect.

**Recommended use:** Remove all transient `.pi-subagents` files (completed), keep the sanitized evidence, run final diff/status/privacy checks, then commit and close out under the approved workflow.

## Implementation Summary

**Plan section:** Objective; Design / Implementation Strategy items 1-10; Validation Contract VC-001 through VC-005.

**Work and outcome:** Added AppShell-owned ephemeral expansion with a visible native expand/restore control, CSS-only mounted shell suppression, full-width panel overrides, fixed-toggle conflict avoidance, final-tab clearing, and mobile-breakpoint reconciliation. Extracted Explorer Markdown into `MarkdownFilePreview`, preserving links while adding file-scoped table overflow, responsive media hooks, exact standalone-media classification, a `1000px` direct reading column, and wider direct code/table/media blocks. Added focused Node/Jiti tests, current-state developer documentation, and privacy-safe browser/automated evidence.

**Validation / evidence:** 169 Node tests passed; TypeScript, lint, and `git diff --check` passed. Isolated Playwright evidence in `.agents/reports/2026-07-29-expand-markdown-viewer/browser-validation.json` and seven synthetic screenshots covers normal/expanded layout, both themes, mounted DOM probes, retained scroll state through reflow, live watch, local-link opening, Markdown Preview/Raw/Diff, source/image/audio/HTML/PDF/DOCX, `1440px`, normal and expanded `641px`, `640px`, `390px`, non-final/final tab closure, inner code/table overflow, direct/paragraph media geometry, accessible labels, pointer ownership, and `document.fullscreenElement === null`. Three independent reviewer passes resolved raw-image and report-privacy findings and ended clean. The sanitized aggregate command record is `.agents/reports/2026-07-29-expand-markdown-viewer/automated-validation.txt`.

**Departures from approved obligations:** None. The browser workflow is retained as synthetic reports/screenshots rather than a committed executable harness, consistent with the approved no-new-DOM-framework strategy and the repository's current test infrastructure.

**Implementation commit:** pending.

## Implementation Summary

**Plan section:** Final validation and closeout for Objective, Design / Implementation Strategy items 1-10, and Validation Contract VC-001 through VC-005.

**Work and outcome:** The expanded shared file viewer and Explorer Markdown hybrid layout are implemented, documented, independently reviewed, and committed. The existing viewer/chat trees remain mounted during expansion; all supported renderer classes share the mode; restoration is visible-button-only; mobile and final-tab paths clear state; and Explorer-only Markdown keeps prose readable while widening safe block content.

**Validation / evidence:** Implementation commit `7f9778ec5f47e01ff6b112962d4974d16306cc15`. Final results: 169 Node tests passed, TypeScript passed, lint passed, `git diff --check` passed, prohibited-boundary and report-privacy searches passed, and no dependency/keyboard/chat-Markdown files changed. Browser evidence and seven synthetic screenshots under `.agents/reports/2026-07-29-expand-markdown-viewer/` cover every validation-contract surface, including direct raw media, normal and expanded `641px`, `640px` mobile clearing, mounted identity, retained nonzero scroll state through layout reflow, all representative file renderers, tab lifecycle, both themes, and no browser Fullscreen use. Final independent review found no remaining blocking or non-blocking defect after transient reviewer artifacts were removed.

**Departures from approved obligations:** None. The browser workflow is preserved as synthetic evidence rather than a committed executable browser harness, as anticipated by the approved strategy and current repository infrastructure; no validation obligation was waived.

**Implementation commit:** `7f9778ec5f47e01ff6b112962d4974d16306cc15`.
