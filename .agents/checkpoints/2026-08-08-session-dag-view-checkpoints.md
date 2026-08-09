# Session DAG View Checkpoints

Plan: `.agents/plans/2026-08-08-session-dag-view.md`

## Handoff

**Source:** `call_uNwHB6cU47ginbyNgQU48GKG|fc_0d9d7cf7b900091a016a7818002ff08195959eac19afc848dc`, read-only `backend-seams`, `ui-seams`, and `domain-tests` children. Recoverable aggregate: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-results/call_uNwHB6cU47ginbyNgQU48GKG|fc_0d9d7cf7b900091a016a7818002ff08195959eac19afc848dc.json`; child session artifacts are listed there.

**Purpose:** Map the existing backend, UI, accessibility, persistence, notification, and test seams before implementing the approved session DAG.

**Outcome:** All three investigations found no blocker or user-owned ambiguity. They independently recommended a pure DAG module, a separate locked store, a force-dynamic route, extraction of the HMR-stable session-list notifier, one AppShell-owned permanent DAG/file tab union, a mounted-after-first-use DAG panel, and DAG-specific validated SVG DOM post-processing rather than `dangerouslySetInnerHTML`. The domain review sharpened receipt-before-revision ordering, logical-edge counting across active/redo mirrors, durable edge ordinals, strict current-listing checks even for unchanged replace requests, redo-resident terminal form hints, and deterministic deleted-form fallback. Those findings were adopted.

**Evidence:** The backend child cited `lib/session-reader.ts:48-124`, `lib/sidebar-state-store.ts:29-315`, `app/api/sidebar-state/route.ts:1-120`, `app/api/sessions/[id]/route.ts:168-190`, and `lib/rpc-manager.ts:2371-2414`. The UI child cited `components/AppShell.tsx:161-185,375-463,1206-1309`, `components/TabBar.tsx:1-103`, `components/SessionSidebar.tsx:2146-2470`, `components/MarkdownBody.tsx:220-359`, and responsive CSS. The domain child supplied adversarial invariants for chains, joins, sinks, cycles, Undo/Redo, receipts, unavailable sessions, and count bounds. Parent inspection verified every load-bearing seam directly before editing.

**Uncertainty / gaps:** Browser focus, responsive layout, SVG interaction, clipboard permissions, two-client conflict behavior, and DOM identity still require product-level validation because the repository has no committed browser interaction harness. The reviewer proposed a normalized canonical edge catalog; the implementation instead uses exact active/redo mirror validation plus unique logical-edge counting, which preserves the same invariant while retaining the approved batch shape.

**Recommended use:** Use the findings as the implementation and review checklist. In particular, keep session metadata refresh separate from DAG refresh, never reconcile unavailable IDs, validate add/replace against a generation-current complete listing under the lock, and fail closed on any unexpected SVG root or node alias.

## Implementation Summary

**Plan section:** Graph and completion semantics; Persistence and concurrency; rename-notification requirement under Labels, Mermaid, and explicit node controls.

**Work and outcome:** Added the strict pure graph model/compiler in `lib/session-dag.ts`, the private locked atomic store in `lib/session-dag-store.ts`, the injectable no-store route implementation in `lib/session-dag-route.ts`, `app/api/session-dag/route.ts`, and the lightweight HMR-stable `lib/session-list-refresh.ts`. Implemented exact-ID add/replace/delete, global duplicate rejection, cycles and disconnected components, terminal zero-edge completion batches, unavailable-session durability, stable edge ordinals, deterministic form hints/fallback, linear Undo/Redo, redo branching, compare-and-set targets, canonical mutation receipts, revision/sequence safety, private bounds, and generation-current listing validation for add/replace only. HTTP and live RPC rename now publish `sessions_changed` without importing or starting an `AgentSession` from the route.

**Validation / evidence:** `NODE_ENV=test node --test lib/session-dag*.test.mjs lib/session-list-refresh.test.mjs lib/session-route.test.mjs lib/global-status-channel.test.mjs lib/rpc-manager.test.mjs` passed 196/196 tests. `node_modules/.bin/tsc --noEmit --pretty false` passed. New tests cover strict parsing, chains/branches/joins/sinks/cycles, terminal Undo, deleted-form fallback, exact retry, stale and concurrent writers, receipt bounds, lock/permission/atomic behavior, malformed/oversized refusal, unavailable completion, route generation races, privacy-safe diagnostics, and rename publication. A pre-edit focused baseline also showed 49 passes and 12 pre-existing `React.act` failures caused by the inherited `NODE_ENV=production`; this environment issue is separate from the DAG changes and will be rechecked under the required validation command and a test environment.

**Departures from approved obligations:** None. The backend milestone does not yet claim the UI, browser evidence, maintained docs, final required-command suite, or closeout obligations; those remain pending.

**Implementation commit:** Pending.

## Handoff

**Source:** `call_FIEYH78eROlJxO2J6VQmu30f|fc_0d9d7cf7b900091a016a78282207ec8195876d024bed68f4ec`, fresh read-only final UI/accessibility/security reviewer. Recoverable aggregate: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-results/call_FIEYH78eROlJxO2J6VQmu30f|fc_0d9d7cf7b900091a016a78282207ec8195876d024bed68f4ec.json`.

