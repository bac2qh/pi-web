# Graceful Session Teardown Checkpoints

Plan: `.agents/plans/2026-07-31-graceful-session-teardown.md`

## Handoff

**Source:** `pi-subagents` run `6c27d63c-c6a0-445b-b42b-dfcebf53f805`, fresh read-only scout; recoverable child session `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-31-graceful-session-teardown--/2026-08-05T15-32-11-683Z_019fd28d-bb23-7477-b52d-8c62d24c9aab/5d9ff8ae/run-0/session.jsonl`.

**Purpose:** Inventory every production, test, layout, and maintained-documentation surface required by the approved permanent-session-deletion removal without editing the checkout or changing Hide/Restore semantics.

**Outcome:** The scout found one destructive Route Handler export with deletion-only filesystem, session-reader, path, and wrapper imports; delete state/request/confirmation/action plumbing across all three sidebar presentations and `AppShell`; one stale unread-marker comment; metadata-row spacing sized for the removed action; and focused source-test conventions. It confirmed that generic sidebar action CSS and all sidebar-state implementation should remain unchanged. It also identified the maintained API map and parent-session note that must be corrected.

**Evidence:** The handoff cites `app/api/sessions/[id]/route.ts:1-13,196-239`, `components/SessionSidebar.tsx:69-82,337,480-490,1090-1152,1765-1788,1980-2070,2138-2568`, `components/AppShell.tsx:308-336,378-398`, `components/SessionSidebar.test.mjs:1-147`, `lib/sidebar-session-state.test.mjs:1-230`, `app/globals.css:819-854`, and `AGENTS.md:41-46,149-156,176-180`. The parent independently opened those load-bearing regions, found the additional stale `README.md:92` project-structure reference, and established a green 19-test baseline with `node --test components/SessionSidebar.test.mjs lib/sidebar-session-state.test.mjs`.

**Uncertainty / gaps:** Source inspection cannot prove the exact visual fit of the reduced row-action overlay. A desktop/focus/coarse-pointer smoke remains necessary if a usable browser surface is available; a safe HTTP smoke can independently confirm Next's method-not-allowed behavior after the export is removed.

**Recommended use:** Remove only the identified session-delete path, reduce the metadata-row action allowance from the existing three/two-button sizing to two/one-button sizing, preserve unrelated DELETE endpoints and `Set.delete()` calls, and validate the route boundary, sidebar source, Hide/Restore semantics, full suite, typecheck, lint, whitespace, and available product-level smokes.

## Implementation Summary

**Plan section:** Design / Implementation Strategy items 1 through 5 and Validation Contract VC-001 through VC-005 — permanent-deletion removal, layout correction, regressions, and maintained documentation.

**Work and outcome:** Removed the session Route Handler's `DELETE` export and every deletion-only import while preserving GET/PATCH; removed the sidebar trash action, confirmation/request state, callbacks, recursive prop plumbing, and selected-session reset/navigation callback; retained Rename, Pin, Hide, Restore, focus, touch, and unrelated worktree DELETE behavior; and reduced metadata-row overlay allowance from three/two action buttons to two/one (`54px`/`25px`). Added exact route-namespace/destructive-source regressions, strengthened shared-row absence/accessibility/layout assertions, and corrected `AGENTS.md` plus the stale README project map and user-facing note.

**Validation / evidence:** The pre-change focused baseline passed 19/19. After implementation, `node --test components/SessionSidebar.test.mjs lib/sidebar-session-state.test.mjs lib/session-route.test.mjs` passed 21/21; `../../../node_modules/.bin/tsc --noEmit` passed; `../../../node_modules/.bin/eslint .` passed with no output; and staged/unstaged `git diff --check` passed. A targeted source inventory found no session `DELETE` fetch or delete callback/state/action and confirmed the real route exports only GET/PATCH; the sole remaining `method: "DELETE"` in `SessionSidebar.tsx` is the explicitly out-of-scope worktree-removal request.

