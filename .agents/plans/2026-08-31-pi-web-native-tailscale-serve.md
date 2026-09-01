# Pi Web Native Foreground Tailscale Serve

Status: approved

## Objective

Replace the dotfiles wrapper’s Tailnet responsibility with one minimal Pi Web-native opt-in:

```text
pi-web --tailscale-serve
Tailnet HTTPS/WSS :30141 -> http://127.0.0.1:30141
```

Ordinary `pi-web` remains local-only and defaults to `127.0.0.1:30141`. In Serve mode, a custom `--port` changes both the loopback backend and the private Tailscale HTTPS/WSS listener. Pi Web owns only its one attached foreground Serve child; WhisCode independently owns `30142`, and all other disjoint listeners remain untouched.

## Required Behavior

- Add explicit `--tailscale-serve`; ordinary `pi-web` never starts or requires Tailscale.
- Stop using the generic `HOSTNAME` environment variable as the unspecified bind address. Default native launch to literal `127.0.0.1` and port `30141`.
- Preserve explicit non-Serve `--hostname` compatibility while the dotfiles wrapper remains active.
- Serve mode starts Pi Web at `127.0.0.1:<selected-port>` and one attached child equivalent to:

  ```text
  tailscale serve --https=<selected-port> http://127.0.0.1:<selected-port>
  ```

- The selected port defaults to `30141`; reject Serve mode with port `0`, port `443`, or an explicit hostname other than `127.0.0.1`.
- HTTPS and WebSocket upgrades share the same Tailscale listener, so browser WebSockets use WSS without a second route or child.
- A same-port conflict, missing Tailscale executable, early child exit, or readiness timeout fails startup and closes every resource Pi Web started.
- Normal close, `SIGINT`, and `SIGTERM` signal and await only the owned child. Pi Web invokes no global Serve inspection or cleanup command.
- If the ready Serve child exits unexpectedly, the terminal launcher closes Pi Web and exits nonzero. Imported launcher APIs close their owned runtime and expose the failure without exiting the embedding process.
- `SIGKILL`, power loss, and a surviving orphan are documented limitations. A later launch fails safely when Tailscale reports the selected port occupied; Pi Web does not infer ownership or delete anything.

## Design / Implementation Strategy

1. **Add the option and safe defaults in [`bin/pi-web-options.js`](../../bin/pi-web-options.js).**
   - Parse `--tailscale-serve` as a boolean.
   - Return `127.0.0.1` when no explicit hostname is supplied, independent of `HOSTNAME`.
   - Validate the Serve-only hostname and port restrictions before starting resources.
   - Keep existing `--port`, `--hostname`, `--no-open`, and `--dev` behavior outside those deliberate defaults and Serve-only restrictions.

2. **Add one small foreground-child helper under `bin/`.**
   - Spawn `tailscale` directly, without a shell, detachment, background mode, or process discovery, using only `serve`, `--https=<port>`, and the exact loopback target.
   - Use noninteractive stdin. Pipe stdout only to scan for the exact non-sensitive post-configuration marker `Press Ctrl+C to exit.`; retain at most the bounded marker overlap and discard all other bytes. Drain/discard stderr and never log the CLI’s private hostname or raw output.
   - Treat the marker while the child remains live as readiness. Fail on the spawn `error` event, exit before readiness, or a fixed 60-second startup timeout.
   - Return an owner with idempotent targeted signal-and-await cleanup and an unexpected-exit notification. Mark intentional shutdown before signaling so normal cleanup is not reported as failure.
   - Use `SIGINT` for normal programmatic cleanup; preserve the terminal signal when shutdown originated from `SIGINT` or `SIGTERM`. Do not manage unrelated PIDs or process groups.

3. **Compose the child with the existing lifecycle in [`bin/pi-web.js`](../../bin/pi-web.js).**
   - Start the backend first at exact loopback. Start Serve only when opted in.
   - Report ready and open only the local browser URL after backend startup and, in Serve mode, the child readiness marker.
   - On Serve startup failure, stop the owned child if necessary and close the backend before returning the sanitized startup error.
   - Extend the existing idempotent runtime close so backend shutdown and owned-child cleanup start promptly and are both awaited; retain existing aggregate-failure behavior.
   - Keep all OS signal handlers in `runTerminalEntry()`. A terminal signal during Serve startup cancels readiness, cleans started resources, and preserves exit codes `130`/`143` unless cleanup fails.
   - After an unexpected ready-child exit, run one fatal shutdown. The executed CLI exits `1`; imported APIs never call `process.exit` and instead expose the terminal failure through their returned lifecycle surface.

