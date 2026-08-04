# Production Route Handler Export Compatibility

Status: approved
Date: 2026-08-03

## Objective

Restore a valid Pi Web production build on Node 24.19.0 and Next 16.2.11 by removing unsupported custom runtime exports from the two affected App Router Route Handler modules without changing new-session startup or transport-ticket behavior.

Success means the actual route modules expose only supported Next exports, their testable factories live under `lib/`, existing security and error semantics remain covered, lint no longer traverses retained `.agents/worktrees/`, the full validation set passes, `.next/BUILD_ID` is produced, and the production server starts and shuts down gracefully.

## Design / Implementation Strategy

- Treat this as a mechanical module-boundary correction, not a redesign. Move the complete `createNewAgentPost` factory and its private dependency/default definitions into `lib/new-agent-route.ts`; include the direct `getRpcSession`/`invalidateSessionPathCache` cleanup imports and preserve the current `try`/`finally` ordering exactly. Keep `app/api/agent/new/route.ts` as a thin adapter that creates the production handler once at module initialization and exports only `POST`.
- Move the complete ticket POST implementation, its private helpers, one-time default issuer constants, `createSessionTicketIssuer`, and `createFileWatchTicketIssuer` into `lib/transport-ticket-route.ts`. Do not recreate issuers per request. Keep the literal `export const dynamic = "force-dynamic"` in `app/api/transport/ticket/route.ts`, which imports/re-exports only the already-bound production `POST` handler.
- Preserve factory dependencies, module initialization, validation order, status mapping, ownership/cleanup behavior, ticket metadata binding and one-use semantics, session identity checks, file-watch authorization/path limits, and same-origin/body validation. Prefer code movement and import rewiring over logic changes; do not opportunistically refactor security-sensitive branches.
- In `lib/session-channel-integration.test.mjs`, import `createNewAgentPost` from its new `lib/` module while importing the real agent/new adapter namespace separately. Assert `Object.getOwnPropertyNames()` excluding Jiti's synthetic `__esModule` is exactly `POST`, that `POST` is callable, and that a safe malformed request still exercises the real adapter and returns the existing `400` response without starting a session.
- In `lib/websocket-ticket-route.test.mjs`, import both issuer factories from the new `lib/` module while retaining all production POST behavior tests against the real ticket adapter. Assert its runtime property names excluding `__esModule` are exactly `POST` and `dynamic`, `POST` is callable, and `dynamic` remains `force-dynamic`.
- Relocate the existing file-watch implementation source-boundary assertion to `lib/transport-ticket-route.ts`, retaining its check that the file-watch issuer region has no RPC session startup/access dependency. First assert that both slice markers exist and are ordered so the source check cannot pass vacuously.
- Add `.agents/worktrees/**` through a standalone global-ignore entry in the flat ESLint configuration. Do not add `.agents/runtime/**` or `.pi-subagents/**`: neither is currently Git-ignored, and a bounded run proves that ignoring worktrees alone makes lint exit successfully.
- The user explicitly authorizes a main-only exception for this correction. Start through the ordinary Start Implementation workflow but use the existing local `main` checkout as the sole source/build/validation checkout; do not create or use another implementation worktree. Preserve unrelated main dirt and the retained orchestration worktree. Before any source write, verify there is no competing writer or Git operation and record the user-authorized no-race/main-only exception in the implementation checkpoint. If local `main` advances before launch, reconcile from the new tip without reset and stop if the changed baseline materially alters this scope.

**Rough scope estimate:** Seven files are expected: two thin Route Handler adapters, two new ordinary `lib/` modules, two focused tests, and `eslint.config.mjs`. The correction is highly testable through focused Node tests, static type/lint checks, a fresh main-checkout production build, the post-build full test suite, package inspection, and a production-server smoke test. Implementation difficulty is low-to-moderate; behavioral risk is moderate because security-sensitive session ownership and ticket authorization code is moving even though its logic should remain unchanged. Operational risk is also moderate because main is dirty and currently owns development servers, so preservation and server-ownership preflights are mandatory.

## Reference Files