**Departures from approved obligations:** None. The checkout has no local `node_modules` entry, so the first literal `node_modules/.bin/tsc --noEmit` attempt exited 127 before running; the same repository dependency installation was then invoked through its resolved main-root path (`../../../node_modules/.bin/tsc`) and passed. No validation layer was waived.

**Implementation commit:** Pending.

## Handoff

**Source:** `pi-subagents` parallel review run `a1f0a676-4604-4c6c-9079-df2b8631f03f`; fresh read-only reviewer sessions `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-31-graceful-session-teardown--/2026-08-05T15-32-11-683Z_019fd28d-bb23-7477-b52d-8c62d24c9aab/93db57a5/run-0/session.jsonl` and `/Users/xin/.pi/agent/sessions/--Users-xin-Documents-repos-pi-web-.agents-worktrees-2026-07-31-graceful-session-teardown--/2026-08-05T15-32-11-683Z_019fd28d-bb23-7477-b52d-8c62d24c9aab/93db57a5/run-1/session.jsonl`.

**Purpose:** Independently review the implemented diff from two angles: destructive API/runtime boundary and documentation correctness; sidebar callback/state cleanup, accessibility, layout, regression quality, and scope containment.

**Outcome:** Both reviewers found no production-code blocker or fix-worthy implementation defect. They confirmed the route exposes only GET/PATCH, destructive dependencies are gone, all three sidebar presentations and `AppShell` have no deletion plumbing, Hide/Restore still uses sidebar metadata, `rpc-manager` and unrelated DELETE APIs are untouched, and the two/one-button spacing plus focus/coarse-pointer CSS remain coherent. One reviewer found a material maintained-documentation omission: `README.zh-CN.md` still advertised session deletion. The parent accepted and fixed both Chinese README references. No other review change was warranted.

**Evidence:** The reviewers cited `app/api/sessions/[id]/route.ts:1-9,111-190`, `components/SessionSidebar.tsx:1100-1141,1760-1774,1966-2050,2120-2193,2309,2379-2442`, `components/AppShell.tsx:308-379`, `app/globals.css:819-855`, `components/SessionSidebar.test.mjs:94-124`, and `lib/session-route.test.mjs:13-30`. Reviewer 0 identified stale `README.zh-CN.md:50,88`; the parent corrected the sidebar note and project map. Reviewer 1 independently obtained 21/21 focused tests and 641/641 full tests under `NODE_ENV=test`, agreeing with the parent's final valid suite run.

**Uncertainty / gaps:** Reviewer 0's first full-suite invocation inherited `NODE_ENV=production` and reported React `act` failures; reviewer 1 and the parent reproduced that environment artifact, then ran the intended test environment and passed 641/641. The reviewers did not inspect the parent's synthetic Playwright screenshots or live 405 result because those results were not yet recorded in the checkpoint; the parent directly ran and inspected those smokes. Root `plan.md`/`progress.md` paths auto-suggested to the reviewers did not exist, so both used the canonical approved plan and matching checkpoint.

**Recommended use:** Keep the Chinese documentation correction, exclude and remove `.pi-subagents` runtime artifacts, record the already-completed browser/HTTP evidence, rerun the affected final gates on the exact candidate, and proceed to commit/closeout if they remain green.

## Implementation Summary

**Plan section:** Test Strategy and Validation Contract VC-001 through VC-006 — product smoke, complete repository validation, independent review, and durable documentation.

**Work and outcome:** Exercised the changed behavior through an isolated synthetic Pi agent directory and real development server, completed independent review, corrected the review-found Chinese README omission, and recorded the durable removal decision in `.agents/memory/session-removal.md`, its index, and append-only log. Removed all generated `.next`, TypeScript, dependency-symlink, and `.pi-subagents` runtime state from the task checkout after validation.

