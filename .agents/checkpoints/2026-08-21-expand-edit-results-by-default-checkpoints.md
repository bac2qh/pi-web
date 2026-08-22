# Expand Edit Results by Default Checkpoints

Plan: `.agents/plans/2026-08-21-expand-edit-results-by-default.md`

## Handoff

**Source:** Fresh read-only scout workflow `c821c861-f339-427b-b227-1108ed9cabdb`; disclosure child `0df76b53`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/c821c861-f339-427b-b227-1108ed9cabdb/status.json`; raw child output: `.pi-subagents/artifacts/0df76b53_scout_0_output.md`.

**Purpose:** Trace the exact edit-card and completed-turn disclosure owners, the shared recognition seam, and the repository's focused React test patterns before implementation.

**Outcome:** Confirmed two independent mounted disclosure states must change: `ToolCallBlock` owns each inner card, while `ProcessDetailsGroup` owns settled-turn process content. Recommended moving the existing name policy unchanged into `lib/message-display.ts`, classifying only the exact grouped blocks, preserving local state after initialization, and using the existing Jiti plus minimal synthetic-DOM harness for interaction coverage.

**Evidence:** The scout cited the result pairing and card state in `components/MessageView.tsx`, settled-turn partitioning and grouping in `components/ChatWindow.tsx`, pure helpers in `lib/message-display.ts`, and the production-compatible `flushSync` harness in `components/ExtensionWidgets.test.mjs`. Parent verification confirmed the same seams and passed the pre-change focused baseline: `node --test lib/patch.test.mjs lib/message-display.test.mjs components/MarkdownBody.test.mjs` (24/24).

**Uncertainty / gaps:** Synthetic DOM cannot validate responsive wrapping, theme contrast, computed overflow, or visible browser focus. Closing the outer group remounts inner cards when it is reopened; this remains the established mounted-state behavior and does not justify persistence.

**Recommended use:** Share the exact existing recognition policy, derive the outer default only from blocks rendered in that process group, and retain real-browser validation for the visual and responsive obligations.

## Handoff

**Source:** Fresh read-only scout workflow `c821c861-f339-427b-b227-1108ed9cabdb`; patch/render child `48e5d0ad`. Recoverable workflow status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/c821c861-f339-427b-b227-1108ed9cabdb/status.json`; raw child output: `.pi-subagents/artifacts/48e5d0ad_scout_0_output.md`.

**Purpose:** Investigate a truthful unified patch model, exact three-line context trimming, safe bounded syntax/intra-line decoration, theme/language reuse, and structural validation requirements.

**Outcome:** Confirmed the existing split model invents positional counterparts and should be replaced by explicit files, hunks, and ordered factual rows. Recommended strict hunk-range validation; hunk-local context-window union with actual omission counts; a separate conservative, bounded intra-line decorator; `getFileLanguage()` plus the existing Prism themes; React text-node rendering only; and plaintext fallback for malformed, unsupported, or oversized decoration inputs.

**Evidence:** The scout traced the split pairing and missing count validation in `lib/patch.ts`, the excluded fixed-height split renderer in `components/MessageView.tsx`, the analogous three-context-line algorithm in `components/FileViewer.tsx`, Prism/theme use in `components/MarkdownBody.tsx`, language selection in `lib/file-types.ts`, and semantic code-card/focus precedents in `app/globals.css`. Parent inspection of the installed Pi edit tool additionally confirmed `details.patch` is generated as a standard unified patch with four context lines and is preferred over `details.diff`.

**Uncertainty / gaps:** Prism line mapping and actual visual quality still require implementation proof and browser observation. Quoted Git paths should remain safely literal unless decoding is proven; unsupported language identifiers must fall back rather than guess.

**Recommended use:** Make the parser model authoritative before replacing the renderer; never infer hidden lines between separate source hunks; prove rendered text equivalence and bounded fallback structurally, then assess polish, wrapping, contrast, and focus in light/dark browsers at narrow and wide widths.

## Handoff