**Purpose:** Adversarially review the first complete UI implementation against the approved trust, accessibility, responsive, state-preservation, and concurrency obligations.

**Outcome:** The reviewer found one blocker and four additional fix-worthy defects: Mermaid `<style>` could affect the surrounding document and escaped CSS could bypass the initial regex; hidden DAG panels still rendered and could fail `getBBox()`; a PATCH invalidating an in-flight GET could strand loading; responsive expansion could hide the focused control; and file close buttons added tab stops inside the roving tablist. All five were reproduced or verified in the parent and fixed with a ShadowRoot plus CSSOM/root scoping and escape rejection, active-tab Preview gating, mutation-owned loading cleanup, selected-tab focus recovery, and Delete-key file closure with non-tabbable close actions.

**Evidence:** The reviewer cited the then-current `lib/session-dag-svg.ts`, `components/SessionDagPreview.tsx`, `components/SessionDagPanel.tsx`, `components/AppShell.tsx`, `components/TabBar.tsx`, and responsive CSS; it also ran 49 focused tests, 814 full tests under `NODE_ENV=test`, typecheck, lint, and `git diff --check`. Parent browser and focused-test probes verified every disposition. The inherited shell has `NODE_ENV=production`, which explains the reviewer's separate React `act` failures without a test-environment override.

**Uncertainty / gaps:** CSSOM validation and a ShadowRoot closed the document-global boundary but did not yet prove compatibility with real dark Mermaid CSS or prevent scoped Mermaid selectors from matching controls inserted later; those questions were intentionally sent to the next review.

**Recommended use:** Retain the active-tab, loading-authority, focus, and roving-tab fixes. Treat the SVG boundary as unresolved until real light/dark output and late-inserted controls are adversarially checked.

## Handoff

