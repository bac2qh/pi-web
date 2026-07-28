# Stable Default Mermaid Preview Mode — Checkpoints

Plan: `.agents/plans/2026-07-22-mermaid-preview-mode.md`
Worktree: `/Users/xin/Documents/repos/pi-web/.agents/worktrees/2026-07-22-mermaid-preview-mode`
Branch: `2026-07-22-mermaid-preview-mode`
Base: `47fd4f7cf94edf0b4456449692f8dcef393cded4`

## Handoff

**Source:** Pi Subagents run `3b21cac3-d8a0-4054-bded-9e17c242dcd1`, child 0 (`context-builder`); recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-22-mermaid-preview-mode--/2026-07-28T19-40-49-377Z_019faa3e-7b61-741c-954b-7b62e5d71332/3e2a1015/run-1/session.jsonl`; raw output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/3b21cac3-d8a0-4054-bded-9e17c242dcd1/output-0.log`.

**Purpose:** Independently trace Mermaid mode ownership, React block identity, late entry-ID reconciliation, final-answer folding, deferred-thinking isolation, and relevant Git history before source mutation.

**Outcome:** Confirmed the approved design and identified two required identity boundaries. Completed text blocks must use assistant timestamp plus their position in the original assistant content, independent of the late entry ID. `ChatWindow` must also preserve that original position when it folds the live final assistant message into process and answer subsets; otherwise subset-local reindexing still remounts Mermaid after `agent_end`. Thinking/tool blocks must retain session/entry/original-block identity. Mermaid selection should be explicit `preview | source`, default Preview, with streaming deriving effective Source rather than mutating the stored selection. A narrow focus-visible rule is required.

**Evidence:** `hooks/useAgentSession.ts` appends a completed assistant without an entry ID at `message_end` and reloads messages plus entry IDs after `agent_end`; `components/MessageView.tsx` currently keys all blocks with `${entryId ?? "stream"}-${originalIndex}`; `components/ChatWindow.tsx` later splits the final message and currently loses full-message indices. Commit `3b91204e8419574f95a4aa5ccac6b363c71d5fda` introduced entry-keyed blocks for deferred thinking; commit `59f4698b184e2df78b84c078c6e62cb7839fb43a` introduced the Mermaid queue, diagnostics, natural sizing, and Transcript/theme render key that must remain unchanged.

**Uncertainty / gaps:** The local mirrored assistant type marks `timestamp` optional although the authoritative SDK requires a number. The approved path therefore remains stable for valid runtime messages; legacy/malformed missing timestamps need an explicit entry-based fallback and cannot claim provisional-to-final stability. Timestamp collisions within one millisecond are a low residual risk selected by the approved plan. Browser causality still requires validation.

**Recommended use:** Add pure mode/key helpers; preserve original indices through split metadata; key only completed text by timestamp/original index; retain entry isolation for non-text blocks; leave `useAgentSession` and renderer security/queue logic unchanged.

## Handoff

**Source:** Pi Subagents run `3b21cac3-d8a0-4054-bded-9e17c242dcd1`, child 1 (`context-builder`); recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-22-mermaid-preview-mode--/2026-07-28T19-40-49-377Z_019faa3e-7b61-741c-954b-7b62e5d71332/3e2a1015/run-1/session.jsonl`; raw output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/3b21cac3-d8a0-4054-bded-9e17c242dcd1/output-1.log`.

**Purpose:** Independently map focused tests, browser tooling, safe fixture options, lazy-history behavior, accessibility checks, and the evidence limits of pure/SSR tests for VC-001 through VC-009.

**Outcome:** No dependency change is needed. Node helpers plus React server rendering can cover deterministic mode, identity, initial markup, split positions, render keys, and queue recovery, but not browser effects or mounted state retention. Global Playwright 1.61.1 and cached Chromium are available outside project dependencies. Validation should use a dedicated dev port and privacy-safe synthetic SDK session, with more than 50 rendered items for lazy history and valid/invalid/valid Mermaid order for queue recovery. A temporary component-only validation route may be used and removed to deterministically exercise streaming-to-completed and delayed entry-ID/folding transitions without a live provider.

**Evidence:** `package.json` has Node/jiti/SSR tests but no DOM runner; `/opt/homebrew/bin/playwright` and `/opt/homebrew/lib/node_modules/playwright` are available; cached Chromium shell 1228 exists. `lib/chat-lazy-load.ts` and `ChatWindow` mount the latest 50 rendered items. Prior checkpoint evidence documents successful privacy-safe external Playwright use. Port 30141 belongs to unrelated user state and must remain untouched.