**Source:** Fresh read-only adversarial review workflow `1f956147-7371-49eb-95ab-f7c246c82046`; correctness child `0bb96238`; UX/accessibility child `3db0af85`. Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/1f956147-7371-49eb-95ab-f7c246c82046/status.json`.

**Purpose:** Independently review the first complete implementation against parser truthfulness, disclosure lifecycle, performance bounds, accessibility, responsive visual behavior, and VC-001 through VC-006 before acceptance.

**Outcome:** Both reviewers blocked acceptance. They independently identified patch-wide performance gaps: syntax limits were hunk-local and collapsed bodies retained expensive trees. The correctness review additionally found false positional intra-line pairing for edited reorders and an unrelated-tool preview regression. The UX review found synthetic syntax state caused by discarded context and mixed old/new code, dangling/indistinguishable disclosure ARIA, and unsafe numeric hunk coordinates; it noted that the focused Process-group unit seams were not a substitute for the recorded real-browser integration. The parent accepted and fixed every code finding: one-to-one-only intra-line emphasis, aggregate structured/syntax budgets, conditional result children under persistent controlled shells, edit-only structured previews, separate full-hunk old/new syntax projections, descriptive accessible names, safe integer/range validation, and stricter unknown-metadata fallback.

**Evidence:** Reviewers reproduced false edited-reorder emphasis and large many-hunk HTML work, cited exact source/test ranges, and inspected the first browser report/screenshots. Parent regression tests now cover edited reorder, surrogate-safe emphasis, unsafe coordinates, unknown trailing payload, many-small-hunk fallback, collapsed child release, unrelated-tool preview stability, persistent ARIA targets, and multiline syntax state across omitted context. The corrected browser rerun reports zero runtime issues and passes light/dark desktop/mobile interaction and overflow checks.

**Uncertainty / gaps:** The reviewers could not invoke the checkout-local `node_modules/.bin/tsc`; the parent uses the repository-prescribed ancestor binary and must record its final result. The Process-details wiring remains proven by the disposable full browser session rather than a heavily mocked `ChatWindow` unit. A fresh post-fix review is still required because the syntax-projection correction materially changed rendering internals.

**Recommended use:** Treat the first review as a failed gate whose concrete classes now have regression coverage; run a focused fresh post-fix review plus the complete final validation contract before implementation summary or closeout.

## Handoff

**Source:** Fresh post-fix review workflow `5ee1f9c3-c82c-4af4-807d-5014dbcc51c4`; correctness child `b20fe677`; UX/validation child `32761a49`. Recoverable status: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/5ee1f9c3-c82c-4af4-807d-5014dbcc51c4/status.json`.

**Purpose:** Reassess the hardened implementation against VC-001 through VC-006, with special attention to prior truthfulness, performance, disclosure-lifecycle, syntax-state, and browser-evidence failures.

**Outcome:** UX/validation found the disclosure, bounded renderer, full-width responsive presentation, keyboard/focus behavior, and refreshed browser evidence ready. Correctness confirmed every prior defect except metadata truthfulness: prefix-matched metadata could still be discarded in invalid positions, and a second `diff --git` preamble without file headers could attach a hunk to the prior file. The parent replaced the permissive metadata filter with a strict pending-file state machine, required completed header pairs before hunks, added exact syntax checks, and added adversarial fallback coverage.

**Evidence:** The reviewers cited the corrected one-to-one intra-line ranges, separate full old/new projections, aggregate work budgets, released collapsed children, and preserved non-edit preview. Parent focused tests after the state-machine fix passed 31/31, while TypeScript, lint, and `git diff --check` also passed.

**Uncertainty / gaps:** The first metadata state-machine fix proved the original probes but had not yet established semantic consistency among accepted metadata values.

**Recommended use:** Keep the UX review as acceptance evidence, but do not close VC-006 until a targeted adversarial follow-up validates metadata values and relationships.

## Handoff

