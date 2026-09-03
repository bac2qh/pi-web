# Shell-Wrapped Tailscale Cleanup Checkpoints

Plan: `.agents/plans/2026-09-01-shell-wrapped-tailscale-cleanup.md`

## Handoff

**Source:** User instruction in Start-created implementation session `01a06490-7bc6-705b-8880-f3ece14d10d8`.

**Purpose:** Resolve the approved plan's stale instruction to resume implementation session `01a05b1e-bf0b-7f65-aaa8-31f2c571e3ac` while preserving the only existing uncommitted native Serve implementation checkout.

**Outcome:** The user explicitly authorized this session as the sole writer in the registered `2026-08-31-pi-web-native-tailscale-serve` worktree. This supersedes only the old-session-resume instruction; the approved cleanup plan, its scope, validation contract, and the prior uncommitted state remain authoritative.

**Evidence:** The active checkout is `/Users/xin/Documents/repos/pi-web/.agents/worktrees/2026-08-31-pi-web-native-tailscale-serve` on branch `2026-08-31-pi-web-native-tailscale-serve`. Initial status showed the expected uncommitted native Serve files and no second task checkout.

**Uncertainty / gaps:** Implementation, focused validation, isolated live smoke, independent review, implementation commit, final checkpoint summary, and guarded closeout remain pending.

**Recommended use:** Continue narrowly in this checkout as the only writer; do not discard or recreate the existing implementation state and do not resume the superseded session.

## Handoff

**Source:** Fresh independent review workflow `2df104f5-ed19-4257-8421-89c795c6cc8f`; reviewer child `26d69f5e`. Recoverable raw output: `.pi-subagents/artifacts/26d69f5e_reviewer_0_output.md` (authoritative saved-output copy under `.pi-subagents/artifacts/outputs/26d69f5e/`).

**Purpose:** Review the complete native Serve diff against the cleanup follow-up, governing plan, validation contracts, process/signal races, platform boundaries, privacy constraints, tests, and documentation without editing the checkout or repeating live Tailscale operations.

**Outcome:** PASS with no required finding. The reviewer confirmed private Unix process-group creation, Windows direct-child signaling, identifier clearing before exit handling, `close`-only confirmation, the shared two-deadline cleanup promise, startup rollback, warning-only local fallback, terminal/imported boundaries, direct and non-`exec` shell fixtures, static non-goals, and documentation.

**Evidence:** The reviewer independently passed the 35 focused option/launcher/helper tests and the host-level direct/shell subprocess section. Its local four-file run reached 38/40 because the nested checkout intentionally lacks local `node_modules` and a production fixture; the parent separately passed the exact four-file command 40/40 in `/tmp/pi-web-native-tailscale-serve-validation/pi-web` with local copied dependencies and retained `.next`.

**Uncertainty / gaps:** Live Tailscale evidence was intentionally not independently repeated. Windows remains deterministically simulated rather than host-tested. The approved hard-stop/power-loss and deliberately escaped-descendant limitations remain.

**Recommended use:** Treat the implementation as independently clear, retain the stated platform/host limitations, rerun final static gates after checkpoint updates, then commit and perform guarded closeout.

## Implementation Summary

**Plan section:** Design / Implementation Strategy sections 1–6; Test Strategy; Validation Contract VC-001 through VC-006.

**Work and outcome:** Replaced exact-shell-child cleanup with an attached private process group on Unix-like systems while preserving the exact foreground command and Windows direct-child behavior. Cleanup now memoizes one bounded operation, uses direct-child `close` as confirmation, clears signaling ownership before exit handling, sends at most one normal signal and one still-owned `SIGKILL`, and reports signal or final-deadline failures without private details. The launcher now leaves loopback Pi Web running after an unexpected ready-command exit, emits one private-access warning, preserves the non-rejecting lifecycle result, and maps unconfirmed terminal cleanup to exit `1`. Focused tests cover direct executables, a two-line non-`exec` shell launcher, timing, signal/error races, platform behavior, privacy, and prohibited behavior. README, repository guidance, and durable lifecycle memory now describe the final contract.

**Validation / evidence:** Focused option/launcher/helper tests pass 35/35. The exact four-file command passes 40/40 in the disposable sibling-layout copy; the first invocation was accidentally run from the nested checkout and reproduced only its expected missing-local-Next preflight, after which the correctly rooted disposable invocation passed. Disposable `tsc --noEmit`, `npm run lint`, changed JavaScript syntax checks, and `git diff --check` pass. The isolated live smoke passed loopback HTTP, same-port private HTTPS and WSS, route removal after programmatic close/`SIGINT`/`SIGTERM`, warning-only local continuity after a safely induced ready-command exit, exact test-owned group recovery, and unchanged WhisCode `30142`. Its first attempt used the retained artifact's unstable root page and hit a Next `AwaiterOnce` invariant; all test-owned resources still closed in `finally`, and the accepted rerun used the stable `/api/home` status route with bodies discarded. Independent reviewer `26d69f5e` returned PASS with no required finding. No Next build, dotfiles edit, installed-launcher edit, live force-kill, shared Serve inspection by production code, or private-data logging occurred.

**Departures from approved obligations:** None. The live smoke ran on host Node `24.20.0` rather than the repository's pinned local-fork build toolchain `24.19.0`; no dependency build/install was performed, and all required runtime/static checks passed against the retained validated dependencies and production artifact. Windows behavior remains simulated, as permitted by the approved strategy.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Final completion of the Objective, Design / Implementation Strategy sections 1–6, Test Strategy, and Validation Contract VC-001 through VC-006.

**Work and outcome:** The approved cleanup follow-up is complete. Unix-like launch owns the ordinary `tailscale` command and inherited shell descendants in one private attached process group; Windows retains direct-child behavior. One memoized close operation uses the requested normal signal, two fixed ten-second waits, one still-safe force signal, and direct-child `close` confirmation without stale-identifier signaling. Startup cleanup is bounded, unexpected ready-command exit warns once while local Pi Web remains available, imported callers receive lifecycle/close results without forced process exit, and terminal cleanup failure exits `1`. Documentation and durable memory match the shipped behavior.

**Validation / evidence:** Final focused tests pass 35/35; the exact four-file disposable-layout suite passes 40/40; TypeScript, full lint, syntax checks, and whitespace checks pass. The isolated live smoke passed local HTTP, private HTTPS/WSS, programmatic close, terminal `SIGINT`/`SIGTERM`, safe unexpected-exit local fallback and recovery, route removal, and unchanged WhisCode `30142`. Independent reviewer workflow `2df104f5-ed19-4257-8421-89c795c6cc8f` / child `26d69f5e` returned PASS with no required finding. No Next build, installed-launcher/dotfiles edit, live force-kill, shared-config inspection by Pi Web, or private-data logging occurred.

**Departures from approved obligations:** None. Accepted residual limitations are Windows simulation rather than a Windows host run, hard-kill/power-loss cleanup impossibility, and unsupported descendants that deliberately escape the inherited process group. Validation used host Node `24.20.0` without rebuilding dependencies; the pinned `24.19.0` requirement applies to the uninvoked local-fork build/install workflow.

**Implementation commit:** `e4e7e5b` (`feat: add native foreground Tailscale Serve`).
