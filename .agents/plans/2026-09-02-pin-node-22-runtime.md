# Pin Pi Web to Node 22.23.2

Status: approved

## Objective

Pin Pi Web's ordinary development, production build, and direct production runtime to exact Node `22.23.2` with bundled npm `10.9.8`. Preserve the integrated Pi Web behavior and the installed `@bac2qh/pi-coding-agent@0.84.0-bac2qh.734502cb8` fork bytes.

The lasting runtime target is the repository-owned [`bin/pi-web.js`](../../bin/pi-web.js), including native `--tailscale-serve`, not the retiring dotfiles shell wrapper. Success means the repository declares and enforces the exact ordinary toolchain, rejects a wrong runtime before starting resources, passes clean disposable production validation, and merges the resulting task tip—including the validated implementation commit and its final validation record—into local `main`. After integration, the user will stop the old service and build/start from `main`; this plan supplies the exact commands but does not stop, rebuild, or replace the live service.

This controlled change removes one confirmed Node 24 compression-retention factor. It does not claim to fix every Next, Pi, or full-history memory risk.

## Design / Implementation Strategy

1. **Keep integrated native Serve behavior fixed.**
   - Local `main` merge `149dee1` contains native Serve implementation `e4e7e5b`, its process-group cleanup, final validation, and documentation. The former task branch/worktree are gone.
   - Reconfirm the baseline at Start. Do not change native Serve source or behavior: this task adds only the toolchain preflight around the already-tested launcher.
   - Do not edit the dotfiles repository or retire its wrapper here. That remains a separate cutover after the direct Node 22 runtime is proven.

2. **Declare one repository-scoped ordinary toolchain.**
   - Add root `mise.toml` with exact `node = "22.23.2"`; do not add or change the global Mise configuration or default. Installing the selected runtime may add Node 22 files and ordinary cache data to Mise's user-level installation store.
   - Add `packageManager: "npm@10.9.8"` to `package.json` as the matching package-manager declaration.
   - Use one small testable CommonJS toolchain module for exact version comparison and fixed-format mismatch errors. Sanitize each observed version to at most 32 printable ASCII characters, using `unknown` otherwise, and cap the whole message at 512 characters.
   - Inside this repository or its subdirectories, the existing shell setup makes `node` and `npm` resolve from `mise.toml`. Outside the repository, no toolchain setting changes. Explicit `mise exec -C <pi-web-root> node@22.23.2 -- ...` remains the reliable form from any directory.

3. **Enforce the pin on the exact ordinary entrypoints.**
   - Add `predev`, `prebuild`, and `prestart` hooks so `npm run dev`, `npm run build`, and `npm start` require Node `22.23.2` and npm `10.9.8` before their current commands run.
   - Make direct execution of `bin/pi-web.js`, including imported `runPiWebCli()` startup, require Node `22.23.2` before Next, Tailscale, extensions, sessions, or listeners start. Direct runtime does not require npm after startup.
   - Keep `build:local-pi-fork` and `install:local-pi-fork` outside these ordinary hooks; their existing reconstruction contract remains Node `24.19.0`/npm `11.17.0`.
   - A mismatch names only expected and observed public versions. For npm lifecycle commands it gives `mise exec -C <pi-web-root> node@22.23.2 -- npm run <dev|build|start>`; for direct launch it gives `mise exec -C <pi-web-root> node@22.23.2 -- node ./bin/pi-web.js`. It does not echo arbitrary arguments, mutate PATH, download a runtime during application startup, silently re-exec, or add another wrapper.

4. **Preserve the Pi fork and dependency graph.**
   - Do not change the fork commit, tarball, package alias, dependency versions, lock integrity, or `scripts/build-local-pi-fork.mjs` constants.
   - Verify the existing tarball against its lock digest and statically confirm the separate reconstruction versions. Do not invoke or rebuild the fork merely to switch Pi Web's runtime.
   - Install ordinary dependencies only in a temporary Pi Web copy placed beside the matching `pi` artifact directory, so the unchanged `file:../pi/...tgz` path resolves.

5. **Validate without touching the live checkout's runtime state.**
   - Install exact Node `22.23.2` through the already-installed Mise tool using the fixed version, not a moving `22` or `lts` alias; verify its npm is `10.9.8`.
   - In the temporary sibling-layout copy, run the committed lock installation, focused toolchain and native-Serve tests, the complete Node test suite, TypeScript, lint, and a production build/start/load/close/restart smoke under the exact toolchain.
   - Use synthetic empty Pi state, fake Tailscale children where needed, and no provider calls. Record only public versions and aggregate lifecycle results.
   - After disposable validation passes, create the implementation commit. Append the required final checkpoint summary naming that commit and its validation results, then commit the checkpoint. Guarded integration merges the resulting task-branch tip, which contains both commits, into local `main`. Do not rebuild or restart the live service, or modify main's `.next`, `node_modules`, Tailscale state, or dotfiles during this implementation.

