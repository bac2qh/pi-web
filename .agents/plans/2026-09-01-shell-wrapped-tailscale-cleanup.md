# Clean Up Shell-Wrapped Tailscale Serve

Status: approved

## Objective

Finish Pi Web’s active Tailscale Serve implementation on macOS when the `tailscale` command found through normal command lookup is a shell script rather than the real Tailscale program.

The installed launcher starts this process tree:

```text
Pi Web
└─ shell launcher
   └─ real Tailscale command
```

Pi Web currently signals only the shell. The real Tailscale command stays alive, so its foreground Serve route also stays alive. The fix is to place the shell and everything it starts into one private **process group**—an operating-system group that can receive one signal together.

During intentional Pi Web shutdown, cleanup is bounded best effort. Pi Web first asks its Tailscale group to stop normally. If it has not finished after 10 seconds, Pi Web force-stops only that same group and waits up to another 10 seconds. If cleanup still cannot be confirmed, code that embeds Pi Web and calls its close function receives an error; the `pi-web` command run in a terminal ends with failure status (exit code `1`) rather than waiting forever.

If the launched Tailscale command reports an unexpected exit after it became ready, Pi Web warns once that private access may be unavailable and keeps serving locally at `127.0.0.1`; it does not retry Tailscale automatically. Direct executable installations must continue to work. Pi Web must not modify or parse the installed launcher, search the process table, inspect shared Serve configuration, or affect WhisCode `30142` and other listeners.

### Scope estimate

- **Affected files:** the active implementation’s Tailscale child helper, the launcher’s handling of child exit after readiness, focused tests, and small documentation corrections. The server interface is unchanged; if implementation proves otherwise, stop and ask rather than expand this plan.
- **Testability:** high. A temporary two-line shell launcher can reproduce the installed macOS behavior without using live Tailscale, and a simulated clock can cover both fixed waits.
- **Implementation difficulty:** medium. The change is narrow, but signal, timer, child-exit, and output-stream ordering must remain safe and happen only once.

## Design / Implementation Strategy

1. **Create one private process group on macOS and other Unix-like systems.**
   - Continue spawning the ordinary `tailscale` command directly, without asking a shell to interpret it and without resolving a platform-specific app binary.
   - On Unix-like systems, use Node’s `detached: true` spawn option only to create the private process group described above. Do not call `unref()`; keep the child and its standard output/error streams attached so Pi Web continues waiting for them.
   - The word “detached” is Node terminology here. Tailscale remains foreground: the command still has no `--bg`, Pi Web still observes it, and intentional Pi Web shutdown still cleans it up.
   - On Windows, preserve direct-child signaling because Unix process-group signaling is unavailable there.

2. **Use one bounded cleanup operation.**
   - Save the direct child’s process ID when spawning succeeds. On Unix-like systems, Node signals that child-created group by passing the negative process ID to `process.kill`.
   - A close requested by code sends `SIGINT`. Ctrl-C forwards `SIGINT`. A received `SIGTERM` forwards `SIGTERM`.
   - All shutdown paths share one cleanup promise. They may send at most one normal signal and one later force-stop signal, and repeated close calls wait for that same result.
   - Wait up to 10 seconds after the normal signal. If the child has not emitted `close` and the group identifier is still safely owned, send `SIGKILL` to that exact group and record one warning, without private details, that forced cleanup was needed.
   - Wait up to another 10 seconds for `close`. If it arrives, cleanup succeeds. If it does not, stop waiting: the close call made by embedding code returns a generic cleanup-unconfirmed error, and the terminal `pi-web` command exits with code `1` after its other owned resources finish closing.
   - If either signal call itself fails, record only that cleanup failed and omit the private details listed under **Telemetry / Debuggability**. Continue to the next allowed step and deadline; never claim cleanup succeeded without `close`.
   - Never enumerate descendants, inspect wrapper contents, or use commands such as `pkill` or `killall`.

3. **Stop signaling when the saved group identifier is no longer safe.**
   - The identifier belongs to this launch only until the direct child’s `exit` event. Clear it before handling that event. Later `error`, `close`, timer, repeated-close, or shutdown callbacks must not signal the old number because the operating system may eventually give it to an unrelated program.
   - If the identifier was cleared before the force-stop deadline, skip `SIGKILL`, continue waiting only for the remaining deadline, and then return either confirmed `close` or the generic cleanup-unconfirmed error.

4. **Distinguish child exit from complete cleanup.**
   - A shell’s `exit` event can happen before a child has released inherited output streams. Do not use that event alone as proof that cleanup finished.
   - Use Node’s child `close` event—emitted after the direct child has ended and its inherited standard streams have closed—as the only confirmed cleanup boundary for this known launcher shape.
   - Exit before Tailscale becomes ready fails startup and starts the same bounded cleanup of every resource Pi Web started.
   - An unexpected direct-child exit after readiness immediately produces one warning—with no private connection details—that the launched command exited and private Tailscale access may be unavailable. Keep the Pi Web backend running locally and do not retry or restart Tailscale. Continue observing `close` in the background; a later Pi Web shutdown uses the bounded wait above but never signals a cleared identifier.
   - Imported Pi Web APIs report these lifecycle results but never exit the program that imported them.