4. **Keep the existing server boundary.**
   - Pass the literal loopback hostname through the existing `startPiWebServer()` options.
   - Leave [`bin/pi-web-server.js`](../../bin/pi-web-server.js) unchanged unless implementation demonstrates one narrowly necessary lifecycle seam that cannot be expressed by the launcher/helper. Any such need must remain within the existing non-exiting, idempotent server contract.

5. **Add focused tests and concise documentation.**
   - Extend the option, launcher, and terminal subprocess tests; add one focused helper test file.
   - Update [`README.md`](../../README.md), [`AGENTS.md`](../../AGENTS.md), and [`custom-server-lifecycle.md`](../memory/custom-server-lifecycle.md) with the two native launch modes, same-port HTTPS/WSS mapping, foreground lifetime, unexpected-exit behavior, and hard-kill limitation.
   - Keep `/Users/xin/Documents/repos/dot_files` read-only. Wrapper retirement remains a separately approved dotfiles task after native integration and isolated validation.

## Explicit Non-Goals

Pi Web will not implement or invoke:

- `tailscale status --json` or `tailscale serve status --json`;
- ServeConfig parsing, selected-port classification, session-ID tracking, or configuration fingerprinting;
- health polling, retries, Serve-only recovery, stale-route adoption, or orphan cleanup;
- process discovery, detached/process-group supervision, or unrelated-process signaling;
- a fake Tailscale daemon/configuration model or ETag race simulation;
- global Funnel detection or broad listener-shape matrices;
- live hard-kill recovery exercises;
- Funnel, `--bg`, `off`, reset, clear, set-config, LocalAPI, or configuration replacement.

The foreground Tailscale CLI remains responsible for per-port collision checks, ETag-protected preservation of the shared parent configuration, and deletion of its watcher-scoped session when the owned child exits. Pi Web relies on those CLI semantics rather than inspecting or rewriting global Serve state.

## Reference Files