6. **Hand the integrated build to the user.**
   - After closeout, report the integrated main commit and a non-executed command sequence for exact Node 22 dependency installation, production build, and direct `bin/pi-web.js --tailscale-serve` launch.
   - The sequence tells the user to stop the old wrapper-owned service first, preserve its current `.next` under a separate name if rollback is wanted, and never restart through Node 24 after the exact pin is integrated.
   - The user's later live build/restart is outside this plan's Validation Contract. If the user instead asks an agent to perform that live operation, plan or authorize that operation separately against then-current processes and checkout state.

**Rough scope estimate**

- **Surfaces:** root `mise.toml`; `package.json` command/package-manager declarations; one shared toolchain checker; direct launcher preflight; focused tests; concise setup documentation. No dependency, Pi fork, Next, DAG, Lineage, session, native-Serve, dotfiles, live-build, or live-process change.
- **Testability:** high. Exact versions, early rejection, exempt fork commands, full tests, and production lifecycle can be proven in disposable state.
- **Implementation difficulty:** low-to-medium. The code is small; care is needed to keep the two intentional Pi Web/Pi-fork toolchains separate.

## Reference Files

- [`package.json`](../../package.json)
- [`package-lock.json`](../../package-lock.json)
- [`bin/pi-web.js`](../../bin/pi-web.js)
- [`lib/pi-web-launcher.test.mjs`](../../lib/pi-web-launcher.test.mjs)
- [`scripts/build-local-pi-fork.mjs`](../../scripts/build-local-pi-fork.mjs)
- [`scripts/build-local-pi-fork.test.mjs`](../../scripts/build-local-pi-fork.test.mjs)
- [`AGENTS.md`](../../AGENTS.md)
- [Local Pi fork adoption plan](./2026-08-06-local-pi-fork-adoption.md)
- [Native foreground Tailscale Serve plan](./2026-08-31-pi-web-native-tailscale-serve.md)
- [Shell-wrapped Tailscale cleanup follow-up](./2026-09-01-shell-wrapped-tailscale-cleanup.md)
- [Dotfiles wrapper-retirement plan, read-only](../../../dot_files/.agents/plans/2026-08-31-pi-web-tailscale-serve-coexistence.md)
- [Dependency and local-runtime memory](../memory/dependency-security.md)
- [Custom-server lifecycle memory](../memory/custom-server-lifecycle.md)

## Decisions, Evidence, and Constraints

- **User decision (2026-09-02):** keep the integrated source and custom Pi fork; change only the ordinary Node/npm environment rather than rolling back DAG, Lineage, native Serve, Next, or Pi.
- **User decision (2026-09-02):** use exact Node `22.23.2` with npm `10.9.8`, repository-scoped rather than global.
- **User decision (2026-09-03):** implement and close out the code/configuration pin first. The user will build from integrated `main`; live rebuild/restart is not a pre-closeout assertion and needs no closeout override.
- **User decision (2026-09-02):** the tracked dotfiles wrapper will be retired separately for security reasons. This plan neither repairs nor depends on it as the lasting runtime.
- A checksum-verified official macOS arm64 Node `22.23.2` binary completed 4,000 upstream compression-reproducer iterations with sampled `arrayBuffers` peaking at 2.8 MiB and ending at 1.2 MiB. Node `24.15.0` through `24.20.0` are affected by `nodejs/node#65600`.
- Next `16.2.11` has a separate abandoned-response compression issue, and Pi has documented long-session/full-history retention. Node 22 is therefore a controlled mitigation, not proof of complete OOM resolution.
- Next accepts Node `>=20.9.0`; installed Pi packages require Node `>=22.19.0`.
- Native Serve is integrated on local `main` at `149dee1`; task tip `934ae91` is reachable, and the former task branch/worktree are absent.
- The currently live service is still the pre-integration dotfiles-wrapper process using Node `24.20.0` and the old `.next`. This plan deliberately leaves it untouched.
- Existing unrelated modified and untracked plans in main and unrelated dotfiles changes must remain untouched.

## Test Strategy

