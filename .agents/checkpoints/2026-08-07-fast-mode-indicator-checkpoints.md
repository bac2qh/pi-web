# Fast Mode Indicator Checkpoints

Plan: `.agents/plans/2026-08-07-fast-mode-indicator.md`

## Handoff

**Source:** Scout run `eea1c67f` (server adapter reconnaissance); raw output `.pi-subagents/artifacts/eea1c67f_scout_0_output.md`, transcript `.pi-subagents/artifacts/eea1c67f_scout_0_transcript.jsonl`.

**Purpose:** Identify the smallest shipped Pi runner/type, wrapper lifecycle, provenance, status-projection, and test seams for the authenticated `@benvargas/pi-openai-fast@1.1.0` adapter.

**Outcome:** Confirmed the public structural seams `getRegisteredCommands()`, `getCommand()`, and `createCommandContext()`; duplicate invocation-name behavior; canonical slash parsing; wrapper-owned refresh/state placement; binding/model/reload/Fast-command trigger points; local notification capture; reserved-key isolation; and reusable regression fixtures. The implementation followed these recommendations, including immutable runner/model snapshots and stale completion rejection.

**Evidence:** The handoff cites shipped declarations and runtime implementation plus `lib/rpc-manager.ts` and `lib/rpc-manager.test.mjs`. Decisive claims were rechecked in the parent against the retained dependency and installed extension source.

**Uncertainty / gaps:** The scout did not have the installed extension's four exact status strings in its scoped repository read and flagged symlink/non-file manifest behavior as a residual seam. The parent verified the strings directly from the installed `1.1.0` source and implemented bounded fail-closed manifest/status handling. The run metadata reports a completed output but a missing structured acceptance report.

**Recommended use:** Use as implementation context, not final validation; rely on the focused tests and final parent/reviewer checks for acceptance.

## Handoff

**Source:** Scout run `f4bcb60a` (browser transport/UI reconnaissance); raw output `.pi-subagents/artifacts/f4bcb60a_scout_0_output.md`, transcript `.pi-subagents/artifacts/f4bcb60a_scout_0_transcript.jsonl`.

**Purpose:** Map strict host-status splitting across HTTP and projected state and the model-selector badge's responsive, disabled, no-model, and accessibility behavior.

**Outcome:** Identified the shared pure splitter, every hook ingress, `ChatWindow` prop seam, selector-anchor condition, shrink ownership, four-state presentation, and existing mounted/SSR test harnesses. The implementation uses one client-safe reserved-key splitter, keeps generic statuses unchanged, and anchors the non-interactive badge after the truncating model name.

**Evidence:** The handoff cites `lib/session-protocol.ts`, `lib/session-view-projection.ts`, `hooks/useAgentSession.ts`, `components/ChatWindow.tsx`, `components/ChatInput.tsx`, and their tests. Parent inspection and focused rendering/transport tests verified the decisive seams.

**Uncertainty / gaps:** Minimal-DOM and static-markup tests prove structure and styles rather than browser pixel geometry. Actual geometry remains a bounded manual-layout residual, while mobile width, disabled retention, truncation ownership, labels, and accessible wording are asserted. The run metadata reports a completed output but a missing structured acceptance report.

**Recommended use:** Retain the pure split and selector ownership boundaries; do not move the badge into generic extension-status UI.

## Handoff

**Source:** Reviewer run `e085587b` (first browser/transport review); raw output `.pi-subagents/artifacts/e085587b_reviewer_0_output.md`, transcript `.pi-subagents/artifacts/e085587b_reviewer_0_transcript.jsonl`.

**Purpose:** Adversarially review HTTP/projected/reconnect/session-switch behavior, badge rendering, accessibility, and browser test coverage against the approved plan.

**Outcome:** Found a release-blocking model/status ordering race: a newly displayed model could temporarily inherit the prior model's `effective` state. Also found that the native-drift test did not genuinely emit `agent_settled`, required durable documentation was missing, and responsive coverage was structural. The parent added synchronous fail-closed model-transition state, a projection watermark, corrected native settlement coverage, and `AGENTS.md` documentation; later reviews refined the concurrency fix further.

