# Open Agent-Returned File Paths in the Viewer — Checkpoints

Plan: `.agents/plans/2026-08-05-agent-response-file-links.md`

## Handoff

**Source:** Pi subagents parallel read-only scout run `09d8d934-a9b9-4b04-bfa9-027334c15cc8`; recoverable run session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-05-agent-response-file-links--/2026-08-06T04-15-27-419Z_019fd548-84bb-7703-8191-aa6adf6d955a/db00376c/run-1/session.jsonl`. Roles: Markdown/parser reconnaissance, AppShell/responsive reconnaissance, and file API/type-safety reconnaissance. All children were instructed not to edit or delegate; transient child output copies were removed from the tracked task checkout after synthesis.

**Purpose:** Map the approved plan onto the current assistant Markdown, shared file-open, responsive viewer, file-type, authorization, API, and test seams before source edits.

**Outcome:** The three investigations agree on the implementation boundaries. Assistant-only recognition must opt in at `MessageView`'s assistant `TextBlock`; authored-link behavior must remain on the existing broader resolver; a local remark AST transform plus a narrowly sanitized marker is the appropriate no-dependency parsing seam. `AppShell.handleOpenFile` is the common committed-open boundary for Explorer, authored Markdown, nested viewer links, and confirmed automatic actions; expansion provenance needs a pure state model and a separate reactive `max-width: 999px` signal. `lib/file-types.ts` should own the shared explicit source/text filename policy and language classification, while the route must keep the 256 KiB stat bound and additionally reject post-read oversize, NUL, and fatal UTF-8 decode failures.

**Evidence:** Direct source ranges and test harnesses were identified in `components/MarkdownBody.tsx`, `components/MessageView.tsx`, `components/AppShell.tsx`, `components/FileViewer.tsx`, `lib/file-links.ts`, `lib/file-types.ts`, `lib/markdown.ts`, `hooks/useIsMobile.ts`, `app/globals.css`, and `app/api/files/[...path]/route.ts`. Root independently read those files. Baseline focused tests passed `25/25` with `NODE_ENV=test node --experimental-strip-types --test lib/file-links.test.mjs lib/file-types.test.mjs components/MarkdownBody.test.mjs components/FileViewer.test.mjs`; `/Users/xin/Documents/repos/pi-web/node_modules/.bin/tsc --noEmit` passed. The project memory index exists and contains no prior file-link topic.

**Uncertainty / gaps:** The static Markdown harness cannot prove click/focus/Escape behavior, and there is no existing AppShell component harness. Pure parsing/layout-state tests plus focused component/source checks are needed, followed by browser validation at the approved breakpoints. Existing route authorization is lexical and broader than the new automatic-action workspace boundary; the plan deliberately preserves that existing authorization behavior.

**Recommended use:** Implement in serial milestones with the parent as sole writer: first shared classification, bounded text decoding, strict automatic-path parsing, and assistant-only AST rendering; then responsive expansion provenance and AppShell-owned confirmation; then focused/static/browser validation and fresh independent review.

## Implementation Summary

**Plan section:** `Design / Implementation Strategy` — assistant-only Markdown AST recognition, exact-workspace resolution, shared source/text eligibility, settled-only actions, and authoritative bounded text decoding.

**Work and outcome:** Extracted the route's language map into `lib/file-types.ts`, added an explicit automatic source/text filename policy, and added bounded fatal UTF-8/NUL validation while preserving existing media/document dispatch and authored-link authorization. Added a linear local prose scanner plus strict automatic resolver for POSIX, Windows, UNC, relative, absolute, quoted, bare-name, punctuation, and line-suffix forms. A local remark transform visits text and whole inline-code nodes only, skips links/fenced code, emits one narrowly sanitized generated marker with a sanitizer-safe synthetic href, and is enabled only for settled assistant text. `MarkdownBody` renders generated nodes as semantic inline buttons while preserving authored anchor and modifier-click behavior.

**Validation / evidence:** Focused parser, classifier, Markdown, Explorer-Markdown, viewer, and interaction suites pass. Coverage includes exact workspace/worktree containment, sibling-prefix/traversal rejection, external/host URL rejection, unsupported binary/media names, unknown and arbitrary extensionless names, quoted versus unquoted whitespace, line suffixes, Windows/UNC sanitizer survival, authored links/anchors/queries/modifiers, fenced and inline code, assistant-role and streaming scope, exact 256 KiB/one-byte-over boundaries, valid/invalid UTF-8, NUL, visible viewer errors, a 2,000-token stress case, and zero recognition-time fetches. Typecheck, lint, and `git diff --check` pass at this boundary.

**Departures from approved obligations:** None. Browser-level interaction and final independent review remain pending validation obligations, not implementation departures.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** `Design / Implementation Strategy` — AppShell-owned narrow confirmation and automatic/manual responsive viewer expansion provenance.

**Work and outcome:** Added a reactive `<1000px` viewport signal and a pure expansion state model that distinguishes manual expansion, automatic narrow expansion, and narrow restore suppression. Every committed `AppShell.handleOpenFile` call now applies shared narrow presentation, so Explorer, authored Markdown, nested viewer links, and confirmed agent paths converge. Automatic agent actions below 1000px create one session/cwd-bound pending request instead of opening; the accessible confirmation moves focus, traps Tab, handles Escape, backdrop, Cancel, and Open file, and cleans its listener. AppShell restores trigger focus when practical and revalidates exact session/cwd before confirmation. Crossing breakpoints, mobile-to-tablet rotation, manual persistence, suppression reset on the next open, and final-tab clearing use pure tested transitions.

**Validation / evidence:** `lib/file-viewer-layout.test.mjs` covers 1000/999/641/640/phone widths, direct-versus-confirm policy, immediate responsive derivation, automatic/manual provenance, narrow restore suppression, reopen, mobile-to-tablet continuity, final close, and exact pending identity. Mounted component coverage exercises dialog focus, Tab, Escape, backdrop, Cancel, confirm, listener cleanup, generated action dispatch, and authored modifier clicks. Source integration checks prove the one committed-open boundary and assistant-only opt-in. The focused six-suite run passes `55/55`; typecheck, lint, and `git diff --check` pass.

**Departures from approved obligations:** None. Real-browser breakpoint/layout validation remains pending.

**Implementation commit:** Pending.

## Handoff

**Source:** Fresh parallel read-only reviewer run `55c65ab9-b8c0-4824-b1bc-9e565e25db21`; three reviewer outputs under `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/55c65ab9-b8c0-4824-b1bc-9e565e25db21/`; recoverable run session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-08-05-agent-response-file-links--/2026-08-06T04-15-27-419Z_019fd548-84bb-7703-8191-aa6adf6d955a/cebbeedd/run-0/session.jsonl`. Angles: parser/API/security, responsive/accessibility, and tests/maintainability. All reviewers were no-edit/no-delegation.