**Validation / evidence:** A headless Chromium/Playwright smoke at desktop and coarse-pointer widths observed exactly two row-overlay actions (Rename and Hide/Restore), a measured `59px` action overlay with no blank slot, zero Delete control, focus and touch visibility, a complete Hide → Show hidden → Restore round trip, unchanged selected URL/chat, unchanged session JSONL across Hide/Restore, and no remaining explicit hidden marker. Screenshots are `/tmp/pi-web-graceful-session-teardown-desktop.png` and `/tmp/pi-web-graceful-session-teardown-touch.png`. The same isolated server returned HTTP 405 for `DELETE /api/sessions/<synthetic-missing-id>` without changing the synthetic session and shut down with the expected terminal exit 143. On the final code candidate, `NODE_ENV=test node --test lib/*.test.mjs components/*.test.mjs` passed 641/641; the focused route/sidebar/Hide suite passed 21/21; `node_modules/.bin/tsc --noEmit` passed; `npm run lint` passed; source and unrelated-runtime diff guards passed; and `git diff --check` passed. Parallel fresh review run `a1f0a676-4604-4c6c-9079-df2b8631f03f` found no production-code blocker; its only fix-worthy finding, stale `README.zh-CN.md` deletion references, was corrected.

**Departures from approved obligations:** None. One preliminary full-suite invocation inherited the hosting process's `NODE_ENV=production`, which selects React's production export without `act`, and lacked a checkout-local dependency link for one absolute-path test; that invalid environment result was discarded. The task checkout then used an ignored temporary link to the repository's existing main-root dependencies and `NODE_ENV=test`, passed 641/641 twice, and removed the link and all generated state. Two preliminary Playwright harness attempts exposed only transition-timing and pre-load synthetic-fixture hashing issues; the corrected smoke completed every approved browser assertion. No validation layer was waived, no `next build` ran, and no implementation obligation remains blocked or divergent.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Final implementation summary — Objective, Design / Implementation Strategy items 1 through 5, and Validation Contract VC-001 through VC-006.

**Work and outcome:** Completed the approved removal of permanent session deletion from Pi Web. The real session route now exposes only GET/PATCH and has no wrapper destruction, ancestry rewrite, unlink, or deletion cache path. Pinned, Recent, and recursive Project rows expose Rename, Pin, and reversible Hide/Restore without a trash action, confirmation mode, deletion request, or deletion callback; hiding a selected session leaves its chat and URL intact. Row spacing now fits two/one overlay actions. English, Chinese, agent, and durable memory documentation all describe the no-permanent-delete boundary, and focused regressions protect both the route namespace and sidebar absence contract.

**Validation / evidence:** Final evidence is: focused tests 21/21; complete Node suite 641/641 under `NODE_ENV=test`; typecheck pass; lint pass; staged/unstaged whitespace checks pass; exact route exports GET/PATCH; no diff in `rpc-manager`, sidebar-state implementation, worktree DELETE, or API-key DELETE; synthetic live DELETE returns 405 without session-file mutation; and desktop/focus/coarse-pointer Playwright smoke observes two actions at `59px`, no Delete control, reversible Hide/Show hidden/Restore, selected-chat continuity, unchanged JSONL, and restored empty hidden metadata. Fresh parallel review run `a1f0a676-4604-4c6c-9079-df2b8631f03f` found no production-code blocker; its one fix-worthy Chinese-documentation finding was applied and revalidated. The task checkout was clean immediately after implementation commit `084bb00a5c2a9a292675194fcf3686f3cdacfbf0`.

**Departures from approved obligations:** None. The discarded production-environment full-suite attempt and two preliminary smoke-harness attempts were validation-environment/harness corrections, not implementation departures; each was superseded by the passing required gate on the exact implementation candidate. No obligation is incomplete, blocked, waived, superseded, or divergent. `next build` was not run, and all generated or delegated runtime artifacts were removed from the task checkout. The repository has no `.agents/scripts/main-branch-lock.sh`; closeout preflight found no main Git operation, staged path, overlapping main-worktree change, or Git lock, no process owned the retained orchestration checkout, and the only long-lived main-cwd processes were the Pi Web server/tunnel rather than Git writers. This closeout cannot race, so the documented no-lock-helper exception applies and no helper is introduced.

**Implementation commit:** `084bb00a5c2a9a292675194fcf3686f3cdacfbf0` (`feat(sessions): remove permanent web deletion`).