1. Unit-test exact valid/invalid Node and npm values, malformed values, bounded errors, and direct/imported early rejection without relying on the host version.
2. Prove `mise current` selects Node `22.23.2` from the Pi Web root and a nested directory. Verify the global Mise configuration file bytes or absence and the selected versions outside Pi Web remain unchanged; the expected new Node 22 installation/cache files are allowed.
3. Probe `npm run dev`, `npm run build`, `npm start`, and direct `bin/pi-web.js` with wrong and exact supplied environments. Prove mismatches stop before build/server/Tailscale work and print only the fixed recovery form.
4. Prove local-fork build/install scripts do not inherit ordinary hooks. Verify the existing tarball digest, lock integrity, dependency identity, and unchanged reconstruction constants without rebuilding it.
5. In the temporary sibling-layout copy under Node `22.23.2`/npm `10.9.8`, run `npm ci --ignore-scripts --include=dev`, focused tests, the complete Node suite, `node_modules/.bin/tsc --noEmit`, `npm run lint`, `git diff --check`, and production build/start/load/close/restart smoke.
6. Compare live process, `.next`, `node_modules`, Tailscale, dotfiles, and unrelated Git metadata before and after implementation only to prove they were not changed.

## Telemetry / Debuggability

Add no successful-start telemetry or periodic memory collection. A version mismatch fails before resource startup with the fixed-format, length-limited error defined above, names only expected and sanitized observed public versions, and gives a fixed recovery command. One-off disposable validation may record public Node/npm versions and V8 heap-limit MiB.

Do not print command environments, filesystem inventories, session identifiers/content, credentials, hostnames, provider payloads, child output, or private network state.

## Validation Contract

| ID | What must be true | How to verify it | If it fails |
|---|---|---|---|
| VC-001 | Root Mise configuration and ordinary `dev`, `build`, `start`, and direct launcher paths use exact Node `22.23.2`; npm lifecycle paths use npm `10.9.8`; wrong versions fail before resources; the global Mise configuration/default and selections outside Pi Web are unchanged. Installing Node 22 in Mise's shared user tool/cache store is allowed. | Inspect declarations/hooks, compare global configuration bytes or absence, run root/nested/outside probes, unit tests, and wrong/exact entrypoint probes. | Block integration; do not auto-download at application startup, change the global default, or fall back to Node 24. |
| VC-002 | The custom Pi fork and dependency graph remain byte-for-byte unchanged, and its uninvoked reconstruction contract remains Node `24.19.0`/npm `11.17.0`. | Verify artifact SHA-256/SHA-512, lock and npm-tree identity, helper constants/tests, and scoped diff without rebuilding the fork. | Stop and restore only task-owned changes; do not replace the artifact. |
| VC-003 | Integrated Pi Web, native Serve, session, DAG, Lineage, and transport behavior remain unchanged apart from exact toolchain enforcement and its documentation/tests. | Run complete tests/typecheck/lint and inspect the diff for no unrelated source, dependency, or behavior change. | Treat the change as scope growth and return to the user. |
| VC-004 | A clean disposable install and production lifecycle pass under Node `22.23.2`/npm `10.9.8` without real user state, Tailscale state, or provider calls. | Sibling-layout install, full static gates, production build, isolated HTTP/WebSocket/session smoke, and close/restart/close. | Diagnose only in disposable state; do not disturb the live service. |
| VC-005 | After disposable validation passes, local `main` receives the task tip containing the implementation commit followed by the committed final checkpoint summary that names it and records the results, without rebuilding or restarting the live service. | Check both ordered commits are reachable from `main`, inspect the final summary's implementation-commit reference, and confirm live process/build metadata is unchanged. | Do not integrate on failed source validation and do not operate on the live service. |
| VC-006 | No live `.next`/`node_modules`, wrapper/cutover file, Tailscale state, global Pi binary, user Pi data, or unrelated checkout/worktree state changes. | Sanitized pre/post metadata and scoped Git status/diff in both repositories. | Stop on ambiguity; never overwrite unrelated, live, or private state. |

## Assumptions, Risks, and Blockers

- Node 22 retains an approximately 4 GiB default V8 heap ceiling. It removes one known pressure source but does not enlarge the heap or fix other retainers.
- npm 10.9.8 is expected to consume the current lock without regeneration. Any dependency or lock-integrity drift blocks rather than becoming upgrade work.
- The root Mise pin is effective when the shell is in this trusted checkout; explicit `mise exec -C` is the location-independent form. The later dotfiles cutover owns bare-command discovery and may not add a global Node pin.
- The live Node 24 process may continue serving while source changes are integrated because it already loaded its launcher. The user must stop it before running the post-integration install/build commands.
- After integration, the exact runtime guard intentionally prevents using Node 24 as an availability fallback. If the user's later Node 22 build fails, they should preserve the old build and request diagnosis rather than bypass the guard.

## Implementation Handoff

This plan is `Status: approved`. It ends after the validated source/configuration commit reaches local `main`; the user's later build from `main` is not implementation validation. Approval does not install Node, implement, commit, rebuild, restart, retire the wrapper, or modify live state.

After approval, implementation starts only with:

```text
/start-implementation .agents/plans/2026-09-02-pin-node-22-runtime.md
```
