# Pi Web Native Foreground Tailscale Serve Checkpoints

Plan: `.agents/plans/2026-08-31-pi-web-native-tailscale-serve.md`

## Handoff

**Source:** Fresh read-only scout workflow `c7ef42cb-03f0-4289-8f0d-d4bf12f7e270`; child `d2e85087`. Recoverable raw output: `.pi-subagents/artifacts/d2e85087_scout_0_output.md`.

**Purpose:** Trace the option parser, launcher and terminal lifecycle ownership, standalone child-helper seam, focused unit/subprocess test patterns, documentation boundaries, and startup/fatal-exit races before implementation.

**Outcome:** The scout found no conflict with the approved plan. It confirmed that options should keep string-valued ports while defaulting the selected hostname to literal loopback and numerically rejecting Serve-only ports; the new child helper should create its bounded non-rejecting unexpected-exit notification before readiness resolves; and `runPiWebCli()` should compose backend-first startup, prompt startup cancellation, parallel exact-once cleanup, and one imported fatal lifecycle surface without changing `bin/pi-web-server.js`. Terminal signal ownership remains solely in `runTerminalEntry()`.

**Evidence:** The handoff cites `bin/pi-web-options.js`, `bin/pi-web.js`, `bin/pi-web-server.js`, all three focused test files, `package.json`, `README.md`, `AGENTS.md`, and `.agents/memory/custom-server-lifecycle.md`. Parent inspection confirmed the current seams and a green 12-test option/launcher baseline. The existing real-process fixture copies launcher siblings and therefore must copy the new helper; its bounded child-output and signal-matrix utilities are reusable for fake Serve subprocess coverage.

**Uncertainty / gaps:** The imported fatal-notification property has no existing naming precedent and needs one minimal explicit contract. Marker behavior, same-port private HTTPS/WSS, route removal, and preservation of WhisCode `30142` remain live-smoke obligations after deterministic tests. A terminal signal during readiness and an exit immediately after the marker are the highest-risk races.

**Recommended use:** Implement options first, then a CommonJS helper using one directly spawned attached child and bounded byte-marker overlap, compose it in the launcher with an AbortSignal startup seam and a non-rejecting fatal promise, extend fake and real-subprocess tests, keep server/package/dotfiles unchanged, and run the approved focused gates before the isolated live smoke.

## Implementation Summary

**Plan section:** Design / Implementation Strategy sections 1–5; Focused Test Strategy; Validation Contract VC-001 through VC-006, excluding the still-pending isolated live smoke and final closeout.

**Work and outcome:** Added literal loopback defaults and Serve-only option validation; one directly spawned, output-suppressing, bounded-marker foreground child owner; backend-first launcher composition with prompt signal-aware startup cancellation, concurrent idempotent cleanup, non-rejecting imported `failure` notification, and terminal-only fatal exit; deterministic helper/launcher/subprocess coverage; and concise launch/lifecycle documentation plus durable memory. `bin/pi-web-server.js`, package dependencies/scripts, the dotfiles repository, shared Tailscale state, and unrelated listeners remain unchanged.

**Validation / evidence:** The option/launcher/helper unit set passes 28/28 in the task checkout. The exact approved four-file focused command passes 33/33 in `/tmp/pi-web-native-tailscale-serve-validation/pi-web`, a disposable sibling-layout copy with copied dependencies and the retained production artifact; its first attempt exposed only a missing parent-level Tailwind resolution link in the disposable layout, and the corrected layout passed. The real-process subset covers ordinary terminal signal latching, ready and pending-Serve `SIGINT`/`SIGTERM`, early and unexpected child exits, development/HMR behavior, and production restart. TypeScript, full lint, syntax checks, and `git diff --check` pass. No Next build ran.

**Departures from approved obligations:** The isolated live Tailscale smoke, independent review, final validation, implementation commit, final checkpoint summary, and guarded closeout remain pending. No approved implementation obligation has otherwise been waived or broadened.

**Implementation commit:** Pending.

## Handoff

**Source:** Independent lifecycle/correctness review workflow `0f90cf64-2c8e-476f-9c64-95eaac81afa0`; child `147bec48`. Recoverable raw output: `.pi-subagents/artifacts/147bec48_reviewer_0_output.md`.

**Purpose:** Review the implemented diff against the approved child-process, startup rollback, idempotence, signal, unexpected-exit, imported-API, and non-goal contracts without editing the checkout.

