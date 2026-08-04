# Production Route Handler Export Compatibility Checkpoints

Plan: `.agents/plans/2026-08-03-production-route-handler-exports.md`

## Implementation Summary

**Plan section:** Design / Implementation Strategy — user-authorized main-only checkout and pre-write safety preflight.

**Work and outcome:** The implementation session retained its orchestration checkout as read-only coordination state and selected `/Users/xin/Documents/repos/pi-web` on local `main` as the sole source, build, validation, staging, and commit checkout. Local `main` advanced from the plan's observed `5b20363ab87b973b30249e504a740a54699cc3a8` only to `c3e9ce0367e17ada8c94199f2f21493cf5f36c97`, the approved-plan commit; none of the seven approved source/test/config paths changed in that advance. The user-authorized main-only/no-race exception is active. No competing source writer or Git operation was observed, and no second checkout will be used for source edits.

**Validation / evidence:** Before the first source write, `main` was at `c3e9ce0367e17ada8c94199f2f21493cf5f36c97` with no staged paths, no Git operation marker or lock, one unrelated tracked modification (`.agents/plans/2026-07-21-clone-session.md`), and the pre-existing untracked plan/runtime/subagent state recorded under `/tmp/pi-web-production-route-handler-exports-baseline/`. The retained `2026-08-03-production-route-handler-exports` checkout was clean at the same commit; the retained orchestration checkout remained at `91c8c1df90ce4733431056679a78c0b7f8195f74` with only its pre-existing `.pi-subagents/` state. Main-cwd Pi processes had no approved source path open and no non-generated project file had changed in the preceding ten minutes. The repository has no `.agents/scripts/main-branch-lock.sh`; because this approved exception writes and commits directly on local `main` with no separate closeout/integration writer, no closeout race exists and no lock helper is introduced in this bounded correction. Five main-cwd `next-server` development owners were inventoried for graceful shutdown before the production build.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Design / Implementation Strategy and Validation Contract VC-001 through VC-004 — module-boundary correction and pre-build validation.

**Work and outcome:** Moved the complete new-agent factory and cleanup dependencies to `lib/new-agent-route.ts`, leaving the real App Router module with only its eagerly bound `POST`. Moved the complete transport-ticket implementation, issuer factories, helpers, and one-time default issuers to `lib/transport-ticket-route.ts`, leaving the real adapter with only `POST` and literal `dynamic = "force-dynamic"`. Rewired focused tests to the ordinary `lib/` factories, added exact runtime namespace assertions and safe real-adapter delegation coverage, made the relocated file-watch source-boundary assertion non-vacuous, and added the standalone `.agents/worktrees/**` ESLint global ignore.

**Validation / evidence:** Mechanical parity checks against baseline `5b20363ab87b973b30249e504a740a54699cc3a8` proved both moved implementation bodies byte-for-byte identical; the only file-level removals were their adapter-only exports and the resulting trailing blank line in `lib/new-agent-route.ts`. In local main, `node --test lib/session-channel-integration.test.mjs lib/websocket-ticket-route.test.mjs` passed 45/45; `node_modules/.bin/tsc --noEmit` passed; `npm run lint` exited zero with only the plan-identified unrelated warning in `.agents/runtime/pinned-sessions/bidi-focus.mjs`; `eslint --print-config` returned exactly `undefined` for the retained orchestration worktree's `.next/dev/types/validator.ts`; and `git diff --check` passed.

**Departures from approved obligations:** Before the main-checkout focused run, one focused test command was mistakenly launched from the implementation session's retained-worktree process cwd. It read and passed the pre-change 43-test baseline but was not accepted as validation. The retained checkout remained clean at `c3e9ce0367e17ada8c94199f2f21493cf5f36c97` with an unchanged status hash; no source, build, staging, or generated state was written there. The command was immediately rerun from explicit local-main cwd and passed the changed 45-test suite. All subsequent commands use an explicit main cwd.

**Implementation commit:** Pending.

## Implementation Summary

**Plan section:** Validation Contract VC-005 through VC-007 — fresh production build, complete suite/package validation, and production lifecycle smoke.

**Work and outcome:** Attributed five orphaned main-cwd Pi Web development owners by exact cwd, Next process identity, listener, and successful `/api/home` behavior; sent SIGTERM only to those owners and confirmed every process and port released. Removed only local main's generated `.next`, built a fresh Node 24.19.0 / Next 16.2.11 production artifact, validated its full test/package surfaces, and exercised the actual production launcher through `npm start` on an unused loopback port.

