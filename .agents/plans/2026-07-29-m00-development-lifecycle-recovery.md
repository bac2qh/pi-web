# M0 Recovery: Process-Scoped Next Development Lifecycle

Status: approved

## Objective

Finish the blocked M0 custom-server foundation without modifying private Next.js internals or upgrading Next.

The blocker is narrow: Next 16.2.11 development mode leaves internal Watchpack file watchers referenced after its public `close()`. This recovery changes only that lifecycle contract. Pi Web must still close every resource it owns; real Next development finishes when its terminal process exits; production remains reusable and leak-free in the same process.

Success means:

- the approved M0 plan and its stopped-state checkpoint remain truthful and unchanged;
- the preserved partial M0 implementation is completed in its existing worktree;
- programmatic server close is idempotent, never exits its caller, and releases every Pi-Web-owned resource;
- the development CLI awaits public cleanup, exits on signal, and a fresh child can serve on the same port;
- production can start, close, restart on the same port, close again, and drain naturally in one process;
- the remaining M0 gateway, security, HMR, package, regression, commit, and closeout gates pass;
- no private Next/Watchpack cleanup, arbitrary handle closure, Next upgrade, build, second port, browser migration, or later shutdown hardening enters recovery.

## Design / Implementation Strategy

### 1. Resume the preserved worktree without rewriting history

Implementation remains in:

```text
/Users/xin/Documents/repos/pi-web/.agents/worktrees/2026-07-24-m00-baseline-transport-feasibility
```

Its branch is `2026-07-24-m00-baseline-transport-feasibility`, based at `57f648db811460fa494b0ba25bd3ab268bb32a85`, with substantial uncommitted M0 work and an empty index. Do not reset, stash, rebase, clean, or recreate it.

Planning and approval stay visible on main at this plan path. After Start Implementation begins in the preserved worktree, copy the approved plan byte-for-byte into the same relative path there and verify it matches the approved main commit; this is execution bookkeeping, not a plan revision.

Keep the original M0 plan immutable. Preserve its existing checkpoint byte-for-byte, commit it with the implementation, and use a new matching recovery checkpoint for new handoffs and summaries.

### 2. Correct the lifecycle boundary

`startPiWebServer().close()` remains a reusable library API. It must:

- stop new HTTP/Pi WebSocket acceptance;
- close Pi WebSockets, the WebSocket server, HTTP listener, and owned raw connections;
- clear gateway tickets, registrations, timers, diagnostics state, and its exact `globalThis` slot;
- invoke and await only public Next `app.close()`;
- aggregate observable failures;
- be idempotent and never call `process.exit()`.

Only the executed `bin/pi-web.js` terminal entry owns process termination. It latches the first SIGINT/SIGTERM, runs cleanup once, ignores later signals while closing, then exits `130` for SIGINT or `143` for SIGTERM. Cleanup failure exits `1`. Imported launcher/server APIs cannot terminate an embedding process.

Real Next development is one operating-system process lifetime. Its internal Watchpack handles need not disappear before terminal process exit. Pi-owned state must still be empty before exit.

Production does not use the development Watchpack path and retains strict same-process start/close/restart and natural-drain requirements.

### 3. Replace the impossible test with process-boundary tests

Keep fast injected-Next tests for same-process Pi-owned cleanup, idempotence, repeated start/close, global removal, and port reuse.

Move every real Next development/production case into one sequential integration test file so parallel Node test files cannot contend for `.next/dev`.

The real development child test must cover:

- ordinary App Router requests;
- shared route/server `globalThis` gateway state;
- reserved Pi Web WebSockets and existing ticket/security/frame limits;
- raw HMR upgrade coexistence;
- orderly-close marker, direct-child exit, and fresh-child same-port restart.

Separate real CLI child cases cover SIGINT, SIGTERM, duplicate signals, mixed signals, first-signal status, one close call, and close failure. Child timeouts and last-resort kills are test safety only; either outcome fails acceptance.

Raw HMR socket acceptance proves routing coexistence, not functional hot reload. Retain one manual browser edit/recompile/refresh observation.

For production lifecycle evidence, preflight main's existing `.next` artifact, required manifests, pinned Next version, and a manifest-listed pre-existing route. Copy the required fixture into temporary test-owned state, then start/close/restart real production Next in one child without `process.exit()`. This validates lifecycle only, not freshness or inclusion of the new ticket route.