**Source:** Targeted resumed correctness review `75d3a942`, continuing `b20fe677`. Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-21-expand-edit-results-by-default--/2026-08-22T05-32-44-982Z_01a027f5-0836-7ded-98f5-fb25281a687b/b20fe677/run-0/session.jsonl`.

**Purpose:** Verify that the first strict metadata state machine closed the reviewer's dangling-prefix and wrong-file defect class without regressing supported patch forms.

**Outcome:** The original dangling, malformed-prefix, and second-file attachment cases were fixed, and covered patch forms still parsed. The reviewer found a remaining VC-006 blocker: accepted `Index:` paths were not compared with headers, conflicting new/deleted modes could coexist, and unpaired rename metadata could be omitted. The parent retained metadata values, enforced Index/header identity, mutually exclusive and paired modes, creation/deletion/modification hash consistency, and safe fallback for unsupported rename/copy/similarity metadata.

**Evidence:** New parser tests cover matching stateful metadata plus contradictory Index paths, conflicting and unpaired modes, unsupported rename metadata, zero-hash contradictions, dangling preambles, and missing second-file headers. Focused tests passed 32/32 after the second fix; TypeScript, lint, and whitespace validation passed.

**Uncertainty / gaps:** The second correction required a final narrow verification of the exact metadata-relationship cases.

**Recommended use:** Require one final resumed adversarial pass before treating VC-006 as closed.

## Handoff

**Source:** Final targeted resumed correctness review `7630dbb6`, continuing `75d3a942` / `b20fe677`. Recoverable session: `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-21-expand-edit-results-by-default--/2026-08-22T05-32-44-982Z_01a027f5-0836-7ded-98f5-fb25281a687b/b20fe677/run-0/session.jsonl`.

**Purpose:** Re-run the prior metadata probes and nearby valid/invalid relationship cases against the final parser state.

**Outcome:** Blocker none; ready. Contradictory Index paths, conflicting modes, partial rename metadata, dangling metadata, hash/header contradictions, and missing second-file headers all fell back intact. Valid Git mode/index, matching Index, plain unified, and fully headed multi-file patches remained structured. No concrete regression was found.

**Evidence:** The reviewer cited retained/validated Index paths, exclusive and paired mode enforcement, zero-hash consistency, and rejection of unsupported rename/copy/similarity forms in `lib/patch.ts`, plus the new metadata relationship tests in `lib/patch.test.mjs`. Parent browser validation was then refreshed from the final source and again passed interaction, theme, width, wrapping, overflow, and runtime-issue checks.

**Uncertainty / gaps:** None within the approved structured-patch grammar. Unsupported metadata intentionally takes the truthful plaintext fallback.

**Recommended use:** Treat the metadata truthfulness blocker as closed and proceed to final parent validation and scoped diff review.

## Implementation Summary

**Plan section:** Design / Implementation Strategy; Test Strategy; Validation Contract VC-001 through VC-007.

**Work and outcome:** Centralized edit-tool recognition, made recognized edit cards and their completed-turn Process details groups independently open by default, and replaced the split/fixed-height patch surface with a full-width unified review card. The final parser retains factual old/new rows, trims to exactly three adjacent context lines with counted omissions, validates hunk and file metadata strictly, adds only one-to-one conservative intra-line ranges, and falls back intact for unsafe, unsupported, malformed, or over-budget input. The renderer adds bounded separate old/new syntax projections, natural soft-wrapped height, theme-aware hierarchy, complete disclosure semantics, and preserved non-edit defaults/previews. Maintained architecture, memory, tests, and browser evidence were updated.

**Validation / evidence:** Focused component/parser/display tests pass 32/32 with `NODE_ENV=test`; the explicit broad suite excluding only the unrelated nested-worktree real-Next artifact harness passes 933/933; `../../../node_modules/.bin/tsc --noEmit`, `npm run lint`, and `git diff --check` pass. Final Chrome evidence on the task source passes light/dark desktop `1440x1000` and mobile `390x844` checks with zero runtime issues, visible keyboard focus, working Enter/Space and nested disclosures, two structured edit cards, the non-edit card collapsed, no horizontal overflow or nested patch scrollbar, and soft-wrapped long lines. Four screenshots and measurements are retained under `.agents/reports/2026-08-21-expand-edit-results-by-default/`. Fresh and resumed adversarial reviews closed all reported blockers.

**Departures from approved obligations:** None. The plan-required focused/static/browser checks all passed, and no Next build was run. An exploratory default `node --test` invocation was not used as acceptance evidence because Node also discovered `app/api/models-config/test/route.ts` and the nested checkout lacks the local production-artifact layout required by `lib/pi-web-real-next.test.mjs`; the explicit 933-test run removed those environment-only/non-test inputs and passed.

**Implementation commit:** Pending.