- [`../../app/api/agent/new/route.ts`](../../app/api/agent/new/route.ts)
- [`../../app/api/transport/ticket/route.ts`](../../app/api/transport/ticket/route.ts)
- [`../../lib/session-channel-integration.test.mjs`](../../lib/session-channel-integration.test.mjs)
- [`../../lib/websocket-ticket-route.test.mjs`](../../lib/websocket-ticket-route.test.mjs)
- [`../../lib/pi-web-real-next.test.mjs`](../../lib/pi-web-real-next.test.mjs)
- [`../../eslint.config.mjs`](../../eslint.config.mjs)
- [`../../.gitignore`](../../.gitignore)
- [`../../package.json`](../../package.json)
- [`../../AGENTS.md`](../../AGENTS.md)
- [`../checkpoints/2026-08-02-s3-secure-session-websocket-checkpoints.md`](../checkpoints/2026-08-02-s3-secure-session-websocket-checkpoints.md)
- [`../checkpoints/2026-08-03-s5-persistent-file-watch-websocket-checkpoints.md`](../checkpoints/2026-08-03-s5-persistent-file-watch-websocket-checkpoints.md)
- [`../checkpoints/2026-08-03-s6-lifecycle-security-shutdown-checkpoints.md`](../checkpoints/2026-08-03-s6-lifecycle-security-shutdown-checkpoints.md)
- [`../memory/custom-server-lifecycle.md`](../memory/custom-server-lifecycle.md)

## Constraints And Current Evidence

- This is an ordinary implementation plan; the user did not designate it as an orchestration master.
- User-directed scope requires exact behavioral preservation, including collision-resistant startup, pre-prompt ownership and cleanup, one-use metadata-bound tickets, session identity validation, file-watch authorization/path limits, same-origin and request-body validation, and existing error statuses.
- Current generated Next types name only two failures: `app/api/agent/new/route.ts` for `createNewAgentPost`, and `app/api/transport/ticket/route.ts` for its custom issuer factories. Runtime inspection confirms the former currently exports `POST` plus `createNewAgentPost`, while the latter exports `POST`, `dynamic`, and both factories. A repository-wide Route Handler export scan found no other custom runtime export.
- Local `main` is currently at the supplied commit `5b20363ab87b973b30249e504a740a54699cc3a8`; it also contains unrelated modified/untracked state that must remain untouched.
- The current checkout has no `.next/BUILD_ID`. The literal full suite therefore cannot pass before a fresh build.
- `lib/pi-web-real-next.test.mjs` derives its production artifact root from `git rev-parse --git-common-dir`. The user-authorized main-only implementation makes that root the same checkout that is cleaned and rebuilt, so no real-Next harness change is needed.
- Current lint fails after traversing the Git-ignored retained worktree and its nested `.next/dev`. A bounded CLI run with only `.agents/worktrees/**` ignored exits zero; it leaves one unrelated, non-failing warning in untracked `.agents/runtime/`, which should be reported rather than hidden by broadening this fix.
- The retained orchestration worktree must not be removed, reset, stashed, cleaned, or used as a second source writer. Any running server must be matched to the implementation checkout by working directory before it is stopped; main or sibling-worktree servers are unrelated unless that exact checkout was selected.
- Stale extension context after session deletion, generated-check suppression, runtime/dependency version changes, the session-export dynamic-import warning, broader runtime-directory ignore policy, and npm publication are excluded.

## Test Strategy

- Keep focused factory behavior tests importing ordinary `lib/` modules rather than importing custom exports from Route Handler modules.
- Use runtime namespace assertions against both real adapter modules, not source-only regular expressions: exact property-name sets catch the reported factories and any future custom runtime export. Preserve real-adapter delegation coverage through the safe agent/new `400` request and the existing ticket POST behavior tests.
- Retain non-vacuous source-boundary coverage for security-sensitive ticket implementation code after relocation.
- Run focused tests, typecheck, lint, and whitespace checks before the build. Prove the ESLint pattern is global by requiring `eslint --print-config` for a representative retained-worktree `.next/dev` file to return `undefined`, in addition to a successful `npm run lint`.
- Identify every Pi Web development server whose cwd is local main, terminate each through its documented graceful path, and prove no main-cwd dev owner remains. Then remove only main's generated `.next`, run `npm run build`, and require main's `.next/BUILD_ID`. Run the literal full Node suite after the build so its real-Next preflight targets that fresh artifact. Run `npm pack --dry-run` afterward and inspect its manifest for `BUILD_ID` while excluding `.next/dev`, `.next/cache`, and JavaScript source maps.
- Smoke the fresh artifact through `npm start` on an unused loopback port with bounded startup/request/shutdown deadlines. Require `/api/home` success plus safe built-runtime validation responses from agent/new and transport/ticket, send SIGTERM to the actual owned launcher, require `terminal_shutdown_complete`, no `close_failed`, exit code `143`, and released process/port with no orphan.

## Telemetry / Debuggability