**Evidence:** Findings cite the then-current `hooks/useAgentSession.ts`, `lib/rpc-manager.ts`, `lib/rpc-manager.test.mjs`, and `AGENTS.md` diff. The final implementation no longer uses the reviewed lower-bound model/status acceptance.

**Uncertainty / gaps:** The reviewer did not run the required suites. Its pixel-layout residual remains, but no correctness blocker from that residual was established.

**Recommended use:** Treat the reported ordering class as a regression class; keep the badge unknown until model and Fast authority converge.

## Handoff

**Source:** Reviewer run `2328bf88` (first server/correctness review); raw output `.pi-subagents/artifacts/2328bf88_reviewer_0_output.md`, transcript `.pi-subagents/artifacts/2328bf88_reviewer_0_transcript.jsonl`.

**Purpose:** Review provenance authentication, adapter lifecycle/coalescing, stale-runner handling, and false-positive priority claims.

**Outcome:** Independently found the same model/status ordering blocker and a fail-open classification gap after a previously authenticated runner's command lookup became ambiguous. It confirmed exact parser/model binding, stale completion rejection, canonical command identity checks, and host-key authority. The parent retained prior package identification as `unknown` on same-runner lookup failure and added model-transition guards and regressions.

**Evidence:** The output cites the then-current adapter and hook paths and compares them to the installed package source. `git diff --check` passed in the child; full validation was deferred to the parent.

**Uncertainty / gaps:** Same-ID wrapper replacement and actual browser geometry were noted as residual coverage questions. Reload runner replacement and reconnect/wrapper epoch behavior now have focused authority coverage, while pixel geometry remains manual.

**Recommended use:** Preserve the distinction between package absence and an identified-but-broken contract; never clear an authenticated package to no badge merely because later lookup is ambiguous.

## Handoff

**Source:** Reviewer run `9d03e698` (follow-up concurrency review); raw output `.pi-subagents/artifacts/9d03e698_reviewer_0_output.md`, transcript `.pi-subagents/artifacts/9d03e698_reviewer_0_transcript.jsonl`.

**Purpose:** Re-review fixes for browser ordering, command lookup ambiguity, native settlement coverage, and documentation, and search for new watermark defects.

**Outcome:** Verified the lookup, settlement, and documentation fixes, but found a release-blocking server race: concurrent `set_model` requests could complete out of order and leave an older model authoritative. The parent added wrapper-level model-mutation serialization/coalescing, browser intent serialization/generation guards, and focused out-of-order server/browser tests.

**Evidence:** The output cites `lib/rpc-manager.ts`, `hooks/useAgentSession.ts`, corrected tests, and `AGENTS.md`. Its fallback `NODE_PATH` test attempt was not authoritative because it loaded an incompatible React test surface; the parent later ran the required command successfully with the retained checkout's installed binaries.

**Uncertainty / gaps:** The reviewer correctly noted its test-environment limitation and that prior overlap tests did not delay native `setModel`; the final server regression now deliberately blocks the first mutation.

**Recommended use:** Keep one wrapper-owned mutation queue as the server authority; browser-only generations cannot repair out-of-order native model mutation.

## Handoff

**Source:** Reviewer run `1431617f` (post-serialization authority review); raw output `.pi-subagents/artifacts/1431617f_reviewer_0_output.md`, transcript `.pi-subagents/artifacts/1431617f_reviewer_0_transcript.jsonl`.

**Purpose:** Verify server/browser queues and the projection watermark against same-target, A→B→A, failed response, reconnect, stale watermark, and concurrent-caller sequences.

**Outcome:** Confirmed server serialization and local overlap handling, then found the remaining release blocker: accepting `snapshot.cursor >= response.cursor` allowed a delayed model-A response to consume model B's later `effective` projection. The parent changed local completion to exact epoch/cursor equality, added exact-watermarked `get_state` model/status reconciliation for advanced projections, kept the badge unknown during that repair, and added regressions for a delayed A response, a pure independent model transition, and reconnect epoch replacement.

**Evidence:** The blocker cites the old lower-bound check and independent model/status application in `hooks/useAgentSession.ts`. The final focused tests reproduce the concrete delayed-A/later-B sequence and assert atomic authoritative recovery.

**Uncertainty / gaps:** Failed HTTP responses or unavailable exact reconciliation can leave `Fast unknown`; that is the intentional fail-closed outcome. The reviewer did not execute full validation.