**Validation / evidence:** The five identified development owners were PIDs 1705/40259/41274/42021/42673 on ports 31941/58832/58924/58965/58996; each exited after SIGTERM and each port was released before `.next` removal. After the final staged whitespace correction, the clean build/full-suite/package/smoke sequence was repeated so the following evidence corresponds to the exact committed source candidate. `npm run build` completed successfully, with only the explicitly excluded existing dynamic-import warning in `app/api/sessions/[id]/export/route.ts`, and emitted non-empty `.next/BUILD_ID` `knABxDLYFuKIgGC5EZsCo`. `node --test lib/*.test.mjs components/*.test.mjs` passed 639/639 against that artifact. `npm pack --dry-run --json` listed one `.next/BUILD_ID` and zero `.next/dev`, `.next/cache`, or `*.js.map` package entries; staged and unstaged `git diff --check` passed again. The production smoke used `npm start` on `127.0.0.1:51715`: `/api/home` returned 200, malformed agent/new returned the preserved 400, transport/ticket without the bootstrap header returned the preserved 403, SIGTERM was sent to the listener-owning launcher PID 13906, `terminal_shutdown_complete` was observed with no `close_failed`, the propagated exit code was 143, and the process and port were released. Raw final-validation logs are retained under `/tmp/pi-web-production-route-handler-exports-full-tests.log`, `/tmp/pi-web-production-route-handler-exports-pack.json`, and `/tmp/pi-web-production-route-smoke.*.log`.

**Departures from approved obligations:** None.

**Implementation commit:** Pending.

## Handoff

**Source:** `pi-subagents` run `a7d13f26-1bfa-4e4b-a8df-e0a2e778d88d`, fresh read-only reviewer; recoverable child session `1696d357/run-0/session.jsonl` under the current implementation session.

**Purpose:** Independently review the completed diff for Next Route Handler export correctness, mechanical behavior preservation, security-sensitive session/ticket semantics, test coverage, and ESLint-ignore scope before commit.

**Outcome:** No blocker, defect, security regression, lifecycle regression, or fix-worthy issue was found. The reviewer confirmed the adapters expose only the approved exports, moved implementations differ from baseline only by adapter-export removal, one-time bindings remain module-scoped, tests use `lib/` factories while inspecting real adapter namespaces, the source-boundary assertion is non-vacuous, and the ESLint ignore remains narrow and global.

**Evidence:** The reviewer cited `app/api/agent/new/route.ts:1-3`, `app/api/transport/ticket/route.ts:1-5`, `lib/new-agent-route.ts:35-115`, `lib/transport-ticket-route.ts:88-531`, `lib/session-channel-integration.test.mjs:15-17,252-405`, `lib/websocket-ticket-route.test.mjs:18-20,67-74,92-235,299-703`, and `eslint.config.mjs:4-7`. It independently reran the focused tests, typecheck, lint, and whitespace checks successfully. These conclusions agree with the parent's byte-parity checks and focused/static validation.

**Uncertainty / gaps:** The reviewer did not independently repeat the fresh production build, 639-test full suite, package dry run, or production lifecycle smoke. The implementation parent ran and recorded all four successfully under the preceding VC-005 through VC-007 summary.

**Recommended use:** Proceed to the explicit-path implementation commit without code changes; retain the reviewer's un-repeated expensive validations as a disclosed review gap, not an implementation residual risk.

## Implementation Summary

**Plan section:** Final implementation summary — Objective and Validation Contract VC-001 through VC-008.

**Work and outcome:** Completed the approved mechanical module-boundary correction on the user-authorized local-main checkout. Both real App Router modules now expose only supported Next exports; their testable implementations live under `lib/` with original startup, cleanup, authorization, identity, status, and one-time binding behavior preserved. Focused regressions cover the real adapter namespaces and delegation, lint globally excludes only retained `.agents/worktrees/**`, and the seven approved source/test/config paths are committed on local `main`. Because the approved workflow committed directly to local `main`, that implementation commit is already integrated and no separate guarded merge is applicable.

**Validation / evidence:** Final evidence is: focused tests 45/45; typecheck pass; lint exit zero with the single pre-existing `.agents/runtime/pinned-sessions/bidi-focus.mjs` warning; retained-worktree `eslint --print-config` exactly `undefined`; staged and unstaged whitespace checks pass; fresh Node 24.19.0 / Next 16.2.11 build pass with `.next/BUILD_ID` `knABxDLYFuKIgGC5EZsCo`; complete suite 639/639; package dry run includes `BUILD_ID` and excludes `.next/dev`, `.next/cache`, and JavaScript source maps; production `npm start` smoke returns 200/400/403 for the required safe routes and exits 143 after launcher SIGTERM with `terminal_shutdown_complete`, no `close_failed`, and released process/port. Independent review run `a7d13f26-1bfa-4e4b-a8df-e0a2e778d88d` found no fix-worthy issue. Before the source commit, the cached path inventory was exactly the seven approved source/test/config paths and excluded `.next`, checkpoint state, and all unrelated dirt; unrelated tracked/untracked plan hashes and both retained-worktree HEAD/status identities matched the captured baseline.

**Departures from approved obligations:** One read-only focused-test command initially ran from the retained implementation-session cwd rather than local main. Disposition: its pre-change 43-test result was discarded, it wrote no source/build/generated state, the retained checkout remained clean with identical HEAD/status hash, and the changed 45-test suite was immediately rerun successfully from explicit local-main cwd. No obligation remains incomplete, blocked, waived, superseded, or divergent. The main-only checkout and absence of a separate guarded merge are approved plan terms, not departures.

**Implementation commit:** `5dc645fe94000c328149cb6c7590a107959af0aa` (`fix(routes): restore production-compatible exports`).