### 4. Finish M0 and close it out

Complete the existing M0 gateway, ticket route, custom server, launcher, package, HMR, diagnostics, documentation, and tests. Do not touch browser transport, SSE routes, `rpc-manager`, production channel registration, event protocols, session idle, replay/backpressure, or later forced-shutdown behavior.

Update `AGENTS.md` to explain that Pi Web owns its resources, real Next development is process-scoped under 16.2.11, and production/programmatic cleanup remains strict. Wiki is not applicable. Record the durable lifecycle decision in project memory after validation.

Commit coherent implementation and validation state, then append and separately commit the final recovery `Implementation Summary` naming the implementation commit and all original-M0 dispositions.

Main has advanced to `ba6de45c2953071b3c112a43d79c104754251fe4`. Guard closeout, preserve unrelated main dirt, and use a normal merge commit when required. The main lock helper is absent: record a no-race exception only if no competing closeout exists; otherwise stop before a main write. Never guess through conflicts in `AGENTS.md` or memory files; use `Closeout Recovery` when repository rules require it.

### Scope estimate

- **Surfaces:** preserved launcher/server lifecycle code, launcher/server integration tests, already-authorized M0 files, `AGENTS.md`, old and new checkpoints, and durable memory.
- **Testability:** high for Pi-owned cleanup, real-development exit/rebind, signal ownership, gateway/HMR coexistence, and production lifecycle; fresh production route coverage remains blocked by the build prohibition.
- **Implementation complexity:** medium; most product code already exists, with risk concentrated in child-process integration.
- **Context:** zero compactions expected; one maximum.
- **Stop condition:** any need for private Next/Node handle cleanup, dependency upgrade, product shutdown deadline, second port, or browser/SSE expansion requires another approved plan.

## Reference Files

- [Immutable approved M0 plan](./2026-07-24-m00-baseline-transport-feasibility.md)
- [Approved transport master](./2026-07-24-multi-tab-performance.md)
- Preserved task checkpoint: `.agents/checkpoints/2026-07-24-m00-baseline-transport-feasibility-checkpoints.md` in the task worktree
- Preserved task launcher: `bin/pi-web.js` in the task worktree
- Preserved task custom server: `bin/pi-web-server.js` in the task worktree
- Preserved task lifecycle tests: `lib/pi-web-server.test.mjs` and `lib/pi-web-launcher.test.mjs` in the task worktree
- [Repository instructions](../../AGENTS.md)

## Constraints and Current Evidence

### Fixed constraints and decisions

- Preserve the exact partial task worktree and keep M0/master plans immutable.
- Treat real Next development as process-scoped while retaining strict Pi-owned and production cleanup.
- Successful SIGINT exits `130`, SIGTERM exits `143`, and cleanup failure exits `1`.
- Use only public Next APIs; do not investigate or upgrade Next unless this corrected lifecycle fails and the user separately approves that work.
- Never run `next build` during development or modify `/Users/xin/Documents/repos/pi`.
- Preserve unrelated dirt and `.pi-subagents/`; never commit private content, raw tickets, or raw child logs.

### Established facts

- Baseline validation passed 101/101 tests, typecheck, and lint. The preserved partial suite passed 27 tests with one real-Next lifecycle test skipped; typecheck, lint, and `git diff --check` passed.
- Real development served App Router requests and shared gateway state before public Next close left approximately 52 referenced `FSWatcher` handles under Turbopack and webpack.
- Next 16.2.11 public custom-server `close()` awaits its server and registered cleanup callbacks, but its development bundler creates an unexposed Watchpack instance.
- Next's own CLI performs public cleanup and then explicitly exits on signal.
- The same watcher behavior reproduced without Pi Web, so the retained watchers are not Pi-owned.
- The task worktree lacks a production `BUILD_ID`; main currently has an existing production artifact suitable only for lifecycle probing.

### Blocked facts

- No public Next 16.2.11 API closes the retained development Watchpack.
- A fresh production artifact containing the new route cannot be generated because `next build` is prohibited.
- Browser automation is unavailable; functional HMR requires manual observation.

## Test Strategy

Run from the preserved task worktree:

```text
node_modules/.bin/tsc --noEmit
npm run lint
node --test lib/*.test.mjs
npm pack --dry-run
npm ls ws @types/ws next
git diff --check
```

Required focused evidence:

- injected dev/production same-process cleanup and port reuse;
- one sequential real-Next child integration file;
- real development route/gateway/WebSocket/security/HMR coexistence;
- real CLI SIGINT/SIGTERM/duplicate/mixed-signal behavior;
- direct-child orderly exit and fresh-child same-port restart;
- copied-artifact real production start/close/restart/natural drain;
- manual functional HMR observation;
- package contents, unchanged SSE/browser boundary, and final diff review.

A skipped real-child case, timeout, fallback kill, failed production natural drain, invalid artifact, failed rebind, private workaround, or missing manual HMR evidence blocks closeout. Fresh production ticket-route coverage remains explicitly not applicable under the build prohibition.

## Telemetry / Debuggability

Retain bounded sanitized diagnostics for mode, server instance, shutdown stage/outcome, terminal versus programmatic ownership, and Pi-owned connection/socket/channel/ticket/timer counts at close. Tests may record sanitized readiness, signal, orderly-close, exit-status, and restart outcomes.

Never log full ticket URLs or values, private paths/bodies, process-handle inventories, sessions, prompts, tools, credentials, or provider payloads.

## Validation Contract

| ID | Priority | Surface | Required truth and evidence | Validator | Blocker path |
|---|---|---|---|---|---|
| REC-VC-001 | P0 | History/state | M0/master and the old checkpoint remain unchanged; the approved recovery plan is copied byte-for-byte into the task worktree and supersedes only real-development same-process cleanup. | scrutiny | Any rewrite or hidden waiver blocks. |
| REC-VC-002 | P0 | Pi-owned lifecycle | Programmatic close is idempotent, non-exiting, invokes public Next close, and empties all Pi-owned resources in repeated injected dev/production tests. | scrutiny | Any owned leak or arbitrary-handle cleanup blocks. |
| REC-VC-003 | P0 | Real development | Sequential child tests prove route/gateway/WebSocket/security/HMR coexistence, orderly direct-child exit, and fresh-child same-port restart; manual HMR proves edit/recompile/refresh. | both | Skip, timeout, kill, failed HMR/rebind, or private workaround blocks. |
| REC-VC-004 | P0 | Terminal ownership | The first signal wins, cleanup runs once, SIGINT exits 130, SIGTERM exits 143, failure exits 1, and imported APIs cannot exit callers. | scrutiny | Wrong ownership/status or repeated/unawaited cleanup blocks. |
| REC-VC-005 | P0 | Production | A preflighted copied artifact starts, closes, restarts on the same port, closes, and drains naturally with empty Pi-owned state. | scrutiny | Invalid artifact, main-artifact mutation, forced exit, or failed reuse blocks. |
| REC-VC-006 | P0 | M0/closeout | Remaining M0 behavior, security, package, diagnostics, documentation, checkpoints, commits, guarded merge, and M1 handoff are complete; browser/SSE scope is unchanged. | both | Any incomplete M0 gate or unsafe merge blocks M1. |

## Assumptions, Risks, and Blockers

- Process exit proves the operating system reclaimed Next's development watchers; it does not claim public `app.close()` closed them.
- Direct-child exit plus an orderly-close marker and port reuse is the portable test boundary; descendant-process-tree claims are out of scope.
- The existing production artifact may be stale for routes but can test pinned Next lifecycle after copying; failure blocks rather than authorizing a build.
- Public Next close suppresses internal cleanup rejection details, so acceptance relies on observable owned state, port, child, and process outcomes.
- All real Next cases must be serialized to avoid `.next/dev` contention and use unique ports except for deliberate restart.
- Main/task divergence may conflict during closeout; preserve both sides and follow guarded recovery rules.
- If corrected development shutdown or strict production reuse still fails, stop and plan a separate Next-version investigation.

## Implementation Handoff

No implementation or recovery mutation is authorized while this plan is `Status: draft`.

After explicit approval and a separate main plan-only commit, run from the preserved task worktree using the approved main plan:

```text
/start-implementation /Users/xin/Documents/repos/pi-web/.agents/plans/2026-07-29-m00-development-lifecycle-recovery.md
```