**Purpose:** Independently inspect the complete implementation against VC-001 through VC-009 before final validation and commit.

**Outcome:** No reviewer found a blocker in the core architecture, but they identified six fixes worth doing now. Unquoted whitespace paths could link a slash-bearing suffix; unmatched smart quotes caused superlinear scanning; the route could allocate an oversized raced file before rejecting it; a hidden mobile panel could become expanded after rotation; successful confirmation removed focus without moving it into the viewer; and handled Escape could continue to the global running-agent abort shortcut. One reviewer also found a stale automatic-state window where an immediate desktop Expand click could be misclassified. The parent accepted all findings. The parent had already completed the previously missing real-browser matrix after the reviewer snapshots: Firefox headless passed 1000/999/641/640/375 widths, agent/authored/Explorer origins, Enter and Space, focus restoration, responsive provenance, and native touch-pointer delivery to the guarded dialog.

**Evidence:** Reviewers reproduced `docs/My Folder/file.ts` yielding a partial action, measured unmatched-quote growth up to roughly 290 ms at 16,000 delimiters, traced unrestricted `readFileSync` after `stat`, and produced the hidden-panel and stale-toggle pure-state cases. They traced Escape from `AutomaticFileOpenConfirmation` to the window-level shortcut and confirmed post-confirm focus had no destination. Root's route probe independently returned 200 at exactly 262144 bytes, 413 one byte over, and 415 for NUL/invalid UTF-8. Root's Firefox BiDi matrix returned a sanitized pass record for all contract breakpoints and origins; a touch-enabled Firefox profile delivered `pointerdown/touchstart/pointerup/touchend/mousedown/mouseup/click` to the generated action and produced the confirmation.

**Uncertainty / gaps:** The accepted fixes require focused reruns and a fresh follow-up review because the first reviewers inspected a moving uncommitted diff and predated the final boundedness/focus corrections. Dense scrolling and live streaming are covered by component/state behavior rather than a model-backed browser run; automatic actions remain intentionally absent during streaming.

**Recommended use:** Apply the seven bounded fixes with the parent as sole writer, remove transient `.pi-subagents` copies, rerun focused/full/static/route/browser evidence as affected, then obtain a fresh final review before commit and closeout.