**Uncertainty / gaps:** A historical session alone cannot prove the exact `message_end` to `agent_end` transition. A live provider would be costly and unnecessary if an ephemeral browser component harness uses the production components and changes only their props; that harness must not remain in the tracked diff. Browser output must avoid transcript/source/SVG/session/path content. The plan cites Mermaid `^11.14.0`, while the installed tree is `^11.15.0`; no dependency change is warranted.

**Recommended use:** Extend existing pure and SSR tests, then run external Playwright against a separate Next dev server and synthetic non-sensitive fixtures. Record bounded labels, stages, counts, geometry, and error events; never run `next build`, add Playwright to dependencies, or disturb port 30141.

## Implementation Summary

**Plan section:** `Design / Implementation Strategy` items 1–8; `Test Strategy` isolated helper and initial-markup coverage; Validation Contract VC-001 through VC-007 (implementation portion).

**Work and outcome:** Replaced Mermaid's source-first Boolean with explicit Preview/Source selection that defaults completed blocks to Preview and derives forced Source only while streaming. The single destination action now uses shared pure semantics, explicit accessible naming, native disabled behavior during streaming, and a visible focus outline. Preserved the renderer queue, strict configuration, cancellation, diagnostics, natural sizing, theme/Transcript render key, failure Preview, and overflow behavior. Added stable completed-text identity from assistant timestamp plus original content index while retaining session/entry/index identity for thinking and other non-text blocks. `ChatWindow` now carries full-message indices through process/final-answer folding so both that transition and late entry-ID reconciliation retain the mounted text/Mermaid block. Deferred thinking receives the actual original entry content index.

**Validation / evidence:** Focused Node run passed 20/20 across `components/MarkdownBody.test.mjs`, `lib/mermaid-display.test.mjs`, and `lib/message-display.test.mjs`. Added assertions for completed/streaming/multiple Mermaid markup, explicit mode semantics, stable/different text identities, non-text isolation, missing-timestamp fallback, split original indices, render-key behavior, and rejection-safe queueing. `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit` and `git diff --check` passed. Browser, full-suite, lint, independent review, and final validation remain pending.

**Departures from approved obligations:** None. The plan's historical dependency note says Mermaid `^11.14.0`; implementation uses the already-installed `^11.15.0` without changing dependencies.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** `Test Strategy`, `Telemetry / Debuggability`, and Validation Contract VC-001 through VC-006 plus VC-009 browser evidence.

**Work and outcome:** Ran privacy-safe Chromium validation against production Mermaid/MessageView components and the public AppShell/ChatWindow/useAgentSession surface on isolated port 30142 with an isolated HOME and synthetic SDK session. A temporary component route exercised streaming, completion, independent blocks, absent-to-present entry identity, final-answer folding, outside rerenders, theme/Transcript changes, and genuine timestamp replacement; it was removed before review. A second public-session pass replaced only the browser's agent EventSource and intercepted synthetic API responses, proving the real `message_end` → automatic Preview → explicit Source → `agent_end` folding/session reload/entry-ID reconciliation path without a provider. Automatic history validation covered four initially mounted diagrams in valid/invalid/valid/valid order, control use while the queue was active, failure recovery, outside click/touch/hover/focus/scroll/minimap/sidebar/panel interactions, keyboard activation, visible focus, theme/Transcript regeneration, natural sizing, horizontal overflow, lazy history beyond the 50-item window, reload, and session revisit.

**Validation / evidence:** `/Users/xin/Documents/repos/pi-web/.agents/worktrees/.runtime/2026-07-22-mermaid-preview-mode/report.json` records every component/history assertion true, three valid initial SVGs, one bounded error Preview, lazy valid rendering, five bounded stage kinds, and zero page/console errors. `/Users/xin/Documents/repos/pi-web/.agents/worktrees/.runtime/2026-07-22-mermaid-preview-mode/live-report.json` records the public session transition, Source stability through folding and late entry ID with no Preview flash, own-action restoration, reload default, and zero page/console errors. Privacy-safe visual artifacts are `artifacts/component-lifecycle.png`, `artifacts/historical-session-chat.png`, and `artifacts/live-reconciliation-chat.png` under that runtime directory; source/path/sidebar-bearing debug captures were deleted. Browser validation exposed React's existing shorthand/non-shorthand style warning when a Mermaid Source block changed theme; the source renderer now strips imported Prism pre-background keys and applies one stable custom `backgroundColor`, preserving appearance while eliminating the warning. Port 30142 was stopped after both passes; the unrelated port-30141 process remained untouched.

**Departures from approved obligations:** None. No production telemetry was added; bounded existing Mermaid stage/error attributes were the only diagnostics inspected. No real provider, credential, private session, or production fixture surface was used. Temporary validation source was removed.

**Implementation commit:** Pending.

## Handoff