**Outcome:** The reviewer confirmed the overall architecture and scope but found one high-severity VC-003/VC-004 cleanup defect. If `child.kill()` returns false or throws, `owner.close()` rejects before joining the terminal promise; a later child `error` rejects that unobserved promise and can terminate an embedding Node process despite the caller handling `close()`. The current shutdown-error test covers only `kill() === true` followed by `error`.

**Evidence:** The finding cites `bin/pi-web-tailscale-serve.js` signal/terminal paths and `lib/pi-web-tailscale-serve.test.mjs`. The reviewer ran a deterministic probe reproducing an unhandled rejection and process exit after a handled close rejection. It otherwise confirmed exact loopback/command/readiness/concurrent cleanup/terminal ownership and no server, package, or shared-state change.

**Uncertainty / gaps:** The smallest correct handling must preserve the signaling error while still consuming and, when possible, joining subsequent terminal settlement without hanging forever when no terminal event follows. Live-smoke evidence remains separately pending.

**Recommended use:** With explicit user direction, correct the close/terminal failure path and add regression coverage for `kill() === false` followed by `error`/`exit`; then rerun focused validation and independent review.

## Handoff

**Source:** Independent tests/privacy/documentation review workflow `0f90cf64-2c8e-476f-9c64-95eaac81afa0`; child `cde27c69`. Recoverable raw output: `.pi-subagents/artifacts/cde27c69_reviewer_0_output.md`.

**Purpose:** Review exact command/output privacy, bounded readiness, option validation, deterministic/subprocess coverage, documentation, prohibited shared-state behavior, and the Validation Contract without editing the checkout.

**Outcome:** The reviewer confirmed the direct command, safe spawn options, bounded overlap, output suppression, loopback/port validation, concurrent cleanup, and absence of shared Serve-state behavior. It found one medium approved-test gap: the static audit omits the prohibited command tokens `funnel`, `off`, `reset`, and `clear`. It also noted optional README wording polish and correctly identified the approved isolated live smoke as still pending rather than a source defect.

**Evidence:** The finding cites `lib/pi-web-tailscale-serve.test.mjs` and the plan's Explicit Non-Goals/static-audit obligation. Current runtime inspection contains none of the omitted tokens; the issue is regression coverage. The README already documents hard-kill/orphan limitations later in the same section.

**Uncertainty / gaps:** The live preflight could not establish the required WhisCode `30142` baseline because the private HTTPS probe was unreachable; no Pi Web Serve route was started and no Tailscale state was mutated. The README phrasing is optional, while the static audit is required.

**Recommended use:** With explicit user direction, extend the static audit, optionally qualify the normal foreground-lifetime sentence, then rerun review. Do not claim VC-006 until an isolated private HTTPS/WSS and cleanup smoke can also prove the `30142` baseline remains unchanged.

## Handoff

**Source:** Independent follow-up review workflow `8d996e77-a4bd-488b-8f84-31612a344bb5`; child `17b98aeb`. Recoverable raw output: `.pi-subagents/artifacts/17b98aeb_reviewer_0_output.md`.

**Purpose:** Verify the authorized kill-failure fix and prohibited-command audit extension, then scan the full diff for regressions without editing the checkout.

**Outcome:** The reviewer verified that kill false/throw paths now consume later error/exit settlement without unhandled rejection, preserve idempotence, and expose cleanup failure without exiting imported callers. It found a new high VC-001 blocker: Serve option validation checks only digit strings, so Node-accepted numeric forms such as `+0`, `0.0`, whitespace-padded `0`, `+443`, and `443.0` reach backend startup; zero-equivalent forms can bind an ephemeral backend and bypass the explicit Serve port-0 refusal. It also found that the static audit's status and `--bg` patterns remain double-quote-specific and lack positive canaries, so single-quoted prohibited calls can pass.

**Evidence:** The handoff cites `bin/pi-web-options.js`, `lib/pi-web-options.test.mjs`, and the static audit in `lib/pi-web-tailscale-serve.test.mjs`. The reviewer ran injected pre-start probes for the numeric variants and canary probes for single-quoted command arguments. It independently exercised false/throw × error/exit under strict rejection handling and found the prior lifecycle defect fixed.

**Uncertainty / gaps:** The correct Serve preflight must reject semantic `0` and `443` before resources while preserving existing non-Serve behavior and letting ordinary server validation remain authoritative for unrelated malformed/out-of-range ports. The live smoke reached loopback HTTP plus private HTTPS/WSS but failed during the programmatic-close stage; its guarded recovery left no foreground Serve executable, and the exact cleanup failure still needs a privacy-safe diagnosis after code review is unblocked.