## Handoff

**Source:** Fresh parallel read-only reviewer run `b9f12d6d-a217-45a0-b81a-1d67d1c6dbb8`; recoverable results under `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/b9f12d6d-a217-45a0-b81a-1d67d1c6dbb8/` and child sessions under parent run directory `d3c83014`. Angles: parser/API/security, responsive/accessibility, and validation-contract completeness. All reviewers were no-edit/no-delegation.

**Purpose:** Re-review the seven corrections from the first reviewer pass against the stabilized implementation.

**Outcome:** Responsive/accessibility review was clean apart from optional preference for a non-destructive focus target instead of the active tab's Close button. Parser/security review found that `.env.*` and `Dockerfile.*` special cases could disguise configured media/document extensions, and validation review found that whitespace-path suppression persisted through unrelated slash prose. The parent accepted both blockers, rejected the focus preference as optional because the named Close control is a practical in-viewer target, and corrected classification and scanner recovery.

**Evidence:** Reviewers reproduced automatic eligibility for `.env.png`, `.env.mp3`, `Dockerfile.pdf`, and `Dockerfile.docx`, and reproduced zero matches for `Compare input/output behavior in components/AppShell.tsx.` Focused suites, typecheck, lint, and diff checks otherwise passed. Root added classifier/resolver tests and parser/component recovery fixtures.

**Uncertainty / gaps:** The first scanner correction used a token-count heuristic, and the media correction initially covered configured renderer types rather than arbitrary obvious binary suffixes. Those limitations were intentionally sent to another focused review rather than treated as final.

**Recommended use:** Keep special-name policy fail-closed and replace token-count recovery with an explicit lexical boundary policy before closeout.

## Handoff

**Source:** Fresh focused parallel read-only reviewer run `6c181cfd-d350-447a-b88d-f27c3c4e06b9`; recoverable results under `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/6c181cfd-d350-447a-b88d-f27c3c4e06b9/` and child sessions under parent run directory `70507d23`. Both reviewers were no-edit/no-delegation.

**Purpose:** Verify decorated-name exclusion and the first scanner-recovery correction against adversarial sibling cases.

**Outcome:** The configured media/document matrix was clean, but the scanner reviewer showed that fixed token counts still linked a suffix of a longer whitespace path and missed a later path after a shorter unrelated phrase. Parent accepted the scanner blocker and replaced token counts with indefinite suppression relieved only by explicit punctuation or lowercase prose connectors. Parent also proactively replaced the configured-media-only check with broader binary handling after steering about `.env.zip` and `Dockerfile.exe`; that steering arrived after the classifier review's original clean response, so the clean result was treated as narrow rather than final.

**Evidence:** The scanner reviewer reproduced `Folder/file.ts` from a longer unquoted path and no action after `input/output then`; scaling remained approximately linear. Root added arbitrary-length whitespace-path, `in`, `then`, and component-rendering regressions.

**Uncertainty / gaps:** A deny-list for special-name binary suffixes remained inherently incomplete, and suppressed eligible-looking tokens still reset the scanner state. Both were exposed by the next final review.

**Recommended use:** Prefer a positive special-name allow-list and preserve suppression across eligible-looking suffix tokens until a real boundary.

## Handoff

**Source:** Fresh read-only final reviewer run `3739af60-cc56-4cce-aa43-e9e980c30605`; recoverable result `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/3739af60-cc56-4cce-aa43-e9e980c30605/output-0.log`; session under parent run directory `91934762`. The reviewer was no-edit/no-delegation.

**Purpose:** Challenge the revised classifier and scanner across recognition, generated-action revalidation, and stress behavior.

**Outcome:** The reviewer found omitted executable/archive suffixes such as `.env.com` and `Dockerfile.msi`, plus premature suppression clearing after one eligible-looking suffix. Parent accepted both findings, replaced the special-name deny-list with a positive allow-list for established variant labels, preserved ordinary supported text extensions regardless of basename, and kept unresolved whitespace suppression across any number of candidate-looking tokens until an explicit boundary.

**Evidence:** Reviewer probes confirmed the requested `.env.zip`, `.env.sqlite`, `Dockerfile.exe`, and `Dockerfile.wasm` exclusions but exposed sibling omissions and `Open docs/My folder.ts components/AppShell.tsx` linking the later token. Root added both recognition/revalidation and multi-candidate suppression fixtures.