**Source:** Pi Subagents reviewer run `0489ea60-a75c-43d1-a697-a9f55ceff5ff`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-22-mermaid-preview-mode--/2026-07-28T19-40-49-377Z_019faa3e-7b61-741c-954b-7b62e5d71332/39189e8c/run-0/session.jsonl`; raw output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/0489ea60-a75c-43d1-a697-a9f55ceff5ff/output-0.log`.

**Purpose:** Independent final diff review for correctness, lifecycle identity, deferred-thinking isolation, Prism normalization, test truthfulness, and accessibility.

**Outcome:** Found one P0 gap: a completed Mermaid text block before a tool call moves from the live unsplit message into a newly mounted, initially collapsed `ProcessDetailsGroup` after `agent_end`; a stable React key cannot preserve local state across different parents. The reviewer otherwise found mode semantics, accessible labels/focus, original-index mapping, non-text entry isolation, and Prism normalization correct. It also correctly noted that static/helper tests alone cannot attest interactive lifecycle behavior.

**Evidence:** The gap spans `hooks/useAgentSession.ts` `message_end`/`agent_end` ordering and `components/ChatWindow.tsx` live-tail bypass versus settled process folding. The review's failure scenario was reproduced conceptually and then covered in the real public-session browser harness with a completed assistant shaped as process Mermaid text, tool call, and final Mermaid text.

**Uncertainty / gaps:** The reviewer intentionally inspected only the tracked diff and did not inspect the already-recorded runtime browser reports, so its statement that browser validation was absent applied to the tracked test suite rather than the parent validation record. Timestamp-less legacy assistant messages retain the documented entry-key fallback.

**Recommended use:** Lift only Mermaid view selection into mounted `ChatWindow` state, keyed by completed text identity plus content-free Markdown node position, while leaving SVG/render state local. Verify both final-answer retention and process-parent migration in the actual AppShell/ChatWindow/useAgentSession path.

## Implementation Summary

**Plan section:** `Design / Implementation Strategy` items 2–5 and 9; `Test Strategy` exact reconciliation/multiple-block coverage; Validation Contract VC-002, VC-003, VC-004, and VC-006.

**Work and outcome:** Resolved the independent-review blocker by adding a mounted-session Mermaid selection map owned by `ChatWindow`. Completed assistant text still uses timestamp plus full-message block index; each Mermaid fence adds its Markdown AST start offset (or line/column fallback), so duplicate fences remain independent without putting source, SVG, session ID, or paths into identities. `MarkdownBody` keeps SVG, error, queue, and render freshness local, but uses the mounted-session controller for Preview/Source choice when supplied. This preserves Source/Preview even when process text unmounts into collapsed Process details and remounts under a different parent. Reload and session revisit still create a new `ChatWindow` and default Preview. Non-assistant Markdown remains locally controlled, and thinking/tool identity is unchanged.

**Validation / evidence:** Added pure tests for content-free stable Mermaid fence state keys. Focused component/helper tests pass 21/21 and TypeScript/diff checks pass. The public-session fake-SSE validation was strengthened to stream one assistant message containing process Mermaid text, a tool call, and final Mermaid text; it selected Source on both before `agent_end`, supplied the late entry IDs, confirmed the final block remained Source with no Preview flash, expanded the newly reparented Process details and confirmed the process block remained Source with no Preview flash, returned both through their own actions, then reloaded and confirmed both defaulted to Preview. `/Users/xin/Documents/repos/pi-web/.agents/worktrees/.runtime/2026-07-22-mermaid-preview-mode/live-report.json` records every assertion true with zero page or console errors; `artifacts/live-reconciliation-chat.png` is the privacy-safe visual artifact.

**Departures from approved obligations:** None. The mounted-session selection owner is the smallest necessary correction for a lifecycle boundary omitted from the initial key-only implementation; it adds no persistence, telemetry, API, or content-bearing key.

**Implementation commit:** Pending.

## Handoff

**Source:** Pi Subagents reviewer run `f8beff11-a7ba-4fa9-9c6c-82a1eb296392`; recoverable session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-22-mermaid-preview-mode--/2026-07-28T19-40-49-377Z_019faa3e-7b61-741c-954b-7b62e5d71332/d8f33e29/run-0/session.jsonl`; raw output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/f8beff11-a7ba-4fa9-9c6c-82a1eb296392/output-0.log`.

**Purpose:** Independently verify the process-parent blocker fix and distinguish remaining source defects from tracked-test or runtime-evidence limitations.

**Outcome:** Confirmed the P0 blocker is resolved: mounted `ChatWindow` selection state, original block indices, completed text identity, and Markdown-position fence identity preserve both final and process choices. Found no remaining blocker. The reviewer raised a P1 hypothetical cross-session collision and a P2 lack of a tracked mounted-ChatWindow test.