**Recommended use:** With explicit user direction, make Serve-only numeric restriction semantic rather than digit-shape-dependent, add equivalent-form and no-resource-start tests, make the audit quote-agnostic with positive canaries across the production launcher/helper surface, rerun focused validation and independent review, then resume the isolated close/signal smoke.

## Implementation Summary

**Plan section:** Validation Contract VC-001, VC-002, VC-003, VC-005, and VC-006 follow-up fixes and isolated live smoke.

**Work and outcome:** With explicit user authorization, changed Serve port refusal from digit-shape matching to semantic numeric comparison, added equivalent zero/443 spellings plus a launcher proof that no backend start occurs, made the static audit quote-agnostic across every production `bin/*.js` file, and added positive single/double-quote canaries for every prohibited token. The prior kill-failure cleanup fix remains intact. During the isolated live smoke, exact loopback HTTP, private same-port HTTPS, and private WSS all succeeded. Programmatic close did not settle because this host's installed `tailscale` command is a two-line executable shell wrapper that does not use `exec`: Pi Web's exact direct child is the shell, while the real foreground CLI is its descendant and does not receive the targeted child signal. The backend closed gracefully, but the wrapper/CLI lineage stayed live until validation recovery signaled the uniquely proven descendant; the wrapper and harness then settled and no validation-owned foreground process remained.

**Validation / evidence:** Updated option/launcher/helper tests pass 29/29; full lint and `git diff --check` pass. Privacy-safe live diagnostics recorded backend `server_closed:graceful`, successful loopback/private HTTPS/WSS stages, no child exit/error/close event after signaling the exact wrapper child, one exact wrapper descendant, and successful bounded lineage recovery. WhisCode `30142` was absent before the smoke and remained outside all mutations. No private hostname, ticket, response body, session ID, child output, PID, or raw Tailscale payload was retained in the repository; no Next build or dotfiles edit ran.

**Departures from approved obligations:** VC-003 and VC-006 remain blocked on the installed executable boundary. Changing Pi Web to parse/resolve wrapper scripts, spawn a platform-specific underlying binary, signal a process group, or manage descendants would violate the approved exact-`tailscale` child and no-process-discovery/group-supervision strategy. Signal-mode live smoke and final review/validation/commit/closeout are paused pending user direction; no such scope expansion has been made.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Final completion of the native Serve Objective, Required Behavior, Design / Implementation Strategy sections 1–5, Focused Test Strategy, and Validation Contract VC-001 through VC-006, as modified only by the separately approved cleanup follow-up `.agents/plans/2026-09-01-shell-wrapped-tailscale-cleanup.md`.

**Work and outcome:** Native launch now defaults to literal loopback and supports explicit same-port foreground Tailscale HTTPS/WSS. Backend-first startup, bounded marker readiness, private-output suppression, startup rollback, idempotent backend/Serve cleanup, terminal signal ownership, imported non-exit behavior, focused tests, documentation, and durable memory are complete. The cleanup follow-up resolved the installed non-`exec` shell boundary by placing the direct launcher and descendants in a private Unix process group with bounded `close`-confirmed cleanup while preserving Windows direct-child behavior.

**Validation / evidence:** Final focused tests pass 35/35; the exact four-file suite passes 40/40 in the required disposable sibling-layout copy; TypeScript, full lint, syntax, and whitespace checks pass. The isolated live smoke passed loopback HTTP, same-port private HTTPS/WSS, route removal after programmatic close/`SIGINT`/`SIGTERM`, safe unexpected-exit local fallback and recovery, and unchanged WhisCode `30142`. Final independent reviewer `26d69f5e` returned PASS with no required finding. No Next build, dotfiles/installed-launcher edit, shared-state mutation by Pi Web, live force-kill, or private-data logging occurred.

**Departures from approved obligations:** The original exact-child/no-process-group strategy and fatal shutdown after unexpected ready-child exit were explicitly superseded by the separately approved 2026-09-01 follow-up: Unix cleanup now targets only the launch-owned private process group, and unexpected exit warns while loopback service remains available without retry. All obligations retained by that follow-up passed; none are incomplete, blocked, or waived.

**Implementation commit:** `e4e7e5b` (`feat: add native foreground Tailscale Serve`).