**Recommended use:** Never weaken exact watermark equality. When projection has advanced, obtain a fresh exact-watermarked runtime response and apply its model and Fast status together.

## Implementation Summary

**Plan section:** Section 1 — Authenticated server adapter.

**Work and outcome:** Added the minimal structural runner/command surface, bounded nearest-manifest package authentication for exact `@benvargas/pi-openai-fast@1.1.0`, duplicate invocation resolution, fresh-context status probing with locally captured notification output, strict model-bound parsing, and wrapper-owned four-state adapter state. Package absence clears the host entry; identified unsupported, ambiguous, stale, or failed contracts publish `unknown`.

**Validation / evidence:** Focused provenance/parser/probe tests cover package absence and mismatch, unsupported version, duplicate names, same-runner lookup ambiguity, exact active/off/supported/unsupported/no-model shapes, missing/multiple/oversized/mismatched/wrong-type/thrown output, stale context/model, notification suppression, and no session-file write. Installed package source was read directly to confirm the exact `1.1.0` output and request-mutation semantics.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Section 2 — Lifecycle and transport convergence.

**Work and outcome:** Wired transition-only refresh after binding, canonical Fast-command settlement, serialized model mutation, settled native model drift, and both reload paths. Added stale runner/wrapper/model rejection, same-generation coalescing, host-key collision escaping, existing projected status set/clear reuse, exact `set_model` and `get_state` projection watermarks, browser intent serialization, and exact-watermarked authority repair for advanced independent/reconnect projections.

**Validation / evidence:** Server tests cover ordinary-prompt/unchanged-`get_state` no-probe behavior, model drift before reconciliation, reload replacement, stale completion, same-target coalescing, deliberately blocked out-of-order model mutations, and host status events. Mounted browser tests cover response-before-frame, overlapping local intents, a delayed model-A response after model B's later projection, a pure independent caller transition, and reconnect epoch replacement.

**Departures from approved obligations:** The approved plan specified a model key in wrapper adapter state but did not prescribe browser-visible model identity transport. Independent review showed that a cursor lower bound was insufficient across callers. The implementation stays within the approved fail-closed objective by adding exact projection watermarks to existing HTTP command/state responses and applying authoritative model/status together; it does not change the projected protocol version or expose model keys in the reserved status value.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Section 3 — Browser derivation and model-selector badge.

**Work and outcome:** Added one strict shared splitter for the reserved host entry, applied it at HTTP and projected ingestion, preserved ordinary extension statuses, and passed typed Fast state separately through `ChatWindow`. The model selector remains anchored when choices exist without a selection, keeps the model name as the shrinkable child, renders a non-interactive nonshrinking four-state text badge while disabled/streaming, omits it without the package or selector, and uses model-specific priority-tier accessible wording.

**Validation / evidence:** Splitter, static rendering, mounted mobile, HTTP seed, projected set/change/clear, reconnect, session switching, malformed value, no-model, long-name style ownership, disabled control, all four labels, and accessibility assertions pass in the focused suites.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Section 4 — Regression coverage and durable documentation.

**Work and outcome:** Added server adapter fixtures without importing or modifying the installed package; expanded protocol/projection/hook/component regressions; documented the package/version boundary, refresh cadence, reserved key, fail-closed behavior, mutation serialization, and exact authority fallback in `AGENTS.md`; and added durable topic memory.

**Validation / evidence:** Required focused command passed 232 tests after final review fixes; TypeScript passed with `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit -p tsconfig.json`; `npm run lint` passed; and `git diff --check` passed. No production build was run, as explicitly prohibited by repository instructions.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Handoff

**Source:** Reviewer run `cb8f3a2d` in workflow `call_33q7j8l49NnKs4or6c5QuPIJ|fc_00ac5e658afa1a51016a767f0cdc108193a450247863982510` (final server/correctness pass); session artifact `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-07-fast-mode-indicator--/2026-08-07T23-47-16-198Z_019fde9f-b466-7599-a14f-9f55fccce516/cb8f3a2d/run-0/session.jsonl`.

**Purpose:** Recheck provenance, lifecycle cadence, mutation ordering, status authority, bounded I/O, and plan compliance after the independent-caller watermark fix.

