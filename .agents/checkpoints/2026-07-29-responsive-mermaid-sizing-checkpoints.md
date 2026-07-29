# Responsive Mermaid Preview Sizing — Checkpoints

Plan: `.agents/plans/2026-07-29-responsive-mermaid-sizing.md`
Worktree: `/Users/xin/Documents/repos/pi-web/.agents/worktrees/2026-07-29-responsive-mermaid-sizing`
Branch: `2026-07-29-responsive-mermaid-sizing`
Base: `431cc1a528e600a5b0fcf44e70ab09a521e42e6b`

## Handoff

**Source:** Pi Subagents scout run `5450ae2a-9358-48fc-b383-8caf48f2241b`; recoverable child session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-responsive-mermaid-sizing--/2026-07-29T19-49-19-672Z_019faf6c-a0b8-74df-aa40-2a61cdbab7df/f1c28174/run-0/session.jsonl`; runtime output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/5450ae2a-9358-48fc-b383-8caf48f2241b/output-0.log`.

**Purpose:** Independently map the current Mermaid sizing code, immutable lifecycle/security contracts, focused tests, and realistic privacy-safe browser validation before implementation.

**Outcome:** Confirmed a narrow implementation boundary: derive a shrink-only policy from the root viewBox, finalize each detached returned SVG immediately before `setSvg`, remove only the visible-DOM layout effect/ref and conflicting CSS maximum, and leave queueing, strict rendering, cancellation, render keys, diagnostics, mode ownership, and completion folding unchanged. Node has no DOM surface, so pure viewBox/policy coverage should remain in Node while actual transformation, integrity, idempotence, geometry, and first-insertion behavior are proven in Chromium without adding a dependency. No evidence requires caching, folding changes, a dependency, or another product decision.

**Evidence:** The raw publication and post-mount mutation boundaries are in `components/MarkdownBody.tsx`; the conflicting selector is in `app/globals.css`; `lib/mermaid-display.ts` is the existing pure-helper/queue boundary; SSR tests cannot run effects or Mermaid. `ChatWindow` owns Preview/Source selection while `useAgentSession` can remount local SVG state between `message_end` and `agent_end`, so every generated instance must be finalized. Global Playwright and cached Chromium are available, and the prior Mermaid checkpoint documents an isolated-port, synthetic-session/fake-SSE validation pattern. The installed lock resolves Mermaid 11.16.0 under the unchanged `^11.15.0` manifest.

**Uncertainty / gaps:** Browser evidence remains required for representative renderer geometry, parser/serialization preservation, missing-viewBox fallback, anonymous insertion/mutation traces, equal settlement viewBoxes, preference regeneration, reload, and invalid-diagram behavior. Prior runtime reports were not present and are precedent only, not current evidence.

**Recommended use:** Keep production edits to the approved helper/component/CSS surfaces, test malformed and decimal viewBoxes at the pure boundary, then use a removable validation route plus the real public chat lifecycle on an isolated port. Stop rather than broaden scope if identical inputs produce different settlement viewBoxes or any replacement still enters with non-final sizing.

## Implementation Summary

**Plan section:** `Design / Implementation Strategy` items 1–8; `Test Strategy` focused helper and browser/public-surface coverage; Validation Contract VC-001 through VC-006 implementation and browser portions.

**Work and outcome:** Added a pure, strict four-number viewBox sizing policy and a browser-only detached-template SVG finalizer. Valid positive viewBox geometry now receives root `width="100%"`, inline `width: 100%`, natural pixel `max-width`, and `height: auto` before `setSvg`; missing, malformed, zero, negative, or non-finite geometry returns Mermaid’s original string unchanged. The finalizer changes only root sizing declarations, is idempotent, and preserves unrelated attributes, inline styles, accessibility metadata, descendants, and identifiers. Removed the visible-DOM `useLayoutEffect`, preview ref, fixed natural-width/data mutation, and CSS `max-width: none`; retained block display, panel padding/background/overflow, renderer ownership, strict configuration, dynamic import, serialized queue, cancellation, diagnostics, mode ownership, and render-key behavior. Added pure integer/decimal/exponent and malformed/fallback policy tests without a DOM dependency.

**Validation / evidence:** Focused Node coverage passes 14/14 and TypeScript plus `git diff --check` pass at this boundary. Privacy-safe Chromium validation used a temporary route that was removed, an isolated HOME and port 30143, globally installed Playwright, and only synthetic fixtures. `component-report.json` records small natural width 204.5 in 874 content pixels, an oversized 957.03125 diagram shrinking to 294 pixels and later capping at about 957 pixels in 1074 content pixels, preserved aspect ratios, flowchart/sequence/class/pie compatibility, exact fallback overflow, finalizer integrity/idempotence, Source-to-Preview, theme, non-default Transcript size, streaming completion, remount, invalid Preview/Source, 42 anonymous SVG insertions (37 valid responsive, 5 fallback), zero post-insertion sizing mutations, and zero browser errors/warnings. `live-report.json` records the real AppShell/ChatWindow/useAgentSession fake-SSE path: history Preview, streaming Source-only, two responsive `message_end` previews, Source-to-Preview replacement, `agent_end` final folding, process-parent remount after expansion, late entry IDs, reload/history defaults, equal process/final viewBoxes across settlement, 26 valid live and 3 valid reload insertions, zero post-insertion sizing mutations, and zero browser errors/warnings. Reports and privacy-safe screenshots are retained under `/Users/xin/Documents/repos/pi-web/.agents/worktrees/.runtime/2026-07-29-responsive-mermaid-sizing/`; temporary route, synthetic source/session scripts, logs, IDs, payloads, and port listener were removed. Full-suite, lint, final diff review, independent review, commit, and closeout remain pending.