No new runtime telemetry is warranted because the intended behavior and request lifecycle do not change. Preserve existing diagnostics and error responses. The focused Route Handler export regression and required `.next/BUILD_ID` check provide bounded build-time diagnostics for this failure mode without logging request or ticket data.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Both actual Route Handler modules expose only supported Next exports: agent/new has `POST`; transport/ticket has `POST` and `dynamic`. | Focused regression assertion plus successful `npm run build` generated Route Handler type validation. | Stop; inspect adapter exports and transitive test assumptions rather than suppressing Next checks. |
| VC-002 | New-session startup retains collision resistance, ownership before prompt dispatch, and cleanup/error behavior. | `node --test lib/session-channel-integration.test.mjs lib/websocket-ticket-route.test.mjs`, including existing focused session cases. | Stop; compare moved factory code and dependency wiring with the pre-move implementation and restore semantic parity. |
| VC-003 | Ticket issuance retains one-use metadata binding, identity validation, file-watch authorization/path limits, same-origin/body checks, and existing status responses. | Focused ticket-route tests and the complete Node test suite. | Stop; treat as a security regression and restore exact validation order and mappings before proceeding. |
| VC-004 | Focused behavior, source types, lint, and whitespace remain valid without lint traversing the retained worktree. | Before build: focused Node tests; `node_modules/.bin/tsc --noEmit`; `npm run lint`; representative retained-worktree `eslint --print-config` returns `undefined`; `git diff --check`. | Fix only in-scope defects; do not delete retained worktrees, broaden ignores, or absorb unrelated failures without user authorization. |
| VC-005 | A clean production build completes in local main and emits its production identity. | Identify and gracefully stop all Pi Web dev servers whose cwd is main; prove none remains; remove only main's generated `.next`; run `npm run build`; require `.next/BUILD_ID` to exist. | Stop and report the exact build stage/error; do not weaken generated validation, touch the retained worktree's artifacts, or change Node/Next versions. |
| VC-006 | The real-Next preflight targets the VC-005 artifact, and that fresh artifact passes the complete test and package surfaces. | `node --test lib/*.test.mjs components/*.test.mjs`; post-build `npm pack --dry-run` containing `BUILD_ID` and excluding dev/cache/map output; repeat `git diff --check`. | Stop on any failure, distinguish regression from unrelated baseline evidence, and do not publish. |
| VC-007 | The built production server preserves safe route behavior and shuts down gracefully without an orphan. | On an unused loopback port, use `npm start`; require bounded `/api/home` success, agent/new malformed-request `400`, ticket missing-header `403`, then actual-launcher SIGTERM, `terminal_shutdown_complete`, no `close_failed`, exit `143`, and process/port release. | Stop and report startup/shutdown evidence; clean up only the owned smoke process and do not claim completion. |
| VC-008 | Unrelated local-main state and retained orchestration state remain byte-for-byte preserved, and generated output is not committed. | Capture/compare main status, `git worktree list --porcelain`, retained branch/HEAD/status, and server cwd ownership; stage the seven explicit approved paths only and compare the cached path list with that inventory. Verify `.next` and unrelated paths are absent from the commit. | Unstage unintended paths and stop if preservation cannot be proven; never clean, stash, reset, delete, or stage unrelated or retained-worktree state. |

## Assumptions, Risks, And Blockers

- Assumption: moving the implementations does not introduce a server/client boundary or module-cycle issue; typecheck and production build are decisive.
- Risk: mechanical movement can still change eager default-handler creation or dependency identity. Keep the agent handler and ticket default issuers bound once at module load and rely on existing identity/concurrency tests plus the fresh build.
- Risk: source-text assertions can become coupled to file layout. Keep only the security boundary assertion tied to the relocated implementation and make runtime-export coverage inspect the real adapter modules.
- Risk: a broad ESLint ignore could hide tracked project code. Limit the new ignore to the Git-ignored retained worktree surface; report the existing `.agents/runtime/` warning if still present.
- User decision: implement, build, validate, and commit directly in local `main`; do not alter `lib/pi-web-real-next.test.mjs`. Authority: explicit answer on 2026-08-03 after the artifact-root issue was explained. Consequence: main-cwd Pi Web development servers may be gracefully stopped for the clean build, but unrelated files, retained-worktree state, and non-Pi-Web processes remain protected.
- Risk: local `main` currently has multiple server processes with that cwd. Identify them as Pi Web development owners before shutdown; do not kill by broad process pattern or touch a sibling checkout's server/artifact.
- Blocker: if Start Implementation cannot honor the authorized main-only checkout, if any server cannot be safely attributed, or if any baseline advance, active second source writer, Git operation, or pre-existing unrelated failure is found, stop and report rather than reset, silently fix, or fold it into this plan.

## Implementation Handoff

After this plan is explicitly approved, start a separate implementation session with:

```text
/start-implementation .agents/plans/2026-08-03-production-route-handler-exports.md
```