**Outcome:** Found a high-severity remaining window because server Fast invalidation occurred after asynchronous `inner.setModel()` work, plus a medium unbounded scan of an oversized notification before the byte cap. The parent moved invalidation before `setModel`, re-probes the actual model before propagating a mutation failure, added blocked-mutation/failure regressions, and added a constant-time code-unit length guard before regex/UTF-8 processing. The review's special-file manifest residual was also narrowed with a regular-file `lstat` check.

**Evidence:** The reviewer traced actual Pi `setModel` ordering and cited the adapter parser/capture. Parent-focused tests observe `unknown` while model selection is blocked, restoration after failure, and rejection of a one-million-character notification; the full focused suite then passed 232 tests.

**Uncertainty / gaps:** No live loaded-package/provider integration was run; fixtures and direct installed-source verification remain the intentional no-provider validation boundary. Filesystem races after `lstat` are not eliminated, but package-source metadata is trusted input and reads remain depth/size constrained.

**Recommended use:** Preserve pre-mutation invalidation and failure convergence; never move invalidation back behind asynchronous native model-selection hooks.

## Handoff

**Source:** Reviewer run `c5a911e9` in workflow `call_33q7j8l49NnKs4or6c5QuPIJ|fc_00ac5e658afa1a51016a767f0cdc108193a450247863982510` (final browser/correlation pass); session artifact `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-07-fast-mode-indicator--/2026-08-07T23-47-16-198Z_019fde9f-b466-7599-a14f-9f55fccce516/c5a911e9/run-0/session.jsonl`.

**Purpose:** Recheck local and independent model/status ordering, reconnect, session switching, no-model behavior, generic status filtering, UI wording, and test coverage.

**Outcome:** Found one medium authority gap: JSON omitted a missing runtime model and the hook's `null` override fell back to transcript state, so exact no-model authority could retain a stale displayed model. The parent changed `get_state` to transport explicit `model: null`, separated `undefined` transcript-following state from authoritative `null`, applied nullable model/status together, and added a mounted exact-watermark no-model transition regression.

**Evidence:** The reviewer supplied the concrete external no-model interleaving and confirmed the prior concurrency/reconnect coverage. The new regression starts with a selected eligible model, observes `unknown` then `unavailable`, resolves exact runtime authority with `model: null`, and asserts both no displayed model and `Fast unavailable`.

**Uncertainty / gaps:** This was fail-closed even before the fix; the defect affected selected-model wording rather than a false `Fast` claim. Final viewport geometry remains structurally rather than pixel tested.

**Recommended use:** Keep explicit nullable runtime model authority distinct from the absence of an HTTP model field or a transcript-following override.

## Handoff

**Source:** Reviewer run `c578293c-4a56-4235-a76d-d91f09d2e9cf` (final focused acceptance); raw output `.pi-subagents/artifacts/c578293c-4a56-4235-a76d-d91f09d2e9cf_reviewer_output.md`, transcript `.pi-subagents/artifacts/c578293c-4a56-4235-a76d-d91f09d2e9cf_reviewer_transcript.jsonl`.

**Purpose:** Verify the final pre-mutation invalidation/failure convergence, constant-time oversized-output guard, explicit nullable model authority, prior exact-watermark concurrency fixes, and the complete adapter/UI diff.

**Outcome:** Accepted for release with no blocker, high, medium, or other fix-worthy finding. The reviewer confirmed server invalidation before asynchronous native model-selection work, failure re-probing, bounded parser ordering, explicit `model: null`, distinct transcript-following versus authoritative-null browser state, exact watermark equality, independent/reconnect repairs, package authentication, strict status splitting, and four-state presentation.

**Evidence:** The child independently ran the focused suite successfully with inherited `NODE_ENV` removed: 232 passed, 0 failed; it also ran `git diff --check`. Its output cites the final server, hook, and regression line ranges. Parent typecheck and lint results were supplied and separately retained below.

**Uncertainty / gaps:** Intentional residuals are exact `1.1.0` compatibility only, no live provider request, structural rather than pixel layout validation, and conservative `Fast unknown` when exact reconciliation is unavailable. The child's first literal command inherited `NODE_ENV=production` and failed only because production React omits `act`; the prescribed sanitized run passed.

**Recommended use:** Accept the implementation subject to the recorded validation and intentional fail-closed residuals.