5. **Keep every other native Serve decision unchanged.**
   - Preserve the exact foreground command, loopback backend (`127.0.0.1`, reachable only from this Mac), selected port, readiness marker, hidden child output, backend-first startup, browser ordering, and terminal-only signal handlers from the governing plan.
   - Do not add automatic Serve restart, health polling, repeated signal loops, process discovery, Tailscale status/configuration parsing, session IDs, Funnel handling, `--bg`, `off`, reset, LocalAPI, configuration replacement, or stale-orphan cleanup.
   - A force-stop is allowed only after the first 10-second wait and only for the still-owned private group.

6. **Resume the blocked focused and live validation.**
   - Test both a direct fake executable and a two-line executable shell launcher that omits `exec` and starts a long-lived fake command.
   - Test the forced-cleanup path only with disposable fake processes. After deterministic tests pass, repeat the already-approved isolated programmatic-close, `SIGINT`, and `SIGTERM` smoke. Keep the installed `/usr/local/bin/tailscale` and the dotfiles repository read-only.

## Reference Files

- [Governing native Serve plan](./2026-08-31-pi-web-native-tailscale-serve.md)
- [Repository instructions](../../AGENTS.md)
- [Current terminal launcher](../../bin/pi-web.js)
- [Server lifecycle memory](../memory/custom-server-lifecycle.md)
- [Active implementation helper](../worktrees/2026-08-31-pi-web-native-tailscale-serve/bin/pi-web-tailscale-serve.js)
- [Active implementation checkpoint](../worktrees/2026-08-31-pi-web-native-tailscale-serve/.agents/checkpoints/2026-08-31-pi-web-native-tailscale-serve-checkpoints.md)
- [Dotfiles runbook documenting the non-`exec` launcher](../../../dot_files/wiki/pages/dotfiles-overview.md)
- [Node child-process `detached` behavior](https://nodejs.org/api/child_process.html#optionsdetached)
- [Tailscale macOS CLI integration](https://tailscale.com/docs/reference/tailscale-cli?tab=macos)

## Decisions, Evidence, and Constraints

- **User decision:** do not edit `/usr/local/bin/tailscale`. It belongs to the installed Tailscale application and may be replaced by an update or reinstall.
- **User decision:** if ready Tailscale Serve stops unexpectedly, keep Pi Web running on local loopback, report one warning, and do not retry Tailscale automatically.
- **User decision:** intentional shutdown uses a 10-second normal-stop wait, then one force-stop of the still-owned group, then a final bounded wait. An unconfirmed result is reported and does not block forever. This plan sets that final wait to 10 seconds as a simple implementation bound.
- This Mac uses Tailscale’s Standalone macOS application. Its CLI integration installed a two-line executable shell launcher that invokes the app’s real command without `exec`.
- The isolated smoke proved local-only HTTP plus private secure web traffic (HTTPS) and secure WebSocket traffic (WSS). Programmatic close then signaled only the shell and did not finish. The validation harness safely signaled the exact test-owned real command, after which the shell and route closed; no validation-owned process remains.
- The dotfiles runbook had already documented this launcher behavior and used an owned process group. The governing Pi Web plan explicitly excluded process-group handling, so its implementation correctly stopped rather than silently expanding scope.
- The active native Serve work is uncommitted in its registered task worktree. Before editing, the implementation coordinator must resume implementation session `01a05b1e-bf0b-7f65-aaa8-31f2c571e3ac` in that worktree. It must not discard the state or start a second editing session from `main`.

## Test Strategy

Focused tests must prove:

- Unix-like systems create one private group, retain the child and streams, never call `unref`, and keep the exact foreground Tailscale arguments;
- programmatic close, `SIGINT`, and `SIGTERM` stop and join both a direct fake command and a non-`exec` shell launcher with its fake child;
- direct-shell `exit` cannot report successful cleanup while child-held streams remain open;
- an unexpected exit before readiness fails startup, while an unexpected exit after readiness warns immediately and leaves Pi Web serving locally without retry;
- after 10 seconds without `close`, one `SIGKILL` targets only the still-owned group; `close` during the final 10 seconds completes cleanup;
- a cleared group identifier prevents the force-stop signal, and the final deadline returns the generic cleanup-unconfirmed error instead of signaling an old number;
- failures from either signal call, later `error`/`exit`/`close` events, expired timers, and repeated close calls produce one result, and every asynchronous failure is caught and checked;
- the terminal launcher exits `1` after unconfirmed cleanup, while imported APIs return the error without exiting their host program;
- Windows retains direct-child behavior;
- production code contains no wrapper parsing, process-table search, `--bg`, global Serve inspection, automatic restart, or broad cleanup command.

Run the governing plan’s focused option, helper, launcher, and real-process tests together with TypeScript, lint, JavaScript syntax checks, and `git diff --check`. Do not run `next build`.

Then repeat one isolated live smoke proving the local-only backend, private same-port HTTPS and WSS, route removal after normal programmatic close/`SIGINT`/`SIGTERM`, an unexpected Tailscale-command exit after readiness leaving local Pi Web running when safely testable, and no change to WhisCode `30142` when active. Do not force-kill live Tailscale, run a live hard-kill recovery exercise, or print private Tailscale/session data.

## Telemetry / Debuggability

Add no telemetry system. Preserve bounded startup, child-exit, close-failure, and terminal-shutdown messages. Add at most one warning when the launched command exits and private access may be unavailable, plus one warning when forced cleanup is needed. A final deadline reports only that Tailscale cleanup could not be confirmed. These messages must not contain process IDs, command arguments, hostnames, child output, session IDs, or raw Tailscale data.

Disposable test programs may privately record process IDs or completion markers for their own exact cleanup; do not retain those values in project files or validation output.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | On Unix-like systems, Pi Web owns the launcher and everything it starts as one private process group while Tailscale Serve remains foreground and attached. | Spawn and argument tests using direct and non-`exec` disposable shell programs; source check for no `unref` or `--bg`. | Block; do not parse or modify the installed launcher. |
| VC-002 | Normal programmatic close, `SIGINT`, and `SIGTERM` stop and join the real command behind the shell, remove the owned foreground route, and leave no test-owned process. | Deterministic shell test program and isolated live close/signal smoke. | Block closeout; recover only the exact test-owned group and preserve unrelated listeners. |
| VC-003 | If normal cleanup has not produced child `close` after 10 seconds, Pi Web force-stops only its still-owned group and waits no more than another 10 seconds. Confirmed close succeeds; otherwise cleanup returns one generic failure and the terminal exits `1`. | Simulated-clock and real-process tests covering forced success, signal-call failure, identifier clearing, final timeout, repeated close, and verification that every asynchronous failure is caught and checked. | Block; do not wait forever, signal an old identifier, or add process discovery. |
| VC-004 | Exit before readiness fails startup. An unexpected direct-child exit after readiness warns once that private access may be unavailable, keeps local Pi Web running, and never retries Tailscale. Code that embeds Pi Web receives lifecycle results but is never forcibly exited. | Focused launcher and child-process tests, plus safe isolated observation when available. | Block; preserve local availability and the embedded-code boundary. |
| VC-005 | Windows direct-child behavior and every governing-plan promise unrelated to process ownership remain unchanged. | Tests that simulate Unix-like and Windows behavior, plus the governing plan’s focused suites. | Revert the regression; do not broaden platform or feature scope. |
| VC-006 | Pi Web performs no process discovery, wrapper parsing, shared Serve inspection or mutation, automatic restart, repeated signal loop, or cleanup of processes or listeners Pi Web did not start. | Production-source audit and isolated observation of WhisCode `30142`. | Stop and remove the out-of-scope behavior. |

## Assumptions, Risks, and Blockers

- The installed shell launcher’s child inherits its process group and standard streams, as verified on this Mac. A launcher that deliberately starts an independent service outside that group is not supported by this follow-up and would require separate evidence and planning.
- The helper owns the saved process-group identifier only before the direct child’s `exit` event. It clears the identifier first and ignores it in every later callback so a reused number cannot cause an unrelated process to be signaled.
- The child `close` event proves inherited streams closed; it does not inspect global Tailscale state. The isolated smoke remains the final evidence that the foreground route disappears after normal cleanup.
- Force-stopping the owned Tailscale command should close its daemon connection and remove its foreground route, but live force-kill validation is intentionally excluded. Disposable test programs must prove Pi Web’s ownership and timing behavior.
- If both bounded waits finish without `close`, Pi Web cannot confirm cleanup. The terminal command exits with failure status (code `1`) and may leave the Tailscale command or route behind; that is the explicitly accepted best-effort limit.
- If Pi Web itself receives `SIGKILL` or loses power, it cannot run either cleanup step. The governing plan’s hard-stop limitation remains unchanged.
- The active task worktree contains the only copy of the uncommitted native Serve implementation. Losing or independently duplicating that state blocks this follow-up.

## Implementation Handoff

This final draft remains `Status: draft` until the user confirms the shared understanding. Finalization and approval do not themselves change code or resume implementation.

After approval and a separate requested commit, the implementation command will be:

```text
/start-implementation .agents/plans/2026-09-01-shell-wrapped-tailscale-cleanup.md
```

The implementation coordinator must resume implementation session `01a05b1e-bf0b-7f65-aaa8-31f2c571e3ac` in the active native Serve worktree. It must not create another editing session from `main`.