**Source:** `call_VXQEJpkf1gBG9YO7OePoZnIW|fc_0d9d7cf7b900091a016a782c4bd144819586b98799bff7bb99`, parallel fresh read-only `svg-security` and `ui-concurrency` reviewers. Recoverable aggregate: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-results/call_VXQEJpkf1gBG9YO7OePoZnIW|fc_0d9d7cf7b900091a016a782c4bd144819586b98799bff7bb99.json`.

**Purpose:** Recheck the first reviewer-driven fixes, especially the SVG/CSS trust boundary, real light/dark Mermaid compatibility, hidden rendering, focus, loading, tab behavior, and GET/PATCH ordering.

**Outcome:** The UI/concurrency reviewer verified the earlier functional fixes and found one low stale-feedback issue: successful graph/session refreshes did not clear their own old load errors. The SVG reviewer found two blockers: legitimate dark Mermaid uses five current-render local-gradient `url(...)` declarations that the validator rejected, and otherwise scoped Mermaid CSS could still select trusted controls inserted into the graph SVG. The parent added source-tagged refresh feedback, a narrow current-render `linearGradient` allowance usable only by `fill`/`stroke`, and a separately named trusted sibling control-layer SVG inside the same ShadowRoot so graph CSS cannot select controls.

**Evidence:** The SVG reviewer used Chrome 152 against installed Mermaid 11.15.0 and demonstrated both the five safe dark rules and a scoped `g[role="button"]` rule that hid a late control. It also verified escaped external CSS and global/sibling selectors were rejected. The UI reviewer passed 816/816 tests, typecheck, lint, and diff checks and verified the earlier fixes in source. Parent follow-up CDP evidence at `.agents/runtime/session-dag-final-browser/browser-validation.json` shows five accepted dark gradient rules, separate sibling SVG roots, aligned visible pointer/keyboard controls, exact completion/Undo/Redo transitions, source-specific Refresh recovery, same-ShadowRoot hide/reopen, and full-width 500-pixel focus recovery.

**Uncertainty / gaps:** No platform screen reader was run. The trusted overlay adds a second post-validation SVG root to the mounted ShadowRoot, while Mermaid input is still required to contain exactly one validated graph root; reviewers must judge the resulting accessibility grouping rather than infer it from source alone.

**Recommended use:** Preserve the narrow paint-server allowance and sibling-layer isolation. Final review should look specifically for selector escape routes, external fetch capability, overlay alignment/interaction, and stale-feedback cross-clearing.

## Implementation Summary

**Plan section:** Right-panel UI and structured authoring; Labels, Mermaid, and explicit node controls; Copy behavior, privacy, and maintained docs.

**Work and outcome:** Added the permanent DAG/file tab union and accessible roving tablist; lazy, retained DAG panel; Preview/Raw/direction/history toolbar; structured forms, edge editing, node controls, and serialized conflict-aware mutation queue; responsive panel/focus transitions; shared sidebar and Raw copy actions; hardened clipboard behavior; current-label refresh notifications; strict theme-aware Mermaid compilation; fail-closed XML/CSS/SVG validation; and a trusted accessible completion overlay isolated from Mermaid styling. Closing the last file now falls back to DAG without resetting expansion. Maintained `AGENTS.md` documents persistence ownership, semantics, non-enforcement, and permanent-tab behavior.

**Validation / evidence:** Focused graph, route, store, SVG, clipboard, notifier, tab, layout, and source-contract tests pass. The isolated CDP report `.agents/reports/2026-08-08-session-dag-browser-validation.md` covers lazy activation, file fallback, draft/DOM preservation, structured authoring, pointer/keyboard completion, Undo/Redo, two-client conflict, unavailable sessions, copy failure, rename, hostile SVG rejection, light/dark rendering, refresh recovery, and responsive focus/layout. The latest machine-readable ignored artifact is `.agents/runtime/session-dag-final-browser/browser-validation.json`.

**Departures from approved obligations:** None. Final independent review, final required-command reruns after any accepted fixes, memory distillation, implementation commit, mandatory final summary, and guarded closeout remain pending.

**Implementation commit:** Pending.

## Handoff

**Source:** `call_2FN5bByOe0UiP1EbF2li79mF|fc_0d9d7cf7b900091a016a7830df6de08195afedc6b9969ecf15`, parallel fresh read-only `svg-security-followup` and `ui-state-followup` reviewers. Recoverable aggregate: `/var/folders/_j/ttksft5934g0fj8z6l4rg6_w0000gn/T/pi-subagents-uid-501/async-subagent-results/call_2FN5bByOe0UiP1EbF2li79mF|fc_0d9d7cf7b900091a016a7830df6de08195afedc6b9969ecf15.json`.

**Purpose:** Independently verify the final SVG isolation, dark-theme compatibility, accessibility/interaction evidence, source-specific refresh recovery, concurrency, history, missing-session, permanent-tab, responsive-focus, and privacy contracts.

**Outcome:** Both reviewers reported no blocker or functional/security defect worth fixing. The SVG reviewer confirmed the exact current-render `linearGradient` and `fill`/`stroke` restriction, root-scoped CSS rejection, sibling control-layer isolation, light/dark alignment and interaction, bounded failure behavior, and privacy-safe diagnostics. Its only low finding was stale prose saying controls were graph descendants; the parent had already changed both the source comment and tracked browser report to describe the sibling layer. The UI/state reviewer found the refresh fix sound and the overall implementation clean, including serialized GET/PATCH authority, exact history, permanent lazy/retained DAG behavior, unavailable-session durability, and privacy boundaries.

**Evidence:** Final reviewers passed 52 focused tests, 817/817 full tests with `NODE_ENV=test`, typecheck, lint, and `git diff --check`; they inspected `.agents/runtime/session-dag-final-browser/browser-validation.json` and its light/dark/mobile screenshots. The unqualified test command reproduced only the inherited `NODE_ENV=production` React `act` environment failure. Reviewer output explicitly warned that `.pi-subagents/` contains raw untracked orchestration artifacts and must not enter the implementation commit.

**Uncertainty / gaps:** No platform screen reader was run. Full hostile-stylesheet injection through the complete sanitizer was covered by prior Chrome probes plus focused predicates rather than repeated in the final product run; the final product run directly exercised legitimate dark-gradient output.

**Recommended use:** Treat the review loop as clean after retaining the prose correction. Remove `.pi-subagents/`, rerun affected/final gates, inspect the final diff, and proceed to commit and guarded closeout.