**Evidence:** Source review confirmed the selection owner in `ChatWindow`, original-index propagation through process/final splitting, and controlled Mermaid state in `MarkdownBody`. The reviewer accepted `live-report.json` evidence for process-parent migration, late entry IDs, no preview flash, own-action restoration, reload defaults, and zero browser errors.

**Uncertainty / gaps:** The P1 hypothetical does not apply to supported navigation: `AppShell` increments `sessionKey` for session selection, new sessions, forks, deletion fallback, and relevant reloads, so `ChatWindow` and its selection map remount; the final post-fix historical browser report also proves session revisit restores Preview. Timestamp collision inside one mounted session remains the low residual risk explicitly accepted by the approved timestamp design. The P2 test-framework gap is real but is covered by reproducible external Playwright evidence because the repository intentionally has no tracked DOM runner or Playwright dependency.

**Recommended use:** Treat the independent review as clean after the P0 fix. Preserve the existing `AppShell` remount boundary and runtime browser artifacts; do not add a test framework or session IDs to content-free identities merely to address non-reproducing hypotheticals.

## Implementation Summary

**Plan section:** Entire approved plan; mandatory final implementation and Validation Contract summary.

**Work and outcome:** Completed stable Preview-first Mermaid behavior. Streaming blocks remain source-only with an unavailable Preview action; every mounted completed block automatically renders Preview. Only the block's destination action changes its selection. Mounted-session selection survives ordinary UI interactions, theme/Transcript rerenders, late entry IDs, final-answer folding, and process-text migration into collapsed details; reload/session revisit restore default Preview. Invalid diagrams remain bounded error Preview. Each fence is independent. Existing strict security, serialized queueing, cancellation guards, bounded diagnostics, natural SVG sizing, horizontal overflow, Copy behavior, and deferred-thinking isolation remain in place. Prism pre-background normalization removes the React theme-switch warning without changing the intended code background. No server API, renderer replacement, persistence, content telemetry, dependency, wiki, or durable-memory change was added.

**Validation / evidence:** VC-001 through VC-009 passed. Final tracked regression is 94 Node tests passed, `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit` passed, `npm run lint` passed, and `git diff --check` passed; `next build` was never run. `final-history-report.json` proves the final post-fix multi-diagram historical workload, error recovery, independent controls, outside click/touch/hover/focus/scroll/minimap/sidebar/panel stability, keyboard/focus behavior, theme/Transcript regeneration, geometry/overflow, lazy history, reload, revisit, and zero browser errors. `live-report.json` proves the public AppShell/ChatWindow/useAgentSession streaming-to-completion path, process and final Source selections before `agent_end`, final folding, process-parent migration, late entry IDs, zero Preview flashes, own-action restoration, reload defaults, and zero browser errors. Privacy-safe visual artifacts are `artifacts/component-lifecycle.png`, `artifacts/historical-session-chat.png`, and `artifacts/live-reconciliation-chat.png` under `/Users/xin/Documents/repos/pi-web/.agents/worktrees/.runtime/2026-07-22-mermaid-preview-mode/`. Independent review found and drove the process-parent fix; the follow-up reviewer confirmed the blocker resolved and no remaining blocker. Synthetic session state, IDs, logs, and source/path-bearing debug captures were removed; port 30142 was stopped and unrelated port 30141 remained untouched. Guarded closeout preflight captured task head `6573cb1c2e4d3ca8120f13d9acadcb0249e865cf` and main head `d008d7f7e0b85aedd14af215b1a98821ae47853b`, with no ongoing main Git operation and a clean task checkout, but stopped before any main write because the separate dirty `2026-07-21-clone-session` worktree overlaps `components/ChatWindow.tsx`, local main has unrelated tracked/untracked plan edits, and no main-branch lock helper exists.

**Departures from approved obligations:** No approved implementation or Validation Contract obligation is incomplete. Telemetry/debuggability, configuration, docs/current-state, wiki, and durable memory work are not applicable for this deterministic local presentation change, as approved. The local mirror permits timestamp-less legacy assistants; those retain entry-based fallback identity, while the authoritative runtime path validated here supplies the approved numeric timestamp. The lack of a tracked DOM runner is covered by reproducible external Playwright scrutiny without adding an unapproved dependency. Local-main integration is blocked at unsafe preflight, not waived: no merge was attempted and no `Closeout Recovery` entry is permitted for a preflight-only stop. The task branch/worktree remain preserved and clean; the safe retry point is after the clone-session writer finishes and main is rechecked, using a normal guarded merge because main has advanced.

**Implementation commit:** `8558c9f8a02736f8bf99fdd5288fa9bfc5a560ff` (`feat: make Mermaid previews stable by default`).