**Uncertainty / gaps:** The subagent runtime rejected a requested resume with an invalid recovery descriptor (`launchContractDigest`), so closure verification used a new fresh reviewer instead of reviving this session.

**Recommended use:** Validate the positive allow-list and shared boundary predicate directly, and disposition any disagreement against the approved any-supported-source-file rule.

## Handoff

**Source:** Fresh read-only closure reviewer run `d8697139-8107-4276-97e0-bf1f9c45ff82`; recoverable result `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-runs/d8697139-8107-4276-97e0-bf1f9c45ff82/output-0.log`; session under parent run directory `38861d05`. The reviewer was no-edit/no-delegation.

**Purpose:** Verify the two preceding blocker fixes and identify concrete sibling bypasses before commit.

**Outcome:** The reviewer confirmed the requested special-name exclusions, arbitrary-length suppression, explicit `in`/`then` recovery, and linear scaling. It found one real gap: suppression boundaries used fewer punctuation characters than the tokenizer trims. Parent accepted and fixed this with one shared trailing-punctuation predicate plus colon, closing-delimiter, quote, and ellipsis tests. The reviewer also called `.env.production.ts` and `Dockerfile.custom.ts` bypasses; parent rejected that characterization because `.ts` is an explicitly supported source extension, the route treats it as bounded text, and the approved objective says any supported source/text filename is eligible regardless of basename. Positive tests now preserve that contract while unknown suffixes still fail the special-variant allow-list.

**Evidence:** The reviewer measured approximately linear path-heavy and suppression scans, confirmed exact recognition/revalidation exclusions, and reproduced missing `:`, `)`, `]`, `}`, and `…` boundaries. Root's post-fix focused run passed `33/33`; final affected six-suite run passed `59/59`; typecheck, quiet lint, and `git diff --check` passed; the full repository run passed `706/706` including the real Next lifecycle suite.

**Uncertainty / gaps:** Lexical natural-language disambiguation is intentionally conservative and cannot infer every path containing an unquoted connector word; quoted or whole-inline-code paths remain the unambiguous form. This is consistent with the approved preference for false negatives and no unquoted whitespace support.

**Recommended use:** Treat all concrete reviewer findings as dispositioned. Preserve supported source-extension eligibility, explicit special-name variants, and the shared punctuation/connector scanner boundary.

## Implementation Summary

**Plan section:** `Design / Implementation Strategy`, `Test Strategy`, and VC-001 through VC-009 — final reviewer corrections and end-to-end validation.

**Work and outcome:** Completed assistant-only settled path actions, exact-workspace resolution, conservative filename classification, bounded strict text reads, AppShell-owned narrow confirmation, and responsive expansion provenance. Final review corrections now use a positive allow-list for otherwise-unknown `.env.*`/`Dockerfile.*` variants, retain any ordinary supported text/source extension, suppress arbitrary-length unquoted whitespace-path suffixes until explicit shared punctuation/connectors, and keep all generated-action paths revalidated before opening. Main advanced from `08f49cf` to `a0e45d1` during implementation while no repository mutex helper existed, so the task also adds `.agents/scripts/main-branch-lock.sh` as mandatory closeout serialization infrastructure; it has no product runtime path.

**Validation / evidence:** Focused affected suites pass `59/59`; the full repository suite passes `706/706`; `node_modules/.bin/tsc --noEmit`, `npm run lint -- --quiet`, and `git diff --check` pass. The live API probe returns 200 at 262144 bytes, 413 one byte over, and 415 for NUL or malformed UTF-8. Firefox BiDi validation passed 1000/999/641/640 widths, direct/guarded activation, authored and Explorer origins, focus restoration and transfer, Escape isolation, closed-panel rotation, responsive expansion provenance, and native touch events. The representative-phone and streaming/dense cases remain covered by the earlier browser matrix plus settled-only component/state tests. The previously referenced `lib/package-entrypoint-smoke.test.mjs` does not exist in this repository or Git history; all 58 present `.test.mjs` files were included in the `706/706` run. The mutex helper passes `sh -n` and reports the main-root lock path as unlocked before use.

**Departures from approved obligations:** None from the product plan. The operational mutex helper was added because global closeout policy requires serialization when racing is possible and main demonstrably advanced during this task. The classifier review suggestion to reject supported `.ts` files based only on an unusual basename was intentionally not adopted because it contradicts the approved any-supported-source-file rule; unknown special-name suffixes remain inert. The optional focus-target preference was not adopted because browser evidence confirms focus enters a clearly named control inside the opened viewer.

**Implementation commit:** Pending.