- [Repository instructions](../../AGENTS.md)
- [Pi Web README](../../README.md)
- [Launch options](../../bin/pi-web-options.js)
- [Terminal launcher](../../bin/pi-web.js)
- [Custom server](../../bin/pi-web-server.js)
- [Option tests](../../lib/pi-web-options.test.mjs)
- [Launcher tests](../../lib/pi-web-launcher.test.mjs)
- [Real-process lifecycle tests](../../lib/pi-web-real-next.test.mjs)
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md)
- [Dotfiles wrapper-retirement prerequisite, read-only](../../../dot_files/.agents/plans/2026-08-31-pi-web-tailscale-serve-coexistence.md)
- [Official Tailscale Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Pinned foreground Serve implementation](https://github.com/tailscale/tailscale/blob/53a0d659afa51835dd7a9283873cca44261454f8/cmd/tailscale/cli/serve_v2.go#L438-L540)

## Current Evidence and Constraints

- Pi Web currently has no native Serve option. Its unspecified hostname can inherit `HOSTNAME` or reach `listen(port)` without an address; the dotfiles wrapper currently supplies the secure loopback default being retired.
- `runPiWebCli()` already owns readiness/browser ordering and an idempotent server close wrapper. `runTerminalEntry()` alone owns `SIGINT`/`SIGTERM` and terminal exit codes. The implementation should extend these seams, not add another signal owner.
- Tailscale foreground Serve performs its configuration update before printing `Press Ctrl+C to exit.`, rejects an occupied port, preserves disjoint parent configuration through ETag concurrency, and removes only its WatchIPNBus session when the child connection closes.
- One shared `tailscaled` daemon can therefore host Pi Web `30141`, WhisCode `30142`, and other disjoint listeners without Pi Web reading, comparing, replacing, or cleaning the global configuration.
- This revision authorizes only this plan-file edit. No implementation, build, commit, live Tailscale mutation, dotfiles edit, or wrapper retirement is authorized.

## Focused Test Strategy

Add deterministic coverage for:

- ordinary defaults (`127.0.0.1:30141`), ignored generic `HOSTNAME`, explicit non-Serve hostname compatibility, opt-in parsing, custom same-port selection, and Serve rejection of `0`, `443`, and non-loopback hostname overrides;
- the exact child executable, arguments, and spawn options, including no shell, detachment, `--bg`, or extra Tailscale command;
- fragmented readiness-marker detection while all private stdout/stderr remains absent from logs and public errors;
- missing executable, early exit, and 60-second timeout rolling back both child and backend;
- ready-log/browser ordering and local-only browser URL;
- idempotent programmatic close plus terminal `SIGINT` and `SIGTERM`, each awaiting the child and backend without another signal owner;
- unexpected post-readiness child exit closing Pi Web and producing terminal exit `1`, while imported APIs do not exit their caller;
- a static command audit proving the prohibited Tailscale subcommands/APIs are absent.

Use injected fake child processes/events, not a fake daemon or ServeConfig model. Focused implementation checks are:

```text
NODE_ENV=test node --test lib/pi-web-options.test.mjs lib/pi-web-launcher.test.mjs lib/pi-web-tailscale-serve.test.mjs lib/pi-web-real-next.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
git diff --check
```

Do not run `next build`.

During approved implementation, after fake tests pass, perform one isolated-port live smoke on a confirmed-free port other than `443`, `30141`, or `30142` while the existing wrapper remains active and untouched. Prove only:

1. the backend listens on `127.0.0.1:<isolated-port>`;
2. private HTTPS and WSS work through that same Serve port;
3. normal close, `SIGINT`, and `SIGTERM` remove the owned route; and
4. WhisCode `30142` remains unchanged.

Do not exercise live hard-kill recovery or print MagicDNS names, raw CLI output, session IDs, credentials, provider payloads, or private content.

## Diagnostics

Add no telemetry system or persistent log. Reuse the launcher’s bounded `startup_failed`, `terminal_shutdown_started`, `close_failed`, and `terminal_shutdown_complete` events, with at most one finite `serve_child_exited` reason. Never include child output, hostnames, targets, PIDs, or Tailscale payloads.

## Validation Contract

| ID | Required outcome | Evidence | Failure action |
|---|---|---|---|
| VC-001 | Ordinary Pi Web defaults to local `127.0.0.1:30141`; Serve mode uses the same selected backend/HTTPS/WSS port and rejects `0`, `443`, and non-loopback hostname overrides. | Option/launcher tests and isolated listener check. | Block; do not broaden the bind or choose another public port. |
| VC-002 | Pi Web spawns only the exact attached foreground Serve child and suppresses its private output while using the post-configuration marker for bounded readiness. | Helper argument, stream-fragment, early-exit, and timeout tests. | Block; do not add global status/config inspection. |
| VC-003 | Startup rollback and idempotent close release every Pi Web-owned resource; normal close, `SIGINT`, and `SIGTERM` signal and await the child and preserve existing terminal ownership. | Launcher and real-process lifecycle tests plus isolated smoke. | Block on orphaned or unjoined owned resources. |
| VC-004 | Unexpected child exit shuts down Pi Web and makes the executed CLI exit nonzero without making imported APIs exit their host process. | Focused launcher/subprocess tests. | Block; preserve the process-scoped API boundary. |
| VC-005 | Pi Web never inspects, compares, rewrites, or broadly cleans shared Serve state; WhisCode `30142` and disjoint listeners remain outside its ownership. | Exact-command/static audit and isolated WhisCode check. | Stop; remove any global-state or unrelated-owner behavior. |
| VC-006 | Focused tests, typecheck, lint, whitespace checks, concise docs, and the isolated live smoke pass without a Next build or dotfiles mutation. | Recorded commands and scoped Git status/diff. | Fix in scope or report the external blocker; do not retire the wrapper. |

## Assumptions and Limitations

- Tailscale is already installed, logged in, running, and authorized for private Serve. Pi Web does not manage those prerequisites.
- The exact readiness marker is a deliberate CLI compatibility seam. If a future Tailscale version stops emitting it, startup times out safely instead of inspecting global configuration.
- HTTPS and WSS are available only while both Pi Web and its attached foreground Serve child are alive. This plan adds no persistent service or reboot guarantee.
- `SIGKILL`, power loss, or an orphan that survives its parent cannot run Pi Web cleanup. The next invocation may fail on the occupied port; the operator must terminate the known owner or otherwise restore Tailscale externally. Pi Web never guesses or deletes it.
- Explicit non-Serve `--hostname` remains temporarily compatible for the active wrapper. Removing that option and retiring the wrapper are outside this Pi Web implementation.
- Unrelated working-tree changes in both repositories must remain untouched.

## Implementation Handoff

The user finalized and approved this revised plan on 2026-08-31. Finalization does not start implementation or authorize wrapper retirement. Implementation begins only through a later explicit Start Implementation invocation for this exact path.

No implementation, build, commit, live Tailscale mutation, or repository-external edit was performed during planning or finalization.