**Departures from approved obligations:** None. Browser CSSOM canonicalizes some long decimal style values for serialization, but the pure policy supplies the unrounded numeric value and measured geometry remains within subpixel tolerance of the viewBox maximum; no application rounding was added. The existing manifest and dependency tree remain unchanged.

**Implementation commit:** Pending.

## Handoff

**Source:** Pi Subagents reviewer run `ec656a26-8aab-4089-86ce-870231fc75d7`; recoverable child session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-responsive-mermaid-sizing--/2026-07-29T19-49-19-672Z_019faf6c-a0b8-74df-aa40-2a61cdbab7df/161933c8/run-0/session.jsonl`; runtime output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/ec656a26-8aab-4089-86ce-870231fc75d7/output-0.log`.

**Purpose:** Independently review source correctness, malformed fallback, detached transformation integrity, first-insertion behavior, geometry evidence, lifecycle/security preservation, scope adherence, and validation truthfulness.

**Outcome:** Found one P1 completion blocker: the pure parser used JavaScript `\s`, which accepts vertical tab and non-breaking space beyond SVG’s allowed space/tab/CR/LF comma-whitespace; malformed viewBoxes could therefore receive invented responsive sizing instead of preserving Mermaid output. The parent fixed this by defining the exact SVG whitespace class in leading/trailing and separator grammar and adding valid tab/CR/LF plus invalid vertical-tab/non-breaking-space regression cases. All other reviewed surfaces were clean: pre-publication finalization, detached/idempotent narrow mutation, geometry and lifecycle reports, queue/config/cancellation/diagnostics/render keys, CSS fallback, scope, dependencies, and required checks.

**Evidence:** The blocker was at `lib/mermaid-display.ts` viewBox grammar and absent from malformed cases in `lib/mermaid-display.test.mjs`; direct reviewer probes reproduced both over-accepted forms. The fix now uses `[ \t\r\n]` explicitly and focused tests pass 14/14 with the new cases; TypeScript, lint, and diff checks also pass. The reviewer independently confirmed the retained reports’ natural/shrunk geometry, renderer samples, equal replacement viewBoxes, finalized anonymous insertion counts, and zero post-insertion sizing rewrites.

**Uncertainty / gaps:** The disposable browser harness is intentionally not retained, so browser reports preserve summarized evidence rather than a replay script; this is an evidence-provenance limitation, not a source defect. Fresh follow-up review of the parser fix and final full regression remain pending.

**Recommended use:** Require a fresh read-only follow-up to confirm exact SVG whitespace and fallback behavior, then rerun the full suite. Do not commit `.pi-subagents/` runtime material.

## Handoff

**Source:** Pi Subagents reviewer run `ae206d75-2917-43e4-8ee9-9c4090169dd1`; recoverable child session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-29-responsive-mermaid-sizing--/2026-07-29T19-49-19-672Z_019faf6c-a0b8-74df-aa40-2a61cdbab7df/665ea80d/run-0/session.jsonl`; runtime output `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/ae206d75-2917-43e4-8ee9-9c4090169dd1/output-0.log`.

**Purpose:** Fresh read-only validation of the exact SVG-whitespace parser fix, original-string fallback, focused tests, and absence of new scope or correctness regressions.

**Outcome:** Confirmed the prior blocker resolved and found no remaining blocker. The anchored grammar permits only space, tab, CR, and LF; independent probes accepted all four and rejected vertical tab, non-breaking space, ten other non-SVG whitespace characters, malformed separators, missing values, trailing values, and extra commas. Invalid geometry still returns `null`, so finalization returns the exact original SVG string before serialization or mutation.

**Evidence:** `lib/mermaid-display.ts` now uses the explicit `[ \t\r\n]` class throughout the four-number grammar; `lib/mermaid-display.test.mjs` covers valid mixed SVG whitespace and the two reproduced invalid separators. The reviewer reconfirmed pre-publication finalization, later visible insertion, defensive overflow, narrow four-file implementation scope, focused 14/14, full 137/137, TypeScript, lint, and diff checks.

**Uncertainty / gaps:** No source blocker remains. Actual transformation stays browser-validated rather than Node-transformed because the approved plan forbids adding a DOM dependency solely for test shape.

**Recommended use:** Proceed to final regression, implementation commit, mandatory final summary, and guarded closeout.

## Implementation Summary

**Plan section:** `Test Strategy`, `Validation Contract` VC-004 through VC-006, and final independent-review remediation.

**Work and outcome:** Tightened viewBox parsing after independent review so only SVG-defined whitespace (space, tab, carriage return, and line feed) is accepted around the four numbers and commas. Vertical tab, non-breaking space, and all other JavaScript-only whitespace now preserve Mermaid’s original output rather than receiving responsive sizing. Added focused valid mixed-whitespace and reproduced invalid-separator regressions. Fresh independent review confirmed the blocker resolved and found no remaining issue. No other production behavior or scope changed.

**Validation / evidence:** Final tracked regression passes 137/137 Node tests, `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check`. Focused coverage remains 14/14. Browser reports remain applicable because the tightening leaves all valid Mermaid viewBoxes used in the synthetic renderer/lifecycle fixtures unchanged; direct Node probes and tests cover the newly rejected malformed separators. Final status contains only the four approved implementation/test files plus this matching checkpoint; no dependency, temporary validation route, `.next`, `.pi-subagents`, synthetic source/session script, server log, or runtime listener remains in the checkout.

**Departures from approved obligations:** None. The browser reports intentionally retain summarized privacy-safe evidence and screenshots rather than content-bearing replay scripts, as required by the plan’s privacy constraints.

**Implementation commit:** Pending.
